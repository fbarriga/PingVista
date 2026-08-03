// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

/**
 * Performs one native ICMP echo request against an already-resolved address.
 */

import PingNative, { AddressFamily } from '../../../modules/ping-native';
import { PingResult } from '../types';
import { abortError } from './resolveHost';

export type IcmpPingParams = {
  hostOrIp: string;
  ip: string;
  family: AddressFamily;
  packetSize: number;
  ttl: number;
  timeoutMs: number;
  seq: number; // written into the ICMP echo header
  requestId: string;
  signal?: AbortSignal;
};

export async function pingIcmp(params: IcmpPingParams): Promise<PingResult> {
  if (params.signal?.aborted) {
    throw abortError();
  }

  const resultHost = params.ip === params.hostOrIp ? undefined : params.hostOrIp;

  try {
    const cancel = () => {
      void PingNative.cancelIcmpPing(params.requestId).catch(() => {});
    };

    params.signal?.addEventListener('abort', cancel, { once: true });

    try {
      const { rttMs } = await PingNative.icmpPing(params.ip, {
        family: params.family,
        packetSize: params.packetSize,
        ttl: params.ttl,
        timeoutMs: params.timeoutMs,
        seq: params.seq,
        requestId: params.requestId,
      });

      return {
        seq: params.seq,
        timeMs: rttMs,
        ip: params.ip,
        host: resultHost,
      };
    } finally {
      params.signal?.removeEventListener('abort', cancel);
    }
  } catch (error) {
    if (params.signal?.aborted) {
      throw abortError();
    }

    const message = error instanceof Error ? error.message : 'Ping failed';
    return {
      seq: params.seq,
      ip: params.ip,
      host: resultHost,
      // Show a pretty error instead of the exception message on Timed out
      error: /timed out/i.test(message) ? 'Timed out' : message,
    };
  }
}
