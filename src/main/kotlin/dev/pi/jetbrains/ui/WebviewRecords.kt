package dev.pi.jetbrains.ui

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** Display-only protection. Never mutates the RPC data used by native consumers or pi's session. */
internal object WebviewRecords {
    const val MAX_RECORD_BYTES = 128 * 1024
    const val MAX_BATCH_BYTES = 256 * 1024
    const val MAX_BATCH_RECORDS = 16
    const val DIAGNOSTIC_BYTES = 64 * 1024
    private const val MAX_DEPTH = 64
    private const val MAX_STRING_BYTES = 64 * 1024
    private const val MAX_CONTAINER_ITEMS = 1000
    private const val SOURCE_SIZE_LIMIT = 4 * 1024 * 1024
    private const val OMITTED = "\n[… truncated for WebView …]"
    private val envelopeBytes = jsonBytes(HostMessages.records(emptyList()))
    // Keep discriminants, correlation and lifecycle fields even if they follow a huge payload.
    private val metadataKeys = listOf(
        "type", "id", "role", "toolCallId", "parentToolCallId", "toolName", "name", "command",
        "success", "isError", "timestamp", "contentIndex", "stopReason", "durationMs", "model",
        "provider", "method", "level", "error", "errorMessage", "fullOutputPath", "full_output_path",
        // Prefer the delta consumed by the reducer over the redundant full message/partial snapshot.
        "assistantMessageEvent", "delta", "toolCall", "message",
    )

    fun protect(record: JsonElement, log: (String) -> Unit = {}): JsonElement {
        val bytes = jsonBytes(record, SOURCE_SIZE_LIMIT)
        if (bytes <= MAX_RECORD_BYTES && withinDepth(record)) return record
        // Reserve space for the top-level diagnostic flag before projecting the payload.
        val projected = project(record, MAX_RECORD_BYTES - 32, 0)
        val safe = if (projected is JsonObject) {
            JsonObject(projected.toMutableMap().apply { put("recordTruncated", JsonPrimitive(true)) })
        } else projected
        val sourceBytes = if (bytes > SOURCE_SIZE_LIMIT) ">${SOURCE_SIZE_LIMIT}" else bytes.toString()
        log("[webview-records] capped event=${eventType(record)} sourceBytes=$sourceBytes payloadBytes=${jsonBytes(safe)}")
        return safe
    }

    /** Includes the records envelope and commas in the byte budget; preserves order and boundaries. */
    fun batches(records: List<JsonElement>): List<List<JsonElement>> {
        val result = ArrayList<List<JsonElement>>()
        var batch = ArrayList<JsonElement>()
        var bytes = envelopeBytes
        for (record in records) {
            val size = jsonBytes(record)
            require(size <= MAX_RECORD_BYTES) { "Record must be protected before batching" }
            if (batch.isNotEmpty() &&
                (bytes + 1 + size > MAX_BATCH_BYTES || batch.size >= MAX_BATCH_RECORDS)
            ) {
                result.add(batch)
                batch = ArrayList()
                bytes = envelopeBytes
            }
            if (batch.isNotEmpty()) bytes++
            batch.add(record)
            bytes += size
        }
        if (batch.isNotEmpty()) result.add(batch)
        return result
    }

    fun describe(records: List<JsonElement>): String =
        records.joinToString(",") { "${eventType(it)}:${jsonBytes(it)}" }

    private fun eventType(record: JsonElement): String {
        val obj = record as? JsonObject ?: return "unknown"
        val type = (obj["type"] as? JsonPrimitive)?.contentOrNull ?: "unknown"
        val delta = obj["assistantMessageEvent"] as? JsonObject
        val subtype = (delta?.get("type") as? JsonPrimitive)?.contentOrNull
        return (if (subtype == null) type else "$type/$subtype")
            .take(100).replace('\n', '_').replace('\r', '_')
    }

    /** Bounded recursion (at most 64 levels), preserving JSON kinds and protocol metadata. */
    private fun project(value: JsonElement, budget: Int, depth: Int): JsonElement = when (value) {
        is JsonObject -> {
            val fields = LinkedHashMap<String, JsonElement>()
            var remaining = budget - 2
            if (depth < MAX_DEPTH) {
                val keys = metadataKeys.asSequence().filter { it in value } +
                    value.keys.asSequence().filter { it !in metadataKeys }
                for (key in keys) {
                    val overhead = stringBytes(key, remaining) + 1 + if (fields.isEmpty()) 0 else 1
                    // Four bytes allow any empty JSON kind or a primitive placeholder.
                    if (overhead + 4 > remaining) continue
                    val child = project(value.getValue(key), remaining - overhead, depth + 1)
                    fields[key] = child
                    remaining -= overhead + jsonBytes(child)
                    if (fields.size >= MAX_CONTAINER_ITEMS) break
                }
            }
            JsonObject(fields)
        }
        is JsonArray -> {
            val items = ArrayList<JsonElement>()
            var remaining = budget - 2
            if (depth < MAX_DEPTH) {
                for (item in value) {
                    val overhead = if (items.isEmpty()) 0 else 1
                    if (remaining < overhead + 4) break
                    val child = project(item, remaining - overhead, depth + 1)
                    items.add(child)
                    remaining -= overhead + jsonBytes(child)
                    if (items.size >= MAX_CONTAINER_ITEMS) break
                }
            }
            JsonArray(items)
        }
        is JsonPrimitive -> {
            if (value.isString) JsonPrimitive(truncate(value.content, minOf(budget, MAX_STRING_BYTES)))
            else if (jsonBytes(value, budget) <= budget) value else JsonNull
        }
    }

    private fun truncate(text: String, budget: Int): String {
        if (stringBytes(text, budget) <= budget) return text
        val suffix = if (stringBytes(OMITTED) <= budget) OMITTED else ""
        val available = budget - stringBytes(suffix)
        var used = 0
        var end = 0
        while (end < text.length) {
            val width = charWidth(text, end)
            val cost = charBytes(text, end)
            if (used + cost > available) break
            used += cost
            end += width
        }
        return text.substring(0, end) + suffix
    }

    private fun withinDepth(root: JsonElement): Boolean {
        val pending = ArrayDeque<Pair<JsonElement, Int>>()
        pending.addLast(root to 0)
        while (pending.isNotEmpty()) {
            val (value, depth) = pending.removeLast()
            if ((value is JsonObject || value is JsonArray) && depth >= MAX_DEPTH) return false
            when (value) {
                is JsonObject -> value.values.forEach { pending.addLast(it to depth + 1) }
                is JsonArray -> value.forEach { pending.addLast(it to depth + 1) }
                else -> Unit
            }
        }
        return true
    }

    /** Conservative UTF-8 JSON size, including escaping; stops after limit without serializing. */
    fun jsonBytes(root: JsonElement, limit: Int = Int.MAX_VALUE - 1): Int {
        val pending = ArrayDeque<JsonElement>()
        pending.addLast(root)
        var bytes = 0L
        while (pending.isNotEmpty() && bytes <= limit) {
            when (val value = pending.removeLast()) {
                is JsonObject -> {
                    bytes += 2L + (value.size - 1).coerceAtLeast(0)
                    for ((key, child) in value) {
                        bytes += stringBytes(key, limit) + 1L
                        if (bytes > limit) return limit + 1
                        pending.addLast(child)
                    }
                }
                is JsonArray -> {
                    bytes += 2L + (value.size - 1).coerceAtLeast(0)
                    pending.addAll(value)
                }
                is JsonPrimitive -> bytes += if (value.isString) stringBytes(value.content, limit)
                    else value.content.length
            }
        }
        return if (bytes > limit) limit + 1 else bytes.toInt()
    }

    private fun stringBytes(text: String, limit: Int = Int.MAX_VALUE - 1): Int {
        var bytes = 2L
        var index = 0
        while (index < text.length && bytes <= limit) {
            bytes += charBytes(text, index)
            index += charWidth(text, index)
        }
        return if (bytes > limit) limit + 1 else bytes.toInt()
    }

    private fun charWidth(text: String, index: Int): Int =
        if (text[index].isHighSurrogate() && index + 1 < text.length && text[index + 1].isLowSurrogate()) 2 else 1

    private fun charBytes(text: String, index: Int): Int = when (val char = text[index]) {
        '"', '\\', '\b', '\u000C', '\n', '\r', '\t' -> 2
        // The bridge escapes JS line separators in addition to JSON's own escaping.
        '\u2028', '\u2029' -> 6
        else -> when {
            char < ' ' -> 6
            char.code < 0x80 -> 1
            char.code < 0x800 -> 2
            charWidth(text, index) == 2 -> 4
            char.isSurrogate() -> 6
            else -> 3
        }
    }
}
