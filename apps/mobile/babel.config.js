// Babel config for Expo + Reanimated.
// `react-native-reanimated/plugin` MUST be the LAST plugin in the list —
// it consumes the AST output of every previous plugin.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-reanimated/plugin'],
  };
};
