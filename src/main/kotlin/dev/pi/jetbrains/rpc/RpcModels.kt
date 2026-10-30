package dev.pi.jetbrains.rpc

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
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

/** Subset of `SessionStats`; only the fields the GUI shows. */
@Serializable
data class RpcSessionStats(
    val contextUsage: RpcContextUsage? = null,
)
