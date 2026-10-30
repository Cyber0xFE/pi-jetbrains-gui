package dev.pi.jetbrains.runtime

import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

/** `major.minor.patch` extracted from `node -v` style output. */
data class SemanticVersion(val major: Int, val minor: Int, val patch: Int) : Comparable<SemanticVersion> {
    override fun compareTo(other: SemanticVersion): Int =
        compareValuesBy(this, other, { it.major }, { it.minor }, { it.patch })

    override fun toString(): String = "$major.$minor.$patch"

    companion object {
        private val PATTERN = Regex("""(\d+)\.(\d+)\.(\d+)""")

        fun parse(text: String?): SemanticVersion? {
            val match = PATTERN.find(text ?: return null) ?: return null
            val (major, minor, patch) = match.destructured
            return SemanticVersion(major.toInt(), minor.toInt(), patch.toInt())
        }
    }
}

sealed interface NodeResolution {
    data class Found(val executable: Path, val version: SemanticVersion, val origin: String) : NodeResolution

    data class NotFound(val reason: String) : NodeResolution
}

/**
 * Locates a Node.js binary that satisfies pi's `engines` requirement (plan 7.1).
 *
 * Order: every `node`/`node.exe` on `PATH`, then the optional binary bundled with the plugin.
 */
class NodeRuntimeResolver(
    private val minVersion: SemanticVersion = SemanticVersion(22, 19, 0),
    private val pathEnv: String? = System.getenv("PATH"),
    private val bundledNode: Path? = null,
    private val runner: CommandRunner = CommandRunner.Default,
) {
    fun resolve(): NodeResolution {
        val attempts = mutableListOf<String>()
        val candidates = pathCandidates() + listOfNotNull(bundledNode?.let { Candidate(it, "bundled") })

        for (candidate in candidates.distinctBy { it.executable.toAbsolutePath().normalize() }) {
            val raw = runner.run(listOf(candidate.executable.toString(), "-v"))
            val version = SemanticVersion.parse(raw)
            if (version == null) {
                attempts += "${candidate.executable} (${candidate.origin}): unusable version output '$raw'"
                continue
            }
            if (version < minVersion) {
                attempts += "${candidate.executable} (${candidate.origin}): node $version is older than $minVersion"
                continue
            }
            return NodeResolution.Found(candidate.executable, version, candidate.origin)
        }

        val detail = if (attempts.isEmpty()) "no node binary found on PATH or in the plugin" else attempts.joinToString("; ")
        return NodeResolution.NotFound("Node.js >= $minVersion is required: $detail")
    }

    private fun pathCandidates(): List<Candidate> {
        val entries = pathEnv?.split(java.io.File.pathSeparator)
            ?.filter { it.isNotBlank() }
            ?: return emptyList()
        return entries.flatMap { entry ->
            val dir = runCatching { Paths.get(entry) }.getOrNull() ?: return@flatMap emptyList()
            listOf("node", "node.exe")
                .map { dir.resolve(it) }
                .filter { Files.isRegularFile(it) }
                .map { Candidate(it, "PATH") }
        }
    }

    private data class Candidate(val executable: Path, val origin: String)
}
