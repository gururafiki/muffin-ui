const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Import .svg files as React components (SVGR) so custom icons — e.g. doodles
// downloaded from svgrepo.com dropped into src/components/icons/custom — can be
// used like any other component. Configure the SVG transformer first, then wrap
// with NativeWind (which chains onto the existing transformer).
config.transformer.babelTransformerPath = require.resolve('react-native-svg-transformer/expo');
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== 'svg');
config.resolver.sourceExts = [...config.resolver.sourceExts, 'svg'];

module.exports = withNativeWind(config, { input: './src/global.css' });
