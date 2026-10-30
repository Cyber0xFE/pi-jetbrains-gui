package dev.pi.jetbrains.runtime

import java.io.IOException
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit

/** Runs a short-lived helper command and returns its merged stdout, or null on failure. */
fun interface CommandRunner {
    fun run(command: List<String>): String?

    companion object {
        private val TIMEOUT_MS = TimeUnit.SECONDS.toMillis(10)

        val Default: CommandRunner = CommandRunner { command ->
            if (command.isEmpty()) return@CommandRunner null
            val effective = if (isWindowsBatch(command.first())) {
                // CreateProcess cannot execute .cmd/.bat directly.
                listOf("cmd.exe", "/c") + command
            } else {
                command
            }
            try {
                val process = ProcessBuilder(effective).redirectErrorStream(true).start()
                val output = process.inputStream.bufferedReader(StandardCharsets.UTF_8).use { it.readText() }
                if (!process.waitFor(TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
                    process.destroyForcibly()
                    null
                } else if (process.exitValue() != 0) {
                    null
                } else {
                    output.trim().ifEmpty { null }
                }
            } catch (e: IOException) {
                null
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                null
            }
        }

        private fun isWindowsBatch(program: String): Boolean =
            java.lang.System.getProperty("os.name").lowercase().contains("win") &&
                (program.endsWith(".cmd", true) || program.endsWith(".bat", true))
    }
}
