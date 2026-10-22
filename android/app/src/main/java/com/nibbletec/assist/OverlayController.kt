package com.nibbletec.assist

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.input.InputManager
import android.os.Build
import android.provider.Settings
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import kotlin.math.min

/**
 * Ventanas superpuestas sobre otras apps:
 *  - las marcas del técnico (no reciben toques: el cliente sigue usando su teléfono);
 *  - una pastilla arriba con "Compartiendo · Detener".
 * Requiere el permiso "Mostrar sobre otras apps". Solo se usa desde el hilo principal.
 */
class OverlayController(private val ctx: Context, private val onStop: () -> Unit) {
    private val wm = ctx.getSystemService(WindowManager::class.java)
    private val density = ctx.resources.displayMetrics.density

    val marks = MarksView(ctx)
    private var pill: View? = null

    var showing = false
        private set

    fun show(): Boolean {
        if (showing) return true
        if (!Settings.canDrawOverlays(ctx)) return false
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        )
        // Android 12+ bloquea los toques que atraviesan ventanas de otras apps con opacidad > 0.8.
        lp.alpha = maxPassThroughAlpha()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) lp.fitInsetsTypes = 0
        lp.title = "Nibbletec Assist"
        try {
            wm.addView(marks, lp)
        } catch (e: Exception) {
            return false
        }
        val p = buildPill()
        try {
            wm.addView(p, pillParams())
            pill = p
        } catch (e: Exception) {
            // Sin pastilla seguimos mostrando las marcas; se puede detener desde la notificación.
        }
        showing = true
        return true
    }

    fun hide() {
        if (!showing) return
        runCatching { wm.removeView(marks) }
        pill?.let { runCatching { wm.removeView(it) } }
        pill = null
        showing = false
    }

    private fun maxPassThroughAlpha(): Float =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            min(0.8f, ctx.getSystemService(InputManager::class.java).maximumObscuringOpacityForTouch)
        } else {
            0.8f
        }

    @SuppressLint("SetTextI18n")
    private fun buildPill(): View {
        val label = "●  " + ctx.getString(R.string.pill_sharing) + "   " + ctx.getString(R.string.pill_stop)
        val text = SpannableString(label).apply {
            setSpan(ForegroundColorSpan(Palette.red), 0, 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            val stopStart = label.length - ctx.getString(R.string.pill_stop).length
            setSpan(ForegroundColorSpan(0xFFFFB3BB.toInt()), stopStart, label.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        return TextView(ctx).apply {
            this.text = text
            setTextColor(Color.WHITE)
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            val h = (14 * density).toInt()
            val v = (7 * density).toInt()
            setPadding(h, v, h, v)
            background = GradientDrawable().apply {
                cornerRadius = 100 * density
                setColor(Color.argb(235, 22, 33, 46))
            }
            contentDescription = ctx.getString(R.string.stop_btn)
            setOnClickListener { onStop() }
        }
    }

    private fun pillParams(): WindowManager.LayoutParams {
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT,
        )
        lp.gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
        lp.y = statusBarHeight() + (6 * density).toInt()
        lp.title = "Nibbletec Assist control"
        return lp
    }

    @SuppressLint("DiscouragedApi", "InternalInsetResource")
    private fun statusBarHeight(): Int {
        val id = ctx.resources.getIdentifier("status_bar_height", "dimen", "android")
        return if (id > 0) ctx.resources.getDimensionPixelSize(id) else (24 * density).toInt()
    }
}
