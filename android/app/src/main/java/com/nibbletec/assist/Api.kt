package com.nibbletec.assist

import android.os.Build
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.PeerConnection
import java.util.concurrent.TimeUnit

/** Llamadas HTTP al servidor de Nibbletec Assist (mismas que usa la página web). */
object Api {
    val baseUrl: String = BuildConfig.SERVER_URL.trimEnd('/')

    val userAgent: String =
        "NibbletecAssist/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE}; ${Build.MANUFACTURER} ${Build.MODEL})"

    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    class ApiError(val error: String, val status: Int) : Exception(error)

    data class Terms(val html: String, val version: String)

    data class SessionInfo(
        val code: String,
        val techName: String,
        val lang: String,
        val terms: Map<String, Terms>,
    )

    private fun call(request: Request): JSONObject {
        client.newCall(request).execute().use { res ->
            val body = res.body?.string().orEmpty()
            val json = runCatching { JSONObject(body) }.getOrElse { JSONObject() }
            if (!res.isSuccessful) throw ApiError(json.optString("error", "http_${res.code}"), res.code)
            return json
        }
    }

    private fun request(path: String) = Request.Builder()
        .url(baseUrl + path)
        .header("User-Agent", userAgent)

    /** Datos públicos de la sesión: técnico, idioma y términos. */
    fun session(code: String): SessionInfo {
        val o = call(request("/api/s/$code").build())
        val terms = mutableMapOf<String, Terms>()
        val t = o.optJSONObject("terms")
        if (t != null) {
            for (lang in t.keys()) {
                val v = t.optJSONObject(lang) ?: continue
                terms[lang] = Terms(v.optString("html"), v.optString("version"))
            }
        }
        return SessionInfo(
            code = o.optString("code", code),
            techName = o.optString("techName"),
            lang = o.optString("lang", "es"),
            terms = terms,
        )
    }

    /** Registra la aceptación de los términos y devuelve el token del cliente. */
    fun accept(code: String, name: String, lang: String, version: String): String {
        val payload = JSONObject()
            .put("name", name)
            .put("lang", lang)
            .put("version", version)
            .put("agree", true)
        val req = request("/api/s/$code/accept")
            .post(payload.toString().toRequestBody("application/json".toMediaType()))
            .build()
        return call(req).getString("token")
    }

    /** Servidores STUN/TURN con credenciales temporales. */
    fun iceServers(code: String, token: String): List<PeerConnection.IceServer> {
        val req = request("/api/ice")
            .header("Authorization", "Bearer $token")
            .header("X-Session-Code", code)
            .build()
        val arr = call(req).optJSONArray("iceServers") ?: return emptyList()
        val out = mutableListOf<PeerConnection.IceServer>()
        for (i in 0 until arr.length()) {
            val s = arr.optJSONObject(i) ?: continue
            val urls = when (val u = s.opt("urls")) {
                is JSONArray -> (0 until u.length()).map { u.getString(it) }
                is String -> listOf(u)
                else -> emptyList()
            }
            if (urls.isEmpty()) continue
            out += PeerConnection.IceServer.builder(urls)
                .setUsername(s.optString("username", ""))
                .setPassword(s.optString("credential", ""))
                .createIceServer()
        }
        return out
    }
}
