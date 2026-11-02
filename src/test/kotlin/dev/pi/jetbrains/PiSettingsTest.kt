package dev.pi.jetbrains

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PiSettingsTest {
    @Test
    fun `default and blank proxy preserve inherited environment`() {
        val settings = PiSettings()
        assertTrue(settings.processEnvironment().isEmpty())
        assertEquals(PiSettings.DEFAULT_CHAT_FONT_SIZE, settings.getState().chatFontSize)
        assertEquals(PiSettings.DEFAULT_NEW_TAB_SHORTCUT, settings.getState().newTabShortcut)
        assertEquals(PiSettings.DEFAULT_CLOSE_TAB_SHORTCUT, settings.getState().closeTabShortcut)
        assertEquals(PiSettings.DEFAULT_PREVIOUS_TAB_SHORTCUT, settings.getState().previousTabShortcut)
        assertEquals(PiSettings.DEFAULT_NEXT_TAB_SHORTCUT, settings.getState().nextTabShortcut)

        settings.getState().networkProxy = "   "
        assertTrue(settings.processEnvironment().isEmpty())
    }

    @Test
    fun `configured proxy sets both standard variables and trims whitespace`() {
        val settings = PiSettings()
        settings.getState().networkProxy = "  http://127.0.0.1:7890  "

        assertEquals(
            mapOf("HTTP_PROXY" to "http://127.0.0.1:7890", "HTTPS_PROXY" to "http://127.0.0.1:7890"),
            settings.processEnvironment(),
        )
    }

    @Test
    fun `disabled proxy does not override inherited environment`() {
        val settings = PiSettings()
        settings.getState().networkProxy = "http://127.0.0.1:7890"
        settings.getState().networkProxyEnabled = false

        assertTrue(settings.processEnvironment().isEmpty())
    }

    @Test
    fun `loaded settings restore proxy and clearing removes overrides`() {
        val settings = PiSettings()
        settings.loadState(PiSettings.State(networkProxy = "http://localhost:8080"))
        assertEquals("http://localhost:8080", settings.processEnvironment()["HTTPS_PROXY"])

        settings.getState().networkProxy = ""
        assertTrue(settings.processEnvironment().isEmpty())
    }
}
