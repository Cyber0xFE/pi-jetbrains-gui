package dev.pi.jetbrains.runtime

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

class NodeRuntimeResolverTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `uses a PATH node that satisfies the requirement`() {
        val node = executableIn(tempDir.resolve("path-node"), "node")
        val resolver = resolver(path = tempDir.resolve("path-node"), versions = mapOf(node to "v22.19.0"))

        val result = resolver.resolve()

        assertTrue(result is NodeResolution.Found, "expected a found runtime, got $result")
        result as NodeResolution.Found
        assertEquals(node, result.executable)
        assertEquals(SemanticVersion(22, 19, 0), result.version)
        assertEquals("PATH", result.origin)
    }

    @Test
    fun `rejects a node older than the minimum`() {
        val node = executableIn(tempDir.resolve("old-node"), "node")
        val resolver = resolver(path = tempDir.resolve("old-node"), versions = mapOf(node to "v20.11.0"))

        val result = resolver.resolve()

        assertTrue(result is NodeResolution.NotFound, "expected not-found, got $result")
        val reason = (result as NodeResolution.NotFound).reason
        assertTrue(reason.contains("20.11.0"), reason)
        assertTrue(reason.contains("22.19.0"), reason)
    }

    @Test
    fun `falls back to the standalone node from the pi installer`() {
        val standalone = executableIn(tempDir.resolve("pi-node/current/bin"), "node")
        val resolver = NodeRuntimeResolver(
            pathEnv = tempDir.resolve("empty").toString(),
            piStandaloneNode = standalone,
            runner = fakeRunner(mapOf(standalone to "v24.3.0")),
        )

        val result = resolver.resolve()

        assertTrue(result is NodeResolution.Found, "expected a found runtime, got $result")
        result as NodeResolution.Found
        assertEquals(standalone, result.executable)
        assertEquals("pi standalone", result.origin)
    }

    @Test
    fun `prefers a PATH node over the standalone node`() {
        val pathNode = executableIn(tempDir.resolve("path-node"), "node")
        val standalone = executableIn(tempDir.resolve("pi-node/current/bin"), "node")
        val resolver = NodeRuntimeResolver(
            pathEnv = tempDir.resolve("path-node").toString(),
            piStandaloneNode = standalone,
            runner = fakeRunner(mapOf(pathNode to "v22.19.0", standalone to "v24.3.0")),
        )

        val result = resolver.resolve()

        result as NodeResolution.Found
        assertEquals(pathNode, result.executable)
        assertEquals("PATH", result.origin)
    }

    @Test
    fun `falls back to the bundled node`() {
        val pathNode = executableIn(tempDir.resolve("path-node"), "node")
        val bundled = executableIn(tempDir.resolve("bundled-node"), "node")
        val resolver = NodeRuntimeResolver(
            pathEnv = tempDir.resolve("path-node").toString(),
            piStandaloneNode = tempDir.resolve("missing").resolve("node"),
            bundledNode = bundled,
            runner = fakeRunner(mapOf(pathNode to "v18.0.0", bundled to "v24.1.0")),
        )

        val result = resolver.resolve()

        assertTrue(result is NodeResolution.Found, "expected a found runtime, got $result")
        result as NodeResolution.Found
        assertEquals(bundled, result.executable)
        assertEquals("bundled", result.origin)
    }

    @Test
    fun `reports when nothing usable exists`() {
        val result = NodeRuntimeResolver(
            pathEnv = tempDir.resolve("empty").toString(),
            piStandaloneNode = tempDir.resolve("missing").resolve("node"),
            runner = fakeRunner(emptyMap()),
        ).resolve()

        assertTrue(result is NodeResolution.NotFound, "expected not-found, got $result")
        assertTrue((result as NodeResolution.NotFound).reason.contains("Node.js >= 22.19.0"))
    }

    @Test
    fun `parses and compares semantic versions`() {
        assertEquals(SemanticVersion(22, 19, 1), SemanticVersion.parse("v22.19.1\n"))
        assertEquals(null, SemanticVersion.parse("not a version"))
        assertTrue(SemanticVersion.parse("22.19.0")!! < SemanticVersion.parse("22.20.0")!!)
        assertTrue(SemanticVersion.parse("23.0.0")!! > SemanticVersion.parse("22.99.99")!!)
    }

    private fun resolver(path: Path, versions: Map<Path, String>): NodeRuntimeResolver =
        NodeRuntimeResolver(
            pathEnv = path.toString(),
            runner = fakeRunner(versions),
        )

    private fun fakeRunner(versions: Map<Path, String>): CommandRunner =
        CommandRunner { command ->
            versions[Path.of(command.first())]
        }

    private fun executableIn(directory: Path, name: String): Path {
        Files.createDirectories(directory)
        return Files.writeString(directory.resolve(name), "")
    }
}
