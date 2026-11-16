package dev.pi.jetbrains.ui

import com.intellij.openapi.application.ApplicationInfo
import com.intellij.openapi.diagnostic.Logger
import com.intellij.ui.jcef.JBCefAppRequiredArgumentsProvider

/**
 * Applies the JCEF rendering workaround before the first browser is initialized.
 *
 * IDEA 2025+ may enable JCEF remote/OSR rendering depending on the bundled JCEF version.
 * The provider is invoked while JCEF assembles its Chromium arguments, including when another
 * plugin initializes JCEF before the Pi tool window is opened.
 */
object JcefCompatibility {
    private const val MINIMUM_BASELINE = 251
    private const val GPU_COMPOSITING_ARGUMENT = "--disable-gpu-compositing"
    private val LOG = Logger.getInstance(JcefCompatibility::class.java)

    fun apply() {
        if (!isAffectedIde()) return

        if (System.getProperty("jcef.remote.enabled") == null) {
            System.setProperty("jcef.remote.enabled", "false")
        }
        val extraArgs = System.getProperty("ide.browser.jcef.extra.args").orEmpty()
        if (GPU_COMPOSITING_ARGUMENT !in extraArgs.split(',')) {
            System.setProperty(
                "ide.browser.jcef.extra.args",
                listOf(extraArgs.trim(), GPU_COMPOSITING_ARGUMENT)
                    .filter { it.isNotEmpty() }
                    .joinToString(","),
            )
        }
        LOG.info("Applied JCEF compatibility settings: remote=${System.getProperty("jcef.remote.enabled")}")
    }

    fun requiredArguments(): List<String> {
        if (!isAffectedIde()) return emptyList()
        apply()
        return listOf(GPU_COMPOSITING_ARGUMENT)
    }

    private fun isAffectedIde(): Boolean =
        runCatching { ApplicationInfo.getInstance().build.baselineVersion >= MINIMUM_BASELINE }.getOrDefault(false)
}

class PiJcefRequiredArgumentsProvider : JBCefAppRequiredArgumentsProvider {
    override val options: List<String>
        get() = JcefCompatibility.requiredArguments()
}
