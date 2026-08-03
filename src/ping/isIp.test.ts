// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

import { ipAddressFamily, isIpAddress } from './isIp';

describe('ipAddressFamily', () => {
  test('identifies IPv4 literals', () => {
    expect(ipAddressFamily('192.0.2.1')).toBe(4);
  });

  test('identifies IPv6 literals', () => {
    expect(ipAddressFamily('2001:db8::1')).toBe(6);
  });

  test.each(['example.com', '300.0.0.1', '2001:db8:::1', ''])(
    'rejects a non-address value: %s',
    (value) => {
      expect(ipAddressFamily(value)).toBeUndefined();
      expect(isIpAddress(value)).toBe(false);
    }
  );
});
