const { withGradleProperties } = require("expo/config-plugins");

// Raise Gradle + Kotlin/KSP JVM memory for release builds.
//
// Expo's default android/gradle.properties caps the JVM at
// `-XX:MaxMetaspaceSize=512m`, which OOMs during KSP on this app:
//   e: [ksp] java.lang.OutOfMemoryError: Metaspace
//   > Task :expo-updates:kspReleaseKotlin FAILED
// android/ is CNG-generated (gitignored), so we set these through a config
// plugin instead of editing gradle.properties directly (prebuild would wipe it).
module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (cfg) => {
    const upsert = (key, value) => {
      const existing = cfg.modResults.find(
        (item) => item.type === "property" && item.key === key,
      );
      if (existing) existing.value = value;
      else cfg.modResults.push({ type: "property", key, value });
    };

    upsert(
      "org.gradle.jvmargs",
      "-Xmx4096m -XX:MaxMetaspaceSize=1536m -Dfile.encoding=UTF-8",
    );
    upsert("kotlin.daemon.jvmargs", "-Xmx2048m -XX:MaxMetaspaceSize=1024m");

    return cfg;
  });
};
