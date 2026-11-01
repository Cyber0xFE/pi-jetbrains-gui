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
