// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, Platform, StyleSheet, Text, View } from 'react-native';

import PingNative, { type AddressFamily, type DefaultGateway } from '../../modules/ping-native';
import { logTestComplete, logTestStart, type TestRunSettings } from '../analytics/analytics';
import {
  DEFAULT_COUNT,
  DEFAULT_INTERVAL_MS,
  DEFAULT_PACKET_SIZE,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TTL,
  ICMP_HOSTS_V4,
  MAX_COUNT,
  MAX_INTERVAL_MS,
  MAX_PACKET_SIZE,
  MAX_TTL,
  MIN_COUNT,
  MIN_INTERVAL_MS,
  MIN_PACKET_SIZE,
  MIN_TTL,
  type PredefinedHost,
  predefinedHostsFor,
  PROGRESS_OVERLAY_TOP,
  type Protocol,
  ROUTER_KEEP_ALIVE_INTERVAL_MS,
  ROUTER_KEEP_ALIVE_WARMUP_MS,
  TCP_PORT,
  UDP_STUN_HOSTS,
} from '../constants';
import { ipAddressFamily } from '../ping/isIp';
import { pingHttps } from '../ping/protocols/https';
import { pingIcmp } from '../ping/protocols/icmp';
import { resolveHostWithTimeout } from '../ping/protocols/resolveHost';
import { pingTcp } from '../ping/protocols/tcp';
import { pingUdp } from '../ping/protocols/udpStun';
import { summarize } from '../ping/stats';
import { type PreparedRun, usePingRunner } from '../ping/usePingRunner';
import DetailsTab from './main/DetailsTab';
import GraphTab from './main/GraphTab';
import HistogramTab from './main/HistogramTab';
import PingControls from './main/PingControls';
import PingsTab from './main/PingsTab';
import { useDefaultGateways } from './main/useDefaultGateways';

const TopTab = createMaterialTopTabNavigator();
const PROGRESS_ANIMATION_MS = 250;
// Starting guess for the floating overlay's height, replaced by its measured
// height on first layout. Only there to keep the first run from flashing the
// controls underneath it; the real value shifts with the user's font scale.
const PROGRESS_OVERLAY_ESTIMATED_HEIGHT = 50;

function isIntegerInRange(value: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(value)) {
    return false;
  }

  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max;
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.length > 0 && !url.username && !url.password;
  } catch {
    return false;
  }
}

export default function MainScreen() {
  const [availableHeight, setAvailableHeight] = useState(0);
  const [progressOverlayHeight, setProgressOverlayHeight] = useState(PROGRESS_OVERLAY_ESTIMATED_HEIGHT);
  const [protocol, setProtocol] = useState<Protocol>('icmp');
  const [family, setFamily] = useState<AddressFamily>(4);
  const [hostInput, setHostInput] = useState(ICMP_HOSTS_V4[0].value);
  const [tcpPortInput, setTcpPortInput] = useState(String(TCP_PORT));
  const [udpPortInput, setUdpPortInput] = useState(String(UDP_STUN_HOSTS[0].port));
  const [packetSize, setPacketSize] = useState(String(DEFAULT_PACKET_SIZE));
  const [ttl, setTtl] = useState(String(DEFAULT_TTL));
  const [intervalMs, setIntervalMs] = useState(String(DEFAULT_INTERVAL_MS));
  const [count, setCount] = useState(String(DEFAULT_COUNT));
  const [routerKeepAliveEnabled, setRouterKeepAliveEnabled] = useState(true);

  const host = hostInput.trim();
  const tcpPort = Number(tcpPortInput);
  const udpPort = Number(udpPortInput);
  const numericPacketSize = Number(packetSize);
  const numericTtl = Number(ttl);
  const numericIntervalMs = Number(intervalMs);
  const numericCount = Number(count);

  const prepareRun = useCallback(async (signal: AbortSignal): Promise<PreparedRun> => {
    if (protocol === 'https') {
      await pingHttps(host, 0, DEFAULT_TIMEOUT_MS, signal);
      return {
        host,
        pingOnce: (seq, runSignal) => pingHttps(host, seq, DEFAULT_TIMEOUT_MS, runSignal),
      };
    }

    try {
      const ip = await resolveHostWithTimeout(host, family, DEFAULT_TIMEOUT_MS, signal);

      if (protocol === 'udp') {
        return {
          host,
          ip,
          pingOnce: (seq, runSignal) => pingUdp(host, ip, udpPort, seq, family, DEFAULT_TIMEOUT_MS, runSignal),
        };
      }

      if (protocol === 'icmp') {
        return {
          host,
          ip,
          pingOnce: (seq, runSignal, requestId) => pingIcmp({
            hostOrIp: host,
            ip,
            family,
            packetSize: numericPacketSize,
            ttl: numericTtl,
            timeoutMs: DEFAULT_TIMEOUT_MS,
            seq,
            requestId,
            signal: runSignal,
          }),
        };
      }

      return {
        host,
        ip,
        pingOnce: (seq, runSignal) => pingTcp(host, ip, tcpPort, seq, DEFAULT_TIMEOUT_MS, runSignal),
      };
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }

      return {
        failure: {
          host,
          error: error instanceof Error ? error.message : 'Could not resolve host',
        },
      };
    }
  }, [family, host, numericPacketSize, numericTtl, protocol, tcpPort, udpPort]);

  // beforeRun (passed into usePingRunner below) needs the router's IP to start
  // the keep-alive thread, but that IP comes from useDefaultGateways, which in
  // turn needs isRunning/resetResults from usePingRunner's return value. A ref
  // breaks the cycle: beforeRun only runs later (when a run actually starts),
  // by which point the effect below has always synced it to the latest gateway.
  const keepAliveGatewayRef = useRef<DefaultGateway | undefined>(undefined);

  const beforeRun = useCallback(async () => {
    await PingNative.beginLatencyOptimization();

    const keepAliveGateway = keepAliveGatewayRef.current;
    if (Platform.OS === 'android' && routerKeepAliveEnabled && keepAliveGateway) {
      await PingNative.beginRouterKeepAlive(keepAliveGateway.ip, keepAliveGateway.family, ROUTER_KEEP_ALIVE_INTERVAL_MS);
      await new Promise<void>((resolve) => setTimeout(resolve, ROUTER_KEEP_ALIVE_WARMUP_MS));
    }
  }, [routerKeepAliveEnabled]);

  const afterRun = useCallback(async () => {
    if (Platform.OS === 'android') {
      await PingNative.endRouterKeepAlive();
    }
    await PingNative.endLatencyOptimization();
  }, []);

  const { results, isRunning, completedCount, totalCount, start, stop, resetResults } = usePingRunner(
    prepareRun,
    beforeRun,
    afterRun,
    protocol === 'icmp'
  );

  // Settings for the run analytics events, captured at Start (before results
  // exist) so the event logged at completion reflects what was actually run,
  // not whatever the form happens to show by the time the run finishes.
  const runSettingsRef = useRef<TestRunSettings | null>(null);
  const stoppedByUserRef = useRef(false);
  const wasRunningRef = useRef(false);
  useEffect(() => {
    if (wasRunningRef.current && !isRunning && runSettingsRef.current) {
      logTestComplete(runSettingsRef.current, summarize(results), stoppedByUserRef.current);
      runSettingsRef.current = null;
      stoppedByUserRef.current = false;
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, results]);

  const { gateway, defaultGateways, markRunStarting, setRouterSelected } = useDefaultGateways({
    protocol,
    family,
    hostInput,
    isRunning,
    setHostInput,
    resetResults,
  });

  const keepAliveGateway = defaultGateways.find((item) => item.family === family);
  useEffect(() => {
    keepAliveGatewayRef.current = keepAliveGateway;
  }, [keepAliveGateway]);

  const predefinedHosts = gateway
    ? [
        { label: 'Router', value: gateway.ip },
        ...predefinedHostsFor(protocol, family).filter((item) => item.value !== gateway.ip),
      ]
    : predefinedHostsFor(protocol, family);

  const handleProtocolChange = (nextProtocol: Protocol) => {
    setRouterSelected(false);
    setProtocol(nextProtocol);
    const nextPreset = predefinedHostsFor(nextProtocol, family)[0];
    setHostInput(nextPreset.value);
    if (nextProtocol === 'udp') {
      setUdpPortInput(String(nextPreset.port));
    }
    resetResults();
  };

  const handleFamilyChange = (nextFamily: AddressFamily) => {
    setRouterSelected(false);
    setFamily(nextFamily);
    const nextPreset = predefinedHostsFor(protocol, nextFamily)[0];
    setHostInput(nextPreset.value);
    if (protocol === 'udp') {
      setUdpPortInput(String(nextPreset.port));
    }
    resetResults();
  };

  const handleHostChange = (nextHost: string) => {
    setRouterSelected(false);
    setHostInput(nextHost);
    resetResults();
  };

  const handlePortChange = (nextPort: string) => {
    if (protocol === 'tcp') {
      setTcpPortInput(nextPort);
    } else {
      setUdpPortInput(nextPort);
    }
    resetResults();
  };

  const handlePacketSizeChange = (nextPacketSize: string) => {
    setPacketSize(nextPacketSize);
    resetResults();
  };

  const handleTtlChange = (nextTtl: string) => {
    setTtl(nextTtl);
    resetResults();
  };

  const handleIntervalChange = (nextInterval: string) => {
    setIntervalMs(nextInterval);
    resetResults();
  };

  const handleCountChange = (nextCount: string) => {
    setCount(nextCount);
    resetResults();
  };

  const handlePresetChange = (preset: PredefinedHost) => {
    setRouterSelected(gateway?.ip === preset.value);
    setHostInput(preset.value);
    if (protocol === 'udp') {
      setUdpPortInput(String(preset.port));
    }
    resetResults();
  };

  const handleStart = () => {
    markRunStarting();
    const settings: TestRunSettings = {
      protocol,
      port: protocol === 'tcp' ? tcpPort : protocol === 'udp' ? udpPort : undefined,
      family: protocol === 'https' ? undefined : family,
      packetSize: protocol === 'icmp' ? numericPacketSize : undefined,
      ttl: protocol === 'icmp' ? numericTtl : undefined,
      intervalMs: numericIntervalMs,
      count: numericCount,
    };
    runSettingsRef.current = settings;
    stoppedByUserRef.current = false;
    logTestStart(settings);
    void start(numericCount, numericIntervalMs);
  };

  const handleStop = () => {
    stoppedByUserRef.current = true;
    stop();
  };

  const httpsHostIsInvalid = protocol === 'https' && !isHttpsUrl(host);
  const literalAddressFamily = ipAddressFamily(host);
  const addressFamilyIsInvalid = protocol !== 'https'
    && literalAddressFamily !== undefined
    && literalAddressFamily !== family;
  const udpPortIsInvalid = protocol === 'udp' && !isIntegerInRange(udpPortInput, 1, 65535);
  const tcpPortIsInvalid = protocol === 'tcp' && !isIntegerInRange(tcpPortInput, 1, 65535);
  const packetSizeIsInvalid = protocol === 'icmp' && !isIntegerInRange(packetSize, MIN_PACKET_SIZE, MAX_PACKET_SIZE);
  const ttlIsInvalid = protocol === 'icmp' && !isIntegerInRange(ttl, MIN_TTL, MAX_TTL);
  const intervalIsInvalid = !isIntegerInRange(intervalMs, MIN_INTERVAL_MS, MAX_INTERVAL_MS);
  const countIsInvalid = !isIntegerInRange(count, MIN_COUNT, MAX_COUNT);
  const inputsAreInvalid = host.length === 0
    || httpsHostIsInvalid
    || addressFamilyIsInvalid
    || udpPortIsInvalid
    || tcpPortIsInvalid
    || packetSizeIsInvalid
    || ttlIsInvalid
    || intervalIsInvalid
    || countIsInvalid;

  const handleScreenLayout = (event: LayoutChangeEvent) => {
    const nextHeight = Math.round(event.nativeEvent.layout.height);
    setAvailableHeight((currentHeight) => currentHeight === nextHeight ? currentHeight : nextHeight);
  };

  return (
    <View style={styles.screen} onLayout={handleScreenLayout}>
      {isRunning && (
        <RunProgressOverlay
          completedCount={completedCount}
          totalCount={totalCount}
          onHeightChange={setProgressOverlayHeight}
        />
      )}

      <PingControls
        availableHeight={availableHeight}
        progressOverlayHeight={progressOverlayHeight}
        protocol={protocol}
        family={family}
        hostInput={hostInput}
        host={host}
        tcpPortInput={tcpPortInput}
        udpPortInput={udpPortInput}
        udpPort={udpPort}
        packetSize={packetSize}
        ttl={ttl}
        intervalMs={intervalMs}
        count={count}
        routerKeepAliveEnabled={routerKeepAliveEnabled}
        predefinedHosts={predefinedHosts}
        isRunning={isRunning}
        inputsAreInvalid={inputsAreInvalid}
        httpsHostIsInvalid={httpsHostIsInvalid}
        addressFamilyIsInvalid={addressFamilyIsInvalid}
        literalAddressFamily={literalAddressFamily}
        tcpPortIsInvalid={tcpPortIsInvalid}
        udpPortIsInvalid={udpPortIsInvalid}
        packetSizeIsInvalid={packetSizeIsInvalid}
        ttlIsInvalid={ttlIsInvalid}
        intervalIsInvalid={intervalIsInvalid}
        countIsInvalid={countIsInvalid}
        onProtocolChange={handleProtocolChange}
        onFamilyChange={handleFamilyChange}
        onHostChange={handleHostChange}
        onPortChange={handlePortChange}
        onPacketSizeChange={handlePacketSizeChange}
        onTtlChange={handleTtlChange}
        onIntervalChange={handleIntervalChange}
        onCountChange={handleCountChange}
        onRouterKeepAliveChange={setRouterKeepAliveEnabled}
        onPresetChange={handlePresetChange}
        onStart={handleStart}
        onStop={handleStop}
      />

      <View style={styles.results}>
        <TopTab.Navigator>
          <TopTab.Screen name="Pings">{() => <PingsTab results={results} />}</TopTab.Screen>
          <TopTab.Screen name="Histogram">{() => <HistogramTab results={results} />}</TopTab.Screen>
          <TopTab.Screen name="Details">{() => <DetailsTab results={results} protocol={protocol} />}</TopTab.Screen>
          <TopTab.Screen name="Graph">{() => <GraphTab results={results} />}</TopTab.Screen>
        </TopTab.Navigator>
      </View>
    </View>
  );
}

function RunProgressOverlay({
  completedCount,
  totalCount,
  onHeightChange,
}: {
  completedCount: number;
  totalCount: number;
  onHeightChange: (height: number) => void;
}) {
  const [progress] = useState(() => new Animated.Value(0));
  const progressRatio = totalCount > 0 ? Math.min(1, completedCount / totalCount) : 0;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: progressRatio,
      duration: PROGRESS_ANIMATION_MS,
      useNativeDriver: false,
    });

    animation.start();
    return () => animation.stop();
  }, [progress, progressRatio]);

  const progressWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const handleLayout = (event: LayoutChangeEvent) => {
    onHeightChange(Math.round(event.nativeEvent.layout.height));
  };

  return (
    <View
      style={styles.progressOverlay}
      onLayout={handleLayout}
      pointerEvents="none"
      accessibilityRole="progressbar"
      accessibilityLabel={`Ping progress ${completedCount} of ${totalCount}`}
      accessibilityValue={{ min: 0, max: totalCount, now: completedCount }}
    >
      <Text style={styles.progressCount}>{completedCount}/{totalCount}</Text>
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  results: { flex: 1 },
  progressOverlay: {
    position: 'absolute',
    top: PROGRESS_OVERLAY_TOP,
    left: 16,
    right: 16,
    zIndex: 10,
    elevation: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  progressCount: { marginBottom: 6, color: '#334155', fontSize: 13, fontWeight: '600', textAlign: 'right' },
  progressTrack: { height: 6, overflow: 'hidden', borderRadius: 3, backgroundColor: '#dbeafe' },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: '#2563eb' },
});
