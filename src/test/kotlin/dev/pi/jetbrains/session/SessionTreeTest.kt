package dev.pi.jetbrains.session

import dev.pi.jetbrains.rpc.PiJson
import dev.pi.jetbrains.rpc.RpcSessionTreeNode
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
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

        // Every entry is returned depth-first; the webview collapses non-user rows by default.
        assertEquals(listOf("e1", "e2", "e3"), rows.map { it.id })
        assertEquals(listOf(0, 1, 0), rows.map { it.depth })
        assertEquals("start", rows[0].label)
        assertEquals("user: hello", rows[0].text)
        assertTrue(rows[0].forkable)
        assertTrue(rows[0].active)
        assertEquals("hi there", rows[1].text.removePrefix("assistant: "))
        assertEquals("e1", rows[1].parentId)
        assertTrue(rows[1].active)
        assertTrue(!rows[1].forkable)
    }

    @Test
    fun `returns hidden assistant and bookkeeping rows with their parent chain`() {
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

        assertEquals(listOf("u1", "a1", "u2"), rows.map { it.id })
        assertEquals(listOf(0, 0, 0), rows.map { it.depth })
        assertEquals(listOf("user", "assistant", "user"), rows.map { it.role })
        assertEquals(listOf(true, false, true), rows.map { it.forkable })
        assertEquals(listOf(null, "u1", "a1"), rows.map { it.parentId })
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

        // The chain stays flat at depth 0; non-user rows ride along so the webview can expand them.
        assertEquals(listOf("e1", "e2", "e3", "e4", "e5"), rows.map { it.id })
        assertEquals(listOf(0, 0, 0, 0, 0), rows.map { it.depth })
        assertEquals("[bash: ls -la]", rows[4].text)
        assertEquals("e4", rows[4].parentId)
        assertTrue(rows.last().active)
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

    @Test
    fun `flattens a deep raw tree without recursive deserialization`() {
        // A real session is one deeply nested chain; decoding it into RpcSessionTreeNode
        // overflowed the stack and the swallowed failure left the tree picker empty.
        val depth = 800
        fun roleOf(i: Int): String = if (i % 2 == 0) "user" else "assistant"
        fun entry(id: String, role: String, text: String, parentId: String?): JsonObject = JsonObject(
            mapOf(
                "type" to JsonPrimitive("message"),
                "id" to JsonPrimitive(id),
                "parentId" to (parentId?.let(::JsonPrimitive) ?: JsonNull),
                "message" to JsonObject(
                    mapOf(
                        "role" to JsonPrimitive(role),
                        "content" to JsonArray(
                            listOf(JsonObject(mapOf("type" to JsonPrimitive("text"), "text" to JsonPrimitive(text)))),
                        ),
                    ),
                ),
            ),
        )

        var node = JsonObject(
            mapOf(
                "entry" to entry("e$depth", roleOf(depth), "m$depth", "e${depth - 1}"),
                "children" to JsonArray(emptyList()),
            ),
        )
        for (i in depth - 1 downTo 0) {
            node = JsonObject(
                mapOf(
                    "entry" to entry("e$i", roleOf(i), "m$i", if (i == 0) null else "e${i - 1}"),
                    "children" to JsonArray(listOf(node)),
                ),
            )
        }
        val data = JsonObject(
            mapOf(
                "tree" to JsonArray(listOf(node)),
                "leafId" to JsonPrimitive("e$depth"),
            ),
        )

        val rows = SessionTree.flatten(data, "e$depth")

        assertEquals((0..depth).map { "e$it" }, rows.map { it.id })
        assertEquals("user: m0", rows.first().text)
        assertTrue(rows.all { it.depth == 0 })
        assertTrue(rows.last().active)
    }

    @Test
    fun `flattens a long flat entry list the same way as the nested tree`() {
        // `get_entries` keeps the stdout record shallow, so chains of any length parse safely.
        val depth = 1400
        val entries = ArrayList<JsonObject>(depth + 1)
        for (i in 0..depth) {
            entries.add(
                flatMessage(
                    id = "e$i",
                    parentId = if (i == 0) null else "e${i - 1}",
                    role = if (i % 2 == 0) "user" else "assistant",
                    text = "m$i",
                    timestamp = "2025-10-30T00:00:00.000Z",
                ),
            )
        }

        val rows = SessionTree.flattenEntries(entries, leafId = "e$depth")

        assertEquals((0..depth).map { "e$it" }, rows.map { it.id })
        assertEquals("user: m0", rows.first().text)
        assertTrue(rows.all { it.depth == 0 })
        assertTrue(rows.all { it.active })
        assertTrue(rows.last().active)
    }

    @Test
    fun `resolves label entries and orders siblings by timestamp`() {
        val entries = listOf(
            flatMessage("e0", null, "user", "root", "2025-10-30T00:00:00.000Z"),
            // Reversed on disk; pi sorts children by timestamp in the tree view.
            flatMessage("e2", "e0", "user", "second", "2025-10-30T00:00:02.000Z"),
            flatMessage("e1", "e0", "user", "first", "2025-10-30T00:00:01.000Z"),
            flatLabel("l1", "e2", "e1", "keep"),
        )

        // No active leaf, so sibling order comes from the timestamps alone.
        val rows = SessionTree.flattenEntries(entries, leafId = null)

        assertEquals(listOf("e0", "e1", "e2", "l1"), rows.map { it.id })
        assertEquals("keep", rows.first { it.id == "e1" }.label)
    }

    private fun flatMessage(id: String, parentId: String?, role: String, text: String, timestamp: String): JsonObject =
        JsonObject(
            mapOf(
                "type" to JsonPrimitive("message"),
                "id" to JsonPrimitive(id),
                "parentId" to (parentId?.let(::JsonPrimitive) ?: JsonNull),
                "timestamp" to JsonPrimitive(timestamp),
                "message" to JsonObject(
                    mapOf(
                        "role" to JsonPrimitive(role),
                        "content" to JsonArray(
                            listOf(
                                JsonObject(
                                    mapOf(
                                        "type" to JsonPrimitive("text"),
                                        "text" to JsonPrimitive(text),
                                    ),
                                ),
                            ),
                        ),
                    ),
                ),
            ),
        )

    private fun flatLabel(id: String, parentId: String?, targetId: String, label: String): JsonObject =
        JsonObject(
            mapOf(
                "type" to JsonPrimitive("label"),
                "id" to JsonPrimitive(id),
                "parentId" to (parentId?.let(::JsonPrimitive) ?: JsonNull),
                "timestamp" to JsonPrimitive("2025-10-30T00:00:03.000Z"),
                "targetId" to JsonPrimitive(targetId),
                "label" to JsonPrimitive(label),
            ),
        )

    private fun decode(json: String): List<RpcSessionTreeNode> =
        PiJson.decodeFromJsonElement(
            kotlinx.serialization.builtins.ListSerializer(RpcSessionTreeNode.serializer()),
            PiJson.parseToJsonElement(json),
        )
}
