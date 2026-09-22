package me.groundwire.drive.store

import me.groundwire.drive.drive.ChatMessage

/**
 * Which messages in a freshly fetched room are new enough to notify about.
 *
 * The rule: everything after the newest timestamp we have already seen
 * in that room, not written by us. A room fetched for the first time
 * (no stored mark) yields nothing, so installing the app on a ship with
 * months of history does not fire months of notifications; its mark
 * becomes the newest message's time.
 */
object NewMessages {
    data class Result(val fresh: List<ChatMessage>, val newMark: Long?)

    fun diff(messages: List<ChatMessage>, seenThrough: Long?, our: String): Result {
        val newest = messages.maxOfOrNull { it.at } ?: return Result(emptyList(), seenThrough)
        if (seenThrough == null) return Result(emptyList(), newest)
        val fresh = messages
            .filter { it.at > seenThrough && it.author != our }
            .sortedBy { it.at }
        return Result(fresh, maxOf(newest, seenThrough))
    }
}
