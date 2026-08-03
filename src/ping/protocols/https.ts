// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

/**
 * Measures time until the initial HTTPS response's headers arrive, treating
 * any response as a successful ping without following redirects.
 *
 * A warm-up request runs first so the platform's connection pool has a
 * chance to reuse the connection for the timed request, though this isn't
 * guaranteed by anything in this code.
 */

import { fetch } from 'expo/fetch';
import { PingResult } from '../types';
import { abortError } from './resolveHost';

export async function pingHttps(
  url: string,
  seq: number,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<PingResult> {
  const controller = new AbortController();
  // The timeout aborts the same controller the caller's signal does, so the
  // catch below can't tell the two apart from the error alone.
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });

  if (signal?.aborted) {
    controller.abort();
  }

  try {
    // Any HTTPS response means the host was reachable. This intentionally
    // measures time to response headers, not time to download a response body.
    const start = performance.now();
    const response = await fetch(url, {
      headers: { 'Cache-Control': 'no-cache' },
      redirect: 'manual',
      signal: controller.signal,
    });

    // Do not keep a response body open; that can prevent connection reuse.
    response.body?.cancel().catch(() => {});
    return { seq, timeMs: performance.now() - start, host: url };
  } catch (error) {
    if (signal?.aborted) {
      throw abortError();
    }

    if (timedOut) {
      return { seq, host: url, error: 'Request timed out' };
    }

    const message = error instanceof Error ? error.message : 'Request failed';
    return { seq, host: url, error: message };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}
