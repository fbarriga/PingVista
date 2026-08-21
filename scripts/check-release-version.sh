#!/usr/bin/env bash
# Checks that PingVista's app version is consistent across:
#   - app.json (expo.version)                                   -- authoritative app version
#   - package.json (version)
#   - modules/ping-native/android/build.gradle (version, versionName) -- hand-maintained, can drift
#   - modules/ping-native/ios/PingNative.podspec (s.version)          -- hand-maintained, can drift
#   - docs/app-store/release-notes.md (latest "## Version X.Y.Z" heading)
#
# Also checks that app.json's android.versionCode and ios.buildNumber are
# present and strictly greater than the values at the previous release tag --
# these are the store upload identifiers (unrelated to the semver string
# above) and each store rejects a re-upload that doesn't increase them.
#
# Run this before creating a release tag (e.g. `git tag v1.2.0`), to catch
# version drift ahead of pushing.
#
# Usage:
#   scripts/check-release-version.sh          # check the files agree with each other
#                                              # (target = app.json's version)
#   scripts/check-release-version.sh 1.2.0    # also check the given version (leading
#                                              # "v" optional) matches all of them --
#                                              # run this right before `git tag v1.2.0`
#
# Exits 0 with a short success message if everything matches.
# Exits 1 and lists every problem found (not just the first) otherwise.

set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

app_json="app.json"
package_json="package.json"
native_gradle="modules/ping-native/android/build.gradle"
native_podspec="modules/ping-native/ios/PingNative.podspec"
release_notes="docs/app-store/release-notes.md"

errors=()

app_version=$(grep -m1 '"version":' "$app_json" | sed -E 's/.*"version": *"([^"]+)".*/\1/')
if [ -z "$app_version" ]; then
  errors+=("could not find a \"version\" field in $app_json")
fi

package_version=$(grep -m1 '"version":' "$package_json" | sed -E 's/.*"version": *"([^"]+)".*/\1/')
if [ -z "$package_version" ]; then
  errors+=("could not find a \"version\" field in $package_json")
fi

gradle_version=$(grep -m1 "^version = '" "$native_gradle" | sed -E "s/^version = '([^']+)'.*/\1/")
if [ -z "$gradle_version" ]; then
  errors+=("could not find a version = '...' line in $native_gradle")
fi

gradle_version_name=$(grep -m1 'versionName "' "$native_gradle" | sed -E 's/.*versionName "([^"]+)".*/\1/')
if [ -z "$gradle_version_name" ]; then
  errors+=("could not find a versionName \"...\" line in $native_gradle")
fi

podspec_version=$(grep -m1 "s\.version " "$native_podspec" | sed -E "s/.*= *'([^']+)'.*/\1/")
if [ -z "$podspec_version" ]; then
  errors+=("could not find an s.version = '...' line in $native_podspec")
fi

notes_version=$(grep -m1 '^## Version ' "$release_notes" | sed -E 's/^## Version +([0-9][^ ]*).*/\1/')
if [ -z "$notes_version" ]; then
  errors+=("could not find a \"## Version X.Y.Z\" heading in $release_notes")
fi

app_version_code=$(grep -m1 '"versionCode":' "$app_json" | sed -E 's/.*"versionCode": *([0-9]+).*/\1/')
if [ -z "$app_version_code" ]; then
  errors+=("could not find an \"android.versionCode\" field in $app_json")
fi

app_build_number=$(grep -m1 '"buildNumber":' "$app_json" | sed -E 's/.*"buildNumber": *"([^"]+)".*/\1/')
if [ -z "$app_build_number" ]; then
  errors+=("could not find an \"ios.buildNumber\" field in $app_json")
elif ! [[ "$app_build_number" =~ ^[0-9]+$ ]]; then
  errors+=("ios.buildNumber \"$app_build_number\" in $app_json is not a plain integer, cannot check it increased")
fi

# Target version: an explicit argument (leading "v" stripped, as in a git tag
# like v1.2.0), or app.json's version if no argument was given.
if [ "$#" -gt 0 ]; then
  target_version="${1#v}"
else
  target_version="$app_version"
fi

# Stores reject a re-upload whose versionCode/buildNumber didn't increase
# from the last release, regardless of the semver string above. Compare
# against the previous release tag's app.json, when one exists. Exclude a
# tag matching the release being prepared: if it was already created locally
# (e.g. re-running this script after `git tag` but before `git push`), it
# would otherwise compare app.json against itself.
previous_tag=$(git tag -l 'v*.*.*' --sort=-v:refname 2>/dev/null | grep -vx "v$target_version" | head -n1)
if [ -n "$previous_tag" ]; then
  previous_app_json=$(git show "$previous_tag:$app_json" 2>/dev/null)
  if [ -z "$previous_app_json" ]; then
    errors+=("could not read $app_json at tag $previous_tag to compare versionCode/buildNumber")
  else
    previous_version_code=$(grep -m1 '"versionCode":' <<< "$previous_app_json" | sed -E 's/.*"versionCode": *([0-9]+).*/\1/')
    previous_build_number=$(grep -m1 '"buildNumber":' <<< "$previous_app_json" | sed -E 's/.*"buildNumber": *"([^"]+)".*/\1/')

    # Expo defaults both store identifiers to 1 when they are omitted.
    # Preserve that effective value when comparing older release configs.
    if [ -z "$previous_version_code" ]; then
      previous_version_code=1
    fi
    if [ -z "$previous_build_number" ]; then
      previous_build_number=1
    fi

    if [ -n "$app_version_code" ] && [ -n "$previous_version_code" ] && [ "$app_version_code" -le "$previous_version_code" ]; then
      errors+=("android.versionCode is $app_version_code, must be greater than $previous_tag's $previous_version_code")
    fi

    if [ -n "$app_build_number" ] && [[ "$app_build_number" =~ ^[0-9]+$ ]] \
      && [ -n "$previous_build_number" ] && [[ "$previous_build_number" =~ ^[0-9]+$ ]] \
      && [ "$app_build_number" -le "$previous_build_number" ]; then
      errors+=("ios.buildNumber is $app_build_number, must be greater than $previous_tag's $previous_build_number")
    fi
  fi
fi

if [ -z "$target_version" ]; then
  errors+=("no target version to check against (app.json version missing and no argument given)")
else
  if [ -n "$app_version" ] && [ "$app_version" != "$target_version" ]; then
    errors+=("$app_json version is \"$app_version\", expected \"$target_version\"")
  fi
  if [ -n "$package_version" ] && [ "$package_version" != "$target_version" ]; then
    errors+=("$package_json version is \"$package_version\", expected \"$target_version\"")
  fi
  if [ -n "$gradle_version" ] && [ "$gradle_version" != "$target_version" ]; then
    errors+=("$native_gradle 'version' is \"$gradle_version\", expected \"$target_version\"")
  fi
  if [ -n "$gradle_version_name" ] && [ "$gradle_version_name" != "$target_version" ]; then
    errors+=("$native_gradle 'versionName' is \"$gradle_version_name\", expected \"$target_version\"")
  fi
  if [ -n "$podspec_version" ] && [ "$podspec_version" != "$target_version" ]; then
    errors+=("$native_podspec 's.version' is \"$podspec_version\", expected \"$target_version\"")
  fi
  if [ -n "$notes_version" ] && [ "$notes_version" != "$target_version" ]; then
    errors+=("$release_notes latest heading is \"Version $notes_version\", expected \"Version $target_version\"")
  fi
fi

if [ "${#errors[@]}" -gt 0 ]; then
  echo "Version check failed (target: $target_version):" >&2
  for e in "${errors[@]}"; do
    echo "  - $e" >&2
  done
  exit 1
fi

echo "All versions match: $target_version"
exit 0
