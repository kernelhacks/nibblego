package com.nibbletec.assist

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update

/** Estado compartido entre la pantalla (MainActivity) y el servicio que comparte la pantalla. */
object Assist {
    data class Session(
        val code: String,
        val token: String,
        val name: String,
        val techName: String,
    )

    data class Live(
        val sharing: Boolean = false,
        val techPresent: Boolean = false,
        val marksOn: Boolean = false,
        val ended: Boolean = false,
        /** "auth" (hay que aceptar de nuevo), "replaced", "network" */
        val error: String? = null,
    )

    @Volatile
    var session: Session? = null

    val live = MutableStateFlow(Live())

    fun update(block: (Live) -> Live) = live.update(block)
}

/** Recuerda el token de cada sesión para no pedir los términos otra vez al reabrir la app. */
object Prefs {
    private const val FILE = "assist"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun token(ctx: Context, code: String): String? = prefs(ctx).getString("token_$code", null)

    fun name(ctx: Context, code: String): String? = prefs(ctx).getString("name_$code", null)

    fun save(ctx: Context, code: String, token: String, name: String) {
        prefs(ctx).edit().clear().putString("token_$code", token).putString("name_$code", name).apply()
    }

    fun clear(ctx: Context) {
        prefs(ctx).edit().clear().apply()
    }
}
