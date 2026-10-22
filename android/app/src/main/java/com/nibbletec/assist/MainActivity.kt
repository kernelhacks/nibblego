package com.nibbletec.assist

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.text.HtmlCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale

private val Ink = Color(0xFF16212E)
private val Ink2 = Color(0xFF475567)
private val Paper = Color(0xFFEDF1F4)
private val Line = Color(0xFFD3DCE4)
private val Go = Color(0xFF0E6B56)
private val Danger = Color(0xFFB3261E)
private val Signal = Color(0xFFFF3D57)

class MainActivity : ComponentActivity() {

    private sealed interface Step {
        data object Code : Step
        data object Loading : Step
        data class Error(val kind: String, val code: String?) : Step
        data class Terms(val info: Api.SessionInfo, val message: Int? = null) : Step
        data object Marks : Step
        data object Ready : Step
    }

    private var step by mutableStateOf<Step>(Step.Code)
    private var busy by mutableStateOf(false)

    private val captureLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val data = res.data
        if (res.resultCode == RESULT_OK && data != null) {
            ShareService.start(this, data)
        } else {
            Toast.makeText(this, R.string.share_cancelled, Toast.LENGTH_LONG).show()
        }
    }

    private val overlayLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        if (Assist.live.value.sharing) ShareService.refreshOverlay(this) else step = Step.Ready
    }

    private val notificationLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        launchCapture()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleIntent(intent)
        setContent { AssistTheme { AssistScreen() } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        val live = Assist.live.value
        if (live.sharing && !live.marksOn && Settings.canDrawOverlays(this)) ShareService.refreshOverlay(this)
    }

    // ------------------------------------------------------------------
    // Flujo
    // ------------------------------------------------------------------

    /** https://<servidor>/s/123456789  o  nibbleassist://s/123456789 */
    private fun codeFrom(uri: Uri?): String? {
        uri ?: return null
        val segments = uri.pathSegments
        val raw = when {
            uri.scheme == "nibbleassist" -> segments.firstOrNull()
            segments.size >= 2 && segments[0] == "s" -> segments[1]
            else -> null
        }
        return raw?.filter { it.isDigit() }?.takeIf { it.length == 9 }
    }

    private fun handleIntent(intent: Intent?) {
        if (Assist.live.value.sharing) return // ya hay una sesión en curso
        val code = codeFrom(intent?.data) ?: return
        loadSession(code)
    }

    private fun loadSession(code: String) {
        step = Step.Loading
        Assist.update { Assist.Live() }
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) { runCatching { Api.session(code) } }
            result.onSuccess { info ->
                val token = Prefs.token(this@MainActivity, code)
                if (token != null) {
                    val name = Prefs.name(this@MainActivity, code).orEmpty()
                    Assist.session = Assist.Session(code, token, name, info.techName)
                    step = afterTerms()
                } else {
                    step = Step.Terms(info)
                }
            }.onFailure { e ->
                step = Step.Error((e as? Api.ApiError)?.error ?: "network", code)
            }
        }
    }

    private fun termsLang(info: Api.SessionInfo): String {
        val device = Locale.getDefault().language
        return when {
            info.terms.containsKey(device) -> device
            info.terms.containsKey(info.lang) -> info.lang
            else -> info.terms.keys.firstOrNull() ?: "es"
        }
    }

    private fun accept(info: Api.SessionInfo, name: String) {
        val lang = termsLang(info)
        val terms = info.terms[lang] ?: return
        busy = true
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching { Api.accept(info.code, name, lang, terms.version) }
            }
            busy = false
            result.onSuccess { token ->
                Prefs.save(this@MainActivity, info.code, token, name)
                Assist.session = Assist.Session(info.code, token, name, info.techName)
                step = afterTerms()
            }.onFailure { e ->
                val err: String = (e as? Api.ApiError)?.error ?: "network"
                when (err) {
                    "terms_changed" -> {
                        val fresh = withContext(Dispatchers.IO) { runCatching { Api.session(info.code) } }.getOrNull()
                        step = Step.Terms(fresh ?: info, R.string.err_terms_changed)
                    }
                    "expired", "ended", "not_found" -> step = Step.Error(err, info.code)
                    "name_required" -> step = Step.Terms(info, R.string.err_name)
                    else -> step = Step.Terms(info, R.string.err_network)
                }
            }
        }
    }

    private fun afterTerms(): Step = if (Settings.canDrawOverlays(this)) Step.Ready else Step.Marks

    private fun openOverlaySettings() {
        overlayLauncher.launch(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
    }

    private fun startShare() {
        Assist.update { it.copy(error = null) }
        val needsNotificationPermission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        if (needsNotificationPermission) {
            notificationLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            launchCapture()
        }
    }

    private fun launchCapture() {
        val mpm = getSystemService(MediaProjectionManager::class.java)
        captureLauncher.launch(mpm.createScreenCaptureIntent())
    }

    // ------------------------------------------------------------------
    // Interfaz
    // ------------------------------------------------------------------

    @Composable
    private fun AssistScreen() {
        val live by Assist.live.collectAsState()

        // Si el servidor ya no reconoce el token, se piden los términos de nuevo.
        LaunchedEffect(live.error) {
            if (live.error == "auth") {
                val code = Assist.session?.code
                Prefs.clear(this@MainActivity)
                Assist.session = null
                if (code != null) loadSession(code) else step = Step.Code
            }
        }

        val fallbackTech = stringResource(R.string.your_technician)
        val current = step
        val tech = Assist.session?.techName?.ifBlank { null }
            ?: (current as? Step.Terms)?.info?.techName?.ifBlank { null }
            ?: fallbackTech

        Surface(color = Paper, modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .safeDrawingPadding()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp, vertical = 20.dp),
            ) {
                Brand()
                Spacer(Modifier.height(28.dp))
                Column(modifier = Modifier.widthIn(max = 560.dp)) {
                    when {
                        live.ended -> EndedView()
                        live.sharing -> SharingView(live, tech)
                        live.error == "replaced" -> ErrorView("replaced", null)
                        else -> when (current) {
                            Step.Code -> CodeView()
                            Step.Loading -> Body(stringResource(R.string.loading))
                            is Step.Error -> ErrorView(current.kind, current.code)
                            is Step.Terms -> TermsView(current, tech)
                            Step.Marks -> MarksStep(tech)
                            Step.Ready -> ReadyView(tech, live.error == "capture")
                        }
                    }
                }
            }
        }
    }

    @Composable
    private fun Brand() {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(12.dp)
                    .background(Signal, CircleShape)
            )
            Spacer(Modifier.size(10.dp))
            Text(stringResource(R.string.app_name), color = Ink, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        }
    }

    @Composable
    private fun Title(text: String) {
        Text(text, color = Ink, fontSize = 28.sp, lineHeight = 34.sp, fontWeight = FontWeight.Bold)
    }

    @Composable
    private fun Body(text: String, modifier: Modifier = Modifier) {
        Text(text, color = Ink2, fontSize = 17.sp, lineHeight = 25.sp, modifier = modifier.padding(top = 12.dp))
    }

    @Composable
    private fun ErrorText(text: String) {
        Text(text, color = Danger, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, modifier = Modifier.padding(top = 14.dp))
    }

    @Composable
    private fun PrimaryButton(text: String, enabled: Boolean = true, onClick: () -> Unit) {
        Button(
            onClick = onClick,
            enabled = enabled,
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Go, contentColor = Color.White),
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 24.dp)
                .height(56.dp),
        ) {
            Text(text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }
    }

    @Composable
    private fun SecondaryButton(text: String, color: Color = Ink, onClick: () -> Unit) {
        OutlinedButton(
            onClick = onClick,
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 12.dp)
                .height(52.dp),
        ) {
            Text(text, color = color, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
    }

    @Composable
    private fun CodeView() {
        var value by remember { mutableStateOf("") }
        var invalid by remember { mutableStateOf(false) }
        Title(stringResource(R.string.code_title))
        Body(stringResource(R.string.code_hint))
        OutlinedTextField(
            value = value,
            onValueChange = { v ->
                value = v.filter { it.isDigit() }.take(9)
                invalid = false
            },
            label = { Text(stringResource(R.string.code_label)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            textStyle = TextStyle(fontSize = 24.sp, letterSpacing = 3.sp, color = Ink),
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 24.dp),
        )
        if (invalid) ErrorText(stringResource(R.string.code_invalid))
        PrimaryButton(stringResource(R.string.continue_btn)) {
            if (value.length == 9) loadSession(value) else invalid = true
        }
    }

    @Composable
    private fun ErrorView(kind: String, code: String?) {
        val (title, body) = when (kind) {
            "expired" -> R.string.err_expired_title to R.string.err_expired
            "ended" -> R.string.err_ended_title to R.string.err_ended
            "replaced" -> R.string.err_replaced_title to R.string.err_replaced
            "network" -> R.string.err_network_title to R.string.err_network
            else -> R.string.err_not_found_title to R.string.err_not_found
        }
        Title(stringResource(title))
        Body(stringResource(body))
        if (kind == "network" && code != null) {
            PrimaryButton(stringResource(R.string.retry)) { loadSession(code) }
        }
        SecondaryButton(stringResource(R.string.other_code)) {
            Assist.update { Assist.Live() }
            step = Step.Code
        }
    }

    @Composable
    private fun TermsView(s: Step.Terms, tech: String) {
        val lang = termsLang(s.info)
        val terms = s.info.terms[lang]
        var name by remember(s) { mutableStateOf("") }
        var agree by remember(s) { mutableStateOf(false) }
        var error by remember(s) { mutableStateOf(s.message) }

        Title(stringResource(R.string.terms_title, tech))
        Body(stringResource(R.string.terms_lede, tech))

        Column(
            modifier = Modifier
                .padding(top = 24.dp)
                .fillMaxWidth()
                .background(Color.White, RoundedCornerShape(16.dp))
                .border(1.dp, Line, RoundedCornerShape(16.dp))
                .padding(18.dp),
        ) {
            Text(stringResource(R.string.terms_heading), color = Ink, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            if (terms != null) HtmlText(terms.html)
        }

        OutlinedTextField(
            value = name,
            onValueChange = {
                name = it.take(80)
                error = null
            },
            label = { Text(stringResource(R.string.name_label)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 20.dp),
        )
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .padding(top = 12.dp)
                .fillMaxWidth()
                .clickable {
                    agree = !agree
                    error = null
                },
        ) {
            Checkbox(
                checked = agree,
                onCheckedChange = {
                    agree = it
                    error = null
                },
                colors = CheckboxDefaults.colors(checkedColor = Go),
            )
            Text(stringResource(R.string.agree_label), color = Ink, fontSize = 16.sp)
        }
        error?.let { ErrorText(stringResource(it)) }
        PrimaryButton(stringResource(R.string.accept_btn), enabled = !busy) {
            val clean = name.trim().replace(Regex("\\s+"), " ")
            when {
                clean.length < 2 -> error = R.string.err_name
                !agree -> error = R.string.err_agree
                terms == null -> error = R.string.err_network
                else -> accept(s.info, clean)
            }
        }
        Text(
            "${stringResource(R.string.code_label)}: ${s.info.code.chunked(3).joinToString(" ")}",
            color = Ink2,
            fontSize = 14.sp,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 16.dp),
        )
    }

    @Composable
    private fun HtmlText(html: String) {
        val color = Ink2.toArgb()
        AndroidView(
            factory = { ctx ->
                TextView(ctx).apply {
                    textSize = 15f
                    setLineSpacing(0f, 1.25f)
                    setTextColor(color)
                }
            },
            update = { it.text = HtmlCompat.fromHtml(html, HtmlCompat.FROM_HTML_MODE_COMPACT) },
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 10.dp),
        )
    }

    @Composable
    private fun MarksStep(tech: String) {
        Title(stringResource(R.string.marks_title, tech))
        Body(stringResource(R.string.marks_body, tech))
        PrimaryButton(stringResource(R.string.marks_allow)) { openOverlaySettings() }
        SecondaryButton(stringResource(R.string.marks_skip)) { step = Step.Ready }
    }

    @Composable
    private fun ReadyView(tech: String, failed: Boolean) {
        val first = Assist.session?.name?.substringBefore(' ').orEmpty()
        Title(stringResource(R.string.ready_title, first))
        Body(stringResource(R.string.share_hint, tech))
        if (failed) ErrorText(stringResource(R.string.share_failed))
        PrimaryButton(stringResource(R.string.share_btn)) { startShare() }
    }

    @Composable
    private fun SharingView(live: Assist.Live, tech: String) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                Modifier
                    .size(12.dp)
                    .background(Signal, CircleShape)
            )
            Text(
                stringResource(if (live.techPresent) R.string.sharing_title else R.string.sharing_waiting, tech),
                color = Ink,
                fontSize = 22.sp,
                lineHeight = 28.sp,
                fontWeight = FontWeight.Bold,
            )
        }
        Body(stringResource(R.string.sharing_body, tech))

        Column(
            modifier = Modifier
                .padding(top = 24.dp)
                .fillMaxWidth()
                .background(Color.White, RoundedCornerShape(16.dp))
                .border(1.dp, Line, RoundedCornerShape(16.dp))
                .padding(18.dp),
        ) {
            Text(
                stringResource(if (live.marksOn) R.string.marks_on else R.string.marks_off, tech),
                color = Ink,
                fontSize = 16.sp,
                lineHeight = 23.sp,
            )
            if (!live.marksOn) {
                SecondaryButton(stringResource(R.string.marks_enable)) {
                    if (Settings.canDrawOverlays(this@MainActivity)) {
                        ShareService.refreshOverlay(this@MainActivity)
                    } else {
                        openOverlaySettings()
                    }
                }
            }
        }
        SecondaryButton(stringResource(R.string.stop_btn), color = Danger) { ShareService.stop(this@MainActivity) }
    }

    @Composable
    private fun EndedView() {
        Title(stringResource(R.string.ended_title))
        Body(stringResource(R.string.ended_body))
        SecondaryButton(stringResource(R.string.other_code)) {
            Assist.session = null
            Assist.update { Assist.Live() }
            step = Step.Code
        }
    }
}

@Composable
private fun AssistTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Go,
            onPrimary = Color.White,
            background = Paper,
            onBackground = Ink,
            surface = Color.White,
            onSurface = Ink,
            error = Danger,
            outline = Line,
        ),
        content = content,
    )
}
