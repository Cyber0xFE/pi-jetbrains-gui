package dev.pi.jetbrains.session

import dev.pi.jetbrains.rpc.PiJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.nio.file.attribute.BasicFileAttributes
import java.time.Instant
import java.time.format.DateTimeParseException

/** One row of the session list (plan M3.1). Mirrors the display fields of pi's `SessionInfo`. */
data class SessionSummary(
    val path: String,
    val id: String,
    val name: String? = null,
    val cwd: String? = null,
    val created: Long? = null,
    val modified: Long = 0,
    val messageCount: Int = 0,
    val firstMessage: String? = null,
    val parentSessionPath: String? = null,
)

/**
 * Read-only index over pi's JSONL session files.
 *
 * Only the current project folder is scanned (`--<safe-cwd>--`), exactly like the TUI's default
 * session scope. Files are parsed line by line with a hard byte budget so a corrupt or gigantic
 * session cannot stall the tool window.
 */
object SessionIndex {
    /** pi's header scan limit; we use a larger budget because the name/message count need more lines. */
    const val MAX_SCAN_BYTES_PER_FILE: Long = 4L * 1024 * 1024

    private const val ENV_AGENT_DIR = "PI_CODING_AGENT_DIR"
    private const val ENV_SESSION_DIR = "PI_CODING_AGENT_SESSION_DIR"
    private const val MAX_CACHE_ENTRIES = 4096
    private val cacheLock = Any()
    private val cache = object : LinkedHashMap<Path, CachedSummary>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Path, CachedSummary>?): Boolean =
            size > MAX_CACHE_ENTRIES
    }

    private data class CacheStamp(val modified: Long, val size: Long, val maxBytes: Long)
    private data class CachedSummary(val stamp: CacheStamp, val summary: SessionSummary?)

    /** `~/.pi/agent`, or `PI_CODING_AGENT_DIR` when set (mirrors `config.ts`). */
    fun agentDir(env: Map<String, String> = System.getenv()): Path {
        val override = env[ENV_AGENT_DIR]?.takeIf { it.isNotBlank() }
        return if (override != null) expandHome(override) else homeDir().resolve(".pi").resolve("agent")
    }

    /**
     * Directory holding the current project's sessions. A custom `PI_CODING_AGENT_SESSION_DIR`
     * holds sessions for every cwd, so [list] filters those by header cwd.
     */
    fun sessionDir(cwd: Path, env: Map<String, String> = System.getenv()): Path {
        val override = env[ENV_SESSION_DIR]?.takeIf { it.isNotBlank() }
        if (override != null) return expandHome(override)
        return agentDir(env).resolve("sessions").resolve(safeDirName(cwd))
    }

    /** cwd → `--D-workspace-pi--` (session-manager.ts `getDefaultSessionDirPath`). */
    fun safeDirName(cwd: Path): String {
        val absolute = cwd.toAbsolutePath().normalize().toString()
        val stripped = absolute.replace(Regex("^[/\\\\]"), "")
        return "--${stripped.replace(Regex("[/\\\\:]"), "-")}--"
    }

    /**
     * Lists sessions for [cwd], newest activity first.
     *
     * Unreadable or malformed files are skipped instead of failing the whole listing.
     */
    fun list(
        cwd: Path,
        env: Map<String, String> = System.getenv(),
        maxBytesPerFile: Long = MAX_SCAN_BYTES_PER_FILE,
    ): List<SessionSummary> {
        val dir = sessionDir(cwd, env)
        if (!Files.isDirectory(dir)) return emptyList()
        val expectedCwd = cwd.toAbsolutePath().normalize().toString()
        val shared = env[ENV_SESSION_DIR]?.isNotBlank() == true
        val sessions = ArrayList<SessionSummary>()
        Files.newDirectoryStream(dir, "*.jsonl").use { stream ->
            for (file in stream) {
                val summary = runCatching { read(file, maxBytesPerFile) }.getOrNull() ?: continue
                if (shared && summary.cwd != null && normalizePath(summary.cwd) != expectedCwd) continue
                sessions.add(summary)
            }
        }
        return sessions.sortedByDescending { it.modified }
    }

    /** Reads one session file, returning null when it has no valid header. */
    fun read(file: Path, maxBytesPerFile: Long = MAX_SCAN_BYTES_PER_FILE): SessionSummary? {
        val absoluteFile = file.toAbsolutePath().normalize()
        val attributes = runCatching { Files.readAttributes(absoluteFile, BasicFileAttributes::class.java) }.getOrNull()
            ?: return null
        val stamp = CacheStamp(attributes.lastModifiedTime().toMillis(), attributes.size(), maxBytesPerFile)
        synchronized(cacheLock) {
            cache[absoluteFile]?.takeIf { it.stamp == stamp }?.let { return it.summary }
        }

        var id: String? = null
        var cwd: String? = null
        var parentSessionPath: String? = null
        var created: Long? = null
        var name: String? = null
        var messageCount = 0
        var firstMessage: String? = null
        var lastActivity: Long? = null
        var consumed = 0L

        Files.newBufferedReader(file, Charsets.UTF_8).use { reader ->
            while (true) {
                val line = reader.readLine() ?: break
                consumed += line.length + 1L
                if (line.isBlank()) continue
                val entry = try {
                    PiJson.parseToJsonElement(line) as? JsonObject
                } catch (_: Throwable) {
                    null
                } ?: continue
                val type = entry.string("type") ?: continue

                if (id == null) {
                    if (type != "session") return null
                    id = entry.string("id") ?: return null
                    cwd = entry.string("cwd")
                    parentSessionPath = entry.string("parentSession")
                    created = parseTimestamp(entry.string("timestamp"))
                    continue
                }

                val entryTime = parseTimestamp(entry.string("timestamp"))
                when (type) {
                    "session_info" -> {
                        // Latest entry wins, including explicit clears.
                        name = entry.string("name")?.trim()?.takeIf { it.isNotEmpty() }
                    }
                    "message" -> {
                        messageCount++
                        if (firstMessage == null) firstMessage = userText(entry)
                        val time = messageTime(entry)
                        if (time != null) lastActivity = maxOf(lastActivity ?: time, time)
                    }
                }
                val previous = lastActivity
                if (entryTime != null && (previous == null || entryTime > previous)) {
                    lastActivity = entryTime
                }
                if (consumed >= maxBytesPerFile) break
            }
        }

        val sessionId = id ?: return null
        val summary = SessionSummary(
            path = absoluteFile.toString(),
            id = sessionId,
            name = name,
            cwd = cwd,
            created = created,
            modified = lastActivity ?: created ?: attributes.lastModifiedTime().toMillis(),
            messageCount = messageCount,
            firstMessage = firstMessage,
            parentSessionPath = parentSessionPath,
        )
        synchronized(cacheLock) { cache[absoluteFile] = CachedSummary(stamp, summary) }
        return summary
    }

    private fun userText(entry: JsonObject): String? {
        val message = entry["message"] as? JsonObject ?: return null
        if (message.string("role") != "user") return null
        val content = message["content"] ?: return null
        val text = when (content) {
            is JsonPrimitive -> content.contentOrNull
            is kotlinx.serialization.json.JsonArray -> content.mapNotNull { block ->
                val obj = block as? JsonObject ?: return@mapNotNull null
                if (obj.string("type") == "text") obj.string("text") else null
            }.joinToString(" ")
            else -> null
        } ?: return null
        return text.replace(Regex("\\s+"), " ").trim().take(200).takeIf { it.isNotEmpty() }
    }

    /** Message timestamps are epoch millis in the wire format; fall back to the entry timestamp. */
    private fun messageTime(entry: JsonObject): Long? {
        val message = entry["message"] as? JsonObject ?: return null
        return (message["timestamp"] as? JsonPrimitive)?.longOrNull
            ?: parseTimestamp(entry.string("timestamp"))
    }

    private fun parseTimestamp(value: String?): Long? {
        if (value.isNullOrBlank()) return null
        return try {
            Instant.parse(value).toEpochMilli()
        } catch (_: DateTimeParseException) {
            null
        }
    }

    private fun normalizePath(path: String): String =
        runCatching { Paths.get(path).toAbsolutePath().normalize().toString() }.getOrDefault(path)

    private fun expandHome(path: String): Path {
        if (!path.startsWith("~")) return Paths.get(path)
        val rest = path.drop(1).trimStart('/', '\\')
        val home = homeDir()
        return if (rest.isEmpty()) home else home.resolve(rest)
    }

    private fun homeDir(): Path =
        Paths.get(System.getProperty("user.home") ?: ".").toAbsolutePath().normalize()

    private fun JsonObject.string(key: String): String? =
        (this[key] as? JsonPrimitive)?.contentOrNull
}
