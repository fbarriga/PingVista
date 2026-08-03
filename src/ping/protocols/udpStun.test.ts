// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

import {
  buildStunBindingRequest,
  matchingStunResponseType,
  pingUdp,
  randomTransactionId,
  udpSocketType,
} from './udpStun';
import dgram from 'react-native-udp';

jest.mock('../../../modules/ping-native', () => ({
  __esModule: true,
  default: { resolveHost: jest.fn() },
}));

jest.mock('react-native-udp', () => ({
  __esModule: true,
  default: { createSocket: jest.fn() },
}));

describe('buildStunBindingRequest', () => {
  test('produces a 20-byte header with no attributes', () => {
    const transactionId = new Uint8Array(12).fill(1);
    const packet = buildStunBindingRequest(transactionId);

    expect(packet.length).toBe(20);
    expect([packet[0], packet[1]]).toEqual([0x00, 0x01]); // Binding Request
    expect([packet[2], packet[3]]).toEqual([0x00, 0x00]); // message length
    expect([packet[4], packet[5], packet[6], packet[7]]).toEqual([0x21, 0x12, 0xa4, 0x42]); // magic cookie
    expect(Array.from(packet.slice(8))).toEqual(Array.from(transactionId));
  });
});

describe('matchingStunResponseType', () => {
  const transactionId = new Uint8Array(12).fill(7);

  function successResponse(id: Uint8Array): Uint8Array {
    const packet = new Uint8Array(20);
    packet[0] = 0x01;
    packet[1] = 0x01;
    packet.set([0x21, 0x12, 0xa4, 0x42], 4);
    packet.set(id, 8);
    return packet;
  }

  test('accepts a success response with a matching transaction id', () => {
    expect(matchingStunResponseType(successResponse(transactionId), transactionId)).toBe('success');
  });

  test('rejects a response with a different transaction id', () => {
    const otherId = new Uint8Array(12).fill(9);
    expect(matchingStunResponseType(successResponse(otherId), transactionId)).toBeNull();
  });

  test('rejects a packet that is too short', () => {
    expect(matchingStunResponseType(new Uint8Array(10), transactionId)).toBeNull();
  });

  test('rejects an unrelated message type', () => {
    const packet = successResponse(transactionId);
    packet[0] = 0x00;
    packet[1] = 0x01; // Binding Request, not a response
    expect(matchingStunResponseType(packet, transactionId)).toBeNull();
  });

  test('rejects a response without the STUN magic cookie', () => {
    const packet = successResponse(transactionId);
    packet[4] = 0;
    expect(matchingStunResponseType(packet, transactionId)).toBeNull();
  });

  test('rejects a response whose declared attributes are missing', () => {
    const packet = successResponse(transactionId);
    packet[3] = 4; // declares one four-byte attribute, but only has a header
    expect(matchingStunResponseType(packet, transactionId)).toBeNull();
  });

  test('rejects a response whose declared attribute length is unaligned', () => {
    const packet = successResponse(transactionId);
    packet[3] = 1;
    expect(matchingStunResponseType(packet, transactionId)).toBeNull();
  });

  test('identifies an error response so it is not counted as latency', () => {
    const packet = successResponse(transactionId);
    packet[1] = 0x11;
    expect(matchingStunResponseType(packet, transactionId)).toBe('error');
  });
});

describe('randomTransactionId', () => {
  test('generates 12 bytes that differ between calls', () => {
    const a = randomTransactionId();
    const b = randomTransactionId();
    expect(a.length).toBe(12);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

describe('udpSocketType', () => {
  test('selects the socket type for each address family', () => {
    expect(udpSocketType(4)).toBe('udp4');
    expect(udpSocketType(6)).toBe('udp6');
  });
});

describe('pingUdp socket lifecycle', () => {
  const createSocket = dgram.createSocket as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each([
    [4, '0.0.0.0'],
    [6, '::'],
  ] as const)('binds an IPv%s socket to the matching wildcard address', async (family, address) => {
    const socket = {
      on: jest.fn(),
      close: jest.fn(),
      send: jest.fn((...args: unknown[]) => {
        const callback = args.at(-1) as (error?: Error) => void;
        callback(new Error('test send failure'));
      }),
      bind: jest.fn((_port: number, _address: string, callback: () => void) => callback()),
    };
    createSocket.mockReturnValue(socket);

    await pingUdp('stun.example.com', '192.0.2.1', 3478, 1, family, 100);

    expect(createSocket).toHaveBeenCalledWith({ type: family === 6 ? 'udp6' : 'udp4' });
    expect(socket.bind).toHaveBeenCalledWith(0, address, expect.any(Function));
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  test('closes a pending socket when the request is cancelled', async () => {
    let finishBinding: (() => void) | undefined;
    const socket = {
      on: jest.fn(),
      close: jest.fn(),
      send: jest.fn(),
      bind: jest.fn((_port: number, _address: string, callback: () => void) => {
        finishBinding = callback;
      }),
    };
    createSocket.mockReturnValue(socket);
    const controller = new AbortController();

    const request = pingUdp(
      'stun.example.com',
      '192.0.2.1',
      3478,
      1,
      4,
      1_000,
      controller.signal
    );
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    finishBinding?.();
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(socket.send).not.toHaveBeenCalled();
  });

  test('reports a socket bind failure without trying to send', async () => {
    const socket = {
      on: jest.fn(),
      close: jest.fn(),
      send: jest.fn(),
      bind: jest.fn(
        (_port: number, _address: string, callback: (error?: Error) => void) => {
          callback(new Error('test bind failure'));
        }
      ),
    };
    createSocket.mockReturnValue(socket);

    await expect(
      pingUdp('stun.example.com', '192.0.2.1', 3478, 1, 4, 100)
    ).resolves.toMatchObject({ error: 'Could not bind UDP socket' });
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledTimes(1);
  });
});
