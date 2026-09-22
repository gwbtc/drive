package me.groundwire.drive.drive

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * What Drive's change feed (GET /drive/sse?feed=listing) says. The feed
 * carries no message bodies, only "re-fetch this": `{"type":"listing"}`
 * after any listing-changing action, `{"type":"space-chat","space":id}`
 * when a space's chat changed, `{"type":"dm","peer":"~ship"}` for a DM
 * thread. Anything else is [Other].
 */
sealed interface FeedEvent {
    data object Listing : FeedEvent
    data class SpaceChat(val spaceId: String) : FeedEvent
    data class Dm(val peer: String) : FeedEvent
    data class Other(val type: String) : FeedEvent

    companion object {
        private val json = Json { ignoreUnknownKeys = true; isLenient = true }

        fun parse(data: String): FeedEvent? {
            val obj = runCatching { json.parseToJsonElement(data).jsonObject }.getOrNull() ?: return null
            val type = obj["type"]?.jsonPrimitive?.content ?: return null
            return when (type) {
                "listing" -> Listing
                "space-chat" -> obj["space"]?.jsonPrimitive?.content?.let { SpaceChat(it) } ?: Other(type)
                "dm" -> obj["peer"]?.jsonPrimitive?.content?.let { Dm(it) } ?: Other(type)
                else -> Other(type)
            }
        }
    }
}
