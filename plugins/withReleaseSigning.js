const { withAppBuildGradle } = require('expo/config-plugins');

// Injects a release signingConfig that reads the upload keystore from
// Gradle properties (PINGVISTA_UPLOAD_*), which live in ~/.gradle/gradle.properties,
// never in this repo. Without this, `expo prebuild` regenerates android/app/build.gradle
// with release builds signed by the debug keystore, since android/ is gitignored and
// rebuilt from scratch each time.
const SIGNING_CONFIG = `
    signingConfigs {
        release {
            storeFile file(project.findProperty('PINGVISTA_UPLOAD_STORE_FILE') ?: 'debug.keystore')
            storePassword project.findProperty('PINGVISTA_UPLOAD_STORE_PASSWORD') ?: 'android'
            keyAlias project.findProperty('PINGVISTA_UPLOAD_KEY_ALIAS') ?: 'androiddebugkey'
            keyPassword project.findProperty('PINGVISTA_UPLOAD_KEY_PASSWORD') ?: 'android'
        }
    }
`;

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    // Point the release buildType at the new signingConfig before inserting it,
    // so the "release {" this regex scopes to is unambiguously buildTypes.release.
    contents = contents.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
      '$1signingConfig signingConfigs.release',
    );

    if (!contents.includes('PINGVISTA_UPLOAD_STORE_FILE')) {
      contents = contents.replace(
        /signingConfigs\s*\{/,
        `${SIGNING_CONFIG}\n    signingConfigs {`,
      );
    }

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = withReleaseSigning;
