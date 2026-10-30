package dev.pi.jetbrains.runtime

import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

sealed interface PiResolution {
    data class Found(
        val cliEntry: Path,
        val packageDir: Path,
        val version: String?,
        val origin: String,
    ) : PiResolution

    data class NotFound(val attempts: List<String>) : PiResolution
}

/**
 * Locates the pi coding-agent distribution (plan M0 task 3).
 *
 * Order: explicit configuration, a copy bundled with the plugin, then the global npm root.
 * The CLI entry is `dist/bundle/cli.js` with a fallback to the unbundled `dist/cli.js`.
 */
class PiPackageResolver(
    private val configuredEntry: Path? = null,
    private val bundledPackageDir: Path? = null,
    private val runner: CommandRunner = CommandRunner.Default,
) {
    fun resolve(): PiResolution {
        val attempts = mutableListOf<String>()

        configuredEntry?.let { entry ->
            fromEntry(entry, "configured")?.let { return it }
            attempts += "configured entry $entry does not exist"
        }

        bundledPackageDir?.let { dir ->
            fromPackageDir(dir, "bundled")?.let { return it }
            attempts += "bundled package $dir does not contain dist/bundle/cli.js or dist/cli.js"
        }

        val npmRoot = runner.run(npmRootCommand())
        if (npmRoot == null) {
            attempts += "'npm root -g' failed"
        } else {
            val packageDir = Paths.get(npmRoot).resolve(PACKAGE_PATH)
            fromPackageDir(packageDir, "npm global")?.let { return it }
            attempts += "npm global package $packageDir does not contain dist/bundle/cli.js or dist/cli.js"
        }

        return PiResolution.NotFound(attempts)
    }

    private fun npmRootCommand(): List<String> =
        if (System.getProperty("os.name").lowercase().contains("win")) {
            listOf("npm.cmd", "root", "-g")
        } else {
            listOf("npm", "root", "-g")
        }

    private fun fromEntry(entry: Path, origin: String): PiResolution.Found? {
        if (!Files.isRegularFile(entry)) return null
        val packageDir = entry.parent?.parent?.parent ?: entry.parent ?: return null
        return PiResolution.Found(entry, packageDir, readVersion(packageDir), origin)
    }

    private fun fromPackageDir(dir: Path, origin: String): PiResolution.Found? {
        val candidates = listOf(dir.resolve("dist/bundle/cli.js"), dir.resolve("dist/cli.js"))
        val entry = candidates.firstOrNull { Files.isRegularFile(it) } ?: return null
        return PiResolution.Found(entry, dir, readVersion(dir), origin)
    }

    private fun readVersion(packageDir: Path): String? {
        val packageJson = packageDir.resolve("package.json")
        if (!Files.isRegularFile(packageJson)) return null
        val text = runCatching { Files.readString(packageJson) }.getOrNull() ?: return null
        return VERSION_PATTERN.find(text)?.groupValues?.get(1)
    }

    companion object {
        const val PACKAGE_PATH: String = "@earendil-works/pi-coding-agent"
        private val VERSION_PATTERN = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"")
    }
}
