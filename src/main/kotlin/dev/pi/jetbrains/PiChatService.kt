package dev.pi.jetbrains

import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.project.Project
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.event.SelectionEvent
import com.intellij.openapi.editor.event.SelectionListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.PathManager
import dev.pi.jetbrains.editor.ToolFileRefresher
import dev.pi.jetbrains.editor.ProjectFileCollector
import dev.pi.jetbrains.rpc.PiClient
import dev.pi.jetbrains.rpc.PiEvent
import dev.pi.jetbrains.rpc.PiJson
import dev.pi.jetbrains.rpc.PiProcess
import dev.pi.jetbrains.rpc.RpcCommand
import dev.pi.jetbrains.rpc.RpcResponse
import dev.pi.jetbrains.rpc.RpcExtensionUiResponse
import dev.pi.jetbrains.rpc.RpcImage
import dev.pi.jetbrains.rpc.RpcSessionStats
import dev.pi.jetbrains.rpc.decodeDataAs
import dev.pi.jetbrains.rpc.sessionState
import dev.pi.jetbrains.runtime.NodeResolution
import dev.pi.jetbrains.runtime.NodeRuntimeResolver
import dev.pi.jetbrains.runtime.PiPackageResolver
import dev.pi.jetbrains.runtime.PiResolution
import dev.pi.jetbrains.session.SessionIndex
import dev.pi.jetbrains.session.SessionSummary
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.nio.file.StandardOpenOption
import java.time.Duration
import kotlin.concurrent.thread

/** Owns one tab's pi child process. All tabs use the project root as their working directory. */
class PiChatService(private val project: Project) : Disposable {
    enum class Phase { STOPPED, STARTING, RUNNING, FAILED }

    data class StatusUsage(
        val tokens: Long? = null,
        val contextWindow: Long? = null,
        val percent: Double? = null,
        val input: Long? = null,
        val output: Long? = null,
        val cacheRead: Long? = null,
        val cacheWrite: Long? = null,
        val cost: Double? = null,
    )

    /** Active `auto_retry_start` … `auto_retry_end` window (plan M3.7). */
    data class RetryInfo(
        val attempt: Int,
        val maxAttempts: Int,
        val delayMs: Long,
        val errorMessage: String? = null,
    )

    data class Status(
        val phase: Phase = Phase.STOPPED,
        val message: String = "not started",
        val node: String? = null,
        val pi: String? = null,
        val sessionId: String? = null,
        val sessionFile: String? = null,
        val sessionName: String? = null,
        val model: String? = null,
        val provider: String? = null,
        val reasoning: Boolean? = null,
        val thinkingLevel: String? = null,
        val isStreaming: Boolean = false,
        val isCompacting: Boolean = false,
        val autoCompaction: Boolean = true,
        val contextWindow: Long? = null,
        val context: StatusUsage? = null,
        val retry: RetryInfo? = null,
        val pendingContext: String? = null,
    )

    private val _status = MutableStateFlow(Status())
    val status: StateFlow<Status> = _status.asStateFlow()

    /** Text selected in a console and waiting to be placed in the chat composer. */
    private val _prefill = MutableStateFlow<String?>(null)
    val prefill: StateFlow<String?> = _prefill.asStateFlow()

    private val _events = MutableSharedFlow<PiEvent>(
        extraBufferCapacity = 1024,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val events: SharedFlow<PiEvent> = _events.asSharedFlow()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val fileRefresher = ToolFileRefresher(project)
    @Volatile
    private var editorContext: String? = null
    private val selectionListener = object : SelectionListener {
        override fun selectionChanged(event: SelectionEvent) {
            if (event.editor.project == project) updateEditorContext(event.editor)
        }
    }
    private var forwardJob: Job? = null
    private var startJob: Job? = null
    private var heartbeatJob: Job? = null
    private var recoveryJob: Job? = null
    private var proxyRestartJob: Job? = null

    @Volatile
    private var client: PiClient? = null

    @Volatile
    private var recoveryInProgress = false

    @Volatile
    private var pendingRecoverySession: String? = null

    @Volatile
    private var stopRequested = false

    init {
        ApplicationManager.getApplication().messageBus.connect(this).subscribe(
            PiSettings.NETWORK_PROXY_CHANGED,
            PiNetworkProxyListener { restartForNetworkProxy() },
        )
        EditorFactory.getInstance().eventMulticaster.addSelectionListener(selectionListener, this)
        ApplicationManager.getApplication().invokeLater { refreshEditorContext() }
    }

    fun start() {
        if (_status.value.phase == Phase.STARTING || _status.value.phase == Phase.RUNNING) return
        stopRequested = false
        // Drop stats from a previous process so the footer never shows a stale session.
        _status.update {
            Status(
                phase = Phase.STARTING,
                message = "resolving node and pi",
                pendingContext = editorContext?.let(::contextPreview),
            )
        }

        startJob = scope.launch {
            val configuredNode = PiSettings.get().getState().nodePath.trim().takeIf { it.isNotEmpty() }?.let {
                runCatching { Paths.get(it) }.getOrNull()
            }
            val nodeRuntime = when (val node = NodeRuntimeResolver(
                bundledNode = bundledNodeBinary(),
                configuredNode = configuredNode,
            ).resolve()) {
                is NodeResolution.NotFound -> return@launch fail(node.reason)
                is NodeResolution.Found -> node
            }

            val installation = when (val pi = PiPackageResolver().resolve()) {
                is PiResolution.NotFound -> return@launch fail(
                    "pi coding agent not found: ${pi.attempts.joinToString("; ")}",
                )
                is PiResolution.Found -> pi
            }

            val workDir = projectWorkDir() ?: return@launch fail("project has no base directory")
            // Keep GUI behavior consistent with pi TUI: tool calls are not intercepted by an
            // approval extension. pi itself has no built-in approval gate.
            val command = listOf(
                nodeRuntime.executable.toString(),
                installation.cliEntry.toString(),
                "--mode", "rpc",
            )
            currentCoroutineContext().ensureActive()
            val process = PiProcess(
                command = command,
                workDir = workDir,
                environment = PiSettings.get().processEnvironment(),
                log = { diagnosticLog("[${project.name}] $it") },
            )
            lateinit var startedClient: PiClient
            startedClient = PiClient(
                process = process,
                log = { diagnosticLog(it) },
                onExit = { code ->
                    // Ignore a late callback from a process replaced during recovery.
                    if (client === startedClient) onProcessExit(code)
                },
            )
            val newClient = startedClient
            val startContext = currentCoroutineContext()
            val spawned = synchronized(this@PiChatService) {
                // Cancellation and detachment must not race with registering/spawning a client.
                startContext.ensureActive()
                client = newClient
                forwardJob = scope.launch {
                    newClient.events.collect { event ->
                        updateStatusFromEvent(event)
                        fileRefresher.onEvent(event)
                        _events.emit(event)
                    }
                }
                newClient.start()
            }
            startContext.ensureActive()

            if (!spawned) {
                client = null
                forwardJob?.cancel()
                return@launch fail("failed to start node process")
            }

            _status.update {
                it.copy(
                    phase = Phase.STARTING,
                    message = "waiting for pi state",
                    node = "${nodeRuntime.executable} (node ${nodeRuntime.version})",
                    pi = "${installation.cliEntry} (${installation.version ?: "unknown version"}, ${installation.origin})",
                )
            }
            LOG.info("pi rpc started: pid=${process.pid} cwd=$workDir cli=${installation.cliEntry}")

            try {
                val stateResponse = requestState()
                val restorePath = pendingRecoverySession
                if (stateResponse.success && restorePath != null) {
                    val restored = switchSession(restorePath)
                    if (restored.success) requestState()
                    else fail("recovery could not restore session: ${restored.error ?: "unknown error"}")
                    pendingRecoverySession = null
                }
                if (_status.value.phase == Phase.RUNNING) startHeartbeat()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (t: Throwable) {
                fail("get_state failed: ${t.message}")
            }
        }
    }

    /** Restarts active tabs off the EDT, closing the old writer before restoring its session. */
    private fun restartForNetworkProxy() {
        if (_status.value.phase != Phase.STARTING && _status.value.phase != Phase.RUNNING) return
        val sessionPath = pendingRecoverySession ?: _status.value.sessionFile
        val previousStart = startJob
        val previousRestart = proxyRestartJob
        val active = detachClient()
        pendingRecoverySession = sessionPath
        _status.update { it.copy(phase = Phase.STARTING, message = "applying network proxy; restarting pi…") }
        proxyRestartJob = scope.launch(start = CoroutineStart.UNDISPATCHED) {
            // Even if stopped or reconfigured again, release the detached process off the EDT.
            withContext(Dispatchers.IO + NonCancellable) {
                previousRestart?.join()
                previousStart?.join()
                active?.close()
            }
            currentCoroutineContext().ensureActive()
            _status.update { it.copy(phase = Phase.STOPPED, message = "restarting pi…") }
            start()
        }
    }

    /** Stops the child process; safe to call from the EDT. */
    fun stop() {
        val active = detachClient()
        pendingRecoverySession = null
        if (active != null) {
            // Termination blocks until the process is gone, so keep it off the caller's thread.
            thread(name = "pi-stop", isDaemon = true) { active.close() }
        }
        _status.update { it.copy(phase = Phase.STOPPED, message = "stopped", retry = null) }
    }

    @Synchronized
    private fun detachClient(): PiClient? {
        stopRequested = true
        proxyRestartJob?.cancel()
        proxyRestartJob = null
        startJob?.cancel()
        startJob = null
        heartbeatJob?.cancel()
        heartbeatJob = null
        recoveryJob?.cancel()
        recoveryJob = null
        forwardJob?.cancel()
        forwardJob = null
        recoveryInProgress = false

        val active = client
        client = null
        return active
    }

    /** Sends `get_state` and refreshes the status line. */
    suspend fun requestState(timeout: Duration = Duration.ofSeconds(30)): RpcResponse {
        val response = requireClient().send(RpcCommand(type = "get_state"), timeout).await()
        if (!response.success) {
            fail("get_state failed: ${response.error ?: "unknown error"}")
            return response
        }
        response.sessionState()?.let { state ->
            _status.update {
                it.copy(
                    phase = Phase.RUNNING,
                    message = "ready",
                    sessionId = state.sessionId,
                    sessionFile = state.sessionFile,
                    sessionName = state.sessionName,
                    model = state.model?.id,
                    provider = state.model?.provider,
                    reasoning = state.model?.reasoning,
                    contextWindow = state.model?.contextWindow,
                    thinkingLevel = state.thinkingLevel,
                    isStreaming = state.isStreaming,
                    isCompacting = state.isCompacting,
                    autoCompaction = state.autoCompactionEnabled ?: it.autoCompaction,
                )
            }
        }
        return response
    }

    /** Sends a prompt; queued editor context is prepended only once. */
    suspend fun prompt(message: String, images: List<RpcImage> = emptyList()): RpcResponse {
        val context = editorContext
        val fullMessage = when {
            context.isNullOrBlank() -> message
            message.isBlank() -> context
            else -> "$context\n\n$message"
        }
        return requireClient().send(
            RpcCommand(type = "prompt", message = fullMessage, images = images.takeIf { it.isNotEmpty() }),
        ).await()
    }

    /** Returns project-relative files and directories used by the composer @ reference picker. */
    fun projectFiles(): List<String> {
        val base = projectWorkDir() ?: return emptyList()
        return ProjectFileCollector.collect(base)
    }

    fun setEditorContext(context: String?) {
        editorContext = context?.takeIf { it.isNotBlank() }
        _status.update { it.copy(pendingContext = editorContext?.let(::contextPreview)) }
    }

    fun clearEditorContext() = setEditorContext(null)

    fun prefillComposer(text: String) {
        if (text.isNotBlank()) _prefill.value = text
    }

    fun clearPrefill(text: String) {
        _prefill.compareAndSet(text, null)
    }

    fun refreshEditorContext() {
        FileEditorManager.getInstance(project).selectedTextEditor?.let(::updateEditorContext)
            ?: setEditorContext(null)
    }

    private fun updateEditorContext(editor: Editor) {
        val selection = editor.selectionModel
        if (!selection.hasSelection()) {
            setEditorContext(null)
            return
        }
        val document = editor.document
        val file = FileDocumentManager.getInstance().getFile(document)
        if (file == null) {
            setEditorContext(null)
            return
        }
        val startOffset = selection.selectionStart
        val endOffset = selection.selectionEnd.coerceAtMost(document.textLength)
        val startLine = document.getLineNumber(startOffset)
        val endLine = document.getLineNumber((endOffset - 1).coerceAtLeast(startOffset))
        val path = project.basePath?.let { base ->
            val basePath = Paths.get(base).toAbsolutePath().normalize()
            val filePath = Paths.get(file.path).toAbsolutePath().normalize()
            runCatching { basePath.relativize(filePath).toString().replace('\\', '/') }.getOrNull()
        } ?: file.path
        val unsaved = FileDocumentManager.getInstance().isDocumentUnsaved(document)
        val context = buildString {
            append("--- ").append(path).append(":").append(startLine + 1)
            if (endLine != startLine) append("-").append(endLine + 1)
            append(if (unsaved) " (buffer) ---\n" else " ---\n")
            if (unsaved) append(document.getText(com.intellij.openapi.util.TextRange(startOffset, endOffset)))
        }
        setEditorContext(context)
    }

    private fun contextPreview(context: String): String {
        val first = context.lineSequence().firstOrNull { it.isNotBlank() }?.trim()
            ?: return "editor context"
        return first.removePrefix("--- ").removeSuffix(" ---").take(240)
    }

    fun respondToExtensionUi(response: RpcExtensionUiResponse): Boolean =
        requireClient().respondToExtensionUi(response)

    suspend fun abort(): RpcResponse =
        requireClient().send(RpcCommand(type = "abort")).await()

    /** Reads `get_session_stats` and refreshes the usage/context part of the footer. */
    suspend fun requestStats(): RpcResponse {
        val response = requireClient().send(RpcCommand(type = "get_session_stats")).await()
        if (response.success) {
            val stats = response.decodeDataAs<RpcSessionStats>()
            _status.update {
                it.copy(
                    context = stats?.let { s ->
                        StatusUsage(
                            tokens = s.contextUsage?.tokens,
                            contextWindow = s.contextUsage?.contextWindow,
                            percent = s.contextUsage?.percent,
                            input = s.tokens?.input,
                            output = s.tokens?.output,
                            cacheRead = s.tokens?.cacheRead,
                            cacheWrite = s.tokens?.cacheWrite,
                            cost = s.cost,
                        )
                    } ?: it.context,
                )
            }
        }
        return response
    }

    /** Full transcript from `get_messages`, used to hydrate the webview on open. */
    suspend fun messages(): List<JsonElement> {
        val response = requireClient().send(RpcCommand(type = "get_messages")).await()
        if (!response.success) throw IllegalStateException(response.error ?: "get_messages failed")
        val data = response.data as? JsonObject ?: return emptyList()
        return (data["messages"] as? JsonArray)?.toList() ?: emptyList()
    }

    // ---------------------------------------------------------------------------------------------
    // M3: sessions, models, thinking, compaction and retry
    // ---------------------------------------------------------------------------------------------

    /** Lists sessions of this project folder on disk; call from `Dispatchers.IO`. */
    fun listSessions(): List<SessionSummary> {
        val cwd = projectWorkDir() ?: return emptyList()
        return SessionIndex.list(cwd)
    }

    suspend fun switchSession(sessionPath: String): RpcResponse =
        requireClient().send(RpcCommand(type = "switch_session", sessionPath = sessionPath)).await()

    suspend fun newSession(): RpcResponse =
        requireClient().send(RpcCommand(type = "new_session")).await()

    suspend fun fork(entryId: String): RpcResponse =
        requireClient().send(RpcCommand(type = "fork", entryId = entryId)).await()

    suspend fun setSessionName(name: String): RpcResponse =
        requireClient().send(RpcCommand(type = "set_session_name", name = name)).await()

    /**
     * Renames a session that is not currently loaded by pi. The RPC command only targets the
     * active session, so inactive sessions receive the same append-only `session_info` record that
     * pi writes for an active rename.
     */
    fun renameSessionFile(sessionPath: String, name: String): Boolean {
        val file = runCatching { Paths.get(sessionPath) }.getOrNull() ?: return false
        if (!Files.isRegularFile(file)) return false
        val record = JsonObject(
            mapOf(
                "type" to JsonPrimitive("session_info"),
                "id" to JsonPrimitive(java.util.UUID.randomUUID().toString()),
                "parentId" to kotlinx.serialization.json.JsonNull,
                "timestamp" to JsonPrimitive(java.time.Instant.now().toString()),
                "name" to JsonPrimitive(name),
            ),
        )
        return runCatching {
            Files.writeString(
                file,
                PiJson.encodeToString(JsonObject.serializer(), record) + System.lineSeparator(),
                Charsets.UTF_8,
                StandardOpenOption.APPEND,
            )
            true
        }.getOrDefault(false)
    }

    /** Deletes a session JSONL file on disk; call from `Dispatchers.IO`. */
    fun deleteSession(sessionPath: String): Boolean {
        val file = java.io.File(sessionPath)
        return file.isFile && file.delete()
    }

    suspend fun sessionTree(): RpcResponse =
        requireClient().send(RpcCommand(type = "get_tree")).await()

    suspend fun availableModels(): RpcResponse =
        requireClient().send(RpcCommand(type = "get_available_models")).await()

    suspend fun setModel(provider: String, modelId: String): RpcResponse =
        requireClient().send(RpcCommand(type = "set_model", provider = provider, modelId = modelId)).await()

    suspend fun availableThinkingLevels(): RpcResponse =
        requireClient().send(RpcCommand(type = "get_available_thinking_levels")).await()

    suspend fun setThinkingLevel(level: String): RpcResponse =
        requireClient().send(RpcCommand(type = "set_thinking_level", level = level)).await()

    /** Compaction can take minutes on a large context (plan 5.3). */
    suspend fun compact(customInstructions: String? = null): RpcResponse =
        requireClient().send(
            RpcCommand(type = "compact", customInstructions = customInstructions),
            COMPACT_TIMEOUT,
        ).await()

    suspend fun setAutoCompaction(enabled: Boolean): RpcResponse =
        requireClient().send(RpcCommand(type = "set_auto_compaction", enabled = enabled)).await()

    suspend fun abortRetry(): RpcResponse =
        requireClient().send(RpcCommand(type = "abort_retry")).await()

    suspend fun slashCommands(): RpcResponse =
        requireClient().send(RpcCommand(type = "get_commands")).await()

    override fun dispose() {
        stop()
        scope.cancel()
        fileRefresher.dispose()
    }

    private fun startHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = scope.launch {
            var failures = 0
            while (isActive && !stopRequested) {
                delay(HEARTBEAT_INTERVAL_MS)
                if (!isActive || stopRequested || _status.value.phase != Phase.RUNNING) continue
                val healthy = runCatching {
                    requireClient().send(RpcCommand(type = "get_state"), HEARTBEAT_TIMEOUT).await().success
                }.getOrDefault(false)
                if (healthy) {
                    failures = 0
                } else {
                    failures++
                    diagnosticLog("pi heartbeat failed ($failures/2)")
                    if (failures >= HEARTBEAT_FAILURES_BEFORE_RECOVERY) {
                        requestRecovery("pi heartbeat timed out")
                        return@launch
                    }
                }
            }
        }
    }

    private fun onProcessExit(code: Int?) {
        heartbeatJob?.cancel()
        heartbeatJob = null
        forwardJob?.cancel()
        forwardJob = null
        val stoppedDeliberately = stopRequested
        val sessionToRecover = _status.value.sessionFile
        client = null
        _status.update {
            if (stoppedDeliberately) {
                it.copy(phase = Phase.STOPPED, message = "stopped (code=$code)", retry = null)
            } else {
                it.copy(phase = Phase.FAILED, message = "pi exited unexpectedly (code=$code)", retry = null)
            }
        }
        if (!stoppedDeliberately) {
            requestRecovery("pi exited unexpectedly (code=${code ?: "unknown"})", sessionToRecover)
        }
    }

    /** Restarts once after a crash/heartbeat failure and switches back to the last session file. */
    private fun requestRecovery(reason: String, sessionPath: String? = _status.value.sessionFile) {
        if (stopRequested || recoveryInProgress) return
        synchronized(this) {
            if (stopRequested || recoveryInProgress) return
            recoveryInProgress = true
        }
        pendingRecoverySession = sessionPath
        diagnosticLog("starting recovery: $reason")
        _status.update { it.copy(phase = Phase.STARTING, message = "$reason; restarting pi…") }
        val active = client
        client = null
        stopRequested = true
        active?.let { thread(name = "pi-recovery-stop", isDaemon = true) { it.close() } }
        recoveryJob = scope.launch {
            delay(RECOVERY_DELAY_MS)
            stopRequested = false
            _status.update { it.copy(phase = Phase.STOPPED, message = "restarting pi…") }
            start()
            for (attempt in 0 until RECOVERY_START_WAIT_ATTEMPTS) {
                if (_status.value.phase == Phase.RUNNING && _status.value.message == "ready") break
                delay(RECOVERY_START_WAIT_MS)
            }
            recoveryInProgress = false
            recoveryJob = null
        }
    }

    /** Writes a diagnostic line to the configured log file. Safe to call from background threads. */
    fun logDiagnostic(message: String) = diagnosticLog(message)

    private fun diagnosticLog(message: String) {
        LOG.debug(message)
        val configuredDirectory = PiSettings.get().getState().logDirectory.trim()
        val directory = configuredDirectory.takeIf { it.isNotEmpty() } ?: PathManager.getLogPath()
        synchronized(diagnosticLogLock) {
            runCatching {
                val path = Paths.get(directory).resolve("pi.log")
                Files.createDirectories(path.parent)
                Files.writeString(
                    path,
                    "${java.time.Instant.now()} $message${System.lineSeparator()}",
                    Charsets.UTF_8,
                    StandardOpenOption.CREATE,
                    StandardOpenOption.WRITE,
                    StandardOpenOption.APPEND,
                )
            }
        }
    }

    private fun fail(message: String) {
        diagnosticLog(message)
        LOG.warn(message)
        _status.update { it.copy(phase = Phase.FAILED, message = message) }
    }

    /** Keeps the status line in sync with the stream; returns after status updates are queued. */
    private fun updateStatusFromEvent(event: PiEvent) {
        if (event !is PiEvent.Session) return
        when (event.type) {
            "agent_start" -> _status.update { it.copy(isStreaming = true) }
            "agent_settled" -> {
                _status.update { it.copy(isStreaming = false) }
                if (!stopRequested) {
                    scope.launch {
                        runCatching { requestState() }
                        runCatching { requestStats() }
                    }
                }
            }
            "message_end" -> {
                // Keep the token/cost totals moving during a run, not only at settle time.
                val role = (event.payload["message"] as? JsonObject)
                    ?.let { (it["role"] as? JsonPrimitive)?.contentOrNull }
                if (role == "assistant" && !stopRequested) {
                    scope.launch { runCatching { requestStats() } }
                }
            }
            "compaction_start" -> _status.update { it.copy(isCompacting = true) }
            "compaction_end" -> _status.update { it.copy(isCompacting = false) }
            "session_info_changed" -> {
                val name = (event.payload["name"] as? JsonPrimitive)?.contentOrNull
                _status.update { it.copy(sessionName = name) }
            }
            "auto_retry_start" -> _status.update {
                it.copy(
                    retry = RetryInfo(
                        attempt = (event.payload["attempt"] as? JsonPrimitive)?.contentOrNull?.toIntOrNull() ?: 0,
                        maxAttempts = (event.payload["maxAttempts"] as? JsonPrimitive)?.contentOrNull?.toIntOrNull() ?: 0,
                        delayMs = (event.payload["delayMs"] as? JsonPrimitive)?.contentOrNull?.toLongOrNull() ?: 0,
                        errorMessage = (event.payload["errorMessage"] as? JsonPrimitive)?.contentOrNull,
                    ),
                )
            }
            "auto_retry_end" -> _status.update {
                val success = (event.payload["success"] as? JsonPrimitive)?.contentOrNull?.toBoolean() ?: false
                val finalError = (event.payload["finalError"] as? JsonPrimitive)?.contentOrNull
                it.copy(
                    retry = null,
                    message = if (success) it.message else (finalError ?: it.message),
                )
            }
            "thinking_level_changed" -> {
                val level = (event.payload["level"] as? JsonPrimitive)?.contentOrNull
                if (level != null) _status.update { it.copy(thinkingLevel = level) }
            }
        }
    }

    private fun requireClient(): PiClient = client ?: throw IllegalStateException("pi is not running")

    private fun projectWorkDir(): Path? {
        val basePath = project.basePath ?: return null
        return runCatching { Paths.get(basePath) }.getOrNull()?.takeIf { Files.isDirectory(it) }
    }

    /** `<plugin>/node/<os>-<arch>/node[.exe]`, when the plugin ships a runtime (plan 7.1). */
    private fun bundledNodeBinary(): Path? {
        val pluginPath = PluginManagerCore.getPlugin(PLUGIN_ID)?.pluginPath ?: return null
        val osName = System.getProperty("os.name").lowercase()
        val os = when {
            osName.contains("win") -> "windows"
            osName.contains("mac") -> "mac"
            else -> "linux"
        }
        val arch = when (System.getProperty("os.arch").lowercase()) {
            "aarch64", "arm64" -> "arm64"
            else -> "x64"
        }
        val executable = if (os == "windows") "node.exe" else "node"
        val candidate = pluginPath.resolve("node").resolve("$os-$arch").resolve(executable)
        return candidate.takeIf { Files.isRegularFile(it) }
    }

    companion object {
        private val LOG = Logger.getInstance(PiChatService::class.java)
        private val diagnosticLogLock = Any()
        private val PLUGIN_ID = PluginId.getId("dev.pi.jetbrains")
        private val COMPACT_TIMEOUT: Duration = Duration.ofSeconds(300)
        private val HEARTBEAT_TIMEOUT: Duration = Duration.ofSeconds(10)
        private const val HEARTBEAT_INTERVAL_MS = 30_000L
        private const val HEARTBEAT_FAILURES_BEFORE_RECOVERY = 2
        private const val RECOVERY_DELAY_MS = 500L
        private const val RECOVERY_START_WAIT_MS = 250L
        private const val RECOVERY_START_WAIT_ATTEMPTS = 40
    }
}
