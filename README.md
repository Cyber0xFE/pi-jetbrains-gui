# Pi JetBrains GUI

在 IntelliJ IDEA 系列 IDE 中使用 [pi](https://github.com/badlogic/pi-mono) coding agent 的图形界面插件。
插件通过 `pi --mode rpc` 启动本地子进程，并在 IDE 的 Pi 工具窗口中显示对话、工具调用和 diff。

## 功能

- 在 IDE 内发送消息并查看流式回复
- 展示文件读取、编辑、终端等工具调用结果
- 将 diff 跳转到对应编辑器位置
- 保存和恢复 pi 会话
- 自动附加当前编辑器选区作为上下文
- 跟随 IDE 明暗主题切换界面
- 在设置中配置 Node.js 路径、日志目录和任务完成提示音

## 使用要求

- IntelliJ IDEA 2024.2 或更高版本（插件最低构建号 `242`）
- Java 21（构建插件时使用）
- Node.js `22.19.0` 或更高版本
- 已安装 pi coding agent：

  ```bash
  npm install -g @earendil-works/pi-coding-agent
  ```

插件会按以下顺序查找 pi：设置中配置的入口、插件内置副本、npm 全局安装目录。
Node.js 会优先从设置指定路径和系统 `PATH` 中查找。

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

## 使用

1. 在 IDE 中安装构建生成的 ZIP 插件，或使用 `runIde` 启动开发 IDE。
2. 打开右侧的 **Pi** 工具窗口。
3. 在 `Settings | Tools | Pi` 中检查 Node.js 路径和日志目录。
4. 在输入框发送消息，或在编辑器中选中文本后通过控制台上下文菜单发送给 Pi。

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

## 许可证和反馈

项目地址：[Cyber0xFE/pi-jetbrains-gui](https://github.com/Cyber0xFE/pi-jetbrains-gui)
