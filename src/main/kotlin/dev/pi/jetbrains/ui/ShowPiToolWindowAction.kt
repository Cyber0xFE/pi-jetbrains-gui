package dev.pi.jetbrains.ui

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import dev.pi.jetbrains.PiChatTabsService
import dev.pi.jetbrains.PiSettings

/** Opens the Pi chat tool window. */
class ShowPiToolWindowAction : AnAction("打开 Pi 面板", "打开 Pi 聊天面板", null) {
    init {
        PiSettings.get().applyPanelShortcut()
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun actionPerformed(event: AnActionEvent) {
        event.project?.service<PiChatTabsService>()?.showToolWindow()
    }

    override fun update(event: AnActionEvent) {
        event.presentation.isEnabledAndVisible = event.project != null
    }
}
