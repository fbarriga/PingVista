// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

import { NativeModule, requireNativeModule } from 'expo';

import {
  AddressFamily,
  DefaultGateway,
  IcmpPingOptions,
  IcmpPingResult,
  NetworkInterfaceInfo,
} from './PingNative.types';

declare class PingNativeModule extends NativeModule {
  beginLatencyOptimization(): Promise<void>;
  endLatencyOptimization(): Promise<void>;
  // Android only: starts/stops a background thread that pings ip at
  // intervalMs to keep the Wi-Fi radio awake during a test. iOS has no
  // equivalent and implements these as no-ops.
  beginRouterKeepAlive(ip: string, family: AddressFamily, intervalMs: number): Promise<void>;
  endRouterKeepAlive(): Promise<void>;
  getNetworkInterfaces(): Promise<NetworkInterfaceInfo[]>;
  getDefaultGateways(): Promise<DefaultGateway[]>;
  resolveHost(host: string, family: AddressFamily): Promise<string>;
  icmpPing(ip: string, options: IcmpPingOptions): Promise<IcmpPingResult>;
  cancelIcmpPing(requestId: string): Promise<void>;
}

export default requireNativeModule<PingNativeModule>('PingNative');
