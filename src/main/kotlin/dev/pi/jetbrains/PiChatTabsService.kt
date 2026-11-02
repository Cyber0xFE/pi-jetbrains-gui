package dev.pi.jetbrains

import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.ui.AnimatedIcon
import com.intellij.util.ui.UIUtil
import com.intellij.ui.content.Content
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.content.ContentManagerEvent
import com.intellij.ui.content.ContentManagerListener
import dev.pi.jetbrains.ui.ChatPanel

/** Project-level tab owner; each content owns its panel and an independent agent process. */
@Service(Service.Level.PROJECT)
class PiChatTabsService(private val project: Project) : Disposable {
    private var nextTabNumber = 1

    fun initialize(toolWindow: ToolWindow) {
        toolWindow.setToHideOnEmptyContent(false)
        toolWindow.setTitleActions(listOf(object : AnAction("新建任务标签页", "在独立标签页中运行另一项任务", AllIcons.General.Add) {
            override fun actionPerformed(e: AnActionEvent) {
                addTab(toolWindow)
            }
        }))
        toolWindow.contentManager.addContentManagerListener(object : ContentManagerListener {
            override fun contentRemoveQuery(event: ContentManagerEvent) {
                val panel = event.content.component as? ChatPanel ?: return
                if (!panel.isTaskRunning()) return
                if (Messages.showYesNoDialog(
                        project,
                        "此标签页仍在执行任务，关闭将停止该任务。是否继续？",
                        "关闭任务标签页",
                        Messages.getWarningIcon(),
                    ) != Messages.YES
                ) event.consume()
            }
        })
        addTab(toolWindow)
    }

    private fun addTab(toolWindow: ToolWindow): ChatPanel {
        val session = PiChatService(project)
        Disposer.register(this, session)
        val number = nextTabNumber++
        var content: Content? = null
        val panel = ChatPanel(project, session, ::activateSession, diagnosticName = "Chat $number") { status ->
            val currentContent = content ?: return@ChatPanel
            val running = status.isStreaming || status.isCompacting
            when {
                running -> setTabIcon(currentContent, running = true)
                status.phase == PiChatService.Phase.RUNNING -> setTabIcon(currentContent, running = false)
            }
        }
        val createdContent = ContentFactory.getInstance().createContent(panel, "Chat $number", false)
        createdContent.putUserData(ToolWindow.SHOW_CONTENT_ICON, true)
        createdContent.icon = CompletedTabIcon
        content = createdContent
        createdContent.isCloseable = true
        createdContent.setDisposer(panel)
        Disposer.register(this, panel)
        Disposer.register(panel, session)
        toolWindow.contentManager.addContent(createdContent)
        toolWindow.contentManager.setSelectedContent(createdContent)
        panel.requestComposerFocus()
        return panel
    }

    private fun setTabIcon(content: Content, running: Boolean) {
        ApplicationManager.getApplication().invokeLater {
            if (content.isValid) content.icon = if (running) AnimatedIcon.Default.INSTANCE else CompletedTabIcon
        }
    }

    private object CompletedTabIcon : javax.swing.Icon {
        override fun getIconWidth(): Int = 16

        override fun getIconHeight(): Int = 16

        override fun paintIcon(component: java.awt.Component?, graphics: java.awt.Graphics, x: Int, y: Int) {
            val copy = graphics.create() as java.awt.Graphics2D
            try {
                copy.color = UIUtil.getLabelForeground()
                copy.stroke = java.awt.BasicStroke(1.5f)
                copy.drawOval(x + 3, y + 3, 10, 10)
            } finally {
                copy.dispose()
            }
        }
    }

    /** Reuse an already open session instead of loading the same JSONL in two processes. */
    private fun activateSession(path: String): Boolean {
        val window = ToolWindowManager.getInstance(project).getToolWindow("Pi") ?: return false
        val content = window.contentManager.contents.firstOrNull {
            (it.component as? ChatPanel)?.sessionFile == path
        } ?: return false
        window.contentManager.setSelectedContent(content)
        (content.component as? ChatPanel)?.requestComposerFocus()
        return true
    }

    fun showToolWindow(prefill: String? = null) {
        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed) return@invokeLater
            val window = ToolWindowManager.getInstance(project).getToolWindow("Pi") ?: return@invokeLater
            window.activate {
                val panel = window.contentManager.selectedContent?.component as? ChatPanel ?: addTab(window)
                if (prefill != null) panel.prefillComposer(prefill)
                panel.requestComposerFocus()
            }
        }
    }

    override fun dispose() = Unit // Content and child disposables release panels and processes.
}
