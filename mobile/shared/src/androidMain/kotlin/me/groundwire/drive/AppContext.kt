package me.groundwire.drive

import android.content.Context

/** The application context, set once by [ChatApplication] for code with no Context of its own. */
object AppContext {
    lateinit var app: Context
        private set

    fun init(context: Context) {
        app = context.applicationContext
    }
}
