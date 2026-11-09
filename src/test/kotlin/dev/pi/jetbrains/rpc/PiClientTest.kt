package dev.pi.jetbrains.rpc

import dev.pi.jetbrains.PiSettings
import dev.pi.jetbrains.runtime.CommandRunner
import dev.pi.jetbrains.session.SessionTree
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration
import kotlin.test.assertFailsWith

/** Drives [PiClient] against a scripted node process; no LLM involved (plan 9.3). */
class PiClientTest {
    @TempDir
    lateinit var tempDir: Path

    private val clients = mutableListOf<PiClient>()

    @BeforeEach
    fun requireNode() {
        assumeTrue(hasNode(), "node is required to run the fake pi harness")
    }

    @AfterEach
    fun tearDown() {
        clients.forEach { it.close() }
        clients.clear()
    }

    @Test
    fun `correlates a get_state response by id`() = runBlocking {
        val client = startClient()

        val response = withTimeout(TIMEOUT_MS) { client.send(RpcCommand(type = "get_state")).await() }

        assertTrue(response.success, "response was $response")
        assertEquals("get_state", response.command)
        assertEquals("req-1", response.id)
        val state = response.sessionState()
        assertEquals("fake-session", state?.sessionId)
        assertEquals("fake-model", state?.model?.id)
        assertEquals("high", state?.thinkingLevel)
    }

    @Test
    fun `injects proxy settings into the child and replacement processes`() = runBlocking {
        val settings = PiSettings()
        for (proxy in listOf("http://127.0.0.1:7890", "http://localhost:8080", "")) {
            settings.getState().networkProxy = proxy
            val client = startClient(environment = settings.processEnvironment())
            val response = withTimeout(TIMEOUT_MS) {
                client.send(RpcCommand(type = "get_proxy_environment")).await()
            }
            assertTrue(response.success)
            val environment = response.data as JsonObject
            assertEquals(proxy.ifEmpty { System.getenv("HTTP_PROXY") }, environment.string("HTTP_PROXY"))
            assertEquals(proxy.ifEmpty { System.getenv("HTTPS_PROXY") }, environment.string("HTTPS_PROXY"))
            client.close()
        }
    }

    @Test
    fun `delivers session events and ignores malformed records`() = runBlocking {
        val client = startClient()
        val started = async(start = CoroutineStart.UNDISPATCHED) {
            client.events.filterIsInstance<PiEvent.Session>().first { it.type == "message_start" }
        }

        val response = withTimeout(TIMEOUT_MS) {
            client.send(RpcCommand(type = "echo", message = "hello")).await()
        }

        assertTrue(response.success, "response was $response")
        val event = withTimeout(TIMEOUT_MS) { started.await() }
        assertEquals("user", event.payload.message()?.string("role"))
        assertEquals("hello", event.payload.message()?.string("content"))
    }

    @Test
    fun `keeps unicode line separators inside a record`() = runBlocking {
        val client = startClient()
        val started = async(start = CoroutineStart.UNDISPATCHED) {
            client.events.filterIsInstance<PiEvent.Session>().first { it.type == "message_start" }
        }

        client.send(RpcCommand(type = "unicode_separator")).await()

        val event = withTimeout(TIMEOUT_MS) { started.await() }
        assertEquals("a\u2028b\u2029c", event.payload.message()?.string("content"))
    }

    @Test
    fun `surfaces unknown commands as failed responses`() = runBlocking {
        val client = startClient()

        val response = withTimeout(TIMEOUT_MS) { client.send(RpcCommand(type = "nope")).await() }

        assertEquals(false, response.success)
        assertTrue(response.error.orEmpty().contains("unknown command"), response.error)
    }

    @Test
    fun `clears the queues and reports the messages handed back for editing`() = runBlocking {
        val client = startClient()

        val response = withTimeout(TIMEOUT_MS) { client.send(RpcCommand(type = "clear_queue")).await() }

        assertTrue(response.success, "response was $response")
        val cleared = response.decodeDataAs<RpcClearQueueResult>()
        assertEquals(listOf("first steer"), cleared?.steering)
        assertEquals(listOf("then run the suite"), cleared?.followUp)
    }

    @Test
    fun `times out a command that is never answered`() = runBlocking {
        val client = startClient()

        val deferred = client.send(RpcCommand(type = "hang"), timeout = Duration.ofMillis(300))

        val failure = assertFailsWith<PiRequestTimeoutException> {
            withTimeout(TIMEOUT_MS) { deferred.await() }
        }
        assertEquals("hang", failure.commandType)
    }

    @Test
    fun `fails pending requests when the process exits`() = runBlocking {
        val client = startClient()

        val hanging = client.send(RpcCommand(type = "hang"), timeout = Duration.ofMinutes(5))
        client.send(RpcCommand(type = "die"))

        val failure = assertFailsWith<PiProcessExitedException> {
            withTimeout(TIMEOUT_MS) { hanging.await() }
        }
        assertEquals(7, failure.exitCode)
    }

    @Test
    fun `stop terminates the child process and reports the exit`() = runBlocking {
        val exited = CompletableDeferred<Int?>()
        val client = startClient(onExit = { exited.complete(it) })

        client.stop()

        withTimeout(TIMEOUT_MS) { exited.await() }
        assertEquals(false, client.running.value)
    }

    @Test
    fun `parallel task clients isolate events and closing one leaves the other running`() = runBlocking {
        val first = startClient()
        val second = startClient()
        val firstMessage = async(start = CoroutineStart.UNDISPATCHED) {
            first.events.filterIsInstance<PiEvent.Session>().first { it.type == "message_start" }
        }
        val secondMessage = async(start = CoroutineStart.UNDISPATCHED) {
            second.events.filterIsInstance<PiEvent.Session>().first { it.type == "message_start" }
        }

        val firstRequest = first.send(RpcCommand(type = "echo", message = "task one"))
        val secondRequest = second.send(RpcCommand(type = "echo", message = "task two"))
        withTimeout(TIMEOUT_MS) {
            assertTrue(firstRequest.await().success)
            assertTrue(secondRequest.await().success)
            assertEquals("task one", firstMessage.await().payload.message()?.string("content"))
            assertEquals("task two", secondMessage.await().payload.message()?.string("content"))
        }

        val pending = first.send(RpcCommand(type = "hang"), timeout = Duration.ofMinutes(5))
        first.close()
        assertFailsWith<PiProcessExitedException> { withTimeout(TIMEOUT_MS) { pending.await() } }
        assertTrue(second.running.value)
        assertTrue(withTimeout(TIMEOUT_MS) { second.send(RpcCommand(type = "get_state")).await().success })
    }

    @Test
    fun `decodes M3 model, thinking, command and tree payloads`() = runBlocking {
        val client = startClient()

        val models = client.send(RpcCommand(type = "get_available_models"))
            .await().decodeDataAs<RpcModelsData>()
        assertEquals(listOf("fake-model", "other-model"), models?.models?.map { it.id })
        assertEquals(true, models?.models?.first()?.reasoning)

        val levels = client.send(RpcCommand(type = "get_available_thinking_levels"))
            .await().decodeDataAs<RpcThinkingLevelsData>()
        assertEquals(listOf("off", "low", "high"), levels?.levels)

        val commands = client.send(RpcCommand(type = "get_commands"))
            .await().decodeDataAs<RpcCommandsData>()
        assertEquals(listOf("review", "skill:draw"), commands?.commands?.map { it.name })
        assertEquals("skill", commands?.commands?.last()?.source)

        val treeResponse = client.send(RpcCommand(type = "get_tree")).await()
        val treeData = treeResponse.data as JsonObject
        val leafId = (treeData["leafId"] as? JsonPrimitive)?.contentOrNull
        assertEquals("entry-2", leafId)
        val rows = SessionTree.flatten(treeData, leafId)
        assertEquals(listOf("entry-1"), rows.map { it.id })
        assertEquals("user: hi", rows.first().text)
        assertTrue(rows.first().forkable)
        assertTrue(rows.single().active, "the visible user ancestor stays on the active branch")

        val cancelled = client.send(RpcCommand(type = "switch_session", sessionPath = "cancel-me"))
            .await().decodeDataAs<RpcSwitchResult>()
        assertEquals(true, cancelled?.cancelled)

        val fork = client.send(RpcCommand(type = "fork", entryId = "entry-1"))
            .await().decodeDataAs<RpcForkResult>()
        assertEquals("original prompt", fork?.text)
        assertEquals(false, fork?.cancelled)

        val renamed = client.send(RpcCommand(type = "set_session_name", name = "my session"))
            .await()
        assertTrue(renamed.success)
    }

    private fun startClient(
        onExit: (Int?) -> Unit = {},
        requestTimeout: Duration = Duration.ofSeconds(30),
        environment: Map<String, String> = emptyMap(),
    ): PiClient {
        val script = copyScript()
        val process = PiProcess(
            command = listOf("node", script.toString()),
            workDir = tempDir,
            environment = environment,
            log = { println("[fake-pi] $it") },
        )
        val created = PiClient(
            process = process,
            log = { println("[client] $it") },
            requestTimeout = requestTimeout,
            onExit = onExit,
        )
        assertTrue(created.start(), "failed to start the fake pi process")
        clients.add(created)
        return created
    }

    private fun copyScript(): Path {
        val target = tempDir.resolve("fake-pi.mjs")
        if (Files.exists(target)) return target
        val resource = checkNotNull(javaClass.getResourceAsStream("/fake-pi/fake-pi.mjs")) {
            "fake-pi.mjs test resource is missing"
        }
        resource.use { Files.copy(it, target) }
        return target
    }

    private fun hasNode(): Boolean = CommandRunner.Default.run(listOf("node", "-v")) != null

    private fun JsonObject.message(): JsonObject? = this["message"] as? JsonObject

    private fun JsonObject.string(key: String): String? =
        (this[key] as? JsonPrimitive)?.contentOrNull

    private companion object {
        const val TIMEOUT_MS = 15_000L
    }
}
