package dev.pi.jetbrains.ui

import dev.pi.jetbrains.rpc.PiJson
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
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
    fun `legacy messages keep parsing with unknown fields ignored`() {
        val json = PiJson.parseToJsonElement("""{"type":"prompt","message":"hi","question":null}""").jsonObject
        val message = PiJson.decodeFromJsonElement(ClientMessage.serializer(), json)

        assertEquals("prompt", message.type)
        assertEquals("hi", message.message)
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
