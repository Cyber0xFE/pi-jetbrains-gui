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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

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
            listOf(
                "node", "pi.mjs", "--session", copy.toString(), "--no-tools", "--no-context-files",
                "--system-prompt",
                "You are answering a side question in text-only mode. No tools are available or permitted. " +
                    "Answer directly using only the existing conversation context. Never emit tool calls, " +
                    "function calls, XML tool syntax, or DSML tool markup.",
                "--provider", "p", "--model", "m", "--mode", "json", "--print", "why?",
            ),
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
    fun `ask streams text deltas and returns the final answer`() {
        val cli = script(
            "stream.mjs",
            """
            // Mirror pi's readPipedStdin: block until stdin EOF, then emit a JSON event stream.
            await new Promise((resolve) => { process.stdin.resume(); process.stdin.on("end", resolve); });
            const events = [
            { type: "agent_start" },
            { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "hmm" } },
            { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "he" } },
            { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "llo" } },
            { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "hello world" }] } },
            "not json at all",
            ];
            for (const event of events) process.stdout.write(JSON.stringify(event) + "\n");
            """.trimIndent(),
        )
        val deltas = mutableListOf<String>()
        val stages = mutableListOf<String>()
        val thinking = mutableListOf<String>()
        val before = btwCopiesInTempDir()

        val result = runner(cli).ask(
            sessionFile(), provider = null, model = null, question = "why?",
            onDelta = { deltas.add(it) },
            onStage = { stages.add(it) },
            onThinking = { thinking.add(it) },
        )

        assertNull(result.error)
        assertEquals("hello world", result.answer)
        assertEquals(listOf("he", "llo"), deltas)
        assertEquals(listOf("hmm"), thinking)
        assertEquals(listOf("thinking", "streaming"), stages)
        assertEquals(before, btwCopiesInTempDir(), "session copy must be cleaned up")
    }

    @Test
    fun `ask falls back to accumulated deltas when no assistant message_end arrives`() {
        val cli = script(
            "deltas-only.mjs",
            """
            await new Promise((resolve) => { process.stdin.resume(); process.stdin.on("end", resolve); });
            process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "partial" } }) + "\n");
            """.trimIndent(),
        )

        val result = runner(cli).ask(sessionFile(), provider = null, model = null, question = "why?", onDelta = {})

        assertNull(result.error)
        assertEquals("partial", result.answer)
    }

    @Test
    fun `ask reports an errored assistant stop reason`() {
        val cli = script(
            "error-end.mjs",
            """
            await new Promise((resolve) => { process.stdin.resume(); process.stdin.on("end", resolve); });
            process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "quota exceeded" } }) + "\n");
            """.trimIndent(),
        )

        val result = runner(cli).ask(sessionFile(), provider = null, model = null, question = "why?", onDelta = {})

        assertNull(result.answer)
        assertNotNull(result.error)
        assertTrue(result.error!!.contains("quota exceeded"), "unexpected error: ${result.error}")
    }

    @Test
    fun `ask treats non-JSON stdout as no answer`() {
        val cli = script(
            "echo.mjs",
            """
            // Mirror pi's readPipedStdin: block until stdin EOF, then answer.
            await new Promise((resolve) => { process.stdin.resume(); process.stdin.on("end", resolve); });
            process.stdout.write("plain text answer" + "\n");
            """.trimIndent(),
        )
        val before = btwCopiesInTempDir()

        val result = runner(cli).ask(sessionFile(), provider = null, model = null, question = "why?")

        assertNull(result.answer)
        assertNotNull(result.error)
        assertTrue(result.error!!.contains("no answer"), "unexpected error: ${result.error}")
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

    @Test
    fun `cancel stops the process and keeps the streamed partial answer`() {
        val cli = script(
            "slow.mjs",
            """
            await new Promise((resolve) => { process.stdin.resume(); process.stdin.on("end", resolve); });
            process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "partial" } }) + "\n");
            // Keep the child alive until the runner kills it.
            setInterval(() => {}, 1000);
            """.trimIndent(),
        )
        val runner = runner(cli)
        val partial = CountDownLatch(1)
        val done = CountDownLatch(1)
        val result = AtomicReference<SideQuestionRunner.Result?>(null)
        thread(name = "btw-cancel-test") {
            result.set(
                runner.ask(
                    sessionFile(), provider = null, model = null, question = "why?",
                    onDelta = { if (it == "partial") partial.countDown() },
                ),
            )
            done.countDown()
        }

        assertTrue(partial.await(10, TimeUnit.SECONDS), "the child never streamed a delta")
        runner.cancel()
        assertTrue(done.await(10, TimeUnit.SECONDS), "cancel did not end the side question")

        val outcome = result.get()
        assertNotNull(outcome)
        assertTrue(outcome!!.stopped)
        assertNull(outcome.error)
        assertEquals("partial", outcome.answer)
    }

    private fun btwCopiesInTempDir(): List<String> =
        Files.list(Path.of(System.getProperty("java.io.tmpdir"))).use { stream ->
            stream
                .map { it.fileName.toString() }
                .filter { it.startsWith("pi-btw-") && it.endsWith(".jsonl") }
                .toList()
        }
}
