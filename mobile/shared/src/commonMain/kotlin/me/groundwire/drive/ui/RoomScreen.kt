package me.groundwire.drive.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import me.groundwire.drive.Names
import me.groundwire.drive.TimeFormat
import me.groundwire.drive.drive.ChatMessage
import me.groundwire.drive.drive.RoomId
import me.groundwire.drive.store.ChatStore

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomScreen(store: ChatStore, room: RoomId, onBack: () -> Unit) {
    val rooms by store.rooms.collectAsState()
    val listing by store.listing.collectAsState()
    val messages = rooms[room.key].orEmpty()
    val nicknames = listing?.nicknames.orEmpty()
    val our = store.our
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    var draft by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val title = store.roomTitle(room)
    val subtitle = when (room) {
        is RoomId.Space -> listing?.spaces?.firstOrNull { it.id == room.id }?.let { sp ->
            if (sp.joined) "hosted by ${Names.display(sp.host, nicknames, our)}" else "you host this space"
        } ?: ""
        is RoomId.Dm -> room.peer
    }

    // Reading a room: fetch it, tell the ship it is read, and keep it
    // marked read for as long as it is on screen.
    DisposableEffect(room) {
        store.activeRoom.value = room
        onDispose { if (store.activeRoom.value == room) store.activeRoom.value = null }
    }
    LaunchedEffect(room) {
        runCatching { store.refreshRoom(room); store.markRead(room) }
            .onFailure { error = it.message }
    }
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(0)
            runCatching { store.markRead(room) }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
                title = {
                    Column {
                        Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (subtitle.isNotEmpty()) {
                            Text(
                                subtitle,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                },
            )
        },
        bottomBar = {
            Column(Modifier.imePadding().navigationBarsPadding()) {
                error?.let {
                    Text(
                        it,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(horizontal = 16.dp),
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.Bottom,
                ) {
                    OutlinedTextField(
                        value = draft,
                        onValueChange = { draft = it },
                        placeholder = { Text("Message") },
                        modifier = Modifier.weight(1f),
                        maxLines = 5,
                    )
                    Spacer(Modifier.width(4.dp))
                    IconButton(
                        enabled = draft.isNotBlank() && !sending,
                        onClick = {
                            val text = draft.trim()
                            if (text.isEmpty()) return@IconButton
                            sending = true
                            error = null
                            scope.launch {
                                try {
                                    store.send(room, text)
                                    draft = ""
                                } catch (e: Exception) {
                                    error = e.message ?: "could not send"
                                } finally {
                                    sending = false
                                }
                            }
                        },
                    ) { Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send") }
                }
            }
        },
    ) { padding ->
        // Newest at the bottom: the list is reversed and fed newest-first.
        val reversed = remember(messages) { messages.asReversed() }
        LazyColumn(
            state = listState,
            reverseLayout = true,
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            itemsIndexed(reversed, key = { _, m -> m.id }) { index, m ->
                // The message that comes before this one in time is the next
                // item in the reversed list.
                val previous = reversed.getOrNull(index + 1)
                val mine = m.author == our
                val newDay = previous == null || TimeFormat.day(previous.at) != TimeFormat.day(m.at)
                val sameAuthor = previous != null && previous.author == m.author && !newDay && m.at - previous.at < 5 * 60_000
                Column(Modifier.fillMaxWidth()) {
                    if (newDay) DaySeparator(TimeFormat.day(m.at))
                    Bubble(m, mine = mine, showAuthor = !sameAuthor && !mine, author = Names.display(m.author, nicknames, our))
                }
            }
        }
    }
}

@Composable
private fun DaySeparator(text: String) {
    Box(Modifier.fillMaxWidth().padding(vertical = 10.dp), contentAlignment = Alignment.Center) {
        Text(
            text,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun Bubble(m: ChatMessage, mine: Boolean, showAuthor: Boolean, author: String) {
    val shape = RoundedCornerShape(
        topStart = 16.dp, topEnd = 16.dp,
        bottomStart = if (mine) 16.dp else 4.dp,
        bottomEnd = if (mine) 4.dp else 16.dp,
    )
    val bg = if (mine) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.secondaryContainer
    val fg = if (mine) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 320.dp)
                .background(bg, shape)
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            if (showAuthor) {
                Text(
                    author,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary,
                )
                Spacer(Modifier.height(2.dp))
            }
            Text(m.text, color = fg, style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(2.dp))
            Text(
                TimeFormat.short(m.at),
                style = MaterialTheme.typography.labelSmall,
                color = fg.copy(alpha = 0.6f),
                modifier = Modifier.align(Alignment.End),
            )
        }
    }
}
