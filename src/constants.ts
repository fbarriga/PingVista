// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

import { type AddressFamily } from '../modules/ping-native';

export type Protocol = 'icmp' | 'https' | 'tcp' | 'udp';

export const PROTOCOLS: Protocol[] = ['icmp', 'https', 'tcp', 'udp'];

export const PROTOCOL_LABELS: Record<Protocol, string> = {
  icmp: 'ICMP',
  https: 'HTTPS',
  tcp: 'TCP',
  udp: 'UDP',
};

export type PredefinedHost = {
  label: string;
  value: string;
  port?: number; // for UDP STUN
};

export const ICMP_HOSTS_V4: PredefinedHost[] = [
  { label: 'Cloudflare', value: '1.1.1.1' },
  { label: 'Google', value: '8.8.8.8' },
  { label: 'Quad9', value: '9.9.9.9' },
];

export const ICMP_HOSTS_V6: PredefinedHost[] = [
  { label: 'Cloudflare', value: '2606:4700:4700::1111' },
  { label: 'Google', value: '2001:4860:4860::8888' },
  { label: 'Quad9', value: '2620:fe::fe' },
];

export const HTTPS_HOSTS: PredefinedHost[] = [
  { label: 'Google', value: 'https://connectivitycheck.gstatic.com/generate_204' },
  { label: 'Apple', value: 'https://captive.apple.com/hotspot-detect.html' },
  { label: 'Firefox', value: 'https://detectportal.firefox.com/success.txt' },
];

export const TCP_HOSTS: PredefinedHost[] = [
  { label: 'Google', value: 'connectivitycheck.gstatic.com' },
  { label: 'Apple', value: 'captive.apple.com' },
  { label: 'Firefox', value: 'detectportal.firefox.com' },
];

export const TCP_PORT = 443;

export const UDP_STUN_HOSTS: PredefinedHost[] = [
  { label: 'Google STUN', value: 'stun.l.google.com', port: 19302 },
  { label: 'Cloudflare STUN', value: 'stun.cloudflare.com', port: 3478 },
];

export function predefinedHostsFor(protocol: Protocol, family: AddressFamily): PredefinedHost[] {
  switch (protocol) {
    case 'icmp':
      return family === 6 ? ICMP_HOSTS_V6 : ICMP_HOSTS_V4;
    case 'https':
      return HTTPS_HOSTS;
    case 'tcp':
      return TCP_HOSTS;
    case 'udp':
      return UDP_STUN_HOSTS;
  }
}

export const DEFAULT_PACKET_SIZE = 56;
export const DEFAULT_TTL = 60;
// Match the standard ping command's default cadence.
export const DEFAULT_INTERVAL_MS = 1000;
export const DEFAULT_COUNT = 50;
export const DEFAULT_TIMEOUT_MS = 2000;

export const MIN_INTERVAL_MS = 10;
export const MAX_INTERVAL_MS = 60_000;
export const MIN_COUNT = 1;
export const MAX_COUNT = 1_000_000;
export const MIN_PACKET_SIZE = 0;
// Staying below a typical path MTU avoids fragmentation for the default use.
export const MAX_PACKET_SIZE = 1_400;
export const MIN_TTL = 1;
export const MAX_TTL = 255;
export const MAX_MOVING_AVERAGE_WINDOW = 1_000;

// Android-only Wi-Fi radio warm-up: a background thread pings the default
// gateway at this cadence for the whole test to keep the radio out of
// power-save state.
export const ROUTER_KEEP_ALIVE_INTERVAL_MS = 20;
export const ROUTER_KEEP_ALIVE_WARMUP_MS = 100;

// Shared by MainScreen (positions the floating progress overlay) and
// PingControls (pads its content below the overlay) so the two stay aligned.
export const PROGRESS_OVERLAY_TOP = 8;
