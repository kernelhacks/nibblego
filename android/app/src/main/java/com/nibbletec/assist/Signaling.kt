package com.nibbletec.assist

import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject

/**
 * WebSocket con el mismo protocolo que el cliente web:
 * join → joined / peer / answer / ice / ann / caption / snapshot / ended.
 * Cada instancia es una conexión; para reconectar se crea otra.
 */
class Signaling(
    private val code: String,
    private val token: String,
    private val handleMessage: (Signaling, JSONObject) -> Unit,
    private val handleClosed: (Signaling, Int) -> Unit,
) {
    private var ws: WebSocket? = null

    @Volatile
    private var closedNotified = false

    fun connect() {
        val wsUrl = Api.baseUrl.replaceFirst("http", "ws") + "/ws"
        val request = Request.Builder()
            .url(wsUrl)
            .header("Origin", Api.baseUrl) // el servidor exige un Origin de su propio dominio
            .header("User-Agent", Api.userAgent)
            .build()
        ws = Api.client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val join = JSONObject()
                    .put("t", "join")
                    .put("role", "client")
                    .put("code", code)
                    .put("token", token)
                webSocket.send(join.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val m = runCatching { JSONObject(text) }.getOrNull() ?: return
                handleMessage(this@Signaling, m)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
                notifyClosed(code)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                notifyClosed(code)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                notifyClosed(-1)
            }
        })
    }

    private fun notifyClosed(code: Int) {
        if (closedNotified) return
        closedNotified = true
        handleClosed(this, code)
    }

    fun send(m: JSONObject) {
        ws?.send(m.toString())
    }

    fun close() {
        closedNotified = true
        ws?.close(1000, null)
        ws = null
    }
}
