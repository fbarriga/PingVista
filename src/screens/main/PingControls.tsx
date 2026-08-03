// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

import Ionicons from '@expo/vector-icons/Ionicons';
import { useLayoutEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { type AddressFamily } from '../../../modules/ping-native';
import {
  MAX_COUNT,
  MAX_INTERVAL_MS,
  MAX_PACKET_SIZE,
  MAX_TTL,
  MIN_COUNT,
  MIN_INTERVAL_MS,
  MIN_PACKET_SIZE,
  MIN_TTL,
  type PredefinedHost,
  PROGRESS_OVERLAY_TOP,
  type Protocol,
  PROTOCOLS,
  PROTOCOL_LABELS,
} from '../../constants';
import { type IpAddressFamily } from '../../ping/isIp';

const CONTROLS_HEIGHT_RATIO = 0.40;

const PROTOCOL_MEASUREMENTS: Record<Protocol, string> = {
  icmp: 'Round-trip time for an ICMP echo request and reply. DNS lookup time is not included. A TTL or IPv6 hop limit too low to reach the target times out rather than showing which hop stopped it.',
  https: 'Time until the initial HTTPS response begins, after a warm-up request. Redirects are not followed. DNS lookup, TCP connection, and TLS handshake may be warm, depending on the platform.',
  tcp: 'Time until a new TCP connection to the selected port is established. This includes the TCP handshake (SYN, SYN+ACK, ACK); DNS, TLS, and application data are not included.',
  udp: 'Round-trip time for a STUN binding request and a successful matching response.',
};

type PingControlsProps = {
  availableHeight: number;
  progressOverlayHeight: number;
  protocol: Protocol;
  family: AddressFamily;
  hostInput: string;
  host: string;
  tcpPortInput: string;
  udpPortInput: string;
  udpPort: number;
  packetSize: string;
  ttl: string;
  intervalMs: string;
  count: string;
  routerKeepAliveEnabled: boolean;
  predefinedHosts: PredefinedHost[];
  isRunning: boolean;
  inputsAreInvalid: boolean;
  httpsHostIsInvalid: boolean;
  addressFamilyIsInvalid: boolean;
  literalAddressFamily: IpAddressFamily | undefined;
  tcpPortIsInvalid: boolean;
  udpPortIsInvalid: boolean;
  packetSizeIsInvalid: boolean;
  ttlIsInvalid: boolean;
  intervalIsInvalid: boolean;
  countIsInvalid: boolean;
  onProtocolChange: (protocol: Protocol) => void;
  onFamilyChange: (family: AddressFamily) => void;
  onHostChange: (host: string) => void;
  onPortChange: (port: string) => void;
  onPacketSizeChange: (size: string) => void;
  onTtlChange: (ttl: string) => void;
  onIntervalChange: (interval: string) => void;
  onCountChange: (count: string) => void;
  onRouterKeepAliveChange: (enabled: boolean) => void;
  onPresetChange: (host: PredefinedHost) => void;
  onStart: () => void;
  onStop: () => void;
};

export default function PingControls(props: PingControlsProps) {
  const [showMeasurementInfo, setShowMeasurementInfo] = useState(false);
  const [controlsNeedCollapse, setControlsNeedCollapse] = useState(false);
  const [showAdditionalControls, setShowAdditionalControls] = useState(true);
  const controlsLayoutSignature = useRef('');
  const controlsContentHeight = useRef(0);

  const controlsMaxHeight = props.availableHeight > 0
    ? props.availableHeight * CONTROLS_HEIGHT_RATIO
    : undefined;

  const collapse = () => {
    setControlsNeedCollapse(true);
    setShowAdditionalControls(false);
  };

  // ScrollView's onContentSizeChange only fires when the content itself
  // resizes, so a screen-size change alone (controlsMaxHeight shrinking
  // without the content changing) needs its own check against the height
  // already cached from the last content measurement. useLayoutEffect (not
  // useEffect) so the collapse is applied before the smaller maxHeight is
  // painted, matching it in the same frame instead of flashing clipped
  // content for one frame first.
  useLayoutEffect(() => {
    if (controlsMaxHeight !== undefined && controlsContentHeight.current > controlsMaxHeight) {
      collapse();
    }
  }, [controlsMaxHeight]);

  const handleControlsContentSizeChange = (_width: number, height: number) => {
    controlsContentHeight.current = height;
    const signature = [
      props.availableHeight,
      props.family,
      props.protocol,
      props.predefinedHosts.length,
      showMeasurementInfo,
    ].join('-');

    if (controlsLayoutSignature.current !== signature) {
      controlsLayoutSignature.current = signature;
      setControlsNeedCollapse(false);
      setShowAdditionalControls(true);
    }

    if (!controlsNeedCollapse && controlsMaxHeight !== undefined && height > controlsMaxHeight) {
      collapse();
    }
  };

  const handleStartStop = () => {
    if (props.isRunning) {
      props.onStop();
    } else {
      props.onStart();
    }
  };

  return (
    <ScrollView
      style={[styles.controls, controlsMaxHeight !== undefined && { maxHeight: controlsMaxHeight }]}
      // The overlay floats above the controls, so while it is on screen the
      // content is pushed below it instead of hiding under it.
      contentContainerStyle={[
        styles.controlsContent,
        props.isRunning && { paddingTop: PROGRESS_OVERLAY_TOP + props.progressOverlayHeight },
      ]}
      // The number fields use a number pad, which has no return key, so the
      // keyboard is usually still up when Start is tapped. Without this the
      // first tap only dismisses the keyboard and never reaches the button.
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={handleControlsContentSizeChange}
    >
      <View style={styles.sectionLabelRow}>
        <Text style={styles.sectionLabel}>Protocol</Text>
        <Pressable
          style={styles.infoButton}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="What this protocol measures"
          accessibilityState={{ expanded: showMeasurementInfo }}
          onPress={() => setShowMeasurementInfo((visible) => !visible)}
        >
          <Ionicons
            name={showMeasurementInfo ? 'information-circle' : 'information-circle-outline'}
            size={19}
            color="#2563eb"
          />
        </Pressable>
      </View>
      <View style={styles.chipRow}>
        {PROTOCOLS.map((protocol) => (
          <Chip
            key={protocol}
            label={PROTOCOL_LABELS[protocol]}
            active={props.protocol === protocol}
            disabled={props.isRunning}
            onPress={() => props.onProtocolChange(protocol)}
          />
        ))}
        <Pressable
          style={[styles.startButton, !props.isRunning && props.inputsAreInvalid && styles.startButtonDisabled]}
          disabled={!props.isRunning && props.inputsAreInvalid}
          onPress={handleStartStop}
        >
          <Text style={styles.startButtonText}>{props.isRunning ? 'Stop' : 'Start'}</Text>
        </Pressable>
      </View>

      {showMeasurementInfo && (
        <View style={styles.measurementInfo}>
          <Text style={styles.measurementInfoTitle}>What this measures</Text>
          <Text style={styles.measurementInfoText}>{PROTOCOL_MEASUREMENTS[props.protocol]}</Text>
        </View>
      )}

      {(props.protocol === 'tcp' || props.protocol === 'udp') ? (
        <View style={styles.fieldRow}>
          <View style={styles.numberField}>
            <Text style={styles.numberFieldLabel}>Host</Text>
            <TextInput
              style={[styles.textInput, props.isRunning && styles.textInputDisabled]}
              value={props.hostInput}
              onChangeText={props.onHostChange}
              placeholder="Host or IP"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!props.isRunning}
            />
          </View>
          <View style={styles.portField}>
            <NumberField
              label="Port"
              value={props.protocol === 'tcp' ? props.tcpPortInput : props.udpPortInput}
              onChangeText={props.onPortChange}
              disabled={props.isRunning}
              maxLength={5}
            />
          </View>
        </View>
      ) : (
        <>
          <Text style={styles.sectionLabel}>Host</Text>
          <TextInput
            style={[
              styles.textInput,
              props.httpsHostIsInvalid && styles.textInputInvalid,
              props.isRunning && styles.textInputDisabled,
            ]}
            value={props.hostInput}
            onChangeText={props.onHostChange}
            placeholder={props.protocol === 'https' ? 'https://example.com' : 'Host or IP'}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!props.isRunning}
          />
        </>
      )}
      {props.httpsHostIsInvalid && <Text style={styles.validationError}>Enter a valid HTTPS URL.</Text>}
      {props.addressFamilyIsInvalid && (
        <Text style={styles.validationError}>
          Choose IPv{props.literalAddressFamily} or enter an IPv{props.family} address.
        </Text>
      )}
      {props.tcpPortIsInvalid && <Text style={styles.validationError}>Enter a port from 1 to 65535.</Text>}
      {props.udpPortIsInvalid && <Text style={styles.validationError}>Enter a port from 1 to 65535.</Text>}
      <View style={styles.chipRow}>
        {props.predefinedHosts.map((host) => (
          <Chip
            key={host.value}
            label={host.label}
            active={props.protocol === 'udp'
              ? host.value === props.host && host.port === props.udpPort
              : props.hostInput === host.value}
            disabled={props.isRunning}
            onPress={() => props.onPresetChange(host)}
          />
        ))}
      </View>

      {controlsNeedCollapse && (
        <Pressable
          style={styles.additionalControlsButton}
          accessibilityRole="button"
          accessibilityState={{ expanded: showAdditionalControls }}
          onPress={() => setShowAdditionalControls((visible) => !visible)}
        >
          <Text style={styles.additionalControlsButtonText}>
            {showAdditionalControls ? 'Hide additional settings' : 'Show additional settings'}
          </Text>
        </Pressable>
      )}

      {showAdditionalControls && (
        <>
          {props.protocol !== 'https' && (
            <>
              <Text style={styles.sectionLabel}>IP Version</Text>
              <View style={styles.chipRow}>
                <Chip label="IPv4" active={props.family === 4} disabled={props.isRunning} onPress={() => props.onFamilyChange(4)} />
                <Chip label="IPv6" active={props.family === 6} disabled={props.isRunning} onPress={() => props.onFamilyChange(6)} />
              </View>

              {props.protocol === 'icmp' && (
                <>
                  <View style={styles.fieldRow}>
                    <NumberField label="Packet size" value={props.packetSize} onChangeText={props.onPacketSizeChange} disabled={props.isRunning} maxLength={4} />
                    <NumberField label={props.family === 6 ? 'Hop limit' : 'TTL'} value={props.ttl} onChangeText={props.onTtlChange} disabled={props.isRunning} maxLength={3} />
                  </View>
                  {props.packetSizeIsInvalid && <Text style={styles.validationError}>Packet size must be {MIN_PACKET_SIZE}–{MAX_PACKET_SIZE} bytes.</Text>}
                  {props.ttlIsInvalid && <Text style={styles.validationError}>{props.family === 6 ? 'Hop limit' : 'TTL'} must be {MIN_TTL}–{MAX_TTL}.</Text>}
                </>
              )}
            </>
          )}

          <View style={styles.fieldRow}>
            {/* ICMP overlaps requests, so this is a start-to-start cadence; every
                other protocol waits for each request to finish first, so it's a
                pause added after each one instead. */}
            <NumberField
              label={props.protocol === 'icmp' ? 'Delay between pings (ms)' : 'Delay after each ping (ms)'}
              value={props.intervalMs}
              onChangeText={props.onIntervalChange}
              disabled={props.isRunning}
              maxLength={5}
            />
            <NumberField label="Count" value={props.count} onChangeText={props.onCountChange} disabled={props.isRunning} maxLength={4} />
          </View>
          {props.intervalIsInvalid && <Text style={styles.validationError}>Delay must be {MIN_INTERVAL_MS}–{MAX_INTERVAL_MS} ms.</Text>}
          {props.countIsInvalid && <Text style={styles.validationError}>Count must be {MIN_COUNT}–{MAX_COUNT}.</Text>}

          {Platform.OS === 'android' && (
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Keep Wi-Fi awake (ping router every 20 ms)</Text>
              <Switch
                value={props.routerKeepAliveEnabled}
                onValueChange={props.onRouterKeepAliveChange}
                disabled={props.isRunning}
              />
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

function Chip({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function NumberField({
  label,
  value,
  onChangeText,
  disabled,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  disabled?: boolean;
  maxLength?: number;
}) {
  const handleChangeText = (text: string) => {
    onChangeText(text.replace(/\D/g, ''));
  };

  return (
    <View style={styles.numberField}>
      <Text style={styles.numberFieldLabel}>{label}</Text>
      <TextInput
        style={[styles.textInput, disabled && styles.textInputDisabled]}
        value={value}
        onChangeText={handleChangeText}
        keyboardType="number-pad"
        editable={!disabled}
        maxLength={maxLength}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { flexShrink: 0 },
  controlsContent: { padding: 16 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#444', marginTop: 12, marginBottom: 6 },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center' },
  infoButton: { width: 28, height: 28, marginTop: 5, marginLeft: 2, alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: '#999' },
  chipActive: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  chipDisabled: { opacity: 0.4 },
  chipText: { fontSize: 13, color: '#333' },
  chipTextActive: { color: '#fff' },
  measurementInfo: { marginTop: 10, padding: 10, borderRadius: 8, backgroundColor: '#eff6ff' },
  measurementInfoTitle: { fontSize: 12, fontWeight: '600', color: '#1e40af', marginBottom: 2 },
  measurementInfoText: { fontSize: 12, lineHeight: 17, color: '#334155' },
  textInput: { borderWidth: StyleSheet.hairlineWidth, borderColor: '#999', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  textInputInvalid: { borderColor: '#c0392b' },
  textInputDisabled: { opacity: 0.4 },
  validationError: { color: '#c0392b', fontSize: 12, marginTop: 4 },
  fieldRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  portField: { width: 100 },
  numberField: { flex: 1 },
  numberFieldLabel: { fontSize: 12, color: '#666', marginBottom: 4 },
  startButton: { minWidth: 58, marginLeft: 'auto', backgroundColor: '#16a34a', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center' },
  startButtonDisabled: { opacity: 0.5 },
  startButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  additionalControlsButton: { marginTop: 12, alignSelf: 'flex-start' },
  additionalControlsButtonText: { color: '#2563eb', fontSize: 13, fontWeight: '600' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  toggleLabel: { flex: 1, marginRight: 12, fontSize: 13, color: '#444' },
});
