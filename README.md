# Ping App

A simple iOS/Android app (React Native + Expo) to measure network latency against
hosts and IPs, over four protocols:

- **ICMP** — real ping with configurable packet size (default 56), TTL (default 60), IPv4 or IPv6
- **HTTP** — request timing against well-known connectivity-check URLs
- **TCP** — TLS handshake duration to port 443
- **UDP** — round-trip time via a minimal STUN client

## Features

- Predefined targets per protocol (1.1.1.1 / 8.8.8.8 / 9.9.9.9, captive-portal URLs,
  Google/Cloudflare STUN servers) plus manual host input
- IPv4 / IPv6 selection per ping run
- Configurable frequency and number of pings
- Results: live ping list, histogram with stats (avg/min/max/median/p90/p95/p99, loss),
  and a graph with optional moving average
- Info screen: device IPv4/IPv6 addresses per network interface, external IP (ifconfig.me)
- Best-effort selection of which network interface to ping from

## Running it

```bash
npm install
npx expo run:ios        # or: npx expo run:android
```

Requires Xcode (iOS) or Android Studio + an emulator. The app uses a custom native
module for ICMP, so it cannot run in Expo Go — use the dev client builds above.

## For contributors and coding agents

- `AGENTS.md` — code style rules, layout, commands. Read it first.
- `PLAN.md` — the implementation plan, phase by phase.
