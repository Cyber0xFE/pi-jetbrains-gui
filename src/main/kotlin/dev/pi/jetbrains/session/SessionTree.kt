package dev.pi.jetbrains.session

import dev.pi.jetbrains.rpc.PiJson
import dev.pi.jetbrains.rpc.RpcSessionTreeNode
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

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

/** A `toolCall` block extracted from an assistant message, keyed by call id. */
private data class ToolCallInfo(val name: String, val arguments: JsonObject)

/**
 * Flattens `get_tree` into depth-first rows plus the active branch marker.
 *
 * Indentation and default filtering mirror pi's interactive `/tree` view
 * (`tree-selector.ts`): single-child chains stay flat, depth only increases at
 * real branch points (and the first generation after one), and bookkeeping
 * entries plus text-less assistant messages are hidden by default.
 */
object SessionTree {
    /** Entry types pi's default tree filter hides. */
    private val SETTINGS_TYPES = setOf("label", "context_edit", "custom", "model_change", "thinking_level_change", "session_info")

    fun flatten(tree: List<RpcSessionTreeNode>, leafId: String?): List<FlatTreeEntry> {
        val nodeById = LinkedHashMap<String, RpcSessionTreeNode>()
        val parentOf = HashMap<String, String?>()
        val labels = HashMap<String, String?>()
        indexNodes(tree, null, nodeById, parentOf, labels)

        val toolCalls = HashMap<String, ToolCallInfo>()
        collectToolCalls(tree, toolCalls)

        val activePath = activeIds(parentOf, leafId)

        // Subtree contains the active leaf? Used to sort the active branch first (as pi does).
        val containsActive = HashMap<String, Boolean>()
        fun computeContains(node: RpcSessionTreeNode): Boolean {
            val id = node.entry.string("id")
            val has = (id != null && id == leafId) || node.children.any { computeContains(it) }
            if (id != null) containsActive[id] = has
            return has
        }
        tree.forEach { computeContains(it) }

        // Default filter, mirroring pi's `applyFilter` in default mode.
        fun isVisible(node: RpcSessionTreeNode): Boolean {
            val entry = node.entry
            val id = entry.string("id") ?: return false
            val type = entry.string("type") ?: return true
            if (type == "usage" || type in SETTINGS_TYPES) return false
            if (type == "message" && id != leafId) {
                val message = entry["message"] as? JsonObject
                if (message?.string("role") == "assistant") {
                    val hasText = hasTextContent(message["content"])
                    val stopReason = message.string("stopReason")
                    val isErrorOrAborted = stopReason != null && stopReason != "stop" && stopReason != "toolUse"
                    if (!hasText && !isErrorOrAborted) return false
                }
            }
            return true
        }

        // Attach each visible node to its nearest visible ancestor (pi's `recalculateVisualStructure`).
        val visibleChildren = HashMap<String?, MutableList<String>>()
        for ((id, node) in nodeById) {
            if (!isVisible(node)) continue
            var ancestor: String? = parentOf[id]
            while (ancestor != null && nodeById[ancestor]?.let(::isVisible) != true) {
                ancestor = parentOf[ancestor]
            }
            visibleChildren.getOrPut(ancestor) { mutableListOf() }.add(id)
        }

        fun ordered(ids: List<String>): List<String> =
            ids.sortedByDescending { containsActive[it] == true }

        val rows = ArrayList<FlatTreeEntry>(nodeById.size)
        val rootIds = ordered(visibleChildren[null] ?: emptyList())
        val multipleRoots = rootIds.size > 1

        // pi's indent rules: only branch points (children > 1) and the first
        // generation after a branch increase depth; single-child chains stay flat.
        fun visit(id: String, indent: Int, justBranched: Boolean) {
            val node = nodeById.getValue(id)
            val displayIndent = if (multipleRoots) maxOf(0, indent - 1) else indent
            rows.add(rowOf(node, displayIndent, labels[id], toolCalls, activePath))
            val children = ordered(visibleChildren[id] ?: emptyList())
            val multipleChildren = children.size > 1
            val childIndent = when {
                multipleChildren -> indent + 1
                justBranched && indent > 0 -> indent + 1
                else -> indent
            }
            children.forEach { visit(it, childIndent, multipleChildren) }
        }
        rootIds.forEach { visit(it, if (multipleRoots) 1 else 0, multipleRoots) }
        return rows
    }

    private fun indexNodes(
        nodes: List<RpcSessionTreeNode>,
        parentId: String?,
        nodeById: MutableMap<String, RpcSessionTreeNode>,
        parentOf: MutableMap<String, String?>,
        labels: MutableMap<String, String?>,
    ) {
        for (node in nodes) {
            val id = node.entry.string("id") ?: continue
            nodeById[id] = node
            parentOf[id] = (node.entry["parentId"] as? JsonPrimitive)?.contentOrNull ?: parentId
            if (node.label != null) labels[id] = node.label
            indexNodes(node.children, id, nodeById, parentOf, labels)
        }
    }

    private fun collectToolCalls(nodes: List<RpcSessionTreeNode>, out: MutableMap<String, ToolCallInfo>) {
        for (node in nodes) {
            val message = node.entry["message"] as? JsonObject
            if (message?.string("role") == "assistant") {
                val content = message["content"] as? JsonArray
                content?.forEach { block ->
                    val obj = block as? JsonObject ?: return@forEach
                    if (obj.string("type") == "toolCall") {
                        val id = obj.string("id") ?: return@forEach
                        val args = obj["arguments"] as? JsonObject ?: JsonObject(emptyMap())
                        out[id] = ToolCallInfo(obj.string("name") ?: "tool", args)
                    }
                }
            }
            collectToolCalls(node.children, out)
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

    private fun rowOf(
        node: RpcSessionTreeNode,
        depth: Int,
        label: String?,
        toolCalls: Map<String, ToolCallInfo>,
        activePath: Set<String>,
    ): FlatTreeEntry {
        val entry = node.entry
        val id = entry.string("id") ?: return FlatTreeEntry(id = "", parentId = null, type = "unknown")
        val role = (entry["message"] as? JsonObject)?.string("role")
        return FlatTreeEntry(
            id = id,
            parentId = (entry["parentId"] as? JsonPrimitive)?.contentOrNull,
            type = entry.string("type") ?: "unknown",
            role = role,
            label = label,
            text = describe(entry, role, toolCalls),
            depth = depth,
            forkable = entry.string("type") == "message" && role == "user",
            active = id in activePath,
        )
    }

    private fun describe(entry: JsonObject, role: String?, toolCalls: Map<String, ToolCallInfo>): String {
        val type = entry.string("type") ?: return ""
        return when (type) {
            "message" -> when (role) {
                "user" -> "user: ${contentText(entry)}"
                "assistant" -> "assistant: ${contentText(entry).ifEmpty { "(no content)" }}"
                "toolResult" -> {
                    val message = entry["message"] as? JsonObject
                    val call = message?.string("toolCallId")?.let { toolCalls[it] }
                    if (call != null) formatToolCall(call.name, call.arguments)
                    else "[tool] ${message?.string("toolName") ?: "tool"}"
                }
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

    /** Formats a tool result from its originating `toolCall`, like pi's `formatToolCall`. */
    private fun formatToolCall(name: String, args: JsonObject): String {
        fun arg(vararg keys: String): String? {
            for (key in keys) {
                val value = args[key] as? JsonPrimitive ?: continue
                val text = value.contentOrNull ?: continue
                if (text.isNotEmpty()) return text
            }
            return null
        }
        fun path(vararg keys: String): String = shortenPath(arg(*keys) ?: ".")
        return when (name) {
            "read" -> "[read: ${path("path", "file_path")}${readRange(args)}]"
            "write" -> "[write: ${path("path", "file_path")}]"
            "edit" -> "[edit: ${path("path", "file_path")}]"
            "bash" -> {
                val raw = arg("command") ?: ""
                val cmd = raw.replace(Regex("[\\n\\t]"), " ").trim().take(50)
                "[bash: $cmd${if (raw.length > 50) "..." else ""}]"
            }
            "grep" -> "[grep: /${arg("pattern") ?: ""}/ in ${path("path")}]"
            "find" -> "[find: ${arg("pattern") ?: ""} in ${path("path")}]"
            "ls" -> "[ls: ${path("path")}]"
            else -> {
                val argsStr = runCatching { PiJson.encodeToString(kotlinx.serialization.json.JsonObject.serializer(), args) }
                    .getOrDefault(args.toString())
                "[$name: ${argsStr.take(40)}${if (argsStr.length > 40) "..." else ""}]"
            }
        }
    }

    /** pi's `formatReadLineRange`: `:start` or `:start-end`, empty when both are omitted. */
    private fun readRange(args: JsonObject): String {
        val offset = (args["offset"] as? JsonPrimitive)?.contentOrNull?.toLongOrNull()
        val limit = (args["limit"] as? JsonPrimitive)?.contentOrNull?.toLongOrNull()
        if (offset == null && limit == null) return ""
        val start = offset ?: 1L
        return if (limit == null) ":$start" else {
            val end = start + limit - 1
            if (end == 0L) ":$start" else ":$start-$end"
        }
    }

    private fun shortenPath(path: String): String {
        val home = System.getProperty("user.home") ?: return path
        return if (home.isNotEmpty() && path.startsWith(home)) "~${path.substring(home.length)}" else path
    }

    private fun hasTextContent(content: Any?): Boolean {
        return when (content) {
            is JsonPrimitive -> content.contentOrNull?.trim()?.isNotEmpty() == true
            is JsonArray -> content.any { block ->
                val obj = block as? JsonObject ?: return@any false
                if (obj.string("type") != "text") return@any false
                obj.string("text")?.trim()?.isNotEmpty() == true
            }
            else -> false
        }
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
        (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null }
}
