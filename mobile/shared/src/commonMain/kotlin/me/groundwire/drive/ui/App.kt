package me.groundwire.drive.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import me.groundwire.drive.drive.RoomId
import me.groundwire.drive.store.ChatStore

/** Which screen is up. Two levels deep is the whole app, so no nav library. */
private sealed interface Screen {
    data object Home : Screen
    data class Room(val id: RoomId) : Screen
}

/**
 * The whole UI: login when there is no session, else the room list with
 * a room on top of it. A notification tap sets [ChatStore.openRequest]
 * and lands here.
 */
@Composable
fun App(store: ChatStore) {
    GwTheme {
        Surface(color = MaterialTheme.colorScheme.background) {
            val session by store.session.collectAsState()
            var screen by remember { mutableStateOf<Screen>(Screen.Home) }
            val request by store.openRequest.collectAsState()

            LaunchedEffect(request) {
                val r = request ?: return@LaunchedEffect
                screen = Screen.Room(r)
                store.openRequest.value = null
            }

            if (session == null) {
                screen = Screen.Home
                LoginScreen(store)
                return@Surface
            }

            when (val s = screen) {
                Screen.Home -> HomeScreen(
                    store = store,
                    onOpen = { screen = Screen.Room(it) },
                )
                is Screen.Room -> {
                    PlatformBackHandler(enabled = true) { screen = Screen.Home }
                    RoomScreen(
                        store = store,
                        room = s.id,
                        onBack = { screen = Screen.Home },
                    )
                }
            }
        }
    }
}
