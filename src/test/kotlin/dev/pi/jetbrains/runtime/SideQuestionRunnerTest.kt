package dev.pi.jetbrains.runtime

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration

/**
 * Unit tests for the `/btw` print-mode runner. Uses the local node installation plus a scripted
 * stand-in CLI, so no LLM or pi installation is required; skipped when node is unavailable.
 */
class SideQuestionRunnerTest {
    @TempDir
    lateinit var tempDir: Path

    private fun nodeExecutable(): Path {
        val resolved = NodeRuntimeResolver().resolve()
        assumeTrue(resolved is NodeResolution.Found, "no usable node: $resolved")
        return (resolved as NodeResolution.Found).executable
    }

    /** Stand-in CLI: echoes the `--print` payload, or exits 1 with a stderr diagnostic. */
    private fun script(name: String, body: String): Path {
        val path = tempDir.resolve(name)
        Files.writeString(path, body)
        return path
    }

    private fun runner(cliEntry: Path): SideQuestionRunner = SideQuestionRunner(
        nodeExecutable = nodeExecutable(),
        cliEntry = cliEntry,
        workDir = tempDir,
        log = {},
    )

    private fun sessionFile(): Path {
        val file = tempDir.resolve("session.jsonl")
        Files.writeString(file, "{\"type\":\"session\"}\n")
        return file
    }

    @Test
    fun `buildCommand keeps the copy isolated and tool-free`() {
        val runner = SideQuestionRunner(
            nodeExecutable = Path.of("node"),
            cliEntry = Path.of("pi.mjs"),
            workDir = tempDir,
        )
        val copy = tempDir.resolve("copy.jsonl")

        val command = runner.buildCommand(copy, provider = "p", model = "m", question = "why?")

        assertEquals(
            listOf("node", "pi.mjs", "--session", copy.toString(), "--no-tools", "--provider", "p", "--model", "m", "--print", "why?"),
            command,
        )
    }

    @Test
    fun `buildCommand omits model flags when the session has no model`() {
        val runner = SideQuestionRunner(
            nodeExecutable = Path.of("node"),
            cliEntry = Path.of("pi.mjs"),
            workDir = tempDir,
        )
        val command = runner.buildCommand(tempDir.resolve("copy.jsonl"), provider = null, model = null, question = "q")

        assertFalse(command.contains("--provider"))
        assertFalse(command.contains("--model"))
    }

    @Test
    fun `ask returns the stdout answer and deletes the session copy`() {
        val cli = script(
            "echo.mjs",
            """
            // Mirror pi's readPipedStdin: block until stdin EOF, then answer.
            const stdinText = await new Promise((resolve) => {
            	let data = "";
            	process.stdin.on("data", (chunk) => (data += chunk));
            	process.stdin.on("end", () => resolve(data));
            });
            const index = process.argv.indexOf("--print");
            process.stdout.write(`answer: ${'$'}{process.argv[index + 1]}` + "\n");
            """.trimIndent(),
        )
        val before = btwCopiesInTempDir()

        val result = runner(cli).ask(sessionFile(), provider = null, model = null, question = "why?")

        assertNull(result.error)
        assertEquals("answer: why?", result.answer)
        assertEquals(before, btwCopiesInTempDir(), "session copy must be cleaned up")
    }

    @Test
    fun `ask reports a non-zero exit with the stderr detail`() {
        val cli = script("fail.mjs", "process.stderr.write('model exploded\\n'); process.exit(1);\n")
        val before = btwCopiesInTempDir()

        val result = runner(cli).ask(sessionFile(), provider = null, model = null, question = "why?")

        assertNull(result.answer)
        assertNotNull(result.error)
        assertTrue(result.error!!.contains("model exploded"), "unexpected error: ${result.error}")
        assertEquals(before, btwCopiesInTempDir(), "session copy must be cleaned up")
    }

    @Test
    fun `ask reports an empty answer as an error`() {
        val cli = script("silent.mjs", "")

        val result = runner(cli).ask(sessionFile(), provider = null, model = null, question = "why?", timeout = Duration.ofSeconds(10))

        assertNull(result.answer)
        assertNotNull(result.error)
        assertTrue(result.error!!.contains("no answer"), "unexpected error: ${result.error}")
    }

    private fun btwCopiesInTempDir(): List<String> =
        Files.list(Path.of(System.getProperty("java.io.tmpdir"))).use { stream ->
            stream
                .map { it.fileName.toString() }
                .filter { it.startsWith("pi-btw-") && it.endsWith(".jsonl") }
                .toList()
        }
}
