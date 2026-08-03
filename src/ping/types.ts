// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

export type PingResult = {
  seq: number;
  timeMs?: number;
  cancelled?: boolean;

  // only for icmp/tcp/udp. not available for https (resolves DNS internally).
  ip?: string;

  // only available if specified (i.e. not available when only an IP was specified)
  host?: string;
  error?: string;
};
