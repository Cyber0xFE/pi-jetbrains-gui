package dev.pi.jetbrains.ui

import com.intellij.openapi.application.ApplicationInfo
import com.intellij.openapi.diagnostic.Logger
import com.intellij.ui.jcef.JBCefAppRequiredArgumentsProvider
import com.intellij.openapi.components.ApplicationComponent

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
    private const val REMOTE_PROPERTY = "jcef.remote.enabled"
    private const val OUT_OF_PROCESS_PROPERTY = "ide.browser.jcef.out-of-process.enabled"
    private val LOG = Logger.getInstance(JcefCompatibility::class.java)

    fun apply() {
        if (!isAffectedIde()) return

        System.setProperty(REMOTE_PROPERTY, "false")
        System.setProperty(OUT_OF_PROCESS_PROPERTY, "false")
        val extraArgs = System.getProperty("ide.browser.jcef.extra.args").orEmpty()
        if (GPU_COMPOSITING_ARGUMENT !in extraArgs.split(',')) {
            System.setProperty(
                "ide.browser.jcef.extra.args",
                listOf(extraArgs.trim(), GPU_COMPOSITING_ARGUMENT)
                    .filter { it.isNotEmpty() }
                    .joinToString(","),
            )
        }
        LOG.info(
            "Applied JCEF compatibility settings: " +
                "remote=${System.getProperty(REMOTE_PROPERTY)}, " +
                "outOfProcess=${System.getProperty(OUT_OF_PROCESS_PROPERTY)}",
        )
    }

    fun requiredArguments(): List<String> {
        if (!isAffectedIde()) return emptyList()
        apply()
        return listOf(GPU_COMPOSITING_ARGUMENT)
    }

    private fun isAffectedIde(): Boolean =
        runCatching { ApplicationInfo.getInstance().build.baselineVersion >= MINIMUM_BASELINE }.getOrDefault(false)
}

class JcefCompatibilityApplicationComponent : ApplicationComponent {
    override fun initComponent() {
        JcefCompatibility.apply()
    }
}

class PiJcefRequiredArgumentsProvider : JBCefAppRequiredArgumentsProvider {
    override val options: List<String>
        get() = JcefCompatibility.requiredArguments()
}
