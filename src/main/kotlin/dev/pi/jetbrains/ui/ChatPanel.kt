package dev.pi.jetbrains.ui

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import dev.pi.jetbrains.PiChatService
import dev.pi.jetbrains.editor.EditorNavigator
import dev.pi.jetbrains.rpc.PiEvent
import dev.pi.jetbrains.rpc.PiJson
import dev.pi.jetbrains.rpc.RpcCommandsData
import dev.pi.jetbrains.rpc.RpcForkResult
import dev.pi.jetbrains.rpc.RpcModelsData
import dev.pi.jetbrains.rpc.RpcResponse
import dev.pi.jetbrains.rpc.RpcExtensionUiResponse
import dev.pi.jetbrains.rpc.RpcImage
import dev.pi.jetbrains.rpc.RpcSwitchResult
import dev.pi.jetbrains.rpc.RpcThinkingLevelsData
import dev.pi.jetbrains.rpc.RpcTreeData
import dev.pi.jetbrains.rpc.decodeDataAs
import dev.pi.jetbrains.session.SessionTree
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.awt.BorderLayout
import java.awt.Component
import java.util.concurrent.LinkedBlockingQueue
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.SwingConstants
import javax.swing.JTextArea
import javax.swing.JScrollPane
import javax.swing.JOptionPane

/**
 * JCEF host for the chat UI (plan M1).
 *
 * Streams pi's session records to the webview, coalescing them into ~16 ms batches so a fast
 * `text_delta` stream costs one JS call per frame instead of one per token (plan 7.5).
 *
 * M3 adds the session/model/thinking/command surfaces. Anything that changes the active session
 * (switch, new, fork) resets the webview transcript and re-hydrates it from `get_messages`.
 */
class ChatPanel(private val project: Project) : JPanel(BorderLayout()), Disposable {
    private val service = project.service<PiChatService>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val pending = LinkedBlockingQueue<JsonElement>()
    private val hydrationQueue = ArrayDeque<JsonElement>()
    private val hydrationLock = Any()
    private val hydrateMutex = Mutex()

    /** Bumped on every reset so in-flight hydration and record batches from the old session drop. */
    private var generation = 0

    @Volatile
    private var hydrated = false

    /** True between a session reset and the moment the webview may receive fresh history. */
    @Volatile
    private var resetting = false

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
                if (event is PiEvent.ExtensionUiRequest) handleExtensionUiRequest(event)
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
            val startGeneration = synchronized(hydrationLock) { generation }
            val first = pending.take()
            delay(FLUSH_INTERVAL_MS)
            val batch = ArrayList<JsonElement>()
            batch.add(first)
            pending.drainTo(batch)
            // A session switch reset the transcript while this batch was coalescing; the events
            // belong to the old session and must not be appended after the reset.
            if (synchronized(hydrationLock) { generation } != startGeneration) continue
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
                val images = message.images.map { RpcImage(data = it.data, mimeType = it.mimeType) }
                scope.launch { request { service.prompt(text, images) } }
            }
            "abort" -> scope.launch { request { service.abort() } }
            "start" -> service.start()
            "request_state" -> scope.launch {
                request { service.requestState() }
                request { service.requestStats() }
            }
            "open_path" -> message.path?.let { path ->
                EditorNavigator.open(project, path, message.line) { error ->
                    bridge?.send(HostMessages.notice(error))
                }
            }
            "open_url" -> message.url?.let { EditorNavigator.openUrl(it) }
            "log" -> message.message?.let { LOG.info("[webview] $it") }

            // ---- M3: sessions ------------------------------------------------------------------
            "list_sessions" -> scope.launch { sendSessions() }
            "get_tree" -> scope.launch { sendTree() }
            "new_session" -> scope.launch {
                changeSession("new") { service.newSession() }
            }
            "switch_session" -> {
                val path = message.path ?: return
                scope.launch { changeSession("switch") { service.switchSession(path) } }
            }
            "fork" -> {
                val entryId = message.entryId ?: return
                scope.launch { changeSession("fork") { service.fork(entryId) } }
            }
            "rename_session" -> {
                val name = message.name?.trim() ?: return
                scope.launch {
                    val response = request { service.setSessionName(name) }
                    if (response?.success == true) {
                        request { service.requestState() }
                        sendSessions()
                    }
                }
            }

            // ---- M3: model / thinking ----------------------------------------------------------
            "get_models" -> scope.launch { sendModels() }
            "set_model" -> {
                val provider = message.provider ?: return
                val modelId = message.modelId ?: return
                scope.launch {
                    val response = request { service.setModel(provider, modelId) }
                    if (response?.success == true) {
                        request { service.requestState() }
                        sendModels()
                        sendThinkingLevels()
                    }
                }
            }
            "get_thinking_levels" -> scope.launch { sendThinkingLevels() }
            "set_thinking_level" -> {
                val level = message.level ?: return
                scope.launch {
                    val response = request { service.setThinkingLevel(level) }
                    if (response?.success == true) {
                        request { service.requestState() }
                        sendThinkingLevels()
                    }
                }
            }

            // ---- M3: compaction / retry / commands ---------------------------------------------
            "compact" -> scope.launch {
                val response = request(COMPACT_TIMEOUT_NOTICE) { service.compact() }
                if (response?.success == true) {
                    scope.launch { request { service.requestStats() } }
                }
            }
            "set_auto_compaction" -> {
                val enabled = message.enabled ?: return
                scope.launch {
                    val response = request { service.setAutoCompaction(enabled) }
                    if (response?.success == true) request { service.requestState() }
                }
            }
            "abort_retry" -> scope.launch {
                val response = request { service.abortRetry() }
                if (response?.success == true) request { service.requestState() }
            }
            "get_commands" -> scope.launch { sendCommands() }
            "clear_context" -> service.clearEditorContext()

            else -> LOG.debug("unknown webview message: ${message.type}")
        }
    }

    /** Runs a command and surfaces transport failures that never become RPC responses. */
    private suspend fun request(command: suspend () -> RpcResponse): RpcResponse? {
        return try {
            val response = command()
            if (!response.success) {
                bridge?.send(HostMessages.notice("${response.command} failed: ${response.error ?: "unknown error"}"))
            }
            response
        } catch (t: Throwable) {
            bridge?.send(HostMessages.notice(t.message ?: t.javaClass.simpleName))
            null
        }
    }

    private suspend fun request(label: String, command: suspend () -> RpcResponse): RpcResponse? {
        val response = request(command)
        if (response == null) bridge?.send(HostMessages.notice(label))
        return response
    }

    // ---------------------------------------------------------------------------------------------
    // M3 data surfaces
    // ---------------------------------------------------------------------------------------------

    private suspend fun sendSessions() {
        val activeBridge = bridge ?: return
        val sessions = try {
            service.listSessions()
        } catch (t: Throwable) {
            activeBridge.send(HostMessages.notice("failed to list sessions: ${t.message}"))
            emptyList()
        }
        activeBridge.send(HostMessages.sessions(sessions, service.status.value.sessionFile))
    }

    private suspend fun sendTree() {
        val activeBridge = bridge ?: return
        val response = request { service.sessionTree() } ?: return
        if (!response.success) return
        val data = response.decodeDataAs<RpcTreeData>() ?: return
        val rows = SessionTree.flatten(data.tree, data.leafId)
        activeBridge.send(HostMessages.tree(rows, data.leafId, service.status.value.sessionId))
    }

    private suspend fun sendModels() {
        val activeBridge = bridge ?: return
        val response = request { service.availableModels() } ?: return
        if (!response.success) return
        val models = response.decodeDataAs<RpcModelsData>()?.models ?: return
        activeBridge.send(
            HostMessages.models(models, service.status.value.provider, service.status.value.model),
        )
    }

    private suspend fun sendThinkingLevels() {
        val activeBridge = bridge ?: return
        val response = request { service.availableThinkingLevels() } ?: return
        if (!response.success) return
        val levels = response.decodeDataAs<RpcThinkingLevelsData>()?.levels ?: return
        activeBridge.send(HostMessages.thinkingLevels(levels, service.status.value.thinkingLevel))
    }

    private suspend fun sendCommands() {
        val activeBridge = bridge ?: return
        val response = request { service.slashCommands() } ?: return
        if (!response.success) return
        val commands = response.decodeDataAs<RpcCommandsData>()?.commands ?: return
        activeBridge.send(HostMessages.commands(commands))
    }

    /**
     * `new_session` / `switch_session` / `fork` share a response shape. Extensions may cancel the
     * change; otherwise the transcript is replaced and related surfaces refreshed.
     */
    private suspend fun changeSession(reason: String, action: suspend () -> RpcResponse) {
        val activeBridge = bridge ?: return
        val response = request(action) ?: return
        if (!response.success) return

        val cancelled = response.decodeDataAs<RpcSwitchResult>()?.cancelled
            ?: response.decodeDataAs<RpcForkResult>()?.cancelled
            ?: false
        if (cancelled) {
            activeBridge.send(HostMessages.notice("session change was cancelled by an extension", level = "info"))
            return
        }
        if (reason == "fork") {
            response.decodeDataAs<RpcForkResult>()?.text?.takeIf { it.isNotBlank() }?.let { text ->
                activeBridge.send(HostMessages.prefill(text))
            }
        }
        reloadTranscript(reason)
        sendSessions()
        sendTree()
        sendModels()
        sendThinkingLevels()
    }

    // ---------------------------------------------------------------------------------------------
    // Transcript hydration
    // ---------------------------------------------------------------------------------------------

    /**
     * The webview is ready long before node has resolved and spawned pi, so hydration waits for the
     * service to report RUNNING instead of racing the startup (M1 fix).
     */
    private fun maybeHydrate() {
        val blocked = synchronized(hydrationLock) { hydrated || resetting }
        if (blocked) return
        scope.launch { hydrate() }
    }

    /** Clears the webview transcript and loads the newly active session into it. */
    private suspend fun reloadTranscript(reason: String) {
        val activeBridge = bridge ?: return
        synchronized(hydrationLock) {
            resetting = true
            generation++
            hydrated = false
            hydrationQueue.clear()
            pending.clear()
        }
        activeBridge.send(HostMessages.reset(reason))
        synchronized(hydrationLock) { resetting = false }
        hydrate()
    }

    private suspend fun hydrate() {
        hydrateMutex.withLock {
            val activeBridge = bridge ?: return@withLock
            val startGeneration = synchronized(hydrationLock) {
                if (hydrated || resetting) return@withLock
                generation
            }
            try {
                try {
                    service.requestState()
                    service.requestStats()
                } catch (t: Throwable) {
                    activeBridge.send(HostMessages.notice("failed to read pi state: ${t.message}"))
                }
                if (!isCurrent(startGeneration)) return@withLock
                activeBridge.send(HostMessages.status(service.status.value))

                val messages = try {
                    service.messages()
                } catch (t: Throwable) {
                    activeBridge.send(HostMessages.notice("get_messages failed: ${t.message}"))
                    emptyList()
                }
                if (!isCurrent(startGeneration)) return@withLock
                sendHistory(activeBridge, messages)
            } finally {
                synchronized(hydrationLock) {
                    if (generation == startGeneration) {
                        while (hydrationQueue.isNotEmpty()) pending.add(hydrationQueue.removeFirst())
                        hydrated = true
                    }
                }
            }
        }
    }

    private fun isCurrent(startGeneration: Int): Boolean =
        synchronized(hydrationLock) { generation == startGeneration }

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

    private fun handleExtensionUiRequest(event: PiEvent.ExtensionUiRequest) {
        val payload = event.payload
        when (event.method) {
            "select" -> ApplicationManager.getApplication().invokeLater {
                val options = (payload["options"] as? kotlinx.serialization.json.JsonArray)
                    ?.mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull }
                    ?.toTypedArray() ?: emptyArray()
                val result = Messages.showChooseDialog(
                    payload.string("title") ?: "Select",
                    "pi extension",
                    options,
                    options.firstOrNull(),
                    Messages.getQuestionIcon(),
                )
                if (result >= 0 && result < options.size) respond(RpcExtensionUiResponse.Value(id = event.id, value = options[result]))
                else respond(RpcExtensionUiResponse.Cancelled(id = event.id))
            }
            "confirm" -> ApplicationManager.getApplication().invokeLater {
                val result = Messages.showYesNoDialog(
                    payload.string("message") ?: "Allow this operation?",
                    payload.string("title") ?: "Confirm",
                    Messages.getQuestionIcon(),
                )
                respond(RpcExtensionUiResponse.Confirmation(id = event.id, confirmed = result == Messages.YES))
            }
            "input" -> ApplicationManager.getApplication().invokeLater {
                val value = Messages.showInputDialog(
                    payload.string("title") ?: "Input",
                    "pi extension",
                    Messages.getQuestionIcon(),
                )
                if (value == null) respond(RpcExtensionUiResponse.Cancelled(id = event.id))
                else respond(RpcExtensionUiResponse.Value(id = event.id, value = value))
            }
            "editor" -> ApplicationManager.getApplication().invokeLater {
                val area = JTextArea(payload.string("prefill") ?: "", 16, 72)
                val result = JOptionPane.showConfirmDialog(
                    this,
                    JScrollPane(area),
                    payload.string("title") ?: "Edit",
                    JOptionPane.OK_CANCEL_OPTION,
                    JOptionPane.PLAIN_MESSAGE,
                )
                if (result == JOptionPane.OK_OPTION) respond(RpcExtensionUiResponse.Value(id = event.id, value = area.text))
                else respond(RpcExtensionUiResponse.Cancelled(id = event.id))
            }
            "notify" -> {
                val notifyType = payload.string("notifyType")
                bridge?.send(HostMessages.notice(payload.string("message") ?: "", if (notifyType == "error") "error" else "info"))
            }
            "setStatus" -> {
                val key = payload.string("statusKey") ?: return
                val text = payload.string("statusText")
                bridge?.send(HostMessages.extensionStatus(key, text))
            }
            "setWidget" -> {
                val key = payload.string("widgetKey") ?: return
                val lines = (payload["widgetLines"] as? kotlinx.serialization.json.JsonArray)
                    ?.mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull } ?: emptyList()
                bridge?.send(HostMessages.widget(key, lines, payload.string("widgetPlacement") ?: "aboveEditor"))
            }
            "setTitle" -> payload.string("title")?.let { title ->
                ApplicationManager.getApplication().invokeLater {
                    val window = com.intellij.openapi.wm.ToolWindowManager.getInstance(project).getToolWindow("pi")
                    window?.stripeTitle = title
                }
            }
            "set_editor_text" -> payload.string("text")?.let { bridge?.send(HostMessages.prefill(it)) }
        }
    }

    private fun respond(response: RpcExtensionUiResponse) {
        scope.launch { runCatching { service.respondToExtensionUi(response) } }
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
        private const val COMPACT_TIMEOUT_NOTICE = "compaction did not finish in time"
    }
}
