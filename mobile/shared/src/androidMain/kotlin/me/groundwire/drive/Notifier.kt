package me.groundwire.drive

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import me.groundwire.drive.drive.RoomId
import me.groundwire.drive.store.NewMessage

/**
 * One conversation-style notification per room. Each new message is
 * appended to that room's thread; opening the room clears it.
 */
object Notifier {
    const val CHANNEL_MESSAGES = "messages"
    const val CHANNEL_SERVICE = "connection"
    const val ID_SERVICE = 1

    private val threads = mutableMapOf<String, MutableList<NewMessage>>()

    fun manager(context: Context): NotificationManager =
        context.getSystemService(NotificationManager::class.java)

    fun createChannels(context: Context) {
        val nm = manager(context)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_MESSAGES, "Messages", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "New messages in your spaces and direct messages"
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_SERVICE, "Connection", NotificationManager.IMPORTANCE_MIN).apply {
                description = "Keeps the connection to your ship open in the background"
                setShowBadge(false)
            },
        )
    }

    fun newMessage(context: Context, m: NewMessage) {
        val key = m.room.key
        val thread = synchronized(threads) {
            threads.getOrPut(key) { mutableListOf() }.apply {
                add(m)
                while (size > 25) removeAt(0)
            }.toList()
        }
        val me = Person.Builder().setName("You").build()
        val style = NotificationCompat.MessagingStyle(me)
            .setConversationTitle(if (m.room is RoomId.Space) m.roomTitle else null)
            .setGroupConversation(m.room is RoomId.Space)
        thread.forEach { n ->
            val who = Person.Builder().setName(n.authorName).setKey(n.message.author).build()
            style.addMessage(n.message.text, n.message.at, who)
        }
        val open = PendingIntent.getActivity(
            context, key.hashCode(),
            Intent(context, MainActivity::class.java)
                .setAction(Intent.ACTION_VIEW)
                .putExtra(MainActivity.EXTRA_ROOM, key)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_MESSAGES)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setStyle(style)
            .setContentTitle(m.roomTitle)
            .setContentText("${m.authorName}: ${m.message.text}")
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
            .setContentIntent(open)
            .build()
        manager(context).notify(idFor(key), notification)
    }

    fun clear(context: Context, roomKey: String) {
        synchronized(threads) { threads.remove(roomKey) }
        manager(context).cancel(idFor(roomKey))
    }

    // Room ids hash into the positive range above the service id.
    private fun idFor(roomKey: String) = 1000 + (roomKey.hashCode() and 0x7fffffff) % 100_000
}
