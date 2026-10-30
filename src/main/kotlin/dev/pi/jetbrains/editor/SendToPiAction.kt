package dev.pi.jetbrains.editor

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.util.TextRange
import dev.pi.jetbrains.PiChatService

/** Adds the selected editor range (or the current file) to the next pi prompt. */
class SendToPiAction : AnAction("Send to pi", "Send the selected file range to pi", null) {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        val editor = event.getData(CommonDataKeys.EDITOR) ?: return
        val file = event.getData(CommonDataKeys.VIRTUAL_FILE) ?: return
        val document = editor.document
        val selection = editor.selectionModel
        val hasSelection = selection.hasSelection()
        val startLine = document.getLineNumber(selection.selectionStart)
        val endLine = document.getLineNumber(selection.selectionEnd.coerceAtMost(document.textLength))
        val first = (startLine + 1).coerceAtLeast(1)
        val last = (endLine + 1).coerceAtLeast(first)
        val path = project.basePath?.let { base ->
            val baseFile = java.nio.file.Paths.get(base).toAbsolutePath().normalize()
            val absolute = java.nio.file.Paths.get(file.path).toAbsolutePath().normalize()
            runCatching { baseFile.relativize(absolute).toString().replace('\\', '/') }.getOrNull()
        } ?: file.path
        val unsaved = FileDocumentManager.getInstance().isDocumentUnsaved(document)
        val context = buildString {
            append("--- ").append(path)
            if (hasSelection) {
                append(":").append(first)
                if (last != first) append("-").append(last)
            }
            append(if (unsaved) " (buffer) ---\n" else " ---\n")
            if (unsaved) {
                val range = if (hasSelection) TextRange(selection.selectionStart, selection.selectionEnd) else TextRange(0, document.textLength)
                append(document.getText(range))
            }
        }
        project.service<PiChatService>().queueContext(context)
        ApplicationManager.getApplication().invokeLater {
            project.service<PiChatService>().showToolWindow()
        }
    }

    override fun update(event: AnActionEvent) {
        val enabled = event.project != null && event.getData(CommonDataKeys.EDITOR) != null &&
            event.getData(CommonDataKeys.VIRTUAL_FILE) != null
        event.presentation.isEnabledAndVisible = enabled
    }
}
