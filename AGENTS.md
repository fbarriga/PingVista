# AGENTS.md — rules for coding agents in this repo

This is a small React Native (Expo) app that measures pings. It will stay small.
Read `README.md` for what the app does.

## Code style — the most important section

- Write plain, readable TypeScript. A human should understand every file on first read.
- No inheritance, no class hierarchies. Use plain functions and small React function components.
- No clever one-liners, no dense chained expressions, no higher-order components,
  no generic "framework" layers built for a future that will not come.
- Do not add abstraction until the same code exists in three places.
- Keep files short and focused: one screen per file, one ping protocol per file.
- Name things after what they are: `pingHttps`, `getNetworkInterfaces`, `median`.
- Comments only where the code cannot explain itself (e.g. STUN byte layout, socket options).
- Keep `README.md`, `AGENTS.md`, and test flows synchronized with behavior and layout changes —
  including tooling changes (`scripts/`, `app.json`, CI workflows), not just app code. Before
  committing, grep `README.md` and `AGENTS.md` for the names of the files, commands, and
  directories you touched and update any stale description in the same change.
- Always use braces for control-flow statement bodies (`if`, `else`, `for`, `while`, etc.), even when the
  body contains only a single statement. Never use brace-less single-line bodies.
  
  - Preferred:
    ```ts
    if (foo) {
      continue;
    }
    ```
  
  - Do not use:
    ```ts
    if (foo) continue;
    ```

## Testing policy

- Do NOT generate broad test suites. Most code here needs no unit tests.
- Jest unit tests only for pure logic: `src/ping/stats.ts` and STUN packet,
  target parsing, and address-family selection in `src/ping/protocols/udpStun.ts`.
  `pingUdp`'s socket lifecycle (bind address, cancellation, bind failure) is also
  covered there against a mocked `react-native-udp`; that mock is the one
  exception, not a pattern to copy for the other protocols.
- UI behavior is verified with Maestro flows in `.maestro/` (launch app, tap buttons,
  assert results appear). Keep flows short and human-readable.
- Maestro must be able to see what it asserts: the Pings/Histogram/Details/Graph tabs
  are paged, so only the selected one is on screen. Tap a tab before asserting its text.

## Project layout

```
index.ts                 entry point, registers the root component
App.tsx                  root component, navigation setup
src/
  constants.ts           predefined hosts per protocol, defaults (packet size 56, TTL 60)
  analytics/
    analytics.ts          Firebase Analytics event logging (best-effort, never throws)
  screens/
    MainScreen.tsx       ping controls + Pings/Histogram/Details/Graph top tabs
    InfoScreen.tsx       network interfaces + external IP
    AboutScreen.tsx      app name, version, and license
    main/                 result tab components, the ping controls form (PingControls.tsx),
                          and default-gateway detection (useDefaultGateways.ts)
  ping/
    isIp.ts              IP address literal detection and address-family parsing
    protocols/
      icmp.ts            ICMP ping (calls native module)
      https.ts           HTTPS ping (fetch + timing after warm-up)
      tcp.ts             TCP connection handshake duration
      udpStun.ts         UDP ping (minimal IPv4/IPv6 STUN client)
      udpStun.test.ts    STUN packet, target, and address-family tests
      resolveHost.ts     resolves a host with a caller timeout and stop signal;
                         the native lookup itself has no cancellation
    stats.ts             pure stat functions (min/max/avg/percentiles/loss/moving average)
    stats.test.ts        stats unit tests
    types.ts             shared ping result type
    usePingRunner.ts     the one hook that runs a ping loop (count, interval, stop)
modules/
  ping-native/           Expo native module (Swift + Kotlin): ICMP, DNS, interfaces, gateways, latency optimization
plugins/
  withReleaseSigning.js  config plugin: wires the Android release signingConfig into
                         generated android/app/build.gradle from Gradle properties
  withR8Optimizations.js config plugin: enables R8 optimized shrinking for Android
                         releases (optimized default proguard file, optimized resource
                         shrinking, and removal of proguard rules already covered by
                         react-android's bundled consumer rules)
scripts/
  check-release-version.sh  pre-tag check: versions agree across app.json / package.json /
                            ping-native / release notes, and android.versionCode /
                            ios.buildNumber are set and greater than the previous release tag's
.maestro/                Maestro UI test flows
.github/workflows/       CI: android-release.yml builds a signed Play-ready .aab
assets/                  app icon and Android adaptive-icon layers
docs/app-store/          store listing, privacy policy, privacy disclosures, release notes, asset plan
LICENSE                  proprietary source-available license
```

## Commands

```bash
npm install                 # install dependencies
npx expo prebuild           # generate ios/ and android/ (needed after native module changes)
npx expo run:ios            # build + run on iOS simulator
npx expo run:android        # build + run on Android emulator
npm run typecheck           # TypeScript type-checking
npm run lint                # ESLint linting
npm test                    # Jest unit tests
maestro test .maestro/      # functional UI tests (app must be installed on a running sim/emulator)
scripts/check-release-version.sh [X.Y.Z]  # verify app.json / package.json / ping-native build.gradle+
                                           #   podspec / release-notes.md agree on the version, and that
                                           #   app.json's android.versionCode / ios.buildNumber are set and
                                           #   greater than the previous release tag's, before tagging
```

Android builds require API level 29 or newer.

## Native module rules (`modules/ping-native/`)

- Keep native code minimal. The native side does ONE ping per call and returns
  `{ rttMs }`; the caller already knows the destination `ip` it resolved and passed
  in, so native doesn't echo it back. JavaScript drives the loop: frequency, count,
  stop. Sequence numbers are owned by JS and passed into `icmpPing` via
  `IcmpPingOptions.seq` so the on-wire ICMP sequence matches the value shown in the UI.
- The module API is `icmpPing`, `cancelIcmpPing`, `resolveHost`, `getNetworkInterfaces`,
  `getDefaultGateways`, `beginLatencyOptimization`, and `endLatencyOptimization`.
- Blocking native network calls run concurrently on background queues. JavaScript caps
  overlapping ICMP requests at 32 and cancels each active request by its unique request ID.
- ICMP uses unprivileged datagram sockets on both platforms — no root, no entitlements:
  - iOS: `socket(AF_INET, SOCK_DGRAM, IPPROTO_ICMP)` / `IPPROTO_ICMPV6` (SimplePing approach).
  - Android: `Os.socket(AF_INET(6), SOCK_DGRAM, IPPROTO_ICMP(V6))` — allowed via `ping_group_range`.
- Replies are framed differently per platform; do not assume one shape for both. Linux
  ping sockets return a bare ICMP message, but Darwin returns the whole IP packet for
  ICMPv4, so iOS must skip the IPv4 header (low nibble of byte 0, counted in 32-bit
  words) before reading the ICMP type and sequence. ICMPv6 replies carry no IP header on
  either platform. Linux also rewrites the ICMP identifier to match the socket, while
  Darwin keeps it but hands every socket connected to the peer every reply that peer
  sends. Both platforms therefore match on type and sequence and skip anything else
  until the deadline.
- `getDefaultGateways` is deliberately asymmetric: iOS walks the routing table
  (`NET_RT_DUMP`) and, when a family has more than one UP+GATEWAY default route (VPN,
  Wi-Fi + cellular), prefers the one on the interface the OS would actually route
  through; Android asks ConnectivityManager for the active network's default routes and
  takes the first per family. Both skip directly-connected routes with no gateway address.
- IPv4 TTL and IPv6 hop limit use `IP_TTL` / `IPV6_UNICAST_HOPS`. IPv6 link-local gateway addresses carry
  their interface scope; other ICMP traffic follows the system route.
- The socket is `connect()`-ed to the destination before sending (anti-spoofing: only
  datagrams from that exact peer are delivered). One side effect: an intermediate
  router's "TTL exceeded" reply comes from the router's address, not the destination's,
  so it's filtered before this code ever sees it — a too-low TTL just times out, with
  no hop-specific diagnostic. This is a platform constraint of unprivileged connected
  ICMP sockets, not a bug to "fix" by relaxing the filter.
- Never block the main thread; run socket work on a background queue/thread.
