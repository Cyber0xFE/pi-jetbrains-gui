# Pi JetBrains GUI

在 IntelliJ IDEA 系列 IDE 中使用 [pi](https://github.com/badlogic/pi-mono) coding agent 的图形界面插件。
插件通过 `pi --mode rpc` 启动本地子进程，并在 IDE 的 Pi 工具窗口中显示对话、工具调用和 diff。

## 功能

- 在 IDE 内发送消息并查看流式回复
- 顶部支持多个任务标签页，每个标签页使用独立 pi 进程，可同时执行不同任务
- 展示文件读取、编辑、终端等工具调用结果
- 将 diff 跳转到对应编辑器位置
- 保存和恢复 pi 会话
- 自动附加当前编辑器选区作为上下文
- 跟随 IDE 明暗主题切换界面
- 在设置中配置 Node.js 路径、网络代理、日志目录和任务完成提示音
- 选择模型和思考级别，查看上下文用量与 token 统计
- 创建、切换、重命名、删除和 fork 会话，并在会话树中查看分支
- 使用 `/` 浏览 pi 命令，使用 `@` 引用项目文件
- 手动压缩上下文、配置自动压缩，并中止自动重试
- 支持 pi 扩展弹窗、通知、状态文本和状态栏控件
- 将文件、URL、终端输出和 diff 位置直接跳转到 IDE
- 将图片粘贴到输入框并随消息发送

## 使用要求

- IntelliJ IDEA 2024.2 或更高版本（插件最低构建号 `242`）
- Java 21（构建插件时使用）
- Node.js `22.19.0` 或更高版本
- 已安装 pi coding agent：

  ```bash
  npm install -g @earendil-works/pi-coding-agent
  ```

插件会按以下顺序查找 pi：设置中配置的入口、插件内置副本、npm 全局安装目录。
Node.js 会优先从设置指定路径和系统 `PATH` 中查找。若启动失败，先在设置中填写可执行的 Node.js 路径，并检查 pi CLI 已按上面的命令安装。

## 构建和运行

在项目根目录执行：

```bash
./gradlew buildPlugin
```

Windows PowerShell：

```powershell
.\gradlew.bat buildPlugin
```

运行带插件的开发 IDE：

```bash
./gradlew runIde
```

插件包会生成在 `build/distributions/`。Gradle 构建会自动安装 webview 依赖，并将 React/TypeScript 前端打包进插件资源。

Windows 本机构建成功后，还会自动为 `%APPDATA%/JetBrains/` 下已有的 IntelliJ IDEA 和 PyCharm 配置目录（2024.2 及以上版本）安排插件更新。使用各 IDE 自带的启动更新队列，保留其他待安装插件，不覆盖运行中占用的 JAR。重启对应 IDE 时自动安装；构建不会自动关闭 IDE。构建日志中的 `Queued plugin update` 表示更新已排队，尚未在运行中的 IDE 生效。

仅打包、不安装：`./gradlew buildPlugin -PinstallLocalPlugin=false`。指定本机配置目录可传 `-PlocalIdePluginDirs=目录1;目录2`（PowerShell 中请将整个参数加引号）；这里填写的是各 IDE 的 `plugins` 目录，须有对应的 `%LOCALAPPDATA%/JetBrains/<配置目录名>/.home` 记录。自定义缓存路径暂不支持。

## 使用

1. 在 IDE 中安装构建生成的 ZIP 插件，或使用 `runIde` 启动开发 IDE。
2. 打开右侧的 **Pi** 工具窗口。
3. 在 `Settings | Tools | Pi` 中检查 Node.js 路径和日志目录。需要代理时，在“网络代理”中填写完整地址（例如 `http://127.0.0.1:7890`），插件会向 Pi 子进程同时注入 `HTTP_PROXY` 和 `HTTPS_PROXY`（不影响 IDE 或其他应用）。应用代理更改会重启已启动标签页的 Pi 进程并恢复原会话，正在执行的任务会中断；尚未启动的标签页在下次启动时使用新设置。留空则不覆盖从 IDE 继承的系统代理环境变量。
4. 在输入框发送消息，或在编辑器中选中文本后通过控制台上下文菜单发送给 Pi。
5. 点击 Pi 工具窗口顶部的 **＋** 新建任务标签页；切换标签页不会中断后台任务。关闭标签页会停止其进程，正在执行任务时会先确认；历史会话仍可从会话列表恢复。控制台“发送到 Pi”会发送到当前选中的标签页。

会话列表支持新建、切换、重命名、删除和 fork；切换一个已在其他标签页打开的会话时，会直接跳转到那个标签页，而不会重复加载。删除当前会话前，插件会先切换到新的会话，避免 pi 继续写入待删除的文件。模型选择器会把选中的默认模型同步到 pi 的用户设置；会话级切换仍由当前会话控制。

### 设置和快捷键

在 `Settings | Tools | Pi` 中可以配置 Node.js 路径、网络代理、聊天字体大小（10–32px）、诊断日志目录、任务完成提示音，以及所有 Pi 面板快捷键。默认快捷键如下：

| 操作 | 默认快捷键 |
| --- | --- |
| 打开 Pi 面板 | `Ctrl+Alt+K` |
| 新建标签页 | `Ctrl+Shift+O` |
| 关闭标签页 | `Ctrl+W` |
| 上一个/下一个标签页 | `Ctrl+PageUp` / `Ctrl+PageDown` |
| 跳转到最新/第一条消息 | `Ctrl+End` / `Ctrl+Home` |
| 上一条/下一条用户消息 | `Ctrl+↑` / `Ctrl+↓` |

快捷键会写入当前 IDE keymap；如果当前 keymap 不可修改，插件会创建名为 `Pi JetBrains GUI` 的派生 keymap。代理设置只注入 Pi 子进程的 `HTTP_PROXY` 和 `HTTPS_PROXY`，不会修改 IDE 或其他进程的环境变量。

### 故障排查

- Pi 无法启动：确认 Node.js 为 `22.19.0` 或更高版本，并在设置中检查 Node.js 路径；必要时重新执行 pi CLI 全局安装命令。
- 消息或工具输出异常：在设置中指定诊断日志目录，复现问题后附上相关日志和 IDE 版本。
- 修改代理或 Node.js 设置后：已经启动的标签页会重启 Pi 进程并恢复会话，正在执行的任务会中断。
- WebView 空白：使用 `./gradlew buildPlugin`（Windows 使用 `gradlew.bat buildPlugin`）重新生成内置前端资源，并确认目标 IDE 支持 JCEF。

## 开发

前端代码位于 `web/src`，Kotlin 插件代码位于 `src/main/kotlin`。

```bash
cd web
npm ci
npm run typecheck
npm test
npm run build
```

RPC 协议参考 `rpc-schema.json`。项目设计和阶段计划见 `JETBRAINS_GUI_PLAN.md`。
前端改动完成后，可在 `web` 目录运行 `npm run typecheck && npm test`；插件产物的最终验证以根目录的 `buildPlugin` 为准。RPC 协议快照由 `rpc-schema.json` 固定，升级 pi 后请先运行 `dumpRpcSchema` 检查协议漂移。

## 许可证和反馈

项目地址：[Cyber0xFE/pi-jetbrains-gui](https://github.com/Cyber0xFE/pi-jetbrains-gui)
