package dev.pi.jetbrains.editor

import java.io.IOException
import java.nio.file.FileVisitResult
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.SimpleFileVisitor
import java.nio.file.attribute.BasicFileAttributes

/** Collects @ reference candidates without letting dependencies crowd out project files. */
internal object ProjectFileCollector {
    private val excludedDirectories = setOf(
        ".git", ".idea", ".gradle", ".intellijPlatform", "node_modules", "build", "dist", "out", "target",
        ".venv", "venv", ".tox", ".nox", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
    )

    fun collect(base: Path): List<String> {
        val files = mutableListOf<String>()
        Files.walkFileTree(base, object : SimpleFileVisitor<Path>() {
            override fun preVisitDirectory(dir: Path, attrs: BasicFileAttributes): FileVisitResult {
                // Prune entire subtrees instead of walking every dependency and filtering afterward.
                // pyvenv.cfg also identifies virtual environments with a custom directory name.
                return if (dir != base &&
                    (dir.fileName.toString() in excludedDirectories || Files.isRegularFile(dir.resolve("pyvenv.cfg")))
                ) FileVisitResult.SKIP_SUBTREE else FileVisitResult.CONTINUE
            }

            override fun visitFile(file: Path, attrs: BasicFileAttributes): FileVisitResult {
                if (attrs.isRegularFile || (attrs.isSymbolicLink && Files.isRegularFile(file))) {
                    files.add(base.relativize(file).toString().replace('\\', '/'))
                }
                return FileVisitResult.CONTINUE
            }

            // A deleted or unreadable entry must not discard candidates from the rest of the project.
            override fun visitFileFailed(file: Path, exc: IOException): FileVisitResult = FileVisitResult.CONTINUE

            override fun postVisitDirectory(dir: Path, exc: IOException?): FileVisitResult = FileVisitResult.CONTINUE
        })
        // The webview filters this list after typing @. Truncation here makes later paths unsearchable.
        return files.sorted()
    }
}
