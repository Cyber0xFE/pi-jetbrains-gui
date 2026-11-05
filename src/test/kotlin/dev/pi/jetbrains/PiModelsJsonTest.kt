package dev.pi.jetbrains

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

class PiModelsJsonTest {
    @TempDir
    lateinit var tempDir: Path

    private fun modelsPath(): Path = tempDir.resolve(".pi").resolve("agent").resolve("models.json")

    @Test
    fun `appends a model to an existing provider without touching its fields`() {
        Files.createDirectories(modelsPath().parent)
        Files.writeString(
            modelsPath(),
            """
            {
              "providers": {
                "agent-plan": {
                  "api": "openai-completions",
                  "apiKey": "existing-key",
                  "baseUrl": "https://example.invalid/v1",
                  "models": [{"id": "glm-5.3", "reasoning": true}]
                }
              }
            }
            """.trimIndent(),
        )

        val error = PiModelsJson.addModel(
            provider = "agent-plan",
            api = "anthropic-messages",
            baseUrl = "https://other.invalid/v1",
            apiKey = "new-key",
            modelId = "glm-6",
            name = "GLM 6",
            contextWindow = 524288,
            maxTokens = 128000,
            reasoning = true,
            input = listOf("text", "image"),
            homeDir = tempDir,
        )

        assertNull(error)
        val root = PiModelsJson.read(modelsPath())
        val provider = root["providers"]?.jsonObject?.get("agent-plan")?.jsonObject
        assertNotNull(provider)
        assertEquals("openai-completions", provider?.get("api")?.jsonPrimitive?.content)
        assertEquals("existing-key", provider?.get("apiKey")?.jsonPrimitive?.content)
        assertEquals("https://example.invalid/v1", provider?.get("baseUrl")?.jsonPrimitive?.content)
        val models = provider?.get("models") as? JsonArray
        assertEquals(2, models?.size)
        val added = models?.last()?.jsonObject
        assertEquals("glm-6", added?.get("id")?.jsonPrimitive?.content)
        assertEquals("GLM 6", added?.get("name")?.jsonPrimitive?.content)
        assertEquals(true, added?.get("reasoning")?.jsonPrimitive?.booleanOrNull)
        assertEquals(524288L, added?.get("contextWindow")?.jsonPrimitive?.longOrNull)
        assertEquals(128000L, added?.get("maxTokens")?.jsonPrimitive?.longOrNull)
        assertEquals(listOf("text", "image"), (added?.get("input") as? JsonArray)?.map { it.jsonPrimitive.content })
    }

    @Test
    fun `creates a new provider alongside existing ones`() {
        Files.createDirectories(modelsPath().parent)
        Files.writeString(modelsPath(), """{"providers": {"a": {"models": [{"id": "m1"}]}}}""")

        val error = PiModelsJson.addModel(
            provider = "b",
            api = "openai-completions",
            baseUrl = "https://b.invalid/v1",
            apiKey = "key-b",
            modelId = "m2",
            name = "",
            contextWindow = 0,
            maxTokens = 0,
            reasoning = false,
            input = listOf("text"),
            homeDir = tempDir,
        )

        assertNull(error)
        val providers = PiModelsJson.read(modelsPath())["providers"]?.jsonObject
        assertEquals(setOf("a", "b"), providers?.keys)
        val created = providers?.get("b")?.jsonObject
        assertEquals("openai-completions", created?.get("api")?.jsonPrimitive?.content)
        assertEquals("https://b.invalid/v1", created?.get("baseUrl")?.jsonPrimitive?.content)
        assertEquals("key-b", created?.get("apiKey")?.jsonPrimitive?.content)
        val models = created?.get("models") as? JsonArray
        assertEquals(1, models?.size)
        assertEquals("m2", models?.first()?.jsonObject?.get("id")?.jsonPrimitive?.content)
        // Optional fields stay omitted when empty/zero so pi applies its defaults.
        assertNull(models?.first()?.jsonObject?.get("contextWindow"))
        assertNull(models?.first()?.jsonObject?.get("reasoning"))
        assertNull(models?.first()?.jsonObject?.get("name"))
    }

    @Test
    fun `creates the file when it does not exist`() {
        assertNull(
            PiModelsJson.addModel(
                provider = "new",
                api = "openai-completions",
                baseUrl = "https://new.invalid/v1",
                apiKey = "",
                modelId = "m",
                name = "",
                contextWindow = 4096,
                maxTokens = 0,
                reasoning = false,
                input = emptyList(),
                homeDir = tempDir,
            ),
        )
        val providers = PiModelsJson.read(modelsPath())["providers"]?.jsonObject
        assertNotNull(providers?.get("new"))
    }

    @Test
    fun `rejects duplicate model ids instead of overwriting`() {
        Files.createDirectories(modelsPath().parent)
        Files.writeString(
            modelsPath(),
            """{"providers": {"p": {"models": [{"id": "m", "contextWindow": 1}]}}}""",
        )

        val error = PiModelsJson.addModel(
            provider = "p",
            api = "openai-completions",
            baseUrl = "https://p.invalid/v1",
            apiKey = "",
            modelId = "m",
            name = "",
            contextWindow = 99,
            maxTokens = 0,
            reasoning = false,
            input = emptyList(),
            homeDir = tempDir,
        )

        assertNotNull(error)
        val models = PiModelsJson.read(modelsPath())["providers"]?.jsonObject?.get("p")?.jsonObject?.get("models") as? JsonArray
        assertEquals(1, models?.size)
        assertEquals(1L, models?.first()?.jsonObject?.get("contextWindow")?.jsonPrimitive?.content?.toLong())
    }

    @Test
    fun `reports a parse error and keeps the file intact`() {
        Files.createDirectories(modelsPath().parent)
        Files.writeString(modelsPath(), "{not json")

        val error = PiModelsJson.addModel(
            provider = "p",
            api = "openai-completions",
            baseUrl = "https://p.invalid/v1",
            apiKey = "",
            modelId = "m",
            name = "",
            contextWindow = 0,
            maxTokens = 0,
            reasoning = false,
            input = emptyList(),
            homeDir = tempDir,
        )

        assertTrue(error?.startsWith("failed to update models.json") == true)
        assertEquals("{not json", Files.readString(modelsPath()))
    }

    @Test
    fun `rejects a models json whose providers member is not an object`() {
        Files.createDirectories(modelsPath().parent)
        Files.writeString(modelsPath(), """{"providers": []}""")

        val error = PiModelsJson.addModel(
            provider = "p",
            api = "openai-completions",
            baseUrl = "https://p.invalid/v1",
            apiKey = "",
            modelId = "m",
            name = "",
            contextWindow = 0,
            maxTokens = 0,
            reasoning = false,
            input = emptyList(),
            homeDir = tempDir,
        )

        assertNotNull(error)
    }

    @Test
    fun `preserves unknown root and provider fields`() {
        Files.createDirectories(modelsPath().parent)
        Files.writeString(
            modelsPath(),
            """{"providers": {"p": {"models": [], "headers": {"x-a": "b"}}}, "note": "keep me"}""",
        )

        assertNull(
            PiModelsJson.addModel(
                provider = "p",
                api = "openai-completions",
                baseUrl = "https://p.invalid/v1",
                apiKey = "",
                modelId = "m",
                name = "",
                contextWindow = 0,
                maxTokens = 0,
                reasoning = false,
                input = emptyList(),
                homeDir = tempDir,
            ),
        )

        val root = PiModelsJson.read(modelsPath())
        assertEquals("keep me", root["note"]?.jsonPrimitive?.content)
        val provider = root["providers"]?.jsonObject?.get("p")?.jsonObject
        assertEquals(JsonObject(mapOf("x-a" to JsonPrimitive("b"))), provider?.get("headers"))
        assertEquals(1, (provider?.get("models") as? JsonArray)?.size)
    }
}
