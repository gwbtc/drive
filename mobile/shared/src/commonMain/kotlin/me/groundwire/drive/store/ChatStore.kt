package me.groundwire.drive.store

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.time.Clock
import me.groundwire.drive.Names
import me.groundwire.drive.drive.ChatMessage
import me.groundwire.drive.drive.DmRow
import me.groundwire.drive.drive.DriveApi
import me.groundwire.drive.drive.FeedEvent
import me.groundwire.drive.drive.Listing
import me.groundwire.drive.drive.RoomId
import me.groundwire.drive.urbit.SessionExpired
import me.groundwire.drive.urbit.ShipClient
import me.groundwire.drive.urbit.ShipUrl

/** The live-feed connection, for the status dot and the service notification. */
sealed interface Connection {
    data object Off : Connection
    data object Connecting : Connection
    data object Live : Connection
    data class Down(val reason: String) : Connection
}

/** One message worth telling the user about, with the room it landed in. */
data class NewMessage(val room: RoomId, val roomTitle: String, val message: ChatMessage, val authorName: String)

/**
 * All app state, shared by the UI and the Android sync service: the
 * session, the listing, the DM inbox, every room's messages, and the
 * feed loop that keeps them fresh. One instance per process.
 *
 * The feed is Drive's SSE change stream; each event names a room to
 * re-fetch. On every (re)connect the store re-fetches everything it
 * knows, which is what recovers from time spent disconnected.
 */
class ChatStore(
    private val settings: SettingsStore,
    private val scope: CoroutineScope,
) {
    private val _session = MutableStateFlow(Session.load(settings))
    val session: StateFlow<Session?> = _session.asStateFlow()

    private val _listing = MutableStateFlow<Listing?>(null)
    val listing: StateFlow<Listing?> = _listing.asStateFlow()

    private val _dms = MutableStateFlow<List<DmRow>>(emptyList())
    val dms: StateFlow<List<DmRow>> = _dms.asStateFlow()

    /** Messages per room key, oldest first. */
    private val _rooms = MutableStateFlow<Map<String, List<ChatMessage>>>(emptyMap())
    val rooms: StateFlow<Map<String, List<ChatMessage>>> = _rooms.asStateFlow()

    private val _connection = MutableStateFlow<Connection>(Connection.Off)
    val connection: StateFlow<Connection> = _connection.asStateFlow()

    /** The room the UI is showing right now, so it is not also notified. */
    val activeRoom = MutableStateFlow<RoomId?>(null)

    /** A room something outside the UI (a notification tap) wants opened. */
    val openRequest = MutableStateFlow<RoomId?>(null)

    private val _newMessages = MutableSharedFlow<NewMessage>(extraBufferCapacity = 256)
    val newMessages: SharedFlow<NewMessage> = _newMessages.asSharedFlow()

    init {
        // A session from before the baseline existed gets one now.
        if (_session.value != null && settings.get(KEY_BASELINE) == null) {
            settings.put(KEY_BASELINE, Clock.System.now().toEpochMilliseconds().toString())
        }
    }

    private var client: ShipClient? = _session.value?.let { ShipClient(it.baseUrl, it.cookie) }
    private var api: DriveApi? = client?.let { DriveApi(it) }
    private var feedJob: Job? = null
    private val fetchLock = Mutex()

    val our: String? get() = _session.value?.ship

    private companion object {
        const val KEY_BASELINE = "seen.baseline"
    }

    // ---- session -------------------------------------------------------

    /** Log in; throws LoginFailed / ShipError with a readable message. */
    suspend fun login(rawUrl: String, rawCode: String) {
        val base = ShipUrl.normalize(rawUrl)
        val fresh = ShipClient(base)
        val cookie = fresh.login(ShipUrl.normalizeCode(rawCode))
        val ship = fresh.host()
        val s = Session(base, ship, cookie)
        s.save(settings)
        // Everything written before this moment is history and stays
        // silent; a room first seen later (a new DM thread, a space
        // joined later) notifies for what came after it.
        settings.put(KEY_BASELINE, Clock.System.now().toEpochMilliseconds().toString())
        stop()
        client?.close()
        client = fresh
        api = DriveApi(fresh)
        _session.value = s
        _listing.value = null
        _dms.value = emptyList()
        _rooms.value = emptyMap()
    }

    fun logout() {
        stop()
        Session.clear(settings)
        client?.close()
        client = null
        api = null
        _session.value = null
        _listing.value = null
        _dms.value = emptyList()
        _rooms.value = emptyMap()
        _connection.value = Connection.Off
    }

    // ---- reads ---------------------------------------------------------

    suspend fun refreshListing() {
        val a = api ?: return
        _listing.value = a.listing()
    }

    suspend fun refreshDms() {
        val a = api ?: return
        _dms.value = a.dms()
    }

    /** Fetch one room and emit notifications for what is new in it. */
    suspend fun refreshRoom(room: RoomId) {
        val a = api ?: return
        val messages = when (room) {
            is RoomId.Space -> a.spaceChat(room.id).messages
            is RoomId.Dm -> a.dm(room.peer).messages
        }
        _rooms.update { it + (room.key to messages) }
        noticeNew(room, messages)
    }

    /** Listing, DM inbox, and every room we have ever shown or been pinged about. */
    suspend fun refreshAll() = fetchLock.withLock {
        refreshListing()
        refreshDms()
        val known = buildSet {
            _listing.value?.spaces?.forEach { add(RoomId.Space(it.id)) }
            _dms.value.forEach { add(RoomId.Dm(it.peer)) }
            _rooms.value.keys.mapNotNull { RoomId.fromKey(it) }.forEach { add(it) }
        }
        known.forEach { room ->
            runCatching { refreshRoom(room) }.onFailure { if (it is SessionExpired) throw it }
        }
    }

    // ---- writes --------------------------------------------------------

    suspend fun send(room: RoomId, text: String) {
        val a = api ?: return
        when (room) {
            is RoomId.Space -> a.postMessage(room.id, text)
            is RoomId.Dm -> a.sendDm(room.peer, text)
        }
        // The feed pings us too, but a member's post round-trips through
        // the host first; fetch now so our own message shows at once.
        refreshRoom(room)
    }

    suspend fun markRead(room: RoomId) {
        val a = api ?: return
        when (room) {
            is RoomId.Space -> a.readSpace(room.id)
            is RoomId.Dm -> a.readDm(room.peer)
        }
        // Reading also moves the notification mark to the newest message.
        _rooms.value[room.key]?.maxOfOrNull { it.at }?.let { setSeen(room, it) }
        refreshListing()
        refreshDms()
    }

    suspend fun acceptInvite(spaceId: String) {
        api?.acceptSpaceInvite(spaceId)
        refreshListing()
    }

    suspend fun declineInvite(spaceId: String) {
        api?.declineSpaceInvite(spaceId)
        refreshListing()
    }

    // ---- the feed ------------------------------------------------------

    /** Start the live feed with reconnect; idempotent. */
    fun start() {
        if (feedJob?.isActive == true) return
        val c = client ?: return
        feedJob = scope.launch {
            var backoff = 2_000L
            while (isActive) {
                _connection.value = Connection.Connecting
                try {
                    c.readSse(
                        route = "/drive/sse?feed=listing",
                        onOpen = {
                            _connection.value = Connection.Live
                            backoff = 2_000L
                            runCatching { refreshAll() }.onFailure { if (it is SessionExpired) throw it }
                        },
                        onData = { data -> handle(FeedEvent.parse(data) ?: return@readSse) },
                    )
                    _connection.value = Connection.Down("feed closed")
                } catch (e: SessionExpired) {
                    _connection.value = Connection.Down("session expired; log in again")
                    return@launch
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (e: Exception) {
                    _connection.value = Connection.Down(e.message ?: e::class.simpleName ?: "error")
                }
                delay(backoff)
                backoff = (backoff * 2).coerceAtMost(60_000L)
            }
        }
    }

    fun stop() {
        feedJob?.cancel()
        feedJob = null
        _connection.value = Connection.Off
    }

    private suspend fun handle(event: FeedEvent) {
        runCatching {
            when (event) {
                FeedEvent.Listing -> { refreshListing(); refreshDms() }
                is FeedEvent.SpaceChat -> { refreshRoom(RoomId.Space(event.spaceId)); refreshListing() }
                is FeedEvent.Dm -> { refreshRoom(RoomId.Dm(event.peer)); refreshDms() }
                is FeedEvent.Other -> Unit
            }
        }.onFailure { if (it is SessionExpired) throw it }
    }

    // ---- notifications -------------------------------------------------

    private fun seenKey(room: RoomId) = "seen:${room.key}"
    private fun seen(room: RoomId): Long? = settings.get(seenKey(room))?.toLongOrNull()
    private fun setSeen(room: RoomId, at: Long) = settings.put(seenKey(room), at.toString())
    private fun baseline(): Long? = settings.get(KEY_BASELINE)?.toLongOrNull()

    private fun noticeNew(room: RoomId, messages: List<ChatMessage>) {
        val me = our ?: return
        // A room we have no mark for yet is judged against the login
        // baseline: older than login is history, newer is news.
        val result = NewMessages.diff(messages, seen(room) ?: baseline(), me)
        result.newMark?.let { setSeen(room, it) }
        if (result.fresh.isEmpty()) return
        // The room on screen is read as it arrives; no notification for it.
        if (activeRoom.value == room) return
        val nicknames = _listing.value?.nicknames.orEmpty()
        val title = roomTitle(room)
        result.fresh.forEach { m ->
            _newMessages.tryEmit(NewMessage(room, title, m, Names.display(m.author, nicknames, me)))
        }
    }

    fun roomTitle(room: RoomId): String = when (room) {
        is RoomId.Space -> _listing.value?.spaces?.firstOrNull { it.id == room.id }?.name ?: "Space"
        is RoomId.Dm -> Names.display(room.peer, _listing.value?.nicknames.orEmpty(), our)
    }
}
