// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

import { useEffect, useRef, useState } from 'react';
import { BarChart } from 'react-native-gifted-charts';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { PingResult } from '../../ping/types';
import { barDataItem } from "gifted-charts-core/dist/BarChart/types";

type Props = {
  results: PingResult[];
};

type HistogramBin = barDataItem & {
  range: string;
};

const HISTOGRAM_BUCKETS = 8;
const CHART_VERTICAL_OVERHEAD = 50;
const Y_AXIS_LABEL_WIDTH = 40;
const TOOLTIP_DURATION_MS = 2000;
const NARROW_SCREEN_TOOLTIP_EDGE_SHIFT = 48;

/**
 * @param values in milliseconds
 * @param wideScreen on wide screens we have space to put the range of each bin, on smaller screens we put the center.
 */
function buildHistogramBins(values: number[], wideScreen: boolean): HistogramBin[] {
  if (values.length === 0) {
    return [];
  }

  // round to 1 digit
  values = values.map(v => parseFloat(v.toFixed(1)));

  const lo = Math.min(...values);
  const hi = Math.max(...values);

  // A single distinct latency has no range to label, so the one bar is named
  // after the value itself rather than a zero-width "12.3–12.3".
  if (lo === hi) {
    return [{ value: values.length, label: `${lo}`, range: `${lo} ms` }];
  }

  // Cap the buckets by how many distinct latencies there are, not by the span
  // in milliseconds: LAN and router pings differ by fractions of a millisecond
  // and would otherwise collapse into a single useless bar.
  const uniqueValues = new Set(values);
  const bucketCount = Math.min(HISTOGRAM_BUCKETS, uniqueValues.size);
  const bucketSize = (hi - lo) / bucketCount;
  const counts = new Array(bucketCount).fill(0);

  for (const value of values) {
    const index = Math.min(bucketCount - 1, Math.floor((value - lo) / bucketSize));
    counts[index]++;
  }

  const fractionDigits = bucketSize <= 1.0 ? 1 : 0;
  const halfBucket = bucketSize / 2;

  return counts.map((count, i) => {
    const start = (lo + i * bucketSize).toFixed(fractionDigits);
    const end = (lo + (i + 1) * bucketSize).toFixed(fractionDigits);

    return {
      value: count,
      label: wideScreen ? `${start} - ${end}` : `${(lo + i * bucketSize + halfBucket).toFixed(fractionDigits)}`,
      range: `${start} - ${end} ms`,
      leftShiftForTooltip: !wideScreen && i === 0 ? -NARROW_SCREEN_TOOLTIP_EDGE_SHIFT : undefined,
    };
  });
}

function renderHistogramTooltip(item: HistogramBin) {
  const pingCount = item.value ?? 0;

  return (
    <View style={styles.tooltip} accessibilityLabel={`${item.range}, ${pingCount} ${pingCount === 1 ? 'ping' : 'pings'}`}>
      <Text style={styles.tooltipText}>{item.range}</Text>
      <Text style={styles.tooltipText}>{pingCount} {pingCount === 1 ? 'ping' : 'pings'}</Text>
    </View>
  );
}

export default function HistogramTab({ results }: Props) {
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(tooltipTimer.current), []);

  const timesMs = results
    .map((r) => r.timeMs)
    .filter((t): t is number => t !== undefined);

  const handleChartLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    const nextSize = {
      width: Math.round(width),
      height: Math.round(height),
    };

    setChartSize((currentSize) =>
      currentSize.width === nextSize.width && currentSize.height === nextSize.height
        ? currentSize
        : nextSize
    );
  };

  const chartHeight = Math.max(0, chartSize.height - CHART_VERTICAL_OVERHEAD);
  const plotWidth = Math.max(0, chartSize.width - Y_AXIS_LABEL_WIDTH);
  const wideScreen = plotWidth > 400;
  const histogramBins = buildHistogramBins(timesMs, wideScreen);

  const handleBarPress = () => {
    setShowTooltip(true);
    clearTimeout(tooltipTimer.current);
    tooltipTimer.current = setTimeout(() => setShowTooltip(false), TOOLTIP_DURATION_MS);
  };

  return (
    <View style={styles.container}>
      <View style={styles.chartArea} onLayout={handleChartLayout}>
        {timesMs.length > 0 && chartSize.width > 0 && chartHeight > 0 ? (
          <BarChart
            data={histogramBins}
            height={chartHeight}
            parentWidth={chartSize.width}
            width={plotWidth}
            adjustToWidth
            yAxisThickness={0}
            xAxisThickness={1}
            noOfSections={4}
            mostNegativeValue={0}
            frontColor="#3b82f6"
            onPress={handleBarPress}
            renderTooltip={(item: HistogramBin) => showTooltip ? renderHistogramTooltip(item) : null}
            autoCenterTooltip
            leftShiftForLastIndexTooltip={
              !wideScreen && histogramBins.length > 1 ? NARROW_SCREEN_TOOLTIP_EDGE_SHIFT : 0
            }
          />
        ) : (
          <Text style={styles.empty}>
            {results.length > 0
              ? 'No successful pings to chart.'
              : 'No pings yet. The histogram appears after the first run.'}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  chartArea: { flex: 1 },
  tooltip: {
    alignItems: 'center',
    backgroundColor: '#1f2937',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    width: 112,
  },
  tooltipText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  empty: { textAlign: 'center', marginTop: 32, color: '#666' },
});
