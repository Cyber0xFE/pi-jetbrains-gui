package dev.pi.jetbrains.ui

import com.intellij.openapi.keymap.KeymapUtil
import com.intellij.openapi.options.Configurable
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import dev.pi.jetbrains.PiSettings
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.Font
import java.awt.FlowLayout
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import java.awt.Insets
import java.awt.event.KeyAdapter
import java.awt.event.KeyEvent
import javax.swing.Box
import javax.swing.JButton
import javax.swing.JCheckBox
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JSeparator
import javax.swing.JSpinner
import javax.swing.JTextField
import javax.swing.SpinnerNumberModel
import javax.swing.KeyStroke

/** Settings page for runtime discovery, approvals and diagnostics. */
class PiSettingsConfigurable : Configurable {
    private val nodePath = JTextField()
    private val networkProxyEnabled = JCheckBox("启用网络代理").apply {
        toolTipText = "关闭后不使用此处配置的代理，Pi 将继承系统环境"
        accessibleContext.accessibleName = "启用网络代理"
    }
    private val networkProxy = JTextField().apply {
        toolTipText = "例如 http://127.0.0.1:7890；同时设置 HTTP_PROXY / HTTPS_PROXY；留空则继承系统环境"
        accessibleContext.accessibleName = "网络代理地址"
    }
    private val logDirectory = JTextField()
    private val taskCompletionSound = JCheckBox("任务完成时播放声音")
    private val chatFontSize = JSpinner(
        SpinnerNumberModel(
            PiSettings.DEFAULT_CHAT_FONT_SIZE,
            PiSettings.MIN_CHAT_FONT_SIZE,
            PiSettings.MAX_CHAT_FONT_SIZE,
            1,
        ),
    ).apply {
        toolTipText = "调整 Pi 聊天面板的基础字体大小"
        accessibleContext.accessibleName = "Pi 聊天字体大小"
    }
    private val panelShortcut = JTextField()
    private var panelShortcutValue = ""
    private val newTabShortcut = JTextField()
    private var newTabShortcutValue = ""
    private val closeTabShortcut = JTextField()
    private var closeTabShortcutValue = ""
    private val previousTabShortcut = JTextField()
    private var previousTabShortcutValue = ""
    private val nextTabShortcut = JTextField()
    private var nextTabShortcutValue = ""
    private val scrollToLatestShortcut = JTextField()
    private var scrollToLatestShortcutValue = ""
    private var panel: JPanel? = null

    override fun getDisplayName(): String = "Pi"

    override fun createComponent(): JComponent {
        val result = JPanel(BorderLayout()).apply {
            // Keep the form pinned to the top instead of letting GridBagLayout center it
            // in the much taller Settings content area.
            border = JBUI.Borders.empty(20, 24, 20, 24)
        }
        val form = JPanel(GridBagLayout()).apply { isOpaque = false }
        var row = 0

        fun sectionHeader(title: String): JComponent {
            val titleLabel = JLabel(title).apply {
                font = font.deriveFont(Font.BOLD)
            }
            return JPanel(BorderLayout(12, 0)).apply {
                isOpaque = false
                border = JBUI.Borders.empty(8, 0, 8, 0)
                add(titleLabel, BorderLayout.WEST)
                add(JSeparator(), BorderLayout.CENTER)
            }
        }

        fun addSection(title: String) {
            form.add(sectionHeader(title), GridBagConstraints().apply {
                gridx = 0
                gridy = row++
                gridwidth = 2
                fill = GridBagConstraints.HORIZONTAL
                weightx = 1.0
                insets = Insets(0, 0, 2, 0)
            })
        }

        fun addField(labelText: String, field: JComponent, description: String? = null) {
            val label = JLabel(labelText).apply {
                labelFor = field
                border = JBUI.Borders.empty(0, 0, 0, 16)
            }
            form.add(label, GridBagConstraints().apply {
                gridx = 0
                gridy = row
                anchor = GridBagConstraints.NORTHWEST
                insets = Insets(5, 0, 5, 0)
            })
            form.add(field, GridBagConstraints().apply {
                gridx = 1
                gridy = row++
                fill = GridBagConstraints.HORIZONTAL
                weightx = 1.0
                insets = Insets(0, 0, 5, 0)
            })
            if (description != null) {
                form.add(JLabel(description).apply {
                    foreground = UIUtil.getContextHelpForeground()
                    font = font.deriveFont(font.size2D - 1f)
                }, GridBagConstraints().apply {
                    gridx = 1
                    gridy = row++
                    fill = GridBagConstraints.HORIZONTAL
                    weightx = 1.0
                    insets = Insets(0, 0, 9, 0)
                })
            }
        }

        addSection("运行环境")
        addField("Node.js 路径（可选）：", nodePath, "留空时自动从系统 PATH 中查找 Node.js。")
        val networkProxyRow = JPanel(BorderLayout(0, 4)).apply {
            isOpaque = false
            add(networkProxyEnabled, BorderLayout.NORTH)
            add(networkProxy, BorderLayout.CENTER)
        }
        networkProxyEnabled.addActionListener { networkProxy.isEnabled = networkProxyEnabled.isSelected }
        addField(
            "网络代理（可选）：",
            networkProxyRow,
            "<html>同时设置 HTTP_PROXY / HTTPS_PROXY，例如 http://127.0.0.1:7890；关闭或留空则继承系统环境。<br>应用代理更改会重启 Pi 并恢复会话，正在执行的任务会中断。</html>",
        )

        addSection("界面与行为")
        fun configureShortcut(field: JTextField, accessibleName: String, onStroke: (KeyStroke) -> Unit) {
            field.isEditable = false
            field.columns = 22
            field.preferredSize = Dimension(JBUI.scale(260), field.preferredSize.height)
            field.toolTipText = "点击后按下快捷键组合"
            field.accessibleContext.accessibleName = accessibleName
            field.addKeyListener(object : KeyAdapter() {
                override fun keyPressed(event: KeyEvent) {
                    if (event.keyCode == KeyEvent.VK_CONTROL || event.keyCode == KeyEvent.VK_ALT ||
                        event.keyCode == KeyEvent.VK_SHIFT || event.keyCode == KeyEvent.VK_META
                    ) return
                    val stroke = KeyStroke.getKeyStrokeForEvent(event)
                    onStroke(stroke)
                    event.consume()
                }
            })
        }

        fun shortcutRow(field: JTextField, clearName: String, onClear: () -> Unit): JPanel = JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)).apply {
            isOpaque = false
            add(field)
            add(Box.createHorizontalStrut(8))
            add(JButton("清除").apply {
                accessibleContext.accessibleName = clearName
                addActionListener { onClear() }
            })
        }

        configureShortcut(panelShortcut, "打开 Pi 面板快捷键") { stroke ->
            panelShortcutValue = stroke.toString()
            panelShortcut.text = KeymapUtil.getKeystrokeText(stroke)
        }
        addField(
            "打开 Pi 面板快捷键：",
            shortcutRow(panelShortcut, "清除 Pi 面板快捷键") {
                panelShortcutValue = ""
                panelShortcut.text = "未设置"
            },
            "点击输入框后按下新的组合键。",
        )
        configureShortcut(newTabShortcut, "新建 Pi 标签页快捷键") { stroke ->
            newTabShortcutValue = stroke.toString()
            newTabShortcut.text = KeymapUtil.getKeystrokeText(stroke)
        }
        addField(
            "新建 Pi 标签页快捷键：",
            shortcutRow(newTabShortcut, "清除新建 Pi 标签页快捷键") {
                newTabShortcutValue = ""
                newTabShortcut.text = "未设置"
            },
            "点击输入框后按下新的组合键。",
        )
        configureShortcut(closeTabShortcut, "关闭 Pi 标签页快捷键") { stroke ->
            closeTabShortcutValue = stroke.toString()
            closeTabShortcut.text = KeymapUtil.getKeystrokeText(stroke)
        }
        addField(
            "关闭 Pi 标签页快捷键：",
            shortcutRow(closeTabShortcut, "清除关闭 Pi 标签页快捷键") {
                closeTabShortcutValue = ""
                closeTabShortcut.text = "未设置"
            },
            "点击输入框后按下新的组合键。",
        )
        configureShortcut(previousTabShortcut, "上一个 Pi 标签页快捷键") { stroke ->
            previousTabShortcutValue = stroke.toString()
            previousTabShortcut.text = KeymapUtil.getKeystrokeText(stroke)
        }
        addField(
            "上一个 Pi 标签页快捷键：",
            shortcutRow(previousTabShortcut, "清除上一个 Pi 标签页快捷键") {
                previousTabShortcutValue = ""
                previousTabShortcut.text = "未设置"
            },
            "点击输入框后按下新的组合键。",
        )
        configureShortcut(nextTabShortcut, "下一个 Pi 标签页快捷键") { stroke ->
            nextTabShortcutValue = stroke.toString()
            nextTabShortcut.text = KeymapUtil.getKeystrokeText(stroke)
        }
        addField(
            "下一个 Pi 标签页快捷键：",
            shortcutRow(nextTabShortcut, "清除下一个 Pi 标签页快捷键") {
                nextTabShortcutValue = ""
                nextTabShortcut.text = "未设置"
            },
            "点击输入框后按下新的组合键。",
        )
        configureShortcut(scrollToLatestShortcut, "跳转到 Pi 最新消息快捷键") { stroke ->
            scrollToLatestShortcutValue = stroke.toString()
            scrollToLatestShortcut.text = KeymapUtil.getKeystrokeText(stroke)
        }
        addField(
            "跳转到 Pi 最新消息快捷键：",
            shortcutRow(scrollToLatestShortcut, "清除跳转到 Pi 最新消息快捷键") {
                scrollToLatestShortcutValue = ""
                scrollToLatestShortcut.text = "未设置"
            },
            "点击输入框后按下新的组合键。",
        )
        val chatFontSizeRow = JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)).apply {
            isOpaque = false
            add(chatFontSize)
        }
        addField("聊天字体大小（px）：", chatFontSizeRow, "调整 Pi 聊天面板的基础字体大小，范围为 10–32px。")
        form.add(taskCompletionSound.apply {
            isOpaque = false
            accessibleContext.accessibleName = "任务完成时播放声音"
        }, GridBagConstraints().apply {
            gridx = 1
            gridy = row++
            anchor = GridBagConstraints.WEST
            insets = Insets(3, 0, 10, 0)
        })

        addSection("诊断")
        addField("日志目录（仅用于诊断）：", logDirectory, "仅在需要排查问题时写入日志目录；留空则不保存诊断日志。")

        // Reserve the label column so fields line up even when a section has no label.
        form.add(Box.createHorizontalStrut(JBUI.scale(170)), GridBagConstraints().apply {
            gridx = 0
            gridy = row
            weightx = 0.0
        })

        result.add(form, BorderLayout.NORTH)
        panel = result
        reset()
        return result
    }

    override fun isModified(): Boolean {
        val state = PiSettings.get().getState()
        return nodePath.text != state.nodePath ||
            networkProxyEnabled.isSelected != state.networkProxyEnabled ||
            networkProxy.text.trim() != state.networkProxy ||
            logDirectory.text != state.logDirectory ||
            chatFontSizeValue() != state.chatFontSize ||
            taskCompletionSound.isSelected != state.taskCompletionSoundEnabled ||
            panelShortcutValue != state.panelShortcut ||
            newTabShortcutValue != state.newTabShortcut ||
            closeTabShortcutValue != state.closeTabShortcut ||
            previousTabShortcutValue != state.previousTabShortcut ||
            nextTabShortcutValue != state.nextTabShortcut ||
            scrollToLatestShortcutValue != state.scrollToLatestShortcut
    }

    override fun apply() {
        val settings = PiSettings.get()
        val state = settings.getState()
        val fontSizeChanged = chatFontSizeValue() != state.chatFontSize
        val proxyEnabled = networkProxyEnabled.isSelected
        val proxy = networkProxy.text.trim()
        val proxyChanged = proxyEnabled != state.networkProxyEnabled || proxy != state.networkProxy
        state.networkProxyEnabled = proxyEnabled
        state.networkProxy = proxy
        state.nodePath = nodePath.text.trim()
        state.logDirectory = logDirectory.text.trim()
        state.chatFontSize = chatFontSizeValue()
        state.taskCompletionSoundEnabled = taskCompletionSound.isSelected
        state.panelShortcut = panelShortcutValue
        state.newTabShortcut = newTabShortcutValue
        state.closeTabShortcut = closeTabShortcutValue
        state.previousTabShortcut = previousTabShortcutValue
        state.nextTabShortcut = nextTabShortcutValue
        state.scrollToLatestShortcut = scrollToLatestShortcutValue
        settings.applyShortcuts()
        if (proxyChanged) settings.notifyNetworkProxyChanged()
        if (fontSizeChanged) settings.notifyChatFontSizeChanged()
    }

    override fun reset() {
        val state = PiSettings.get().getState()
        nodePath.text = state.nodePath
        networkProxyEnabled.isSelected = state.networkProxyEnabled
        networkProxy.text = state.networkProxy
        networkProxy.isEnabled = state.networkProxyEnabled
        logDirectory.text = state.logDirectory
        chatFontSize.value = state.chatFontSize.coerceIn(PiSettings.MIN_CHAT_FONT_SIZE, PiSettings.MAX_CHAT_FONT_SIZE)
        taskCompletionSound.isSelected = state.taskCompletionSoundEnabled
        panelShortcutValue = state.panelShortcut
        val keyStroke = panelShortcutValue.takeIf { it.isNotBlank() }?.let { KeyStroke.getKeyStroke(it) }
        panelShortcut.text = keyStroke?.let(KeymapUtil::getKeystrokeText) ?: "未设置"
        newTabShortcutValue = state.newTabShortcut
        val newTabKeyStroke = newTabShortcutValue.takeIf { it.isNotBlank() }?.let { KeyStroke.getKeyStroke(it) }
        newTabShortcut.text = newTabKeyStroke?.let(KeymapUtil::getKeystrokeText) ?: "未设置"
        closeTabShortcutValue = state.closeTabShortcut
        val closeTabKeyStroke = closeTabShortcutValue.takeIf { it.isNotBlank() }?.let { KeyStroke.getKeyStroke(it) }
        closeTabShortcut.text = closeTabKeyStroke?.let(KeymapUtil::getKeystrokeText) ?: "未设置"
        previousTabShortcutValue = state.previousTabShortcut
        val previousTabKeyStroke = previousTabShortcutValue.takeIf { it.isNotBlank() }?.let { KeyStroke.getKeyStroke(it) }
        previousTabShortcut.text = previousTabKeyStroke?.let(KeymapUtil::getKeystrokeText) ?: "未设置"
        nextTabShortcutValue = state.nextTabShortcut
        val nextTabKeyStroke = nextTabShortcutValue.takeIf { it.isNotBlank() }?.let { KeyStroke.getKeyStroke(it) }
        nextTabShortcut.text = nextTabKeyStroke?.let(KeymapUtil::getKeystrokeText) ?: "未设置"
        scrollToLatestShortcutValue = state.scrollToLatestShortcut
        val scrollToLatestKeyStroke = scrollToLatestShortcutValue.takeIf { it.isNotBlank() }?.let { KeyStroke.getKeyStroke(it) }
        scrollToLatestShortcut.text = scrollToLatestKeyStroke?.let(KeymapUtil::getKeystrokeText) ?: "未设置"
    }

    override fun disposeUIResources() {
        panel = null
    }

    private fun chatFontSizeValue(): Int = (chatFontSize.value as? Number)?.toInt()
        ?.coerceIn(PiSettings.MIN_CHAT_FONT_SIZE, PiSettings.MAX_CHAT_FONT_SIZE)
        ?: PiSettings.DEFAULT_CHAT_FONT_SIZE
}
