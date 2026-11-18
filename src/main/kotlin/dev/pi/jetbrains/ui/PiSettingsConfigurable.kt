package dev.pi.jetbrains.ui

import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptor
import com.intellij.openapi.keymap.KeymapUtil
import com.intellij.openapi.options.Configurable
import com.intellij.ui.ColorPanel
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
import java.awt.event.ComponentAdapter
import java.awt.event.ComponentEvent
import java.awt.event.KeyAdapter
import java.awt.event.KeyEvent
import javax.swing.Box
import javax.swing.JButton
import javax.swing.JCheckBox
import javax.swing.JComboBox
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
    private val networkProxyEnabled = JCheckBox()
    private val networkProxy = JTextField()
    private val backgroundImage = JTextField()
    private val backgroundImageOpacity = JSpinner(
        SpinnerNumberModel(
            PiSettings.DEFAULT_BACKGROUND_IMAGE_OPACITY,
            PiSettings.MIN_BACKGROUND_IMAGE_OPACITY,
            PiSettings.MAX_BACKGROUND_IMAGE_OPACITY,
            1,
        ),
    )
    private val logDirectory = JTextField()
    private val taskCompletionSound = JCheckBox()
    private val chatFontSize = JSpinner(
        SpinnerNumberModel(
            PiSettings.DEFAULT_CHAT_FONT_SIZE,
            PiSettings.MIN_CHAT_FONT_SIZE,
            PiSettings.MAX_CHAT_FONT_SIZE,
            1,
        ),
    )
    private val chatWheelSensitivity = JSpinner(
        SpinnerNumberModel(
            PiSettings.DEFAULT_CHAT_WHEEL_SENSITIVITY,
            PiSettings.MIN_CHAT_WHEEL_SENSITIVITY,
            PiSettings.MAX_CHAT_WHEEL_SENSITIVITY,
            5,
        ),
    )
    private val accentColorPanel = ColorPanel().apply {
        // ColorPanel 的 peer 在加入组件层级前尚未创建，accessibleContext 为 null，
        // 只能在首次显示时再设置无障碍名称。
        addComponentListener(object : ComponentAdapter() {
            override fun componentShown(event: ComponentEvent) {
                event.component.accessibleContext?.accessibleName = currentTexts()["accentAccessible"]
            }
        })
    }
    private val language = JComboBox(arrayOf("中文", "English"))
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
    private val scrollToFirstShortcut = JTextField()
    private var scrollToFirstShortcutValue = ""
    private val previousUserMessageShortcut = JTextField()
    private var previousUserMessageShortcutValue = ""
    private val nextUserMessageShortcut = JTextField()
    private var nextUserMessageShortcutValue = ""
    private var panel: JPanel? = null
    private var languageListenerInstalled = false

    /** Text refreshers rebuilt with every settings panel; the language box updates them live. */
    private val textUpdaters = mutableListOf<(Map<String, String>) -> Unit>()

    override fun getDisplayName(): String = "Pi"

    override fun createComponent(): JComponent {
        textUpdaters.clear()
        val result = JPanel(BorderLayout()).apply {
            // Keep the form pinned to the top instead of letting GridBagLayout center it
            // in the much taller Settings content area.
            border = JBUI.Borders.empty(20, 24, 20, 24)
        }
        val form = JPanel(GridBagLayout()).apply { isOpaque = false }
        var row = 0

        fun register(updater: (Map<String, String>) -> Unit) {
            textUpdaters += updater
        }

        fun textField(field: JTextField, tipKey: String, accessibleKey: String) {
            register { texts ->
                field.toolTipText = texts[tipKey]
                field.accessibleContext.accessibleName = texts[accessibleKey]
            }
        }

        fun spinner(field: JSpinner, tipKey: String, accessibleKey: String) {
            register { texts ->
                field.toolTipText = texts[tipKey]
                field.accessibleContext.accessibleName = texts[accessibleKey]
            }
        }

        fun button(textKey: String, accessibleKey: String, action: () -> Unit): JButton {
            val button = JButton()
            register { texts ->
                button.text = texts[textKey]
                button.accessibleContext.accessibleName = texts[accessibleKey]
            }
            button.addActionListener { action() }
            return button
        }

        fun sectionHeader(titleKey: String): JComponent {
            val titleLabel = JLabel()
            register { texts -> titleLabel.text = texts[titleKey] }
            return JPanel(BorderLayout(12, 0)).apply {
                isOpaque = false
                border = JBUI.Borders.empty(8, 0, 8, 0)
                add(titleLabel, BorderLayout.WEST)
                add(JSeparator(), BorderLayout.CENTER)
            }
        }

        fun addSection(titleKey: String) {
            form.add(sectionHeader(titleKey), GridBagConstraints().apply {
                gridx = 0
                gridy = row++
                gridwidth = 2
                fill = GridBagConstraints.HORIZONTAL
                weightx = 1.0
                insets = Insets(0, 0, 2, 0)
            })
        }

        fun addField(labelKey: String, field: JComponent, descriptionKey: String? = null) {
            val label = JLabel().apply {
                labelFor = field
                border = JBUI.Borders.empty(0, 0, 0, 16)
            }
            register { texts -> label.text = texts[labelKey] }
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
            if (descriptionKey != null) {
                val description = JLabel().apply {
                    foreground = UIUtil.getContextHelpForeground()
                    font = font.deriveFont(font.size2D - 1f)
                }
                register { texts -> description.text = texts[descriptionKey] }
                form.add(description, GridBagConstraints().apply {
                    gridx = 1
                    gridy = row++
                    fill = GridBagConstraints.HORIZONTAL
                    weightx = 1.0
                    insets = Insets(0, 0, 9, 0)
                })
            }
        }

        addSection("sectionRuntime")
        addField("nodePathLabel", nodePath, "nodePathHelp")
        val networkProxyRow = JPanel(BorderLayout(0, 4)).apply {
            isOpaque = false
            add(networkProxyEnabled, BorderLayout.NORTH)
            add(networkProxy, BorderLayout.CENTER)
        }
        networkProxyEnabled.addActionListener { networkProxy.isEnabled = networkProxyEnabled.isSelected }
        register { texts ->
            networkProxyEnabled.text = texts["proxyEnabled"]
            networkProxyEnabled.accessibleContext.accessibleName = texts["proxyEnabled"]
            networkProxyEnabled.toolTipText = texts["proxyEnabledTip"]
        }
        textField(networkProxy, "proxyTip", "proxyAccessible")
        addField(
            "proxyLabel",
            networkProxyRow,
            "proxyHelp",
        )

        addSection("sectionUi")
        addField("languageLabel", language, "languageHelp")
        register { texts ->
            language.toolTipText = texts["languageTip"]
            language.accessibleContext.accessibleName = texts["languageAccessible"]
        }
        if (!languageListenerInstalled) {
            language.addActionListener { refreshTexts() }
            languageListenerInstalled = true
        }
        fun configureShortcut(field: JTextField, accessibleKey: String, onStroke: (KeyStroke) -> Unit) {
            field.isEditable = false
            field.columns = 22
            field.preferredSize = Dimension(JBUI.scale(260), field.preferredSize.height)
            register { texts ->
                field.toolTipText = texts["shortcutTip"]
                field.accessibleContext.accessibleName = texts[accessibleKey]
            }
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

        fun shortcutRow(
            field: JTextField,
            clearAccessibleKey: String,
            onClear: () -> Unit,
        ): JPanel = JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)).apply {
            isOpaque = false
            add(field)
            add(Box.createHorizontalStrut(8))
            add(button("clear", clearAccessibleKey) { onClear() })
        }

        configureShortcut(panelShortcut, "panelShortcutAccessible") { stroke ->
            panelShortcutValue = stroke.toString()
            panelShortcut.text = KeymapUtil.getKeystrokeText(stroke)
        }
        addField(
            "panelShortcutLabel",
            shortcutRow(panelShortcut, "panelShortcutClearAccessible") {
                panelShortcutValue = ""
                panelShortcut.text = currentTexts()["notSet"]
            },
            "shortcutHelp",
        )
        configureShortcut(newTabShortcut, "newTabShortcutAccessible") { stroke ->
            newTabShortcutValue = stroke.toString()
            newTabShortcut.text = KeymapUtil.getKeystrokeText(stroke)
        }
        addField(
            "newTabShortcutLabel",
            shortcutRow(newTabShortcut, "newTabShortcutClearAccessible") {
                newTabShortcutValue = ""
                newTabShortcut.text = currentTexts()["notSet"]
            },
            "shortcutHelp",
        )
        configureShortcut(closeTabShortcut, "closeTabShortcutAccessible") { stroke ->
            closeTabShortcutValue = stroke.toString()
            closeTabShortcut.text = KeymapUtil.getKeystrokeText(stroke)
        }
        addField(
            "closeTabShortcutLabel",
            shortcutRow(closeTabShortcut, "closeTabShortcutClearAccessible") {
                closeTabShortcutValue = ""
                closeTabShortcut.text = currentTexts()["notSet"]
            },
            "shortcutHelp",
        )
        configureShortcut(previousTabShortcut, "previousTabShortcutAccessible") { stroke ->
            previousTabShortcutValue = stroke.toString()
            previousTabShortcut.text = KeymapUtil.getKeystrokeText(stroke)
        }
        addField(
            "previousTabShortcutLabel",
            shortcutRow(previousTabShortcut, "previousTabShortcutClearAccessible") {
                previousTabShortcutValue = ""
                previousTabShortcut.text = currentTexts()["notSet"]
            },
            "shortcutHelp",
        )
        configureShortcut(nextTabShortcut, "nextTabShortcutAccessible") { stroke ->
            nextTabShortcutValue = stroke.toString()
            nextTabShortcut.text = KeymapUtil.getKeystrokeText(stroke)
        }
        addField(
            "nextTabShortcutLabel",
            shortcutRow(nextTabShortcut, "nextTabShortcutClearAccessible") {
                nextTabShortcutValue = ""
                nextTabShortcut.text = currentTexts()["notSet"]
            },
            "shortcutHelp",
        )
        configureShortcut(scrollToLatestShortcut, "scrollToLatestShortcutAccessible") { stroke ->
            scrollToLatestShortcutValue = stroke.toString()
            scrollToLatestShortcut.text = KeymapUtil.getKeystrokeText(stroke)
        }
        addField(
            "scrollToLatestShortcutLabel",
            shortcutRow(scrollToLatestShortcut, "scrollToLatestShortcutClearAccessible") {
                scrollToLatestShortcutValue = ""
                scrollToLatestShortcut.text = currentTexts()["notSet"]
            },
            "shortcutHelp",
        )
        configureShortcut(scrollToFirstShortcut, "scrollToFirstShortcutAccessible") { stroke ->
            scrollToFirstShortcutValue = stroke.toString()
            scrollToFirstShortcut.text = KeymapUtil.getKeystrokeText(stroke)
        }
        addField(
            "scrollToFirstShortcutLabel",
            shortcutRow(scrollToFirstShortcut, "scrollToFirstShortcutClearAccessible") {
                scrollToFirstShortcutValue = ""
                scrollToFirstShortcut.text = currentTexts()["notSet"]
            },
            "shortcutHelp",
        )
        configureShortcut(previousUserMessageShortcut, "previousUserShortcutAccessible") { stroke ->
            previousUserMessageShortcutValue = stroke.toString()
            previousUserMessageShortcut.text = KeymapUtil.getKeystrokeText(stroke)
        }
        addField(
            "previousUserShortcutLabel",
            shortcutRow(previousUserMessageShortcut, "previousUserShortcutClearAccessible") {
                previousUserMessageShortcutValue = ""
                previousUserMessageShortcut.text = currentTexts()["notSet"]
            },
            "shortcutHelp",
        )
        configureShortcut(nextUserMessageShortcut, "nextUserShortcutAccessible") { stroke ->
            nextUserMessageShortcutValue = stroke.toString()
            nextUserMessageShortcut.text = KeymapUtil.getKeystrokeText(stroke)
        }
        addField(
            "nextUserShortcutLabel",
            shortcutRow(nextUserMessageShortcut, "nextUserShortcutClearAccessible") {
                nextUserMessageShortcutValue = ""
                nextUserMessageShortcut.text = currentTexts()["notSet"]
            },
            "shortcutHelp",
        )
        val chatFontSizeRow = JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)).apply {
            isOpaque = false
            add(chatFontSize)
        }
        spinner(chatFontSize, "chatFontSizeTip", "chatFontSizeAccessible")
        addField("chatFontSizeLabel", chatFontSizeRow, "chatFontSizeHelp")
        val chatWheelSensitivityRow = JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)).apply {
            isOpaque = false
            add(chatWheelSensitivity)
        }
        spinner(chatWheelSensitivity, "wheelTip", "wheelAccessible")
        addField(
            "wheelLabel",
            chatWheelSensitivityRow,
            "wheelHelp",
        )
        val accentColorRow = JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)).apply {
            isOpaque = false
            add(accentColorPanel)
            add(Box.createHorizontalStrut(8))
            add(button("accentReset", "accentResetAccessible") { accentColorPanel.selectedColor = null })
        }
        register { texts ->
            accentColorPanel.toolTipText = texts["accentTip"]
            accentColorPanel.accessibleContext?.accessibleName = texts["accentAccessible"]
        }
        addField("accentLabel", accentColorRow, "accentHelp")
        textField(backgroundImage, "backgroundTip", "backgroundAccessible")
        val backgroundImageRow = JPanel(BorderLayout(8, 0)).apply {
            isOpaque = false
            add(backgroundImage, BorderLayout.CENTER)
            add(JPanel(FlowLayout(FlowLayout.LEFT, 6, 0)).apply {
                isOpaque = false
                add(button("choose", "chooseAccessible") { chooseBackgroundImage() })
                add(button("clearImage", "clearImageAccessible") { backgroundImage.text = "" })
            }, BorderLayout.EAST)
        }
        addField(
            "backgroundLabel",
            backgroundImageRow,
            "backgroundHelp",
        )
        val backgroundImageOpacityRow = JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)).apply {
            isOpaque = false
            add(backgroundImageOpacity)
        }
        spinner(backgroundImageOpacity, "opacityTip", "opacityAccessible")
        addField(
            "opacityLabel",
            backgroundImageOpacityRow,
            "opacityHelp",
        )
        register { texts ->
            taskCompletionSound.text = texts["taskSound"]
            taskCompletionSound.accessibleContext.accessibleName = texts["taskSoundAccessible"]
        }
        form.add(taskCompletionSound.apply {
            isOpaque = false
        }, GridBagConstraints().apply {
            gridx = 1
            gridy = row++
            anchor = GridBagConstraints.WEST
            insets = Insets(3, 0, 10, 0)
        })

        addSection("sectionDiagnostics")
        addField("logLabel", logDirectory, "logHelp")

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
            languageCode() != state.language ||
            logDirectory.text != state.logDirectory ||
            chatFontSizeValue() != state.chatFontSize ||
            chatWheelSensitivityValue() != state.chatWheelSensitivity ||
            accentColorHex() != state.accentColor ||
            backgroundImage.text.trim() != state.backgroundImage ||
            backgroundImageOpacityValue() != state.backgroundImageOpacity ||
            taskCompletionSound.isSelected != state.taskCompletionSoundEnabled ||
            panelShortcutValue != state.panelShortcut ||
            newTabShortcutValue != state.newTabShortcut ||
            closeTabShortcutValue != state.closeTabShortcut ||
            previousTabShortcutValue != state.previousTabShortcut ||
            nextTabShortcutValue != state.nextTabShortcut ||
            scrollToLatestShortcutValue != state.scrollToLatestShortcut ||
            scrollToFirstShortcutValue != state.scrollToFirstShortcut ||
            previousUserMessageShortcutValue != state.previousUserMessageShortcut ||
            nextUserMessageShortcutValue != state.nextUserMessageShortcut
    }

    override fun apply() {
        val settings = PiSettings.get()
        val state = settings.getState()
        val fontSizeChanged = chatFontSizeValue() != state.chatFontSize
        val wheelSensitivityChanged = chatWheelSensitivityValue() != state.chatWheelSensitivity
        val accentColorChanged = accentColorHex() != state.accentColor
        val backgroundImageChanged = backgroundImage.text.trim() != state.backgroundImage ||
            backgroundImageOpacityValue() != state.backgroundImageOpacity
        val proxyEnabled = networkProxyEnabled.isSelected
        val proxy = networkProxy.text.trim()
        val proxyChanged = proxyEnabled != state.networkProxyEnabled || proxy != state.networkProxy
        val languageChanged = languageCode() != state.language
        state.networkProxyEnabled = proxyEnabled
        state.networkProxy = proxy
        state.nodePath = nodePath.text.trim()
        state.language = languageCode()
        state.logDirectory = logDirectory.text.trim()
        state.chatFontSize = chatFontSizeValue()
        state.chatWheelSensitivity = chatWheelSensitivityValue()
        state.accentColor = accentColorHex()
        state.backgroundImage = backgroundImage.text.trim()
        state.backgroundImageOpacity = backgroundImageOpacityValue()
        state.taskCompletionSoundEnabled = taskCompletionSound.isSelected
        state.panelShortcut = panelShortcutValue
        state.newTabShortcut = newTabShortcutValue
        state.closeTabShortcut = closeTabShortcutValue
        state.previousTabShortcut = previousTabShortcutValue
        state.nextTabShortcut = nextTabShortcutValue
        state.scrollToLatestShortcut = scrollToLatestShortcutValue
        state.scrollToFirstShortcut = scrollToFirstShortcutValue
        state.previousUserMessageShortcut = previousUserMessageShortcutValue
        state.nextUserMessageShortcut = nextUserMessageShortcutValue
        settings.applyShortcuts()
        if (proxyChanged) settings.notifyNetworkProxyChanged()
        if (languageChanged) settings.notifyLanguageChanged()
        if (fontSizeChanged) settings.notifyChatFontSizeChanged()
        if (wheelSensitivityChanged) settings.notifyChatWheelSensitivityChanged()
        if (accentColorChanged) settings.notifyAccentColorChanged()
        if (backgroundImageChanged) settings.notifyBackgroundImageChanged()
    }

    override fun reset() {
        val state = PiSettings.get().getState()
        nodePath.text = state.nodePath
        networkProxyEnabled.isSelected = state.networkProxyEnabled
        networkProxy.text = state.networkProxy
        networkProxy.isEnabled = state.networkProxyEnabled
        language.selectedIndex = if (state.language == PiSettings.LANGUAGE_EN) 1 else 0
        logDirectory.text = state.logDirectory
        chatFontSize.value = state.chatFontSize.coerceIn(PiSettings.MIN_CHAT_FONT_SIZE, PiSettings.MAX_CHAT_FONT_SIZE)
        chatWheelSensitivity.value = state.chatWheelSensitivity.coerceIn(
            PiSettings.MIN_CHAT_WHEEL_SENSITIVITY,
            PiSettings.MAX_CHAT_WHEEL_SENSITIVITY,
        )
        accentColorPanel.selectedColor = PiSettings.parseAccentColor(state.accentColor)
        backgroundImage.text = state.backgroundImage
        backgroundImageOpacity.value = state.backgroundImageOpacity.coerceIn(
            PiSettings.MIN_BACKGROUND_IMAGE_OPACITY,
            PiSettings.MAX_BACKGROUND_IMAGE_OPACITY,
        )
        taskCompletionSound.isSelected = state.taskCompletionSoundEnabled
        panelShortcutValue = state.panelShortcut
        newTabShortcutValue = state.newTabShortcut
        closeTabShortcutValue = state.closeTabShortcut
        previousTabShortcutValue = state.previousTabShortcut
        nextTabShortcutValue = state.nextTabShortcut
        scrollToLatestShortcutValue = state.scrollToLatestShortcut
        scrollToFirstShortcutValue = state.scrollToFirstShortcut
        previousUserMessageShortcutValue = state.previousUserMessageShortcut
        nextUserMessageShortcutValue = state.nextUserMessageShortcut
        refreshTexts()
    }

    override fun disposeUIResources() {
        panel = null
    }

    /** Applies the current language to every registered label, help text and tooltip. */
    private fun refreshTexts() {
        val texts = currentTexts()
        textUpdaters.forEach { it(texts) }
        panelShortcut.text = shortcutText(panelShortcutValue, texts["notSet"])
        newTabShortcut.text = shortcutText(newTabShortcutValue, texts["notSet"])
        closeTabShortcut.text = shortcutText(closeTabShortcutValue, texts["notSet"])
        previousTabShortcut.text = shortcutText(previousTabShortcutValue, texts["notSet"])
        nextTabShortcut.text = shortcutText(nextTabShortcutValue, texts["notSet"])
        scrollToLatestShortcut.text = shortcutText(scrollToLatestShortcutValue, texts["notSet"])
        scrollToFirstShortcut.text = shortcutText(scrollToFirstShortcutValue, texts["notSet"])
        previousUserMessageShortcut.text = shortcutText(previousUserMessageShortcutValue, texts["notSet"])
        nextUserMessageShortcut.text = shortcutText(nextUserMessageShortcutValue, texts["notSet"])
    }

    private fun shortcutText(value: String, notSet: String?): String =
        value.takeIf { it.isNotBlank() }?.let { KeymapUtil.getKeystrokeText(KeyStroke.getKeyStroke(it)) }
            ?: notSet.orEmpty()

    private fun chooseBackgroundImage() {
        // Build the descriptor directly and use FileChooser.chooseFile: the
        // FileChooserDescriptorFactory.createSingleFileDescriptor() shortcut is deprecated, and
        // FileChooserDialog.choose gained a (Project, VirtualFile...) signature in 2026.3, which
        // made the old FileChooserFactory call binary-incompatible with newer IDEs. Extension filters
        // are left to the dialog's description: FileChooserDescriptor.withExtensionFilter only
        // exists from 2024.3 on, and withFileFilter would need the deprecated Condition type.
        val texts = currentTexts()
        val descriptor = FileChooserDescriptor(true, false, false, false, false, false)
            .withTitle(texts["chooserTitle"])
            .withDescription(texts["chooserDescription"])
        FileChooser.chooseFile(descriptor, null, null)?.path?.let { backgroundImage.text = it }
    }

    private fun currentTexts(): Map<String, String> =
        if (languageCode() == PiSettings.LANGUAGE_EN) ENGLISH_TEXTS else CHINESE_TEXTS

    private fun languageCode(): String = if (language.selectedIndex == 1) PiSettings.LANGUAGE_EN else PiSettings.LANGUAGE_ZH

    private fun backgroundImageOpacityValue(): Int = (backgroundImageOpacity.value as? Number)?.toInt()
        ?.coerceIn(PiSettings.MIN_BACKGROUND_IMAGE_OPACITY, PiSettings.MAX_BACKGROUND_IMAGE_OPACITY)
        ?: PiSettings.DEFAULT_BACKGROUND_IMAGE_OPACITY

    private fun chatFontSizeValue(): Int = (chatFontSize.value as? Number)?.toInt()
        ?.coerceIn(PiSettings.MIN_CHAT_FONT_SIZE, PiSettings.MAX_CHAT_FONT_SIZE)
        ?: PiSettings.DEFAULT_CHAT_FONT_SIZE

    private fun chatWheelSensitivityValue(): Int = (chatWheelSensitivity.value as? Number)?.toInt()
        ?.coerceIn(PiSettings.MIN_CHAT_WHEEL_SENSITIVITY, PiSettings.MAX_CHAT_WHEEL_SENSITIVITY)
        ?: PiSettings.DEFAULT_CHAT_WHEEL_SENSITIVITY

    private fun accentColorHex(): String = accentColorPanel.selectedColor
        ?.let { "#%02x%02x%02x".format(it.red, it.green, it.blue) }
        ?: ""

    companion object {
        private val CHINESE_TEXTS = mapOf(
            "sectionRuntime" to "运行环境",
            "sectionUi" to "界面与行为",
            "sectionDiagnostics" to "诊断",
            "nodePathLabel" to "Node.js 路径（可选）：",
            "nodePathHelp" to "留空时自动从系统 PATH 中查找 Node.js。",
            "proxyEnabled" to "启用网络代理",
            "proxyEnabledTip" to "关闭后不使用此处配置的代理，Pi 将继承系统环境",
            "proxyLabel" to "网络代理（可选）：",
            "proxyHelp" to "<html>同时设置 HTTP_PROXY / HTTPS_PROXY，例如 http://127.0.0.1:7890；关闭或留空则继承系统环境。<br>应用代理更改会重启 Pi 并恢复会话，正在执行的任务会中断。</html>",
            "proxyTip" to "例如 http://127.0.0.1:7890；同时设置 HTTP_PROXY / HTTPS_PROXY；留空则继承系统环境",
            "proxyAccessible" to "网络代理地址",
            "languageLabel" to "界面语言：",
            "languageHelp" to "切换 Pi 聊天界面的中文或英文；应用后已打开的聊天标签会立即更新。",
            "languageTip" to "选择 Pi 聊天界面的语言",
            "languageAccessible" to "Pi 界面语言",
            "shortcutTip" to "点击后按下快捷键组合",
            "shortcutHelp" to "点击输入框后按下新的组合键。",
            "clear" to "清除",
            "notSet" to "未设置",
            "panelShortcutLabel" to "打开 Pi 面板快捷键：",
            "panelShortcutAccessible" to "打开 Pi 面板快捷键",
            "panelShortcutClearAccessible" to "清除 Pi 面板快捷键",
            "newTabShortcutLabel" to "新建 Pi 标签页快捷键：",
            "newTabShortcutAccessible" to "新建 Pi 标签页快捷键",
            "newTabShortcutClearAccessible" to "清除新建 Pi 标签页快捷键",
            "closeTabShortcutLabel" to "关闭 Pi 标签页快捷键：",
            "closeTabShortcutAccessible" to "关闭 Pi 标签页快捷键",
            "closeTabShortcutClearAccessible" to "清除关闭 Pi 标签页快捷键",
            "previousTabShortcutLabel" to "上一个 Pi 标签页快捷键：",
            "previousTabShortcutAccessible" to "上一个 Pi 标签页快捷键",
            "previousTabShortcutClearAccessible" to "清除上一个 Pi 标签页快捷键",
            "nextTabShortcutLabel" to "下一个 Pi 标签页快捷键：",
            "nextTabShortcutAccessible" to "下一个 Pi 标签页快捷键",
            "nextTabShortcutClearAccessible" to "清除下一个 Pi 标签页快捷键",
            "scrollToLatestShortcutLabel" to "跳转到 Pi 最新消息快捷键：",
            "scrollToLatestShortcutAccessible" to "跳转到 Pi 最新消息快捷键",
            "scrollToLatestShortcutClearAccessible" to "清除跳转到 Pi 最新消息快捷键",
            "scrollToFirstShortcutLabel" to "跳转到 Pi 第一条消息快捷键：",
            "scrollToFirstShortcutAccessible" to "跳转到 Pi 第一条消息快捷键",
            "scrollToFirstShortcutClearAccessible" to "清除跳转到 Pi 第一条消息快捷键",
            "previousUserShortcutLabel" to "上一条用户消息快捷键：",
            "previousUserShortcutAccessible" to "上一条用户消息快捷键",
            "previousUserShortcutClearAccessible" to "清除上一条用户消息快捷键",
            "nextUserShortcutLabel" to "下一条用户消息快捷键：",
            "nextUserShortcutAccessible" to "下一条用户消息快捷键",
            "nextUserShortcutClearAccessible" to "清除下一条用户消息快捷键",
            "chatFontSizeLabel" to "聊天字体大小（px）：",
            "chatFontSizeHelp" to "调整 Pi 聊天面板的基础字体大小，范围为 10–32px。",
            "chatFontSizeTip" to "调整 Pi 聊天面板的基础字体大小",
            "chatFontSizeAccessible" to "Pi 聊天字体大小",
            "wheelLabel" to "滚轮灵敏度（%）：",
            "wheelHelp" to "调整 Pi 聊天面板的鼠标滚轮滚动速度，100 为默认速度，范围为 25–400%。",
            "wheelTip" to "调整 Pi 聊天面板的鼠标滚轮滚动速度",
            "wheelAccessible" to "Pi 滚轮灵敏度",
            "accentLabel" to "主题色（可选）：",
            "accentHelp" to "自定义 Pi 聊天界面的强调色，点击色块选择颜色；留空时跟随 IDE 主题。",
            "accentTip" to "覆盖 Pi 聊天界面的强调色；留空时跟随 IDE 主题",
            "accentAccessible" to "Pi 主题色",
            "accentReset" to "恢复默认",
            "accentResetAccessible" to "恢复默认 Pi 主题色",
            "backgroundLabel" to "背景图像（可选）：",
            "backgroundHelp" to "选择一张图片作为 Pi 聊天区域的背景，支持 PNG、JPG、GIF、WebP 和 BMP；留空、文件不可读或超过 4 MB 时不显示背景图像。",
            "backgroundTip" to "背景图像路径，支持 PNG、JPG、GIF、WebP 和 BMP；留空则不显示背景图像",
            "backgroundAccessible" to "Pi 背景图像",
            "choose" to "选择…",
            "chooseAccessible" to "选择 Pi 背景图像",
            "clearImage" to "清除",
            "clearImageAccessible" to "清除 Pi 背景图像",
            "opacityLabel" to "背景不透明度（%）：",
            "opacityHelp" to "背景图像的不透明度，0 为完全透明，100 为完全不透明。",
            "opacityTip" to "背景图像不透明度（0–100）",
            "opacityAccessible" to "Pi 背景图像不透明度",
            "taskSound" to "任务完成时播放声音",
            "taskSoundAccessible" to "任务完成时播放声音",
            "logLabel" to "日志目录（仅用于诊断）：",
            "logHelp" to "仅在需要排查问题时写入日志目录；留空则不保存诊断日志。",
            "chooserTitle" to "选择背景图像",
            "chooserDescription" to "选择一张 PNG、JPG、GIF、WebP 或 BMP 图片",
        )

        private val ENGLISH_TEXTS = mapOf(
            "sectionRuntime" to "Runtime",
            "sectionUi" to "Interface & behavior",
            "sectionDiagnostics" to "Diagnostics",
            "nodePathLabel" to "Node.js path (optional):",
            "nodePathHelp" to "Leave empty to find Node.js automatically from the system PATH.",
            "proxyEnabled" to "Enable network proxy",
            "proxyEnabledTip" to "When off, the configured proxy is not used and Pi inherits the system environment",
            "proxyLabel" to "Network proxy (optional):",
            "proxyHelp" to "<html>Also sets HTTP_PROXY / HTTPS_PROXY, for example http://127.0.0.1:7890; when disabled or empty, the system environment is inherited.<br>Applying proxy changes restarts Pi and restores the session; running tasks are interrupted.</html>",
            "proxyTip" to "For example http://127.0.0.1:7890; also sets HTTP_PROXY / HTTPS_PROXY; leave empty to inherit the system environment",
            "proxyAccessible" to "Network proxy address",
            "languageLabel" to "Interface language:",
            "languageHelp" to "Switch the Pi chat UI between Chinese and English; applying updates already-open chat tabs immediately.",
            "languageTip" to "Select the Pi chat UI language",
            "languageAccessible" to "Pi interface language",
            "shortcutTip" to "Click, then press the shortcut combination",
            "shortcutHelp" to "Click the field and press the new key combination.",
            "clear" to "Clear",
            "notSet" to "Not set",
            "panelShortcutLabel" to "Open Pi panel shortcut:",
            "panelShortcutAccessible" to "Open Pi panel shortcut",
            "panelShortcutClearAccessible" to "Clear Pi panel shortcut",
            "newTabShortcutLabel" to "New Pi tab shortcut:",
            "newTabShortcutAccessible" to "New Pi tab shortcut",
            "newTabShortcutClearAccessible" to "Clear new Pi tab shortcut",
            "closeTabShortcutLabel" to "Close Pi tab shortcut:",
            "closeTabShortcutAccessible" to "Close Pi tab shortcut",
            "closeTabShortcutClearAccessible" to "Clear close Pi tab shortcut",
            "previousTabShortcutLabel" to "Previous Pi tab shortcut:",
            "previousTabShortcutAccessible" to "Previous Pi tab shortcut",
            "previousTabShortcutClearAccessible" to "Clear previous Pi tab shortcut",
            "nextTabShortcutLabel" to "Next Pi tab shortcut:",
            "nextTabShortcutAccessible" to "Next Pi tab shortcut",
            "nextTabShortcutClearAccessible" to "Clear next Pi tab shortcut",
            "scrollToLatestShortcutLabel" to "Jump to latest Pi message shortcut:",
            "scrollToLatestShortcutAccessible" to "Jump to latest Pi message shortcut",
            "scrollToLatestShortcutClearAccessible" to "Clear jump to latest Pi message shortcut",
            "scrollToFirstShortcutLabel" to "Jump to first Pi message shortcut:",
            "scrollToFirstShortcutAccessible" to "Jump to first Pi message shortcut",
            "scrollToFirstShortcutClearAccessible" to "Clear jump to first Pi message shortcut",
            "previousUserShortcutLabel" to "Previous user message shortcut:",
            "previousUserShortcutAccessible" to "Previous user message shortcut",
            "previousUserShortcutClearAccessible" to "Clear previous user message shortcut",
            "nextUserShortcutLabel" to "Next user message shortcut:",
            "nextUserShortcutAccessible" to "Next user message shortcut",
            "nextUserShortcutClearAccessible" to "Clear next user message shortcut",
            "chatFontSizeLabel" to "Chat font size (px):",
            "chatFontSizeHelp" to "Adjust the base font size of the Pi chat panel; the range is 10–32px.",
            "chatFontSizeTip" to "Adjust the base font size of the Pi chat panel",
            "chatFontSizeAccessible" to "Pi chat font size",
            "wheelLabel" to "Wheel sensitivity (%):",
            "wheelHelp" to "Adjust mouse wheel scroll speed in the Pi chat panel; 100 is the default speed, range 25–400%.",
            "wheelTip" to "Adjust mouse wheel scroll speed in the Pi chat panel",
            "wheelAccessible" to "Pi wheel sensitivity",
            "accentLabel" to "Accent color (optional):",
            "accentHelp" to "Customize the accent color of the Pi chat UI; click the swatch to choose a color. Leave empty to follow the IDE theme.",
            "accentTip" to "Override the Pi chat accent color; leave empty to follow the IDE theme",
            "accentAccessible" to "Pi accent color",
            "accentReset" to "Reset",
            "accentResetAccessible" to "Reset Pi accent color",
            "backgroundLabel" to "Background image (optional):",
            "backgroundHelp" to "Choose an image shown behind the Pi chat area; PNG, JPG, GIF, WebP and BMP are supported. No background is shown when empty, unreadable, or larger than 4 MB.",
            "backgroundTip" to "Background image path; PNG, JPG, GIF, WebP and BMP are supported; leave empty for no background",
            "backgroundAccessible" to "Pi background image",
            "choose" to "Choose…",
            "chooseAccessible" to "Choose Pi background image",
            "clearImage" to "Clear",
            "clearImageAccessible" to "Clear Pi background image",
            "opacityLabel" to "Background opacity (%):",
            "opacityHelp" to "Opacity of the background image: 0 is fully transparent, 100 is fully opaque.",
            "opacityTip" to "Background image opacity (0–100)",
            "opacityAccessible" to "Pi background image opacity",
            "taskSound" to "Play a sound when a task completes",
            "taskSoundAccessible" to "Play a sound when a task completes",
            "logLabel" to "Log directory (diagnostics only):",
            "logHelp" to "Write diagnostic logs only when troubleshooting; leave empty to disable diagnostic logging.",
            "chooserTitle" to "Choose background image",
            "chooserDescription" to "Choose a PNG, JPG, GIF, WebP or BMP image",
        )
    }
}
