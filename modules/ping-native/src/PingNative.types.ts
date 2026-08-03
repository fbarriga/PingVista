// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

export type AddressFamily = 4 | 6;

export type InterfaceAddress = {
  ip: string;
  family: AddressFamily;
};

export type NetworkInterfaceInfo = {
  name: string;
  addresses: InterfaceAddress[];
};

export type DefaultGateway = {
  ip: string;
  family: AddressFamily;
  interfaceName: string;
};

export type IcmpPingOptions = {
  family: AddressFamily;
  packetSize: number;
  ttl: number;
  timeoutMs: number;
  // Echo sequence written into the ICMP header. Defaults to 1 for callers
  // that don't track a sequence (e.g. a one-shot connectivity probe). Both
  // native implementations truncate this to an unsigned 16-bit value rather
  // than validating it; MAX_COUNT in src/constants.ts keeps every seq this
  // app actually sends far below that, so truncation is unreachable today.
  seq?: number;
  requestId: string;
};

export type IcmpPingResult = {
  rttMs: number;
};
