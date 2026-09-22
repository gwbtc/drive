package me.groundwire.drive

import kotlinx.serialization.json.Json
import me.groundwire.drive.drive.DmRow
import me.groundwire.drive.drive.DmThread
import me.groundwire.drive.drive.Listing
import me.groundwire.drive.drive.SpaceChat
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DriveJsonTest {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    @Test
    fun listingParsesSpacesNicknamesAndUnread() {
        val l = json.decodeFromString<Listing>(Fixtures.listing)
        assertEquals(1, l.spaces.size)
        val sp = l.spaces[0]
        assertEquals("Groundwire", sp.name)
        assertEquals("0v3gr.mqs9e", sp.id)
        assertEquals(2, sp.unread)
        assertEquals(false, sp.joined)
        assertEquals(6, sp.members)
        assertEquals("Trent", l.myNickname)
        assertEquals("Robin", l.nicknames["~nisfus-dosmet-mactyn-signul--motbur-posbep-tolpun-daplyd"])
        assertEquals(0, l.dmUnread)
        assertTrue(l.spaceInvites.isEmpty())
    }

    @Test
    fun listingParsesInvites() {
        val l = json.decodeFromString<Listing>(Fixtures.listingWithInvite)
        assertEquals(1, l.spaceInvites.size)
        assertEquals("editor", l.spaceInvites[0].role)
        assertEquals("Groundwire", l.spaceInvites[0].name)
        assertTrue(l.spaces.isEmpty())
    }

    @Test
    fun dmInboxParses() {
        val rows = json.decodeFromString<List<DmRow>>(Fixtures.dms)
        assertEquals(2, rows.size)
        assertEquals("~fossyd-hadter-simred-lasmyr--bonseg-molryc-nibbec-daplyd", rows[0].peer)
        assertEquals(1789575681810, rows[0].lastAt)
        assertEquals("", rows[1].lastAuthor)
    }

    @Test
    fun spaceChatParsesOldestFirst() {
        val c = json.decodeFromString<SpaceChat>(Fixtures.chat)
        assertEquals(3, c.messages.size)
        assertEquals("Hello everyone!", c.messages[0].text)
        assertTrue(c.messages[0].at < c.messages[2].at)
        assertEquals(1789575629841, c.read)
    }

    @Test
    fun dmThreadParses() {
        val t = json.decodeFromString<DmThread>(Fixtures.dm)
        assertEquals(1, t.messages.size)
        assertEquals("~fossyd-hadter-simred-lasmyr--bonseg-molryc-nibbec-daplyd", t.peer)
    }
}
