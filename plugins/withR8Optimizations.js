const { withAppBuildGradle, withGradleProperties, withDangerousMod, AndroidConfig } = require('expo/config-plugins');

// react-native-reanimated isn't a project dependency, and react-android's own
// bundled consumer proguard rules already keep com.facebook.react.turbomodule.core.**
// and com.facebook.react.internal.turbomodule.core.** — so both default template
// rules below are dead weight that `expo prebuild` would otherwise regenerate.
const REDUNDANT_PROGUARD_LINES = [
  '# react-native-reanimated',
  '-keep class com.swmansion.reanimated.** { *; }',
  '-keep class com.facebook.react.turbomodule.** { *; }',
];

function removeRedundantProguardRules(contents) {
  const lines = contents.split('\n').filter((line) => !REDUNDANT_PROGUARD_LINES.includes(line.trim()));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function withOptimizedResourceShrinking(config) {
  return withGradleProperties(config, (config) => {
    AndroidConfig.BuildProperties.updateAndroidBuildProperty(
      config.modResults,
      'android.r8.optimizedResourceShrinking',
      'true',
    );
    return config;
  });
}

function withCleanProguardRules(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const fs = require('fs');
      const path = require('path');
      const proguardRulesFile = path.join(config.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      const contents = await fs.promises.readFile(proguardRulesFile, 'utf8');
      const newContents = removeRedundantProguardRules(contents);
      if (contents !== newContents) {
        await fs.promises.writeFile(proguardRulesFile, newContents);
      }
      return config;
    },
  ]);
}

function withR8Optimizations(config) {
  config = withOptimizedResourceShrinking(config);
  config = withCleanProguardRules(config);
  return config;
}

module.exports = withR8Optimizations;
