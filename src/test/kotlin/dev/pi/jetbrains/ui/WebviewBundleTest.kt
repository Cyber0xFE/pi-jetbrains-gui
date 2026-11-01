package dev.pi.jetbrains.ui

import dev.pi.jetbrains.PiChatService
import dev.pi.jetbrains.rpc.PiJson
import dev.pi.jetbrains.rpc.RpcResponse
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class WebviewBundleTest {
    @Test
    fun `webview bundle is one self-contained document`() {
        val document = readBundle()

        assertTrue(document.contains(WebViewBridge.BRIDGE_MARKER), "bridge marker is missing from the bundle")
        assertFalse(
            Regex("""(?:src|href)="/""").containsMatchIn(document),
            "the bundle still references plugin-relative assets that loadHTML cannot resolve",
        )

        val markerIndex = document.indexOf(WebViewBridge.BRIDGE_MARKER)
        val bundleIndex = document.lastIndexOf("<script>")
        assertTrue(
            markerIndex in 0 until bundleIndex,
            "the bridge marker must be defined before the bundle runs",
        )
        assertTrue(
            document.endsWith("</script>\n  </body>\n</html>"),
            "the inlined bundle must be the final script before the document closes",
        )
    }

    @Test
    fun `status messages carry the fields the footer reads`() {
        val status = PiChatService.Status(
            phase = PiChatService.Phase.RUNNING,
            message = "ready",
            model = "claude-sonnet-4-5",
            provider = "anthropic",
            reasoning = true,
            thinkingLevel = "high",
            isStreaming = true,
            autoCompaction = true,
            context = PiChatService.StatusUsage(
                tokens = 188_000L,
                contextWindow = 524_000L,
                percent = 35.9,
                input = 197_000L,
                output = 119_000L,
                cacheRead = 13_000_000L,
                cacheWrite = 2_500L,
                cost = 0.043,
            ),
        )

        val json = HostMessages.status(status).toString()

        assertTrue(json.contains("\"type\":\"status\""), json)
        assertTrue(json.contains("\"phase\":\"running\""), json)
        assertTrue(json.contains("\"model\":\"claude-sonnet-4-5\""), json)
        assertTrue(json.contains("\"provider\":\"anthropic\""), json)
        assertTrue(json.contains("\"thinkingLevel\":\"high\""), json)
        assertTrue(json.contains("\"isStreaming\":true"), json)
        assertTrue(json.contains("\"input\":197000"), json)
        assertTrue(json.contains("\"cacheRead\":13000000"), json)
        assertTrue(json.contains("\"cost\":0.043"), json)
        assertTrue(json.contains("\"percent\":35.9"), json)
    }

    @Test
    fun `response records omit large deeply nested data without changing the original`() {
        var data: JsonElement = JsonPrimitive("x".repeat(2 * 1024 * 1024))
        repeat(1000) { data = JsonArray(listOf(data)) }
        val response = RpcResponse(id = "history-1", command = "get_messages", success = true, data = data)

        val record = HostMessages.response(response) as JsonObject
        val expected = PiJson.parseToJsonElement(
            """{"id":"history-1","type":"response","command":"get_messages","success":true}""",
        )

        assertEquals(expected, record)
        assertFalse(record.containsKey("data"))
        assertTrue(response.data === data, "native RPC consumers must retain access to the original data")
    }

    @Test
    fun `response records preserve failure metadata`() {
        val response = RpcResponse(id = "prompt-1", command = "prompt", success = false, error = "failed")
        val record = HostMessages.response(response)

        assertEquals(PiJson.encodeToJsonElement(RpcResponse.serializer(), response), record)
    }

    @Test
    fun `history messages are chunked into a final batch`() {
        val json = HostMessages.history(emptyList(), final = true).toString()

        assertTrue(json.contains("\"type\":\"history\""), json)
        assertTrue(json.contains("\"final\":true"), json)
    }

    @Test
    fun `open_path messages carry the file and line`() {
        val message = PiJson.decodeFromString(
            ClientMessage.serializer(),
            """{"type":"open_path","path":"src/index.ts","line":42}""",
        )

        assertEquals("open_path", message.type)
        assertEquals("src/index.ts", message.path)
        assertEquals(42, message.line)
    }

    private fun readBundle(): String {
        val html = javaClass.getResourceAsStream("/webview/index.html")?.use { stream ->
            stream.readBytes().toString(Charsets.UTF_8)
        }
        assertNotNull(html, "webview/index.html must be packaged as a plugin resource")
        return html!!
    }
}
