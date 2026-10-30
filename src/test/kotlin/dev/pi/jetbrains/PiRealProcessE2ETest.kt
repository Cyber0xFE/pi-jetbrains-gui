package dev.pi.jetbrains

import dev.pi.jetbrains.rpc.PiClient
import dev.pi.jetbrains.rpc.PiProcess
import dev.pi.jetbrains.rpc.RpcCommand
import dev.pi.jetbrains.rpc.sessionState
import dev.pi.jetbrains.runtime.NodeResolution
import dev.pi.jetbrains.runtime.NodeRuntimeResolver
import dev.pi.jetbrains.runtime.PiPackageResolver
import dev.pi.jetbrains.runtime.PiResolution
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test
import java.nio.file.Paths
import java.time.Duration

/**
 * M0 acceptance check against the pi installation on this machine.
 *
 * Skipped unless `PI_JETBRAINS_E2E=1`, so CI never needs a provider or a logged-in account.
 */
class PiRealProcessE2ETest {
    @Test
    fun `get_state returns a session id and model from the real pi`() = runBlocking {
        assumeTrue(System.getenv("PI_JETBRAINS_E2E") == "1", "set PI_JETBRAINS_E2E=1 to run")

        val node = NodeRuntimeResolver().resolve()
        assumeTrue(node is NodeResolution.Found, "no usable node: $node")
        val installation = PiPackageResolver().resolve()
        assumeTrue(installation is PiResolution.Found, "no pi installation: $installation")

        val command = listOf(
            (node as NodeResolution.Found).executable.toString(),
            (installation as PiResolution.Found).cliEntry.toString(),
            "--mode", "rpc", "--no-session",
        )
        val client = PiClient(
            process = PiProcess(command, Paths.get(System.getProperty("user.dir"))),
            log = { println("[pi] $it") },
            requestTimeout = Duration.ofSeconds(60),
        )
        try {
            assertTrue(client.start(), "failed to start pi")
            val response = withTimeout(60_000) { client.send(RpcCommand(type = "get_state")).await() }

            assertTrue(response.success, "get_state failed: ${response.error}")
            val state = response.sessionState()
            assertTrue(!state?.sessionId.isNullOrBlank(), "missing sessionId: $state")
            assertTrue(!state?.model?.id.isNullOrBlank(), "missing model: $state")
            println("get_state -> sessionId=${state?.sessionId} model=${state?.model?.id} thinking=${state?.thinkingLevel}")
        } finally {
            client.close()
        }
    }
}
