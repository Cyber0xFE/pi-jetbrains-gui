// Inlines the built JS/CSS into dist/index.html so the Kotlin side can hand a single
// self-contained document to JBCefBrowser.loadHTML().
//
// The bundle is appended as a classic script at the end of <body>: `loadHTML` has no base URL and
// no origin, so inline ES modules and relative assets are off the table. Appending at the end also
// guarantees the bridge marker script (and therefore `window.__piNativePost`) runs first.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const htmlPath = join(dist, "index.html");
let html = readFileSync(htmlPath, "utf8");

const escapeForScript = (code) => code.replace(/<\/script/gi, "<\\/script");
const readAsset = (url) => readFileSync(join(dist, url.replace(/^\//, "")), "utf8");

let bundle = null;
html = html.replace(/<script[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/script>/g, (_match, src) => {
	bundle = escapeForScript(readAsset(src));
	return "";
});

html = html.replace(
	/<link[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g,
	(_match, href) => `<style>${readAsset(href)}</style>`,
);

if (bundle === null) {
	throw new Error("no bundle script found in dist/index.html");
}

html = html.replace("</body>", `    <script>${bundle}</script>\n  </body>`);

if (/\bsrc="|\bhref="\/(assets|src)\//.test(html)) {
	throw new Error("webview bundle still references external assets; check the inlining step");
}

writeFileSync(htmlPath, html);
console.log(`inlined webview bundle: ${htmlPath} (${Buffer.byteLength(html)} bytes)`);
