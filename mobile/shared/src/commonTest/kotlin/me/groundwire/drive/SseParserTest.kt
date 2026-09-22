package me.groundwire.drive

import me.groundwire.drive.urbit.SseParser
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SseParserTest {
    @Test
    fun driveEventsAndKeepalives() {
        val p = SseParser()
        // What Drive actually writes: a keepalive comment, then an event.
        assertNull(p.feed(":keepalive"))
        assertNull(p.feed(""))
        assertNull(p.feed("event: fact"))
        assertNull(p.feed("""data: {"type":"listing"}"""))
        assertEquals("""{"type":"listing"}""", p.feed(""))
        // A second event on the same parser.
        assertNull(p.feed("event: fact"))
        assertNull(p.feed("""data: {"type":"dm","peer":"~zod"}"""))
        assertEquals("""{"type":"dm","peer":"~zod"}""", p.feed(""))
    }

    @Test
    fun multiLineDataIsJoinedWithNewlines() {
        val p = SseParser()
        assertNull(p.feed("data: a"))
        assertNull(p.feed("data:b"))
        assertEquals("a\nb", p.feed(""))
    }
}
