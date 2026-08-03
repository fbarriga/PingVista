// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

/**
 * Measures TCP connection latency against an already-resolved address.
 */

import TcpSocket from 'react-native-tcp-socket';
import { PingResult } from '../types';
import { abortError } from './resolveHost';

export async function pingTcp(
  hostOrIp: string,
  ip: string,
  port: number,
  seq: number,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<PingResult> {
  const resultHost = ip === hostOrIp ? undefined : hostOrIp;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let socket: ReturnType<typeof TcpSocket.createConnection> | undefined;

    const finish = (result: PingResult) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timer) {
        clearTimeout(timer);
      }

      signal?.removeEventListener('abort', cancel);
      socket?.destroy();
      resolve(result);
    };

    const cancel = () => {
      if (settled) {
        return;
      }

      settled = true;
      if (timer) {
        clearTimeout(timer);
      }

      signal?.removeEventListener('abort', cancel);
      socket?.destroy();
      reject(abortError());
    };

    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }

    try {
      const start = performance.now();
      timer = setTimeout(() => {
        finish({ seq, ip, host: resultHost, error: 'Connection timed out' });
      }, timeoutMs);

      // connectTimeout is intentionally omitted: the setTimeout above already
      // enforces timeoutMs exactly, and react-native-tcp-socket's iOS binding
      // truncates that option to whole seconds (integer ms / 1000), which
      // would make the native timeout wrong for any non-round value.
      socket = TcpSocket.createConnection({ host: ip, port }, () => {
        finish({ seq, timeMs: performance.now() - start, ip, host: resultHost });
      });

      socket.on('error', () => {
        finish({ seq, ip, host: resultHost, error: 'Connection failed' });
      });

    } catch {
      finish({ seq, ip, host: resultHost, error: 'Could not open TCP socket' });
    }
  });
}
