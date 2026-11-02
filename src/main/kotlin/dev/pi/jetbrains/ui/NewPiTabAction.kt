package dev.pi.jetbrains.ui

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import dev.pi.jetbrains.PiChatTabsService
import dev.pi.jetbrains.PiSettings

/** Creates and activates an independent Pi chat tab. */
class NewPiTabAction : AnAction("新建 Pi 标签页", "新建一个独立的 Pi 聊天标签页", null) {
    init {
        PiSettings.get().applyShortcuts()
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun actionPerformed(event: AnActionEvent) {
        event.project?.service<PiChatTabsService>()?.showNewTab()
    }

    override fun update(event: AnActionEvent) {
        event.presentation.isEnabledAndVisible = event.project != null
    }
}
