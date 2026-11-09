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
            Pi Coding Agent brings the pi coding agent to JetBrains IDEs with a focused, streaming chat tool window, session persistence, protected tool output, editor and console context sharing, and configurable runtime settings.<br><br>
            <b>Features</b>
            <ul>
              <li>Chat with pi directly inside the IDE and receive streamed responses.</li>
              <li>Persist and restore pi sessions across IDE restarts.</li>
              <li>Create, switch, rename, delete, fork, and inspect sessions in a session tree.</li>
              <li>Choose the active model and thinking level, and view token usage and context information.</li>
              <li>Display protected tool output, including files, terminals, patches, and large-result summaries.</li>
              <li>Open referenced files, URLs, and diff lines directly in the IDE.</li>
              <li>Browse slash commands and reference project files with <code>/</code> and <code>@</code> completion.</li>
              <li>Compact context manually, configure automatic compaction, and abort automatic retries.</li>
              <li>Attach selected editor text or selected console output as conversation context.</li>
              <li>Paste images into the composer and send them with a prompt.</li>
              <li>Support pi extension dialogs, notifications, status text, and widgets.</li>
              <li>Follow the IDE light and dark themes automatically.</li>
              <li>Configure the pi CLI path, Node.js runtime, diagnostic log directory, and panel shortcut.</li>
              <li>Optionally play a sound when a task is completed.</li>
            </ul>
            <p><b>Requirement:</b> Install the pi CLI before use, for example with <code>npm install -g @earendil-works/pi-coding-agent</code>.</p>
            <p>Source code and issue tracker: <a href="https://github.com/Cyber0xFE/pi-jetbrains-gui">https://github.com/Cyber0xFE/pi-jetbrains-gui</a></p>
        """.trimIndent()

        changeNotes = """
            <h2>What's New in 0.4.0</h2>
            <h3>Features</h3>
            <ul>
              <li><b>Steering and follow-up messages while streaming:</b> the composer no longer locks up while pi is answering a prompt. <code>Enter</code> queues the message as <b>steering</b> (pi receives it after the current tool call, before the next model call) and <code>Alt+Enter</code> queues it as a <b>follow-up</b> (pi processes it after the current run), matching the pi TUI. Pending messages are listed above the composer and disappear as pi delivers them.</li>
              <li><b>Edit queued messages:</b> click <b>Edit</b> on the queue bar or press <code>Alt+Up</code> in the composer to pull pending steering and follow-up messages back in, like the pi TUI <code>dequeue</code> action. Each message gets its own inline editor with its steering/follow-up label, can be removed individually, re-queued with <b>Send all</b>, or restored untouched with <b>Cancel</b>.</li>
              <li>The user-message navigation outline now shows a slim scrollbar when you hover or focus it, so long conversations are visibly scrollable.</li>
            </ul>
            <h3>Fixes</h3>
            <ul>
              <li>Stopping a run now clears the pending queue before aborting, matching the pi TUI <code>Esc</code> behavior: queued steering and follow-up messages are handed back to the editor instead of being silently drained after the abort.</li>
              <li><b>Send all</b> re-queues messages one at a time: the first message starts a run and the rest return to their own steering/follow-up queues once pi starts streaming, instead of being merged into a single prompt.</li>
              <li>User messages queued within the same millisecond no longer vanish from the WebView after re-queueing.</li>
              <li>Renaming a session that is not the active one no longer breaks its message chain, which previously left the history empty when the session was opened.</li>
              <li>The session tree no longer stays empty when a very long session is opened for the first time.</li>
              <li>Literal <code>&lt;thinking&gt;</code> tags inside Markdown code are shown as written instead of being parsed as reasoning blocks.</li>
              <li>pi installed through npm is detected even when <code>npm root -g</code> fails on the IDE's stale <code>PATH</code>, by falling back to the npm next to the resolved Node.js binary.</li>
            </ul>
            <h3>Maintenance</h3>
            <ul>
              <li>RPC protocol snapshot refreshed against pi v0.80.2.</li>
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
    doLast {
        if (providers.gradleProperty("installLocalPlugin").orElse("true").get() != "false") {
            val configuredDirs = providers.gradleProperty("localIdePluginDirs").orNull
            val jetBrainsDir = System.getenv("APPDATA")?.let { file("$it/JetBrains") }
            val pluginDirs = if (configuredDirs != null) {
                configuredDirs.split(';').filter { it.isNotBlank() }.map { file(it.trim()) }
            } else {
                jetBrainsDir?.listFiles().orEmpty()
                    .filter { it.isDirectory && it.name.matches(Regex("(IntelliJIdea|IdeaIC|PyCharm|PyCharmCE)\\d{4}\\.\\d+")) }
                    .filter {
                        val (year, release) = Regex("(\\d{4})\\.(\\d+)$").find(it.name)!!.destructured
                        year.toInt() > 2024 || (year.toInt() == 2024 && release.toInt() >= 2)
                    }
                    .map { it.resolve("plugins") }
            }
            if (pluginDirs.isEmpty()) {
                logger.lifecycle("No local IDEA/PyCharm profiles found; skipping plugin installation.")
            }
            pluginDirs.distinctBy { it.canonicalPath }.forEach { pluginsDir ->
                // Queue the update through the target IDE's own bundled JBR (see
                // QueuePluginUpdateTool): loading its classes into the Gradle JVM breaks when
                // the IDE targets a newer JVM than the one running Gradle.
                val localAppData = System.getenv("LOCALAPPDATA")
                    ?: throw GradleException("LOCALAPPDATA is required for local IDE installation.")
                val systemDir = file("$localAppData/JetBrains/${pluginsDir.parentFile.name}")
                val homeFile = systemDir.resolve(".home")
                check(homeFile.isFile) { "Cannot locate IDE home: $homeFile. Launch this IDE once first." }
                val ideHome = file(homeFile.readText().trim())
                val ideLib = ideHome.resolve("lib")
                val jars = ideLib.listFiles().orEmpty().filter { it.extension == "jar" }
                check(jars.isNotEmpty()) { "Cannot locate IDE libraries: $ideLib" }
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
