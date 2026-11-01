package dev.pi.jetbrains

import com.intellij.openapi.actionSystem.KeyboardShortcut
import com.intellij.openapi.keymap.ex.KeymapManagerEx
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.service

/** User-level runtime and approval settings for the pi integration. */
@Service(Service.Level.APP)
@State(name = "PiJetBrainsSettings", storages = [Storage("pi-jetbrains.xml")])
class PiSettings : PersistentStateComponent<PiSettings.State> {
    data class State(
        var nodePath: String = "",
        /** Retained for compatibility with existing settings files; no approval extension is loaded. */
        var approvalsEnabled: Boolean = false,
        var approveBash: Boolean = false,
        var approveWrite: Boolean = false,
        var taskCompletionSoundEnabled: Boolean = true,
        var logDirectory: String = "",
        var panelShortcut: String = "ctrl alt pressed K",
    )

    private var state = State()

    override fun getState(): State = state

    override fun loadState(loadedState: State) {
        state = loadedState
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
        const val SHOW_PI_TOOL_WINDOW_ACTION_ID = "dev.pi.jetbrains.ShowPiToolWindow"

        fun get(): PiSettings = service()
    }
}
