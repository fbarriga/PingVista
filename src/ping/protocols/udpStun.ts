// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

/**
 * Sends STUN Binding Requests to measure UDP latency (rtt).
 */

import { Buffer } from 'buffer';
import dgram from 'react-native-udp';
import 'react-native-get-random-values';
import type { AddressFamily } from '../../../modules/ping-native';
import type { PingResult } from '../types';
import { abortError } from './resolveHost';

const STUN_BINDING_REQUEST = 0x0001;
const STUN_BINDING_SUCCESS = 0x0101;
const STUN_BINDING_ERROR = 0x0111;
const STUN_MAGIC_COOKIE = [0x21, 0x12, 0xa4, 0x42];

export function randomTransactionId(): Uint8Array {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return bytes;
}

// Minimal STUN Binding Request: 20-byte header, no attributes.
export function buildStunBindingRequest(transactionId: Uint8Array): Uint8Array {
  const packet = new Uint8Array(20);
  packet[0] = STUN_BINDING_REQUEST >> 8;
  packet[1] = STUN_BINDING_REQUEST & 0xff;
  packet[2] = 0; // message length (no attributes)
  packet[3] = 0;
  packet.set(STUN_MAGIC_COOKIE, 4);
  packet.set(transactionId, 8);
  return packet;
}

export type StunResponseType = 'success' | 'error' | null;

export function matchingStunResponseType(data: Uint8Array, transactionId: Uint8Array): StunResponseType {
  if (data.length < 20) {
    return null;
  }

  const type = (data[0] << 8) | data[1];
  if (type !== STUN_BINDING_SUCCESS && type !== STUN_BINDING_ERROR) {
    return null;
  }

  const messageLength = (data[2] << 8) | data[3];
  if (messageLength % 4 !== 0 || data.length < 20 + messageLength) {
    return null;
  }

  for (let i = 0; i < STUN_MAGIC_COOKIE.length; i++) {
    if (data[4 + i] !== STUN_MAGIC_COOKIE[i]) {
      return null;
    }
  }

  for (let i = 0; i < transactionId.length; i++) {
    if (data[8 + i] !== transactionId[i]) {
      return null;
    }
  }

  return type === STUN_BINDING_SUCCESS ? 'success' : 'error';
}

export function udpSocketType(family: AddressFamily): 'udp4' | 'udp6' {
  return family === 6 ? 'udp6' : 'udp4';
}

export async function pingUdp(
  hostOrIp: string,
  ip: string,
  port: number,
  seq: number,
  family: AddressFamily,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<PingResult> {
  const transactionId = randomTransactionId();
  const request = buildStunBindingRequest(transactionId);
  const resultHost = ip === hostOrIp ? undefined : hostOrIp;

  let socket: ReturnType<typeof dgram.createSocket>;
  try {
    socket = dgram.createSocket({ type: udpSocketType(family) });
  } catch {
    return { seq, ip, host: resultHost, error: 'Could not open UDP socket' };
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (result: PingResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      try {
        socket.close();
      } catch {
        // The socket may already be closed after an asynchronous error.
      }
      resolve(result);
    };

    const cancel = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      try {
        socket.close();
      } catch {
        // The socket may still be binding or already closed.
      }
      reject(abortError());
    };

    const timer = setTimeout(() => {
      finish({ seq, ip, host: resultHost, error: 'Request timed out' });
    }, timeoutMs);

    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }

    let start = 0;
    socket.on('message', (msg: Uint8Array) => {
      const responseType = matchingStunResponseType(msg, transactionId);
      if (responseType === 'success') {
        finish({ seq, timeMs: performance.now() - start, ip, host: resultHost });
      } else if (responseType === 'error') {
        finish({ seq, ip, host: resultHost, error: 'STUN server returned an error' });
      }
    });

    socket.on('error', () => {
      finish({ seq, ip, host: resultHost, error: 'UDP request failed' });
    });

    // open the socket and send the request; start timing right before send()
    // so socket-bind overhead isn't counted as network RTT.
    try {
      socket.bind(0, family === 6 ? '::' : '0.0.0.0', (bindError?: Error) => {
        if (settled) {
          return;
        }

        if (bindError) {
          finish({ seq, ip, host: resultHost, error: 'Could not bind UDP socket' });
          return;
        }

        start = performance.now();
        try {
          socket.send(Buffer.from(request), 0, request.length, port, ip, (error?: Error) => {
            if (error) {
              finish({ seq, ip, host: resultHost, error: 'Failed to send request' });
            }
          });
        } catch {
          finish({ seq, ip, host: resultHost, error: 'Failed to send request' });
        }
      });
    } catch {
      finish({ seq, ip, host: resultHost, error: 'Could not bind UDP socket' });
    }
  });
}
