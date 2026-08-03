# AGENTS.md — rules for coding agents in this repo

This is a small React Native (Expo) app that measures pings. It will stay small.
Read `PLAN.md` for the implementation plan and `README.md` for what the app does.

## Code style — the most important section

- Write plain, readable TypeScript. A human should understand every file on first read.
- No inheritance, no class hierarchies. Use plain functions and small React function components.
- No clever one-liners, no dense chained expressions, no higher-order components,
  no generic "framework" layers built for a future that will not come.
- Do not add abstraction until the same code exists in three places.
- Keep files short and focused: one screen per file, one ping protocol per file.
- Name things after what they are: `runHttpPing`, `getNetworkInterfaces`, `median`.
- Comments only where the code cannot explain itself (e.g. STUN byte layout, socket options).

## Testing policy

- Do NOT generate broad test suites. Most code here needs no unit tests.
- Jest unit tests only for pure logic: `src/ping/stats.ts` and the STUN packet
  encode/parse in `src/ping/udpStun.ts`.
- UI behavior is verified with Maestro flows in `.maestro/` (launch app, tap buttons,
  assert results appear). Keep flows short and human-readable.

## Project layout

```
App.tsx                  entry point, navigation setup
src/
  constants.ts           predefined hosts per protocol, defaults (packet size 56, TTL 60)
  screens/
    MainScreen.tsx       ping controls + Pings/Details/Graph top tabs
    InfoScreen.tsx       network interfaces + external IP
    AboutScreen.tsx      about + easter egg animation
  ping/
    icmp.ts              ICMP ping (calls native module)
    http.ts              HTTP ping (fetch + timing)
    tcp.ts               TCP ping (TLS handshake duration)
    udpStun.ts           UDP ping (minimal STUN client)
    stats.ts             pure stat functions (min/max/avg/percentiles/loss/moving average)
    usePingRunner.ts     the one hook that runs a ping loop (count, interval, stop)
modules/
  ping-native/           Expo native module (Swift + Kotlin): icmpPing, getNetworkInterfaces, resolveHost
.maestro/                Maestro UI test flows
```

## Commands

```bash
npm install                 # install dependencies
npx expo prebuild           # generate ios/ and android/ (needed after native module changes)
npx expo run:ios            # build + run on iOS simulator
npx expo run:android        # build + run on Android emulator
npm test                    # Jest unit tests
maestro test .maestro/      # functional UI tests (app must be installed on a running sim/emulator)
```

## Native module rules (`modules/ping-native/`)

- Keep native code minimal. The native side does ONE ping per call and returns
  `{ rttMs, ip }`. JavaScript drives the loop: sequence numbers, frequency, count, stop.
- ICMP uses unprivileged datagram sockets on both platforms — no root, no entitlements:
  - iOS: `socket(AF_INET, SOCK_DGRAM, IPPROTO_ICMP)` / `IPPROTO_ICMPV6` (SimplePing approach).
  - Android: `Os.socket(AF_INET(6), SOCK_DGRAM, IPPROTO_ICMP(V6))` — allowed via `ping_group_range`.
- TTL via `IP_TTL` / `IPV6_UNICAST_HOPS` setsockopt. Interface binding is best-effort
  (`IP_BOUND_IF` on iOS, `Network.bindSocket` on Android) — if it fails, ping without it.
- Never block the main thread; run socket work on a background queue/thread.
