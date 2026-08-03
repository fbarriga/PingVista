// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

import { useRef, useState } from 'react';
import { LineChart } from 'react-native-gifted-charts';
import { LayoutChangeEvent, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  PinchGestureHandler,
  PinchGestureHandlerGestureEvent,
  PinchGestureHandlerStateChangeEvent,
  State,
} from 'react-native-gesture-handler';
import { MAX_MOVING_AVERAGE_WINDOW } from '../../constants';
import { movingAverageWithGaps } from '../../ping/stats';
import { PingResult } from '../../ping/types';

type Props = {
  results: PingResult[];
};

const DEFAULT_SPACING = 28;
const MIN_SPACING = 8;
const MAX_SPACING = 60;
const MAX_VISIBLE_POINTS = 50;
const CHART_VERTICAL_OVERHEAD = 50;
const Y_AXIS_LABEL_WIDTH = 40;
const CHART_EDGE_SPACING = 20;
const TOOLTIP_ABOVE_POINT_SHIFT = -36;
const TOOLTIP_BELOW_POINT_SHIFT = 14;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function renderLatencyTooltip(item: { value?: number }) {
  return (
    <View style={styles.tooltip}>
      <Text style={styles.tooltipText}>{Math.round(item.value ?? 0)} ms</Text>
    </View>
  );
}

function makeLineData(values: (number | undefined)[]) {
  const definedValues = values.filter((value): value is number => value !== undefined);
  const highestValue = Math.max(...definedValues, 0);

  return values.map((value) => {
    if (value === undefined) {
      return {};
    }

    return {
      value,
      // A label above a point near the chart ceiling is clipped. Put it below
      // points in the upper fifth of the chart instead.
      dataPointLabelShiftY:
        highestValue > 0 && value >= highestValue * 0.8
          ? TOOLTIP_BELOW_POINT_SHIFT
          : TOOLTIP_ABOVE_POINT_SHIFT,
    };
  });
}

export default function GraphTab({ results }: Props) {
  const [showMovingAverage, setShowMovingAverage] = useState(false);
  const [windowSizeInput, setWindowSizeInput] = useState('5');
  const [spacing, setSpacing] = useState(DEFAULT_SPACING);
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });
  const gestureStartSpacing = useRef(DEFAULT_SPACING);

  const sortedResults = [...results].sort((a, b) => a.seq - b.seq);
  const highestSequence = sortedResults.at(-1)?.seq ?? 0;
  const times: (number | undefined)[] = Array.from({ length: highestSequence });
  for (const result of sortedResults) {
    times[result.seq - 1] = result.timeMs;
  }
  const hasSuccessfulResult = times.some((time) => time !== undefined);
  const lineData = makeLineData(times);

  const windowSize = Math.min(MAX_MOVING_AVERAGE_WINDOW, Math.max(1, Number(windowSizeInput) || 5));
  const averageData = showMovingAverage
    ? makeLineData(movingAverageWithGaps(times, windowSize))
    : undefined;

  const onPinchGestureEvent = (event: PinchGestureHandlerGestureEvent) => {
    setSpacing(clamp(gestureStartSpacing.current * event.nativeEvent.scale, MIN_SPACING, MAX_SPACING));
  };

  const onPinchHandlerStateChange = (event: PinchGestureHandlerStateChangeEvent) => {
    if (event.nativeEvent.state === State.BEGAN) {
      gestureStartSpacing.current = spacing;
    }
  };

  const onChartLayout = (event: LayoutChangeEvent) => {
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

  const plotWidth = Math.max(0, chartSize.width - Y_AXIS_LABEL_WIDTH);
  const visiblePointCount = Math.min(lineData.length, MAX_VISIBLE_POINTS);
  const spacingToFillWidth = visiblePointCount > 1
    ? Math.max(1, (plotWidth - CHART_EDGE_SPACING * 2) / (visiblePointCount - 1))
    : plotWidth;
  const chartSpacing = spacingToFillWidth * (spacing / DEFAULT_SPACING);
  const chartHeight = Math.max(0, chartSize.height - CHART_VERTICAL_OVERHEAD);

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Text style={styles.toolbarLabel}>Moving average</Text>
        <Switch value={showMovingAverage} onValueChange={setShowMovingAverage} />
        {showMovingAverage && (
          <>
            <Text style={styles.toolbarLabel}>Window</Text>
            <TextInput
              style={styles.windowInput}
              value={windowSizeInput}
              onChangeText={(value) => setWindowSizeInput(value.replace(/\D/g, '').slice(0, 4))}
              onEndEditing={() => setWindowSizeInput(String(windowSize))}
              keyboardType="number-pad"
            />
          </>
        )}
      </View>

      <PinchGestureHandler onGestureEvent={onPinchGestureEvent} onHandlerStateChange={onPinchHandlerStateChange}>
        <View style={styles.chartArea} onLayout={onChartLayout}>
          {hasSuccessfulResult && chartSize.width > 0 && chartHeight > 0 ? (
            <LineChart
              data={lineData}
              data2={averageData}
              color1="#3b82f6"
              color2="#f97316"
              height={chartHeight}
              width={plotWidth}
              parentWidth={chartSize.width}
              spacing={chartSpacing}
              initialSpacing={CHART_EDGE_SPACING}
              endSpacing={CHART_EDGE_SPACING}
              thickness={2}
              dataPointsRadius={lineData.length > 30 ? 2 : 4}
              focusEnabled
              showDataPointLabelOnFocus
              focusedDataPointLabelComponent={renderLatencyTooltip}
              dataPointLabelWidth={72}
              focusedDataPointRadius={6}
              unFocusOnPressOut
              delayBeforeUnFocus={2000}
              yAxisThickness={0}
              xAxisThickness={1}
              noOfSections={4}
              mostNegativeValue={0}
              interpolateMissingValues={false}
              extrapolateMissingValues={false}
              showDataPointsForMissingValues={false}
            />
          ) : (
            <Text style={styles.empty}>
              {results.length > 0
                ? 'No successful pings to graph.'
                : 'No pings yet. The graph appears after the first run.'}
            </Text>
          )}
        </View>
      </PinchGestureHandler>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 16 },
  toolbarLabel: { fontSize: 13, color: '#444' },
  windowInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#999',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    width: 50,
    fontSize: 13,
  },
  chartArea: { flex: 1 },
  tooltip: {
    alignItems: 'center',
    backgroundColor: '#1f2937',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  tooltipText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  empty: { textAlign: 'center', marginTop: 32, color: '#666' },
});
