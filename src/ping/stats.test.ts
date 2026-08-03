// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

import {
  avg,
  max,
  median,
  min,
  movingAverageWithGaps,
  percentile,
  summarize,
} from './stats';
import { PingResult } from './types';

describe('basic stats', () => {
  const values = [10, 20, 30, 40, 50];

  test('min and max', () => {
    expect(min(values)).toBe(10);
    expect(max(values)).toBe(50);
  });

  test('avg', () => {
    expect(avg(values)).toBe(30);
  });

  test('median of an odd-length list', () => {
    expect(median(values)).toBe(30);
  });

  test('median of an even-length list interpolates', () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  test('percentile at the extremes matches min/max', () => {
    expect(percentile(values, 0)).toBe(10);
    expect(percentile(values, 100)).toBe(50);
  });

  test('min, max, avg, and percentile on an empty list return 0', () => {
    expect(min([])).toBe(0);
    expect(max([])).toBe(0);
    expect(avg([])).toBe(0);
    expect(percentile([], 50)).toBe(0);
  });
});

describe('movingAverageWithGaps', () => {
  test('window of 1 returns the same values', () => {
    expect(movingAverageWithGaps([1, 2, 3], 1)).toEqual([1, 2, 3]);
  });

  test('averages over the trailing window, shrinking at the start', () => {
    expect(movingAverageWithGaps([10, 20, 30, 40], 2)).toEqual([10, 15, 25, 35]);
  });

  test('preserves failures as gaps and starts a new average after each gap', () => {
    expect(movingAverageWithGaps([10, 20, undefined, 40, 60], 2)).toEqual([
      10,
      15,
      undefined,
      40,
      50,
    ]);
  });
});

describe('summarize', () => {
  function result(seq: number, timeMs?: number): PingResult {
    return { seq, timeMs, ip: '1.1.1.1' };
  }

  test('all pings succeed', () => {
    const stats = summarize([result(1, 10), result(2, 20), result(3, 30)]);
    expect(stats.started).toBe(3);
    expect(stats.cancelled).toBe(0);
    expect(stats.lost).toBe(0);
    expect(stats.lossPercent).toBe(0);
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(30);
    expect(stats.avg).toBe(20);
  });

  test('some pings are lost', () => {
    const stats = summarize([result(1, 10), result(2, undefined), result(3, 30)]);
    expect(stats.started).toBe(3);
    expect(stats.lost).toBe(1);
    expect(stats.lossPercent).toBeCloseTo(33.33, 1);
  });

  test('no pings started yet', () => {
    expect(summarize([])).toEqual({
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
    });
  });

  test('every ping lost', () => {
    const stats = summarize([result(1), result(2)]);
    expect(stats.started).toBe(2);
    expect(stats.lost).toBe(2);
    expect(stats.lossPercent).toBe(100);
  });

  test('cancelled attempts are excluded from loss', () => {
    const stats = summarize([
      result(1, 10),
      { seq: 2, cancelled: true, error: 'Cancelled' },
      result(3),
    ]);

    expect(stats.started).toBe(3);
    expect(stats.cancelled).toBe(1);
    expect(stats.lost).toBe(1);
    expect(stats.lossPercent).toBe(50);
  });

  test('an all-cancelled run has no failures', () => {
    const stats = summarize([
      { seq: 1, cancelled: true, error: 'Cancelled' },
      { seq: 2, cancelled: true, error: 'Cancelled' },
    ]);

    expect(stats.started).toBe(2);
    expect(stats.cancelled).toBe(2);
    expect(stats.lost).toBe(0);
    expect(stats.lossPercent).toBe(0);
  });
});
