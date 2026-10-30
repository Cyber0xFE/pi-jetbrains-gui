package dev.pi.jetbrains.rpc

import java.io.BufferedWriter
import java.io.IOException
import java.io.OutputStreamWriter
import java.nio.charset.StandardCharsets
import java.nio.file.Path
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Owns one `pi --mode rpc` child process: spawn, stdin records, stdout/stderr pumps, exit handling
 * and shutdown (plan 7.2 / 7.3).
 */
class PiProcess(
    private val command: List<String>,
    private val workDir: Path,
    private val environment: Map<String, String> = emptyMap(),
    private val log: (String) -> Unit = {},
) {
    enum class State { NEW, RUNNING, STOPPING, EXITED }

    private val lock = Any()

    @Volatile
    var state: State = State.NEW
        private set

    @Volatile
    var exitCode: Int? = null
        private set

    private var process: Process? = null
    private var stdin: BufferedWriter? = null

    val pid: Long?
        get() = process?.pid()

    /**
     * Starts the process. Returns false when it could not be spawned; [onExit] is only invoked for
     * processes that actually started.
     */
    fun start(
        onStdoutLine: (String) -> Unit,
        onStderrLine: (String) -> Unit,
        onExit: (Int?) -> Unit,
    ): Boolean {
        synchronized(lock) {
            if (state == State.RUNNING || state == State.STOPPING) {
                log("refusing to start: state=$state")
                return false
            }
        }

        val builder = ProcessBuilder(command)
            .directory(workDir.toFile())
            .redirectErrorStream(false)
        builder.environment().putAll(environment)

        val started = try {
            builder.start()
        } catch (e: IOException) {
            log("failed to spawn ${command.joinToString(" ")}: ${e.message}")
            state = State.EXITED
            return false
        }

        synchronized(lock) {
            process = started
            exitCode = null
            state = State.RUNNING
            stdin = BufferedWriter(OutputStreamWriter(started.outputStream, StandardCharsets.UTF_8))
        }
        log("started pid=${started.pid()} cwd=$workDir")

        thread(name = "pi-stdout-${started.pid()}", isDaemon = true) {
            JsonlReader(
                input = started.inputStream,
                onLine = onStdoutLine,
                onError = { log("stdout reader stopped: ${it.message}") },
            ).run()
        }

        thread(name = "pi-stderr-${started.pid()}", isDaemon = true) {
            try {
                started.errorStream.bufferedReader(StandardCharsets.UTF_8).forEachLine(onStderrLine)
            } catch (e: IOException) {
                log("stderr reader stopped: ${e.message}")
            }
        }

        thread(name = "pi-wait-${started.pid()}", isDaemon = true) {
            val code = try {
                started.waitFor()
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                -1
            }
            closeStdin()
            synchronized(lock) {
                if (process === started) {
                    state = State.EXITED
                    exitCode = code
                }
            }
            log("exited code=$code")
            onExit(code)
        }
        return true
    }

    /** Writes one JSONL record and flushes it; returns false when the process is gone. */
    fun writeLine(line: String): Boolean {
        val writer = synchronized(lock) {
            if (state != State.RUNNING) null else stdin
        }
        if (writer == null) {
            log("cannot write: state=$state")
            return false
        }
        return try {
            synchronized(writer) {
                writer.write(line)
                writer.write("\n")
                writer.flush()
            }
            true
        } catch (e: IOException) {
            log("write failed: ${e.message}")
            false
        }
    }

    /** Closes stdin, then terminates the process tree within [timeoutMs]. */
    fun stop(timeoutMs: Long = 3000) {
        val running = synchronized(lock) {
            if (state == State.RUNNING) state = State.STOPPING
            process
        } ?: return

        closeStdin()
        if (!running.isAlive) return

        running.destroy()
        if (!running.waitFor(timeoutMs, TimeUnit.MILLISECONDS)) {
            log("pid=${running.pid()} ignored destroy for ${timeoutMs}ms, killing")
            running.destroyForcibly()
            running.waitFor(2, TimeUnit.SECONDS)
        }
    }

    private fun closeStdin() {
        val writer = synchronized(lock) {
            val current = stdin
            stdin = null
            current
        } ?: return
        try {
            writer.close()
        } catch (_: IOException) {
            // The process may already be gone; nothing to do.
        }
    }
}
