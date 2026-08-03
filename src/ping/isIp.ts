// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

export type IpAddressFamily = 4 | 6;

function isIpV4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4
    && parts.every((part) => /^\d{1,3}$/.test(part))
    && parts.every((part) => Number(part) >= 0 && Number(part) <= 255);
}

function isIpV6(value: string): boolean {
  if (!value.includes(':')) {
    return false;
  }

  try {
    const url = new URL(`http://[${value}]/`);
    return url.hostname.startsWith("[") && url.hostname.endsWith("]");
  } catch {
    return false;
  }
}

export function ipAddressFamily(value: string): IpAddressFamily | undefined {
  if (isIpV4(value)) {
    return 4;
  }

  if (isIpV6(value)) {
    return 6;
  }

  return undefined;
}

export function isIpAddress(value: string): boolean {
  return ipAddressFamily(value) !== undefined;
}
