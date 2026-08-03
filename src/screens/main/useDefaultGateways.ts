// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

import NetInfo from '@react-native-community/netinfo';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';

import PingNative, { type AddressFamily, type DefaultGateway } from '../../../modules/ping-native';
import { predefinedHostsFor, type Protocol } from '../../constants';

type UseDefaultGatewaysOptions = {
  protocol: Protocol;
  family: AddressFamily;
  hostInput: string;
  isRunning: boolean;
  setHostInput: (host: string) => void;
  resetResults: () => void;
};

export function useDefaultGateways({
  protocol,
  family,
  hostInput,
  isRunning,
  setHostInput,
  resetResults,
}: UseDefaultGatewaysOptions) {
  const [defaultGateways, setDefaultGateways] = useState<DefaultGateway[]>([]);
  const routerIsSelected = useRef(false);
  const hostInputRef = useRef(hostInput);
  const isRunningRef = useRef(isRunning);
  const pendingGateways = useRef<DefaultGateway[] | undefined>(undefined);
  const isMountedRef = useRef(true);
  const latestGatewayRequestId = useRef(0);

  useEffect(() => {
    hostInputRef.current = hostInput;
  }, [hostInput]);

  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const applyGateways = useCallback((gateways: DefaultGateway[]) => {
    setDefaultGateways(gateways);

    if (protocol !== 'icmp' || !routerIsSelected.current) {
      return;
    }

    const nextGateway = gateways.find((item) => item.family === family);
    const nextHost = nextGateway?.ip ?? predefinedHostsFor('icmp', family)[0].value;
    if (!nextGateway) {
      routerIsSelected.current = false;
    }

    if (hostInputRef.current !== nextHost) {
      hostInputRef.current = nextHost;
      setHostInput(nextHost);
      resetResults();
    }
  }, [family, protocol, resetResults, setHostInput]);

  useEffect(() => {
    if (isRunning || pendingGateways.current === undefined) {
      return;
    }

    const gateways = pendingGateways.current;
    pendingGateways.current = undefined;
    applyGateways(gateways);
  }, [applyGateways, isRunning]);

  const refreshGateways = useCallback(() => {
    // Focus events and NetInfo events can each trigger a refresh, so more
    // than one lookup can be in flight at once. Only the most recently
    // issued one may win, regardless of which resolves first, or a stale
    // lookup that finishes after a newer one could reapply an outdated
    // gateway (and reset a finished run's results through applyGateways).
    const requestId = ++latestGatewayRequestId.current;
    PingNative.getDefaultGateways()
      .then((gateways) => {
        if (!isMountedRef.current || requestId !== latestGatewayRequestId.current) {
          return;
        }

        if (isRunningRef.current) {
          pendingGateways.current = gateways;
        } else {
          applyGateways(gateways);
        }
      })
      .catch(() => {
        // A failed lookup is not the same as "this network has no router".
        // Keeping the last known gateway means a transient failure (no
        // active network, a sysctl error) can't silently retarget the ping
        // and wipe a finished run's results.
      });
  }, [applyGateways]);

  useFocusEffect(
    useCallback(() => {
      refreshGateways();
    }, [refreshGateways])
  );

  // Gateways can also change while the screen stays focused (Wi-Fi roaming, a
  // VPN connecting or disconnecting, a cellular handoff), so the Router target
  // needs to refresh on network changes too, not just when the tab regains focus.
  useEffect(() => NetInfo.addEventListener(refreshGateways), [refreshGateways]);

  const gateway = protocol === 'icmp'
    ? defaultGateways.find((item) => item.family === family)
    : undefined;

  const setRouterSelected = useCallback((selected: boolean) => {
    routerIsSelected.current = selected;
  }, []);

  const markRunStarting = useCallback(() => {
    isRunningRef.current = true;
  }, []);

  return { gateway, defaultGateways, setRouterSelected, markRunStarting };
}
