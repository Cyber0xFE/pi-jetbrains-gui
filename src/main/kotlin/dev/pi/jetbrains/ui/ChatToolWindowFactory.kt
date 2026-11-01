package dev.pi.jetbrains.ui

import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import dev.pi.jetbrains.PiChatTabsService

/** Hosts independent task tabs in the `Pi` tool window. */
class ChatToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        project.service<PiChatTabsService>().initialize(toolWindow)
    }
}
