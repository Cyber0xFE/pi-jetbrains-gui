package dev.pi.jetbrains.ui

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import dev.pi.jetbrains.PiChatTabsService
import dev.pi.jetbrains.PiSettings

/** Scrolls the selected Pi chat tab to its first message. */
class ScrollPiToFirstAction : AnAction("跳转到 Pi 第一条消息", "将当前 Pi 聊天滚动到第一条消息", null) {
    init {
        PiSettings.get().applyShortcuts()
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun actionPerformed(event: AnActionEvent) {
        event.project?.service<PiChatTabsService>()?.scrollSelectedToFirst()
    }

    override fun update(event: AnActionEvent) {
        event.presentation.isEnabledAndVisible = event.project != null
    }
}
