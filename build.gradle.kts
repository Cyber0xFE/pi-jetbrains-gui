plugins {
    kotlin("jvm") version "2.0.21"
    kotlin("plugin.serialization") version "2.0.21"
    id("org.jetbrains.intellij.platform") version "2.10.5"
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity(providers.gradleProperty("platformVersion"))
        // Note: when bumping platformVersion to 2025.3.1+, add
        // bundledPlugin("com.intellij.modules.jcef") here: JCEF moved to the bundled
        // Web Browser (JCEF) plugin and out of the platform core. On 243 the
        // com.intellij.ui.jcef.* classes are still inside the core jars.
    }

    // The IDE ships kotlin-stdlib; keep it out of the plugin distribution.
    compileOnly(kotlin("stdlib"))
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    testImplementation(kotlin("test"))
    testImplementation(kotlin("stdlib"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.1")
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.3")
    // The platform test environment initializer (loaded by the IntelliJ test framework) links
    // against JUnit 4 classes even when tests themselves are JUnit 5.
    testImplementation("junit:junit:4.13.2")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

// kotlinx-serialization pulls kotlin-stdlib and JetBrains annotations transitively; the IDE
// already provides both, so keep them out of the packaged plugin.
configurations.matching { it.name.startsWith("runtime") }.configureEach {
    exclude(group = "org.jetbrains.kotlin", module = "kotlin-stdlib")
    exclude(group = "org.jetbrains.kotlin", module = "kotlin-stdlib-jdk8")
    exclude(group = "org.jetbrains", module = "annotations")
}

kotlin {
    jvmToolchain(21)
}

intellijPlatform {
    buildSearchableOptions = false

    pluginConfiguration {
        id = "dev.pi.jetbrains"
        name = providers.gradleProperty("pluginName")
        version = project.version.toString()

        ideaVersion {
            sinceBuild = providers.gradleProperty("pluginSinceBuild").get()
        }

        vendor {
            name = "Cyber0xFE"
            url = "https://github.com/Cyber0xFE/pi-jetbrains-gui"
        }

        description = """
            <b>pi</b> inside your IDE - a real chat panel for the pi coding agent, not another terminal tab.<br><br>
            This plugin runs your local <code>pi --mode rpc</code> and renders the conversation, tool calls, diffs and sessions in the <b>Pi</b> tool window. It works in <b>IntelliJ IDEA, PyCharm, WebStorm, GoLand, PhpStorm, CLion, Rider and RubyMine 2024.2+</b> - one plugin for the whole JetBrains family. Sessions stay in pi's own <code>~/.pi</code> format, models and extensions are the ones you already configured for the CLI, and nothing runs behind a proprietary backend: it is a focused alternative to heavyweight multi-engine AI plugins for people who already live in pi.<br><br>
            <b>What makes it different</b>
            <ul>
              <li><b>Parallel task tabs</b> - every tab owns its own pi process, so several tasks can run at once and switching tabs never interrupts background work.</li>
              <li><b>Steering and follow-up queues</b> - keep typing while pi streams: <code>Enter</code> queues steering (delivered after the current tool call), <code>Alt+Enter</code> queues a follow-up, exactly like the pi TUI.</li>
              <li><b><code>/btw</code> side questions</b> - ask something without interrupting the main task; the answer streams in a dismissible overlay and is not written into the session history.</li>
              <li><b>Session tree with fork</b> - create, switch, rename, delete, fork and inspect branches, one row per user message.</li>
              <li><b>IDE-native tool output</b> - tool cards for file reads, edits and terminal runs; click a diff to jump to the exact editor line.</li>
              <li><b>Shell in the composer</b> - <code>! cmd</code> keeps the output in the LLM context, <code>!! cmd</code> keeps it out, rendered as a terminal-style card.</li>
            </ul>
            <b>Everything else</b>
            <ul>
              <li>Streaming replies, thinking blocks, token usage and a context meter.</li>
              <li>Model and thinking-level pickers in the footer: search, provider grouping, <b>Set as default</b>, and custom models appended to <code>~/.pi/agent/models.json</code> without touching existing fields.</li>
              <li>Manual and automatic compaction, aborting automatic retries.</li>
              <li>Slash commands and project-file completion with <code>/</code> and <code>@</code>.</li>
              <li>Editor selection and console output attached as context; files, URLs, terminal output and diff lines open straight in the IDE.</li>
              <li>Image paste in the composer.</li>
              <li>Chat panel in English (default) and Simplified Chinese, switchable in settings.</li>
              <li>Full-text search in the transcript (<code>Ctrl+F</code>), with case, whole-word and regex modes.</li>
              <li>pi extension dialogs, notifications, status text and status-bar widgets.</li>
              <li>Light and dark IDE themes, accent color, chat font size, wheel sensitivity, optional chat background image.</li>
              <li>pi CLI path, Node.js runtime, proxy injection (subprocess only), diagnostic log directory, completion sound, and all panel shortcuts rebindable in the IDE keymap.</li>
            </ul>
            <b>Install in three steps:</b><br>
            1. <code>npm install -g @earendil-works/pi-coding-agent</code> (or use the official installer at pi.dev).<br>
            2. Install this plugin from the Marketplace.<br>
            3. Open the <b>Pi</b> tool window (<code>Ctrl+Alt+K</code>) and start a task.<br><br>
            <b>Requirements:</b> Node.js 22.19.0 or later, and the pi CLI installed separately. The plugin finds pi in your configured path, the bundled copy, <code>~/.pi/agent/install</code>, or the npm global prefix, and Node.js from settings/PATH with a fallback to pi's standalone Node.<br><br>
            <b>中文：</b>把 pi coding agent 接进 JetBrains IDE 的图形面板 - 多任务标签并行、会话树 fork、<code>/btw</code> 侧问、steering 队列、diff 一键跳转编辑器、模型与思考级别切换，会话保持 pi 原生格式。<br><br>
            Source code, issue tracker and full documentation: <a href="https://github.com/Cyber0xFE/pi-jetbrains-gui">github.com/Cyber0xFE/pi-jetbrains-gui</a>
        """.trimIndent()

        // 写法与结构见 docs/marketing/marketplace-listing.md 第 5 节。
        changeNotes = """
            <h2>What's New in 0.7.0</h2>
            <h3>Features</h3>
            <ul>
              <li><b>Custom models can now be edited and deleted:</b> hovering a model you added to <code>~/.pi/agent/models.json</code> reveals a pencil and a bin in the model popup. The pencil reopens the model form with every known field filled in (provider and model ID stay locked), and saving rewrites that entry in place: other provider fields are left as they are and the stored API key is only replaced when you type a new one. The bin turns into a red <b>confirm delete</b> in the same spot and needs a second click; afterwards pi restarts so the change takes effect (or, while pi is streaming, you are told it loads after the next restart). No more hand-editing JSON.</li>
              <li><b>Token fields accept <code>k</code> shortcuts:</b> context window and max output tokens take <code>128k</code>, <code>8k</code> or <code>1.5K</code> as well as plain numbers, so you no longer have to count zeros.</li>
              <li><b>The provider field is a combobox:</b> it lists the providers already in your model list, filtered as you type, and still accepts a new provider name.</li>
            </ul>
            <h3>Fixes</h3>
            <ul>
              <li><b>The edit and delete icons no longer reserve space:</b> they stay hidden until you hover, select or keyboard-focus the row, so model names and provider details keep their full width instead of trailing off in empty space.</li>
              <li><b>Settings can be opened again:</b> the Pi settings page now declares an id and a display name, so opening <b>Settings</b> no longer fails while loading the configurable.</li>
              <li><b>Chinese wording follows pi:</b> context window and max output tokens now read <b>词元</b> instead of <b>令牌</b>, and the diff badge stays <code>diff</code>.</li>
            </ul>
        """.trimIndent()
    }
}

tasks.test {
    useJUnitPlatform()
    testLogging {
        events("passed", "skipped", "failed")
        showStandardStreams = false
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}

// ---------------------------------------------------------------------------------------------
// Webview (web/): npm build produces one self-contained index.html that is packaged as a resource.
// ---------------------------------------------------------------------------------------------
val webDir = layout.projectDirectory.dir("web")
val webviewResources = layout.buildDirectory.dir("webview")

fun npm(vararg args: String): List<String> =
    if (System.getProperty("os.name").lowercase().contains("win")) {
        listOf("cmd", "/c", "npm") + args
    } else {
        listOf("npm") + args
    }

val installWebviewDeps by tasks.registering(Exec::class) {
    group = "webview"
    description = "Installs the webview npm dependencies when node_modules is missing or stale."
    workingDir = webDir.asFile
    inputs.files(webDir.file("package.json"), webDir.file("package-lock.json"))
    outputs.dir(webDir.dir("node_modules"))
    commandLine(npm("ci", "--no-audit", "--no-fund"))
}

val buildWebview by tasks.registering(Exec::class) {
    group = "webview"
    description = "Type-checks and bundles the webview into web/dist/index.html."
    dependsOn(installWebviewDeps)
    workingDir = webDir.asFile
    inputs.dir(webDir.dir("src"))
    inputs.files(
        webDir.file("index.html"),
        webDir.file("vite.config.ts"),
        webDir.file("tsconfig.json"),
        webDir.file("scripts/inline.mjs"),
    )
    outputs.dir(webDir.dir("dist"))
    commandLine(npm("run", "build"))
}

val syncWebview by tasks.registering(Copy::class) {
    group = "webview"
    description = "Copies the bundled webview into the plugin resources."
    dependsOn(buildWebview)
    from(webDir.dir("dist")) {
        include("index.html")
        into("webview")
    }
    into(webviewResources)
}

sourceSets.main {
    resources.srcDir(webviewResources)
}

tasks.named<ProcessResources>("processResources") {
    dependsOn(syncWebview)
}

// Protocol review utility. Set -PpiSourceDir=D:/workspace/pi when validating against a checkout.
val dumpRpcSchema by tasks.registering(Exec::class) {
    group = "verification"
    description = "Snapshots pi's RPC declarations for protocol drift review."
    val piSourceDir = providers.gradleProperty("piSourceDir").orElse("../pi")
    val source = file("${piSourceDir.get()}/packages/coding-agent/src/modes/rpc/rpc-types.ts")
    inputs.file(source)
    outputs.file(layout.projectDirectory.file("rpc-schema.json"))
    workingDir(projectDir)
    commandLine(
        "node", "--experimental-strip-types", "scripts/dump-rpc-schema.ts",
        source.absolutePath, file("rpc-schema.json").absolutePath,
    )
}

tasks.named("check") {
    dependsOn(dumpRpcSchema)
}

// Compiles the helper that queues local plugin updates. It runs inside each target IDE's
// bundled JBR because IDE classes may target a newer JVM than the one running Gradle
// (e.g. 2026.3 ships a JBR 25 whose classes a Java 21 Gradle JVM cannot load).
val queueToolClasses = layout.buildDirectory.dir("queue-plugin-update-tool")
val compileQueuePluginUpdateTool = tasks.register<JavaCompile>("compileQueuePluginUpdateTool") {
    description = "Compiles QueuePluginUpdateTool used by buildPlugin to queue local IDE updates."
    source = fileTree(layout.projectDirectory.dir("tools/plugin-update"))
    destinationDirectory.set(queueToolClasses)
    classpath = files()
    options.release.set(21)
}

// Local development: deploy only after the ZIP was built successfully (including UP-TO-DATE builds).
tasks.named<Zip>("buildPlugin") {
    // Ship the project license and third-party notices with the distributed ZIP.
    from(layout.projectDirectory.file("LICENSE"))
    from(layout.projectDirectory.file("THIRD_PARTY_NOTICES.md"))

    doLast {
        if (providers.gradleProperty("installLocalPlugin").orElse("true").get() != "false") {
            val configuredDirs = providers.gradleProperty("localIdePluginDirs").orNull
            val jetBrainsDir = System.getenv("APPDATA")?.let { file("$it/JetBrains") }
            // Every JetBrains IDE names its configuration directory <ProductCode><YYYY.R>
            // (IntelliJIdea2024.2, WebStorm2025.3, GoLand2024.2, ...). Matching the version suffix
            // instead of a product allow-list covers the whole JetBrains family; sibling entries
            // such as `bl`, `crl`, `consentOptions` or `PermanentDeviceId` have no version.
            val ideConfigDir = Regex("[A-Za-z]+(\\d{4})\\.(\\d+)")
            val explicitPluginDirs = configuredDirs != null
            val pluginDirs = if (configuredDirs != null) {
                configuredDirs.split(';').filter { it.isNotBlank() }.map { file(it.trim()) }
            } else {
                jetBrainsDir?.listFiles().orEmpty()
                    .filter { it.isDirectory && ideConfigDir.matches(it.name) }
                    .filter {
                        val (year, release) = ideConfigDir.find(it.name)!!.destructured
                        year.toInt() > 2024 || (year.toInt() == 2024 && release.toInt() >= 2)
                    }
                    .map { it.resolve("plugins") }
            }
            if (pluginDirs.isEmpty()) {
                logger.lifecycle("No local JetBrains IDE profiles found; skipping plugin installation.")
            }
            pluginDirs.distinctBy { it.canonicalPath }.forEach { pluginsDir ->
                // Queue the update through the target IDE's own bundled JBR (see
                // QueuePluginUpdateTool): loading its classes into the Gradle JVM breaks when
                // the IDE targets a newer JVM than the one running Gradle.
                val localAppData = System.getenv("LOCALAPPDATA")
                    ?: throw GradleException("LOCALAPPDATA is required for local IDE installation.")
                val systemDir = file("$localAppData/JetBrains/${pluginsDir.parentFile.name}")
                val homeFile = systemDir.resolve(".home")
                if (!homeFile.isFile) {
                    // A freshly installed IDE that has never been launched has no `.home` record
                    // yet; skip it instead of failing the whole build. Explicitly requested
                    // directories still fail so typos are not silently ignored.
                    val message = "Cannot locate IDE home: $homeFile. Launch this IDE once first."
                    if (explicitPluginDirs) throw GradleException(message)
                    logger.lifecycle("Skipping plugin update for $pluginsDir: $message")
                    return@forEach
                }
                val ideHome = file(homeFile.readText().trim())
                val ideLib = ideHome.resolve("lib")
                val jars = ideLib.listFiles().orEmpty().filter { it.extension == "jar" }
                if (jars.isEmpty()) {
                    // A stale `.home` points at an IDE that was uninstalled or moved; skip it
                    // instead of failing the whole build. Explicitly requested directories
                    // still fail so typos are not silently ignored.
                    val message = "Cannot locate IDE libraries: $ideLib. Launch this IDE once first, or remove the stale configuration directory."
                    if (explicitPluginDirs) throw GradleException(message)
                    logger.lifecycle("Skipping plugin update for $pluginsDir: $message")
                    return@forEach
                }
                val jbrJava = listOf("jbr/bin/java.exe", "jbr/bin/java")
                    .map { ideHome.resolve(it) }
                    .firstOrNull { it.isFile }
                    ?: throw GradleException(
                        "Cannot locate the bundled JBR under $ideHome: neither jbr/bin/java.exe nor jbr/bin/java exists.",
                    )
                val command = listOf(
                    jbrJava.absolutePath,
                    "-cp",
                    queueToolClasses.get().asFile.absolutePath,
                    "QueuePluginUpdateTool",
                    ideLib.absolutePath,
                    systemDir.absolutePath,
                    pluginsDir.absolutePath,
                    archiveFile.get().asFile.absolutePath,
                    project.name,
                )
                val process = ProcessBuilder(command).redirectErrorStream(true).start()
                val output = String(process.getInputStream().readBytes(), Charsets.UTF_8)
                val exitCode = process.waitFor()
                if (exitCode != 0) {
                    throw GradleException("Could not queue plugin update for $pluginsDir:\n$output")
                }
                output.trim().lines().forEach { line: String -> if (line.isNotBlank()) logger.lifecycle(line) }
            }
        }
    }
    // Deployment must run even when the archive itself hasn't changed.
    outputs.upToDateWhen { false }
    dependsOn(compileQueuePluginUpdateTool)
}
