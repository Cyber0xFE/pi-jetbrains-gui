package dev.pi.jetbrains

import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
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

    private companion object {
        /** Tabs show a short prefix; the full title goes to the tab tooltip. Measured in pixels
         *  with the actual tab font so titles of any script end up the same visual length. */
        const val TAB_TITLE_MAX_WIDTH_PX = 90
        const val EDT_DIAGNOSTIC_THRESHOLD_MS = 100.0
    }

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
        val iconUpdate = TabIconUpdate()
        val panel = ChatPanel(
            project,
            session,
            ::activateSession,
            diagnosticName = "Chat $number",
            onStatusChanged = { status ->
                val currentContent = content ?: return@ChatPanel
                val running = status.isStreaming || status.isCompacting
                when {
                    running -> setTabIcon(currentContent, running = true, iconUpdate = iconUpdate, session = session, tabName = "Chat $number")
                    status.phase == PiChatService.Phase.RUNNING -> setTabIcon(currentContent, running = false, iconUpdate = iconUpdate, session = session, tabName = "Chat $number")
                }
            },
            onTitleChanged = { title ->
                val currentContent = content ?: return@ChatPanel
                val full = title ?: "任务 $number"
                val queuedAt = System.nanoTime()
                ApplicationManager.getApplication().invokeLater({
                    logEdtDelay(session, "Chat $number", "tab_title", queuedAt)
                    if (!currentContent.isValid) return@invokeLater
                    currentContent.description = full
                    val component = currentContent.component
                    val label = if (component != null) {
                        truncateTabTitle(full, component.getFontMetrics(component.font))
                    } else full
                    if (currentContent.displayName != label) currentContent.displayName = label
                }, ModalityState.any())
            },
        )
        val createdContent = ContentFactory.getInstance().createContent(panel, "任务 $number", false)
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

    /** Truncates by pixel width of the real tab font so all tab labels look equally long. */
    private fun truncateTabTitle(text: String, metrics: java.awt.FontMetrics): String {
        if (metrics.stringWidth(text) <= TAB_TITLE_MAX_WIDTH_PX) return text
        var width = metrics.stringWidth("…")
        text.forEachIndexed { index, ch ->
            width += metrics.charWidth(ch)
            if (width > TAB_TITLE_MAX_WIDTH_PX) return text.take(index) + "…"
        }
        return text
    }

    /** Coalesces repeated streaming-state updates into one EDT task per tab. */
    private fun setTabIcon(
        content: Content,
        running: Boolean,
        iconUpdate: TabIconUpdate,
        session: PiChatService,
        tabName: String,
    ) {
        val queuedAt: Long
        synchronized(iconUpdate) {
            iconUpdate.running = running
            if (iconUpdate.queued) return
            iconUpdate.queued = true
            queuedAt = System.nanoTime()
        }
        ApplicationManager.getApplication().invokeLater({
            logEdtDelay(session, tabName, "tab_icon", queuedAt)
            val desiredRunning: Boolean
            synchronized(iconUpdate) {
                desiredRunning = iconUpdate.running
                iconUpdate.queued = false
            }
            if (content.isValid) {
                content.icon = if (desiredRunning) AnimatedIcon.Default.INSTANCE else CompletedTabIcon
            }
        }, ModalityState.any())
    }

    private class TabIconUpdate {
        var running = false
        var queued = false
    }

    private fun logEdtDelay(session: PiChatService, tabName: String, operation: String, queuedAt: Long) {
        val delayMs = (System.nanoTime() - queuedAt) / 1_000_000.0
        if (delayMs < EDT_DIAGNOSTIC_THRESHOLD_MS) return
        ApplicationManager.getApplication().executeOnPooledThread {
            session.logDiagnostic("[tab=$tabName] [edt-source] operation=$operation queueMs=${"%.1f".format(delayMs)}")
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

    /** Reuse an already open session instead of loading the same JSONL in two processes.
     *  Matches by session id when the webview provides it, falling back to a canonical path
     *  comparison so separator or case differences between pi and the session index still hit. */
    private fun activateSession(path: String, sessionId: String? = null): Boolean {
        val window = ToolWindowManager.getInstance(project).getToolWindow("Pi") ?: return false
        val content = window.contentManager.contents.firstOrNull {
            val panel = it.component as? ChatPanel ?: return@firstOrNull false
            panel.matchesSession(path, sessionId)
        } ?: return false
        val panel = content.component as? ChatPanel ?: return false
        val queuedAt = System.nanoTime()
        window.activate {
            panel.logEdtSource("activate_session", queuedAt)
            if (content.isValid) {
                window.contentManager.setSelectedContent(content)
                panel.requestComposerFocus()
            }
        }
        return true
    }

    private fun ChatPanel.matchesSession(path: String, sessionId: String?): Boolean {
        if (sessionId != null && sessionId == this.sessionId) return true
        val file = sessionFile ?: return false
        return isSameSessionFile(file, path)
    }

    private fun isSameSessionFile(a: String, b: String): Boolean = runCatching {
        java.io.File(a).canonicalPath == java.io.File(b).canonicalPath
    }.getOrDefault(a == b)

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

    fun showNewTab() {
        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed) return@invokeLater
            val window = ToolWindowManager.getInstance(project).getToolWindow("Pi") ?: return@invokeLater
            window.activate {
                addTab(window)
            }
        }
    }

    fun closeSelectedTab() {
        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed) return@invokeLater
            val window = ToolWindowManager.getInstance(project).getToolWindow("Pi") ?: return@invokeLater
            val content = window.contentManager.selectedContent ?: return@invokeLater
            window.contentManager.removeContent(content, true)
        }
    }

    /** Selects the neighboring Pi tab, wrapping at either end of the tab strip. */
    fun switchTab(direction: Int) {
        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed) return@invokeLater
            val window = ToolWindowManager.getInstance(project).getToolWindow("Pi") ?: return@invokeLater
            val contents = window.contentManager.contents
            if (contents.size < 2) return@invokeLater
            val selectedIndex = window.contentManager.selectedContent?.let(contents::indexOf)
                ?.takeIf { it >= 0 } ?: return@invokeLater
            val nextIndex = (selectedIndex + direction).mod(contents.size)
            val content = contents[nextIndex]
            window.contentManager.setSelectedContent(content)
            (content.component as? ChatPanel)?.requestComposerFocus()
        }
    }

    fun scrollSelectedToLatest() {
        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed) return@invokeLater
            val window = ToolWindowManager.getInstance(project).getToolWindow("Pi") ?: return@invokeLater
            (window.contentManager.selectedContent?.component as? ChatPanel)?.scrollToLatest()
        }
    }

    fun scrollSelectedToFirst() {
        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed) return@invokeLater
            val window = ToolWindowManager.getInstance(project).getToolWindow("Pi") ?: return@invokeLater
            (window.contentManager.selectedContent?.component as? ChatPanel)?.scrollToFirst()
        }
    }

    fun scrollSelectedToPreviousUserMessage() {
        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed) return@invokeLater
            val window = ToolWindowManager.getInstance(project).getToolWindow("Pi") ?: return@invokeLater
            (window.contentManager.selectedContent?.component as? ChatPanel)?.scrollToPreviousUserMessage()
        }
    }

    fun scrollSelectedToNextUserMessage() {
        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed) return@invokeLater
            val window = ToolWindowManager.getInstance(project).getToolWindow("Pi") ?: return@invokeLater
            (window.contentManager.selectedContent?.component as? ChatPanel)?.scrollToNextUserMessage()
        }
    }

    override fun dispose() = Unit // Content and child disposables release panels and processes.
}
