package me.groundwire.drive

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import me.groundwire.drive.drive.DriveApi
import me.groundwire.drive.drive.FeedEvent
import me.groundwire.drive.drive.RoomId
import me.groundwire.drive.store.ChatStore
import me.groundwire.drive.store.Connection
import me.groundwire.drive.store.MemorySettingsStore
import me.groundwire.drive.urbit.ShipClient
import me.groundwire.drive.urbit.ShipUrl
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The end-to-end check against a real ship. Opt in with
 *
 *     DRIVE_SHIP_URL=143.110.147.191:8080 DRIVE_CODE=lidlut-... ./gradlew :shared:desktopTest --tests '*LiveShipTest*'
 *
 * With DRIVE_SPACE=<space-id> it also posts one message to that space's
 * chat and waits for the feed to announce it. Skips silently otherwise.
 */
class LiveShipTest {
    private val url = System.getenv("DRIVE_SHIP_URL")
    private val code = System.getenv("DRIVE_CODE")
    private val space = System.getenv("DRIVE_SPACE")

    @Test
    fun loginListingAndFeed() = runBlocking {
        if (url.isNullOrBlank() || code.isNullOrBlank()) {
            println("LiveShipTest: DRIVE_SHIP_URL / DRIVE_CODE not set; skipping")
            return@runBlocking
        }
        val client = ShipClient(ShipUrl.normalize(url))
        val cookie = client.login(ShipUrl.normalizeCode(code))
        assertTrue(cookie.startsWith("urbauth-~"), "cookie: $cookie")
        val ship = client.host()
        assertTrue(ship.startsWith("~"), "host: $ship")
        println("logged in as $ship")

        val api = DriveApi(client)
        val listing = api.listing()
        println("spaces=${listing.spaces.map { it.name }} invites=${listing.spaceInvites.map { it.name }} nicknames=${listing.nicknames.size}")
        val dms = api.dms()
        println("dm threads=${dms.size}")
        listing.spaces.forEach { sp ->
            val chat = api.spaceChat(sp.id)
            println("  ${sp.name}: ${chat.messages.size} messages, unread=${sp.unread}")
        }

        // The feed: connect, expect the open, then (optionally) post and expect the ping.
        val opened = CompletableDeferred<Unit>()
        val events = mutableListOf<FeedEvent>()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val feed = scope.launch {
            client.readSse("/drive/sse?feed=listing", onOpen = { opened.complete(Unit) }) { data ->
                FeedEvent.parse(data)?.let { synchronized(events) { events.add(it) } }
            }
        }
        withTimeout(20_000) { opened.await() }
        println("feed open")

        if (!space.isNullOrBlank()) {
            val text = "drive-mobile live test ${System.currentTimeMillis()}"
            api.postMessage(space, text)
            val ping = withTimeoutOrNull(20_000) {
                while (synchronized(events) { events.none { it == FeedEvent.SpaceChat(space) } }) delay(200)
                true
            }
            assertEquals(true, ping, "no space-chat ping for $space; events=$events")
            val after = api.spaceChat(space).messages
            assertTrue(after.any { it.text == text && it.author == ship }, "posted message not in chat")
            api.readSpace(space)
            println("posted and observed: $text")
        }
        feed.cancel()
        scope.cancel()
        client.close()
    }

    @Test
    fun storeRoundTrip() = runBlocking {
        if (url.isNullOrBlank() || code.isNullOrBlank()) return@runBlocking
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val store = ChatStore(MemorySettingsStore(), scope)
        store.login(url, code)
        assertNotNull(store.session.value)
        store.start()
        withTimeout(20_000) { store.connection.first { it == Connection.Live } }
        withTimeout(20_000) { store.listing.first { it != null } }
        val spaces = store.listing.value!!.spaces
        println("store: ${spaces.size} spaces after connect; rooms=${store.rooms.value.keys}")
        spaces.firstOrNull()?.let { sp ->
            store.refreshRoom(RoomId.Space(sp.id))
            assertTrue(store.rooms.value.containsKey("space:${sp.id}"))
        }
        store.stop()
        scope.cancel()
    }
}
