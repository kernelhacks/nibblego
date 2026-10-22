package com.nibbletec.assist

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.hardware.display.DisplayManager
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.util.DisplayMetrics
import android.util.Log
import android.view.Display
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import org.json.JSONObject
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpParameters
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import kotlin.math.max
import kotlin.math.min

private const val TAG = "NibbletecAssist"

/**
 * Comparte la pantalla con el técnico mientras dure la sesión.
 * Todo lo de WebRTC y la red corre en un hilo propio ("rtc"); las ventanas, en el principal.
 */
class ShareService : Service() {

    companion object {
        private const val ACTION_START = "com.nibbletec.assist.START"
        private const val ACTION_STOP = "com.nibbletec.assist.STOP"
        private const val ACTION_OVERLAY = "com.nibbletec.assist.OVERLAY"
        private const val EXTRA_DATA = "projectionData"
        private const val CHANNEL = "sharing"
        private const val NOTIFICATION_ID = 42
        private const val FPS = 15
        private const val MAX_SIDE = 1280

        /** [data] es el resultado del diálogo de Android para compartir pantalla. */
        fun start(ctx: Context, data: Intent) {
            val i = Intent(ctx, ShareService::class.java).setAction(ACTION_START).putExtra(EXTRA_DATA, data)
            ContextCompat.startForegroundService(ctx, i)
        }

        fun stop(ctx: Context) {
            ctx.startService(Intent(ctx, ShareService::class.java).setAction(ACTION_STOP))
        }

        /** Vuelve a intentar mostrar las marcas (p. ej. tras conceder el permiso). */
        fun refreshOverlay(ctx: Context) {
            ctx.startService(Intent(ctx, ShareService::class.java).setAction(ACTION_OVERLAY))
        }
    }

    private lateinit var worker: HandlerThread
    private lateinit var rtc: Handler
    private val main = Handler(Looper.getMainLooper())

    // Hilo rtc
    private var egl: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var capturer: ScreenCapturerAndroid? = null
    private var textureHelper: SurfaceTextureHelper? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null
    private var pc: PeerConnection? = null
    private var gen = 0
    private val pendingIce = ArrayList<IceCandidate>()
    private var signaling: Signaling? = null
    private var wsRetry = 0
    private var techPresent = false
    private var capW = 0
    private var capH = 0

    // Hilo principal
    private var overlay: OverlayController? = null
    private var started = false

    @Volatile
    private var marksOn = false

    @Volatile
    private var stopping = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        worker = HandlerThread("assist-rtc").also { it.start() }
        rtc = Handler(worker.looper)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) {
            if (!started) stopSelf()
            return START_NOT_STICKY
        }
        when (intent.action) {
            ACTION_START -> {
                goForeground()
                if (started) return START_NOT_STICKY
                started = true
                val data = IntentCompat.getParcelableExtra(intent, EXTRA_DATA, Intent::class.java)
                val session = Assist.session
                if (data == null || session == null) {
                    stopSharing(sendStop = false)
                    return START_NOT_STICKY
                }
                Assist.update { it.copy(sharing = true, ended = false, error = null) }
                main.post { showOverlay() }
                rtc.post { setup(data, session) }
            }
            ACTION_STOP -> stopSharing(sendStop = true, userStopped = true)
            ACTION_OVERLAY -> main.post { showOverlay() }
            else -> if (!started) stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // Al girar el teléfono cambia la forma de la pantalla: ajustamos la captura.
        rtc.post {
            val cap = capturer ?: return@post
            val (w, h) = captureSize()
            if (w != capW || h != capH) {
                capW = w
                capH = h
                cap.changeCaptureFormat(w, h, FPS)
                sendShare()
            }
        }
        main.post { overlay?.marks?.refreshDisplay() }
    }

    override fun onDestroy() {
        if (!stopping) stopSharing(sendStop = true)
        rtc.post { worker.quitSafely() }
        super.onDestroy()
    }

    // ------------------------------------------------------------------
    // Notificación obligatoria del servicio
    // ------------------------------------------------------------------

    private fun goForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.notif_channel), NotificationManager.IMPORTANCE_LOW)
        )
        val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), flags
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, ShareService::class.java).setAction(ACTION_STOP), flags
        )
        val notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.notif_title))
            .setContentText(getString(R.string.notif_text, techName()))
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(0, getString(R.string.notif_stop), stop)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        } else {
            0
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
    }

    private fun techName(): String =
        Assist.session?.techName?.ifBlank { null } ?: getString(R.string.your_technician)

    // ------------------------------------------------------------------
    // Captura + WebRTC (hilo rtc)
    // ------------------------------------------------------------------

    private fun setup(permissionData: Intent, session: Assist.Session) {
        if (stopping) return
        try {
            PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(applicationContext).createInitializationOptions()
            )
            val eglBase = EglBase.create()
            egl = eglBase
            val f = PeerConnectionFactory.builder()
                .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
                .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
                .createPeerConnectionFactory()
            factory = f

            val (w, h) = captureSize()
            capW = w
            capH = h
            val helper = SurfaceTextureHelper.create("assist-capture", eglBase.eglBaseContext)
            textureHelper = helper
            val source = f.createVideoSource(true)
            videoSource = source
            val cap = ScreenCapturerAndroid(permissionData, object : MediaProjection.Callback() {
                override fun onStop() {
                    // El cliente detuvo la captura desde Android (barra de estado, etc.)
                    stopSharing(sendStop = true, userStopped = true)
                }
            })
            cap.initialize(helper, applicationContext, source.capturerObserver)
            cap.startCapture(w, h, FPS)
            capturer = cap
            videoTrack = f.createVideoTrack("screen", source)
            connect(session)
        } catch (e: Exception) {
            Log.e(TAG, "No se pudo iniciar la captura", e)
            Assist.update { it.copy(error = "capture") }
            stopSharing(sendStop = false)
        }
    }

    /** Tamaño de captura: misma forma que la pantalla, lado mayor ≤ 1280 px. */
    private fun captureSize(): Pair<Int, Int> {
        val dm = DisplayMetrics()
        val display = getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
        @Suppress("DEPRECATION")
        display.getRealMetrics(dm)
        val scale = min(1f, MAX_SIDE.toFloat() / max(dm.widthPixels, dm.heightPixels))
        val w = (dm.widthPixels * scale).toInt() and 1.inv()
        val h = (dm.heightPixels * scale).toInt() and 1.inv()
        return w to h
    }

    private fun connect(session: Assist.Session) {
        if (stopping) return
        val sig = Signaling(
            code = session.code,
            token = session.token,
            handleMessage = { s, m -> rtc.post { if (s === signaling) onMessage(m, session) } },
            handleClosed = { s, code -> rtc.post { if (s === signaling) onSocketClosed(code, session) } },
        )
        signaling = sig
        sig.connect()
    }

    private fun send(m: JSONObject) {
        signaling?.send(m)
    }

    private fun sendShare() {
        val device = "${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE}"
        send(
            JSONObject()
                .put("t", "share")
                .put("sharing", true)
                .put("w", capW)
                .put("h", capH)
                .put("surface", "mobile")
                .put("device", device)
        )
    }

    private fun sendPip() {
        send(JSONObject().put("t", "pip").put("open", marksOn).put("mode", "overlay"))
    }

    private fun setTechPresent(present: Boolean) {
        techPresent = present
        Assist.update { it.copy(techPresent = present) }
    }

    private fun onMessage(m: JSONObject, session: Assist.Session) {
        when (m.optString("t")) {
            "joined" -> {
                wsRetry = 0
                setTechPresent(m.optBoolean("techPresent"))
                sendShare()
                sendPip()
                if (techPresent) startPeer(session)
            }
            "peer" -> if (m.optString("role") == "tech") {
                val present = m.optBoolean("present")
                setTechPresent(present)
                if (present) {
                    sendShare()
                    sendPip()
                    startPeer(session)
                } else {
                    main.post { overlay?.marks?.hidePointer() }
                }
            }
            "answer" -> onAnswer(m)
            "ice" -> onRemoteIce(m)
            "ann" -> main.post { overlay?.marks?.handle(m) }
            "caption" -> {
                val text = m.optString("text")
                main.post { overlay?.marks?.setCaption(text) }
            }
            "snapshot" -> main.post {
                Toast.makeText(applicationContext, getString(R.string.snapshot_toast, techName()), Toast.LENGTH_LONG).show()
            }
            "ended" -> {
                Assist.update { it.copy(ended = true) }
                stopSharing(sendStop = false)
            }
        }
    }

    private fun onSocketClosed(code: Int, session: Assist.Session) {
        if (stopping) return
        setTechPresent(false)
        when (code) {
            4003 -> { // el token ya no vale (p. ej. el servidor se reinició): aceptar de nuevo
                Assist.update { it.copy(error = "auth") }
                stopSharing(sendStop = false)
            }
            4004, 4010 -> {
                Assist.update { it.copy(ended = true) }
                stopSharing(sendStop = false)
            }
            4001 -> {
                Assist.update { it.copy(error = "replaced") }
                stopSharing(sendStop = false)
            }
            else -> {
                val delay = min(10_000L, 800L shl min(wsRetry++, 4))
                rtc.postDelayed({ if (!stopping) connect(session) }, delay)
            }
        }
    }

    private fun startPeer(session: Assist.Session) {
        val f = factory ?: return
        val track = videoTrack ?: return
        val myGen = ++gen
        pc?.dispose()
        pc = null
        pendingIce.clear()

        val servers = try {
            Api.iceServers(session.code, session.token)
        } catch (e: Exception) {
            Log.w(TAG, "Sin servidores ICE", e)
            emptyList()
        }
        if (myGen != gen || stopping) return

        val config = PeerConnection.RTCConfiguration(servers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        val peer = f.createPeerConnection(config, object : PcObserver() {
            override fun onIceCandidate(candidate: IceCandidate) {
                rtc.post {
                    if (myGen != gen) return@post
                    val c = JSONObject()
                        .put("candidate", candidate.sdp)
                        .put("sdpMid", candidate.sdpMid)
                        .put("sdpMLineIndex", candidate.sdpMLineIndex)
                    send(JSONObject().put("t", "ice").put("gen", myGen).put("candidate", c))
                }
            }

            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
                if (newState == PeerConnection.PeerConnectionState.FAILED) {
                    rtc.postDelayed({ if (myGen == gen && techPresent && !stopping) startPeer(session) }, 1500)
                }
            }
        }) ?: return
        pc = peer
        peer.addTrack(track, listOf("screen"))

        // Prioriza nitidez del texto y limita el ancho de banda.
        peer.senders.firstOrNull()?.let { sender ->
            val params = sender.parameters
            params.degradationPreference = RtpParameters.DegradationPreference.MAINTAIN_RESOLUTION
            params.encodings.firstOrNull()?.maxBitrateBps = 2_500_000
            sender.setParameters(params)
        }

        peer.createOffer(object : SdpAdapter() {
            override fun onCreateSuccess(desc: SessionDescription) {
                rtc.post {
                    if (myGen != gen) return@post
                    peer.setLocalDescription(object : SdpAdapter() {
                        override fun onSetSuccess() {
                            rtc.post {
                                if (myGen != gen) return@post
                                val sdp = JSONObject().put("type", "offer").put("sdp", desc.description)
                                send(JSONObject().put("t", "offer").put("gen", myGen).put("sdp", sdp))
                            }
                        }
                    }, desc)
                }
            }
        }, MediaConstraints())
    }

    private fun onAnswer(m: JSONObject) {
        val peer = pc ?: return
        if (m.optInt("gen", -1) != gen) return
        val sdp = m.optJSONObject("sdp")?.optString("sdp")?.ifBlank { null } ?: return
        peer.setRemoteDescription(object : SdpAdapter() {
            override fun onSetSuccess() {
                rtc.post {
                    if (peer !== pc) return@post
                    for (c in pendingIce) peer.addIceCandidate(c)
                    pendingIce.clear()
                }
            }
        }, SessionDescription(SessionDescription.Type.ANSWER, sdp))
    }

    private fun onRemoteIce(m: JSONObject) {
        if (m.optInt("gen", -1) != gen) return
        val c = m.optJSONObject("candidate") ?: return
        val sdp = c.optString("candidate")
        if (sdp.isBlank()) return
        val ice = IceCandidate(c.optString("sdpMid", "0"), c.optInt("sdpMLineIndex", 0), sdp)
        val peer = pc ?: return
        if (peer.remoteDescription == null) pendingIce.add(ice) else peer.addIceCandidate(ice)
    }

    // ------------------------------------------------------------------
    // Marcas (hilo principal)
    // ------------------------------------------------------------------

    private fun showOverlay() {
        if (stopping) return
        val ov = overlay ?: OverlayController(this) { stopSharing(sendStop = true, userStopped = true) }
            .also { overlay = it }
        val on = ov.show()
        if (on != marksOn) {
            marksOn = on
            Assist.update { it.copy(marksOn = on) }
            rtc.post { sendPip() }
        }
    }

    // ------------------------------------------------------------------
    // Fin
    // ------------------------------------------------------------------

    private fun stopSharing(sendStop: Boolean, userStopped: Boolean = false) {
        if (stopping) return
        stopping = true
        rtc.post {
            if (sendStop) runCatching { send(JSONObject().put("t", "share").put("sharing", false)) }
            signaling?.close()
            signaling = null
            runCatching { pc?.dispose() }
            pc = null
            runCatching { capturer?.stopCapture() }
            runCatching { capturer?.dispose() }
            capturer = null
            videoTrack = null
            runCatching { videoSource?.dispose() }
            videoSource = null
            runCatching { textureHelper?.dispose() }
            textureHelper = null
            runCatching { factory?.dispose() }
            factory = null
            runCatching { egl?.release() }
            egl = null
            main.post {
                overlay?.hide()
                overlay = null
                Assist.update { it.copy(sharing = false, techPresent = false, marksOn = false) }
                if (userStopped) Toast.makeText(applicationContext, R.string.stopped_toast, Toast.LENGTH_SHORT).show()
                ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
    }
}

/** Observador de WebRTC con todos los métodos vacíos; se sobrescriben solo los necesarios. */
open class PcObserver : PeerConnection.Observer {
    override fun onSignalingChange(state: PeerConnection.SignalingState) {}
    override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {}
    override fun onIceConnectionReceivingChange(receiving: Boolean) {}
    override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {}
    override fun onIceCandidate(candidate: IceCandidate) {}
    override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
    override fun onAddStream(stream: MediaStream) {}
    override fun onRemoveStream(stream: MediaStream) {}
    override fun onDataChannel(channel: DataChannel) {}
    override fun onRenegotiationNeeded() {}
}

open class SdpAdapter : SdpObserver {
    override fun onCreateSuccess(desc: SessionDescription) {}
    override fun onSetSuccess() {}
    override fun onCreateFailure(error: String?) {
        Log.w(TAG, "SDP: $error")
    }

    override fun onSetFailure(error: String?) {
        Log.w(TAG, "SDP: $error")
    }
}
