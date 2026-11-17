# THIRD_PARTY_NOTICES

This plugin is distributed under the MIT License (see [LICENSE](LICENSE)). The
plugin artifact bundles or inlines the third-party components listed below. Their
license texts are shipped by the upstream projects; the copyright notices and
license identifiers are reproduced here to satisfy their attribution terms.

## Bundled with the plugin artifact

| Component | Version | License | Project |
| --- | --- | --- | --- |
| kotlinx-serialization-json | 1.7.3 | Apache-2.0 | https://github.com/Kotlin/kotlinx.serialization |

The IntelliJ Platform APIs used at compile time (`intellijIdeaCommunity`) and the
Kotlin standard library are provided by the IDE at runtime and are not packaged
into the plugin.

## Inlined into the bundled WebView (`web/dist/index.html`)

| Component | Version | License | Project |
| --- | --- | --- | --- |
| react | 18.3.1 | MIT | https://github.com/facebook/react |
| react-dom | 18.3.1 | MIT | https://github.com/facebook/react |
| markdown-it | 14.3.3 | MIT | https://github.com/markdown-it/markdown-it |
| markdown-it-cjk-friendly | 3.0.0 | MIT | https://github.com/tats-u/markdown-cjk-friendly |
| highlight.js | 11.12.0 | BSD-3-Clause | https://github.com/highlightjs/highlight.js |
| diff | 7.0.0 | BSD-3-Clause | https://github.com/kpdecker/jsdiff |

Frontend build and test dependencies (Vite, Vitest, TypeScript, Testing Library,
jsdom) are not part of the distributed artifact.

## Runtime dependency, not redistributed

| Component | License | Notes |
| --- | --- | --- |
| [`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi) (pi CLI) | MIT | Installed and invoked by the user; not bundled with the plugin. The plugin only communicates with it over its JSONL RPC protocol. |

If you redistribute a modified plugin artifact, keep this file and the upstream
license texts with the distribution.
