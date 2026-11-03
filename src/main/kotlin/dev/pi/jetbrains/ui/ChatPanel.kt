package dev.pi.jetbrains.ui

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.wm.IdeFocusManager
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.editor.colors.EditorColorsListener
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.vfs.newvfs.BulkFileListener
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import dev.pi.jetbrains.PiChatService
import dev.pi.jetbrains.PiChatFontSizeListener
import dev.pi.jetbrains.PiSettings
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
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.Toolkit
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicLong
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
class ChatPanel(
    private val project: Project,
    private val service: PiChatService,
    private val activateSession: (String) -> Boolean,
    private val diagnosticName: String = "chat",
    private val onStatusChanged: (PiChatService.Status) -> Unit = {},
    private val onTitleChanged: (String?) -> Unit = {},
) : JPanel(BorderLayout()), Disposable {
    val sessionFile: String? get() = service.status.value.sessionFile

    fun isTaskRunning(): Boolean = service.status.value.let { it.isStreaming || it.isCompacting }

    fun prefillComposer(text: String) = service.prefillComposer(text)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val pending = LinkedBlockingQueue<JsonElement>(MAX_PENDING_RECORDS)
    private val lastPendingDropLogAt = AtomicLong(0L)
    private val hydrationQueue = ArrayDeque<JsonElement>()
    private val hydrationLock = Any()
    private val hydrateMutex = Mutex()
    private val projectFilesRefreshLock = Any()
    private var projectFilesRefreshJob: kotlinx.coroutines.Job? = null
    private var projectFilesRefreshRequested = false

    /**
     * `tool_execution_update` carries a full output snapshot per event, so a chatty tool would
     * re-send its whole output every few milliseconds. Only the latest snapshot per call is kept
     * here and released to [pending] at most once per [TOOL_UPDATE_FLUSH_MS]; the matching
     * `tool_execution_end` releases it immediately so the final card still sees the last output.
     */
    private val heldUpdates = LinkedHashMap<String, JsonObject>()
    private val heldUpdatesLock = Any()
    private val soundExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "pi-task-completion-sound").apply { isDaemon = true }
    }

    /** Bumped on every reset so in-flight hydration and record batches from the old session drop. */
    private var generation = 0

    /** First user message of the live transcript; tab title fallback when the session has no name. */
    @Volatile
    private var liveFirstUserText: String? = null

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
        project.messageBus.connect(this).subscribe(
            EditorColorsManager.TOPIC,
            EditorColorsListener { bridge?.send(themeMessage()) },
        )
        ApplicationManager.getApplication().messageBus.connect(this).subscribe(
            PiSettings.CHAT_FONT_SIZE_CHANGED,
            PiChatFontSizeListener { bridge?.send(themeMessage()) },
        )
        project.messageBus.connect(this).subscribe(
            VirtualFileManager.VFS_CHANGES,
            object : BulkFileListener {
                override fun after(events: List<com.intellij.openapi.vfs.newvfs.events.VFileEvent>) {
                    if (events.any { isProjectFileEvent(it.file) }) refreshProjectFiles()
                }
            },
        )
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
        val createdBridge = WebViewBridge(created, ::onClientMessage, log = { text ->
            val prefix = diagnosticPrefix()
            LOG.debug("$prefix $text")
            scope.launch { service.logDiagnostic("$prefix $text") }
        })
        browser = created
        bridge = createdBridge
        createdBridge.load(html)
        // JCEF receives keyboard/IME composition events only after its native browser has focus.
        created.component.isFocusable = true
        created.component.accessibleContext.accessibleName = "pi chat"
        created.cefBrowser.setFocus(true)
        createdBridge.send(themeMessage())
        return created.component
    }

    private fun unavailableView(): JLabel =
        JLabel("JCEF is not available in this IDE, so the pi chat UI cannot be shown.", SwingConstants.CENTER)

    private fun startForwarding() {
        scope.launch {
            service.prefill.collect { text ->
                if (text == null) return@collect
                bridge?.send(HostMessages.prefill(text))
                service.clearPrefill(text)
            }
        }
        scope.launch {
            service.status.collect { status ->
                onStatusChanged(status)
                emitTitle()
                bridge?.send(HostMessages.status(status))
                if (status.phase == PiChatService.Phase.RUNNING) maybeHydrate()
            }
        }
        scope.launch {
            service.events.collect { event ->
                if (event is PiEvent.ExtensionUiRequest) handleExtensionUiRequest(event)
                if (event is PiEvent.Session) {
                    if (event.type == "agent_settled") maybePlayTaskCompletionSound(event)
                    maybeCaptureFirstUserText(event.payload)
                }
                val record = toRecord(event) ?: return@collect
                if (record is JsonObject) {
                    val callId = record.string("toolCallId")
                    when (record.string("type")) {
                        "tool_execution_update" -> {
                            if (callId != null) {
                                synchronized(heldUpdatesLock) { heldUpdates[callId] = record }
                                return@collect
                            }
                        }
                        "tool_execution_end" -> {
                            // Route the last snapshot under the same lock the flusher uses so the
                            // snapshot can never overtake this end record into the queue.
                            synchronized(heldUpdatesLock) {
                                val held = callId?.let { heldUpdates.remove(it) }
                                if (held != null) routeRecord(held)
                            }
                        }
                    }
                }
                routeRecord(record)
            }
        }
        scope.launch { flushRecords() }
        scope.launch { flushHeldUpdates() }
    }

    fun requestComposerFocus() {
        val browser = browser ?: return
        IdeFocusManager.getInstance(project).requestFocus(browser.component, true)
        browser.cefBrowser.setFocus(true)
        bridge?.send(HostMessages.focusComposer())
    }

    fun scrollToLatest() {
        bridge?.send(HostMessages.scrollToLatest())
    }

    fun scrollToFirst() {
        bridge?.send(HostMessages.scrollToFirst())
    }

    fun scrollToPreviousUserMessage() {
        bridge?.send(HostMessages.scrollToUserMessage("previous"))
    }

    fun scrollToNextUserMessage() {
        bridge?.send(HostMessages.scrollToUserMessage("next"))
    }

    /** Queues a record for the webview, or parks it while the transcript is still hydrating. */
    private fun routeRecord(record: JsonElement) {
        synchronized(hydrationLock) {
            if (!hydrated) {
                hydrationQueue.addLast(record)
                return
            }
        }
        if (!pending.offer(record)) {
            val now = System.nanoTime()
            val previous = lastPendingDropLogAt.get()
            if (now - previous >= DROP_LOG_INTERVAL_NS &&
                lastPendingDropLogAt.compareAndSet(previous, now)
            ) {
                service.logDiagnostic("${diagnosticPrefix()} [webview-records] pending queue full; dropping records")
            }
        }
    }

    /** Releases throttled tool snapshots at a fixed cadence; each call keeps only its latest one. */
    private suspend fun flushHeldUpdates() {
        while (currentCoroutineContext().isActive) {
            delay(TOOL_UPDATE_FLUSH_MS)
            synchronized(heldUpdatesLock) {
                val released = heldUpdates.values.toList()
                heldUpdates.clear()
                released.forEach(::routeRecord)
            }
        }
    }

    private suspend fun flushRecords() {
        var batchCount = 0
        var recordCount = 0
        var lastDiagnosticAt = System.nanoTime()
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
            val recordBatches = WebviewRecords.batches(batch)
            for (records in recordBatches) {
                // Check every split batch: a reset can occur while a large drain is being split.
                val message = HostMessages.records(records)
                val sent = synchronized(hydrationLock) {
                    if (generation != startGeneration) false else {
                        bridge?.send(message)
                        true
                    }
                }
                if (!sent) break
                val bytes = WebviewRecords.jsonBytes(message)
                if (bytes >= WebviewRecords.DIAGNOSTIC_BYTES) {
                    service.logDiagnostic(
                        "${diagnosticPrefix()} [webview-records] records=${records.size} " +
                            "payloadBytes=$bytes entries=${WebviewRecords.describe(records)}",
                    )
                }
                batchCount++
                recordCount += records.size
            }
            val now = System.nanoTime()
            if (now - lastDiagnosticAt >= DIAGNOSTIC_INTERVAL_NS) {
                service.logDiagnostic(
                    "${diagnosticPrefix()} [webview-perf] native_records batches=$batchCount records=$recordCount pending=${pending.size} " +
                    "heldUpdates=${synchronized(heldUpdatesLock) { heldUpdates.size }}",
                )
                batchCount = 0
                recordCount = 0
                lastDiagnosticAt = now
            }
        }
    }

    private fun diagnosticPrefix(): String =
        "[tab=$diagnosticName session=${service.status.value.sessionFile ?: "-"}]"

    private fun onClientMessage(message: ClientMessage) {
        when (message.type) {
            "ready" -> {
                bridge?.markReady()
                bridge?.send(themeMessage())
                bridge?.send(HostMessages.status(service.status.value))
            }
            "prompt" -> {
                val text = message.message.orEmpty()
                if (text.isBlank() && message.images.isEmpty() && service.status.value.pendingContext == null) return
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
                EditorNavigator.open(project, path, message.line, message.endLine) { error ->
                    bridge?.send(HostMessages.notice(error))
                }
            }
            "open_url" -> message.url?.let { EditorNavigator.openUrl(it) }
            "log" -> message.message?.let { text ->
                val prefix = diagnosticPrefix()
                LOG.info("$prefix [webview] $text")
                scope.launch { service.logDiagnostic("$prefix $text") }
            }

            // ---- M3: sessions ------------------------------------------------------------------
            "list_sessions" -> scope.launch { sendSessions() }
            "get_tree" -> scope.launch { sendTree() }
            "new_session" -> scope.launch {
                changeSession("new") { service.newSession() }
            }
            "switch_session" -> {
                val path = message.path ?: return
                if (!activateSession(path)) {
                    scope.launch { changeSession("switch") { service.switchSession(path) } }
                }
            }
            "fork" -> {
                val entryId = message.entryId ?: return
                scope.launch { changeSession("fork", message.images) { service.fork(entryId) } }
            }
            "rename_session" -> {
                val name = message.name?.trim() ?: return
                scope.launch {
                    val targetPath = message.path
                    val currentPath = service.status.value.sessionFile
                    if (targetPath != null && targetPath != currentPath) {
                        if (service.renameSessionFile(targetPath, name)) sendSessions()
                        else bridge?.send(HostMessages.notice("failed to rename session: $targetPath"))
                    } else {
                        val response = request { service.setSessionName(name) }
                        if (response?.success == true) {
                            request { service.requestState() }
                            sendSessions()
                        }
                    }
                }
            }
            "delete_session" -> {
                val path = message.path ?: return
                scope.launch { deleteSession(path) }
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
            "set_default_model" -> {
                val provider = message.provider ?: return
                val modelId = message.modelId ?: return
                scope.launch {
                    if (PiSettings.get().syncDefaultModel(provider, modelId)) {
                        sendModels()
                    } else {
                        bridge?.send(
                            HostMessages.notice(
                                "failed to update ~/.pi/agent/settings.json",
                                level = "error",
                            ),
                        )
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
            "list_files" -> refreshProjectFiles()
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

    /**
     * Removes a session file from disk. Deleting the active session switches to a fresh one first
     * so pi stops appending to the file that is about to disappear; an extension can cancel that
     * switch, which also cancels the delete.
     */
    private suspend fun deleteSession(path: String) {
        val activeBridge = bridge ?: return
        val wasCurrent = service.status.value.sessionFile == path
        if (wasCurrent) {
            val switched = request { service.newSession() } ?: return
            if (switched.decodeDataAs<RpcSwitchResult>()?.cancelled == true) {
                activeBridge.send(HostMessages.notice("session change was cancelled by an extension", level = "info"))
                return
            }
        }
        val deleted = try {
            service.deleteSession(path)
        } catch (t: Throwable) {
            activeBridge.send(HostMessages.notice("failed to delete session: ${t.message}"))
            false
        }
        if (!deleted) {
            activeBridge.send(HostMessages.notice("failed to delete session: $path"))
            return
        }
        if (wasCurrent) reloadTranscript("delete")
        sendSessions()
        sendTree()
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
        val currentProvider = service.status.value.provider
        val currentModel = service.status.value.model
        val settings = PiSettings.get().getState()
        val defaultProvider = settings.defaultModelProvider.trim().takeIf { it.isNotEmpty() } ?: currentProvider
        val defaultModel = settings.defaultModelId.trim().takeIf { it.isNotEmpty() } ?: currentModel
        activeBridge.send(
            HostMessages.models(models, currentProvider, currentModel, defaultProvider, defaultModel),
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
    private suspend fun changeSession(
        reason: String,
        forkImages: List<ClientImage> = emptyList(),
        action: suspend () -> RpcResponse,
    ) {
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
            response.decodeDataAs<RpcForkResult>()?.let { fork ->
                val text = fork.text.orEmpty()
                if (text.isNotBlank() || forkImages.isNotEmpty()) {
                    activeBridge.send(HostMessages.prefill(text, forkImages))
                }
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
        synchronized(heldUpdatesLock) { heldUpdates.clear() }
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
                liveFirstUserText = firstUserText(messages)
                emitTitle()
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
        for (rawMessage in messages) {
            val message = capJsonDepth(protectLargeHistoryMessage(rawMessage))
            val length = estimateJsonBytes(message)
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

    private fun maybePlayTaskCompletionSound(event: PiEvent.Session) {
        val aborted = (event.payload["aborted"] as? JsonPrimitive)?.contentOrNull?.toBoolean() == true
        if (aborted || !PiSettings.get().getState().taskCompletionSoundEnabled) return
        soundExecutor.execute {
            runCatching { Toolkit.getDefaultToolkit().beep() }
        }
    }

    private fun handleExtensionUiRequest(event: PiEvent.ExtensionUiRequest) {
        val payload = event.payload
        when (event.method) {
            "select" -> ApplicationManager.getApplication().invokeLater {
                val options = (payload["options"] as? kotlinx.serialization.json.JsonArray)
                    ?.mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull }
                    ?.toTypedArray() ?: emptyArray()
                val result = Messages.showDialog(
                    project,
                    payload.string("title") ?: "Select",
                    "pi extension",
                    options,
                    0,
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
                    val window = com.intellij.openapi.wm.ToolWindowManager.getInstance(project).getToolWindow("Pi")
                    window?.stripeTitle = title
                }
            }
            "set_editor_text" -> payload.string("text")?.let { bridge?.send(HostMessages.prefill(it)) }
        }
    }

    private fun refreshProjectFiles() {
        synchronized(projectFilesRefreshLock) {
            projectFilesRefreshRequested = true
            if (projectFilesRefreshJob?.isActive == true) return
            projectFilesRefreshJob = scope.launch {
                while (isActive) {
                    delay(PROJECT_FILES_REFRESH_DEBOUNCE_MS)
                    val refresh = synchronized(projectFilesRefreshLock) {
                        if (!projectFilesRefreshRequested) {
                            projectFilesRefreshJob = null
                            false
                        } else {
                            projectFilesRefreshRequested = false
                            true
                        }
                    }
                    if (!refresh) return@launch

                    val files = service.projectFiles()
                    bridge?.send(HostMessages.files(files))

                    val done = synchronized(projectFilesRefreshLock) {
                        if (projectFilesRefreshRequested) false else {
                            projectFilesRefreshJob = null
                            true
                        }
                    }
                    if (done) return@launch
                }
            }
        }
    }

    /** Session name if set, else the first user message as a fallback tab title; null when neither exists. */
    private fun emitTitle() {
        val name = service.status.value.sessionName?.trim()?.takeIf { it.isNotEmpty() }
        val fallback = liveFirstUserText?.trim()?.takeIf { it.isNotEmpty() }
        onTitleChanged(name ?: fallback)
    }

    /** Captures the first user message from live session events for the tab title fallback. */
    private fun maybeCaptureFirstUserText(payload: JsonElement) {
        if (liveFirstUserText != null) return
        val record = payload as? JsonObject ?: return
        if (record.string("type") !in setOf("message_start", "message_update", "message_end")) return
        val message = record["message"] as? JsonObject ?: return
        if (message.string("role") != "user") return
        val text = messageText(message) ?: return
        liveFirstUserText = text
        emitTitle()
    }

    /** First user message of a hydrated transcript, normalized like [dev.pi.jetbrains.session.SessionIndex]. */
    private fun firstUserText(messages: List<JsonElement>): String? = messages.firstNotNullOfOrNull { element ->
        val message = element as? JsonObject ?: return@firstNotNullOfOrNull null
        if (message.string("role") != "user") return@firstNotNullOfOrNull null
        messageText(message)
    }

    private fun messageText(message: JsonObject): String? {
        val content = message["content"] ?: return null
        val text = when (content) {
            is JsonPrimitive -> content.contentOrNull
            is JsonArray -> content.mapNotNull { block ->
                val obj = block as? JsonObject ?: return@mapNotNull null
                if (obj.string("type") == "text") obj.string("text") else null
            }.joinToString(" ")
            else -> null
        } ?: return null
        return text.replace(Regex("\\s+"), " ").trim().take(200).takeIf { it.isNotEmpty() }
    }

    private fun isProjectFileEvent(file: VirtualFile?): Boolean {
        val basePath = project.basePath ?: return false
        val eventPath = file?.path ?: return false
        return eventPath == basePath || eventPath.startsWith("$basePath/") || eventPath.startsWith("$basePath\\")
    }

    private fun respond(response: RpcExtensionUiResponse) {
        scope.launch { runCatching { service.respondToExtensionUi(response) } }
    }

    private fun toRecord(event: PiEvent): JsonElement? = when (event) {
        is PiEvent.Session -> protectWebviewRecord(event.payload)
        is PiEvent.ExtensionUiRequest -> protectWebviewRecord(event.payload)
        is PiEvent.Response -> protectWebviewRecord(HostMessages.response(event.response))
        is PiEvent.Unknown -> null
    }

    /** Bounds every live record before it can enter the WebView, not only tool results. */
    private fun protectWebviewRecord(record: JsonElement): JsonElement =
        WebviewRecords.protect(record) { text ->
            service.logDiagnostic("${diagnosticPrefix()} $text")
        }

    /**
     * Rebuilds the tree with a depth cap, iteratively. Both kotlinx's tree encoder and
     * JsonElement.toString() recurse per nesting level, so an arbitrarily deep tool payload can
     * overflow the Dispatchers.IO thread stack; replacing over-deep subtrees with a placeholder
     * keeps every later serialization (bridge, history, diagnostics) safe.
     */
    private fun capJsonDepth(root: JsonElement): JsonElement {
        var result: JsonElement = JsonNull
        val tasks = ArrayDeque<JsonDepthWork>()
        tasks.addLast(JsonDepthWork(root, 0) { result = it })
        while (tasks.isNotEmpty()) {
            val work = tasks.removeLast()
            val element = work.element
            when {
                element is JsonObject && work.depth < MAX_JSON_DEPTH -> {
                    val values = LinkedHashMap<String, JsonElement>(element.size)
                    work.assign(JsonObject(values))
                    for ((key, value) in element) {
                        tasks.addLast(JsonDepthWork(value, work.depth + 1) { cloned -> values[key] = cloned })
                    }
                }
                element is JsonArray && work.depth < MAX_JSON_DEPTH -> {
                    val values = ArrayList<JsonElement>(element.size)
                    work.assign(JsonArray(values))
                    for (value in element) {
                        values.add(JsonNull)
                        val index = values.lastIndex
                        tasks.addLast(JsonDepthWork(value, work.depth + 1) { cloned -> values[index] = cloned })
                    }
                }
                element is JsonObject || element is JsonArray ->
                    work.assign(JsonPrimitive("[nested JSON omitted: depth limit]"))
                else -> work.assign(element)
            }
        }
        return result
    }

    private class JsonDepthWork(
        val element: JsonElement,
        val depth: Int,
        val assign: (JsonElement) -> Unit,
    )

    private fun protectLargeHistoryMessage(message: JsonElement): JsonElement {
        val objectMessage = message as? JsonObject ?: return message
        if (objectMessage.string("role") != "toolResult") return message
        val content = objectMessage["content"] ?: return message
        val protectedContent = compactLargeResult(content) ?: return message
        return JsonObject(objectMessage.toMutableMap().apply { put("content", protectedContent) })
    }

    /**
     * Estimates JSON size iteratively. Calling JsonElement.toString() here is recursive and can
     * overflow the IO thread stack when a tool returns a very deeply nested JSON value.
     */
    private fun compactLargeResult(result: JsonElement): JsonObject? {
        val estimatedSize = estimateJsonBytes(result)
        if (estimatedSize <= MAX_TOOL_RESULT_BYTES) return null
        val resultObject = result as? JsonObject
        val details = resultObject?.get("details")?.takeIf { estimateJsonBytes(it) <= MAX_TOOL_RESULT_BYTES }
            ?: JsonObject(emptyMap())
        return JsonObject(
            linkedMapOf(
                "output" to JsonPrimitive(
                    "[output omitted: approximately ${formatBytes(estimatedSize)}; open the full output file to inspect it]",
                ),
                "outputTruncated" to JsonPrimitive(true),
                "details" to details,
            ),
        )
    }

    private fun estimateJsonBytes(root: JsonElement): Int {
        val pending = ArrayDeque<JsonWork>()
        pending.addLast(JsonWork(root, 0))
        var estimate = 0L
        while (pending.isNotEmpty() && estimate <= MAX_TOOL_RESULT_BYTES) {
            val work = pending.removeLast()
            if (work.depth > MAX_JSON_DEPTH) return MAX_TOOL_RESULT_BYTES + 1
            when (val element = work.element) {
                is JsonObject -> {
                    estimate += 2
                    for ((key, value) in element) {
                        // Quoted keys and escaped characters: use a conservative estimate.
                        estimate += key.length.toLong() * 2 + 4
                        pending.addLast(JsonWork(value, work.depth + 1))
                    }
                }
                is JsonArray -> {
                    estimate += 2
                    element.forEach { pending.addLast(JsonWork(it, work.depth + 1)) }
                }
                is JsonPrimitive -> estimate += element.content.length.toLong() * 2 + 8
            }
        }
        return estimate.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
    }

    private data class JsonWork(val element: JsonElement, val depth: Int)

    private fun formatBytes(bytes: Int): String =
        if (bytes >= 1024 * 1024) "${bytes / (1024 * 1024)} MB" else "${bytes / 1024} KB"


    private fun themeMessage(): JsonElement {
        val scheme = EditorColorsManager.getInstance().globalScheme
        val background = scheme.defaultBackground
        val foreground = scheme.defaultForeground
        val border = blend(background, foreground, 0.22f)
        val raised = blend(background, foreground, if (EditorColorsManager.getInstance().isDarkEditor) 0.12f else 0.06f)
        // Some headless/startup LAFs expose these UI colors as null. Theme delivery must never
        // prevent the tool window from being created, so use stable IDE-like fallbacks.
        val accent = runCatching { UIUtil.getActiveTextColor() }.getOrNull() ?: Color(0x2563EB)
        val error = runCatching { UIUtil.getErrorForeground() }.getOrNull() ?: Color(0xB42318)
        return HostMessages.theme(
            HostTheme(
                background = cssColor(background),
                foreground = cssColor(foreground),
                foregroundDim = cssColor(blend(foreground, background, 0.42f)),
                raisedBackground = cssColor(raised),
                border = cssColor(border),
                accent = cssColor(accent),
                error = cssColor(error),
                errorBackground = cssColor(blend(background, error, 0.14f)),
                dark = EditorColorsManager.getInstance().isDarkEditor,
                fontSize = PiSettings.get().getState().chatFontSize
                    .coerceIn(PiSettings.MIN_CHAT_FONT_SIZE, PiSettings.MAX_CHAT_FONT_SIZE)
                    .toFloat(),
            ),
        )
    }

    private fun cssColor(color: java.awt.Color): String =
        "#%02x%02x%02x".format(color.red, color.green, color.blue)

    private fun blend(first: java.awt.Color, second: java.awt.Color, amount: Float): java.awt.Color {
        val ratio = amount.coerceIn(0f, 1f)
        fun channel(a: Int, b: Int): Int = (a + (b - a) * ratio).toInt().coerceIn(0, 255)
        return java.awt.Color(channel(first.red, second.red), channel(first.green, second.green), channel(first.blue, second.blue))
    }

    private fun readWebviewHtml(): String? =
        ChatPanel::class.java.getResourceAsStream(WEBVIEW_RESOURCE)?.use { stream ->
            stream.readBytes().toString(Charsets.UTF_8)
        }

    override fun dispose() {
        soundExecutor.shutdownNow()
        scope.cancel()
        bridge?.let { Disposer.dispose(it) }
        browser?.let { Disposer.dispose(it) }
        browser = null
        bridge = null
    }

    companion object {
        private val LOG = Logger.getInstance(ChatPanel::class.java)
        private const val WEBVIEW_RESOURCE = "/webview/index.html"
        private const val FLUSH_INTERVAL_MS = 16L
        private const val TOOL_UPDATE_FLUSH_MS = 100L
        private const val PROJECT_FILES_REFRESH_DEBOUNCE_MS = 250L
        private const val MAX_PENDING_RECORDS = 4096
        private const val DROP_LOG_INTERVAL_NS = 1_000_000_000L
        private const val HISTORY_CHUNK_CHARS = 256 * 1024
        private const val COMPACT_TIMEOUT_NOTICE = "compaction did not finish in time"
        private const val MAX_TOOL_RESULT_BYTES = 512 * 1024
        private const val MAX_JSON_DEPTH = 64
        private const val DIAGNOSTIC_INTERVAL_NS = 1_000_000_000L
    }
}
