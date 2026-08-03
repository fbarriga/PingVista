# Implementation Plan

A cross-platform ping measurement app. Keep everything simple and readable — see
`AGENTS.md` for the style rules. Work through the phases in order; each one leaves
the app in a runnable, verifiable state.

## Stack

- **Expo (latest SDK) + TypeScript**, prebuild workflow with `expo-dev-client`
  (custom native code means no Expo Go)
- **Navigation**: `@react-navigation/native` — bottom tabs (Main / Info / About),
  material top tabs inside Main (Pings / Details / Graph)
- **Charts**: `react-native-gifted-charts` (BarChart for histogram, LineChart for graph)
- **Connection type**: `@react-native-community/netinfo`
- **TCP**: `react-native-tcp-socket` (TLS support)
- **UDP**: `react-native-udp`
- **Native module**: one custom Expo module in `modules/ping-native/` (Swift + Kotlin)
- **Tests**: Jest (via `jest-expo`) for pure logic; Maestro for UI flows

## Native module: `ping-native`

Three functions, written with the Expo Modules API. One ping per call — JS drives loops.

### `icmpPing(host, options) → { rttMs: number, ip: string }`

`options = { family: 4 | 6, packetSize: number, ttl: number, timeoutMs: number, interfaceName?: string }`

- **iOS (Swift)**: unprivileged datagram socket — `socket(AF_INET, SOCK_DGRAM, IPPROTO_ICMP)`
  or `(AF_INET6, SOCK_DGRAM, IPPROTO_ICMPV6)` (the SimplePing approach, no entitlements).
  Build an echo request with `packetSize` payload bytes, set TTL with `IP_TTL` /
  `IPV6_UNICAST_HOPS`, bind to interface with `IP_BOUND_IF` / `IPV6_BOUND_IF` when
  `interfaceName` is given. Time from send to matching echo reply.
- **Android (Kotlin)**: `Os.socket(AF_INET(6), OsConstants.SOCK_DGRAM, IPPROTO_ICMP(V6))` —
  unprivileged, allowed by Android's `ping_group_range`. Same options via `Os.setsockoptInt`.
  Interface binding is coarser: map the requested interface to a `Network` via
  `ConnectivityManager` and use `network.bindSocket(...)`; skip binding if no match.
- Run on a background thread; reject the promise on timeout or socket error with a
  short human-readable message (that message is shown in the Pings list).

### `getNetworkInterfaces() → [{ name: string, addresses: [{ ip: string, family: 4 | 6 }] }]`

- iOS: `getifaddrs`, skip loopback and link-local unless nothing else exists.
- Android: `NetworkInterface.getNetworkInterfaces()`, same filtering.

### `resolveHost(host, family) → string`

DNS resolution restricted to A (family 4) or AAAA (family 6) records —
`getaddrinfo` with the family hint on iOS, `InetAddress.getAllByName` filtered by
type on Android. This is what makes the IPv4/IPv6 toggle work for every protocol.

## JS ping engines (`src/ping/`)

Plain async functions. Every engine returns the same shape:

```ts
type PingResult = {
  seq: number;
  timeMs?: number;   // undefined = lost/failed
  ip: string;        // resolved IP actually pinged
  error?: string;    // short message when failed
};
```

- `icmp.ts` — resolve host (if not already an IP literal), call `icmpPing` once.
- `http.ts` — `fetch(url, { cache: 'no-store' })`, time request start → response headers.
  Any HTTP status counts as success (we measure reachability latency, not correctness).
- `tcp.ts` — `react-native-tcp-socket` `connectTLS({ host, port: 443 })`, time from
  connect start to the secure-connection event, then destroy the socket.
- `udpStun.ts` — minimal STUN client: build a 20-byte Binding Request header
  (type `0x0001`, length `0`, magic cookie `0x2112A442`, 12 random transaction-ID bytes),
  send via `react-native-udp`, time until a response whose transaction ID matches.
  Keep encode/parse as small pure functions so they can be unit tested.
- `stats.ts` — pure functions over `number[]`: `min`, `max`, `avg`, `median`,
  `percentile(p)` (for 90/95/99), loss counts from `PingResult[]`, and
  `movingAverage(values, windowSize)`. No classes, no state.
- `usePingRunner.ts` — the single hook that runs a session: takes an engine function,
  target, count, and interval; fires pings on a timer, appends each `PingResult` to
  state, exposes `start`, `stop`, `results`, `isRunning`. All three result tabs read
  from this one array.

## Predefined targets (`src/constants.ts`)

| Protocol | Targets |
|----------|---------|
| ICMP v4 | `1.1.1.1`, `8.8.8.8`, `9.9.9.9` |
| ICMP v6 | `2606:4700:4700::1111`, `2001:4860:4860::8888`, `2620:fe::fe` |
| HTTP | `http://connectivitycheck.gstatic.com/generate_204` (Google), `http://captive.apple.com/hotspot-detect.html` (Apple), `http://detectportal.firefox.com/success.txt` (Firefox), `http://www.msftconnecttest.com/connecttest.txt` (Microsoft) |
| TCP (TLS :443) | same four hostnames as HTTP |
| UDP (STUN) | `stun.l.google.com:19302`, `stun.cloudflare.com:3478` |

Defaults: packet size **56**, TTL **60**, interval **1s**, count **10**.

## Screens

### Main
Controls, top to bottom:
1. Protocol selector: ICMP / HTTP / TCP / UDP (segmented buttons)
2. Host picker: predefined list for the chosen protocol + a free-text input
3. IPv4 / IPv6 toggle
4. Packet size (visible for ICMP only) and TTL inputs
5. Frequency (interval) and number of pings
6. Interface picker (from `getNetworkInterfaces`, optional, best-effort)
7. Start / Stop button

Below the controls, three top tabs fed by `usePingRunner` results:
- **Pings** — one row per result: `host (ip)` when a hostname was given, otherwise
  just the ip; `icmp_seq`; time in ms (or the error message).
- **Details** — histogram (BarChart of RTT buckets) + stat lines: avg, min, max,
  median, p90, p95, p99, sent / lost / loss %, and current connection type from netinfo.
- **Graph** — LineChart, x = ping number, y = RTT ms; a toggle plus window-size input
  overlays a moving-average line.

### Info
- Network interfaces with all their IPv4 and IPv6 addresses (native module).
- External IP: `fetch('https://ifconfig.me/ip')` (text). Show a refresh control.

### About
- App name, version, short description, licenses note.
- Easter egg: tapping the logo 5 times triggers a radar/pulse "ping" animation
  built with the built-in `Animated` API (no extra dependency).

## Phases

Each phase ends with the app building and the listed check passing.

1. **Scaffold** — `npx create-expo-app`, TypeScript template, add navigation, three
   empty screens with bottom tabs, top-tab skeleton inside Main.
   *Check: app runs on both platforms, all tabs navigable.*
2. **Info screen** — create `modules/ping-native` with `getNetworkInterfaces` (Swift +
   Kotlin), wire Info screen, add external IP fetch.
   *Check: real interface IPs and external IP show on device/simulator.*
3. **HTTP ping end-to-end** — `http.ts`, Main screen controls (protocol/host/count/
   frequency), `usePingRunner`, Pings tab list.
   *Check: pick the Google URL, run 5 pings, 5 rows with times appear; Stop works.*
4. **Stats + charts** — `stats.ts` (+ its Jest tests), Details tab (histogram + stats +
   netinfo connection type), Graph tab (line + moving average).
   *Check: numbers match a manual calculation for a small run.*
5. **ICMP** — `icmpPing` + `resolveHost` in the native module (iOS first, then Android),
   `icmp.ts`, packet size / TTL / IPv6 / interface options in the UI.
   *Check: ping 1.1.1.1 and an IPv6 target on both platforms; bad host shows an error row.*
6. **TCP + UDP** — `tcp.ts` (TLS handshake timing) and `udpStun.ts` (+ Jest tests for
   the STUN encode/parse).
   *Check: TLS times to captive.apple.com:443; STUN times to both servers.*
7. **About + polish** — About screen, easter-egg animation, empty states, input validation
   (host required, numeric fields clamped to sane ranges).
8. **Functional tests** — Maestro flows in `.maestro/`: navigate all three bottom tabs;
   run an HTTP ping against a predefined host and assert result rows appear; enter a
   manual host and assert it is used; Info screen shows an external IP.

## Verification

- `npx expo run:ios` and `npx expo run:android` build and run after every phase.
- `npm test` — Jest units for `stats.ts` and the STUN codec stay green.
- `maestro test .maestro/` — UI flows pass against a running simulator/emulator.
- Manual: compare ICMP results for 8.8.8.8 against the desktop `ping 8.8.8.8` from the
  same network — numbers should be in the same ballpark.
