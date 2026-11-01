package dev.pi.jetbrains.ui

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import dev.pi.jetbrains.rpc.PiJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Two-way bridge between the JCEF webview and Kotlin (plan 7.4).
 *
 * JS -> Kotlin uses [JBCefJSQuery]; Kotlin -> JS calls `window.__piDeliver`, which the React app
 * registers on startup. The query snippet is injected into the HTML before it is loaded so the
 * page can post from its first script.
 */
class WebViewBridge(
    private val browser: JBCefBrowser,
    private val onClientMessage: (ClientMessage) -> Unit,
    private val log: (String) -> Unit = {},
) : Disposable {
    private val query: JBCefJSQuery = JBCefJSQuery.create(browser as JBCefBrowserBase)

    // send() is called from coroutine threads while markReady() runs on the EDT; the deque is
    // not thread-safe, so all ready/pending access is guarded by this lock.
    private val lock = Any()
    private val pending = ArrayDeque<JsonElement>()
    @Volatile
    private var ready = false
    @Volatile
    private var disposed = false

    /** Number of JCEF delivery callbacks currently queued on the IntelliJ EDT. */
    private val queuedDeliveries = AtomicInteger()
    private val lastQueueDiagnosticAt = AtomicLong(System.nanoTime())
    private val serializationExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "pi-webview-serialization").apply { isDaemon = true }
    }
    private val deliveryStatsLock = Any()
    private var deliveryCount = 0
    private var maxSerializationQueueMs = 0.0
    private var maxEdtQueueMs = 0.0
    private var maxSerializationMs = 0.0
    private var maxDispatchMs = 0.0
    private var lastDeliveryDiagnosticAt = System.nanoTime()

    init {
        query.addHandler { payload ->
            val message = runCatching { PiJson.decodeFromString(ClientMessage.serializer(), payload) }.getOrNull()
            if (message == null) {
                log("ignoring unparseable webview message: ${payload.take(200)}")
            } else {
                ApplicationManager.getApplication().invokeLater {
                    if (!disposed && !browser.isDisposed) onClientMessage(message)
                }
            }
            null
        }
    }

    /** Loads [html] with the query snippet substituted for [BRIDGE_MARKER]. */
    fun load(html: String) {
        if (!html.contains(BRIDGE_MARKER)) {
            log("webview HTML is missing $BRIDGE_MARKER; messages from the page will be dropped")
        }
        val snippet = "window.__piNativePost = function (message) { ${query.inject("JSON.stringify(message)")} };"
        browser.loadHTML(html.replace(BRIDGE_MARKER, snippet))
    }

    /** Called once the page reports it installed its message handler. */
    fun markReady() {
        val queued: List<JsonElement>
        synchronized(lock) {
            if (disposed) return
            ready = true
            queued = pending.toList()
            pending.clear()
        }
        queued.forEach(::execute)
    }

    fun send(message: JsonElement) {
        val executeNow = synchronized(lock) {
            if (disposed) return
            if (!ready) {
                if (pending.size >= MAX_PENDING) {
                    log("dropping webview message: ${pending.size} already queued before the page was ready")
                    return
                }
                pending.addLast(message)
                false
            } else {
                true
            }
        }
        if (executeNow) {
            execute(message)
        }
    }

    /** Serializes off the EDT, then schedules only the JCEF call on the EDT. */
    private fun execute(message: JsonElement) {
        val serializationQueuedAt = System.nanoTime()
        try {
            serializationExecutor.execute {
                if (disposed) return@execute
                val serializationStartedAt = System.nanoTime()
                val serializationQueueMs = (serializationStartedAt - serializationQueuedAt) / 1_000_000.0
                // U+2028/U+2029 are legal inside JSON strings but are JS line terminators in source.
                val payload = message.toString()
                    .replace("\u2028", "\\u2028")
                    .replace("\u2029", "\\u2029")
                val serializationMs = (System.nanoTime() - serializationStartedAt) / 1_000_000.0
                val payloadChars = payload.length
                val payloadBytes = payload.toByteArray(Charsets.UTF_8).size
                val recordCount = recordCount(message)
                val edtQueuedAt = System.nanoTime()
                val queued = queuedDeliveries.incrementAndGet()
                val previousQueueDiagnosticAt = lastQueueDiagnosticAt.get()
                if (queued >= QUEUE_WARNING_THRESHOLD &&
                    edtQueuedAt - previousQueueDiagnosticAt >= DIAGNOSTIC_INTERVAL_NS &&
                    lastQueueDiagnosticAt.compareAndSet(previousQueueDiagnosticAt, edtQueuedAt)
                ) {
                    log("[webview-bridge] edt_queue pending=$queued message=${messageType(message)}")
                }

                // This only updates the webview, not IDE models. Deliver even while a settings
                // dialog is open; default modality would defer delivery until the dialog closes.
                ApplicationManager.getApplication().invokeLater({
                    val callbackStartedAt = System.nanoTime()
                    val edtQueueMs = (callbackStartedAt - edtQueuedAt) / 1_000_000.0
                    val outstanding = queuedDeliveries.decrementAndGet()
                    if (disposed || browser.isDisposed) return@invokeLater
                    val frame = browser.cefBrowser.mainFrame
                    if (frame == null) {
                        recordDelivery(
                            serializationQueueMs,
                            edtQueueMs,
                            serializationMs,
                            0.0,
                            outstanding,
                            message,
                            payloadChars,
                            payloadBytes,
                            recordCount,
                        )
                        return@invokeLater
                    }
                    frame.executeJavaScript("window.__piDeliver && window.__piDeliver($payload)", frame.url, 0)
                    val dispatchMs = (System.nanoTime() - callbackStartedAt) / 1_000_000.0
                    recordDelivery(
                        serializationQueueMs,
                        edtQueueMs,
                        serializationMs,
                        dispatchMs,
                        outstanding,
                        message,
                        payloadChars,
                        payloadBytes,
                        recordCount,
                    )
                }, ModalityState.any())
            }
        } catch (_: RejectedExecutionException) {
            // The bridge is being disposed; no further delivery is needed.
        }
    }

    private fun recordDelivery(
        serializationQueueMs: Double,
        edtQueueMs: Double,
        serializationMs: Double,
        dispatchMs: Double,
        outstanding: Int,
        message: JsonElement,
        payloadChars: Int,
        payloadBytes: Int,
        recordCount: Int?,
    ) {
        synchronized(deliveryStatsLock) {
            deliveryCount++
            maxSerializationQueueMs = maxOf(maxSerializationQueueMs, serializationQueueMs)
            maxEdtQueueMs = maxOf(maxEdtQueueMs, edtQueueMs)
            maxSerializationMs = maxOf(maxSerializationMs, serializationMs)
            maxDispatchMs = maxOf(maxDispatchMs, dispatchMs)
            val now = System.nanoTime()
            val shouldReport =
                serializationQueueMs >= SERIALIZATION_QUEUE_WARNING_MS ||
                    edtQueueMs >= QUEUE_DELAY_WARNING_MS ||
                    serializationMs >= SERIALIZATION_WARNING_MS ||
                    dispatchMs >= DISPATCH_WARNING_MS ||
                    payloadBytes >= PAYLOAD_WARNING_BYTES ||
                    now - lastDeliveryDiagnosticAt >= DIAGNOSTIC_INTERVAL_NS
            if (!shouldReport) return
            log(
                "[webview-bridge] delivery count=$deliveryCount serializeQueueMs=${serializationQueueMs.rounded()} " +
                    "edtQueueMs=${edtQueueMs.rounded()} serializeMs=${serializationMs.rounded()} " +
                    "dispatchMs=${dispatchMs.rounded()} maxSerializeQueueMs=${maxSerializationQueueMs.rounded()} " +
                    "maxEdtQueueMs=${maxEdtQueueMs.rounded()} maxSerializeMs=${maxSerializationMs.rounded()} " +
                    "maxDispatchMs=${maxDispatchMs.rounded()} payloadChars=$payloadChars payloadBytes=$payloadBytes " +
                    "recordCount=${recordCount ?: "-"} outstanding=$outstanding message=${messageType(message)}",
            )
            deliveryCount = 0
            maxSerializationQueueMs = 0.0
            maxEdtQueueMs = 0.0
            maxSerializationMs = 0.0
            maxDispatchMs = 0.0
            lastDeliveryDiagnosticAt = now
        }
    }

    private fun messageType(message: JsonElement): String =
        ((message as? JsonObject)?.get("type") as? JsonPrimitive)?.contentOrNull ?: "unknown"

    private fun recordCount(message: JsonElement): Int? =
        ((message as? JsonObject)?.get("type") as? JsonPrimitive)?.contentOrNull
            ?.takeIf { it == "records" }
            ?.let { ((message as JsonObject)["records"] as? JsonArray)?.size }

    private fun Double.rounded(): String = "%.1f".format(this)

    override fun dispose() {
        synchronized(lock) {
            disposed = true
            pending.clear()
        }
        serializationExecutor.shutdownNow()
        Disposer.dispose(query)
    }

    companion object {
        const val BRIDGE_MARKER: String = "/*__PI_BRIDGE__*/"
        private const val MAX_PENDING = 64
        private const val QUEUE_WARNING_THRESHOLD = 20
        private const val QUEUE_DELAY_WARNING_MS = 100.0
        private const val SERIALIZATION_QUEUE_WARNING_MS = 100.0
        private const val SERIALIZATION_WARNING_MS = 20.0
        private const val DISPATCH_WARNING_MS = 50.0
        private const val PAYLOAD_WARNING_BYTES = 128 * 1024
        private const val DIAGNOSTIC_INTERVAL_NS = 1_000_000_000L
    }
}
