/**
 * Detox configuration — Step 23.
 *
 * We declare two device profiles (iOS simulator + Android emulator) and a
 * single jest configuration. CI / local execution needs a built app binary
 * (`detox build --configuration <name>`) before `detox test` can run; the
 * binaryPath stubs below are the locations EAS Build / `expo run` produce.
 *
 * The e2e/ suite is authored for the structure here but NOT executed in
 * Step 23 — see docs/handover/final-report.md "tech debt" for the timeline
 * to wire it into CI once Android Emulator and iOS Simulator infra exists.
 */

/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'e2e/jest.config.js',
    },
    jest: {
      setupTimeout: 120000,
    },
  },
  apps: {
    'ios.debug': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/JainPathshala.app',
      build:
        'xcodebuild -workspace ios/JainPathshala.xcworkspace -scheme JainPathshala -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build',
    },
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      testBinaryPath: 'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk',
      build: 'cd android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug',
    },
  },
  devices: {
    'ios.simulator': {
      type: 'ios.simulator',
      device: { type: 'iPhone 15' },
    },
    'android.emulator': {
      type: 'android.emulator',
      device: { avdName: 'Pixel_API_34' },
    },
  },
  configurations: {
    'ios.sim.debug': {
      device: 'ios.simulator',
      app: 'ios.debug',
    },
    'android.emu.debug': {
      device: 'android.emulator',
      app: 'android.debug',
    },
  },
};
