package dev.pi.jetbrains.rpc

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement

/**
 * JSON settings shared by every RPC record.
 *
 * `explicitNulls = false` keeps command payloads small: only fields that are set get serialized,
 * which matches the discriminated-union shape of `rpc-types.ts`.
 */
val PiJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
    explicitNulls = false
}

/** Mirrors `ImageContent` from `@earendil-works/pi-ai`. */
@Serializable
data class RpcImage(
    val type: String = "image",
    val data: String,
    val mimeType: String,
)

/**
 * One stdin command. Only the commands that carry fields are modelled explicitly; unknown command
 * types are rejected by pi itself with `success: false`.
 */
@Serializable
data class RpcCommand(
    val id: String? = null,
    val type: String,
    val message: String? = null,
    val images: List<RpcImage>? = null,
    val streamingBehavior: String? = null,
    val provider: String? = null,
    val modelId: String? = null,
    val level: String? = null,
    val sessionPath: String? = null,
    val entryId: String? = null,
    val name: String? = null,
    val command: String? = null,
    val enabled: Boolean? = null,
    val customInstructions: String? = null,
    val parentSession: String? = null,
    val mode: String? = null,
    val outputPath: String? = null,
    val since: String? = null,
    val excludeFromContext: Boolean? = null,
)

/** One `response` record from stdout. */
@Serializable
data class RpcResponse(
    val id: String? = null,
    val type: String = "response",
    val command: String,
    val success: Boolean,
    val data: JsonElement? = null,
    val error: String? = null,
)

/** Subset of `Model` returned by `get_state` / `set_model`. */
@Serializable
data class RpcModelInfo(
    val id: String,
    val name: String? = null,
    val provider: String? = null,
    val api: String? = null,
    val reasoning: Boolean? = null,
    val contextWindow: Long? = null,
)

/** Subset of `RpcSessionState`; unknown fields are ignored. */
@Serializable
data class RpcSessionState(
    val model: RpcModelInfo? = null,
    val thinkingLevel: String? = null,
    val isStreaming: Boolean = false,
    val isCompacting: Boolean = false,
    val sessionId: String? = null,
    val sessionFile: String? = null,
    val sessionName: String? = null,
    val autoCompactionEnabled: Boolean? = null,
    val messageCount: Int = 0,
    val pendingMessageCount: Int = 0,
)

inline fun <reified T> RpcResponse.decodeDataAs(): T? =
    data?.let { runCatching { PiJson.decodeFromJsonElement<T>(it) }.getOrNull() }

fun RpcResponse.sessionState(): RpcSessionState? = decodeDataAs()

/** `contextUsage` from `get_session_stats`. */
@Serializable
data class RpcContextUsage(
    val tokens: Long? = null,
    val contextWindow: Long? = null,
    val percent: Double? = null,
)

/** Cumulative token usage from `get_session_stats`. */
@Serializable
data class RpcTokens(
    val input: Long = 0,
    val output: Long = 0,
    val cacheRead: Long = 0,
    val cacheWrite: Long = 0,
    val total: Long = 0,
)

/** Subset of `SessionStats`; the footer shows totals, cost and context usage. */
@Serializable
data class RpcSessionStats(
    val tokens: RpcTokens? = null,
    val cost: Double? = null,
    val contextUsage: RpcContextUsage? = null,
)

/** `get_available_models` response data. */
@Serializable
data class RpcModelsData(val models: List<RpcModelInfo> = emptyList())

/** `get_available_thinking_levels` response data. */
@Serializable
data class RpcThinkingLevelsData(val levels: List<String> = emptyList())

/** One discoverable slash command from `get_commands` (plan M3.8). */
@Serializable
data class RpcSlashCommand(
    val name: String,
    val description: String? = null,
    /** `extension`, `prompt` or `skill`. */
    val source: String = "prompt",
)

/** `get_commands` response data. */
@Serializable
data class RpcCommandsData(val commands: List<RpcSlashCommand> = emptyList())

/** One node of `get_tree`; `entry` stays opaque so session entry types can grow. */
@Serializable
data class RpcSessionTreeNode(
    val entry: JsonObject = JsonObject(emptyMap()),
    val children: List<RpcSessionTreeNode> = emptyList(),
    val label: String? = null,
    val labelTimestamp: String? = null,
)

/** `get_tree` response data. */
@Serializable
data class RpcTreeData(
    val tree: List<RpcSessionTreeNode> = emptyList(),
    val leafId: String? = null,
)

/** `switch_session` / `new_session` response data. */
@Serializable
data class RpcSwitchResult(val cancelled: Boolean = false)

/** `clear_queue` response data. */
@Serializable
data class RpcClearQueueResult(
    val steering: List<String> = emptyList(),
    val followUp: List<String> = emptyList(),
)

/** `fork` response data. */
@Serializable
data class RpcForkResult(
    val text: String? = null,
    val cancelled: Boolean = false,
)

/** Subset of the `compact` response data; the event stream carries the progress. */
@Serializable
data class RpcCompactionResult(
    val tokensBefore: Long? = null,
    val estimatedTokensAfter: Long? = null,
    val summary: String? = null,
)

/** Responses to the RPC extension UI sub-protocol (not normal commands). */
@Serializable
sealed interface RpcExtensionUiResponse {
    @Serializable
    data class Value(val type: String = "extension_ui_response", val id: String, val value: String) :
        RpcExtensionUiResponse

    @Serializable
    data class Confirmation(val type: String = "extension_ui_response", val id: String, val confirmed: Boolean) :
        RpcExtensionUiResponse

    @Serializable
    data class Cancelled(val type: String = "extension_ui_response", val id: String, val cancelled: Boolean = true) :
        RpcExtensionUiResponse
}
