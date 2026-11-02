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
        var logDirectory: String = "",
        var panelShortcut: String = "ctrl alt pressed K",
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

    fun applyPanelShortcut() {
        val requestedStroke = state.panelShortcut.takeIf { it.isNotBlank() }
            ?.let { javax.swing.KeyStroke.getKeyStroke(it) }
        val isDefaultShortcut = requestedStroke == javax.swing.KeyStroke.getKeyStroke("ctrl alt pressed K")
        val manager = KeymapManagerEx.getInstanceEx()
        var keymap = manager.activeKeymap
        if (!keymap.canModify()) {
            if (isDefaultShortcut) return
            keymap = manager.getKeymap("Pi JetBrains GUI") ?: keymap.deriveKeymap("Pi JetBrains GUI").also {
                manager.schemeManager.addScheme(it)
            }
            manager.setActiveKeymap(keymap)
        }
        keymap.removeAllActionShortcuts(SHOW_PI_TOOL_WINDOW_ACTION_ID)
        if (requestedStroke != null) {
            keymap.addShortcut(SHOW_PI_TOOL_WINDOW_ACTION_ID, KeyboardShortcut(requestedStroke, null))
        }
    }

    companion object {
        val NETWORK_PROXY_CHANGED = Topic.create("Pi network proxy changed", PiNetworkProxyListener::class.java)
        const val SHOW_PI_TOOL_WINDOW_ACTION_ID = "dev.pi.jetbrains.ShowPiToolWindow"

        private fun piAgentSettingsPath(): Path = Paths.get(
            System.getProperty("user.home") ?: ".",
            ".pi",
            "agent",
            "settings.json",
        )

        fun get(): PiSettings = service()
    }
}
