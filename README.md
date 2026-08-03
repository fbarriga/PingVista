# PingVista

A simple iOS/Android app (React Native + Expo) to measure network latency against
hosts and IPs, over four protocols:

Homepage: [github.com/fbarriga/pingvista](https://github.com/fbarriga/pingvista)

- **ICMP** — real ping with configurable packet size (default 56), IPv4 TTL or IPv6 hop limit (default 60), supports IPv4 or IPv6.
  The socket connects directly to the destination, so a TTL or hop limit too low to reach it just
  times out — intermediate-hop replies (traceroute-style "TTL exceeded") aren't shown.
- **HTTPS** — timing until the initial response headers arrive, after a warm-up request. Redirects are not followed.
- **TCP** — TCP connection handshake duration to a configurable port (default 443), excluding DNS and TLS. Supports IPv4 and IPv6.
- **UDP** — round-trip time via a minimal STUN client, supports IPv4 and IPv6.

## Features

- Predefined targets per protocol (`1.1.1.1` / `8.8.8.8` / `9.9.9.9`, captive-portal URLs,
  Google/Cloudflare STUN servers) plus manual host input
- For ICMP, a `Router` target for the current default gateway of the selected address
  family, offered first and re-selected automatically when the gateway changes
- IPv4 / IPv6 selection per ping run (except HTTPS)
- Configurable delay and count for every protocol, but the delay means different things: ICMP overlaps
  requests, so it sends every second by default without waiting for replies (a start-to-start cadence,
  capped at 32 requests in flight so very short delays cannot create an unbounded socket backlog); every
  other protocol waits for each request to finish before applying the delay (a pause added after each one).
- Results: live ping list, latency histogram, details with stats
  (avg/min/max/median/p90/p95/p99, ICMP loss, or request failures, and current connection type),
  and a graph with optional moving average.
  Failed and missing attempts remain visible as gaps in sequence graphs.
- Info screen: device IPv4/IPv6 addresses per network interface, external IP
  (`ifconfig.me`, with `api.ipify.org` as a fallback)
- Android only: a toggle (on by default, in Additional settings) that pings the default
  gateway every 20 ms on a background thread for the whole test, starting 100 ms before
  the test itself, to keep the Wi-Fi radio out of power-save state during measurement.

Manual TCP and UDP targets use side-by-side Host and Port fields. IPv6 literals can be entered
directly in the Host field, such as `2001:db8::1`.

## Running it

```bash
npm install
npx expo run:ios        # or: npx expo run:android
```

Requires Xcode (iOS) or Android Studio + an emulator. The app uses a custom native
module for ICMP, so it cannot run in Expo Go — use the dev client builds above.
Android 10 (API level 29) or newer is required.

## Creating a release

Before tagging a release, bump the version in `app.json` (`expo.version`),
`package.json`, `modules/ping-native/android/build.gradle` (`version` and
`versionName`), and `modules/ping-native/ios/PingNative.podspec`
(`s.version`), and add a new `## Version X.Y.Z` heading to
`docs/app-store/release-notes.md`. Then check they all agree with the tag
you're about to push:

```bash
./scripts/check-release-version.sh 1.2.0
```

If it passes, tag and push:

```bash
git tag v1.2.0 && git push origin v1.2.0
```

## Android release builds (CI)

`.github/workflows/android-release.yml` builds a signed `.aab` on a `v*.*.*` tag push
or manual dispatch. It needs 4 repository secrets, set under
**Settings → Secrets and variables → Actions → Secrets**:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Your upload keystore file (`.jks`), base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias inside the keystore |
| `ANDROID_KEY_PASSWORD` | Password for that key alias |

To encode the keystore file:

```bash
base64 -i pingvista-upload.jks
```

## AI-assisted development

This project was developed with the assistance of AI coding tools,
including Claude, OpenAI Codex, and OpenCode.

AI-generated code and suggestions are reviewed, modified, tested,
and integrated by me.

## License

Copyright © 2026 Felipe Barriga Richards. All rights reserved.

The source code is publicly available for viewing and evaluation only. See the
[license terms](LICENSE) for restrictions on copying, modification, distribution, use,
and derivative works.

## For coding agents

- `AGENTS.md` — code style rules, layout, commands. Read it first.
