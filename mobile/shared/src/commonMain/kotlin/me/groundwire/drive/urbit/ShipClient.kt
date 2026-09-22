package me.groundwire.drive.urbit

import io.ktor.client.HttpClient
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.HttpTimeoutConfig
import io.ktor.client.plugins.timeout
import io.ktor.client.request.forms.submitForm
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.prepareGet
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsChannel
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.parameters
import io.ktor.utils.io.readUTF8Line

/** Thrown when the ship answers 401/403: the cookie is stale, log in again. */
class SessionExpired : Exception("the ship no longer accepts this session")

/** Thrown when /~/login yields no urbauth cookie: wrong +code or wrong URL. */
class LoginFailed(status: Int, detail: String) : Exception("login failed ($status): $detail")

class ShipError(val status: Int, detail: String) : Exception("ship answered $status: $detail")

/**
 * The HTTP side of talking to one ship over eyre: log in with the +code,
 * then scry, post to an agent's own HTTP endpoint, and read a
 * server-sent-events stream, all under the urbauth cookie.
 *
 * Nothing here is Drive-specific except the two path helpers; the
 * Drive client sits on top in [me.groundwire.drive.drive.DriveApi].
 */
class ShipClient(
    /** e.g. "http://143.110.147.191:8080", no trailing slash. */
    val baseUrl: String,
    /** "urbauth-~zod=0v1.abc..." or null before login. */
    var cookie: String? = null,
) {
    private val http = HttpClient {
        // eyre answers a successful login with a 303 whose Set-Cookie we
        // must read ourselves; following it would lose the header.
        followRedirects = false
        expectSuccess = false
        install(HttpTimeout) {
            requestTimeoutMillis = 30_000
            connectTimeoutMillis = 15_000
            socketTimeoutMillis = 30_000
        }
    }

    /** POST /~/login with the +code; returns and stores the auth cookie. */
    suspend fun login(code: String): String {
        val resp = http.submitForm(
            url = "$baseUrl/~/login",
            formParameters = parameters { append("password", code) },
        )
        val cookies = resp.headers.getAll(HttpHeaders.SetCookie).orEmpty()
        val auth = cookies.firstOrNull { it.startsWith("urbauth-") }
            ?: throw LoginFailed(resp.status.value, resp.bodyAsText().take(200))
        cookie = auth.substringBefore(';')
        return cookie!!
    }

    /** GET /~/host: the ship's own name, served to anyone. */
    suspend fun host(): String {
        val resp = http.get("$baseUrl/~/host")
        if (resp.status.value != 200) throw ShipError(resp.status.value, resp.bodyAsText().take(200))
        return resp.bodyAsText().trim()
    }

    /** GET /~/scry/<agent>/<path>.json, the JSON text. */
    suspend fun scryJson(agent: String, path: String): String {
        val resp = http.get("$baseUrl/~/scry/$agent/$path.json") { auth() }
        return when (resp.status.value) {
            200 -> resp.bodyAsText()
            401, 403 -> throw SessionExpired()
            else -> throw ShipError(resp.status.value, resp.bodyAsText().take(300))
        }
    }

    /** POST a JSON body to an agent's own eyre route, e.g. /drive/action. */
    suspend fun postJson(route: String, body: String): String {
        val resp = http.post("$baseUrl$route") {
            auth()
            contentType(ContentType.Application.Json)
            setBody(body)
        }
        return when (resp.status.value) {
            in 200..299 -> resp.bodyAsText()
            401, 403 -> throw SessionExpired()
            else -> throw ShipError(resp.status.value, resp.bodyAsText().take(300))
        }
    }

    /**
     * Read a server-sent-events stream until the connection closes.
     * [onData] gets each event's `data:` payload. Returns normally on a
     * clean close and throws on a network error; the caller reconnects.
     *
     * The socket timeout doubles as the watchdog: Drive writes a keepalive
     * comment every 25 s, so 90 s of silence means a dead socket.
     */
    suspend fun readSse(route: String, onOpen: suspend () -> Unit, onData: suspend (String) -> Unit) {
        http.prepareGet("$baseUrl$route") {
            auth()
            header(HttpHeaders.Accept, "text/event-stream")
            // A gzip-encoded event stream is buffered by the encoder and
            // never flushes; ask for it plain.
            header(HttpHeaders.AcceptEncoding, "identity")
            header(HttpHeaders.CacheControl, "no-cache")
            timeout {
                requestTimeoutMillis = HttpTimeoutConfig.INFINITE_TIMEOUT_MS
                socketTimeoutMillis = 90_000
            }
        }.execute { resp ->
            when (resp.status.value) {
                200 -> Unit
                401, 403 -> throw SessionExpired()
                else -> throw ShipError(resp.status.value, resp.bodyAsText().take(200))
            }
            onOpen()
            val channel = resp.bodyAsChannel()
            val parser = SseParser()
            while (true) {
                val line = channel.readUTF8Line() ?: break
                parser.feed(line)?.let { onData(it) }
            }
        }
    }

    fun close() = http.close()

    private fun io.ktor.client.request.HttpRequestBuilder.auth() {
        val c = cookie ?: throw SessionExpired()
        header(HttpHeaders.Cookie, c)
    }
}
