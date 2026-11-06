package dev.pi.jetbrains.runtime

import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.time.Duration
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Runs one `/btw` side question against a throwaway copy of the active session file (mirrors
 * Claude Code's `/btw`).
 *
 * The copy is opened with `pi --session <copy> --no-tools --mode json --print <question>`: print
 * mode answers once and exits, `--no-tools` keeps the answer tool-free, and every append goes to
 * the copy — so the main session history is never touched. The copy is always deleted afterwards.
 *
 * Output is the JSON event stream: `message_update` deltas are forwarded to [onDelta] as they
 * arrive so the webview can render the answer live, and the final `message_end` assistant message
 * provides the authoritative full answer.
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

    private val json = Json { ignoreUnknownKeys = true }

    /** `pi --session <copy> --no-tools [--provider p --model m] --mode json --print <question>` */
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
            add("--mode")
            add("json")
            add("--print")
            add(question)
        }

    /**
     * Copies [sessionFile], asks [question] and always cleans the copy up. Answer deltas are
     * pushed to [onDelta] (from the stdout reader thread; callers must route them to the UI
     * thread themselves). A non-zero exit, a timeout, an aborted/errored stop reason or an empty
     * answer is reported through [Result.error].
     */
    fun ask(
        sessionFile: Path,
        provider: String?,
        model: String?,
        question: String,
        timeout: Duration = DEFAULT_TIMEOUT,
        onDelta: (String) -> Unit = {},
    ): Result {
        val copy = Files.createTempFile("pi-btw-", ".jsonl")
        try {
            Files.copy(sessionFile, copy, StandardCopyOption.REPLACE_EXISTING)
            return runProcess(copy, provider, model, question, timeout, onDelta)
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
        onDelta: (String) -> Unit,
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

        val stderr = StringBuilder()
        // Streaming answer text; guarded because onDelta and the exit handling read it from
        // different threads.
        val accumulated = StringBuilder()
        // Set when the assistant turn itself failed (stopReason error/aborted).
        val stopError = java.util.concurrent.atomic.AtomicReference<String?>(null)
        thread(name = "pi-btw-stdout", isDaemon = true) {
            process.inputStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                lines.forEach { line ->
                    // Plain-text lines (extension warnings etc.) are ignored; only JSON events
                    // carry deltas and the final answer.
                    handleEventLine(line, onDelta, accumulated, stopError)
                }
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

        stopError.get()?.let { return Result(answer = null, error = it) }

        val answer = synchronized(accumulated) { accumulated.toString().trim() }
        if (process.exitValue() != 0 || answer.isEmpty()) {
            val detail = stderr.toString().trim().lineSequence().lastOrNull { it.isNotBlank() }
            return Result(
                answer = null,
                error = detail?.takeLast(300) ?: "pi exited with code ${process.exitValue()} and no answer",
            )
        }
        return Result(answer = answer, error = null)
    }

    /** Processes one stdout JSONL line: forwards `text_delta`s and captures the final answer. */
    private fun handleEventLine(
        line: String,
        onDelta: (String) -> Unit,
        accumulated: StringBuilder,
        stopError: java.util.concurrent.atomic.AtomicReference<String?>,
    ) {
        val event = runCatching { json.parseToJsonElement(line) }.getOrNull() as? JsonObject ?: return
        when (event["type"]?.jsonPrimitive?.contentOrNull) {
            "message_update" -> {
                val deltaEvent = event["assistantMessageEvent"] as? JsonObject ?: return
                if (deltaEvent["type"]?.jsonPrimitive?.contentOrNull != "text_delta") return
                val delta = deltaEvent["delta"]?.jsonPrimitive?.contentOrNull ?: return
                if (delta.isEmpty()) return
                synchronized(accumulated) { accumulated.append(delta) }
                onDelta(delta)
            }
            "message_end" -> {
                val message = event["message"] as? JsonObject ?: return
                if (message["role"]?.jsonPrimitive?.contentOrNull != "assistant") return
                val stopReason = message["stopReason"]?.jsonPrimitive?.contentOrNull
                if (stopReason == "error" || stopReason == "aborted") {
                    stopError.set(message["errorMessage"]?.jsonPrimitive?.contentOrNull ?: "request $stopReason")
                    return
                }
                val content = message["content"] as? JsonArray ?: return
                val text = content.mapNotNull { block ->
                    val obj = block as? JsonObject ?: return@mapNotNull null
                    if (obj["type"]?.jsonPrimitive?.contentOrNull == "text") {
                        obj["text"]?.jsonPrimitive?.contentOrNull
                    } else {
                        null
                    }
                }.joinToString("\n").trim()
                if (text.isNotEmpty()) {
                    synchronized(accumulated) {
                        accumulated.clear()
                        accumulated.append(text)
                    }
                }
            }
        }
    }

    companion object {
        /** Side questions can involve reasoning models over a large transcript. */
        val DEFAULT_TIMEOUT: Duration = Duration.ofSeconds(180)
    }
}
