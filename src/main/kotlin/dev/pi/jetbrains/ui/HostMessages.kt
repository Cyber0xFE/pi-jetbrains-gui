package dev.pi.jetbrains.ui

import dev.pi.jetbrains.PiChatService
import dev.pi.jetbrains.rpc.PiJson
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
data class HostStatus(
    val phase: String,
    val message: String,
    val node: String? = null,
    val pi: String? = null,
    val sessionId: String? = null,
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
) {
    companion object {
        fun from(status: PiChatService.Status): HostStatus = HostStatus(
            phase = status.phase.name.lowercase(),
            message = status.message,
            node = status.node,
            pi = status.pi,
            sessionId = status.sessionId,
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
        )
    }
}

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

/** One message from the webview to Kotlin; see `web/src/types.ts` (`Outbound`). */
@Serializable
data class ClientMessage(
    val type: String,
    val message: String? = null,
    /** `open_path` / `open_url` payloads (M2 editor navigation). */
    val path: String? = null,
    val line: Int? = null,
    val url: String? = null,
)

/** Encodes host messages with the shared RPC JSON settings. */
object HostMessages {
    fun status(status: PiChatService.Status): JsonElement =
        PiJson.encodeToJsonElement(HostStatusMessage.serializer(), HostStatusMessage(status = HostStatus.from(status)))

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
}
