package dev.pi.jetbrains.ui

import dev.pi.jetbrains.PiChatService
import dev.pi.jetbrains.rpc.PiJson
import dev.pi.jetbrains.rpc.RpcModelInfo
import dev.pi.jetbrains.rpc.RpcResponse
import dev.pi.jetbrains.rpc.RpcSlashCommand
import dev.pi.jetbrains.session.FlatTreeEntry
import dev.pi.jetbrains.session.SessionSummary
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** One message from Kotlin to the webview; see `web/src/types.ts` (`Inbound`). */
@Serializable
data class HostContextUsage(
    val tokens: Long? = null,
    val contextWindow: Long? = null,
    val percent: Double? = null,
)

/** Cumulative session usage shown in the TUI-style footer. */
@Serializable
data class HostUsage(
    val input: Long? = null,
    val output: Long? = null,
    val cacheRead: Long? = null,
    val cacheWrite: Long? = null,
    val cost: Double? = null,
)

@Serializable
data class HostRetry(
    val attempt: Int = 0,
    val maxAttempts: Int = 0,
    val delayMs: Long = 0,
    val errorMessage: String? = null,
)

@Serializable
data class HostStatus(
    val phase: String,
    val message: String,
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
    val usage: HostUsage? = null,
    val context: HostContextUsage? = null,
    val retry: HostRetry? = null,
    val pendingContext: String? = null,
) {
    companion object {
        fun from(status: PiChatService.Status): HostStatus = HostStatus(
            phase = status.phase.name.lowercase(),
            message = status.message,
            node = status.node,
            pi = status.pi,
            sessionId = status.sessionId,
            sessionFile = status.sessionFile,
            sessionName = status.sessionName,
            model = status.model,
            provider = status.provider,
            reasoning = status.reasoning,
            thinkingLevel = status.thinkingLevel,
            isStreaming = status.isStreaming,
            isCompacting = status.isCompacting,
            autoCompaction = status.autoCompaction,
            contextWindow = status.contextWindow,
            usage = status.context?.let { usage ->
                HostUsage(
                    input = usage.input,
                    output = usage.output,
                    cacheRead = usage.cacheRead,
                    cacheWrite = usage.cacheWrite,
                    cost = usage.cost,
                )
            },
            context = status.context?.let { usage ->
                HostContextUsage(usage.tokens, usage.contextWindow, usage.percent)
            },
            retry = status.retry?.let {
                HostRetry(it.attempt, it.maxAttempts, it.delayMs, it.errorMessage)
            },
            pendingContext = status.pendingContext,
        )
    }
}

@Serializable
data class HostTheme(
    val background: String,
    val foreground: String,
    val foregroundDim: String,
    val raisedBackground: String,
    val border: String,
    val accent: String,
    val error: String,
    val errorBackground: String,
    val dark: Boolean,
    val fontSize: Float,
)

@Serializable
data class HostThemeMessage(val type: String = "theme", val theme: HostTheme)

@Serializable
data class HostStatusMessage(val type: String = "status", val status: HostStatus)

@Serializable
data class HostRecordsMessage(val type: String = "records", val records: List<JsonElement>)

@Serializable
data class HostHistoryMessage(
    val type: String = "history",
    val messages: List<JsonElement>,
    val final: Boolean,
)

@Serializable
data class HostNoticeMessage(
    val type: String = "notice",
    val level: String = "error",
    val message: String,
)

@Serializable
data class HostExtensionStatusMessage(
    val type: String = "extension_status",
    val key: String,
    val text: String? = null,
)

@Serializable
data class HostWidgetMessage(
    val type: String = "widget",
    val key: String,
    val lines: List<String> = emptyList(),
    val placement: String = "aboveEditor",
)

/** One session row for the session picker (plan M3.2). */
@Serializable
data class HostSession(
    val path: String,
    val id: String,
    val name: String? = null,
    val cwd: String? = null,
    val created: Long? = null,
    val modified: Long = 0,
    val messageCount: Int = 0,
    val firstMessage: String? = null,
    val parentSessionPath: String? = null,
    val current: Boolean = false,
) {
    companion object {
        fun from(summary: SessionSummary, currentPath: String?): HostSession = HostSession(
            path = summary.path,
            id = summary.id,
            name = summary.name,
            cwd = summary.cwd,
            created = summary.created,
            modified = summary.modified,
            messageCount = summary.messageCount,
            firstMessage = summary.firstMessage,
            parentSessionPath = summary.parentSessionPath,
            current = summary.path == currentPath,
        )
    }
}

@Serializable
data class HostSessionsMessage(val type: String = "sessions", val sessions: List<HostSession>)

/** One row of the flattened `get_tree` result (plan M3.3). */
@Serializable
data class HostTreeEntry(
    val id: String,
    val parentId: String? = null,
    val type: String,
    val role: String? = null,
    val label: String? = null,
    val text: String = "",
    val depth: Int = 0,
    val forkable: Boolean = false,
    val active: Boolean = false,
    val images: List<ClientImage> = emptyList(),
) {
    companion object {
        fun from(entry: FlatTreeEntry): HostTreeEntry = HostTreeEntry(
            id = entry.id,
            parentId = entry.parentId,
            type = entry.type,
            role = entry.role,
            label = entry.label,
            text = entry.text,
            depth = entry.depth,
            forkable = entry.forkable,
            active = entry.active,
            images = entry.images.map { ClientImage(data = it.data, mimeType = it.mimeType) },
        )
    }
}

@Serializable
data class HostTreeMessage(
    val type: String = "session_tree",
    val entries: List<HostTreeEntry>,
    val leafId: String? = null,
    val sessionId: String? = null,
)

/** Picker row for `get_available_models` (plan M3.4). */
@Serializable
data class HostModel(
    val id: String,
    val name: String? = null,
    val provider: String? = null,
    val reasoning: Boolean? = null,
    val contextWindow: Long? = null,
) {
    companion object {
        fun from(model: RpcModelInfo): HostModel = HostModel(
            id = model.id,
            name = model.name,
            provider = model.provider,
            reasoning = model.reasoning,
            contextWindow = model.contextWindow,
        )
    }
}

@Serializable
data class HostModelsMessage(
    val type: String = "models",
    val models: List<HostModel>,
    val currentProvider: String? = null,
    val currentModel: String? = null,
    val defaultProvider: String? = null,
    val defaultModel: String? = null,
)

@Serializable
data class HostThinkingLevelsMessage(
    val type: String = "thinking_levels",
    val levels: List<String>,
    val current: String? = null,
)

/** Slash command completion row (plan M3.8). */
@Serializable
data class HostCommand(
    val name: String,
    val description: String? = null,
    val source: String = "prompt",
) {
    companion object {
        fun from(command: RpcSlashCommand): HostCommand =
            HostCommand(command.name, command.description, command.source)
    }
}

@Serializable
data class HostCommandsMessage(val type: String = "commands", val commands: List<HostCommand>)

@Serializable
data class HostFilesMessage(val type: String = "files", val files: List<String>)

/** Clears the transcript after `switch_session` / `new_session` / `fork`. */
@Serializable
data class HostResetMessage(val type: String = "reset", val reason: String = "session")

/** Seeds the composer, e.g. with the prompt text returned by `fork`. */
@Serializable
data class HostPrefillMessage(
    val type: String = "prefill",
    val text: String,
    val images: List<ClientImage> = emptyList(),
)

@Serializable
data class HostFocusComposerMessage(val type: String = "focus_composer")

@Serializable
data class HostScrollToLatestMessage(val type: String = "scroll_to_latest")

/** One message from the webview to Kotlin; see `web/src/types.ts` (`Outbound`). */
@Serializable
data class ClientMessage(
    val type: String,
    val message: String? = null,
    /** `open_path` / `open_url` payloads (M2 editor navigation). */
    val path: String? = null,
    val line: Int? = null,
    val endLine: Int? = null,
    val url: String? = null,
    /** M3 model / thinking / session selectors. */
    val provider: String? = null,
    val modelId: String? = null,
    val level: String? = null,
    val enabled: Boolean? = null,
    val entryId: String? = null,
    /** Session title for `set_session_name`. */
    val name: String? = null,
    /** Clipboard/editor images sent with a prompt. */
    val images: List<ClientImage> = emptyList(),
)

@Serializable
data class ClientImage(
    val data: String,
    val mimeType: String,
)

/** Encodes host messages with the shared RPC JSON settings. */
object HostMessages {
    fun theme(theme: HostTheme): JsonElement =
        PiJson.encodeToJsonElement(HostThemeMessage.serializer(), HostThemeMessage(theme = theme))

    fun status(status: PiChatService.Status): JsonElement =
        PiJson.encodeToJsonElement(HostStatusMessage.serializer(), HostStatusMessage(status = HostStatus.from(status)))

    /** The reducer only reads response metadata; data travels via dedicated host messages. */
    fun response(response: RpcResponse): JsonElement =
        PiJson.encodeToJsonElement(RpcResponse.serializer(), response.copy(data = null))

    fun records(records: List<JsonElement>): JsonElement =
        PiJson.encodeToJsonElement(HostRecordsMessage.serializer(), HostRecordsMessage(records = records))

    fun history(messages: List<JsonElement>, final: Boolean): JsonElement =
        PiJson.encodeToJsonElement(
            HostHistoryMessage.serializer(),
            HostHistoryMessage(messages = messages, final = final),
        )

    fun notice(message: String, level: String = "error"): JsonElement =
        PiJson.encodeToJsonElement(
            HostNoticeMessage.serializer(),
            HostNoticeMessage(level = level, message = message),
        )

    fun extensionStatus(key: String, text: String?): JsonElement =
        PiJson.encodeToJsonElement(
            HostExtensionStatusMessage.serializer(),
            HostExtensionStatusMessage(key = key, text = text),
        )

    fun widget(key: String, lines: List<String>, placement: String): JsonElement =
        PiJson.encodeToJsonElement(
            HostWidgetMessage.serializer(),
            HostWidgetMessage(key = key, lines = lines, placement = placement),
        )

    fun sessions(sessions: List<SessionSummary>, currentPath: String?): JsonElement =
        PiJson.encodeToJsonElement(
            HostSessionsMessage.serializer(),
            HostSessionsMessage(sessions = sessions.map { HostSession.from(it, currentPath) }),
        )

    fun tree(entries: List<FlatTreeEntry>, leafId: String?, sessionId: String?): JsonElement =
        PiJson.encodeToJsonElement(
            HostTreeMessage.serializer(),
            HostTreeMessage(
                entries = entries.map { HostTreeEntry.from(it) },
                leafId = leafId,
                sessionId = sessionId,
            ),
        )

    fun models(
        models: List<RpcModelInfo>,
        currentProvider: String?,
        currentModel: String?,
        defaultProvider: String? = null,
        defaultModel: String? = null,
    ): JsonElement =
        PiJson.encodeToJsonElement(
            HostModelsMessage.serializer(),
            HostModelsMessage(
                models = models.map { HostModel.from(it) },
                currentProvider = currentProvider,
                currentModel = currentModel,
                defaultProvider = defaultProvider,
                defaultModel = defaultModel,
            ),
        )

    fun thinkingLevels(levels: List<String>, current: String?): JsonElement =
        PiJson.encodeToJsonElement(
            HostThinkingLevelsMessage.serializer(),
            HostThinkingLevelsMessage(levels = levels, current = current),
        )

    fun commands(commands: List<RpcSlashCommand>): JsonElement =
        PiJson.encodeToJsonElement(
            HostCommandsMessage.serializer(),
            HostCommandsMessage(commands = commands.map { HostCommand.from(it) }),
        )

    fun files(files: List<String>): JsonElement =
        PiJson.encodeToJsonElement(HostFilesMessage.serializer(), HostFilesMessage(files = files))

    fun reset(reason: String = "session"): JsonElement =
        PiJson.encodeToJsonElement(HostResetMessage.serializer(), HostResetMessage(reason = reason))

    fun prefill(text: String, images: List<ClientImage> = emptyList()): JsonElement =
        PiJson.encodeToJsonElement(
            HostPrefillMessage.serializer(),
            HostPrefillMessage(text = text, images = images),
        )

    fun focusComposer(): JsonElement =
        PiJson.encodeToJsonElement(HostFocusComposerMessage.serializer(), HostFocusComposerMessage())

    fun scrollToLatest(): JsonElement =
        PiJson.encodeToJsonElement(HostScrollToLatestMessage.serializer(), HostScrollToLatestMessage())
}
