// Learn more: https://docs.expo.dev/guides/monorepos
const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the entire workspace so changes to @jp/shared, @jp/i18n,
//    @jp/design-tokens hot-reload into the mobile app during dev.
config.watchFolders = [workspaceRoot];

// 2. Resolve packages from both the app's node_modules and the workspace
//    root's node_modules (pnpm hoists shared deps to the root).
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Hint Metro to follow workspace package resolutions through pnpm's
//    symlinked layout. Avoids "duplicate React" classes of error.
config.resolver.disableHierarchicalLookup = false;

// 4. Use package.json "exports" field. Without this Metro falls back to
//    "main"/"module" and can pick a workspace's src/ folder over its
//    built dist/, which then trips on `.js` source-extension imports
//    (NodeNext convention used in @jp/design-tokens / @jp/shared).
config.resolver.unstable_enablePackageExports = true;

// 5. Force @jp/* workspace packages to resolve via their built dist/ output
//    rather than src/. pnpm symlinks `node_modules/@jp/<pkg>` to the
//    package root, and even with unstable_enablePackageExports above Metro
//    sometimes still walks into `src/index.ts` first (the package's
//    NodeNext-style `.js` import suffixes then fail to resolve). Pointing
//    explicitly at dist/index.js (CJS — Metro reads CJS without quibble)
//    side-steps that.
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
