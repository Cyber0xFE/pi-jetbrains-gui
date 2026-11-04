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

    /** Runaway guard: even image payloads must not push a single record beyond this. */
    const val MAX_TOTAL_RECORD_BYTES = 512 * 1024
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
        val totalBytes = jsonBytes(record, SOURCE_SIZE_LIMIT)
        if (totalBytes <= MAX_RECORD_BYTES && withinDepth(record)) return record
        val stripped = stripImageData(record)
        val textBytes = jsonBytes(stripped, SOURCE_SIZE_LIMIT)
        // Image payloads are exempt from the byte budget so they always render in the webview,
        // but only while the whole record stays below the runaway guard; oversized records are
        // projected without restoring images, which the webview shows as omitted-image cards.
        if (totalBytes <= MAX_TOTAL_RECORD_BYTES) {
            if (textBytes <= MAX_RECORD_BYTES && withinDepth(record)) return record
            val projected = project(stripped, MAX_RECORD_BYTES - 32, 0)
            val safe = restoreImageData(record, projected)
            log("[webview-records] capped event=${eventType(record)} sourceBytes=$totalBytes textBytes=$textBytes payloadBytes=${jsonBytes(safe, SOURCE_SIZE_LIMIT)}")
            return flag(safe)
        }
        val projected = project(stripped, MAX_RECORD_BYTES - 32, 0)
        log("[webview-records] capped event=${eventType(record)} sourceBytes=$totalBytes textBytes=$textBytes payloadBytes=${jsonBytes(projected, SOURCE_SIZE_LIMIT)} totalLimit=$MAX_TOTAL_RECORD_BYTES")
        return flag(projected)
    }

    private fun flag(record: JsonElement): JsonElement = if (record is JsonObject) {
        JsonObject(record.toMutableMap().apply { put("recordTruncated", JsonPrimitive(true)) })
    } else record

    /**
     * Drops every non-scalar field from a record. Used for event types the webview reducer
     * never reads (for example `agent_end` / `turn_end`): pi resends the full final message
     * there, which would duplicate payloads the transcript already received.
     */
    fun metadataOnly(record: JsonElement): JsonElement {
        val obj = record as? JsonObject ?: return record
        val fields = LinkedHashMap<String, JsonElement>()
        for ((key, value) in obj) {
            if (value is JsonPrimitive) fields[key] = value
        }
        return JsonObject(fields)
    }

    /**
     * Clears image payload data while keeping the block structure. Used for `message_end`,
     * which repeats the message already delivered (and rendered) by `message_start`.
     */
    fun withoutImageData(record: JsonElement): JsonElement = stripImageData(record)

    /** Includes the records envelope and commas in the byte budget; preserves order and boundaries. */
    fun batches(records: List<JsonElement>): List<List<JsonElement>> {
        val result = ArrayList<List<JsonElement>>()
        var batch = ArrayList<JsonElement>()
        var bytes = envelopeBytes
        for (record in records) {
            val size = jsonBytes(record)
            require(
                size <= MAX_RECORD_BYTES || jsonBytesExcludingImageData(record) <= MAX_RECORD_BYTES,
            ) { "Record must be protected before batching" }
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
        is JsonObject -> projectObject(value, budget, depth)
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

    private fun projectObject(value: JsonObject, budget: Int, depth: Int): JsonElement {
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
        val projected = JsonObject(fields)
        // A truncated or dropped image payload would render as a broken <img> in the webview;
        // replace it with an explicit empty marker the webview shows as an omitted-image card.
        // Payload data is stripped before projection, so this only guards unexpected drops.
        val originalData = (value["data"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (originalData != null &&
            (value["type"] as? JsonPrimitive)?.contentOrNull == "image" &&
            (projected["data"] as? JsonPrimitive)?.takeIf { it.isString }?.content != originalData
        ) {
            return JsonObject(projected.toMutableMap().apply { put("data", JsonPrimitive("")) })
        }
        return projected
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

    private fun isImagePayload(value: JsonObject): Boolean =
        (value["type"] as? JsonPrimitive)?.contentOrNull == "image" && value["data"] is JsonPrimitive

    /** Replaces image payload data with an empty marker, keeping the block structure. */
    private fun stripImageData(root: JsonElement): JsonElement {
        var result: JsonElement = JsonNull
        val tasks = ArrayDeque<StripTask>()
        tasks.addLast(StripTask(root) { result = it })
        while (tasks.isNotEmpty()) {
            val task = tasks.removeLast()
            when (val element = task.element) {
                is JsonObject -> {
                    if (isImagePayload(element)) {
                        task.assign(JsonObject(element.toMutableMap().apply { put("data", JsonPrimitive("")) }))
                        continue
                    }
                    val values = LinkedHashMap<String, JsonElement>(element.size)
                    task.assign(JsonObject(values))
                    for ((key, value) in element) {
                        tasks.addLast(StripTask(value) { stripped -> values[key] = stripped })
                    }
                }
                is JsonArray -> {
                    val values = ArrayList(element)
                    task.assign(JsonArray(values))
                    element.forEachIndexed { index, value ->
                        tasks.addLast(StripTask(value) { stripped -> values[index] = stripped })
                    }
                }
                else -> task.assign(element)
            }
        }
        return result
    }

    private class StripTask(val element: JsonElement, val assign: (JsonElement) -> Unit)

    /** Restores full image payloads from the original record into the projected tree. */
    private fun restoreImageData(original: JsonElement, projected: JsonElement): JsonElement {
        var result: JsonElement = projected
        val tasks = ArrayDeque<RestoreTask>()
        tasks.addLast(RestoreTask(original, projected) { result = it })
        while (tasks.isNotEmpty()) {
            val task = tasks.removeLast()
            val source = task.original
            val target = task.projected
            val sameShape = source::class == target::class && (source is JsonObject || source is JsonArray)
            if (!sameShape) {
                task.assign(target)
                continue
            }
            if (source is JsonObject && target is JsonObject) {
                if (isImagePayload(source)) {
                    task.assign(JsonObject(target.toMutableMap().apply { put("data", source.getValue("data")) }))
                    continue
                }
                val values = LinkedHashMap<String, JsonElement>(target.size)
                task.assign(JsonObject(values))
                for ((key, value) in target) {
                    val sourceChild = source[key]
                    if (sourceChild == null) {
                        values[key] = value
                        continue
                    }
                    tasks.addLast(RestoreTask(sourceChild, value) { restored -> values[key] = restored })
                }
            } else {
                source as JsonArray
                target as JsonArray
                val values = ArrayList(target)
                task.assign(JsonArray(values))
                target.forEachIndexed { index, value ->
                    if (index >= source.size) return@forEachIndexed
                    tasks.addLast(RestoreTask(source[index], value) { restored -> values[index] = restored })
                }
            }
        }
        return result
    }

    private class RestoreTask(val original: JsonElement, val projected: JsonElement, val assign: (JsonElement) -> Unit)

    /** Byte count excluding image payload data, iteratively; validates text-only bounds. */
    fun jsonBytesExcludingImageData(root: JsonElement, limit: Int = Int.MAX_VALUE - 1): Int {
        val pending = ArrayDeque<JsonElement>()
        pending.addLast(root)
        var bytes = 0L
        while (pending.isNotEmpty() && bytes <= limit) {
            when (val value = pending.removeLast()) {
                is JsonObject -> {
                    bytes += 2L + (value.size - 1).coerceAtLeast(0)
                    val imagePayload = isImagePayload(value)
                    for ((key, child) in value) {
                        if (imagePayload && key == "data") continue
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
