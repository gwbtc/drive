package me.groundwire.drive.urbit

/** Turns what a person types into a base URL and a login code the ship accepts. */
object ShipUrl {
    private val ipv4 = Regex("""^\d{1,3}(\.\d{1,3}){3}(:\d+)?$""")
    private val hostWithPort = Regex("""^[^/:]+:\d+$""")

    /**
     * "143.110.147.191:8080" -> "http://143.110.147.191:8080"
     * "bespoke.kazoo.groundwire.me" -> "https://bespoke.kazoo.groundwire.me"
     * An explicit scheme is kept. A trailing slash is dropped.
     *
     * A bare IP, "localhost", or anything with an explicit port is a
     * comet on a droplet with no certificate, so plain http; a bare
     * domain is assumed to have one.
     */
    fun normalize(raw: String): String {
        val s = raw.trim().trimEnd('/')
        if (s.contains("://")) return s
        val plain = ipv4.matches(s) || hostWithPort.matches(s) ||
            s == "localhost" || s.startsWith("localhost:")
        return (if (plain) "http://" else "https://") + s
    }

    /** "+lidlut-tabwed-pillex-ridrup" -> "lidlut-tabwed-pillex-ridrup". */
    fun normalizeCode(raw: String): String = raw.trim().removePrefix("+").lowercase()

    /** "~zod" and "zod" -> "~zod". */
    fun withSig(ship: String): String = if (ship.startsWith("~")) ship else "~$ship"

    /** "~zod" -> "zod": the form Drive's action JSON and DM scry path want. */
    fun bare(ship: String): String = ship.removePrefix("~")
}
