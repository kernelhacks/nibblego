package com.nibbletec.assist

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.hardware.display.DisplayManager
import android.os.SystemClock
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.text.TextUtils
import android.util.DisplayMetrics
import android.view.Display
import android.view.View
import org.json.JSONObject
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * Dibuja las marcas del técnico encima de toda la pantalla.
 * Es la misma lógica que public/js/annotate.js. Solo se usa desde el hilo principal.
 */
class MarksView(context: Context) : View(context) {

    private data class TrailPoint(val x: Float, val y: Float, val t: Long)

    private val anns = ArrayList<Ann>()
    private var draft: Ann? = null
    private var caption = ""
    private val trail = ArrayDeque<TrailPoint>()
    private var pointerVisible = false
    private var pointerX = 0f
    private var pointerY = 0f

    private val density = resources.displayMetrics.density
    private val location = IntArray(2)
    private var screenW = 0
    private var screenH = 0

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeJoin = Paint.Join.ROUND
        strokeCap = Paint.Cap.ROUND
    }
    private val textPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    }
    private val path = Path()
    private val rect = RectF()
    private val rect2 = RectF()

    // ------------------------------------------------------------------
    // Mensajes del técnico
    // ------------------------------------------------------------------

    fun handle(m: JSONObject) {
        val now = SystemClock.uptimeMillis()
        when (m.optString("op")) {
            "add" -> parseAnn(m.optJSONObject("ann"))?.let { a ->
                a.t0 = now
                anns.removeAll { it.id == a.id }
                anns.add(a)
                if (draft?.id == a.id) draft = null
            }
            "remove" -> {
                val id = m.optString("id")
                anns.removeAll { it.id == id }
            }
            "clear" -> {
                anns.clear()
                draft = null
            }
            "draft" -> draft = parseAnn(m.optJSONObject("ann"))?.also { it.t0 = Long.MIN_VALUE / 2 }
            "pointer" -> {
                if (m.optBoolean("hide")) {
                    pointerVisible = false
                } else {
                    val x = m.optDouble("x", Double.NaN)
                    val y = m.optDouble("y", Double.NaN)
                    if (!x.isNaN() && !y.isNaN()) {
                        pointerX = x.toFloat()
                        pointerY = y.toFloat()
                        pointerVisible = true
                        trail.addLast(TrailPoint(pointerX, pointerY, now))
                        while (trail.size > 60) trail.removeFirst()
                    }
                }
            }
            "sync" -> {
                anns.clear()
                draft = null
                val arr = m.optJSONArray("anns")
                if (arr != null) {
                    for (i in 0 until arr.length()) {
                        parseAnn(arr.optJSONObject(i))?.let { a ->
                            a.t0 = now - 1000
                            anns.add(a)
                        }
                    }
                }
                caption = m.optString("caption", "").take(200)
            }
        }
        invalidate()
    }

    fun setCaption(text: String) {
        caption = text.take(200)
        invalidate()
    }

    fun hidePointer() {
        pointerVisible = false
        trail.clear()
        invalidate()
    }

    /** Tamaño real de la pantalla: la captura cubre la pantalla completa. */
    fun refreshDisplay() {
        val dm = DisplayMetrics()
        val display = context.getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
        @Suppress("DEPRECATION")
        display.getRealMetrics(dm)
        screenW = dm.widthPixels
        screenH = dm.heightPixels
        invalidate()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        refreshDisplay()
    }

    // De coordenadas normalizadas a píxeles de esta vista.
    private fun mx(nx: Float) = nx * screenW - location[0]
    private fun my(ny: Float) = ny * screenH - location[1]

    private fun withAlpha(color: Int, alpha: Float): Int =
        (color and 0x00FFFFFF) or ((alpha.coerceIn(0f, 1f) * 255).toInt() shl 24)

    // ------------------------------------------------------------------
    // Dibujo
    // ------------------------------------------------------------------

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (screenW == 0) refreshDisplay()
        getLocationOnScreen(location)
        val now = SystemClock.uptimeMillis()
        anns.removeAll { it is PenAnn && it.ttl > 0 && now - it.t0 > it.ttl }

        val u = (screenW * 0.0028f).coerceIn(2.5f * density, 7f * density)
        val current = draft
        val list: List<Ann> = if (current != null) anns + current else anns

        val spots = list.filter { it is BoxAnn && it.spot }.map { it as BoxAnn }
        if (spots.isNotEmpty()) drawSpots(canvas, spots, u, now)
        for (a in list) {
            when (a) {
                is BoxAnn -> if (!a.spot) drawBox(canvas, a, u, now)
                is ArrowAnn -> drawArrow(canvas, a, u)
                is PenAnn -> drawPen(canvas, a, u, now, isDraft = a === current)
                is ClickAnn -> drawClick(canvas, a, u, now)
            }
        }
        drawPointer(canvas, u, now)
        if (caption.isNotBlank()) drawCaption(canvas)

        // Las marcas animadas (clic, estela, trazos que se borran) necesitan redibujarse.
        if (list.isNotEmpty() || trail.isNotEmpty() || pointerVisible) postInvalidateOnAnimation()
    }

    /** Trazo con halo oscuro + color, visible sobre fondos claros y oscuros. */
    private fun halo(canvas: Canvas, p: Path, color: Int, lw: Float, alpha: Float = 1f) {
        stroke.shader = null
        stroke.strokeWidth = lw + max(2f, lw * 0.9f)
        stroke.color = Color.argb((0.55f * alpha * 255).toInt(), 10, 15, 22)
        canvas.drawPath(p, stroke)
        stroke.strokeWidth = lw
        stroke.color = withAlpha(color, alpha)
        canvas.drawPath(p, stroke)
    }

    private fun attention(canvas: Canvas, a: Ann, box: RectF, u: Float, now: Long) {
        val age = now - a.t0
        if (age < 0 || age > 700) return
        val p = age / 700f
        val grow = u * 2 + p * u * 9
        rect2.set(box.left - grow, box.top - grow, box.right + grow, box.bottom + grow)
        stroke.strokeWidth = u * 0.8f
        stroke.color = withAlpha(a.color, (1 - p) * 0.9f)
        canvas.drawRoundRect(rect2, u * 3 + grow, u * 3 + grow, stroke)
    }

    private fun boxRect(a: BoxAnn) {
        rect.set(mx(a.x), my(a.y), mx(a.x + a.w), my(a.y + a.h))
    }

    private fun drawBox(canvas: Canvas, a: BoxAnn, u: Float, now: Long) {
        boxRect(a)
        val r = u * 2.2f
        path.reset()
        path.addRoundRect(rect, r, r, Path.Direction.CW)
        fill.color = withAlpha(a.color, 0.13f)
        canvas.drawPath(path, fill)
        halo(canvas, path, a.color, u)
        attention(canvas, a, rect, u, now)
    }

    private fun drawSpots(canvas: Canvas, spots: List<BoxAnn>, u: Float, now: Long) {
        val r = u * 2.2f
        path.reset()
        path.fillType = Path.FillType.EVEN_ODD
        path.addRect(0f, 0f, width.toFloat(), height.toFloat(), Path.Direction.CW)
        for (s in spots) {
            boxRect(s)
            path.addRoundRect(rect, r, r, Path.Direction.CW)
        }
        fill.color = Color.argb(158, 6, 10, 16)
        canvas.drawPath(path, fill)
        path.fillType = Path.FillType.WINDING
        for (s in spots) {
            boxRect(s)
            stroke.strokeWidth = max(1f, u * 0.5f)
            stroke.color = withAlpha(s.color, 0.9f)
            canvas.drawRoundRect(rect, r, r, stroke)
            attention(canvas, s, rect, u, now)
        }
    }

    private fun drawArrow(canvas: Canvas, a: ArrowAnn, u: Float) {
        val x1 = mx(a.x1)
        val y1 = my(a.y1)
        val x2 = mx(a.x2)
        val y2 = my(a.y2)
        val len = hypot(x2 - x1, y2 - y1)
        if (len < 2f) return
        val lw = u * 1.3f
        val head = min(len * 0.6f, max(u * 6f, 14f))
        val ang = atan2(y2 - y1, x2 - x1)
        path.reset()
        path.moveTo(x1, y1)
        path.lineTo(x2 - cos(ang) * head * 0.8f, y2 - sin(ang) * head * 0.8f)
        halo(canvas, path, a.color, lw)
        path.reset()
        path.moveTo(x2, y2)
        path.lineTo(x2 - head * cos(ang - 0.45f), y2 - head * sin(ang - 0.45f))
        path.lineTo(x2 - head * cos(ang + 0.45f), y2 - head * sin(ang + 0.45f))
        path.close()
        stroke.strokeWidth = max(2f, lw * 0.9f)
        stroke.color = Color.argb(140, 10, 15, 22)
        canvas.drawPath(path, stroke)
        fill.color = a.color
        canvas.drawPath(path, fill)
    }

    private fun drawPen(canvas: Canvas, a: PenAnn, u: Float, now: Long, isDraft: Boolean) {
        val n = a.pts.size / 2
        if (n < 2) return
        var alpha = 1f
        if (!isDraft && a.ttl > 0) {
            alpha = ((a.ttl - (now - a.t0)) / 1200f).coerceIn(0f, 1f)
            if (alpha <= 0f) return
        }
        path.reset()
        path.moveTo(mx(a.pts[0]), my(a.pts[1]))
        for (i in 1 until n - 1) {
            val px = mx(a.pts[i * 2])
            val py = my(a.pts[i * 2 + 1])
            val nx = mx(a.pts[(i + 1) * 2])
            val ny = my(a.pts[(i + 1) * 2 + 1])
            path.quadTo(px, py, (px + nx) / 2, (py + ny) / 2)
        }
        path.lineTo(mx(a.pts[(n - 1) * 2]), my(a.pts[(n - 1) * 2 + 1]))
        halo(canvas, path, a.color, u * 1.1f, alpha)
    }

    private fun drawClick(canvas: Canvas, a: ClickAnn, u: Float, now: Long) {
        val x = mx(a.x)
        val y = my(a.y)
        val r0 = max(9f, u * 3.6f)
        val period = 1500L
        val age = max(0L, now - a.t0)
        for (k in 0..1) {
            val p = ((age + k * period / 2) % period) / period.toFloat()
            stroke.strokeWidth = max(1.5f, u * 0.7f)
            stroke.color = withAlpha(a.color, (1 - p) * 0.85f)
            canvas.drawCircle(x, y, r0 * (0.9f + p * 1.9f), stroke)
        }
        fill.color = a.color
        canvas.drawCircle(x, y, r0 * 0.55f, fill)
        stroke.strokeWidth = max(1.5f, u * 0.5f)
        stroke.color = Color.WHITE
        canvas.drawCircle(x, y, r0 * 0.55f, stroke)
        if (a.n > 0) {
            val br = r0 * 0.78f
            val bx = x + r0 * 1.05f
            val by = y - r0 * 1.05f
            fill.color = Color.WHITE
            canvas.drawCircle(bx, by, br, fill)
            stroke.strokeWidth = max(1.5f, u * 0.45f)
            stroke.color = a.color
            canvas.drawCircle(bx, by, br, stroke)
            textPaint.color = 0xFF16212E.toInt()
            textPaint.textSize = br * 1.25f
            textPaint.textAlign = Paint.Align.CENTER
            val baseline = by - (textPaint.ascent() + textPaint.descent()) / 2
            canvas.drawText(a.n.toString(), bx, baseline, textPaint)
        }
    }

    private fun drawPointer(canvas: Canvas, u: Float, now: Long) {
        while (trail.isNotEmpty() && now - trail.first().t > 650) trail.removeFirst()
        val col = Palette.red
        if (trail.size > 1) {
            for (i in 1 until trail.size) {
                val a = trail[i - 1]
                val b = trail[i]
                val life = 1 - (now - b.t) / 650f
                stroke.strokeWidth = max(1.5f, u * 1.6f * life)
                stroke.color = withAlpha(col, life * 0.6f)
                canvas.drawLine(mx(a.x), my(a.y), mx(b.x), my(b.y), stroke)
            }
        }
        if (!pointerVisible) return
        val x = mx(pointerX)
        val y = my(pointerY)
        val r = max(6f, u * 2.3f)
        fill.shader = RadialGradient(x, y, r * 2.6f, withAlpha(col, 0.55f), withAlpha(col, 0f), Shader.TileMode.CLAMP)
        canvas.drawCircle(x, y, r * 2.6f, fill)
        fill.shader = null
        fill.color = col
        canvas.drawCircle(x, y, r, fill)
        stroke.strokeWidth = max(1.5f, r * 0.28f)
        stroke.color = Color.WHITE
        canvas.drawCircle(x, y, r, stroke)
    }

    private fun drawCaption(canvas: Canvas) {
        val size = (min(width, (height * 1.6f).toInt()) * 0.04f).coerceIn(14f * density, 22f * density)
        textPaint.textSize = size
        textPaint.color = Color.WHITE
        textPaint.textAlign = Paint.Align.LEFT
        val padX = size * 0.9f
        val padY = size * 0.55f
        val maxW = max(1, (width * 0.86f - padX * 2).toInt())
        val layout = StaticLayout.Builder.obtain(caption, 0, caption.length, textPaint, maxW)
            .setAlignment(Layout.Alignment.ALIGN_CENTER)
            .setMaxLines(3)
            .setEllipsize(TextUtils.TruncateAt.END)
            .build()
        var textW = 0f
        for (i in 0 until layout.lineCount) textW = max(textW, layout.getLineWidth(i))
        val boxW = min(width * 0.9f, textW + padX * 2)
        val boxH = layout.height + padY * 2
        val left = (width - boxW) / 2
        val top = height - boxH - 96f * density // por encima de la barra de navegación
        rect.set(left, top, left + boxW, top + boxH)
        fill.color = Color.argb(240, 22, 33, 46)
        canvas.drawRoundRect(rect, size * 0.6f, size * 0.6f, fill)
        stroke.strokeWidth = density
        stroke.color = Color.argb(46, 255, 255, 255)
        canvas.drawRoundRect(rect, size * 0.6f, size * 0.6f, stroke)
        canvas.save()
        canvas.translate((width - maxW) / 2f, top + padY)
        layout.draw(canvas)
        canvas.restore()
    }
}
