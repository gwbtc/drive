package me.groundwire.drive.drive

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// The JSON shapes Drive's agent serves. Field names follow the encoders
// in gwbtc/drive desk/app/drive.hoon (enjs-listing, space-summary,
// chat-msg-json, enjs-dms, enjs-dm). Unknown keys are ignored so the
// listing's file sections do not have to be modelled.

@Serializable
data class Listing(
    val spaces: List<SpaceSummary> = emptyList(),
    @SerialName("space-invites") val spaceInvites: List<SpaceInvite> = emptyList(),
    @SerialName("dm-unread") val dmUnread: Int = 0,
    @SerialName("my-nickname") val myNickname: String = "",
    /** "~ship" -> nickname, for everyone in any space we share. */
    val nicknames: Map<String, String> = emptyMap(),
)

@Serializable
data class SpaceSummary(
    /** @uv, e.g. "0v3gr.mqs9e...". */
    val id: String,
    val name: String,
    /** "~ship" hosting the space; us for spaces we host. */
    val host: String,
    val role: String = "viewer",
    val members: Int = 0,
    val created: Long = 0,
    /** true for a space hosted elsewhere that we joined. */
    val joined: Boolean = false,
    val unread: Int = 0,
)

@Serializable
data class SpaceInvite(
    val id: String,
    val name: String,
    val host: String,
    val role: String = "viewer",
)

@Serializable
data class ChatMessage(
    /** @uv message id. */
    val id: String,
    /** "~ship". */
    val author: String,
    val text: String,
    /** Unix milliseconds. */
    val at: Long,
)

/** GET /~/scry/drive/chat/<space>.json */
@Serializable
data class SpaceChat(
    val read: Long = 0,
    /** Oldest first. */
    val messages: List<ChatMessage> = emptyList(),
)

/** One row of GET /~/scry/drive/dms.json, most recently active first. */
@Serializable
data class DmRow(
    val peer: String,
    val unread: Int = 0,
    @SerialName("last-at") val lastAt: Long = 0,
    @SerialName("last-text") val lastText: String = "",
    @SerialName("last-author") val lastAuthor: String = "",
)

/** GET /~/scry/drive/dm/<ship>.json */
@Serializable
data class DmThread(
    val peer: String = "",
    val read: Long = 0,
    /** Oldest first. */
    val messages: List<ChatMessage> = emptyList(),
)

/** A chat room: a space's channel or a DM thread. */
sealed interface RoomId {
    val key: String

    data class Space(val id: String) : RoomId {
        override val key get() = "space:$id"
    }

    data class Dm(val peer: String) : RoomId {
        override val key get() = "dm:$peer"
    }

    companion object {
        fun fromKey(key: String): RoomId? = when {
            key.startsWith("space:") -> Space(key.removePrefix("space:"))
            key.startsWith("dm:") -> Dm(key.removePrefix("dm:"))
            else -> null
        }
    }
}
