package dev.pi.jetbrains.session

import dev.pi.jetbrains.rpc.PiJson
import dev.pi.jetbrains.rpc.RpcSessionTreeNode
import kotlinx.serialization.json.decodeFromJsonElement
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SessionTreeTest {
    @Test
    fun `flattens depth-first and marks the active branch and forkable rows`() {
        val tree = decode(
            """
            [
              {
                "entry": {"type":"message","id":"e1","parentId":null,"message":{"role":"user","content":"hello"}},
                "children": [
                  {
                    "entry": {"type":"message","id":"e2","parentId":"e1","message":{"role":"assistant","content":[{"type":"text","text":"hi there"}]}},
                    "children": []
                  }
                ],
                "label": "start"
              },
              {
                "entry": {"type":"compaction","id":"e3","parentId":null,"tokensBefore":150000},
                "children": []
              }
            ]
            """.trimIndent(),
        )

        val rows = SessionTree.flatten(tree, leafId = "e2")

        assertEquals(listOf("e1", "e2", "e3"), rows.map { it.id })
        assertEquals(listOf(0, 1, 0), rows.map { it.depth })
        assertEquals("start", rows[0].label)
        assertEquals("user: hello", rows[0].text)
        assertEquals("assistant: hi there", rows[1].text)
        assertTrue(rows[0].forkable)
        assertFalse(rows[1].forkable)
        assertTrue(rows[0].active && rows[1].active)
        assertFalse(rows[2].active)
        assertTrue(rows[2].text.contains("150k") || rows[2].text.contains("compaction"))
    }

    private fun decode(json: String): List<RpcSessionTreeNode> =
        PiJson.decodeFromJsonElement(
            kotlinx.serialization.builtins.ListSerializer(RpcSessionTreeNode.serializer()),
            PiJson.parseToJsonElement(json),
        )
}
