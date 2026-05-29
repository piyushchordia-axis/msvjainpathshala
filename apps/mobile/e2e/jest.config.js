/** Detox jest config (CommonJS — Detox needs sync require). */
/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  rootDir: '..',
  testMatch: ['<rootDir>/e2e/**/*.e2e.ts'],
  testTimeout: 120_000,
  maxWorkers: 1,
  reporters: ['detox/runners/jest/reporter'],
  globalSetup: 'detox/runners/jest/globalSetup',
  globalTeardown: 'detox/runners/jest/globalTeardown',
  testEnvironment: 'detox/runners/jest/testEnvironment',
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/e2e/init.ts'],
};
