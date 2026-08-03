// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

import PingNative from '../../../modules/ping-native';
import { resolveHostWithTimeout } from './resolveHost';

jest.mock('../../../modules/ping-native', () => ({
  __esModule: true,
  default: { resolveHost: jest.fn() },
}));

const resolveHost = PingNative.resolveHost as jest.Mock;

describe('resolveHostWithTimeout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns a literal address when it matches the selected family', async () => {
    await expect(resolveHostWithTimeout('2001:db8::1', 6, 100)).resolves.toBe('2001:db8::1');
    expect(resolveHost).not.toHaveBeenCalled();
  });

  test('rejects a literal address from the other family before opening a socket', async () => {
    await expect(resolveHostWithTimeout('1.1.1.1', 6, 100)).rejects.toThrow(
      'Enter an IPv6 address or hostname'
    );
    expect(resolveHost).not.toHaveBeenCalled();
  });

  test('resolves hostnames with the selected family', async () => {
    resolveHost.mockResolvedValue('2001:db8::1');

    await expect(resolveHostWithTimeout('example.com', 6, 100)).resolves.toBe('2001:db8::1');
    expect(resolveHost).toHaveBeenCalledWith('example.com', 6);
  });

  test('does not begin a lookup when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      resolveHostWithTimeout('example.com', 4, 100, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(resolveHost).not.toHaveBeenCalled();
  });
});
