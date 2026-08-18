// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

import { getAnalytics, logEvent } from '@react-native-firebase/analytics';

import type { AddressFamily } from '../../modules/ping-native';
import type { Protocol } from '../constants';
import type { PingStats } from '../ping/stats';

export type TestRunSettings = {
  protocol: Protocol;
  port?: number;
  family?: AddressFamily;
  packetSize?: number;
  ttl?: number;
  intervalMs: number;
  count: number;
};

function settingsParams(settings: TestRunSettings): Record<string, string | number> {
  const params: Record<string, string | number> = {
    protocol: settings.protocol,
    interval_ms: settings.intervalMs,
    count: settings.count,
  };
  if (settings.port !== undefined) {
    params.port = settings.port;
  }
  if (settings.family !== undefined) {
    params.family = settings.family;
  }
  if (settings.packetSize !== undefined) {
    params.packet_size = settings.packetSize;
  }
  if (settings.ttl !== undefined) {
    params.ttl = settings.ttl;
  }
  return params;
}

export function logTestStart(settings: TestRunSettings): void {
  try {
    logEvent(getAnalytics(), 'test_start', settingsParams(settings));
  } catch {
    // Analytics is non-critical; the app must work without it.
  }
}

// `stopped` distinguishes a run the user cut short (Stop) from one that ran
// to completion; `sent` (from stats) vs. `count` (from settings) is the
// progress at that point, e.g. sent: 3, count: 50.
export function logTestComplete(settings: TestRunSettings, stats: PingStats, stopped: boolean): void {
  try {
    logEvent(getAnalytics(), 'test_complete', {
      ...settingsParams(settings),
      stopped: stopped ? 1 : 0,
      sent: stats.started,
      cancelled: stats.cancelled,
      lost: stats.lost,
      loss_percent: Math.round(stats.lossPercent),
      avg_ms: Math.round(stats.avg),
      min_ms: Math.round(stats.min),
      max_ms: Math.round(stats.max),
      median_ms: Math.round(stats.median),
      p90_ms: Math.round(stats.p90),
      p95_ms: Math.round(stats.p95),
      p99_ms: Math.round(stats.p99),
    });
  } catch {
    // Analytics is non-critical; the app must work without it.
  }
}
