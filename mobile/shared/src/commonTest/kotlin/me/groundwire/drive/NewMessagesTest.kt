package me.groundwire.drive

import me.groundwire.drive.drive.ChatMessage
import me.groundwire.drive.store.NewMessages
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class NewMessagesTest {
    private val me = "~zod"
    private fun msg(id: String, at: Long, author: String = "~nec") = ChatMessage(id, author, "t$id", at)

    @Test
    fun firstFetchNotifiesNothingAndSetsTheMark() {
        val r = NewMessages.diff(listOf(msg("a", 10), msg("b", 20)), seenThrough = null, our = me)
        assertTrue(r.fresh.isEmpty())
        assertEquals(20, r.newMark)
    }

    @Test
    fun onlyMessagesAfterTheMarkFromOthers() {
        val r = NewMessages.diff(
            listOf(msg("a", 10), msg("b", 20), msg("c", 30, author = me), msg("d", 40)),
            seenThrough = 20,
            our = me,
        )
        assertEquals(listOf("d"), r.fresh.map { it.id })
        assertEquals(40, r.newMark)
    }

    @Test
    fun emptyRoomKeepsTheMark() {
        val r = NewMessages.diff(emptyList(), seenThrough = 99, our = me)
        assertTrue(r.fresh.isEmpty())
        assertEquals(99, r.newMark)
    }

    @Test
    fun markNeverMovesBackwards() {
        val r = NewMessages.diff(listOf(msg("a", 10)), seenThrough = 50, our = me)
        assertEquals(50, r.newMark)
    }
}
