package dev.pi.jetbrains.editor

import com.intellij.ide.BrowserUtil
import com.intellij.ide.projectView.ProjectView
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.editor.ScrollType
import com.intellij.openapi.fileEditor.FileEditorManager
import java.nio.file.Paths

/**
 * Opens files and lines referenced by the webview (plan M2.3).
 *
 * Paths come from tool output and are either absolute or relative to the project root, so they are
 * resolved exactly like tool arguments. Everything here runs on the EDT because navigation
 * touches the editor UI.
 */
object EditorNavigator {
    /** Opens [rawPath] at [line] (1-based), selecting through [endLine] when present. */
    fun open(project: Project, rawPath: String, line: Int?, endLine: Int? = null, onError: (String) -> Unit) {
        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed) return@invokeLater
            val path = ToolFileRefresher.resolve(projectBasePath(project), rawPath)
            if (path == null) {
                onError("cannot resolve path: $rawPath")
                return@invokeLater
            }
            val file = findFile(path.toString())
            if (file == null) {
                onError("file not found: $path")
                return@invokeLater
            }
            if (file.isDirectory) {
                // Directories have no editor; reveal them in the project view instead.
                ProjectView.getInstance(project).select(null, file, true)
                return@invokeLater
            }
            val startLine = line?.takeIf { it > 0 }
            val descriptor = if (startLine != null) {
                OpenFileDescriptor(project, file, startLine - 1, 0)
            } else {
                OpenFileDescriptor(project, file)
            }
            if (startLine == null || endLine == null || endLine < startLine) {
                descriptor.navigate(true)
                return@invokeLater
            }
            // openEditor(OpenFileDescriptor, boolean) is deprecated since 2024.3; openTextEditor is the
            // supported replacement and returns the text editor directly (null for non-text files).
            val editor = FileEditorManager.getInstance(project)
                .openTextEditor(descriptor, true) ?: return@invokeLater
            val document = editor.document
            val lastLine = (endLine - 1).coerceAtMost(document.lineCount - 1)
            val startOffset = document.getLineStartOffset((startLine - 1).coerceAtMost(document.lineCount - 1))
            val endOffset = document.getLineEndOffset(lastLine)
            editor.selectionModel.setSelection(startOffset, endOffset)
            editor.caretModel.moveToOffset(startOffset)
            editor.scrollingModel.scrollToCaret(ScrollType.CENTER)
        }
    }

    /** Opens an external http(s) link in the IDE's configured browser. */
    fun openUrl(url: String) {
        if (!url.startsWith("http://") && !url.startsWith("https://")) return
        ApplicationManager.getApplication().invokeLater { runCatching { BrowserUtil.browse(url) } }
    }

    private fun projectBasePath(project: Project) =
        project.basePath?.let { runCatching { Paths.get(it) }.getOrNull() }

    /**
     * Looks the file up without blocking the EDT, refreshing only when the agent just created it.
     */
    private fun findFile(path: String): VirtualFile? {
        val fileSystem = LocalFileSystem.getInstance()
        fileSystem.findFileByPath(path)?.let { return it }
        fileSystem.refreshAndFindFileByPath(path)?.let { return it }
        return null
    }
}
