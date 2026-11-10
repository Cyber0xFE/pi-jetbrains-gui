package dev.pi.jetbrains

import com.intellij.openapi.application.ApplicationManager
import com.intellij.util.messages.Topic
import com.intellij.openapi.actionSystem.KeyboardShortcut
import com.intellij.openapi.keymap.ex.KeymapManagerEx
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.service
import dev.pi.jetbrains.rpc.PiJson
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.util.UUID

@OptIn(ExperimentalSerializationApi::class)
private val PrettyPiJson = Json(PiJson) {
    prettyPrint = true
    prettyPrintIndent = "  "
}

fun interface PiNetworkProxyListener {
    fun networkProxyChanged()
}

/** User-level runtime and approval settings for the pi integration. */
@Service(Service.Level.APP)
@State(name = "PiJetBrainsSettings", storages = [Storage("pi-jetbrains.xml")])
class PiSettings : PersistentStateComponent<PiSettings.State> {
    data class State(
        var nodePath: String = "",
        var networkProxy: String = "",
        /** Keeps existing configured proxies active when upgrading from older settings. */
        var networkProxyEnabled: Boolean = true,
        /** Retained for compatibility with existing settings files; no approval extension is loaded. */
        var approvalsEnabled: Boolean = false,
        var approveBash: Boolean = false,
        var approveWrite: Boolean = false,
        var taskCompletionSoundEnabled: Boolean = true,
        /** Base font size in the Pi chat webview, in CSS pixels. */
        var chatFontSize: Int = DEFAULT_CHAT_FONT_SIZE,
        /** Accent color override for the Pi chat webview as #RRGGBB; empty means follow the IDE. */
        var accentColor: String = "",
        /** Absolute path to an image shown behind the chat transcript; empty means no image. */
        var backgroundImage: String = "",
        /** Background image opacity in percent, mirroring the IDE background image setting. */
        var backgroundImageOpacity: Int = DEFAULT_BACKGROUND_IMAGE_OPACITY,
        var logDirectory: String = "",
        var panelShortcut: String = DEFAULT_PANEL_SHORTCUT,
        var newTabShortcut: String = DEFAULT_NEW_TAB_SHORTCUT,
        var closeTabShortcut: String = DEFAULT_CLOSE_TAB_SHORTCUT,
        var previousTabShortcut: String = DEFAULT_PREVIOUS_TAB_SHORTCUT,
        var nextTabShortcut: String = DEFAULT_NEXT_TAB_SHORTCUT,
        var scrollToLatestShortcut: String = DEFAULT_SCROLL_TO_LATEST_SHORTCUT,
        var scrollToFirstShortcut: String = DEFAULT_SCROLL_TO_FIRST_SHORTCUT,
        var previousUserMessageShortcut: String = DEFAULT_PREVIOUS_USER_MESSAGE_SHORTCUT,
        var nextUserMessageShortcut: String = DEFAULT_NEXT_USER_MESSAGE_SHORTCUT,
        /** Preferred model shown as the default in the model picker. */
        var defaultModelProvider: String = "",
        var defaultModelId: String = "",
    )

    private var state = State()

    override fun getState(): State = state

    override fun loadState(loadedState: State) {
        state = loadedState
    }

    /** Only overrides inherited proxy variables when a proxy is explicitly configured. */
    fun processEnvironment(): Map<String, String> {
        if (!state.networkProxyEnabled) return emptyMap()
        val proxy = state.networkProxy.trim()
        return if (proxy.isEmpty()) emptyMap() else mapOf("HTTP_PROXY" to proxy, "HTTPS_PROXY" to proxy)
    }

    fun notifyNetworkProxyChanged() {
        ApplicationManager.getApplication().messageBus.syncPublisher(NETWORK_PROXY_CHANGED).networkProxyChanged()
    }

    fun notifyChatFontSizeChanged() {
        ApplicationManager.getApplication().messageBus.syncPublisher(CHAT_FONT_SIZE_CHANGED).chatFontSizeChanged()
    }

    fun notifyAccentColorChanged() {
        ApplicationManager.getApplication().messageBus.syncPublisher(ACCENT_COLOR_CHANGED).accentColorChanged()
    }

    fun notifyBackgroundImageChanged() {
        ApplicationManager.getApplication().messageBus.syncPublisher(BACKGROUND_IMAGE_CHANGED).backgroundImageChanged()
    }

    /**
     * Stores the preferred model in pi's own settings file as well as in the plugin settings.
     * The existing JSON object is kept intact so unrelated pi options survive the update.
     */
    fun syncDefaultModel(provider: String, modelId: String): Boolean {
        val settingsPath = piAgentSettingsPath()
        return runCatching {
            Files.createDirectories(settingsPath.parent)
            val existing = if (Files.isRegularFile(settingsPath)) {
                Files.readString(settingsPath, StandardCharsets.UTF_8).removePrefix("\uFEFF")
            } else {
                "{}"
            }
            val root = PiJson.parseToJsonElement(existing) as? JsonObject
                ?: error("pi settings must contain a JSON object")
            val updated = JsonObject(root.toMutableMap().apply {
                put("defaultProvider", JsonPrimitive(provider))
                put("defaultModel", JsonPrimitive(modelId))
            })
            val temporaryPath = settingsPath.resolveSibling(".${settingsPath.fileName}.${UUID.randomUUID()}.tmp")
            try {
                Files.writeString(
                    temporaryPath,
                    PrettyPiJson.encodeToString(JsonObject.serializer(), updated) + System.lineSeparator(),
                    StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE_NEW,
                )
                try {
                    Files.move(
                        temporaryPath,
                        settingsPath,
                        StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING,
                    )
                } catch (_: java.nio.file.AtomicMoveNotSupportedException) {
                    Files.move(temporaryPath, settingsPath, StandardCopyOption.REPLACE_EXISTING)
                }
            } finally {
                Files.deleteIfExists(temporaryPath)
            }
            state.defaultModelProvider = provider
            state.defaultModelId = modelId
            true
        }.getOrDefault(false)
    }

    fun applyPanelShortcut() = applyShortcuts()

    fun applyShortcuts() {
        val manager = KeymapManagerEx.getInstanceEx()
        var keymap = manager.activeKeymap
        val panelStroke = state.panelShortcut.toKeyStroke()
        val newTabStroke = state.newTabShortcut.toKeyStroke()
        val closeTabStroke = state.closeTabShortcut.toKeyStroke()
        val previousTabStroke = state.previousTabShortcut.toKeyStroke()
        val nextTabStroke = state.nextTabShortcut.toKeyStroke()
        val scrollToLatestStroke = state.scrollToLatestShortcut.toKeyStroke()
        val scrollToFirstStroke = state.scrollToFirstShortcut.toKeyStroke()
        val previousUserMessageStroke = state.previousUserMessageShortcut.toKeyStroke()
        val nextUserMessageStroke = state.nextUserMessageShortcut.toKeyStroke()
        val usesOnlyDefaults = panelStroke == javax.swing.KeyStroke.getKeyStroke(DEFAULT_PANEL_SHORTCUT) &&
            newTabStroke == javax.swing.KeyStroke.getKeyStroke(DEFAULT_NEW_TAB_SHORTCUT) &&
            closeTabStroke == javax.swing.KeyStroke.getKeyStroke(DEFAULT_CLOSE_TAB_SHORTCUT) &&
            previousTabStroke == javax.swing.KeyStroke.getKeyStroke(DEFAULT_PREVIOUS_TAB_SHORTCUT) &&
            nextTabStroke == javax.swing.KeyStroke.getKeyStroke(DEFAULT_NEXT_TAB_SHORTCUT) &&
            scrollToLatestStroke == javax.swing.KeyStroke.getKeyStroke(DEFAULT_SCROLL_TO_LATEST_SHORTCUT) &&
            scrollToFirstStroke == javax.swing.KeyStroke.getKeyStroke(DEFAULT_SCROLL_TO_FIRST_SHORTCUT) &&
            previousUserMessageStroke == javax.swing.KeyStroke.getKeyStroke(DEFAULT_PREVIOUS_USER_MESSAGE_SHORTCUT) &&
            nextUserMessageStroke == javax.swing.KeyStroke.getKeyStroke(DEFAULT_NEXT_USER_MESSAGE_SHORTCUT)
        if (!keymap.canModify() && !usesOnlyDefaults) {
            keymap = manager.getKeymap("Pi JetBrains GUI") ?: keymap.deriveKeymap("Pi JetBrains GUI").also {
                manager.schemeManager.addScheme(it)
            }
            manager.setActiveKeymap(keymap)
        }
        if (!keymap.canModify()) return
        listOf(
            SHOW_PI_TOOL_WINDOW_ACTION_ID to panelStroke,
            NEW_PI_TAB_ACTION_ID to newTabStroke,
            CLOSE_PI_TAB_ACTION_ID to closeTabStroke,
            PREVIOUS_PI_TAB_ACTION_ID to previousTabStroke,
            NEXT_PI_TAB_ACTION_ID to nextTabStroke,
            SCROLL_PI_TO_LATEST_ACTION_ID to scrollToLatestStroke,
            SCROLL_PI_TO_FIRST_ACTION_ID to scrollToFirstStroke,
            SCROLL_PI_TO_PREVIOUS_USER_MESSAGE_ACTION_ID to previousUserMessageStroke,
            SCROLL_PI_TO_NEXT_USER_MESSAGE_ACTION_ID to nextUserMessageStroke,
        ).forEach { (actionId, stroke) ->
            keymap.removeAllActionShortcuts(actionId)
            if (stroke != null) keymap.addShortcut(actionId, KeyboardShortcut(stroke, null))
        }
    }

    companion object {
        val NETWORK_PROXY_CHANGED = Topic.create("Pi network proxy changed", PiNetworkProxyListener::class.java)
        val CHAT_FONT_SIZE_CHANGED = Topic.create("Pi chat font size changed", PiChatFontSizeListener::class.java)
        val ACCENT_COLOR_CHANGED = Topic.create("Pi accent color changed", PiAccentColorListener::class.java)
        val BACKGROUND_IMAGE_CHANGED = Topic.create("Pi background image changed", PiBackgroundImageListener::class.java)
        const val SHOW_PI_TOOL_WINDOW_ACTION_ID = "dev.pi.jetbrains.ShowPiToolWindow"
        const val NEW_PI_TAB_ACTION_ID = "dev.pi.jetbrains.NewPiTab"
        const val CLOSE_PI_TAB_ACTION_ID = "dev.pi.jetbrains.ClosePiTab"
        const val PREVIOUS_PI_TAB_ACTION_ID = "dev.pi.jetbrains.PreviousPiTab"
        const val NEXT_PI_TAB_ACTION_ID = "dev.pi.jetbrains.NextPiTab"
        const val SCROLL_PI_TO_LATEST_ACTION_ID = "dev.pi.jetbrains.ScrollPiToLatest"
        const val SCROLL_PI_TO_FIRST_ACTION_ID = "dev.pi.jetbrains.ScrollPiToFirst"
        const val SCROLL_PI_TO_PREVIOUS_USER_MESSAGE_ACTION_ID = "dev.pi.jetbrains.ScrollPiToPreviousUserMessage"
        const val SCROLL_PI_TO_NEXT_USER_MESSAGE_ACTION_ID = "dev.pi.jetbrains.ScrollPiToNextUserMessage"
        const val DEFAULT_PANEL_SHORTCUT = "ctrl alt pressed K"
        const val DEFAULT_NEW_TAB_SHORTCUT = "ctrl shift pressed O"
        const val DEFAULT_CLOSE_TAB_SHORTCUT = "ctrl pressed W"
        const val DEFAULT_PREVIOUS_TAB_SHORTCUT = "ctrl pressed PAGE_UP"
        const val DEFAULT_NEXT_TAB_SHORTCUT = "ctrl pressed PAGE_DOWN"
        const val DEFAULT_SCROLL_TO_LATEST_SHORTCUT = "ctrl pressed END"
        const val DEFAULT_SCROLL_TO_FIRST_SHORTCUT = "ctrl pressed HOME"
        const val DEFAULT_PREVIOUS_USER_MESSAGE_SHORTCUT = "ctrl pressed UP"
        const val DEFAULT_NEXT_USER_MESSAGE_SHORTCUT = "ctrl pressed DOWN"
        const val DEFAULT_CHAT_FONT_SIZE = 14
        const val MIN_CHAT_FONT_SIZE = 10
        const val MAX_CHAT_FONT_SIZE = 32
        const val DEFAULT_BACKGROUND_IMAGE_OPACITY = 15
        const val MIN_BACKGROUND_IMAGE_OPACITY = 0
        const val MAX_BACKGROUND_IMAGE_OPACITY = 100

        /** Parses a #RRGGBB accent color override; returns null for blank or invalid values. */
        fun parseAccentColor(value: String): java.awt.Color? = value.trim()
            .takeIf { it.isNotEmpty() }
            ?.let { raw -> runCatching { java.awt.Color.decode(raw) }.getOrNull() }

        private fun piAgentSettingsPath(): Path = Paths.get(
            System.getProperty("user.home") ?: ".",
            ".pi",
            "agent",
            "settings.json",
        )

        fun get(): PiSettings = service()
    }
}

private fun String.toKeyStroke(): javax.swing.KeyStroke? = takeIf { it.isNotBlank() }?.let(javax.swing.KeyStroke::getKeyStroke)

fun interface PiChatFontSizeListener {
    fun chatFontSizeChanged()
}

fun interface PiAccentColorListener {
    fun accentColorChanged()
}

fun interface PiBackgroundImageListener {
    fun backgroundImageChanged()
}
