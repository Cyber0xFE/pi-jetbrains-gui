package dev.pi.jetbrains

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
        var logDirectory: String = "",
    )

    private var state = State()

    override fun getState(): State = state

    override fun loadState(loadedState: State) {
        state = loadedState
    }

    companion object {
        fun get(): PiSettings = service()
    }
}
