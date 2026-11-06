package dev.pi.jetbrains.runtime

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

class PiPackageResolverTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `prefers the configured entry`() {
        val configured = fakePackage(tempDir.resolve("configured"), "0.1.0").resolve("dist/bundle/cli.js")
        val bundled = fakePackage(tempDir.resolve("bundled"), "0.2.0")

        val result = PiPackageResolver(
            configuredEntry = configured,
            bundledPackageDir = bundled,
            managedAgentDir = tempDir.resolve("managed"),
            runner = { null },
        ).resolve()

        assertTrue(result is PiResolution.Found, "expected found, got $result")
        result as PiResolution.Found
        assertEquals(configured, result.cliEntry)
        assertEquals("configured", result.origin)
        assertEquals("0.1.0", result.version)
    }

    @Test
    fun `falls back to the bundled package`() {
        val bundledDir = fakePackage(tempDir.resolve("bundled"), "1.4.0")

        val result = PiPackageResolver(
            configuredEntry = tempDir.resolve("missing.js"),
            bundledPackageDir = bundledDir,
            managedAgentDir = tempDir.resolve("managed"),
            runner = { null },
        ).resolve()

        assertTrue(result is PiResolution.Found, "expected found, got $result")
        result as PiResolution.Found
        assertEquals(bundledDir.resolve("dist/bundle/cli.js"), result.cliEntry)
        assertEquals("bundled", result.origin)
        assertEquals("1.4.0", result.version)
    }

    @Test
    fun `falls back to the global npm root`() {
        val npmRoot = tempDir.resolve("npm-root")
        val packageDir = fakePackage(npmRoot.resolve(PiPackageResolver.PACKAGE_PATH), "1.2.3")

        val result = PiPackageResolver(
            managedAgentDir = tempDir.resolve("managed"),
            runner = { command ->
                require(command.contains("root")) { "unexpected command $command" }
                npmRoot.toString()
            },
        ).resolve()

        assertTrue(result is PiResolution.Found, "expected found, got $result")
        result as PiResolution.Found
        assertEquals(packageDir.resolve("dist/bundle/cli.js"), result.cliEntry)
        assertEquals("npm global", result.origin)
    }

    @Test
    fun `accepts the unbundled cli entry`() {
        val packageDir = tempDir.resolve("unbundled")
        Files.createDirectories(packageDir.resolve("dist"))
        Files.writeString(packageDir.resolve("dist/cli.js"), "")
        Files.writeString(packageDir.resolve("package.json"), """{"version":"1.0.0"}""")

        val result = PiPackageResolver(
            bundledPackageDir = packageDir,
            managedAgentDir = tempDir.resolve("managed"),
            runner = { null },
        ).resolve()

        assertTrue(result is PiResolution.Found, "expected found, got $result")
        assertEquals(packageDir.resolve("dist/cli.js"), (result as PiResolution.Found).cliEntry)
    }

    @Test
    fun `falls back to the managed install from the curl installer`() {
        val agentDir = tempDir.resolve("agent")
        val packageDir = fakePackage(
            agentDir.resolve("install/releases/1.5.0/node_modules").resolve(PiPackageResolver.PACKAGE_PATH),
            "1.5.0",
        )
        Files.writeString(agentDir.resolve("install/current-version"), "1.5.0\n")

        val result = PiPackageResolver(
            managedAgentDir = agentDir,
            runner = { null },
        ).resolve()

        assertTrue(result is PiResolution.Found, "expected found, got $result")
        result as PiResolution.Found
        assertEquals(packageDir.resolve("dist/bundle/cli.js"), result.cliEntry)
        assertEquals("pi managed install", result.origin)
        assertEquals("1.5.0", result.version)
    }

    @Test
    fun `prefers the current-version release over other managed releases`() {
        val agentDir = tempDir.resolve("agent")
        fakePackage(
            agentDir.resolve("install/releases/1.4.0/node_modules").resolve(PiPackageResolver.PACKAGE_PATH),
            "1.4.0",
        )
        val current = fakePackage(
            agentDir.resolve("install/releases/1.5.0/node_modules").resolve(PiPackageResolver.PACKAGE_PATH),
            "1.5.0",
        )
        Files.writeString(agentDir.resolve("install/current-version"), "1.5.0\n")

        val result = PiPackageResolver(
            managedAgentDir = agentDir,
            runner = { null },
        ).resolve()

        result as PiResolution.Found
        assertEquals(current.resolve("dist/bundle/cli.js"), result.cliEntry)
    }

    @Test
    fun `managed install falls back to the highest release without current-version`() {
        val agentDir = tempDir.resolve("agent")
        fakePackage(
            agentDir.resolve("install/releases/1.4.0/node_modules").resolve(PiPackageResolver.PACKAGE_PATH),
            "1.4.0",
        )
        val newest = fakePackage(
            agentDir.resolve("install/releases/1.10.0/node_modules").resolve(PiPackageResolver.PACKAGE_PATH),
            "1.10.0",
        )

        val result = PiPackageResolver(
            managedAgentDir = agentDir,
            runner = { null },
        ).resolve()

        result as PiResolution.Found
        assertEquals(newest.resolve("dist/bundle/cli.js"), result.cliEntry)
    }

    @Test
    fun `prefers the managed install over the npm global root`() {
        val agentDir = tempDir.resolve("agent")
        val managed = fakePackage(
            agentDir.resolve("install/releases/1.5.0/node_modules").resolve(PiPackageResolver.PACKAGE_PATH),
            "1.5.0",
        )
        Files.writeString(agentDir.resolve("install/current-version"), "1.5.0\n")

        val result = PiPackageResolver(
            managedAgentDir = agentDir,
            runner = { command ->
                require(command.contains("root")) { "unexpected command $command" }
                tempDir.resolve("npm-root").toString()
            },
        ).resolve()

        result as PiResolution.Found
        assertEquals(managed.resolve("dist/bundle/cli.js"), result.cliEntry)
        assertEquals("pi managed install", result.origin)
    }

    @Test
    fun `reports every failed lookup`() {
        val result = PiPackageResolver(
            configuredEntry = tempDir.resolve("missing.js"),
            runner = { null },
        ).resolve()

        assertTrue(result is PiResolution.NotFound, "expected not-found, got $result")
        val attempts = (result as PiResolution.NotFound).attempts
        assertTrue(attempts.any { it.contains("configured entry") }, attempts.toString())
        assertTrue(attempts.any { it.contains("managed install") }, attempts.toString())
        assertTrue(attempts.any { it.contains("npm root -g") }, attempts.toString())
    }

    private fun fakePackage(directory: Path, version: String): Path {
        val bundle = directory.resolve("dist/bundle")
        Files.createDirectories(bundle)
        Files.writeString(bundle.resolve("cli.js"), "")
        Files.writeString(directory.resolve("package.json"), """{"name":"pi","version":"$version"}""")
        return directory
    }
}
