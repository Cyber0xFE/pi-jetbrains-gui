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

        val result = PiPackageResolver(bundledPackageDir = packageDir, runner = { null }).resolve()

        assertTrue(result is PiResolution.Found, "expected found, got $result")
        assertEquals(packageDir.resolve("dist/cli.js"), (result as PiResolution.Found).cliEntry)
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
