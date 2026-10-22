package com.nibbletec.assist

import org.json.JSONArray
import org.json.JSONObject

/** Colores de las marcas: los mismos nombres que usa la consola web. */
object Palette {
    private val colors = mapOf(
        "red" to 0xFFFF3D57.toInt(),
        "amber" to 0xFFFFB020.toInt(),
        "green" to 0xFF1FD18B.toInt(),
        "blue" to 0xFF3D8BFF.toInt(),
    )
    val red: Int = colors.getValue("red")

    fun of(name: String?): Int = colors[name] ?: red
}

/** Coordenadas normalizadas (0..1) respecto a la pantalla compartida. */
sealed class Ann(val id: String, val color: Int) {
    /** Momento en que llegó (SystemClock.uptimeMillis), para animaciones y caducidad. */
    var t0: Long = 0L
}

class BoxAnn(id: String, color: Int, val x: Float, val y: Float, val w: Float, val h: Float, val spot: Boolean) :
    Ann(id, color)

class ArrowAnn(id: String, color: Int, val x1: Float, val y1: Float, val x2: Float, val y2: Float) : Ann(id, color)

/** pts = x0, y0, x1, y1, … */
class PenAnn(id: String, color: Int, val pts: FloatArray, val ttl: Long) : Ann(id, color)

class ClickAnn(id: String, color: Int, val x: Float, val y: Float, val n: Int) : Ann(id, color)

private const val PEN_TTL = 12_000L

/** Valida una marca recibida por la red (equivalente a sanitizeAnn en annotate.js). */
fun parseAnn(o: JSONObject?): Ann? {
    if (o == null) return null
    val id = o.optString("id")
    if (id.isEmpty() || id.length > 40) return null
    val color = Palette.of(o.optString("color"))

    fun num(key: String): Float? {
        val v = o.opt(key)
        return if (v is Number) v.toFloat().coerceIn(-0.5f, 1.5f) else null
    }

    return when (o.optString("type")) {
        "rect", "spot" -> {
            val x = num("x") ?: return null
            val y = num("y") ?: return null
            val w = num("w") ?: return null
            val h = num("h") ?: return null
            BoxAnn(id, color, x, y, w, h, spot = o.optString("type") == "spot")
        }
        "arrow" -> {
            val x1 = num("x1") ?: return null
            val y1 = num("y1") ?: return null
            val x2 = num("x2") ?: return null
            val y2 = num("y2") ?: return null
            ArrowAnn(id, color, x1, y1, x2, y2)
        }
        "click" -> {
            val x = num("x") ?: return null
            val y = num("y") ?: return null
            val n = o.optInt("n", 0).let { if (it in 1..99) it else 0 }
            ClickAnn(id, color, x, y, n)
        }
        "pen" -> {
            val arr: JSONArray = o.optJSONArray("pts") ?: return null
            if (arr.length() > 2000) return null
            val pts = FloatArray(arr.length() * 2)
            for (i in 0 until arr.length()) {
                val p = arr.optJSONArray(i) ?: return null
                val px = p.opt(0)
                val py = p.opt(1)
                if (px !is Number || py !is Number) return null
                pts[i * 2] = px.toFloat().coerceIn(-0.5f, 1.5f)
                pts[i * 2 + 1] = py.toFloat().coerceIn(-0.5f, 1.5f)
            }
            val ttl = if (o.has("ttl")) o.optLong("ttl", PEN_TTL).coerceIn(0L, 60_000L) else PEN_TTL
            PenAnn(id, color, pts, ttl)
        }
        else -> null
    }
}
