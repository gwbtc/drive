package me.groundwire.drive.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Badge
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import me.groundwire.drive.Names
import me.groundwire.drive.TimeFormat
import me.groundwire.drive.drive.RoomId
import me.groundwire.drive.store.ChatStore
import me.groundwire.drive.store.Connection

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(store: ChatStore, onOpen: (RoomId) -> Unit) {
    val listing by store.listing.collectAsState()
    val dms by store.dms.collectAsState()
    val connection by store.connection.collectAsState()
    val session by store.session.collectAsState()
    val scope = rememberCoroutineScope()
    var menu by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        store.activeRoom.value = null
        store.start()
        runCatching { store.refreshListing(); store.refreshDms() }
            .onFailure { error = it.message }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Groundwire Drive")
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            ConnectionDot(connection)
                            Spacer(Modifier.width(6.dp))
                            Text(
                                text = when (val c = connection) {
                                    Connection.Live -> session?.ship?.let { Names.short(it) } ?: "connected"
                                    Connection.Connecting -> "connecting…"
                                    is Connection.Down -> "offline: ${c.reason}"
                                    Connection.Off -> "off"
                                },
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                },
                actions = {
                    IconButton(onClick = {
                        scope.launch {
                            runCatching { store.refreshAll() }.onFailure { error = it.message }
                        }
                    }) { Icon(Icons.Default.Refresh, contentDescription = "Refresh") }
                    IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, contentDescription = "Menu") }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(
                            text = { Text("Log out") },
                            onClick = { menu = false; store.logout() },
                        )
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(modifier = Modifier.fillMaxSize().padding(padding)) {
            error?.let {
                item {
                    Text(
                        it,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }
            }

            val invites = listing?.spaceInvites.orEmpty()
            if (invites.isNotEmpty()) {
                item { SectionHeader("Invitations") }
                items(invites, key = { "inv:" + it.id }) { inv ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(inv.name, fontWeight = FontWeight.SemiBold)
                            Text(
                                "from ${Names.display(inv.host, listing?.nicknames.orEmpty(), store.our)} · ${inv.role}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        TextButton(onClick = { scope.launch { runCatching { store.declineInvite(inv.id) }.onFailure { error = it.message } } }) { Text("Decline") }
                        TextButton(onClick = { scope.launch { runCatching { store.acceptInvite(inv.id) }.onFailure { error = it.message } } }) { Text("Accept") }
                    }
                }
                item { HorizontalDivider() }
            }

            val spaces = listing?.spaces.orEmpty()
            item { SectionHeader("Spaces") }
            if (spaces.isEmpty()) {
                item { Empty(if (listing == null) "Loading…" else "No spaces yet. Create one in Drive, or accept an invitation.") }
            }
            items(spaces, key = { "space:" + it.id }) { sp ->
                RoomRow(
                    title = sp.name,
                    subtitle = if (sp.joined) "hosted by ${Names.display(sp.host, listing?.nicknames.orEmpty(), store.our)}"
                    else "you host · ${sp.members} members",
                    unread = sp.unread,
                    time = "",
                    onClick = { onOpen(RoomId.Space(sp.id)) },
                )
            }

            item { HorizontalDivider() }
            item { SectionHeader("Direct messages") }
            val threads = dms.filter { it.lastAt > 0 || it.unread > 0 }
            if (threads.isEmpty()) {
                item { Empty("No direct messages yet.") }
            }
            items(threads, key = { "dm:" + it.peer }) { dm ->
                val nicknames = listing?.nicknames.orEmpty()
                RoomRow(
                    title = Names.display(dm.peer, nicknames, null),
                    subtitle = if (dm.lastText.isEmpty()) "" else {
                        val who = if (dm.lastAuthor == store.our) "You" else Names.display(dm.lastAuthor, nicknames, store.our)
                        "$who: ${dm.lastText}"
                    },
                    unread = dm.unread,
                    time = TimeFormat.short(dm.lastAt),
                    onClick = { onOpen(RoomId.Dm(dm.peer)) },
                )
            }
        }
    }
}

@Composable
private fun SectionHeader(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 4.dp),
    )
}

@Composable
private fun Empty(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
    )
}

@Composable
private fun RoomRow(title: String, subtitle: String, unread: Int, time: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                title,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = if (unread > 0) FontWeight.Bold else FontWeight.Normal,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle.isNotEmpty()) {
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Column(horizontalAlignment = Alignment.End) {
            if (time.isNotEmpty()) {
                Text(time, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (unread > 0) {
                Badge { Text(unread.toString()) }
            }
        }
    }
}

@Composable
private fun ConnectionDot(c: Connection) {
    val color = when (c) {
        Connection.Live -> Color(0xFF3DBE5B)
        Connection.Connecting -> Color(0xFFE0B400)
        is Connection.Down -> MaterialTheme.colorScheme.error
        Connection.Off -> MaterialTheme.colorScheme.outline
    }
    Box(Modifier.size(8.dp).background(color, CircleShape))
}
