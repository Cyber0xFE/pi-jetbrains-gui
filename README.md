# Pi JetBrains GUI

> 🌏 This document is also available in [简体中文 (Chinese)](./README.zh-CN.md).

A graphical plugin for using the [pi](https://github.com/badlogic/pi-mono) coding agent inside JetBrains IDEs (IntelliJ IDEA, PyCharm, and other IDEs in the JetBrains family).
The plugin launches a local `pi --mode rpc` subprocess and renders conversations, tool calls, and diffs in the Pi tool window of your IDE.

## Features

- Send messages and view streaming replies inside the IDE
- Multiple task tabs at the top, each backed by its own pi process, so different tasks can run concurrently
- Display tool call results such as file reads, edits, and terminal output
- Jump from diffs to the corresponding editor locations
- Save and restore pi sessions
- Automatically attach the current editor selection as context
- Follow the IDE light/dark theme
- Configure the Node.js path, network proxy, log directory, and task-completion sound in settings
- Choose models and thinking levels, view context usage and token statistics; add custom models from the model selector (appended to `~/.pi/agent/models.json` without overwriting existing configuration)
- Create, switch, rename, delete, and fork sessions, and view branches in the session tree
- Browse pi commands with `/` and reference project files with `@`
- Use `/btw <question>` to ask side questions at any time (inspired by Claude Code): the main task is not interrupted, the answer streams in a dismissible overlay, and the Q&A is not written into the main session history; typing `/btw` alone shows the most recent side Q&A
- Manually compact context, configure auto-compaction, and abort automatic retries
- Support pi extension dialogs, notifications, status text, and status bar widgets
- Jump files, URLs, terminal output, and diff locations directly into the IDE
- Paste images into the input box and send them with your message

## Requirements

- IntelliJ IDEA 2024.2 or later (minimum plugin build `242`)
- Java 21 (for building the plugin)
- Node.js `22.19.0` or later
- The pi coding agent installed via any of the following:

  ```bash
  # Official install script (macOS/Linux)
  curl -fsSL https://pi.dev/install.sh | sh

  # Or install globally with npm
  npm install -g @earendil-works/pi-coding-agent
  ```

The plugin looks for pi in the following order: the entry configured in settings, the copy bundled with the plugin, the directory managed by the pi install script (`~/.pi/agent/install`), and the npm global install directory.
Node.js is resolved first from the path configured in settings and the system `PATH`, falling back to the standalone Node bundled with the pi install script (`~/.local/share/pi-node`). If startup fails, fill in an executable Node.js path in settings and verify the pi CLI is installed correctly.

## Building and Running

Run from the project root:

```bash
./gradlew buildPlugin
```

On Windows (PowerShell):

```powershell
.\gradlew.bat buildPlugin
```

To run a development IDE with the plugin:

```bash
./gradlew runIde
```

The plugin ZIP is generated in `build/distributions/`. The Gradle build automatically installs webview dependencies and bundles the React/TypeScript frontend into the plugin resources.

On Windows, a successful local build also queues plugin updates for existing IntelliJ IDEA and PyCharm configuration directories (2024.2 or later) under `%APPDATA%/JetBrains/`. It uses each IDE's built-in update queue, preserves other pending plugins, and does not overwrite JARs held open by a running IDE. Updates are installed the next time you restart the IDE; the build never closes your IDE automatically. The `Queued plugin update` message in the build log only means the update was queued, not that a running IDE has already loaded it.

To only build the ZIP without installing: `./gradlew buildPlugin -PinstallLocalPlugin=false`. To specify local configuration directories, pass `-PlocalIdePluginDirs=dir1;dir2` (quote the whole argument in PowerShell); these must be each IDE's `plugins` directory, and a corresponding `%LOCALAPPDATA%/JetBrains/<config-dir-name>/.home` record must exist. Custom cache paths are not supported yet.

## Usage

1. Install the built plugin ZIP in your IDE, or start a development IDE with `runIde`.
2. Open the **Pi** tool window on the right side.
3. Check the Node.js path and log directory in `Settings | Tools | Pi`. If you need a proxy, enter the full address under "Network proxy" (for example `http://127.0.0.1:7890`); the plugin injects both `HTTP_PROXY` and `HTTPS_PROXY` into the Pi subprocess (without affecting the IDE or other applications). Applying proxy changes restarts the Pi processes of already started tabs and restores their sessions, interrupting running tasks; tabs that have not started yet will use the new settings on next launch. Leaving it empty keeps the system proxy environment variables inherited from the IDE.
4. Send messages from the input box, or select text in the editor and send it to Pi via the console context menu.
5. Click **＋** at the top of the Pi tool window to create a new task tab; switching tabs does not interrupt background tasks. Closing a tab stops its process, with a confirmation when a task is running; past sessions can still be restored from the session list. The console "Send to Pi" action sends to the currently selected tab.

The session list supports creating, switching, renaming, deleting, and forking sessions; switching to a session already open in another tab jumps directly to that tab instead of loading it twice. Before deleting the current session, the plugin switches to a new one first, so pi stops writing to the file being deleted. The model selector syncs the selected default model to pi's user settings; session-level switching is still controlled by the current session. The **＋** at the bottom-right of the model selector opens an "Add model" form that appends custom providers/models to `~/.pi/agent/models.json`: for an existing provider, only new models are appended to its `models` list — fields such as `apiKey` and `baseUrl` are never rewritten — and duplicate model ids are rejected. After saving, pi restarts automatically to pick up the new models.

Press `Ctrl+F` in the session area to open the message search bar. It searches keywords in user messages and assistant replies, and supports toggling case sensitivity, whole-word matching, and regular expressions. `Enter` / `Shift+Enter` jump to the next/previous match, `Esc` or the close button exits search, and the message containing the current match is highlighted.

### Settings and Keyboard Shortcuts

In `Settings | Tools | Pi` you can configure the Node.js path, network proxy, chat font size (10–32px), accent color (customizes the Pi chat UI accent; emphasized elements such as user message bubbles follow it, and leaving it empty follows the IDE theme), diagnostic log directory, task-completion sound, and all Pi panel shortcuts. Default shortcuts:

| Action | Default shortcut |
| --- | --- |
| Open Pi panel | `Ctrl+Alt+K` |
| New tab | `Ctrl+Shift+O` |
| Close tab | `Ctrl+W` |
| Previous/next tab | `Ctrl+PageUp` / `Ctrl+PageDown` |
| Jump to latest/first message | `Ctrl+End` / `Ctrl+Home` |
| Previous/next user message | `Ctrl+↑` / `Ctrl+↓` |

Shortcuts are written into the current IDE keymap; if the current keymap is read-only, the plugin creates a derived keymap named `Pi JetBrains GUI`. Proxy settings are only injected as `HTTP_PROXY` and `HTTPS_PROXY` into the Pi subprocess; they never modify the environment of the IDE or other processes.

### Troubleshooting

- Pi fails to start: make sure Node.js is `22.19.0` or later and check the Node.js path in settings; if pi was installed via npm, re-run `npm install -g @earendil-works/pi-coding-agent` if needed. Note that nvm users must install pi under the Node version actually used by the IDE, and fully restart the IDE so `PATH` changes take effect.
- Abnormal messages or tool output: set a diagnostic log directory in settings, reproduce the issue, and attach the relevant logs plus your IDE version.
- After changing proxy or Node.js settings: already started tabs restart their Pi processes and restore sessions, interrupting running tasks.
- Blank WebView: rebuild the bundled frontend with `./gradlew buildPlugin` (on Windows use `gradlew.bat buildPlugin`) and confirm the target IDE supports JCEF.

## Development

Frontend code lives in `web/src`; the Kotlin plugin code lives in `src/main/kotlin`.

```bash
cd web
npm ci
npm run typecheck
npm test
npm run build
```

The RPC protocol is referenced by `rpc-schema.json`. See `JETBRAINS_GUI_PLAN.md` for the project design and phased plan.
After changing the frontend, run `npm run typecheck && npm test` in the `web` directory; final validation of the plugin artifact is `buildPlugin` at the repository root. The RPC protocol snapshot is pinned by `rpc-schema.json`; after upgrading pi, run `dumpRpcSchema` first to check for protocol drift.

## License and Feedback

Project home: [Cyber0xFE/pi-jetbrains-gui](https://github.com/Cyber0xFE/pi-jetbrains-gui)
