# AGENTS.md

## 自动构建

- 代码改动完成后**必须自动重新构建插件**，无需用户提醒：
  - 修改 `web/src` 或 `src/main/kotlin` 下代码后：执行 `./gradlew buildPlugin`（或 `gradlew.bat`）验证并打包插件。
  - 构建失败则修复后重试，直到构建通过再交付。
