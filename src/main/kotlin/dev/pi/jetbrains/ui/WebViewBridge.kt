package dev.pi.jetbrains.ui

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import dev.pi.jetbrains.rpc.PiJson
import kotlinx.serialization.json.JsonElement

/**
 * Two-way bridge between the JCEF webview and Kotlin (plan 7.4).
 *
 * JS -> Kotlin uses [JBCefJSQuery]; Kotlin -> JS calls `window.__piDeliver`, which the React app
 * registers on startup. The query snippet is injected into the HTML before it is loaded so the
 * page can post from its first script.
 */
class WebViewBridge(
    private val browser: JBCefBrowser,
    private val onClientMessage: (ClientMessage) -> Unit,
    private val log: (String) -> Unit = {},
) : Disposable {
    private val query: JBCefJSQuery = JBCefJSQuery.create(browser as JBCefBrowserBase)

    // send() is called from coroutine threads while markReady() runs on the EDT; the deque is
    // not thread-safe, so all ready/pending access is guarded by this lock.
    private val lock = Any()
    private val pending = ArrayDeque<JsonElement>()
    @Volatile
    private var ready = false

    init {
        query.addHandler { payload ->
            val message = runCatching { PiJson.decodeFromString(ClientMessage.serializer(), payload) }.getOrNull()
            if (message == null) {
                log("ignoring unparseable webview message: ${payload.take(200)}")
            } else {
                ApplicationManager.getApplication().invokeLater { onClientMessage(message) }
            }
            null
        }
    }

    /** Loads [html] with the query snippet substituted for [BRIDGE_MARKER]. */
    fun load(html: String) {
        if (!html.contains(BRIDGE_MARKER)) {
            log("webview HTML is missing $BRIDGE_MARKER; messages from the page will be dropped")
        }
        val snippet = "window.__piNativePost = function (message) { ${query.inject("JSON.stringify(message)")} };"
        browser.loadHTML(html.replace(BRIDGE_MARKER, snippet))
    }

    /** Called once the page reports it installed its message handler. */
    fun markReady() {
        val queued: List<JsonElement>
        synchronized(lock) {
            ready = true
            queued = pending.toList()
            pending.clear()
        }
        queued.forEach(::execute)
    }

    fun send(message: JsonElement) {
        val executeNow = synchronized(lock) {
            if (!ready) {
                if (pending.size >= MAX_PENDING) {
                    log("dropping webview message: ${pending.size} already queued before the page was ready")
                    return
                }
                pending.addLast(message)
                false
            } else {
                true
            }
        }
        if (executeNow) {
            execute(message)
        }
    }

    private fun execute(message: JsonElement) {
        ApplicationManager.getApplication().invokeLater {
            val frame = browser.cefBrowser.mainFrame ?: return@invokeLater
            // U+2028/U+2029 are legal inside JSON strings but are JS line terminators in source.
            val payload = message.toString()
                .replace("\u2028", "\\u2028")
                .replace("\u2029", "\\u2029")
            frame.executeJavaScript("window.__piDeliver && window.__piDeliver($payload)", frame.url, 0)
        }
    }

    override fun dispose() {
        Disposer.dispose(query)
    }

    companion object {
        const val BRIDGE_MARKER: String = "/*__PI_BRIDGE__*/"
        private const val MAX_PENDING = 64
    }
}
