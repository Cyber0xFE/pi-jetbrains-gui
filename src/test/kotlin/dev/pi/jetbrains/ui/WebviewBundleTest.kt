package dev.pi.jetbrains.ui

import dev.pi.jetbrains.PiChatService
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
    }

    @Test
    fun `status messages carry the fields the UI reads`() {
        val status = PiChatService.Status(
            phase = PiChatService.Phase.RUNNING,
            message = "ready",
            model = "claude-sonnet-4-5",
            thinkingLevel = "high",
            isStreaming = true,
            context = PiChatService.StatusUsage(tokens = 1_000L, contextWindow = 200_000L, percent = 0.5),
        )

        val json = HostMessages.status(status).toString()

        assertTrue(json.contains("\"type\":\"status\""), json)
        assertTrue(json.contains("\"phase\":\"running\""), json)
        assertTrue(json.contains("\"model\":\"claude-sonnet-4-5\""), json)
        assertTrue(json.contains("\"thinkingLevel\":\"high\""), json)
        assertTrue(json.contains("\"isStreaming\":true"), json)
        assertTrue(json.contains("\"percent\":0.5"), json)
    }

    @Test
    fun `history messages are chunked into a final batch`() {
        val json = HostMessages.history(emptyList(), final = true).toString()

        assertTrue(json.contains("\"type\":\"history\""), json)
        assertTrue(json.contains("\"final\":true"), json)
    }

    private fun readBundle(): String {
        val html = javaClass.getResourceAsStream("/webview/index.html")?.use { stream ->
            stream.readBytes().toString(Charsets.UTF_8)
        }
        assertNotNull(html, "webview/index.html must be packaged as a plugin resource")
        return html!!
    }
}
