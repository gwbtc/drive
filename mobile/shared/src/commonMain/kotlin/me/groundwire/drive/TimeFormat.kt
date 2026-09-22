package me.groundwire.drive

import kotlin.time.Clock
import kotlin.time.Instant
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime

object TimeFormat {
    /** "14:05" today, "Mon 14:05" this week, "12 Sep" older, "12 Sep 2025" another year. */
    fun short(epochMillis: Long, now: Long = Clock.System.now().toEpochMilliseconds()): String {
        if (epochMillis <= 0) return ""
        val tz = TimeZone.currentSystemDefault()
        val t = Instant.fromEpochMilliseconds(epochMillis).toLocalDateTime(tz)
        val n = Instant.fromEpochMilliseconds(now).toLocalDateTime(tz)
        val hm = two(t.hour) + ":" + two(t.minute)
        return when {
            t.date == n.date -> hm
            daysBetween(t.date, n.date) < 7 -> t.dayOfWeek.name.take(3).lowercase().replaceFirstChar { it.uppercase() } + " " + hm
            t.year == n.year -> "${t.day} ${month(t.month.ordinal + 1)}"
            else -> "${t.day} ${month(t.month.ordinal + 1)} ${t.year}"
        }
    }

    /** "Today", "Yesterday", "Monday 15 September", used for day separators. */
    fun day(epochMillis: Long, now: Long = Clock.System.now().toEpochMilliseconds()): String {
        val tz = TimeZone.currentSystemDefault()
        val d = Instant.fromEpochMilliseconds(epochMillis).toLocalDateTime(tz).date
        val n = Instant.fromEpochMilliseconds(now).toLocalDateTime(tz).date
        return when (daysBetween(d, n)) {
            0 -> "Today"
            1 -> "Yesterday"
            else -> {
                val dow = d.dayOfWeek.name.lowercase().replaceFirstChar { it.uppercase() }
                val base = "$dow ${d.day} ${monthLong(d.month.ordinal + 1)}"
                if (d.year == n.year) base else "$base ${d.year}"
            }
        }
    }

    private fun daysBetween(a: LocalDate, b: LocalDate): Int =
        (b.toEpochDays() - a.toEpochDays()).toInt()

    private fun two(n: Int) = n.toString().padStart(2, '0')
    private val months = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    private val monthsLong = listOf(
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    )
    private fun month(n: Int) = months[n - 1]
    private fun monthLong(n: Int) = monthsLong[n - 1]
}
