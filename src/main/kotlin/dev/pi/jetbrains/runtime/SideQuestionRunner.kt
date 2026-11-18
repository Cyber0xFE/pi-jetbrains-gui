package dev.pi.jetbrains.runtime

import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.time.Duration
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
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
 * The copy is opened with a text-only system prompt and `--no-tools`: print mode answers once
 * and exits, no tool is exposed or permitted, and every append goes to the copy — so the main
 * session history is never touched. The copy is always deleted afterwards.
 *
 * Output is the JSON event stream: `message_update` deltas are forwarded to [onDelta] as they
 * arrive so the webview can render the answer live, and the final `message_end` assistant message
 * provides the authoritative full answer. [cancel] stops the running child process and turns the
 * outcome into [Result.stopped] with whatever text was already streamed.
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
        /** True when the user stopped the question from the overlay. */
        val stopped: Boolean = false,
    )

    private val json = Json { ignoreUnknownKeys = true }

    /** Set by [cancel]; a stopped question is not reported as an error. */
    private val cancelled = AtomicBoolean(false)

    /** The child process of the question currently being asked, if any. */
    @Volatile
    private var process: Process? = null

    /** Stops the running print-mode process; the pending [ask] returns `stopped`. */
    fun cancel() {
        cancelled.set(true)
        process?.let { runCatching { it.destroyForcibly() } }
    }

    /** `pi --session <copy> --no-tools --no-context-files --system-prompt <text> [--provider p --model m] --mode json --print <question>` */
    fun buildCommand(sessionCopy: Path, provider: String?, model: String?, question: String): List<String> =
        buildList {
            add(nodeExecutable.toString())
            add(cliEntry.toString())
            add("--session")
            add(sessionCopy.toString())
            add("--no-tools")
            add("--no-context-files")
            add("--system-prompt")
            add(SIDE_QUESTION_SYSTEM_PROMPT)
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
     * thread themselves). [onStage] reports `thinking` once the run starts and `streaming` when
     * answer text begins, so the overlay can show the intermediate state. A non-zero exit, a
     * timeout, an aborted/errored stop reason or an empty answer is reported through
     * [Result.error].
     */
    fun ask(
        sessionFile: Path,
        provider: String?,
        model: String?,
        question: String,
        timeout: Duration = DEFAULT_TIMEOUT,
        onDelta: (String) -> Unit = {},
        onStage: (String) -> Unit = {},
        onThinking: (String) -> Unit = {},
    ): Result {
        val copy = Files.createTempFile("pi-btw-", ".jsonl")
        try {
            Files.copy(sessionFile, copy, StandardCopyOption.REPLACE_EXISTING)
            return runProcess(copy, provider, model, question, timeout, onDelta, onStage, onThinking)
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
        onStage: (String) -> Unit,
        onThinking: (String) -> Unit,
    ): Result {
        val command = buildCommand(sessionCopy, provider, model, question)
        if (cancelled.get()) return stoppedResult(StringBuilder())
        log("btw: spawning pi print mode (session copy ${sessionCopy.fileName})")
        val child = try {
            ProcessBuilder(command)
                .directory(workDir.toFile())
                .redirectErrorStream(false)
                .apply { environment().putAll(environment) }
                .start()
        } catch (e: IOException) {
            return Result(answer = null, error = "failed to spawn pi for /btw: ${e.message}")
        }
        process = child
        // A cancel between start() and the assignment above would otherwise arrive before the
        // handle is visible, so re-check it once the child is published.
        if (cancelled.get()) child.destroyForcibly()

        val stderr = StringBuilder()
        // Streaming answer text; guarded because onDelta and the exit handling read it from
        // different threads.
        val accumulated = StringBuilder()
        // Reasoning text streamed by the model, kept so the overlay can show it on demand.
        val thinking = StringBuilder()
        // Set when the assistant turn itself failed (stopReason error/aborted).
        val stopError = AtomicReference<String?>(null)
        // Report each stage once: the JSON stream repeats thinking updates while reasoning.
        val lastStage = AtomicReference<String?>(null)
        fun reportStage(stage: String) {
            if (lastStage.getAndSet(stage) != stage) onStage(stage)
        }
        thread(name = "pi-btw-stdout", isDaemon = true) {
            child.inputStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                lines.forEach { line ->
                    // Plain-text lines (extension warnings etc.) are ignored; only JSON events
                    // carry deltas and the final answer.
                    handleEventLine(line, onDelta, onThinking, ::reportStage, accumulated, thinking, stopError)
                }
            }
        }
        thread(name = "pi-btw-stderr", isDaemon = true) {
            child.errorStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                lines.forEach { stderr.appendLine(it) }
            }
        }

        // pi's CLI reads piped stdin until EOF before starting (readPipedStdin); a ProcessBuilder
        // pipe never closes on its own and would hang the child forever, so close our write end.
        child.outputStream.close()

        try {
            val finished = child.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)
            if (cancelled.get()) {
                if (!finished) {
                    child.destroyForcibly()
                    child.waitFor(5, TimeUnit.SECONDS)
                }
                return stoppedResult(accumulated)
            }
            if (!finished) {
                child.destroyForcibly()
                child.waitFor(5, TimeUnit.SECONDS)
                return Result(answer = null, error = "/btw timed out after ${timeout.seconds}s")
            }

            stopError.get()?.let { return Result(answer = null, error = it) }

            val answer = synchronized(accumulated) { accumulated.toString().trim() }
            if (child.exitValue() != 0 || answer.isEmpty()) {
                val detail = stderr.toString().trim().lineSequence().lastOrNull { it.isNotBlank() }
                return Result(
                    answer = null,
                    error = detail?.takeLast(300) ?: "pi exited with code ${child.exitValue()} and no answer",
                )
            }
            return Result(answer = answer, error = null)
        } finally {
            if (process === child) process = null
        }
    }

    private fun stoppedResult(accumulated: StringBuilder): Result =
        Result(
            answer = synchronized(accumulated) { accumulated.toString().trim() }.takeIf { it.isNotEmpty() },
            error = null,
            stopped = true,
        )

    /** Processes one stdout JSONL line: stage transitions, `text_delta`s and the final answer. */
    private fun handleEventLine(
        line: String,
        onDelta: (String) -> Unit,
        onThinking: (String) -> Unit,
        onStage: (String) -> Unit,
        accumulated: StringBuilder,
        thinking: StringBuilder,
        stopError: AtomicReference<String?>,
    ) {
        val event = runCatching { json.parseToJsonElement(line) }.getOrNull() as? JsonObject ?: return
        when (event["type"]?.jsonPrimitive?.contentOrNull) {
            // The agent loop started: the model request is under way (or reasoning has begun).
            "agent_start" -> onStage("thinking")
            "message_update" -> {
                val deltaEvent = event["assistantMessageEvent"] as? JsonObject ?: return
                when (deltaEvent["type"]?.jsonPrimitive?.contentOrNull) {
                    "thinking_start" -> onStage("thinking")
                    "thinking_delta" -> {
                        val delta = deltaEvent["delta"]?.jsonPrimitive?.contentOrNull ?: return
                        if (delta.isEmpty()) return
                        synchronized(thinking) { thinking.append(delta) }
                        onThinking(delta)
                        onStage("thinking")
                    }
                    "text_delta" -> {
                        val delta = deltaEvent["delta"]?.jsonPrimitive?.contentOrNull ?: return
                        if (delta.isEmpty()) return
                        synchronized(accumulated) { accumulated.append(delta) }
                        onDelta(delta)
                        onStage("streaming")
                    }
                }
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
        /** The side question must not inherit agent instructions that encourage tool use. */
        private const val SIDE_QUESTION_SYSTEM_PROMPT =
            "You are answering a side question in text-only mode. No tools are available or permitted. " +
                "Answer directly using only the existing conversation context. Never emit tool calls, " +
                "function calls, XML tool syntax, or DSML tool markup."

        /** Side questions can involve reasoning models over a large transcript. */
        val DEFAULT_TIMEOUT: Duration = Duration.ofSeconds(180)
    }
}
