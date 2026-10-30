# JetBrains 插件 GUI 集成 pi — 开发计划

状态：草稿，待评审。本文档是本仓库（`pi-jetbrains-gui`）的项目文档，随代码一同演进。pi 源码不在本仓库内，位于 `D:/workspace/pi`，仅作只读参考；本仓库不修改 pi 源码，与 pi 通过 npm 包版本耦合。

---

## 1. 目标与非目标

### 目标

在 IntelliJ IDEA 系列 IDE 里用图形界面完整使用 pi 的 agent 能力：发消息、看流式输出、看工具调用与 diff、切模型/思考档位、管理会话树、在编辑器里注入上下文。

### 非目标

- 不改 `packages/agent`、`packages/ai`、`packages/coding-agent/src/core` 的任何语义。
- 不追求 TUI 扩展自绘组件（`ctx.ui.custom()` 返回 `Component`）在 GUI 里的像素级兼容，只做降级。
- 不替换 CLI 与 TUI，两者继续作为一等公民存在。
- 不做 Web/远程运行时。首版只支持本机。

### 成功判据

1. 在 IDEA 中打开项目，插件启动一个 `pi --mode rpc` 子进程，输入 `解释这个仓库` 能流式返回。
2. 一次涉及 `read`/`edit`/`bash` 的完整任务能全程在 GUI 中观察，diff 可点击跳转到编辑器对应行。
3. 切换模型、切换思考档位、压缩上下文、fork 会话不重启进程。
4. 关闭项目后子进程退出，无残留 node 进程。

---

## 2. 事实基础

以下均为已核对的代码事实，计划中的设计都建立在它们之上。

| 位置 | 事实 |
|---|---|
| `packages/coding-agent/src/modes/rpc/rpc-mode.ts` | RPC 模式实现，stdin/stdout JSONL，非 TTY 依赖 |
| `packages/coding-agent/src/modes/rpc/rpc-types.ts` | `RpcCommand` / `RpcResponse` / `RpcExtensionUIRequest` / `RpcExtensionUIResponse` 全部类型，约 250 行 |
| `packages/coding-agent/src/modes/rpc/rpc-client.ts` | 官方 TS 客户端，可作为 Kotlin 客户端的语义参照 |
| `packages/coding-agent/src/modes/json-event.ts` | 事件序列化：`message_update` 会剥掉累积 `partial`，只留 delta |
| `packages/coding-agent/src/core/agent-session.ts:196` | `AgentSessionEvent` 联合类型定义，RPC 与 TUI 共用 |
| `packages/coding-agent/src/core/extensions/types.ts:149` | `ExtensionUIContext` 接口 |
| `packages/coding-agent/src/modes/rpc/rpc-mode.ts:228` | `custom()` 在 RPC 模式直接返回 `undefined` |
| `packages/coding-agent/docs/rpc.md` | 官方定位：language-independent、IDE、custom UI |
| `packages/coding-agent/docs/session-format.md` | 会话路径 `~/.pi/agent/sessions/--<path>--/<ts>_<id>.jsonl`，v3 树形 `id`/`parentId` |
| `packages/coding-agent/package.json` | `bin.pi = dist/bundle/cli.js`，`exports["./rpc-entry"] = dist/bundle/rpc-entry.js` |
| `packages/coding-agent/src/core/tools/renderers/` | 工具表现层已与执行路径分离，但只产出 TUI `Component` |
| `packages/coding-agent/src/core/tools/edit-diff.ts` | `computeEditsDiff()` 协议无关，可作 GUI diff 的语义参照 |

关键结论：表现层与 agent 之间只有一个窄接口 —— `AgentSessionEvent` 流 + 命令方法。RPC 模式已经把这个接口翻译成了 JSON。GUI 要做的是消费这份 JSON，而不是改 core。

---

## 3. 架构决策

### 决策 1：RPC 子进程，不在 JVM 内嵌 Node

**问题**：IntelliJ 插件是 Kotlin/JVM，pi 是 Node ESM。怎么让两者共存。

**备选与否决理由**：

| 方案 | 否决理由 |
|---|---|
| GraalJS / Nashorn 跑 pi | pi 依赖 node 内置模块（`child_process`、`fs`、`node:vm`、native 模块），GraalJS 不支持 |
| JNI 嵌 libnode | 每个平台要编一套 native 产物，崩溃会带走 IDE，调试地狱 |
| 插件内起 Node 但走 HTTP API | 需要 pi 新增 HTTP server，等于改 core |
| **RPC 子进程** | 已有实现、进程隔离、崩溃不影响 IDE、跨语言明确边界 |

**决定**：spawn `pi --mode rpc`，JSONL over stdio。

### 决策 2：前端用 JCEF + React/TS，不用 Swing/JB 原生组件

**问题**：`modes/interactive/` 约 8000 行加 48 个 component 约 11600 行，绝大部分是表现层逻辑。GUI 要重做这些。

**理由**：
- 流式 Markdown、代码块高亮、mermaid、diff、虚拟滚动，Web 生态有成熟库；Swing 侧要么自己写，要么用 JCEF 包一层。
- IntelliJ 自家 AI Assistant 就是 JCEF，用户对观感有预期。
- TUI 表现层是 ANSI 字符串拼接，无法直接复用；但语义（哪个块该显示成什么）可以直接翻译。

**代价**：JCEF 启动约 200-400ms，内存 +80-150MB。可接受，因为 IDE 本身已加载 JCEF（若用户首次触发则要等初始化）。

### 决策 3：Kotlin 中转，不让前端直连 Node

**问题**：前端要拿事件，可以直接由 Node 起 WebSocket 让 JCEF 连。

**决定**：Node → Kotlin → JS 两跳。

**理由**：
- 端口、鉴权、跨项目复用、断线重连、进程崩溃恢复都在 Kotlin 侧一处收敛。
- 只有 Kotlin 侧能访问 IDE 模型（VFS、Document、RunManager），编辑器联动必然经 Kotlin。
- 多一次 JSON 解析（约 1-3 µs/KB）相对网络与 LLM 延迟可忽略。

### 决策 4：协议以 pi 的 TS 类型为唯一来源

**问题**：Kotlin 手抄 `rpc-types.ts`，pi 升级后字段漂移是静默的 —— `kotlinx.serialization` 默认忽略未知字段，漏字段只在运行时某条路径炸。

**决定**：
- M0-M3 手写 Kotlin data class，但同时在仓库里加一个 `scripts/dump-rpc-schema.ts`（放插件仓库），用 `tsc` + `ts-json-schema-generator` 从 `rpc-types.ts` 生成 `rpc-schema.json`，CI 里对比 pinned 的 pi 版本，字段不一致就红。
- M4 若稳定，再考虑把协议抽成 `packages/protocol`（pi 侧改动），从 JSON Schema 生成 Kotlin。这一步不强求。

---

## 4. 仓库与模块布局

本仓库是独立仓库，不包含 pi 源码，只通过 npm 包版本与 pi 耦合。pi 仓库（`D:/workspace/pi`）不作为本仓库的依赖被修改；仅当 M4 决定抽 `packages/protocol` 时才需要向 pi 提改动，那是一次独立的、以 pi 为主体的提交。

```
pi-jetbrains/
├── build.gradle.kts
├── gradle.properties                  # platformVersion / sinceBuild 等
├── settings.gradle.kts
├── src/main/kotlin/dev/pi/jetbrains/
│   ├── PiPlugin.kt                    # 插件入口，注册 services/toolwindows
│   ├── rpc/
│   │   ├── RpcModels.kt               # 协议 data class（镜像 rpc-types.ts）
│   │   ├── RpcSessionEvent.kt         # 事件 sealed class（镜像 json-event.ts）
│   │   ├── JsonlReader.kt             # stdout 行切分 + UTF-8 边界处理
│   │   ├── PiProcess.kt               # spawn / stdin 写 / 退出码 / stderr 收集
│   │   └── PiClient.kt                # 命令发送、id 关联、超时、事件分发
│   ├── runtime/
│   │   ├── NodeRuntimeResolver.kt     # 探测系统 node / 解压内置 node
│   │   └── PiPackageResolver.kt       # 定位 pi 安装（npm global / 内置）
│   ├── ui/
│   │   ├── ChatToolWindowFactory.kt
│   │   ├── ChatPanel.kt               # JBCefBrowser 宿主
│   │   └── WebViewBridge.kt           # JBCefJSQuery 双向
│   ├── editor/
│   │   ├── SelectionContextAction.kt  # 发送选区/当前文件作为上下文
│   │   └── DiffNavigation.kt          # diff 行 → 打开编辑器并高亮
│   └── session/
│       └── SessionIndex.kt            # 扫 sessions 目录，解析 header
├── web/                               # 前端，独立 pnpm 工程
│   ├── src/
│   │   ├── App.tsx
│   │   ├── state/sessionReducer.ts    # delta 累积状态机（关键）
│   │   ├── components/MessageList.tsx
│   │   ├── components/ToolCard.tsx
│   │   ├── components/DiffBlock.tsx
│   │   └── bridge.ts                  # window.piHost 契约
│   └── vite.config.ts                 # 产物 dist/ 打进 resources/webview
├── src/main/resources/
│   ├── webview/                       # 前端构建产物
│   └── node/<os>-<arch>/node         # 可选内置 node 二进制
└── scripts/
    └── dump-rpc-schema.ts             # 生成 rpc-schema.json，CI 校验
```

`build.gradle.kts` 要点：`org.jetbrains.intellij.platform` 2.x、`jvmToolchain(21)`、`sinceBuild` 至少 233。前端构建用 Gradle `Exec` 任务在 `processResources` 前跑 `pnpm build`，产物拷进 `resources/webview`。

---

## 5. 协议契约

### 5.1 传输

- stdin：每行一个 `RpcCommand` JSON，以 `\n` 结尾。
- stdout：每行一个 `RpcResponse` 或 session event 或 `extension_ui_request`，以 `\n` 结尾。
- stderr：只作诊断日志，不承载协议数据。
- 启动参数：`pi --mode rpc --session-dir <pluginPath> --no-session`（首版用 `--no-session` 避免写用户目录；M3 起改为正常会话）。

启动示例：

```bash
node /path/to/pi/dist/bundle/cli.js --mode rpc --no-session --provider anthropic --model claude-sonnet-4-5
```

### 5.2 Kotlin 类型骨架

命令侧只需要覆盖首版用到的子集，其余留空实现。

```kotlin
@Serializable
data class RpcCommand(
    val id: String? = null,
    val type: String,
    val message: String? = null,
    val images: List<RpcImage>? = null,
    val provider: String? = null,
    val modelId: String? = null,
    val level: String? = null,
    val sessionPath: String? = null,
    val entryId: String? = null,
    val name: String? = null,
)
```

正式实现建议用 `sealed interface RpcCommand` + 自定义 serializer，避免一个巨大可选字段类。事件侧同理：

```kotlin
sealed interface PiEvent
data class MessageStart(val message: WireMessage) : PiEvent
data class MessageUpdate(val usage: Usage, val delta: AssistantDelta) : PiEvent
data class MessageEnd(val message: WireMessage) : PiEvent
data class ToolExecStart(val toolCallId: String, val toolName: String, val args: JsonObject) : PiEvent
data class ToolExecUpdate(val toolCallId: String, val partialResult: JsonElement) : PiEvent
data class ToolExecEnd(val toolCallId: String, val toolName: String, val result: JsonElement, val isError: Boolean, val durationMs: Long?) : PiEvent
// ... 其余 20 余种按 rpc-types.ts / agent-session.ts 逐一映射
```

解析策略：先读 `type` 字段判族，再反序列化到具体子类型。未知 `type` 记录日志后丢弃，不要抛异常 —— 保证 pi 加新事件时旧插件不崩。

### 5.3 ID 关联与并发

`id` 是可选字符串。规则：

- 客户端为每条命令生成 `req-<n>`。
- 响应带回同 `id`，用 `pending: Map<String, CompletableDeferred<RpcResponse>>` 完成。
- 无 `id` 的响应（扩展触发、内部命令）只记日志。
- 每条命令设超时（默认 30s；`compact` 300s），超时即 `completeExceptionally`。

注意 `bash` 命令的 `bash_execution_update` 事件会带回该命令的 `id`，用于把输出增量挂到对应卡片上。这是唯一带 id 的事件族。

### 5.4 事件流与客户端状态机

**这是整个前端最容易写错的地方。**

`json-event.ts` 的 `toJsonEvent()` 明确剥掉 `message_update` 里的累积快照 `partial`，只保留 `contentIndex` / `delta` 等字段。所以前端必须自己按 `contentIndex` 累积。

事件形状（`packages/ai/src/types.ts:814`）：

```
start          { partial }                 -> 剥掉 partial
text_start     { contentIndex }
text_delta     { contentIndex, delta }
text_end       { contentIndex, content }
thinking_start { contentIndex }
thinking_delta { contentIndex, delta }
thinking_end   { contentIndex, content }
toolcall_start { contentIndex, id, toolName }   -> 特殊：id/toolName 是提升出来的
toolcall_delta { contentIndex, delta }
toolcall_end   { contentIndex, toolCall }
done           { reason, message }
error          { reason, error }
```

前端 reducer 规则：

```ts
// 一次 assistant 回复 = 一条消息，content 数组按 contentIndex 定位
onMessageStart(msg):        append({ id: msg.timestamp, role: "assistant", blocks: [] })
onTextStart(i):             blocks[i] = { kind: "text", text: "" }
onTextDelta(i, d):          blocks[i].text += d
onThinkingDelta(i, d):      blocks[i].text += d     // 折叠展示
onToolcallStart(i, id, n):  blocks[i] = { kind: "tool", callId: id, name: n, argsJson: "" }
onToolcallDelta(i, d):      blocks[i].argsJson += d
onToolcallEnd(i, tc):       blocks[i].args = JSON.parse(tc.arguments); blocks[i].ready = true
onMessageEnd(msg):          用 msg 覆盖整条消息（权威数据）
```

`message_end` 是权威的：一定要用它覆盖累积结果，因为 `done` 事件里的 `message` 含完整 `usage`、`stopReason`、`errorMessage`，而 delta 累积可能因网络断流不完整。

`tool_execution_*` 是另一条流，按 `toolCallId` 与上面 `blocks[i].callId` 关联，把结果挂到同一张卡片。

**渲染节流**：`text_delta` 频率可达每字符一次。前端不要每次 delta 都 setState：用 `requestAnimationFrame` 合并，一帧最多一次渲染。

### 5.5 扩展 UI 双向协议

`RpcExtensionUIRequest` 全部 9 种 method 及 GUI 侧处理：

| method | 需要返回 | M2 处理 | M4 处理 |
|---|---|---|---|
| `select` | `{id, value}` 或 `{id, cancelled:true}` | 忽略并回 cancelled | 原生下拉对话框 |
| `confirm` | `{id, confirmed}` | 回 false | 对话框 |
| `input` | `{id, value}` 或 cancelled | 回 cancelled | 输入框 |
| `editor` | `{id, value}` 或 cancelled | 回 cancelled | 打开 IDE 编辑器或大文本对话框 |
| `notify` | 不需要 | 显示 balloon | balloon + 通知栏 |
| `setStatus` | 不需要 | 状态栏文本 | 状态栏 |
| `setWidget` | 不需要 | 纯文本面板（`widgetLines` 是 `string[]`，可直接显示） | 同上，带 placement |
| `setTitle` | 不需要 | 忽略 | 窗口标题 |
| `set_editor_text` | 不需要 | 写入输入框 | 同 |

`editor` 需要返回，但 `notify`/`setStatus`/`setWidget`/`setTitle`/`set_editor_text` 是单向通知 —— **不要给它们回 response**，否则协议里会多出无法配对的记录。判断依据：只有 `select`/`confirm`/`input`/`editor` 在 `rpc-mode.ts` 里走了 `createDialogPromise`，其余是 fire-and-forget。

超时：`select`/`confirm`/`input` 带 `timeout` 时要实现本地定时器，到时回 `cancelled`。

### 5.6 大对象与背压

- `get_messages` 与 `get_entries` 可能返回数 MB。单行 JSON 可能超 1MB，Kotlin 的 `BufferedReader.readLine()` 可以处理，但要注意内存；建议设 32MB 单行上限并在超限时记录并断开。
- `message_end` 里的 `message` 包含完整历史吗？不，只含本条消息。历史要通过 `get_messages`。
- 前端初始化流程：连接后先 `get_state` + `get_messages`，一次性构建历史，然后接流式事件。不要在流式中途重新拉全量。

---

## 6. 里程碑

假设 1 名熟悉 IntelliJ 平台的开发者。人日为粗略估算，不含 pi 侧改动。

### M0 — 骨架与进程管理（3-4 人日）

任务：

1. Gradle 工程搭起来，插件能在沙箱 IDE 里加载，注册一个空 tool window。
2. `NodeRuntimeResolver`：先查 `PATH` 上的 node 与版本（要求 >= 22.19，读 `process.versions` 或 `node -v`），不合格则用插件内置的。
3. `PiPackageResolver`：按顺序找 —— 用户配置 → 插件内置 `node_modules/@earendil-works/pi-coding-agent` → `npm root -g`。
4. `PiProcess`：spawn、stdin 写入、stderr 收集到日志、退出码处理、`SIGTERM` → 3s 后 `SIGKILL`（Windows 用 `Process.destroyForcibly`）。
5. `JsonlReader`：正确处理 UTF-8 多字节被行边界切断的情况（用 `InputStream` 按字节找 `\n`，再整体 `String(bytes, UTF_8)`，**不要**用 `InputStreamReader` 逐行 —— 虽然它内部处理了编码，但要自己控行上限）。
6. `PiClient`：`send(command): CompletableDeferred<RpcResponse>`，事件通过 `SharedFlow` 广播。
7. 单测：用假的 node 脚本（`node -e` 打印预置 JSONL）验证解析与 id 关联。

验收：手动跑 `get_state` 拿到 `model`、`sessionId`，日志里能看到 `message_start`。

### M1 — 最小聊天（5-6 人日）

任务：

1. `ChatPanel` + `JBCefBrowser`，加载 `resources/webview/index.html`（`loadHTML` 或自定义 scheme，推荐自定义 scheme 以便用 ES module）。
2. `WebViewBridge`：Kotlin → JS 用 `browser.cefBrowser.executeJavaScript(...)`；JS → Kotlin 用 `JBCefJSQuery`。
3. 前端：消息列表 + 输入框 + 发送。`prompt` 命令、`abort` 按钮。
4. 流式渲染，含 5.4 的 reducer 与 rAF 节流。
5. 状态行：模型名、思考档位、`isStreaming`、上下文用量（`get_session_stats`）。
6. 错误呈现：`success:false` 的响应、`stopReason: "error"` 的 assistant 消息、进程退出。

验收：见第 1 节成功判据 1。

### M2 — 富渲染（6-8 人日）

任务：

1. 工具卡片映射（下表）。
2. `edit` diff：从 `tool_execution_start.args.edits[]` 取 `oldText`/`newText`，前端用 `jsdiff` 生成行级 diff；`tool_execution_end` 后按 `details` 校正（若详情里带行号）。
3. diff 点击跳转：Kotlin 侧 `OpenFileDescriptor(project, vf, line, col).navigate(true)`。
4. thinking 块折叠 + `setHiddenThinkingLabel` 尊重。
5. Markdown：流式渲染要防抖，代码块未闭合时按普通文本渲染，闭合后高亮。
6. 子 agent 工具调用：事件带 `parentToolCallId`，渲染成嵌套卡片。
7. `bash` 输出的 `bash_execution_update` 增量追加到对应卡片；`full_output_path` 提供「打开完整输出」。
8. 图片内容块（`ImageContent`）直接渲染 data URL。

工具卡片映射：

| 工具 | 参数 | 卡片形态 |
|---|---|---|
| `read` | `path`, `offset`, `limit` | 文件路径 chip + 行号范围 |
| `edit` | `path`, `edits[]` | diff 视图，路径可点击 |
| `write` | `path`, `content` | 新建/覆盖标记 + 折叠的完整内容 |
| `bash` | `command`, `timeout` | 命令块（等宽）+ 输出终端风格，可折叠 |
| `grep` | `pattern`, `path`, `glob`, `ignoreCase` | 搜索 chip + 命中列表（可点击跳转） |
| `find` | `pattern`, `path`, `limit` | 文件 chips |
| `ls` | `path`, `limit` | 目录树片段 |
| 未知工具 | 任意 | 通用 JSON 折叠卡片 |

验收：完整跑一个「读文件 → 改文件 → 跑测试」任务，diff 可点击跳转到正确行。

### M3 — 会话与配置（5-6 人日）

任务：

1. `SessionIndex`：扫 `~/.pi/agent/sessions/--<safe-path>--/*.jsonl`，只读文件头（`session-manager.ts:604` 有 4096 字节 header 扫描的既有实现可参照），拿 `id`/时间/名称/消息数。
2. 会话列表 UI，切换走 `switch_session`，新建走 `new_session`。
3. 会话树：`get_tree` 返回 `SessionTreeNode[]`，每个节点可 `fork`（`entryId`）。注意 fork 返回 `{text, cancelled}`。
4. 模型选择器：`get_available_models` + `set_model`。列表可能上千条（见 `model-registry.ts`），需要搜索过滤与虚拟滚动。
5. 思考档位：`get_available_thinking_levels` + `set_thinking_level`。
6. 压缩：`compact`，展示 `compaction_start`/`compaction_end` 进度；`set_auto_compaction` 开关。
7. 重试：`auto_retry_start`/`auto_retry_end` 提示；`abort_retry`。
8. slash 命令补全：`get_commands` 拿到 `{name, description, source}`，输入框前缀 `/` 时补全。注意 `source` 为 `extension`/`prompt`/`skill` 三类。

验收：见成功判据 3。

### M4 — 扩展 UI、审批、上下文注入（6-8 人日）

任务：

1. 5.5 表格里 M4 列的全部实现。
2. **审批流**：pi 没有内置「运行 bash 前确认」。实现方式是在插件目录放一个扩展 JS/TS 文件，注册 tool call hook（见 `docs/extensions.md` 的 hook 事件名），在 `tool_execution_start` 前调 `ctx.ui.confirm()`. 确认走 `extension_ui_request` → Kotlin 对话框 → `extension_ui_response`。默认只对 `bash` 与 `write` 开启，可配置。
3. **上下文注入**（替代 RPC 模式不支持的 `@file`）：
   - 编辑器右键「Send to pi」：取选区/当前文件，拼成 `--- path:line-range ---` 块追加到消息。
   - 不传文件全文，只传路径与行范围，让 pi 用 `read` 工具自己读 —— 省 token 且能保证读到最新内容。
   - 图片：`prompt` 的 `images` 字段收 base64 + mimeType，从剪贴板或编辑器截图注入。
4. 诊断与设置页：node 路径、pi 版本、日志目录、审批开关。
5. `packages/protocol` 或 `scripts/dump-rpc-schema.ts` 的 CI 校验落地。

验收：扩展触发 `select` 时 GUI 弹出可用对话框；bash 工具调用前有确认；编辑器发送选区能正确进入上下文。

### M5 — 硬化（4-5 人日）

任务：

1. 进程僵死检测：`get_state` 心跳（30s 一次），连续 2 次超时则重启进程并提示。
2. 崩溃恢复：进程非零退出时保留会话文件路径，自动 `switch_session` 恢复。
3. 大输出保护：单条工具结果超 2MB 只渲染摘要 + 「打开完整输出」（`full_output_path`）。
4. 主题：跟随 IDE 的 Darcula/IntelliJ Light，通过 `EditorColorsScheme` 或其他方式把色板注入前端 CSS 变量。
5. 高 DPI、字体缩放、IME 中文输入（JCEF 的 IME 需要显式开启）。
6. 无障碍：`JBCefBrowser` 的可访问性树需要手动接线，至少保证键盘可操作。

---

## 7. 关键技术细节

### 7.1 Node 运行时

pi 要求 node >= 22.19（`package.json` 的 `engines`）。插件自带二进制是最稳的，理由：用户机器上的 node 版本不可控，而 npm 全局安装的 pi 经常跑在 nvm 管理的旧版本上。

做法：按 `<os>-<arch>` 分发 node 二进制到 `resources/node/`，首次使用时解压到 `PathManager.getSystemPath()/pi-runtime/<version>/`，加可执行位。Windows 只放 `node.exe`。

### 7.2 进程生命周期

- 每个 `Project` 一个 `PiClient`，注册为 project-level service（`project.service<PiChatService>()`）。
- 绑在 `ProjectCloseListener` 与 `AppLifecycleListener`（`Disposer`）。
- 一个 IDE 开多个项目 = 多个进程，各带各的 cwd。不要做全局共享，cwd 是核心上下文。
- `--session-dir` 指向插件自己的目录，避免和 CLI 会话混在一起造成用户困惑（M3 起可配置成共享，以便 GUI/CLI 互相接续）。

### 7.3 JSONL 读写细节

写入：`Process.getOutputStream()` 包 `BufferedWriter`，**每行后 flush**，否则 pi 收不到。不要用 `PrintWriter`（会吞异常）。

读取用独立线程，不要占 EDT：

```kotlin
thread(name = "pi-stdout", isDaemon = true) {
    val buffer = ByteArrayOutputStream(64 * 1024)
    val input = process.inputStream
    var b: Int
    while (input.read().also { b = it } != -1) {
        if (b == '\n'.code) {
            val line = buffer.toString(Charsets.UTF_8.name())
            buffer.reset()
            if (line.isNotBlank()) dispatch(line)
        } else {
            buffer.write(b)
            if (buffer.size() > MAX_LINE_BYTES) { /* 记录并断开 */ }
        }
    }
}
```

逐字节 `read()` 在 1MB/s 下约 1M 次系统调用会慢。优化成 `read(byteArray)` 分批加环形缓冲，或直接用 `BufferedReader.readLine()` 并单独用 `Reader` 包 `InputStreamReader(UTF_8)` —— 后者正确处理了多字节字符跨块，但失去行上限控制，可以包一层自定义 `Reader` 限长。

**推荐**：`BufferedReader(InputStreamReader(stream, UTF_8))` + 外层统计行长并限长。代码短、正确性有保证。

stderr 单独线程读，写入 IDE 日志的独立 category（`#pi`），不要混进 stdout。

### 7.4 WebView bridge

前端契约（`web/postbuild` 注入到 `window`）：

```ts
declare global {
  interface Window {
    piHost: {
      post(msg: HostOutbound): void;   // JS -> Kotlin
      onMessage(cb: (msg: HostInbound) => void): void;  // Kotlin -> JS
    }
  }
}
```

Kotlin 侧：

```kotlin
class WebViewBridge(private val browser: JBCefBrowser) {
    private val jsQuery = JBCefJSQuery.create(browser as JBCefBrowserBase)
    fun setup() {
        jsQuery.addHandler { json -> handleFromJs(json); null }
        val script = """
            window.piHost = {
              post: (msg) => ${jsQuery.inject("JSON.stringify(msg)")},
              onMessage: (cb) => { window.__piCb = cb; }
            };
        """.trimIndent()
        browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
    }
    fun send(msg: HostInbound) {
        val ctx = browser.cefBrowser.mainFrame ?: return
        ctx.executeJavaScript("window.__piCb && window.__piCb(${Json.encodeToString(msg)})", ctx.url, 0)
    }
}
```

注意：不同 IntelliJ 平台版本的 `JBCefJSQuery.create` 签名有变化（旧版只收 `JBCefBrowser`，新版收 `JBCefBrowserBase`）。用 `sinceBuild` 约束并在构建时按 platform version 选，不要写死。

`executeJavaScript` 有大小限制且要转义。大对象（完整消息历史）改用一次性注入的 JSON script tag 或 `window.piHost.onMessage` 分批推。单条超过约 1MB 时切片传输并在前端重组。

### 7.5 流式渲染策略

三层缓冲，缺一不可：

1. **Kotlin 侧**：事件通过 `MutableSharedFlow(extraBufferCapacity = 256, onBufferOverflow = DROP_OLDEST)` 分发，但 `message_end` / `tool_execution_end` 必须用无丢弃通道，否则状态错乱 —— 用两个 flow 或标记关键事件走 `send` 而非 `tryEmit`。
2. **桥接层**：按 16ms 合并待发消息，delta 合并成一条（同 `contentIndex` 的多个 delta 拼成一个字符串）。
3. **前端**：`requestAnimationFrame` 里一次性 flush 到 React state。

### 7.6 工具结果渲染

`tool_execution_end.result` 的形态因工具而异（`bash` 有 `output`/`full_output_path`，`read` 有内容块，`edit` 有 `details`）。**不要**在前端做严格类型，用判别式宽松解析：有 `output` 当终端，有 `content` 当文本数组，否则 JSON 折叠。

`details` 字段带结构化信息（如 `EditToolDetails` 带实际改动的行号），优先用它，不要在前端重算。

### 7.7 diff 展示

两条路径，都要：

- **调用中预览**：`tool_execution_start.args.edits[]` 已有 `oldText`/`newText`，`jsdiff` 直接算。注意 pi 的编辑匹配有 BOM 剥离和唯一性检查（`edit.ts:190`），前端预览可能与实际不符，标注「预览」。
- **结果校正**：`tool_execution_end` 后用 `details` 里的实际位置覆盖。

跳转：diff 右侧行号点击 → Kotlin 打开 `VirtualFile` 并 `navigate(true)`。注意项目外的绝对路径要 `LocalFileSystem.findFileByPath`，失败则提示。

### 7.8 会话索引

只读文件头，不要全量解析。参照 `session-manager.ts:604-608` 的 `MAX_SESSION_HEADER_SCAN_BYTES = 1MB`。Kotlin 侧读前 4KB 找第一行（header 是一个 JSON 对象），拿 `id`/`version`/`timestamp`/`cwd`。消息数与名称需要多读一点，可延迟加载。

目录名规则：cwd 去掉前导分隔符，`/`、`\`、`:` 全替换成 `-`，前后各加 `--`。Windows 路径的 `D:\workspace\pi` 会变成 `--D-workspace-pi--`。

### 7.9 上下文注入

RPC 拒绝 `@file`（`docs/rpc.md` 明确说明）。替代方案：

```
--- src/foo.ts:40-88 ---
```

只给路径与行范围。理由：pi 的 `read` 工具会自己读，能保证内容是最新的，且避免重复传输大文件。若用户明确要贴内容（比如未保存的缓冲区），则在 `--- path:lines (buffer) ---` 后附上文本，并提示「未保存缓冲区内容」。

未保存的编辑器内容必须显式处理：直接给路径会让 pi 读到磁盘旧版本。检测 `FileDocumentManager.isDocumentUnsaved()` 后附内容。

### 7.10 审批流扩展

pi 的无审批设计是刻意的（见 `AGENTS.md` 的删除规则），不要试图改 core。插件卸载时删掉扩展。

扩展形态：插件 resources 里放 `guards.ts`，加载方式见 `docs/extensions.md` 的 extension 发现规则（`~/.pi/agent/extensions`）。插件启动 pi 时通过 `PI_*` 环境变量或 `--extension` 参数指向插件目录（需在 M0 确认当前版本的实际参数，`cli.md` 为准）。

---

## 8. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| 扩展的自绘 UI 在 GUI 中缺失 | 中。生态里相当一部分扩展靠 `ctx.ui.custom()` 画界面 | M4 前明确告知；提供 `setWidget` 纯文本降级；文档列出已知不兼容扩展 |
| RPC 协议字段漂移 | 中。静默失败难查 | 决策 4 的 schema 校验 + 单元测试用录制样本 |
| `message_update` 无 `partial` 导致前端状态机出错 | 高。表现为文本重复或丢失 | 严格用 `message_end` 覆盖；写 reducer 单测覆盖断流、乱序 delta |
| JCEF 内存与启动开销 | 低-中 | 延迟创建、项目关闭时释放 |
| node 版本探测失败 | 中。用户看到莫名其妙的启动失败 | 内置 node；错误信息带检测到的版本与要求 |
| pi 版本升级破坏启动参数 | 中 | 锁定版本区间；启动失败时回退到上一版本并提示 |
| 大 diff / 大文件在 JCEF 里卡死 | 中 | 超过阈值只渲染折叠摘要 |
| 同步阻塞 EDT | 高。IDE 卡顿 | 所有 IO 走 `AnalyticsTracker`/协程 `Dispatchers.IO`，桥接用 `invokeLater` |

---

## 9. 测试策略

1. **协议解析单测**：把 `examples/rpc-client.ts` 跑出来的真实事件流录成 `fixtures/*.jsonl`，喂给 `JsonlReader` + 反序列化，断言不抛异常、关键字段正确。
2. **reducer 单测**：纯函数，覆盖正常流、`text_delta` 在 `text_start` 之前到达、`done` 缺 `message`、`error` 中断、工具结果先于 `toolcall_end` 到达。
3. **假进程**：`node fake-pi.mjs` 读脚本化的命令-响应表，用于无需真实 LLM 的端到端测试。
4. **UI 冒烟**：Gradle `runIde` 手动 checklist（首版不做自动化 UI 测试，JCEF 自动化成本高）。
5. **CI**：Kotlin 侧 `./gradlew check`；前端 `vitest` + `tsc --noEmit`；`dump-rpc-schema.ts` 与 pinned 版本比对。
6. **回归样本**：每次 pi 升级，重跑 fixtures，diff 输出。

注意：**不要**在测试里调真实 provider。需要模型行为时用 pi 的 faux provider（`packages/coding-agent/test/suite/harness.ts` 是参照）。

---

## 10. 性能预算

| 指标 | 目标 |
|---|---|
| 冷启动到可输入 | < 3s（含 node 与 JCEF） |
| 首 token 到屏 | < 150ms（不含模型延迟） |
| 流式渲染帧率 | 稳定 60fps，长消息不抖 |
| 1000 条历史消息打开 | < 1s，虚拟滚动 |
| 常驻内存增量 | < 200MB |
| 单条 5MB 工具输出 | 不冻结 UI，摘要渲染 |

---

## 11. 待决问题

1. **会话目录共享还是隔离**。隔离（插件自有目录）避免污染 CLI 会话，但用户无法跨 GUI/CLI 接续同一段对话。建议：默认隔离，设置项可改共享。
2. **是否内置 pi 包而非依赖用户安装**。内置可保证版本匹配，但要跟 pi 发布节奏同步发包，且 pi 体积不小。建议 M0 先探测，M5 再决定是否内置。
3. **前端与插件是否同仓**。`web/` 可以直接放在插件仓库里由 Gradle 触发构建，也可以独立发布 npm 包。建议同仓，减少版本对齐成本。
4. **扩展目录的官方加载方式**。需要按当前 pi 版本的 `cli.md`/`extensions.md` 确认，M4 前必须确认，否则审批流方案要重做。
5. **是否需要多 tab 会话**。首版一个项目一个会话。多 tab 意味着多个 `pi` 进程或 `new_session` 切换，架构上可行但状态同步复杂度上升。建议 M5 后评估。

---

## 12. 附录：协议样本

一次带工具调用的完整往返（简化，省略部分字段）：

```jsonl
{"id":"req-1","type":"prompt","message":"看看 src/index.ts 有几行"}
{"type":"agent_start"}
{"type":"message_start","message":{"role":"user","content":"看看 src/index.ts 有几行","timestamp":1730000000000}}
{"type":"message_end","message":{"role":"user","content":"看看 src/index.ts 有几行","timestamp":1730000000000}}
{"type":"message_start","message":{"role":"assistant","content":[],"api":"anthropic","provider":"anthropic","model":"claude-sonnet-4-5","usage":{},"stopReason":null,"timestamp":1730000000100}}
{"type":"message_update","usage":{},"assistantMessageEvent":{"type":"text_start","contentIndex":0}}
{"type":"message_update","usage":{},"assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"我先读"}}
{"type":"message_update","usage":{},"assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"一下这个文件。"}}
{"type":"message_update","usage":{},"assistantMessageEvent":{"type":"text_end","contentIndex":0,"content":"我先读一下这个文件。"}}
{"type":"message_update","usage":{},"assistantMessageEvent":{"type":"toolcall_start","contentIndex":1,"id":"call_abc","toolName":"read"}}
{"type":"message_update","usage":{},"assistantMessageEvent":{"type":"toolcall_delta","contentIndex":1,"delta":"{\"path\":\"src/index.ts\"}"}}
{"type":"message_update","usage":{},"assistantMessageEvent":{"type":"toolcall_end","contentIndex":1,"toolCall":{"type":"toolCall","id":"call_abc","name":"read","arguments":{"path":"src/index.ts"}}}}
{"type":"message_update","usage":{"input":120,"output":30},"assistantMessageEvent":{"type":"done","reason":"toolUse","message":{}}}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"我先读一下这个文件。"},{"type":"toolCall","id":"call_abc","name":"read","arguments":{"path":"src/index.ts"}}],"usage":{"input":120,"output":30},"stopReason":"toolUse","timestamp":1730000000100}}
{"type":"tool_execution_start","toolCallId":"call_abc","toolName":"read","args":{"path":"src/index.ts"}}
{"type":"tool_execution_end","toolCallId":"call_abc","toolName":"read","result":{"content":[{"type":"text","text":"1\timport ..."}],"details":{}},"isError":false,"durationMs":3}
{"type":"response","id":"req-1","command":"prompt","success":true,"data":{"disposition":"started"}}
```

注意最后一行：`prompt` 的响应可能在流式事件**之后**才到达，因为它只表示「已受理」。前端不要等响应才渲染。

---

## 附：第一周的具体动作

1. 在本仓库初始化 Gradle 工程，`gradlew runIde` 能起来空窗口。
2. 写 `NodeRuntimeResolver` 与 `PiProcess`，命令行 `get_state` 打通，日志里看到 `sessionId`。
3. 录 5 分钟 TUI 会话的事件流作为第一批 fixture。
4. 前端跑一个静态 `prompt` 流渲染 demo，不接 IDE。
5. 第 5 天评审 M0 验收项，确认 `inheritsFrom`、`sinceBuild`、JCEF API 版本。
