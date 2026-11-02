package dev.pi.jetbrains.ui

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import dev.pi.jetbrains.PiChatTabsService
import dev.pi.jetbrains.PiSettings

/** Selects the previous Pi chat tab. */
class PreviousPiTabAction : AnAction("上一个 Pi 标签页", "切换到上一个 Pi 聊天标签页", null) {
    init {
        PiSettings.get().applyShortcuts()
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun actionPerformed(event: AnActionEvent) {
        event.project?.service<PiChatTabsService>()?.switchTab(-1)
    }

    override fun update(event: AnActionEvent) {
        event.presentation.isEnabledAndVisible = event.project != null
    }
}

/** Selects the next Pi chat tab. */
class NextPiTabAction : AnAction("下一个 Pi 标签页", "切换到下一个 Pi 聊天标签页", null) {
    init {
        PiSettings.get().applyShortcuts()
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun actionPerformed(event: AnActionEvent) {
        event.project?.service<PiChatTabsService>()?.switchTab(1)
    }

    override fun update(event: AnActionEvent) {
        event.presentation.isEnabledAndVisible = event.project != null
    }
}
