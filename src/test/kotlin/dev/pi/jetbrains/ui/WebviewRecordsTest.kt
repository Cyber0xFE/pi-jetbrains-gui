package dev.pi.jetbrains.ui

import dev.pi.jetbrains.rpc.PiJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class WebviewRecordsTest {
    @Test
    fun `small records pass through unchanged`() {
        val record = parse("""{"type":"agent_settled","aborted":false}""")
        val logs = mutableListOf<String>()
        assertSame(record, WebviewRecords.protect(record, logs::add))
        assertTrue(logs.isEmpty())
        assertTrue(WebviewRecords.batches(emptyList()).isEmpty())
    }

    @Test
    fun `caps all event families and preserves metadata following large fields`() {
        val text = "中文😀\u2028\u0001\\\"".repeat(100_000)
        for (type in listOf("message_start", "message_update", "message_end", "tool_execution_start",
            "tool_execution_update", "tool_execution_end", "bash_execution_update", "extension_ui_request")) {
            val record = JsonObject(linkedMapOf(
                "result" to JsonObject(mapOf("output" to JsonPrimitive(text))),
                "type" to JsonPrimitive(type),
                "toolCallId" to JsonPrimitive("call-1"),
                "parentToolCallId" to JsonPrimitive("parent-1"),
                "success" to JsonPrimitive(false),
            ))
            val logs = mutableListOf<String>()
            val safe = WebviewRecords.protect(record, logs::add) as JsonObject
            assertBounded(safe)
            assertEquals(record["type"], safe["type"])
            assertEquals(record["toolCallId"], safe["toolCallId"])
            assertEquals(record["parentToolCallId"], safe["parentToolCallId"])
            assertEquals(record["success"], safe["success"])
            assertEquals(JsonPrimitive(true), safe["recordTruncated"])
            val output = (safe["result"] as JsonObject)["output"] as JsonPrimitive
            assertTrue(output.content.contains("truncated for WebView"))
            assertTrue(output.content.startsWith("中文😀"))
            assertEquals(text, ((record["result"] as JsonObject)["output"] as JsonPrimitive).content)
            assertTrue(logs.single().contains("event=$type sourceBytes="))
            assertFalse(logs.single().contains("中文"), "diagnostics must not log tool content")
        }
    }

    @Test
    fun `caps message content without destroying message and content discriminants`() {
        val record = JsonObject(linkedMapOf(
            "message" to JsonObject(linkedMapOf(
                "content" to JsonArray(listOf(JsonObject(linkedMapOf(
                    "text" to JsonPrimitive("x".repeat(500_000)),
                    "type" to JsonPrimitive("text"),
                )))),
                "role" to JsonPrimitive("assistant"),
                "timestamp" to JsonPrimitive(123),
                "stopReason" to JsonPrimitive("stop"),
            )),
            "type" to JsonPrimitive("message_end"),
        ))
        val safe = WebviewRecords.protect(record) as JsonObject
        val message = safe["message"] as JsonObject
        assertEquals(JsonPrimitive("assistant"), message["role"])
        assertEquals(JsonPrimitive("stop"), message["stopReason"])
        assertEquals(JsonPrimitive(123), message["timestamp"])
        assertEquals(JsonPrimitive("text"), ((message["content"] as JsonArray)[0] as JsonObject)["type"])
        assertBounded(safe)
    }

    @Test
    fun `metadataOnly keeps scalars and drops container payloads`() {
        val record = parse(
            """{"type":"agent_end","reason":"end_turn","durationMs":42,"message":{"content":[{"type":"text","text":"x"}]},"stats":{"a":1}}""",
        )
        val reduced = WebviewRecords.metadataOnly(record) as JsonObject

        assertEquals(
            parse("""{"type":"agent_end","reason":"end_turn","durationMs":42}"""),
            reduced,
        )
        assertEquals(record, parse(record.toString()))
    }

    @Test
    fun `withoutImageData clears image payloads but keeps block structure`() {
        val record = parse(
            """{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"ok"},{"type":"image","data":"QUJD","mimeType":"image/png"}]}}""",
        )
        val reduced = WebviewRecords.withoutImageData(record) as JsonObject
        val content = ((reduced["message"] as JsonObject)["content"] as JsonArray)

        assertEquals(JsonPrimitive(""), ((content[1] as JsonObject)["data"] as JsonPrimitive))
        assertEquals(JsonPrimitive("image/png"), (content[1] as JsonObject)["mimeType"])
        assertEquals(JsonPrimitive("ok"), ((content[0] as JsonObject)["text"] as JsonPrimitive))
        assertTrue(WebviewRecords.jsonBytes(reduced) < 200)
    }

    @Test
    fun `image payloads lose their exemption past the runaway guard`() {
        val record = JsonObject(linkedMapOf(
            "type" to JsonPrimitive("message_start"),
            "message" to JsonObject(linkedMapOf(
                "role" to JsonPrimitive("user"),
                "content" to JsonArray(listOf(JsonObject(linkedMapOf(
                    "type" to JsonPrimitive("image"),
                    "data" to JsonPrimitive("QUJD".repeat(200_000)),
                    "mimeType" to JsonPrimitive("image/png"),
                )))),
            )),
        ))
        val logs = mutableListOf<String>()
        val safe = WebviewRecords.protect(record, logs::add) as JsonObject
        val content = ((safe["message"] as JsonObject)["content"] as JsonArray)

        assertBounded(safe)
        assertEquals(JsonPrimitive(""), ((content[0] as JsonObject)["data"] as JsonPrimitive))
        assertEquals(JsonPrimitive("image/png"), (content[0] as JsonObject)["mimeType"])
        assertTrue(logs.single().contains("totalLimit="))
    }

    @Test
    fun `image payloads stay intact below the runaway guard`() {
        val record = JsonObject(linkedMapOf(
            "type" to JsonPrimitive("message_start"),
            "message" to JsonObject(linkedMapOf(
                "role" to JsonPrimitive("user"),
                "content" to JsonArray(listOf(JsonObject(linkedMapOf(
                    "type" to JsonPrimitive("image"),
                    "data" to JsonPrimitive("QUJD".repeat(40_000)),
                    "mimeType" to JsonPrimitive("image/png"),
                )))),
            )),
        ))
        val logs = mutableListOf<String>()
        val safe = WebviewRecords.protect(record, logs::add)

        assertEquals(record, safe)
        assertTrue(logs.isEmpty())
    }

    @Test
    fun `streaming delta takes priority over redundant full snapshots`() {
        val delta = parse("""{"type":"text_delta","contentIndex":0,"delta":"latest text"}""")
        val record = JsonObject(linkedMapOf(
            "partial" to JsonArray(List(100) { JsonPrimitive("x".repeat(20_000)) }),
            "type" to JsonPrimitive("message_update"),
            "assistantMessageEvent" to delta,
        ))
        val safe = WebviewRecords.protect(record) as JsonObject
        assertEquals(delta, safe["assistantMessageEvent"])
        assertBounded(safe)
    }

    @Test
    fun `object made of many small fields stays bounded`() {
        val record = JsonObject(linkedMapOf<String, JsonElement>("type" to JsonPrimitive("custom_event")).apply {
            repeat(20_000) { put("field-$it", JsonPrimitive("中".repeat(30))) }
        })
        val safe = WebviewRecords.protect(record)
        assertBounded(safe)
    }

    @Test
    fun `many small nested values cannot bypass record budget`() {
        val record = JsonObject(mapOf(
            "type" to JsonPrimitive("tool_execution_end"),
            "result" to JsonArray(List(100_000) { JsonObject(mapOf("text" to JsonPrimitive("abc"))) }),
        ))
        val safe = WebviewRecords.protect(record) as JsonObject
        assertBounded(safe)
        assertEquals(1000, (safe["result"] as JsonArray).size)
        assertTrue((safe["result"] as JsonArray).all { it is JsonObject })
    }

    @Test
    fun `deep small JSON is capped before recursive serialization`() {
        var nested: JsonElement = JsonPrimitive("leaf")
        repeat(2000) { nested = JsonObject(mapOf("nested" to nested)) }
        val record = JsonObject(mapOf("type" to JsonPrimitive("tool_execution_update"), "partialResult" to nested))
        val safe = WebviewRecords.protect(record) as JsonObject
        assertBounded(safe)
        assertEquals(JsonPrimitive(true), safe["recordTruncated"])
    }

    @Test
    fun `batches obey byte and count limits preserving all records in order`() {
        val records = List(55) { index ->
            JsonObject(mapOf(
                "type" to JsonPrimitive(if (index == 54) "tool_execution_end" else "message_update"),
                "id" to JsonPrimitive("record-$index"),
                "delta" to JsonPrimitive("中\u2028\n".repeat(8000)),
            ))
        }
        val batches = WebviewRecords.batches(records)
        assertTrue(batches.size > 1)
        assertEquals(records, batches.flatten())
        batches.forEach { batch ->
            assertTrue(batch.size <= WebviewRecords.MAX_BATCH_RECORDS)
            assertTrue(bridgeBytes(HostMessages.records(batch)) <= WebviewRecords.MAX_BATCH_BYTES)
        }
        val tiny = List(50) { parse("""{"type":"agent_start"}""") }
        assertEquals(listOf(16, 16, 16, 2), WebviewRecords.batches(tiny).map { it.size })
    }

    @Test
    fun `diagnostics include event subtype and individual byte sizes`() {
        val records = listOf(parse("""{"type":"message_update","assistantMessageEvent":{"type":"text_delta"}}"""))
        assertEquals("message_update/text_delta:${WebviewRecords.jsonBytes(records[0])}", WebviewRecords.describe(records))
    }

    @Test
    fun `size accounting covers unicode escapes separators and surrogate pairs`() {
        val record = JsonObject(mapOf("中文\n" to JsonPrimitive("a😀中\u2028\u2029\u0001\n\t\"\\")))
        assertEquals(bridgeBytes(record), WebviewRecords.jsonBytes(record))
        assertEquals(101, WebviewRecords.jsonBytes(JsonPrimitive("x".repeat(10000)), 100))
    }

    @Test
    fun `image payload larger than the budget stays intact instead of being emptied`() {
        val image = JsonObject(linkedMapOf(
            "type" to JsonPrimitive("image"),
            "data" to JsonPrimitive("aGVsbG8=".repeat(60_000)),
            "mimeType" to JsonPrimitive("image/png"),
        ))
        val record = JsonObject(linkedMapOf(
            "message" to JsonObject(linkedMapOf(
                "role" to JsonPrimitive("user"),
                "content" to JsonArray(listOf(image)),
            )),
            "type" to JsonPrimitive("message_start"),
        ))
        val logs = mutableListOf<String>()
        val safe = WebviewRecords.protect(record, logs::add)
        assertSame(record, safe)
        assertFalse((safe as JsonObject).containsKey("recordTruncated"))
        assertTrue(logs.isEmpty())
        assertEquals(listOf(listOf(record)), WebviewRecords.batches(listOf(safe)))
    }

    @Test
    fun `large image is preserved while surrounding text is capped`() {
        val image = JsonObject(linkedMapOf(
            "type" to JsonPrimitive("image"),
            "data" to JsonPrimitive("aGVsbG8=".repeat(10_000)),
            "mimeType" to JsonPrimitive("image/png"),
        ))
        val text = "x".repeat(200_000)
        val record = JsonObject(linkedMapOf(
            "message" to JsonObject(linkedMapOf(
                "role" to JsonPrimitive("user"),
                "content" to JsonArray(listOf(
                    JsonObject(linkedMapOf("type" to JsonPrimitive("text"), "text" to JsonPrimitive(text))),
                    image,
                )),
            )),
            "type" to JsonPrimitive("message_start"),
        ))
        val safe = WebviewRecords.protect(record) as JsonObject
        assertTextBounded(safe)
        assertEquals(JsonPrimitive(true), safe["recordTruncated"])
        val content = (safe["message"] as JsonObject)["content"] as JsonArray
        assertEquals(2, content.size)
        val keptText = content[0] as JsonObject
        assertEquals(JsonPrimitive("text"), keptText["type"])
        assertTrue((keptText["text"] as JsonPrimitive).content.contains("truncated for WebView"))
        assertEquals(image, content[1])
    }

    @Test
    fun `image payload that fits the budget stays intact`() {
        val image = JsonObject(linkedMapOf(
            "type" to JsonPrimitive("image"),
            "data" to JsonPrimitive("aGVsbG8=".repeat(8_000)),
            "mimeType" to JsonPrimitive("image/png"),
        ))
        val record = JsonObject(linkedMapOf(
            "message" to JsonObject(linkedMapOf(
                "role" to JsonPrimitive("user"),
                "content" to JsonArray(listOf(
                    JsonObject(linkedMapOf("type" to JsonPrimitive("text"), "text" to JsonPrimitive("x".repeat(200_000)))),
                    image,
                )),
            )),
            "type" to JsonPrimitive("message_start"),
        ))
        val safe = WebviewRecords.protect(record) as JsonObject
        assertBounded(safe)
        val content = (safe["message"] as JsonObject)["content"] as JsonArray
        assertEquals(2, content.size)
        assertEquals(image, content[1])
    }

    private fun parse(json: String): JsonElement = PiJson.parseToJsonElement(json)

    private fun assertTextBounded(value: JsonElement) {
        assertTrue(WebviewRecords.jsonBytesExcludingImageData(value) <= WebviewRecords.MAX_RECORD_BYTES)
    }

    private fun assertBounded(value: JsonElement) {
        assertTrue(WebviewRecords.jsonBytes(value) <= WebviewRecords.MAX_RECORD_BYTES)
        assertTrue(bridgeBytes(value) <= WebviewRecords.MAX_RECORD_BYTES)
        assertEquals(value, parse(value.toString()))
    }

    private fun bridgeBytes(value: JsonElement): Int = value.toString()
        .replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
        .toByteArray(Charsets.UTF_8).size
}
