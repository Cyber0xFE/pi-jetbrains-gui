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
 * Order: explicit configuration, a copy bundled with the plugin, the managed
 * install created by the pi.dev curl installer, then the global npm root.
 * When `npm` is not reachable through PATH (for example a stale IDE process
 * environment), it is retried from the directory of the resolved node binary.
 * The CLI entry is `dist/bundle/cli.js` with a fallback to the unbundled `dist/cli.js`.
 */
class PiPackageResolver(
    private val configuredEntry: Path? = null,
    private val bundledPackageDir: Path? = null,
    private val managedAgentDir: Path? = defaultManagedAgentDir(),
    private val nodeExecutable: Path? = null,
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

        managedAgentDir?.let { agentDir ->
            fromManagedInstall(agentDir)?.let { return it }
            attempts += "pi managed install $agentDir has no usable release"
        }

        var npmRoot: String? = null
        for (command in npmRootCommands()) {
            npmRoot = runner.run(command)
            if (npmRoot != null) break
        }
        if (npmRoot == null) {
            attempts += "'npm root -g' failed"
        } else {
            val packageDir = Paths.get(npmRoot).resolve(PACKAGE_PATH)
            fromPackageDir(packageDir, "npm global")?.let { return it }
            attempts += "npm global package $packageDir does not contain dist/bundle/cli.js or dist/cli.js"
        }

        return PiResolution.NotFound(attempts)
    }

    private fun npmRootCommands(): List<List<String>> {
        val windows = System.getProperty("os.name").lowercase().contains("win")
        val npmBinary = if (windows) "npm.cmd" else "npm"
        val commands = mutableListOf(listOf(npmBinary, "root", "-g"))
        nodeExecutable?.parent?.let { nodeDir ->
            commands += listOf(nodeDir.resolve(npmBinary).toString(), "root", "-g")
        }
        return commands.distinct()
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

    /**
     * Layout written by the pi.dev curl installer: `<agentDir>/install/current-version`
     * names the active release under `<agentDir>/install/releases/`, and each release
     * holds the npm package under `node_modules/`.
     */
    private fun fromManagedInstall(agentDir: Path): PiResolution.Found? {
        val installDir = agentDir.resolve("install")
        val releasesDir = installDir.resolve("releases")
        if (!Files.isDirectory(releasesDir)) return null

        val packageDirs = mutableListOf<Path>()
        val currentVersionFile = installDir.resolve("current-version")
        val currentVersion = if (Files.isRegularFile(currentVersionFile)) {
            runCatching { Files.readString(currentVersionFile) }.getOrNull()?.trim().orEmpty()
        } else {
            ""
        }
        if (currentVersion.isNotEmpty()) {
            packageDirs.add(releasesDir.resolve(currentVersion).resolve("node_modules").resolve(PACKAGE_PATH))
        }
        // Fall back to the highest known release when current-version is missing or stale.
        val fallbackDirs: List<Path> = runCatching {
            Files.list(releasesDir).use { entries ->
                entries.filter { Files.isDirectory(it) }
                    .map { it.fileName.toString() }
                    .toList()
            }
        }.getOrDefault(emptyList())
            .sortedWith(compareByDescending { SemanticVersion.parse(it) ?: SemanticVersion(0, 0, 0) })
            .map { releasesDir.resolve(it).resolve("node_modules").resolve(PACKAGE_PATH) }
        packageDirs.addAll(fallbackDirs)

        return packageDirs.distinct().firstNotNullOfOrNull { fromPackageDir(it, "pi managed install") }
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

        /** Agent directory used by the pi.dev curl installer (overridable via `PI_CODING_AGENT_DIR`). */
        fun defaultManagedAgentDir(): Path? {
            val custom = System.getenv("PI_CODING_AGENT_DIR")?.trim().orEmpty()
            if (custom.isEmpty()) return defaultHomeAgentDir()
            return runCatching { Paths.get(custom) }.getOrNull()
        }

        private fun defaultHomeAgentDir(): Path? {
            val home = System.getProperty("user.home")?.takeIf { it.isNotBlank() } ?: return null
            return Paths.get(home, ".pi", "agent")
        }
    }
}
