package dev.pi.jetbrains.editor

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import dev.pi.jetbrains.rpc.PiEvent
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.nio.file.Path
import java.nio.file.Paths
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Keeps the IDE in sync with files the agent writes on disk.
 *
 * pi runs as a child process, so `edit`/`write` bypass IntelliJ's document layer entirely. Without a
 * VFS refresh the open editor keeps showing stale content until the platform's file watcher catches
 * up. `edit`/`write` refresh their `path` immediately; `bash` can touch anything, so it schedules a
 * throttled project-wide refresh.
 */
class ToolFileRefresher(private val project: Project) : Disposable {
    private val argsBuffer = ToolArgsBuffer()
    private val refreshQueued = AtomicBoolean(false)
    private val scheduler: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "pi-vfs-refresh").apply { isDaemon = true }
    }

    fun onEvent(event: PiEvent) {
        if (event !is PiEvent.Session) return
        when (event.type) {
            "tool_execution_start" -> argsBuffer.onStart(
                event.payload.string("toolCallId"),
                event.payload["args"] as? JsonObject,
            )
            "tool_execution_end" -> apply(
                toolName = event.payload.string("toolName"),
                args = argsBuffer.take(event.payload.string("toolCallId")),
            )
        }
    }

    private fun apply(toolName: String?, args: JsonObject?) {
        val written = writtenPath(toolName, args)
        if (written != null) {
            val path = resolve(project.basePath?.let { runCatching { Paths.get(it) }.getOrNull() }, written) ?: return
            refreshPath(path)
            return
        }
        if (touchesProjectWide(toolName)) scheduleProjectRefresh()
    }

    private fun refreshPath(path: Path) {
        ApplicationManager.getApplication().executeOnPooledThread {
            val fileSystem = LocalFileSystem.getInstance()
            // Refresh the parent as well so newly created files show up in the project tree.
            path.parent?.let { fileSystem.refreshAndFindFileByIoFile(it.toFile()) }
            fileSystem.refreshAndFindFileByIoFile(path.toFile())
            Unit
        }
    }

    private fun scheduleProjectRefresh() {
        val base = project.basePath ?: return
        if (!refreshQueued.compareAndSet(false, true)) return
        scheduler.schedule(
            Runnable {
                refreshQueued.set(false)
                LocalFileSystem.getInstance().refreshNioFiles(listOf(Paths.get(base)), true, true, null)
            },
            PROJECT_REFRESH_DELAY_MS,
            TimeUnit.MILLISECONDS,
        )
    }

    override fun dispose() {
        scheduler.shutdownNow()
        argsBuffer.clear()
    }

    companion object {
        private const val PROJECT_REFRESH_DELAY_MS = 1200L

        /** Tools whose `path` argument names a file that was just written. */
        internal fun writtenPath(toolName: String?, args: JsonObject?): String? {
            if (toolName != "edit" && toolName != "write") return null
            return (args?.get("path") as? JsonPrimitive)?.contentOrNull
        }

        /** `bash` runs arbitrary commands, so the only safe assumption is "anything under the root". */
        internal fun touchesProjectWide(toolName: String?): Boolean = toolName == "bash"

        internal fun resolve(base: Path?, raw: String): Path? {
            val path = runCatching { Paths.get(raw) }.getOrNull() ?: return null
            return if (path.isAbsolute) path.normalize() else base?.resolve(path)?.normalize() ?: path.normalize()
        }
    }
}

/** `tool_execution_end` does not repeat `args`; remember them from the matching start event. */
internal class ToolArgsBuffer {
    private val argsByCall = ConcurrentHashMap<String, JsonObject>()

    fun onStart(callId: String?, args: JsonObject?) {
        if (callId == null || args == null) return
        argsByCall[callId] = args
    }

    fun take(callId: String?): JsonObject? = callId?.let { argsByCall.remove(it) }

    fun clear() = argsByCall.clear()
}

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
