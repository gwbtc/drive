package me.groundwire.drive.drive

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import me.groundwire.drive.urbit.ShipClient
import me.groundwire.drive.urbit.ShipUrl

/**
 * The slice of Drive's HTTP API a chat client needs: the listing (spaces,
 * invites, nicknames), a space's chat log, the DM inbox and threads, and
 * the actions that post, send and mark read.
 *
 * Reads go through eyre's scry gateway, /~/scry/drive/<path>.json.
 * Writes go to Drive's own POST /drive/action with a one-key JSON object
 * whose key is the action tag, exactly as the web client sends them.
 * (Drive's marks have no JSON grab arm on purpose, so the eyre channel
 * cannot be used for pokes.)
 */
class DriveApi(private val ship: ShipClient) {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    suspend fun listing(): Listing = json.decodeFromString(ship.scryJson("drive", "listing"))

    suspend fun spaceChat(spaceId: String): SpaceChat =
        json.decodeFromString(ship.scryJson("drive", "chat/$spaceId"))

    suspend fun dms(): List<DmRow> = json.decodeFromString(ship.scryJson("drive", "dms"))

    /** [peer] with or without the leading ~; the path wants it bare. */
    suspend fun dm(peer: String): DmThread =
        json.decodeFromString(ship.scryJson("drive", "dm/${ShipUrl.bare(peer)}"))

    suspend fun postMessage(spaceId: String, text: String) = action("post-message") {
        put("space", spaceId)
        put("text", text)
    }

    suspend fun sendDm(peer: String, text: String) = action("send-dm") {
        put("who", ShipUrl.bare(peer))
        put("text", text)
    }

    suspend fun readSpace(spaceId: String) = action("read-space", JsonPrimitive(spaceId))

    suspend fun readDm(peer: String) = action("read-dm", JsonPrimitive(ShipUrl.bare(peer)))

    suspend fun acceptSpaceInvite(spaceId: String) = action("accept-space-invite", JsonPrimitive(spaceId))

    suspend fun declineSpaceInvite(spaceId: String) = action("decline-space-invite", JsonPrimitive(spaceId))

    private suspend fun action(tag: String, value: JsonElement) {
        val body = buildJsonObject { put(tag, value) }
        ship.postJson("/drive/action", body.toString())
    }

    private suspend fun action(tag: String, fields: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit) =
        action(tag, buildJsonObject(fields))
}
