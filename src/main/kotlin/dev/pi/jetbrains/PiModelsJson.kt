package dev.pi.jetbrains

import dev.pi.jetbrains.rpc.PiJson
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.util.UUID

/** Appends a custom model to pi's `~/.pi/agent/models.json` without disturbing existing config. */
@OptIn(ExperimentalSerializationApi::class)
object PiModelsJson {
    private val PrettyJson = Json(PiJson) {
        prettyPrint = true
        prettyPrintIndent = "  "
    }

    /**
     * Adds [modelId] under [provider]. Existing providers are only extended: their `api`,
     * `baseUrl`, `apiKey` and other fields are preserved untouched, and an existing model id
     * is reported as an error instead of being overwritten. Returns null on success or a
     * user-facing error message.
     */
    fun addModel(
        provider: String,
        api: String,
        baseUrl: String,
        apiKey: String,
        modelId: String,
        name: String,
        contextWindow: Long,
        maxTokens: Long,
        reasoning: Boolean,
        input: List<String>,
        homeDir: Path = Paths.get(System.getProperty("user.home") ?: "."),
    ): String? {
        val trimmedProvider = provider.trim()
        val trimmedModelId = modelId.trim()
        if (trimmedProvider.isEmpty() || trimmedModelId.isEmpty()) return "provider and model id are required"
        val path = homeDir.resolve(".pi").resolve("agent").resolve("models.json")
        return runCatching {
            val root = readRoot(path)
            val providers = (root["providers"] as? JsonObject)
                ?: if (root.containsKey("providers")) error("models.json `providers` must be an object") else JsonObject(emptyMap())
            val model = buildModelObject(
                id = trimmedModelId,
                name = name.trim(),
                reasoning = reasoning,
                contextWindow = contextWindow,
                maxTokens = maxTokens,
                input = input.filter { it == "text" || it == "image" }.distinct(),
            )
            val updatedProviders = if (providers.containsKey(trimmedProvider)) {
                val existing = providers[trimmedProvider] as? JsonObject
                    ?: error("provider `$trimmedProvider` in models.json must be an object")
                val models = existing["models"] as? JsonArray
                    ?: if (existing.containsKey("models")) error("provider `$trimmedProvider` models must be an array") else JsonArray(emptyList())
                if (models.any { (it as? JsonObject)?.get("id")?.jsonPrimitive?.contentOrNull == trimmedModelId }) {
                    return "model `$trimmedModelId` already exists under provider `$trimmedProvider`"
                }
                // Never rewrite provider-level fields; only extend the models array. Fill in a
                // missing apiKey/baseUrl when the caller supplied one, but leave values as-is.
                val additions = buildMap {
                    if (!existing.containsKey("apiKey") && apiKey.isNotBlank()) put("apiKey", JsonPrimitive(apiKey.trim()))
                    if (!existing.containsKey("baseUrl") && baseUrl.isNotBlank()) put("baseUrl", JsonPrimitive(baseUrl.trim()))
                    if (!existing.containsKey("api") && api.isNotBlank()) put("api", JsonPrimitive(api.trim()))
                }
                val updatedProvider = JsonObject(
                    existing.toMutableMap().apply {
                        putAll(additions)
                        put("models", JsonArray(models + model))
                    },
                )
                JsonObject(providers.toMutableMap().apply { put(trimmedProvider, updatedProvider) })
            } else {
                val providerObject = buildJsonObject {
                    if (api.isNotBlank()) put("api", api.trim())
                    if (baseUrl.isNotBlank()) put("baseUrl", baseUrl.trim())
                    if (apiKey.isNotBlank()) put("apiKey", apiKey.trim())
                    put("models", JsonArray(listOf(model)))
                }
                JsonObject(providers.toMutableMap().apply { put(trimmedProvider, providerObject) })
            }
            val updatedRoot = JsonObject(root.toMutableMap().apply { put("providers", updatedProviders) })
            writeAtomically(path, updatedRoot)
            null
        }.getOrElse { throwable -> "failed to update models.json: ${throwable.message}" }
    }

    private fun readRoot(path: Path): JsonObject {
        if (!Files.isRegularFile(path)) return JsonObject(emptyMap())
        val content = Files.readString(path, StandardCharsets.UTF_8).removePrefix("\uFEFF")
        if (content.isBlank()) return JsonObject(emptyMap())
        val parsed = PiJson.parseToJsonElement(content) as? JsonObject
            ?: error("models.json must contain a JSON object")
        return parsed
    }

    private fun buildModelObject(
        id: String,
        name: String,
        reasoning: Boolean,
        contextWindow: Long,
        maxTokens: Long,
        input: List<String>,
    ): JsonObject = buildJsonObject {
        put("id", id)
        if (name.isNotEmpty()) put("name", name)
        if (reasoning) put("reasoning", true)
        if (contextWindow > 0) put("contextWindow", contextWindow)
        if (maxTokens > 0) put("maxTokens", maxTokens)
        if (input.isNotEmpty()) put("input", JsonArray(input.map(::JsonPrimitive)))
    }

    private fun writeAtomically(path: Path, root: JsonObject) {
        Files.createDirectories(path.parent)
        val temporaryPath = path.resolveSibling(".${path.fileName}.${UUID.randomUUID()}.tmp")
        try {
            Files.writeString(
                temporaryPath,
                PrettyJson.encodeToString(JsonObject.serializer(), root) + System.lineSeparator(),
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE_NEW,
            )
            try {
                Files.move(temporaryPath, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            } catch (_: java.nio.file.AtomicMoveNotSupportedException) {
                Files.move(temporaryPath, path, StandardCopyOption.REPLACE_EXISTING)
            }
        } finally {
            Files.deleteIfExists(temporaryPath)
        }
    }

    /** Reads back the stored JSON root; exposed for tests. */
    internal fun read(path: Path): JsonObject = readRoot(path)
}
