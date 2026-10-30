package dev.pi.jetbrains.rpc

import java.io.BufferedReader
import java.io.IOException
import java.io.InputStream
import java.io.InputStreamReader
import java.nio.charset.StandardCharsets

/** Raised when a single JSONL record exceeds the configured limit. */
class RpcLineTooLongException(limit: Int) :
    IOException("RPC record exceeded $limit characters; stopping the reader")

/**
 * Strict JSONL reader for pi's stdout.
 *
 * Framing is LF-only. A UTF-8 [InputStreamReader] keeps multi-byte characters intact when a
 * character is split across pipe reads, which is why this does not scan raw bytes.
 */
class JsonlReader(
    private val input: InputStream,
    private val maxLineChars: Int = DEFAULT_MAX_LINE_CHARS,
    private val onLine: (String) -> Unit,
    private val onError: (Throwable) -> Unit,
) {
    fun run() {
        val reader = BufferedReader(InputStreamReader(input, StandardCharsets.UTF_8))
        val chunk = CharArray(CHUNK_CHARS)
        val line = StringBuilder()

        while (true) {
            val read = try {
                reader.read(chunk)
            } catch (e: IOException) {
                onError(e)
                return
            }
            if (read < 0) break

            var i = 0
            while (i < read) {
                val ch = chunk[i]
                if (ch == '\n') {
                    emit(line)
                    line.setLength(0)
                } else {
                    line.append(ch)
                }
                if (line.length > maxLineChars) {
                    onError(RpcLineTooLongException(maxLineChars))
                    return
                }
                i++
            }
        }

        if (line.isNotEmpty()) emit(line)
    }

    private fun emit(raw: StringBuilder) {
        var end = raw.length
        if (end > 0 && raw[end - 1] == '\r') end--
        if (end == 0) return
        val record = raw.substring(0, end)
        try {
            onLine(record)
        } catch (t: Throwable) {
            onError(t)
        }
    }

    companion object {
        /** Plan section 5.6: 32 MB single-record ceiling. */
        const val DEFAULT_MAX_LINE_CHARS: Int = 32 * 1024 * 1024
        private const val CHUNK_CHARS = 8 * 1024
    }
}
