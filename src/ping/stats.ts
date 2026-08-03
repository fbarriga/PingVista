// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

import { PingResult } from './types';

export function min(values: number[]): number {
  return values.length === 0 ? 0 : Math.min(...values);
}

export function max(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

export function avg(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return 0;
  }

  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }

  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function median(values: number[]): number {
  return percentile(values, 50);
}

export function movingAverageWithGaps(
  values: (number | undefined)[],
  windowSize: number
): (number | undefined)[] {
  const size = Math.max(1, windowSize);
  const recentValues: number[] = [];

  return values.map((value) => {
    if (value === undefined) {
      recentValues.length = 0;
      return undefined;
    }

    recentValues.push(value);
    if (recentValues.length > size) {
      recentValues.shift();
    }
    return avg(recentValues);
  });
}

export type PingStats = {
  started: number;
  cancelled: number;
  lost: number;
  lossPercent: number;
  min: number;
  max: number;
  avg: number;
  median: number;
  p90: number;
  p95: number;
  p99: number;
};

const EMPTY_STATS: PingStats = {
  started: 0,
  cancelled: 0,
  lost: 0,
  lossPercent: 0,
  min: 0,
  max: 0,
  avg: 0,
  median: 0,
  p90: 0,
  p95: 0,
  p99: 0,
};

export function summarize(results: PingResult[]): PingStats {
  const started = results.length;
  if (started === 0) {
    return EMPTY_STATS;
  }

  const cancelled = results.filter((result) => result.cancelled).length;
  const evaluatedResults = results.filter((result) => !result.cancelled);

  const times = evaluatedResults
    .map((r) => r.timeMs)
    .filter((t): t is number => t !== undefined);

  const lost = evaluatedResults.length - times.length;

  if (times.length === 0) {
    return {
      ...EMPTY_STATS,
      started,
      cancelled,
      lost,
      lossPercent: evaluatedResults.length > 0 ? 100 : 0,
    };
  }

  return {
    started,
    cancelled,
    lost,
    lossPercent: (lost / evaluatedResults.length) * 100,
    min: min(times),
    max: max(times),
    avg: avg(times),
    median: median(times),
    p90: percentile(times, 90),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
  };
}
