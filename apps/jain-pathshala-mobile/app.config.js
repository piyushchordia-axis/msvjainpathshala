const path = require("path");

const { execFileSync } = require("child_process");



function pickLanIp() {

  const script = path.join(__dirname, "..", "..", "scripts", "print-lan-ip.mjs");

  return execFileSync(process.execPath, [script], { encoding: "utf8" }).trim();

}



function resolveApiBaseUrl() {

  const apiPort = process.env.API_PORT || "8080";

  const metroPort =
    process.env.EXPO_METRO_PORT || process.env.EXPO_PUBLIC_METRO_PORT || "8081";

  const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, "");



  if (

    fromEnv &&

    !fromEnv.includes("localhost") &&

    !fromEnv.includes("127.0.0.1")

  ) {

    return fromEnv;

  }



  if (process.env.EXPO_ANDROID_EMULATOR === "1") {

    return `http://10.0.2.2:${apiPort}`;

  }



  if (process.env.EXPO_USE_LAN_API === "1") {

    const ip = pickLanIp();

    const host = ip !== "127.0.0.1" ? ip : "localhost";

    return `http://${host}:${apiPort}`;

  }



  const ip = pickLanIp();

  const host = ip !== "127.0.0.1" ? ip : "localhost";

  return `http://${host}:${metroPort}`;

}



/** @type {import('expo/config').ExpoConfig} */

module.exports = ({ config }) => {

  const apiBaseUrl = resolveApiBaseUrl();

  // Allow cleartext HTTP only outside production builds (dev/preview need it for
  // the LAN/Metro API). Production EAS builds force HTTPS.
  const allowCleartext = process.env.EAS_BUILD_PROFILE !== "production";

  return {

    ...config,

    // Expo account/organization that owns the EAS project.
    owner: config.owner ?? "astropsumit",

    // Use the app version as the runtime version so OTA updates only apply to
    // compatible native builds. Keep in sync with `version` in app.json.
    runtimeVersion: config.runtimeVersion ?? { policy: "appVersion" },

    updates: {

      ...config.updates,

      // TODO(eas): `eas init` fills the real URL
      // (https://u.expo.dev/<projectId>). Safe to leave until you enable OTA.

    },

    android: {

      ...config.android,

      usesCleartextTraffic: allowCleartext,

    },

    extra: {

      ...config.extra,

      apiBaseUrl,

      eas: {

        ...config.extra?.eas,

        // projectId is written into app.json's extra.eas by `eas init`.
        // EAS_PROJECT_ID env var overrides it (e.g. in CI).
        projectId:
          process.env.EAS_PROJECT_ID || config.extra?.eas?.projectId,

      },

    },

  };

};

