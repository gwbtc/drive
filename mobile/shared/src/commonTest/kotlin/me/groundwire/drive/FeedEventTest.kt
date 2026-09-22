package me.groundwire.drive

import me.groundwire.drive.drive.FeedEvent
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class FeedEventTest {
    @Test
    fun theThreeShapesDriveSends() {
        assertEquals(FeedEvent.Listing, FeedEvent.parse("""{"type":"listing"}"""))
        assertEquals(FeedEvent.SpaceChat("0v3gr.mqs9e"), FeedEvent.parse("""{"type":"space-chat","space":"0v3gr.mqs9e"}"""))
        assertEquals(FeedEvent.Dm("~zod"), FeedEvent.parse("""{"type":"dm","peer":"~zod"}"""))
    }

    @Test
    fun unknownAndMalformed() {
        assertEquals(FeedEvent.Other("snapshot"), FeedEvent.parse("""{"type":"snapshot","id":"0v1"}"""))
        assertNull(FeedEvent.parse("not json"))
        assertNull(FeedEvent.parse("""{"nope":1}"""))
    }
}
