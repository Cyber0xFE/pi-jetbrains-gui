# AGENTS.md

## 项目概览

- 本项目是将 `pi --mode rpc` 集成到 IntelliJ IDEA 系列 IDE 的插件。
- 插件后端使用 Kotlin/JVM，前端 WebView 使用 React + TypeScript + Vite。
- Kotlin 代码位于 `src/main/kotlin`，前端代码位于 `web/src`，测试分别位于 `src/test/kotlin` 和 `web/src/**/*.test.tsx` / `web/src/**/*.test.ts`。
- RPC 协议快照位于 `rpc-schema.json`；协议来源默认是相邻目录 `../pi` 中的 pi 源码，也可通过 `-PpiSourceDir=<目录>` 指定。
- 详细产品设计和阶段计划见 `JETBRAINS_GUI_PLAN.md`，使用说明和公开构建文档见 `README.md`。

## 技术与环境要求

- IntelliJ IDEA 2024.2 或更高版本，插件最低构建号为 `242`；当前使用 IntelliJ Platform `2024.3.1` 编译。
- JDK 21。Gradle Kotlin DSL 已配置 `jvmToolchain(21)`。
- Node.js `22.19.0` 或更高版本，以及可执行的 `npm`。
- 使用前需要安装 pi coding agent：

  ```bash
  npm install -g @earendil-works/pi-coding-agent
  ```

- Windows 优先使用仓库中的 `gradlew.bat`；类 Unix 环境使用 `./gradlew`。

## 目录与职责

- `src/main/kotlin/dev/pi/jetbrains/runtime` 负责 Node.js/pi 的发现和进程启动；`rpc` 负责 JSONL 读写、协议模型和会话事件。
- `src/main/kotlin/dev/pi/jetbrains/session` 只处理会话文件索引和树结构；`ui` 负责工具窗口、WebView bridge 和宿主消息；`editor` 负责编辑器/控制台上下文和文件导航。
- `web/src/state` 维护前端会话 reducer，`web/src/components` 负责消息、工具卡片、会话选择器和输入框，`web/src/bridge.ts` 只负责与宿主通信。
- `web/dist` 是前端生成目录，Gradle 会把其中的单文件 `index.html` 复制到插件资源；不要直接编辑生成文件。

新增功能前先确定它属于 Kotlin 宿主、WebView，还是两者之间的消息契约。跨层消息应先在 `HostMessages.kt`、`web/src/types.ts` 和对应 reducer/组件中定义，再补充序列化测试；不要在 bridge 中实现会话或进程业务逻辑。

## 开发工作流

1. 开始工作前先查看 `git status --short`，不要覆盖或回退用户已有的未提交改动。
2. 修改前端时优先在 `web` 目录执行类型检查和测试；修改 Kotlin、RPC、资源或构建脚本时执行对应的 Gradle 检查。
3. 前后端通信必须遵守 `rpc-schema.json` 和现有 bridge/host 消息结构；协议变化时同步更新 schema、Kotlin 模型、Web 类型和测试。
4. 完成功能后运行相关测试，再按“自动构建”要求构建插件。
5. 交付前说明改动文件、验证命令及结果；不要擅自执行 `git commit` 或 `git push`。

文档改动也要检查命令、路径和版本号是否与 `build.gradle.kts`、`plugin.xml` 和设置界面一致。用户可见功能新增或变更时，同步更新 `README.md`；开发流程、测试边界和构建约定变更时，同步更新本文件。

## 常用命令

### 前端

在仓库根目录执行 `cd web` 后：

```bash
npm ci                 # 按 package-lock.json 安装依赖
npm run typecheck      # TypeScript 类型检查
npm test               # Vitest 测试
npm run build          # 类型检查、Vite 打包并内联为单文件 index.html
```

`web/dist` 和 `web/node_modules` 是生成目录/依赖目录，不应手工提交。前端构建会生成供插件打包的 WebView 资源。

### Kotlin 与插件

```bash
./gradlew test                 # Kotlin/JVM 测试
./gradlew check                # 检查，并校验/生成 RPC schema 快照
./gradlew buildPlugin          # 构建插件 ZIP，并按配置排队本机 IDE 更新
./gradlew runIde               # 启动带当前插件的开发 IDE
```

Windows PowerShell 对应使用：

```powershell
.\gradlew.bat buildPlugin
```

RPC schema 校验默认读取 `../pi`：

```bash
./gradlew dumpRpcSchema -PpiSourceDir=D:/workspace/pi
```

如果只需要打包而不向本机 IntelliJ IDEA/PyCharm 排队安装，可使用：

```bash
./gradlew buildPlugin -PinstallLocalPlugin=false
```

`buildPlugin` 的 ZIP 输出在 `build/distributions/`。默认情况下，Windows 构建成功后会向本机已发现的 IntelliJ IDEA 和 PyCharm 配置目录排队插件更新；构建不会关闭或重启 IDE，必须重启目标 IDE 后更新才会生效。构建日志中的 `Queued plugin update` 仅表示已排队，不表示当前运行中的 IDE 已经加载新版本。需要指定目标插件目录时使用 `-PlocalIdePluginDirs=目录1;目录2`。

本地安装逻辑要求目标 IDE 至少成功启动过一次，以便在 `%LOCALAPPDATA%/JetBrains/<配置目录名>/.home` 找到 IDE 安装目录。`localIdePluginDirs` 指向各 IDE 的 `plugins` 目录，不是 IDE 安装目录；自定义缓存路径当前不受支持。若只需验证 ZIP，可显式传入 `-PinstallLocalPlugin=false`。

## 自动构建

- 代码改动完成后**必须自动重新构建插件**，无需用户提醒：
  - 修改 `web/src`、`src/main/kotlin`、插件资源、协议模型或构建相关文件后：执行 `./gradlew buildPlugin`（Windows 使用 `gradlew.bat`）验证并打包插件。
  - 构建失败必须先修复并重试，直到构建通过后再交付；不要把仅通过前端测试或 Kotlin 测试当作插件构建成功。
  - `buildPlugin` 成功后会自动为本机 PyCharm 和 IntelliJ IDEA 排队插件更新；交付时说明排队结果，并提醒用户重启 IDE 自动安装生效。不要自动关闭或重启 IDE。
  - 若本机 IDE 更新排队失败，必须修复问题或明确报告失败原因，不能把“仅 ZIP 打包成功”描述为本地安装成功。
- **提交代码（用户要求 `git commit`）时不需要先构建插件**：提交前跑相关测试即可，构建插件只在功能交付时执行，不要因提交而额外触发 `buildPlugin`。
- 只修改文档、测试说明或其他不影响插件产物的文件时，可不执行插件构建，但应在交付说明中明确未构建的原因。

## 代码约定

- 按现有代码风格保持最小改动，不为单一需求顺手引入无关重构、依赖或 UI 变化。
- Kotlin 后端负责 IDE 生命周期、进程管理、RPC、会话持久化、文件导航和设置；React 前端负责消息展示、交互状态、工具卡片和主题样式。新增逻辑放在职责所属层，避免在 bridge 中堆积业务逻辑。
- WebView 与宿主之间的消息必须保持可序列化、可回归测试；涉及异步消息、进程退出、会话切换、取消操作时补充异常和竞态测试。
- UI 改动同时检查 IntelliJ 明暗主题、长文本、空状态、错误状态、滚动行为和键盘操作。
- 外部 pi 进程的输出不可盲信；沿用现有 JSONL 解析、错误处理、日志和资源释放方式，避免阻塞 IDE UI 线程。
- stdout 是 JSONL 协议，stderr 只用于诊断日志；不要把诊断文本混入协议流。未知的 pi 会话事件应记录并忽略，不能因为新版本增加事件类型而使旧插件崩溃。
- 会话切换、fork、新建和代理变更都可能使旧进程的异步事件晚到；使用现有的会话代次/重置机制丢弃过期事件，避免旧消息写入新会话。
- 日志可能包含项目路径、提示词和工具输出；诊断日志默认关闭，测试和文档示例不要提交真实日志或用户数据。
- 不要提交本地构建产物、依赖目录、IDE 配置或日志：包括 `build/`、`out/`、`.gradle/`、`.idea/`、`.kotlin/`、`.intellijPlatform/`、`web/node_modules/` 和 `web/dist/`。

## 测试重点

- RPC/进程相关改动：运行 `JsonlReaderTest`、`PiClientTest` 及相关 Gradle 测试，必要时检查 `src/test/resources/fake-pi/fake-pi.mjs`。
- 会话、文件引用和 IDE 导航改动：运行对应的 `Session*Test`、`ProjectFileCollectorTest`、`ToolFileRefresherTest` 和 `EditorNavigator` 相关测试。
- WebView 状态或组件改动：运行 `cd web && npm run typecheck && npm test`，并为 reducer、消息渲染、滚动、工具卡片和主题相关行为补测试。
- 修改 `HostMessages`、RPC 模型或 Web 类型时，至少运行 Kotlin 测试、前端类型检查和前端测试；协议来源变化时额外运行 `dumpRpcSchema` 或 `./gradlew check`。
- 涉及真实 Node/pi 环境的测试可能依赖本机安装；若环境不满足，应报告跳过或失败原因，不要伪造通过结果。

## 交付检查

- 确认 `git diff --check` 通过，且没有把 `build/`、`web/dist/` 或 `web/node_modules/` 加入变更。
- 代码或插件资源改动必须报告 `buildPlugin` 结果；构建成功但本机更新排队失败时，明确说明失败的 IDE 配置目录和原因。
- 文档、测试说明或计划文件的纯文本改动可以跳过插件构建，但交付时要明确说明未构建。
- 不要为了验证而关闭或重启用户正在运行的 IDE；只报告构建排队结果，并提示用户自行重启后生效。

## Git 与安全

- 提交信息优先使用简体中文；约定式前缀如 `feat:`、`fix:` 可保留英文。不要添加 `Co-Authored-By` 等未经要求的署名。
- 提交代码不需要先构建插件，跑相关测试通过后即可直接提交。
- 未经用户明确指令，不执行 `git commit`、`git push`、`git reset --hard`、`git clean -f` 或其他不可逆操作。
- 删除文件或目录必须移入系统回收站，不得使用 `rm -rf`、`Remove-Item -Force`、`del`、`os.remove` 等永久删除方式；覆盖未提交改动前必须先征得用户确认。
