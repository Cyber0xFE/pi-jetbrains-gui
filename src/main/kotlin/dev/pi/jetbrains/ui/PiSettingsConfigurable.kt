package dev.pi.jetbrains.ui

import com.intellij.openapi.keymap.KeymapUtil
import com.intellij.openapi.options.Configurable
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import dev.pi.jetbrains.PiSettings
import java.awt.BorderLayout
import java.awt.Font
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
import javax.swing.JTextField
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
    private val panelShortcut = JTextField()
    private var panelShortcutValue = ""
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
        panelShortcut.isEditable = false
        panelShortcut.toolTipText = "点击后按下快捷键组合"
        panelShortcut.accessibleContext.accessibleName = "打开 Pi 面板快捷键"
        panelShortcut.addKeyListener(object : KeyAdapter() {
            override fun keyPressed(event: KeyEvent) {
                if (event.keyCode == KeyEvent.VK_CONTROL || event.keyCode == KeyEvent.VK_ALT ||
                    event.keyCode == KeyEvent.VK_SHIFT || event.keyCode == KeyEvent.VK_META
                ) return
                val stroke = KeyStroke.getKeyStrokeForEvent(event)
                panelShortcutValue = stroke.toString()
                panelShortcut.text = KeymapUtil.getKeystrokeText(stroke)
                event.consume()
            }
        })
        val shortcutRow = JPanel(GridBagLayout()).apply { isOpaque = false }
        shortcutRow.add(panelShortcut, GridBagConstraints().apply {
            gridx = 0
            gridy = 0
            fill = GridBagConstraints.HORIZONTAL
            weightx = 1.0
            insets = Insets(0, 0, 0, 8)
        })
        shortcutRow.add(JButton("清除").apply {
            accessibleContext.accessibleName = "清除 Pi 面板快捷键"
            addActionListener {
                panelShortcutValue = ""
                panelShortcut.text = "未设置"
            }
        }, GridBagConstraints().apply {
            gridx = 1
            gridy = 0
            anchor = GridBagConstraints.EAST
        })
        addField("打开 Pi 面板快捷键：", shortcutRow, "点击输入框后按下新的组合键。")
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
            taskCompletionSound.isSelected != state.taskCompletionSoundEnabled ||
            panelShortcutValue != state.panelShortcut
    }

    override fun apply() {
        val settings = PiSettings.get()
        val state = settings.getState()
        val proxyEnabled = networkProxyEnabled.isSelected
        val proxy = networkProxy.text.trim()
        val proxyChanged = proxyEnabled != state.networkProxyEnabled || proxy != state.networkProxy
        state.networkProxyEnabled = proxyEnabled
        state.networkProxy = proxy
        state.nodePath = nodePath.text.trim()
        state.logDirectory = logDirectory.text.trim()
        state.taskCompletionSoundEnabled = taskCompletionSound.isSelected
        state.panelShortcut = panelShortcutValue
        settings.applyPanelShortcut()
        if (proxyChanged) settings.notifyNetworkProxyChanged()
    }

    override fun reset() {
        val state = PiSettings.get().getState()
        nodePath.text = state.nodePath
        networkProxyEnabled.isSelected = state.networkProxyEnabled
        networkProxy.text = state.networkProxy
        networkProxy.isEnabled = state.networkProxyEnabled
        logDirectory.text = state.logDirectory
        taskCompletionSound.isSelected = state.taskCompletionSoundEnabled
        panelShortcutValue = state.panelShortcut
        val keyStroke = panelShortcutValue.takeIf { it.isNotBlank() }?.let { KeyStroke.getKeyStroke(it) }
        panelShortcut.text = keyStroke?.let(KeymapUtil::getKeystrokeText) ?: "未设置"
    }

    override fun disposeUIResources() {
        panel = null
    }
}
