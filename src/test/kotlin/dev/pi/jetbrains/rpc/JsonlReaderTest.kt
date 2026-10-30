package dev.pi.jetbrains.rpc

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.InputStream
import java.nio.charset.StandardCharsets

class JsonlReaderTest {
    @Test
    fun `splits records on LF only and keeps unicode separators`() {
        val records = read("{\"t\":\"a\u2028b\"}\n{\"t\":2}\n")

        assertEquals(2, records.lines.size, "U+2028 must not split records")
        assertEquals("{\"t\":\"a\u2028b\"}", records.lines[0])
        assertEquals("{\"t\":2}", records.lines[1])
    }

    @Test
    fun `strips a trailing carriage return`() {
        val records = read("one\r\ntwo\r\n")

        assertEquals(listOf("one", "two"), records.lines)
    }

    @Test
    fun `skips empty records`() {
        val records = read("\n\r\n  \n")

        assertEquals(listOf("  "), records.lines)
    }

    @Test
    fun `emits a trailing record without a newline`() {
        val records = read("no-newline")

        assertEquals(listOf("no-newline"), records.lines)
    }

    @Test
    fun `keeps multi-byte characters split across reads`() {
        val text = "中文🙂\n"
        // A 1-2 byte read size forces UTF-8 sequences to straddle the pipe boundary.
        val records = read(text, chunkSize = 1)

        assertEquals(listOf("中文🙂"), records.lines)
        assertNull(records.error)
    }

    @Test
    fun `emits nothing and no error on empty input`() {
        val records = read("")

        assertTrue(records.lines.isEmpty())
        assertNull(records.error)
    }

    @Test
    fun `reports an over-long record and stops reading`() {
        val records = read("abcdefghij\nsecond\n", maxLineChars = 5)

        assertTrue(records.lines.isEmpty())
        assertTrue(records.error is RpcLineTooLongException, "expected line-too-long, got ${records.error}")
    }

    @Test
    fun `keeps reading after a callback failure`() {
        val lines = mutableListOf<String>()
        val errors = mutableListOf<Throwable>()
        JsonlReader(
            input = "boom\nok\n".toStream(),
            onLine = {
                if (it == "boom") throw IllegalStateException("callback failed")
                lines += it
            },
            onError = { errors += it },
        ).run()

        assertEquals(listOf("ok"), lines)
        assertEquals(1, errors.size)
    }

    private data class Result(val lines: List<String>, val error: Throwable?)

    private fun read(
        text: String,
        chunkSize: Int = 64,
        maxLineChars: Int = JsonlReader.DEFAULT_MAX_LINE_CHARS,
    ): Result {
        val lines = mutableListOf<String>()
        var error: Throwable? = null
        JsonlReader(
            input = DripInputStream(text.toByteArray(StandardCharsets.UTF_8), chunkSize),
            maxLineChars = maxLineChars,
            onLine = { lines += it },
            onError = { error = it },
        ).run()
        return Result(lines, error)
    }

    private fun String.toStream(): InputStream =
        DripInputStream(toByteArray(StandardCharsets.UTF_8), 4096)

    /** Serves at most [chunkSize] bytes per read. */
    private class DripInputStream(
        private val bytes: ByteArray,
        private val chunkSize: Int,
    ) : InputStream() {
        private var position = 0

        override fun read(): Int =
            if (position < bytes.size) bytes[position++].toInt() and 0xFF else -1

        override fun read(target: ByteArray, offset: Int, length: Int): Int {
            if (position >= bytes.size) return -1
            val count = minOf(chunkSize, length, bytes.size - position)
            System.arraycopy(bytes, position, target, offset, count)
            position += count
            return count
        }
    }
}
