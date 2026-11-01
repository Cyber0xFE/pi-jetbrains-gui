package dev.pi.jetbrains.editor

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

class ProjectFileCollectorTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `keeps visuals after more than 5000 earlier project files`() {
        val source = Files.createDirectories(tempDir.resolve("api"))
        repeat(5001) { Files.writeString(source.resolve("agent-$it.py"), "") }
        write("visuals/agent-flow.html")

        val files = ProjectFileCollector.collect(tempDir)

        assertEquals(5002, files.size)
        assertEquals("visuals/agent-flow.html", files.last())
    }

    @Test
    fun `skips nested virtual environments dependencies and caches`() {
        listOf(
            "api/.venv/Lib/site-packages/celery/worker/agent.py",
            "api/venv/Lib/site-packages/fastapi/agent.py",
            "api/__pycache__/agent.cpython-312.pyc",
            "api/.pytest_cache/agent",
            "web/node_modules/agent/index.js",
            "web/dist/agent.html",
            "build/agent.html",
            ".git/objects/agent",
        ).forEach { write(it) }
        write("api/python-runtime/pyvenv.cfg")
        write("api/python-runtime/Lib/site-packages/agent.py")
        write("visuals/agent-flow.html")
        write("api/agent.py")

        assertEquals(listOf("api/agent.py", "visuals/agent-flow.html"), ProjectFileCollector.collect(tempDir))
    }

    @Test
    fun `includes untracked ignored and hidden project files without extension filtering`() {
        write(".gitignore", "visuals/\n")
        write(".agents/skills/example/SKILL.md")
        write("visuals/agent-flow.html")
        write("visuals/agent-flow.drawio")
        write("visuals/agent-flow.png")
        write("docs/build")

        assertEquals(
            listOf(
                ".agents/skills/example/SKILL.md", ".gitignore", "docs/build",
                "visuals/agent-flow.drawio", "visuals/agent-flow.html", "visuals/agent-flow.png",
            ),
            ProjectFileCollector.collect(tempDir),
        )
    }

    @Test
    fun `missing project directory returns no candidates`() {
        assertTrue(ProjectFileCollector.collect(tempDir.resolve("deleted-project")).isEmpty())
    }

    private fun write(relative: String, content: String = "") {
        val file = tempDir.resolve(relative)
        Files.createDirectories(file.parent)
        Files.writeString(file, content)
    }
}
