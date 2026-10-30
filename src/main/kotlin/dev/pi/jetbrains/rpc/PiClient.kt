package dev.pi.jetbrains.rpc

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.IOException
import java.time.Duration
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicLong

/** Raised for requests still pending when the child process exits. */
class PiProcessExitedException(val exitCode: Int?) :
    IOException("pi process exited (code=${exitCode ?: "unknown"})")

/** Raised when a command is not answered within its deadline. */
class PiRequestTimeoutException(
    val requestId: String,
    val commandType: String,
    val timeout: Duration,
) : TimeoutException("pi did not answer '$commandType' ($requestId) within ${timeout.toMillis()}ms")

/**
 * Command / response correlation and event fan-out over one [PiProcess] (plan 5.3).
 *
 * Both responses and session events are published on [events]; responses additionally resolve the
 * matching [send] deferred. Stream consumers should ignore [PiEvent.Response].
 */
class PiClient(
    private val process: PiProcess,
    private val log: (String) -> Unit = {},
    private val requestTimeout: Duration = DEFAULT_TIMEOUT,
    private val onExit: (Int?) -> Unit = {},
) {
    private class Pending(val command: RpcCommand, val deferred: CompletableDeferred<RpcResponse>)

    private val _events = MutableSharedFlow<PiEvent>(
        extraBufferCapacity = 1024,
        onBufferOverflow = kotlinx.coroutines.channels.BufferOverflow.DROP_OLDEST,
    )
    val events: SharedFlow<PiEvent> = _events.asSharedFlow()

    private val _running = MutableStateFlow(false)
    val running: StateFlow<Boolean> = _running.asStateFlow()

    private val pending = ConcurrentHashMap<String, Pending>()
    private val sequence = AtomicLong()
    private val timeouts = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "pi-request-timeouts").apply { isDaemon = true }
    }

    val exitCode: Int?
        get() = process.exitCode

    fun start(): Boolean {
        val started = process.start(
            onStdoutLine = ::handleLine,
            onStderrLine = { log("[stderr] $it") },
            onExit = ::handleExit,
        )
        _running.value = started
        return started
    }

    /** Sends a command and resolves with its response. The id is generated when absent. */
    fun send(command: RpcCommand, timeout: Duration = requestTimeout): CompletableDeferred<RpcResponse> {
        val id = command.id ?: "req-${sequence.incrementAndGet()}"
        val request = command.copy(id = id)
        val deferred = CompletableDeferred<RpcResponse>()
        pending[id] = Pending(request, deferred)

        val payload = PiJson.encodeToString(RpcCommand.serializer(), request)
        if (!process.writeLine(payload)) {
            pending.remove(id)
            deferred.completeExceptionally(IOException("pi process is not running"))
            return deferred
        }

        val scheduled = timeouts.schedule(
            { completeTimeout(id) },
            timeout.toMillis(),
            TimeUnit.MILLISECONDS,
        )
        deferred.invokeOnCompletion { scheduled.cancel(false) }
        return deferred
    }

    /** Stops the child process; pending requests fail with [PiProcessExitedException]. */
    fun stop() {
        process.stop()
        _running.value = false
    }

    /** Stops the process and releases the timeout scheduler. The client is unusable afterwards. */
    fun close() {
        stop()
        timeouts.shutdownNow()
    }

    private fun completeTimeout(id: String) {
        val request = pending.remove(id) ?: return
        log("request $id (${request.command.type}) timed out")
        request.deferred.completeExceptionally(
            PiRequestTimeoutException(id, request.command.type, requestTimeout),
        )
    }

    private fun handleLine(line: String) {
        val event = try {
            PiEvent.parse(line)
        } catch (t: Throwable) {
            log("dropping unparseable record: ${t.message} :: ${line.take(200)}")
            return
        }

        if (event is PiEvent.Response) {
            val id = event.response.id
            when {
                id == null -> log("response without id: command=${event.response.command}")
                else -> {
                    val request = pending.remove(id)
                    if (request == null) {
                        log("response for unknown id $id (command=${event.response.command})")
                    } else {
                        request.deferred.complete(event.response)
                    }
                }
            }
        }

        if (!_events.tryEmit(event)) {
            log("event buffer overflow, dropped ${event.javaClass.simpleName}")
        }
    }

    private fun handleExit(code: Int?) {
        _running.value = false
        val failure = PiProcessExitedException(code)
        val outstanding = pending.keys.toList()
        if (outstanding.isNotEmpty()) {
            log("failing ${outstanding.size} pending request(s) after exit")
        }
        for (id in outstanding) {
            pending.remove(id)?.deferred?.completeExceptionally(failure)
        }
        onExit(code)
    }

    companion object {
        val DEFAULT_TIMEOUT: Duration = Duration.ofSeconds(30)
    }
}
