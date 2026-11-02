import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.net.URLClassLoader

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
            <h2>What's New in 0.2.0</h2>
            <h3>Features</h3>
            <ul>
              <li>Work with multiple pi sessions side by side in separate tabs, each showing live task status, with shortcuts for opening and closing tabs.</li>
              <li>Configure a network proxy for the pi process and toggle it on or off from settings.</li>
              <li>Set a default model and keep it in sync across sessions.</li>
              <li>Navigate messages faster: jump to the first or latest message and skip through your own user messages.</li>
              <li>Preview attached images before sending; forking a session now keeps image attachments.</li>
              <li>Click file links in AI replies to open the referenced file, including line numbers and code ranges.</li>
              <li>Slash commands now match by keyword, and file reference candidates skip virtual environments and cache directories.</li>
              <li>Long tool output is collapsed with expand actions to keep conversations readable.</li>
              <li>Configure the tool window shortcut in settings; the composer is focused automatically when the panel opens.</li>
              <li>Smoother, more responsive scrolling inside the tool window.</li>
              <li>Refreshed plugin icons for light and dark themes, plus polished cards, copy buttons, status bar, and thinking/connection indicators.</li>
            </ul>
            <h3>Fixes</h3>
            <ul>
              <li>Opening a historical session now scrolls to the latest message by default.</li>
              <li>Fixed skill message display, user message alignment, and scroll chaining between cards and the session view.</li>
              <li>Reduced WebView memory usage and improved diagnostics for large conversations.</li>
              <li>Replaced a deprecated platform API for better forward compatibility.</li>
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
                // Use the target IDE's own startup commands and class definitions. Loaded JARs
                // stay untouched; IDEA applies the same commands it uses for Install from Disk.
                val localAppData = System.getenv("LOCALAPPDATA")
                    ?: throw GradleException("LOCALAPPDATA is required for local IDE installation.")
                val systemDir = file("$localAppData/JetBrains/${pluginsDir.parentFile.name}")
                val homeFile = systemDir.resolve(".home")
                check(homeFile.isFile) { "Cannot locate IDE home: $homeFile. Launch this IDE once first." }
                val ideLib = file(homeFile.readText().trim()).resolve("lib")
                val jars = ideLib.listFiles().orEmpty().filter { it.extension == "jar" }
                check(jars.isNotEmpty()) { "Cannot locate IDE libraries: $ideLib" }
                URLClassLoader(jars.map { it.toURI().toURL() }.toTypedArray(), ClassLoader.getPlatformClassLoader()).use { loader ->
                    val managerName = "com.intellij.ide.startup.StartupActionScriptManager"
                    val manager = loader.loadClass(managerName)
                    val pathType = Path::class.java
                    val deleteCommand = loader.loadClass("$managerName\$DeleteCommand").getConstructor(pathType)
                    val unzipCommand = loader.loadClass("$managerName\$UnzipCommand").getConstructor(pathType, pathType)
                    val startupDir = systemDir.resolve("plugins").toPath()
                    Files.createDirectories(startupDir)
                    val script = startupDir.resolve("action.script")
                    val previousBytes = if (Files.exists(script)) Files.readAllBytes(script) else null
                    val commands = (manager.getMethod("loadActionScript", pathType).invoke(null, script) as List<*>).toMutableList()
                    val stagedZip = Files.createTempFile(startupDir, "pi-local-update-", ".zip")
                    val stagedScript = Files.createTempFile(startupDir, "pi-local-script-", ".tmp")
                    try {
                        Files.copy(archiveFile.get().asFile.toPath(), stagedZip, StandardCopyOption.REPLACE_EXISTING)
                        commands.add(deleteCommand.newInstance(pluginsDir.resolve(project.name).toPath()))
                        commands.add(unzipCommand.newInstance(stagedZip, pluginsDir.toPath()))
                        commands.add(deleteCommand.newInstance(stagedZip))
                        manager.getMethod("saveActionScript", List::class.java, pathType).invoke(null, commands, stagedScript)
                        val currentBytes = if (Files.exists(script)) Files.readAllBytes(script) else null
                        check(previousBytes.contentEquals(currentBytes)) { "IDE changed the update queue during installation. Run buildPlugin again." }
                        Files.move(stagedScript, script, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
                    } catch (failure: Exception) {
                        Files.deleteIfExists(stagedZip)
                        throw GradleException("Could not queue plugin update for $pluginsDir", failure)
                    } finally {
                        Files.deleteIfExists(stagedScript)
                    }
                    logger.lifecycle("Queued plugin update for $pluginsDir. Restart this IDE to apply it.")
                }
            }
        }
    }
    // Deployment must run even when the archive itself hasn't changed.
    outputs.upToDateWhen { false }
}
