const { getDefaultConfig } = require('expo/metro-config');

// Expo handles workspace packages and pnpm's isolated layout.
module.exports = getDefaultConfig(__dirname);
