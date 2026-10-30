package dev.pi.jetbrains.ui

import com.intellij.openapi.Disposable
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import dev.pi.jetbrains.PiChatService
import dev.pi.jetbrains.rpc.PiEvent
import dev.pi.jetbrains.rpc.PiJson
import dev.pi.jetbrains.rpc.RpcResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import java.awt.BorderLayout
import java.awt.Component
import java.util.concurrent.LinkedBlockingQueue
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.SwingConstants

/**
 * JCEF host for the chat UI (plan M1).
 *
 * Streams pi's session records to the webview, coalescing them into ~16 ms batches so a fast
 * `text_delta` stream costs one JS call per frame instead of one per token (plan 7.5).
 */
class ChatPanel(project: Project) : JPanel(BorderLayout()), Disposable {
    private val service = project.service<PiChatService>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val pending = LinkedBlockingQueue<JsonElement>()
    private val hydrationQueue = ArrayDeque<JsonElement>()
    private val hydrationLock = Any()

    @Volatile
    private var hydrated = false

    private var hydrating = false

    private var bridge: WebViewBridge? = null
    private var browser: JBCefBrowser? = null

    init {
        val view: Component = if (JBCefApp.isSupported()) {
            createBrowser() ?: unavailableView()
        } else {
            LOG.warn("JCEF is not supported; the pi chat panel will show a placeholder")
            unavailableView()
        }
        add(view, BorderLayout.CENTER)
        startForwarding()
        // Opening the tool window is the M1 trigger for the child process (plan M1 acceptance).
        service.start()
    }

    private fun createBrowser(): Component? {
        val html = readWebviewHtml()
        if (html == null) {
            LOG.error("webview/index.html is missing from the plugin distribution")
            return null
        }
        val created = JBCefBrowser()
        val createdBridge = WebViewBridge(created, ::onClientMessage, log = { LOG.debug(it) })
        browser = created
        bridge = createdBridge
        createdBridge.load(html)
        return created.component
    }

    private fun unavailableView(): JLabel =
        JLabel("JCEF is not available in this IDE, so the pi chat UI cannot be shown.", SwingConstants.CENTER)

    private fun startForwarding() {
        scope.launch {
            service.status.collect { status ->
                bridge?.send(HostMessages.status(status))
                if (status.phase == PiChatService.Phase.RUNNING) maybeHydrate()
            }
        }
        scope.launch {
            service.events.collect { event ->
                val record = toRecord(event) ?: return@collect
                synchronized(hydrationLock) {
                    if (!hydrated) {
                        hydrationQueue.addLast(record)
                        return@collect
                    }
                }
                pending.add(record)
            }
        }
        scope.launch { flushRecords() }
    }

    private suspend fun flushRecords() {
        while (currentCoroutineContext().isActive) {
            val first = pending.take()
            delay(FLUSH_INTERVAL_MS)
            val batch = ArrayList<JsonElement>()
            batch.add(first)
            pending.drainTo(batch)
            bridge?.send(HostMessages.records(batch))
        }
    }

    private fun onClientMessage(message: ClientMessage) {
        when (message.type) {
            "ready" -> {
                bridge?.markReady()
                bridge?.send(HostMessages.status(service.status.value))
            }
            "prompt" -> {
                val text = message.message?.takeIf { it.isNotBlank() } ?: return
                scope.launch { request { service.prompt(text) } }
            }
            "abort" -> scope.launch { request { service.abort() } }
            "start" -> service.start()
            "request_state" -> scope.launch {
                request { service.requestState() }
                request { service.requestStats() }
            }
            "log" -> message.message?.let { LOG.info("[webview] $it") }
            else -> LOG.debug("unknown webview message: ${message.type}")
        }
    }

    /** Runs a command and surfaces transport failures that never become RPC responses. */
    private suspend fun request(command: suspend () -> RpcResponse) {
        try {
            command()
        } catch (t: Throwable) {
            bridge?.send(HostMessages.notice(t.message ?: t.javaClass.simpleName))
        }
    }

    /**
     * The webview is ready long before node has resolved and spawned pi, so hydration waits for the
     * service to report RUNNING instead of racing the startup (M1 fix).
     */
    private fun maybeHydrate() {
        synchronized(hydrationLock) {
            if (hydrated || hydrating) return
            hydrating = true
        }
        scope.launch { hydrate() }
    }

    private suspend fun hydrate() {
        val activeBridge = bridge
        try {
            if (activeBridge == null) return
            try {
                service.requestState()
                service.requestStats()
            } catch (t: Throwable) {
                activeBridge.send(HostMessages.notice("failed to read pi state: ${t.message}"))
            }
            activeBridge.send(HostMessages.status(service.status.value))

            val messages = try {
                service.messages()
            } catch (t: Throwable) {
                activeBridge.send(HostMessages.notice("get_messages failed: ${t.message}"))
                emptyList()
            }
            sendHistory(activeBridge, messages)
        } finally {
            synchronized(hydrationLock) {
                while (hydrationQueue.isNotEmpty()) pending.add(hydrationQueue.removeFirst())
                hydrated = true
                hydrating = false
            }
        }
    }

    private fun sendHistory(activeBridge: WebViewBridge, messages: List<JsonElement>) {
        if (messages.isEmpty()) {
            activeBridge.send(HostMessages.history(emptyList(), final = true))
            return
        }
        var batch = ArrayList<JsonElement>()
        var size = 0
        for (message in messages) {
            val length = message.toString().length
            if (batch.isNotEmpty() && size + length > HISTORY_CHUNK_CHARS) {
                activeBridge.send(HostMessages.history(batch, final = false))
                batch = ArrayList()
                size = 0
            }
            batch.add(message)
            size += length
        }
        activeBridge.send(HostMessages.history(batch, final = true))
    }

    private fun toRecord(event: PiEvent): JsonElement? = when (event) {
        is PiEvent.Session -> event.payload
        is PiEvent.ExtensionUiRequest -> event.payload
        is PiEvent.Response -> PiJson.encodeToJsonElement(RpcResponse.serializer(), event.response)
        is PiEvent.Unknown -> null
    }

    private fun readWebviewHtml(): String? =
        ChatPanel::class.java.getResourceAsStream(WEBVIEW_RESOURCE)?.use { stream ->
            stream.readBytes().toString(Charsets.UTF_8)
        }

    override fun dispose() {
        scope.cancel()
        browser?.let { Disposer.dispose(it) }
        browser = null
        bridge = null
    }

    companion object {
        private val LOG = Logger.getInstance(ChatPanel::class.java)
        private const val WEBVIEW_RESOURCE = "/webview/index.html"
        private const val FLUSH_INTERVAL_MS = 16L
        private const val HISTORY_CHUNK_CHARS = 256 * 1024
    }
}
