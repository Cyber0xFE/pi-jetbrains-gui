package dev.pi.jetbrains.rpc

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * One stdout record.
 *
 * Parsing is deliberately tolerant: a record family we do not know about yet is surfaced as
 * [Session] / [Unknown] instead of throwing, so a newer pi does not crash an older plugin.
 */
sealed interface PiEvent {
    /** A `response` record, correlated to a command id. Also forwarded to the event flow. */
    data class Response(val response: RpcResponse) : PiEvent

    /** A session event (`message_start`, `tool_execution_end`, `agent_settled`, ...). */
    data class Session(val type: String, val payload: JsonObject) : PiEvent

    /** An `extension_ui_request`; M0 only logs these. */
    data class ExtensionUiRequest(val id: String, val method: String, val payload: JsonObject) : PiEvent

    /** A record with no usable `type` field. */
    data class Unknown(val type: String?, val payload: JsonObject) : PiEvent

    companion object {
        /** Throws on malformed JSON or a non-object record; callers log and drop those. */
        fun parse(line: String): PiEvent {
            val element = PiJson.parseToJsonElement(line)
            val payload = element as? JsonObject
                ?: throw IllegalArgumentException("RPC record is not a JSON object")
            val type = (payload["type"] as? JsonPrimitive)?.contentOrNull
            return when (type) {
                "response" -> Response(PiJson.decodeFromJsonElement(RpcResponse.serializer(), payload))
                "extension_ui_request" -> ExtensionUiRequest(
                    id = (payload["id"] as? JsonPrimitive)?.contentOrNull ?: "",
                    method = (payload["method"] as? JsonPrimitive)?.contentOrNull ?: "",
                    payload = payload,
                )
                null -> Unknown(null, payload)
                else -> Session(type, payload)
            }
        }
    }
}
