// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

import { useNetInfo } from '@react-native-community/netinfo';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Protocol } from '../../constants';
import { summarize } from '../../ping/stats';
import { PingResult } from '../../ping/types';

type Props = {
  results: PingResult[];
  protocol: Protocol;
};

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function latency(value: number, hasResults: boolean): string {
  return hasResults ? `${value.toFixed(1)} ms` : '—';
}

export default function DetailsTab({ results, protocol }: Props) {
  const stats = summarize(results);
  const netInfo = useNetInfo();
  const hasSuccessfulResults = stats.started - stats.cancelled > stats.lost;
  const failedLabel = protocol === 'icmp' ? 'Lost' : 'Failed';
  const failurePercentLabel = protocol === 'icmp' ? 'Loss %' : 'Failure %';

  return (
    <ScrollView style={styles.container}>
      <StatRow label="Completed" value={String(stats.started)} />
      <StatRow label="Cancelled" value={String(stats.cancelled)} />
      <StatRow label={failedLabel} value={String(stats.lost)} />
      <StatRow label={failurePercentLabel} value={`${stats.lossPercent.toFixed(1)}%`} />
      <StatRow label="Min" value={latency(stats.min, hasSuccessfulResults)} />
      <StatRow label="Avg" value={latency(stats.avg, hasSuccessfulResults)} />
      <StatRow label="Max" value={latency(stats.max, hasSuccessfulResults)} />
      <StatRow label="Median" value={latency(stats.median, hasSuccessfulResults)} />
      <StatRow label="p90" value={latency(stats.p90, hasSuccessfulResults)} />
      <StatRow label="p95" value={latency(stats.p95, hasSuccessfulResults)} />
      <StatRow label="p99" value={latency(stats.p99, hasSuccessfulResults)} />
      <StatRow label="Current connection" value={netInfo?.type ?? 'unknown'} />
      {/* intentionally blank: trailing spacer so the last real row's
          hairline divider doesn't sit flush against the scroll edge. */}
      <StatRow label={""} value={""} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  statLabel: { fontSize: 14, color: '#444' },
  statValue: { fontSize: 14, fontWeight: '600' },
});
