// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

/**
 * Resolves a host, bounded by a timeout. PingNative.resolveHost() has no
 * native cancellation, so a slow lookup keeps running in the background;
 * this just stops the caller from waiting on it past timeoutMs.
 */

import PingNative, { type AddressFamily } from '../../../modules/ping-native';
import { ipAddressFamily } from '../isIp';

export async function resolveHostWithTimeout(
  host: string,
  family: AddressFamily,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) {
    throw abortError();
  }

  // A literal address is already resolved, but it still has to match the
  // selected socket family. Passing IPv4 to an IPv6 socket (or vice versa)
  // otherwise produces a misleading connection failure later in the run.
  const literalFamily = ipAddressFamily(host);
  if (literalFamily !== undefined && literalFamily !== family) {
    throw new Error(`Enter an IPv${family} address or hostname`);
  }

  if (literalFamily !== undefined) {
    return host;
  }

  // Timeout promise
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('DNS resolution timed out')), timeoutMs);
  });

  // Abort promise
  let rejectAbort: (reason?: any) => void = () => {};
  const handleAbort = () => rejectAbort(abortError());

  const abortPromise = new Promise<never>((_, reject) => {
    rejectAbort = reject;
    signal?.addEventListener('abort', handleAbort, { once: true });
  });

  try {
    // Race the ping, timeout and abort promises. The first to resolve/reject wins.
    return await Promise.race([PingNative.resolveHost(host, family), timeout, abortPromise]);
  } finally {
    clearTimeout(timer!);
    signal?.removeEventListener('abort', handleAbort);
  }
}

export function abortError(): Error {
  const error = new Error('Request cancelled');
  error.name = 'AbortError';
  return error;
}
