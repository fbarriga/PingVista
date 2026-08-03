// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

import { FlatList, StyleSheet, Text, View } from 'react-native';
import { PingResult } from '../../ping/types';

type Props = {
  results: PingResult[];
};

export default function PingsTab({ results }: Props) {
  return (
    <FlatList
      style={styles.container}
      data={[...results].reverse()}
      keyExtractor={(item) => String(item.seq)}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Text style={styles.host} numberOfLines={1}>
            {item.ip ? (item.host ? `${item.host} (${item.ip})` : item.ip) : item.host}
          </Text>
          <Text style={styles.seq}>seq={item.seq}</Text>
          <Text style={item.error ? styles.error : styles.time}>
            {item.error ?? (item.timeMs !== undefined ? `${item.timeMs.toFixed(1)} ms` : '—')}
          </Text>
        </View>
      )}
      ListEmptyComponent={<Text style={styles.empty}>No pings yet. Press Start above.</Text>}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  host: { flex: 1, fontSize: 13 },
  seq: { width: 64, fontSize: 12, color: '#666' },
  time: { width: 80, textAlign: 'right', fontSize: 13 },
  error: { width: 130, textAlign: 'right', fontSize: 12, color: '#c0392b' },
  empty: { textAlign: 'center', marginTop: 32, color: '#666' },
});
