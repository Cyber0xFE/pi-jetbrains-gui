package dev.pi.jetbrains.session

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

class SessionIndexTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `encodes the cwd like session-manager`() {
        val cwd = Files.createDirectories(tempDir.resolve("workspace").resolve("pi")).toAbsolutePath().normalize()
        val encoded = SessionIndex.safeDirName(cwd)

        assertTrue(encoded.startsWith("--") && encoded.endsWith("--"), encoded)
        assertTrue(!encoded.removePrefix("--").removeSuffix("--").contains(':'), encoded)
        assertTrue(!encoded.removePrefix("--").removeSuffix("--").contains('/'), encoded)
        assertTrue(!encoded.removePrefix("--").removeSuffix("--").contains('\\'), encoded)
    }

    @Test
    fun `lists sessions newest first with names and message counts`() {
        val project = Files.createDirectories(tempDir.resolve("project"))
        val agentDir = Files.createDirectories(tempDir.resolve("agent"))
        val sessions = Files.createDirectories(
            agentDir.resolve("sessions").resolve(SessionIndex.safeDirName(project)),
        )
        writeSession(
            sessions.resolve("older.jsonl"),
            id = "older",
            cwd = project.toString(),
            messages = listOf(
                userLine("m1", ts = 1_000, "first question"),
                assistantLine("m2", ts = 2_000, "answer"),
            ),
        )
        writeSession(
            sessions.resolve("newer.jsonl"),
            id = "newer",
            cwd = project.toString(),
            messages = listOf(
                userLine("n1", ts = 3_000, "newer question"),
                assistantLine("n2", ts = 4_000, "answer"),
                sessionInfoLine("n3", ts = 5_000, "my session"),
                sessionInfoLine("n4", ts = 6_000, ""),
                sessionInfoLine("n5", ts = 7_000, "renamed session"),
            ),
        )
        Files.writeString(sessions.resolve("broken.jsonl"), "not json\n{\"type\":\"message\"}\n")

        val listed = SessionIndex.list(project, env = mapOf("PI_CODING_AGENT_DIR" to agentDir.toString()))

        assertEquals(listOf("newer", "older"), listed.map { it.id })
        val newer = listed.first()
        assertEquals("renamed session", newer.name)
        assertEquals(2, newer.messageCount)
        assertTrue(newer.modified >= 4_000, "modified=${newer.modified}")
        assertEquals("newer question", newer.firstMessage)
        val older = listed.last()
        assertNull(older.name)
        assertEquals(2, older.messageCount)    }

    @Test
    fun `shared session dir filters sessions by header cwd`() {
        val project = Files.createDirectories(tempDir.resolve("project"))
        val other = Files.createDirectories(tempDir.resolve("other"))
        val shared = Files.createDirectories(tempDir.resolve("shared"))
        writeSession(shared.resolve("mine.jsonl"), id = "mine", cwd = project.toString(), messages = emptyList())
        writeSession(shared.resolve("theirs.jsonl"), id = "theirs", cwd = other.toString(), messages = emptyList())

        val listed = SessionIndex.list(
            project,
            env = mapOf("PI_CODING_AGENT_SESSION_DIR" to shared.toString()),
        )

        assertEquals(listOf("mine"), listed.map { it.id })
    }

    @Test
    fun `skips files without a versioned session header`() {
        val project = Files.createDirectories(tempDir.resolve("project"))
        val agentDir = Files.createDirectories(tempDir.resolve("agent"))
        val sessions = Files.createDirectories(
            agentDir.resolve("sessions").resolve(SessionIndex.safeDirName(project)),
        )
        Files.writeString(
            sessions.resolve("legacy.jsonl"),
            "{\"type\":\"message\",\"id\":\"m1\",\"parentId\":null,\"timestamp\":\"2025-01-01T00:00:00.000Z\",\"message\":{\"role\":\"user\",\"content\":\"hi\"}}\n",
        )

        val listed = SessionIndex.list(project, env = mapOf("PI_CODING_AGENT_DIR" to agentDir.toString()))

        assertTrue(listed.isEmpty(), "expected the headerless file to be skipped: $listed")
    }

    @Test
    fun `recovers the latest name from the tail when the scan budget cuts a file short`() {
        val project = Files.createDirectories(tempDir.resolve("project"))
        val agentDir = Files.createDirectories(tempDir.resolve("agent"))
        val sessions = Files.createDirectories(
            agentDir.resolve("sessions").resolve(SessionIndex.safeDirName(project)),
        )
        val big = sessions.resolve("big.jsonl")
        val filler = "x".repeat(400)
        writeSession(
            big,
            id = "big",
            cwd = project.toString(),
            messages = listOf(
                userLine("m1", ts = 1_000, "first question $filler"),
                assistantLine("m2", ts = 2_000, "answer $filler"),
                sessionInfoLine("m3", ts = 3_000, "early name"),
                userLine("m4", ts = 4_000, "second question $filler"),
            ),
        )
        // Appended after the budget cutoff, like an out-of-band rename does.
        Files.writeString(
            big,
            sessionInfoLine("m5", ts = 5_000, "renamed after the fact") + "\n",
            java.nio.file.StandardOpenOption.APPEND,
        )

        val summary = SessionIndex.read(big, maxBytesPerFile = 1_000)

        assertEquals("renamed after the fact", summary?.name)
        assertEquals("big", summary?.id)
    }

    @Test
    fun `leafEntryId returns the last entry id`() {
        val file = tempDir.resolve("chained.jsonl")
        Files.writeString(
            file,
            listOf(
                "{\"type\":\"session\",\"version\":3,\"id\":\"s1\",\"timestamp\":\"2025-10-30T00:00:00.000Z\",\"cwd\":\"D:\\\\workspace\\\\demo\"}",
                "{\"type\":\"message\",\"id\":\"e1\",\"parentId\":null,\"timestamp\":\"2025-10-30T00:00:01.000Z\",\"message\":{\"role\":\"user\",\"content\":\"hi\"}}",
                "{\"type\":\"message\",\"id\":\"e2\",\"parentId\":\"e1\",\"timestamp\":\"2025-10-30T00:00:02.000Z\",\"message\":{\"role\":\"assistant\",\"content\":\"hello\"}}",
            ).joinToString("\n", postfix = "\n"),
        )

        assertEquals("e2", SessionIndex.leafEntryId(file))
    }

    @Test
    fun `leafEntryId skips broken rename roots written with a null parent`() {
        val file = tempDir.resolve("damaged.jsonl")
        Files.writeString(
            file,
            listOf(
                "{\"type\":\"session\",\"version\":3,\"id\":\"s1\",\"timestamp\":\"2025-10-30T00:00:00.000Z\",\"cwd\":\"D:\\\\workspace\\\\demo\"}",
                "{\"type\":\"message\",\"id\":\"e1\",\"parentId\":null,\"timestamp\":\"2025-10-30T00:00:01.000Z\",\"message\":{\"role\":\"user\",\"content\":\"hi\"}}",
                "{\"type\":\"message\",\"id\":\"e2\",\"parentId\":\"e1\",\"timestamp\":\"2025-10-30T00:00:02.000Z\",\"message\":{\"role\":\"assistant\",\"content\":\"hello\"}}",
                // Records appended by the pre-fix rename implementation.
                "{\"type\":\"session_info\",\"id\":\"uuid-1\",\"parentId\":null,\"timestamp\":\"2025-10-30T00:00:03.000Z\",\"name\":\"broken\"}",
                "{\"type\":\"session_info\",\"id\":\"uuid-2\",\"parentId\":null,\"timestamp\":\"2025-10-30T00:00:04.000Z\",\"name\":\"broken again\"}",
            ).joinToString("\n", postfix = "\n"),
        )

        assertEquals("e2", SessionIndex.leafEntryId(file))
    }

    @Test
    fun `leafEntryId keeps the first root entry and follows later branches`() {
        val file = tempDir.resolve("reedit.jsonl")
        Files.writeString(
            file,
            listOf(
                "{\"type\":\"session\",\"version\":3,\"id\":\"s1\",\"timestamp\":\"2025-10-30T00:00:00.000Z\",\"cwd\":\"D:\\\\workspace\\\\demo\"}",
                "{\"type\":\"message\",\"id\":\"e1\",\"parentId\":null,\"timestamp\":\"2025-10-30T00:00:01.000Z\",\"message\":{\"role\":\"user\",\"content\":\"hi\"}}",
                "{\"type\":\"message\",\"id\":\"e2\",\"parentId\":\"e1\",\"timestamp\":\"2025-10-30T00:00:02.000Z\",\"message\":{\"role\":\"assistant\",\"content\":\"hello\"}}",
                // pi creates a new root when the user re-edits the first message.
                "{\"type\":\"message\",\"id\":\"e3\",\"parentId\":null,\"timestamp\":\"2025-10-30T00:00:03.000Z\",\"message\":{\"role\":\"user\",\"content\":\"hi again\"}}",
            ).joinToString("\n", postfix = "\n"),
        )

        assertEquals("e3", SessionIndex.leafEntryId(file))
    }

    private fun writeSession(file: Path, id: String, cwd: String, messages: List<String>) {
        val header =
            "{\"type\":\"session\",\"version\":3,\"id\":\"$id\",\"timestamp\":\"2025-10-30T00:00:00.000Z\",\"cwd\":\"${cwd.replace("\\", "\\\\")}\"}"
        Files.writeString(file, (listOf(header) + messages).joinToString("\n", postfix = "\n"))
    }

    private fun userLine(id: String, ts: Long, text: String): String =
        "{\"type\":\"message\",\"id\":\"$id\",\"parentId\":null,\"timestamp\":\"2025-10-30T00:00:01.000Z\",\"message\":{\"role\":\"user\",\"content\":\"$text\",\"timestamp\":$ts}}"

    private fun assistantLine(id: String, ts: Long, text: String): String =
        "{\"type\":\"message\",\"id\":\"$id\",\"parentId\":null,\"timestamp\":\"2025-10-30T00:00:02.000Z\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"$text\"}],\"timestamp\":$ts}}"

    private fun sessionInfoLine(id: String, ts: Long, name: String): String =
        "{\"type\":\"session_info\",\"id\":\"$id\",\"parentId\":null,\"timestamp\":\"2025-10-30T00:00:03.000Z\",\"name\":\"$name\"}"
}
