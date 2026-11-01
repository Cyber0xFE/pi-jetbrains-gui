# AGENTS.md

## 自动构建

- 代码改动完成后**必须自动重新构建插件**，无需用户提醒：
  - 修改 `web/src` 或 `src/main/kotlin` 下代码后：执行 `./gradlew buildPlugin`（或 `gradlew.bat`）验证并打包插件。
  - 构建失败则修复后重试，直到构建通过再交付。
  - `buildPlugin` 成功后会自动为本机 PyCharm 和 IntelliJ IDEA 排队插件更新；交付时说明排队结果，并提醒用户重启 IDE 自动安装生效。不要自动关闭或重启 IDE。
  - 自动安装失败时修复或明确报告失败，不能把仅打包成功当成安装成功。

## 提交信息

- 编写 Git commit message 时优先使用中文。
