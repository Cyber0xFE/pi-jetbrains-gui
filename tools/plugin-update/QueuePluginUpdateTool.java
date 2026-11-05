import java.lang.reflect.Constructor;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Stream;

/**
 * Runs inside the target IDE's bundled JBR: queues a plugin update the same way the IDE's
 * "Install Plugin from Disk" does, by appending commands to the IDE's startup action script.
 *
 * The IDE's own classes may target a newer JVM than the one running Gradle (e.g. 2026.3 ships
 * a JBR 25), so this helper is executed as a separate process instead of loading IDE jars into
 * the Gradle JVM.
 *
 * Usage: QueuePluginUpdateTool &lt;ideLib&gt; &lt;systemDir&gt; &lt;pluginsDir&gt; &lt;zip&gt; &lt;pluginDirName&gt;
 */
public class QueuePluginUpdateTool {
    public static void main(String[] args) {
        try {
            run(args);
        } catch (Throwable throwable) {
            System.err.println("failed to queue plugin update: " + throwable);
            Throwable cause = throwable.getCause();
            while (cause != null) {
                System.err.println("caused by: " + cause);
                cause = cause.getCause();
            }
            System.exit(1);
        }
    }

    private static void run(String[] args) throws Exception {
        if (args.length != 5) {
            throw new IllegalArgumentException("usage: <ideLib> <systemDir> <pluginsDir> <zip> <pluginDirName>");
        }
        Path ideLib = Path.of(args[0]);
        Path systemDir = Path.of(args[1]);
        Path pluginsDir = Path.of(args[2]);
        Path zip = Path.of(args[3]);
        String pluginDirName = args[4];

        List<URL> jars = new ArrayList<>();
        try (Stream<Path> listing = Files.list(ideLib)) {
            listing.filter(path -> path.toString().endsWith(".jar")).forEach(path -> {
                try {
                    jars.add(path.toUri().toURL());
                } catch (java.net.MalformedURLException exception) {
                    throw new IllegalStateException(exception);
                }
            });
        }
        if (jars.isEmpty()) {
            throw new IllegalStateException("Cannot locate IDE libraries: " + ideLib);
        }

        try (URLClassLoader loader = new URLClassLoader(jars.toArray(URL[]::new), ClassLoader.getPlatformClassLoader())) {
            String managerName = "com.intellij.ide.startup.StartupActionScriptManager";
            Class<?> manager = loader.loadClass(managerName);
            Class<?> pathType = Path.class;
            Constructor<?> deleteCommand = loader.loadClass(managerName + "$DeleteCommand").getConstructor(pathType);
            Constructor<?> unzipCommand = loader.loadClass(managerName + "$UnzipCommand").getConstructor(pathType, pathType);

            Path startupDir = systemDir.resolve("plugins");
            Files.createDirectories(startupDir);
            Path script = startupDir.resolve("action.script");
            byte[] previousBytes = Files.exists(script) ? Files.readAllBytes(script) : null;
            List<Object> commands = new ArrayList<>(
                castToList(manager.getMethod("loadActionScript", pathType).invoke(null, script))
            );
            Path stagedZip = Files.createTempFile(startupDir, "pi-local-update-", ".zip");
            Path stagedScript = Files.createTempFile(startupDir, "pi-local-script-", ".tmp");
            try {
                Files.copy(zip, stagedZip, StandardCopyOption.REPLACE_EXISTING);
                commands.add(deleteCommand.newInstance(pluginsDir.resolve(pluginDirName)));
                commands.add(unzipCommand.newInstance(stagedZip, pluginsDir));
                commands.add(deleteCommand.newInstance(stagedZip));
                manager.getMethod("saveActionScript", List.class, pathType).invoke(null, commands, stagedScript);
                byte[] currentBytes = Files.exists(script) ? Files.readAllBytes(script) : null;
                if (!Arrays.equals(previousBytes, currentBytes)) {
                    throw new IllegalStateException("IDE changed the update queue during installation.");
                }
                Files.move(stagedScript, script, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (Exception failure) {
                Files.deleteIfExists(stagedZip);
                throw failure;
            } finally {
                Files.deleteIfExists(stagedScript);
            }
            System.out.println("Queued plugin update for " + pluginsDir + ". Restart this IDE to apply it.");
        }
    }

    @SuppressWarnings("unchecked")
    private static List<Object> castToList(Object value) {
        return (List<Object>) value;
    }
}
