// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

import { fetch } from 'expo/fetch';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import PingNative, { NetworkInterfaceInfo } from '../../modules/ping-native';
import { DEFAULT_TIMEOUT_MS } from '../constants';
import { isIpAddress } from "../ping/isIp";

const externalIpUrls = ['https://ifconfig.me/ip', 'https://api.ipify.org'];
const MAX_IP_ADDRESS_LENGTH = 64;



async function getExternalIp(): Promise<string> {
  for (const url of externalIpUrls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: { 'Cache-Control': 'no-cache' },
        signal: controller.signal,
      });

      if (!response.ok) {
        continue;
      }

      const ip = (await response.text()).trim();
      if (ip.length <= MAX_IP_ADDRESS_LENGTH && isIpAddress(ip)) {
        return ip;
      }
    } catch {
      // Try the next service.
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('Unable to get external IP');
}

async function loadNetworkInfo() {
  const [interfacesResult, externalIpResult] = await Promise.allSettled([
    PingNative.getNetworkInterfaces(),
    getExternalIp(),
  ]);

  return {
    interfaces: interfacesResult.status === 'fulfilled' ? interfacesResult.value : [],
    externalIp: externalIpResult.status === 'fulfilled' ? externalIpResult.value : null,
  };
}

export default function InfoScreen() {
  const [interfaces, setInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  const [externalIp, setExternalIp] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const mounted = useRef(true);
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) {
      return;
    }
    loading.current = true;

    try {
      const networkInfo = await loadNetworkInfo();
      if (!mounted.current) {
        return;
      }

      setInterfaces(networkInfo.interfaces);
      setExternalIp(networkInfo.externalIp);
    } finally {
      loading.current = false;
      if (mounted.current) {
        setRefreshing(false);
      }
    }
  }, []);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    void load();

    return () => {
      mounted.current = false;
    };
  }, [load]);

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <Text style={styles.sectionTitle}>External IP</Text>
      <Text testID="external-ip-value" style={styles.value}>{externalIp ?? 'Unavailable'}</Text>

      <Text style={styles.sectionTitle}>Network Interfaces</Text>
      {interfaces.length === 0 && <Text style={styles.value}>No active interfaces found</Text>}
      {interfaces.map((iface) => (
        <View key={iface.name} style={styles.interfaceBlock}>
          <Text style={styles.interfaceName}>{iface.name}</Text>
          {iface.addresses.map((address) => (
            <Text key={`${address.family}-${address.ip}`} style={styles.value}>
              IPv{address.family}: {address.ip}
            </Text>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  interfaceBlock: { marginBottom: 12 },
  interfaceName: { fontSize: 14, fontWeight: '600' },
  value: { fontSize: 14, color: '#333', marginTop: 2 },
});
