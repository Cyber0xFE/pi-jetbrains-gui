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
    val images: List<SessionTreeImage> = emptyList(),
)

data class SessionTreeImage(val data: String, val mimeType: String)

/** A `toolCall` block extracted from an assistant message, keyed by call id. */
private data class ToolCallInfo(val name: String, val arguments: JsonObject)

/** Explicit-stack DFS frame for [SessionTree.flattenEntries]. */
private data class Visit(val id: String, val indent: Int, val justBranched: Boolean)

/**
 * Iterative index of a `get_tree` response. Entries stay raw so arbitrarily deep session chains
 * cannot overflow the thread stack like recursive kotlinx deserialization does.
 */
private class TreeIndex {
    val entries = LinkedHashMap<String, JsonObject>()
    val parentOf = HashMap<String, String?>()
    val labels = HashMap<String, String?>()
    val childIds = HashMap<String, MutableList<String>>()
    val roots = ArrayList<String>()

    fun add(id: String, entry: JsonObject, inheritedParent: String?, label: String?) {
        entries[id] = entry
        parentOf[id] = (entry["parentId"] as? JsonPrimitive)?.contentOrNull ?: inheritedParent
        if (label != null) labels[id] = label
        if (inheritedParent == null) roots.add(id)
        else childIds.getOrPut(inheritedParent) { mutableListOf() }.add(id)
    }
}

/**
 * Flattens `get_tree` into depth-first rows plus the active branch marker.
 *
 * Indentation mirrors pi's interactive `/tree` view (`tree-selector.ts`): single-child chains
 * stay flat and depth only increases at real branch points (and the first generation after one).
 * Every entry is returned; the webview shows user messages by default and reveals the remaining
 * rows on demand per fork point.
 */
object SessionTree {
    fun flatten(tree: List<RpcSessionTreeNode>, leafId: String?): List<FlatTreeEntry> {
        val index = TreeIndex()
        val stack = ArrayDeque<Pair<RpcSessionTreeNode, String?>>()
        for (node in tree.asReversed()) stack.addLast(node to null)
        while (stack.isNotEmpty()) {
            val (node, inheritedParent) = stack.removeLast()
            val id = node.entry.string("id") ?: continue
            index.add(id, node.entry, inheritedParent, node.label)
            for (child in node.children.asReversed()) stack.addLast(child to id)
        }
        return flattenEntries(index, leafId)
    }

    /**
     * Flattens the raw `get_tree` data. Long sessions are one deeply nested chain, which makes
     * `decodeDataAs<RpcTreeData>()` overflow the stack (the failure is swallowed and the tree
     * picker stays empty); this walks the already-parsed JSON iteratively instead.
     */
    fun flatten(data: JsonObject, leafId: String? = null): List<FlatTreeEntry> {
        val index = TreeIndex()
        val roots = data["tree"] as? JsonArray ?: JsonArray(emptyList())
        val stack = ArrayDeque<Pair<JsonObject, String?>>()
        for (i in roots.lastIndex downTo 0) {
            (roots[i] as? JsonObject)?.let { stack.addLast(it to null) }
        }
        while (stack.isNotEmpty()) {
            val (node, inheritedParent) = stack.removeLast()
            val entry = node["entry"] as? JsonObject ?: continue
            val id = entry.string("id") ?: continue
            index.add(id, entry, inheritedParent, node.string("label"))
            val children = node["children"] as? JsonArray ?: continue
            for (i in children.lastIndex downTo 0) {
                (children[i] as? JsonObject)?.let { stack.addLast(it to id) }
            }
        }
        return flattenEntries(index, leafId)
    }

    /**
     * Flattens the flat `get_entries` result into the rows [flatten] builds from `get_tree`.
     *
     * `get_tree` wraps every branch level in another `children` array, so a long session becomes one
     * JSON document thousands of levels deep. `PiJson.parseToJsonElement` is recursive, so it
     * overflows the stdout reader's stack before the record ever reaches this class; the response is
     * dropped and the request times out. `get_entries` carries the same entries as a flat list whose
     * records stay shallow at any session length.
     *
     * Labels live in `label` entries resolved per target, like pi's `getTree()` node labels, and
     * sibling order follows pi's timestamp sort.
     */
    fun flattenEntries(entries: List<JsonObject>, leafId: String? = null): List<FlatTreeEntry> {
        val index = TreeIndex()
        val nodes = HashMap<String, JsonObject>(entries.size)
        val labels = HashMap<String, String>()
        for (entry in entries) {
            val id = entry.string("id") ?: continue
            nodes[id] = entry
            if (entry.string("type") != "label") continue
            val target = entry.string("targetId") ?: continue
            val label = entry.string("label")
            if (label.isNullOrEmpty()) labels.remove(target) else labels[target] = label
        }
        for (entry in entries) {
            val id = entry.string("id") ?: continue
            val parentId = entry.string("parentId")?.takeIf { it != id && it in nodes }
            index.entries[id] = entry
            labels[id]?.let { index.labels[id] = it }
            if (parentId == null) {
                index.roots.add(id)
            } else {
                index.parentOf[id] = parentId
                index.childIds.getOrPut(parentId) { mutableListOf() }.add(id)
            }
        }
        for (children in index.childIds.values) {
            children.sortBy { timestampOf(index.entries[it]) ?: "" }
        }
        return flattenEntries(index, leafId)
    }

    /** ISO-8601 strings from one writer sort lexicographically exactly like pi's `new Date(...)`. */
    private fun timestampOf(entry: JsonObject?): String? = entry?.string("timestamp")

    private fun flattenEntries(index: TreeIndex, leafId: String?): List<FlatTreeEntry> {
        val toolCalls = HashMap<String, ToolCallInfo>()
        index.entries.values.forEach { collectToolCalls(it, toolCalls) }

        val activePath = activeIds(index.parentOf, leafId)

        // Subtree contains the active leaf? Used to sort the active branch first (as pi does).
        val order = ArrayList<String>(index.entries.size)
        val stack = ArrayDeque<String>()
        for (i in index.roots.lastIndex downTo 0) stack.addLast(index.roots[i])
        while (stack.isNotEmpty()) {
            val id = stack.removeLast()
            order.add(id)
            val children = index.childIds[id] ?: continue
            for (i in children.lastIndex downTo 0) stack.addLast(children[i])
        }
        val containsActive = HashMap<String, Boolean>(index.entries.size)
        for (i in order.lastIndex downTo 0) {
            val id = order[i]
            containsActive[id] = id == leafId || index.childIds[id]?.any { containsActive[it] == true } == true
        }

        fun ordered(ids: List<String>): List<String> =
            ids.sortedByDescending { containsActive[it] == true }

        val rows = ArrayList<FlatTreeEntry>(index.entries.size)
        val rootIds = ordered(index.roots)
        val multipleRoots = rootIds.size > 1

        // pi's indent rules: only branch points (children > 1) and the first
        // generation after a branch increase depth; single-child chains stay flat.
        val visits = ArrayDeque<Visit>()
        for (i in rootIds.lastIndex downTo 0) {
            visits.addLast(Visit(rootIds[i], if (multipleRoots) 1 else 0, multipleRoots))
        }
        while (visits.isNotEmpty()) {
            val visit = visits.removeLast()
            val displayIndent = if (multipleRoots) maxOf(0, visit.indent - 1) else visit.indent
            rows.add(
                rowOf(
                    index.entries.getValue(visit.id),
                    index.parentOf[visit.id],
                    displayIndent,
                    index.labels[visit.id],
                    toolCalls,
                    activePath,
                ),
            )
            val children = ordered(index.childIds[visit.id] ?: emptyList())
            val multipleChildren = children.size > 1
            val childIndent = when {
                multipleChildren -> visit.indent + 1
                visit.justBranched && visit.indent > 0 -> visit.indent + 1
                else -> visit.indent
            }
            for (i in children.lastIndex downTo 0) {
                visits.addLast(Visit(children[i], childIndent, multipleChildren))
            }
        }
        return rows
    }

    private fun collectToolCalls(entry: JsonObject, out: MutableMap<String, ToolCallInfo>) {
        val message = entry["message"] as? JsonObject
        if (message?.string("role") != "assistant") return
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
        entry: JsonObject,
        parentId: String?,
        depth: Int,
        label: String?,
        toolCalls: Map<String, ToolCallInfo>,
        activePath: Set<String>,
    ): FlatTreeEntry {
        val id = entry.string("id") ?: return FlatTreeEntry(id = "", parentId = null, type = "unknown")
        val role = (entry["message"] as? JsonObject)?.string("role")
        return FlatTreeEntry(
            id = id,
            parentId = parentId,
            type = entry.string("type") ?: "unknown",
            role = role,
            label = label,
            text = describe(entry, role, toolCalls),
            depth = depth,
            forkable = entry.string("type") == "message" && role == "user",
            active = id in activePath,
            images = userImages(entry),
        )
    }

    private fun userImages(entry: JsonObject): List<SessionTreeImage> {
        val message = entry["message"] as? JsonObject ?: return emptyList()
        if (message.string("role") != "user") return emptyList()
        val content = message["content"] as? JsonArray ?: return emptyList()
        return content.mapNotNull { block ->
            val image = block as? JsonObject ?: return@mapNotNull null
            if (image.string("type") != "image") return@mapNotNull null
            val data = image.string("data") ?: return@mapNotNull null
            val mimeType = image.string("mimeType") ?: return@mapNotNull null
            SessionTreeImage(data, mimeType)
        }
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
