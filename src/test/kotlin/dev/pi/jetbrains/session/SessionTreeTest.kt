package dev.pi.jetbrains.session

import dev.pi.jetbrains.rpc.PiJson
import dev.pi.jetbrains.rpc.RpcSessionTreeNode
import kotlinx.serialization.json.decodeFromJsonElement
import org.junit.jupiter.api.Assertions.assertEquals
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

        assertEquals(listOf("e1"), rows.map { it.id })
        assertEquals(listOf(0), rows.map { it.depth })
        assertEquals("start", rows[0].label)
        assertEquals("user: hello", rows[0].text)
        assertTrue(rows[0].forkable)
        assertTrue(rows[0].active)
    }

    @Test
    fun `shows only user messages while preserving user branches across hidden entries`() {
        val tree = decode(
            """
            [
              {
                "entry": {"type":"message","id":"u1","parentId":null,"message":{"role":"user","content":"first"}},
                "children": [
                  {"entry": {"type":"message","id":"a1","parentId":"u1","message":{"role":"assistant","content":[{"type":"text","text":"answer"}]}}, "children": [
                    {"entry": {"type":"message","id":"u2","parentId":"a1","message":{"role":"user","content":"second"}}, "children": []}
                  ]}
                ]
              }
            ]
            """.trimIndent(),
        )

        val rows = SessionTree.flatten(tree, leafId = "u2")

        assertEquals(listOf("u1", "u2"), rows.map { it.id })
        assertEquals(listOf(0, 0), rows.map { it.depth })
        assertTrue(rows.all { it.role == "user" && it.forkable })
    }

    @Test
    fun `retains user image blocks on forkable tree rows`() {
        val tree = decode(
            """
            [{"entry":{"type":"message","id":"u1","message":{"role":"user","content":[{"type":"text","text":"inspect"},{"type":"image","data":"aGVsbG8=","mimeType":"image/png"}]}},"children":[]}]
            """.trimIndent(),
        )

        val row = SessionTree.flatten(tree, leafId = "u1").single()

        assertEquals("user: inspect", row.text)
        assertEquals(listOf(SessionTreeImage("aGVsbG8=", "image/png")), row.images)
    }

    @Test
    fun `keeps single-child chains flat like the TUI`() {
        val tree = decode(
            """
            [
              {
                "entry": {"type":"message","id":"e1","parentId":null,"message":{"role":"user","content":"hello"}},
                "children": [
                  {"entry": {"type":"model_change","id":"e2","parentId":"e1","provider":"p","modelId":"m"}, "children": [
                    {"entry": {"type":"thinking_level_change","id":"e3","parentId":"e2","thinkingLevel":"high"}, "children": [
                      {"entry": {"type":"message","id":"e4","parentId":"e3","message":{"role":"assistant","content":[{"type":"toolCall","id":"c1","name":"bash","arguments":{"command":"ls -la"}}]}}, "children": [
                        {"entry": {"type":"message","id":"e5","parentId":"e4","message":{"role":"toolResult","toolName":"bash","toolCallId":"c1","content":"out"}}, "children": []}
                      ]}
                    ]}
                  ]}
                ]
              }
            ]
            """.trimIndent(),
        )

        val rows = SessionTree.flatten(tree, leafId = "e5")

        // Bookkeeping entries, assistant messages and tool results are hidden; only the user
        // message remains in the tree.
        assertEquals(listOf("e1"), rows.map { it.id })
        assertEquals(listOf(0), rows.map { it.depth })
    }

    @Test
    fun `indents only at real branch points`() {
        val tree = decode(
            """
            [
              {
                "entry": {"type":"message","id":"root","parentId":null,"message":{"role":"user","content":"q"}},
                "children": [
                  {"entry": {"type":"message","id":"a1","parentId":"root","message":{"role":"user","content":"branch a"}}, "children": [
                    {"entry": {"type":"message","id":"a2","parentId":"a1","message":{"role":"user","content":"a2"}}, "children": []}
                  ]},
                  {"entry": {"type":"message","id":"b1","parentId":"root","message":{"role":"user","content":"branch b"}}, "children": []}
                ]
              }
            ]
            """.trimIndent(),
        )

        val rows = SessionTree.flatten(tree, leafId = "a2")

        // The branch containing the active leaf sorts first; the branch point and
        // its first generation after the branch each get +1 (pi's justBranched rule).
        assertEquals(listOf("root", "a1", "a2", "b1"), rows.map { it.id })
        assertEquals(listOf(0, 1, 2, 1), rows.map { it.depth })
    }

    private fun decode(json: String): List<RpcSessionTreeNode> =
        PiJson.decodeFromJsonElement(
            kotlinx.serialization.builtins.ListSerializer(RpcSessionTreeNode.serializer()),
            PiJson.parseToJsonElement(json),
        )
}
