package dev.pi.jetbrains.ui

import com.intellij.openapi.options.Configurable
import com.intellij.openapi.components.service
import dev.pi.jetbrains.PiSettings
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import java.awt.Insets
import java.awt.event.KeyAdapter
import java.awt.event.KeyEvent
import javax.swing.JButton
import javax.swing.JCheckBox
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JTextField
import javax.swing.KeyStroke
import com.intellij.openapi.keymap.KeymapUtil

/** Settings page for runtime discovery, approvals and diagnostics. */
class PiSettingsConfigurable : Configurable {
    private val nodePath = JTextField()
    private val logDirectory = JTextField()
    private val taskCompletionSound = JCheckBox("任务完成时播放声音")
    private val panelShortcut = JTextField()
    private var panelShortcutValue = ""
    private var panel: JPanel? = null

    override fun getDisplayName(): String = "Pi"

    override fun createComponent(): JComponent {
        val result = JPanel(GridBagLayout())
        val labelConstraints = GridBagConstraints().apply {
            anchor = GridBagConstraints.WEST
            insets = Insets(4, 4, 4, 8)
        }
        val fieldConstraints = GridBagConstraints().apply {
            gridwidth = GridBagConstraints.REMAINDER
            fill = GridBagConstraints.HORIZONTAL
            weightx = 1.0
            insets = Insets(4, 4, 4, 4)
        }
        result.add(JLabel("Node.js 路径（可选）："), labelConstraints)
        result.add(nodePath, fieldConstraints)
        result.add(JLabel("日志目录（仅用于诊断）："), labelConstraints)
        result.add(logDirectory, fieldConstraints)
        result.add(JLabel("打开 Pi 面板快捷键："), labelConstraints)
        val shortcutRow = JPanel(GridBagLayout())
        val shortcutFieldConstraints = GridBagConstraints().apply {
            fill = GridBagConstraints.HORIZONTAL
            weightx = 1.0
            insets = Insets(0, 0, 0, 4)
        }
        val clearConstraints = GridBagConstraints().apply {
            gridwidth = GridBagConstraints.REMAINDER
        }
        panelShortcut.isEditable = false
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
        shortcutRow.add(panelShortcut, shortcutFieldConstraints)
        shortcutRow.add(JButton("清除").apply {
            addActionListener {
                panelShortcutValue = ""
                panelShortcut.text = "未设置"
            }
        }, clearConstraints)
        result.add(shortcutRow, fieldConstraints)
        result.add(taskCompletionSound, fieldConstraints)
        panel = result
        reset()
        return result
    }

    override fun isModified(): Boolean {
        val state = PiSettings.get().getState()
        return nodePath.text != state.nodePath ||
            logDirectory.text != state.logDirectory ||
            taskCompletionSound.isSelected != state.taskCompletionSoundEnabled ||
            panelShortcutValue != state.panelShortcut
    }

    override fun apply() {
        val state = PiSettings.get().getState()
        state.nodePath = nodePath.text.trim()
        state.logDirectory = logDirectory.text.trim()
        state.taskCompletionSoundEnabled = taskCompletionSound.isSelected
        state.panelShortcut = panelShortcutValue
        PiSettings.get().applyPanelShortcut()
    }

    override fun reset() {
        val state = PiSettings.get().getState()
        nodePath.text = state.nodePath
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
