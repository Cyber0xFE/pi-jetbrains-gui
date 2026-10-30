package dev.pi.jetbrains.editor

import dev.pi.jetbrains.rpc.PiJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Paths

/** Pure decision logic of [ToolFileRefresher]; the VFS side needs a live IDE, so it is not covered. */
class ToolFileRefresherTest {
    @Test
    fun `edit and write refresh their path argument`() {
        assertEquals("src/a.ts", ToolFileRefresher.writtenPath("edit", args("""{"path":"src/a.ts","edits":[]}""")))
        assertEquals("src/b.ts", ToolFileRefresher.writtenPath("write", args("""{"path":"src/b.ts","content":"x"}""")))
    }

    @Test
    fun `readonly tools do not refresh anything`() {
        assertNull(ToolFileRefresher.writtenPath("read", args("""{"path":"src/a.ts"}""")))
        assertNull(ToolFileRefresher.writtenPath("grep", args("""{"pattern":"x"}""")))
        assertNull(ToolFileRefresher.writtenPath(null, args("""{"path":"src/a.ts"}""")))
    }

    @Test
    fun `bash is treated as project wide`() {
        assertTrue(ToolFileRefresher.touchesProjectWide("bash"))
        assertFalse(ToolFileRefresher.touchesProjectWide("edit"))
    }

    @Test
    fun `relative paths resolve against the project root`() {
        val base = Paths.get("D:/workspace/repo")

        assertEquals(Paths.get("D:/workspace/repo/src/a.ts"), ToolFileRefresher.resolve(base, "src/a.ts"))
        assertEquals(Paths.get("D:/other/a.ts"), ToolFileRefresher.resolve(base, "D:/other/a.ts"))
        assertEquals(Paths.get("D:/workspace/repo/b.ts"), ToolFileRefresher.resolve(base, "src/../b.ts"))
    }

    @Test
    fun `tool arguments are carried from start to end by call id`() {
        val buffer = ToolArgsBuffer()

        buffer.onStart("call-1", args("""{"path":"src/a.ts"}"""))

        assertEquals("src/a.ts", buffer.take("call-1")?.get("path")?.let { (it as JsonPrimitive).contentOrNull })
        assertNull(buffer.take("call-1"), "args are consumed by the matching end event")
    }

    private fun args(json: String): JsonObject = PiJson.parseToJsonElement(json) as JsonObject
}
