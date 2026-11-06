package dev.pi.jetbrains.runtime

import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.time.Duration
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Runs one `/btw` side question against a throwaway copy of the active session file (mirrors
 * Claude Code's `/btw`).
 *
 * The copy is opened with `pi --session <copy> --no-tools --print <question>`: print mode answers
 * once and exits, `--no-tools` keeps the answer tool-free, and every append goes to the copy — so
 * the main session history is never touched. The copy is always deleted afterwards.
 */
class SideQuestionRunner(
    private val nodeExecutable: Path,
    private val cliEntry: Path,
    private val workDir: Path,
    private val environment: Map<String, String> = emptyMap(),
    private val log: (String) -> Unit = {},
) {
    data class Result(
        val answer: String?,
        val error: String?,
    )

    /** `pi --session <copy> --no-tools [-p provider] [-m model] --print <question>` */
    fun buildCommand(sessionCopy: Path, provider: String?, model: String?, question: String): List<String> =
        buildList {
            add(nodeExecutable.toString())
            add(cliEntry.toString())
            add("--session")
            add(sessionCopy.toString())
            add("--no-tools")
            if (!provider.isNullOrBlank() && !model.isNullOrBlank()) {
                add("--provider")
                add(provider)
                add("--model")
                add(model)
            }
            add("--print")
            add(question)
        }

    /**
     * Copies [sessionFile], asks [question] and always cleans the copy up. A non-zero exit, a
     * timeout or an empty answer is reported through [Result.error].
     */
    fun ask(
        sessionFile: Path,
        provider: String?,
        model: String?,
        question: String,
        timeout: Duration = DEFAULT_TIMEOUT,
    ): Result {
        val copy = Files.createTempFile("pi-btw-", ".jsonl")
        try {
            Files.copy(sessionFile, copy, StandardCopyOption.REPLACE_EXISTING)
            return runProcess(copy, provider, model, question, timeout)
        } finally {
            runCatching { Files.deleteIfExists(copy) }
                .onFailure { log("failed to delete btw session copy ${copy.fileName}: ${it.message}") }
        }
    }

    private fun runProcess(
        sessionCopy: Path,
        provider: String?,
        model: String?,
        question: String,
        timeout: Duration,
    ): Result {
        val command = buildCommand(sessionCopy, provider, model, question)
        log("btw: spawning pi print mode (session copy ${sessionCopy.fileName})")
        val process = try {
            ProcessBuilder(command)
                .directory(workDir.toFile())
                .redirectErrorStream(false)
                .apply { environment().putAll(environment) }
                .start()
        } catch (e: IOException) {
            return Result(answer = null, error = "failed to spawn pi for /btw: ${e.message}")
        }

        val stdout = StringBuilder()
        val stderr = StringBuilder()
        // Plain-text output, not the JSONL protocol: just accumulate the lines in order.
        thread(name = "pi-btw-stdout", isDaemon = true) {
            process.inputStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                lines.forEach { stdout.appendLine(it) }
            }
        }
        thread(name = "pi-btw-stderr", isDaemon = true) {
            process.errorStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                lines.forEach { stderr.appendLine(it) }
            }
        }

        // pi's CLI reads piped stdin until EOF before starting (readPipedStdin); a ProcessBuilder
        // pipe never closes on its own and would hang the child forever, so close our write end.
        process.outputStream.close()

        val finished = process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)
        if (!finished) {
            process.destroyForcibly()
            process.waitFor(5, TimeUnit.SECONDS)
            return Result(answer = null, error = "/btw timed out after ${timeout.seconds}s")
        }

        val answer = stdout.toString().trim()
        if (process.exitValue() != 0 || answer.isEmpty()) {
            val detail = stderr.toString().trim().lineSequence().lastOrNull { it.isNotBlank() }
            return Result(
                answer = null,
                error = detail?.takeLast(300) ?: "pi exited with code ${process.exitValue()} and no answer",
            )
        }
        return Result(answer = answer, error = null)
    }

    companion object {
        /** Side questions can involve reasoning models over a large transcript. */
        val DEFAULT_TIMEOUT: Duration = Duration.ofSeconds(180)
    }
}
