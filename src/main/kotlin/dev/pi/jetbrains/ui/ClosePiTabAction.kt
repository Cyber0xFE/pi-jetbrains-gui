package dev.pi.jetbrains.ui

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import dev.pi.jetbrains.PiChatTabsService
import dev.pi.jetbrains.PiSettings

/** Closes the selected Pi chat tab. */
class ClosePiTabAction : AnAction("关闭 Pi 标签页", "关闭当前的 Pi 聊天标签页", null) {
    init {
        PiSettings.get().applyShortcuts()
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun actionPerformed(event: AnActionEvent) {
        event.project?.service<PiChatTabsService>()?.closeSelectedTab()
    }

    override fun update(event: AnActionEvent) {
        event.presentation.isEnabledAndVisible = event.project != null
    }
}
