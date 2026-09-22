package me.groundwire.drive.urbit

/**
 * A line-at-a-time server-sent-events parser. Feed it every line the
 * socket yields; it returns an event's joined `data:` payload when the
 * blank line that ends the event arrives, and null otherwise.
 *
 * Comment lines (":keepalive") and `event:`/`id:` fields are accepted
 * and ignored: Drive sends one event type, `fact`, and its payload
 * says what changed.
 */
class SseParser {
    private val data = StringBuilder()
    private var hasData = false

    fun feed(line: String): String? {
        when {
            line.isEmpty() -> {
                if (!hasData) return null
                val out = data.toString()
                data.clear()
                hasData = false
                return out
            }
            line.startsWith(":") -> Unit
            line.startsWith("data:") -> {
                if (hasData) data.append('\n')
                data.append(line.removePrefix("data:").removePrefix(" "))
                hasData = true
            }
            else -> Unit
        }
        return null
    }
}
