package dev.pi.jetbrains.editor

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import dev.pi.jetbrains.PiChatService

/** Places the selected console output in the pi chat composer. */
class SendConsoleSelectionToPiAction : AnAction("发送到 Pi", "将选中的控制台输出发送到 Pi 输入框", null) {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        val editor = event.getData(CommonDataKeys.EDITOR) ?: return
        val text = editor.selectionModel.selectedText?.takeIf { it.isNotBlank() } ?: return
        project.service<PiChatService>().prefillComposer(text)
        ApplicationManager.getApplication().invokeLater {
            project.service<PiChatService>().showToolWindow()
        }
    }

    override fun update(event: AnActionEvent) {
        val editor = event.getData(CommonDataKeys.EDITOR)
        event.presentation.isEnabledAndVisible = event.project != null &&
            editor?.selectionModel?.hasSelection() == true
    }
}
