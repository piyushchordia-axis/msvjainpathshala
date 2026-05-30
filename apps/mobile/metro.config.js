// Learn more: https://docs.expo.dev/guides/monorepos
const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

// SDK 52+ configures monorepo watchFolders / nodeModulesPaths automatically.
// Do not set disableHierarchicalLookup — it breaks pnpm transitive deps
// (e.g. react-native → invariant).
const config = getDefaultConfig(projectRoot);

// Resolve @jp/* workspace packages via their built dist/ output rather than src/.
// pnpm symlinks node_modules/@jp/<pkg> to the package root; Metro can walk
// into src/index.ts first and fail on NodeNext-style `.js` import suffixes.
const workspacePackages = {
  '@jp/shared': path.join(workspaceRoot, 'packages/shared/dist/index.js'),
  '@jp/design-tokens': path.join(workspaceRoot, 'packages/design-tokens/dist/index.js'),
  '@jp/i18n': path.join(workspaceRoot, 'packages/i18n/dist/index.js'),
};
const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const target = workspacePackages[moduleName];
  if (target) {
    return { filePath: target, type: 'sourceFile' };
  }
  return upstreamResolveRequest
    ? upstreamResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
