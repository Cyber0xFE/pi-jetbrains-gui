package dev.pi.jetbrains.ui

import dev.pi.jetbrains.rpc.PiJson
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** Wire-contract checks for webview -> Kotlin messages. */
class ClientMessageTest {
    @Test
    fun `btw message carries the question in the question field`() {
        val json = PiJson.parseToJsonElement("""{"type":"btw","question":"你好"}""").jsonObject
        val message = PiJson.decodeFromJsonElement(ClientMessage.serializer(), json)

        assertEquals("btw", message.type)
        assertEquals("你好", message.question)
    }

    @Test
    fun `btw abort is a standalone request without a question`() {
        val json = PiJson.parseToJsonElement("""{"type":"btw_abort"}""").jsonObject
        val message = PiJson.decodeFromJsonElement(ClientMessage.serializer(), json)

        assertEquals("btw_abort", message.type)
    }

    @Test
    fun `legacy messages keep parsing with unknown fields ignored`() {
        val json = PiJson.parseToJsonElement("""{"type":"prompt","message":"hi","question":null}""").jsonObject
        val message = PiJson.decodeFromJsonElement(ClientMessage.serializer(), json)

        assertEquals("prompt", message.type)
        assertEquals("hi", message.message)
    }

    @Test
    fun `prompt message carries the steering behavior`() {
        val json = PiJson.parseToJsonElement(
            """{"type":"prompt","message":"先看这里","streamingBehavior":"steer"}""",
        ).jsonObject
        val message = PiJson.decodeFromJsonElement(ClientMessage.serializer(), json)

        assertEquals("steer", message.streamingBehavior)
    }

    @Test
    fun `prompt without steering behavior parses as null`() {
        val json = PiJson.parseToJsonElement("""{"type":"prompt","message":"hi"}""").jsonObject
        val message = PiJson.decodeFromJsonElement(ClientMessage.serializer(), json)

        assertEquals(null, message.streamingBehavior)
    }

    @Test
    fun `send_queued carries the messages and their queue kinds`() {
        val json = PiJson.parseToJsonElement(
            """{"type":"send_queued","queued":[{"text":"first","kind":"steering"},{"text":"next","kind":"followUp"}]}""",
        ).jsonObject
        val message = PiJson.decodeFromJsonElement(ClientMessage.serializer(), json)

        assertEquals("send_queued", message.type)
        assertEquals(listOf("first", "next"), message.queued.map { it.text })
        assertEquals(listOf("steering", "followUp"), message.queued.map { it.kind })
    }

    @Test
    fun `bash message carries id command and exclusion flag`() {
        val json = PiJson.parseToJsonElement(
            """{"type":"bash","id":"bash:1","command":"ls -la","excludeFromContext":true}""",
        ).jsonObject
        val message = PiJson.decodeFromJsonElement(ClientMessage.serializer(), json)

        assertEquals("bash", message.type)
        assertEquals("bash:1", message.id)
        assertEquals("ls -la", message.command)
        assertEquals(true, message.excludeFromContext)
    }

    @Test
    fun `abort_bash message parses without extra fields`() {
        val json = PiJson.parseToJsonElement("""{"type":"abort_bash"}""").jsonObject
        val message = PiJson.decodeFromJsonElement(ClientMessage.serializer(), json)

        assertEquals("abort_bash", message.type)
    }

    @Test
    fun `bash_result host message serializes with the documented shape`() {
        val element: JsonElement = HostMessages.bashResult(
            id = "bash:1",
            command = "ls -la",
            output = "file one\nfile two",
            exitCode = 2,
            cancelled = false,
            truncated = true,
            fullOutputPath = "/tmp/out.log",
            excludeFromContext = true,
        )
        val json = element.jsonObject

        assertEquals("bash_result", json["type"]?.toString()?.trim('"'))
        assertEquals("bash:1", json["id"]?.toString()?.trim('"'))
        assertEquals("ls -la", json["command"]?.toString()?.trim('"'))
        assertEquals("file one\nfile two", json["output"]?.jsonPrimitive?.content)
        assertEquals("2", json["exitCode"].toString())
        assertEquals("true", json["truncated"].toString())
        assertEquals("/tmp/out.log", json["fullOutputPath"]?.toString()?.trim('"'))
        assertEquals("true", json["excludeFromContext"].toString())
    }

    @Test
    fun `bash_result host message carries a host error without exit code`() {
        val element: JsonElement = HostMessages.bashResult(id = "bash:2", command = "sleep", output = "", error = "pi did not answer 'bash'")
        val json = element.jsonObject

        assertEquals("null", json["exitCode"].toString())
        assertEquals("pi did not answer 'bash'", json["error"]?.toString()?.trim('"'))
    }

    @Test
    fun `dequeue host message serializes with the documented shape`() {
        val element: JsonElement = HostMessages.dequeue(listOf("a"), listOf("b", "c"))

        assertEquals("dequeue", element.jsonObject["type"]?.toString()?.trim('"'))
        assertEquals("[\"a\"]", element.jsonObject["steering"].toString())
        assertEquals("[\"b\",\"c\"]", element.jsonObject["followUp"].toString())
    }

    @Test
    fun `btw host message serializes with the documented shape`() {
        val element: JsonElement = HostMessages.btw("answer", "你好", answer = "你好！")

        assertEquals("btw", element.jsonObject["type"]?.toString()?.trim('"'))
        assertEquals("answer", element.jsonObject["state"]?.toString()?.trim('"'))
        assertEquals("你好", element.jsonObject["question"]?.toString()?.trim('"'))
        assertEquals("你好！", element.jsonObject["answer"]?.toString()?.trim('"'))
    }
}
