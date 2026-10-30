package dev.pi.jetbrains.session

import dev.pi.jetbrains.rpc.RpcSessionTreeNode
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** One row of the flattened session tree the webview renders (plan M3.3). */
data class FlatTreeEntry(
    val id: String,
    val parentId: String?,
    val type: String,
    val role: String? = null,
    val label: String? = null,
    val text: String = "",
    val depth: Int = 0,
    /** Only user messages can be forked from (pi's `runtimeHost.fork(entryId)`). */
    val forkable: Boolean = false,
    /** On the path from the root to `leafId`; the UI highlights it. */
    val active: Boolean = false,
)

/** Flattens `get_tree` into depth-first rows plus the active branch marker. */
object SessionTree {
    fun flatten(tree: List<RpcSessionTreeNode>, leafId: String?): List<FlatTreeEntry> {
        val parents = HashMap<String, String?>(tree.size)
        val labels = HashMap<String, String?>(tree.size)
        collect(tree, parents, labels)
        val active = activeIds(parents, leafId)

        val rows = ArrayList<FlatTreeEntry>(parents.size)
        fun visit(node: RpcSessionTreeNode, depth: Int) {
            val entry = node.entry
            val id = entry.string("id") ?: return
            val role = (entry["message"] as? JsonObject)?.string("role")
            rows.add(
                FlatTreeEntry(
                    id = id,
                    parentId = (entry["parentId"] as? JsonPrimitive)?.contentOrNull,
                    type = entry.string("type") ?: "unknown",
                    role = role,
                    label = node.label ?: labels[id],
                    text = describe(entry, role),
                    depth = depth,
                    forkable = entry.string("type") == "message" && role == "user",
                    active = id in active,
                ),
            )
            node.children.forEach { visit(it, depth + 1) }
        }
        tree.forEach { visit(it, 0) }
        return rows
    }

    private fun collect(
        nodes: List<RpcSessionTreeNode>,
        parents: MutableMap<String, String?>,
        labels: MutableMap<String, String?>,
    ) {
        for (node in nodes) {
            val id = node.entry.string("id") ?: continue
            parents[id] = (node.entry["parentId"] as? JsonPrimitive)?.contentOrNull
            if (node.label != null) labels[id] = node.label
            collect(node.children, parents, labels)
        }
    }

    private fun activeIds(parents: Map<String, String?>, leafId: String?): Set<String> {
        if (leafId == null) return emptySet()
        val result = HashSet<String>()
        var current: String? = leafId
        while (current != null && result.add(current)) {
            current = parents[current]
        }
        return result
    }

    private fun describe(entry: JsonObject, role: String?): String {
        val type = entry.string("type") ?: return ""
        return when (type) {
            "message" -> when (role) {
                "user" -> "user: ${contentText(entry)}"
                "assistant" -> "assistant: ${contentText(entry).ifEmpty { "(no content)" }}"
                "toolResult" -> "[tool] ${(entry["message"] as? JsonObject)?.string("toolName") ?: "tool"}"
                "bashExecution" -> "[bash] ${(entry["message"] as? JsonObject)?.string("command") ?: ""}"
                else -> "[${role ?: "message"}]"
            }
            "compaction" -> {
                val tokens = (entry["tokensBefore"] as? JsonPrimitive)?.contentOrNull
                if (tokens != null) "[compaction: ${tokens.toLongOrNull()?.div(1000) ?: tokens}k tokens]" else "[compaction]"
            }
            "branch_summary" -> "[branch summary]"
            "model_change" -> "[model: ${entry.string("provider") ?: "?"}/${entry.string("modelId") ?: "?"}]"
            "thinking_level_change" -> "[thinking: ${entry.string("thinkingLevel") ?: "?"}]"
            "session_info" -> "[name: ${entry.string("name") ?: "(cleared)"}]"
            "custom_message" -> "[${entry.string("customType") ?: "custom"}] ${contentText(entry)}"
            else -> "[$type]"
        }.replace(Regex("\\s+"), " ").trim().take(240)
    }

    private fun contentText(entry: JsonObject): String {
        val message = entry["message"] as? JsonObject ?: return ""
        val content = message["content"] ?: return ""
        val text = when (content) {
            is JsonPrimitive -> content.contentOrNull
            is JsonArray -> content.mapNotNull { block ->
                val obj = block as? JsonObject ?: return@mapNotNull null
                if (obj.string("type") == "text") obj.string("text") else null
            }.joinToString(" ")
            else -> null
        }
        return (text ?: "").replace(Regex("\\s+"), " ").trim().take(200)
    }

    private fun JsonObject.string(key: String): String? =
        (this[key] as? JsonPrimitive)?.contentOrNull
}
