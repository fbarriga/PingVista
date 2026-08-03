// Copyright © 2026 Felipe Barriga Richards
// SPDX-License-Identifier: LicenseRef-Proprietary

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PingResult } from './types';

export type PingOnce = (seq: number, signal: AbortSignal, requestId: string) => Promise<PingResult>;
export type PreparedRun =
  // `ip` is the resolved numeric address when there is one (icmp/tcp/udp);
  // it lets a cancelled or failed attempt be labelled the same way a
  // successful one is. https has no ip, so `host` carries the URL alone.
  | { pingOnce: PingOnce; host?: string; ip?: string }
  | { failure: Omit<PingResult, 'seq'> };
type PrepareRun = (signal: AbortSignal) => Promise<PreparedRun>;
type RunLifecycle = () => Promise<void>;

const UI_REFRESH_INTERVAL_MS = 500;
const MAX_OVERLAPPING_PINGS = 32;
let nextRunId = 1;

type ActiveRun = {
  stopped: boolean;
  controller: AbortController;
  cancelSleep?: () => void;
};

export function usePingRunner(
  prepareRun: PrepareRun,
  beforeRun?: RunLifecycle,
  afterRun?: RunLifecycle,
  overlapPings = false
) {
  const [results, setResults] = useState<PingResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  // Set synchronously by start() before its first await, so a second tap that
  // lands before React commits isRunning=true is still rejected.
  const activeRun = useRef<ActiveRun | null>(null);
  const isMounted = useRef(true);
  const pendingResults = useRef<PingResult[]>([]);
  const publishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publishInFlight = useRef<Promise<void> | null>(null);
  const confirmPublished = useRef<(() => void) | null>(null);
  const lastPublishedAt = useRef(0);

  useLayoutEffect(() => {
    const confirm = confirmPublished.current;
    confirmPublished.current = null;
    confirm?.();
  }, [results]);

  const publishPendingResults = useCallback(async () => {
    if (publishInFlight.current) {
      await publishInFlight.current;
    }

    const batch = pendingResults.current.splice(0);
    if (batch.length === 0 || !isMounted.current) {
      return;
    }

    let confirmCommit = () => {};
    const committed = new Promise<void>((resolve) => {
      confirmCommit = resolve;
    });

    publishInFlight.current = committed;
    confirmPublished.current = confirmCommit;
    lastPublishedAt.current = Date.now();
    setResults((currentResults) =>
      [...currentResults, ...batch].sort((a, b) => a.seq - b.seq)
    );

    await committed;
    publishInFlight.current = null;
  }, []);

  const scheduleResultsPublish = useCallback(() => {
    if (publishTimer.current || pendingResults.current.length === 0) {
      return;
    }

    const elapsed = Date.now() - lastPublishedAt.current;
    const delay = Math.max(0, UI_REFRESH_INTERVAL_MS - elapsed);

    publishTimer.current = setTimeout(async () => {
      publishTimer.current = null;
      await publishPendingResults();
    }, delay);
  }, [publishPendingResults]);

  const publishFinalResults = useCallback(async () => {
    if (publishTimer.current) {
      clearTimeout(publishTimer.current);
      publishTimer.current = null;
    }

    if (publishInFlight.current) {
      await publishInFlight.current;
    }

    // Unlike scheduleResultsPublish, this never waits out the throttle
    // window: it's the last update for this run, so there's no future
    // batch left to protect from update-frequency jank, and Stop should
    // flip isRunning back to false as soon as possible.
    await publishPendingResults();
  }, [publishPendingResults]);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (activeRun.current) {
        activeRun.current.stopped = true;
        activeRun.current.controller.abort();
        activeRun.current.cancelSleep?.();
      }
      if (publishTimer.current) {
        clearTimeout(publishTimer.current);
      }
      confirmPublished.current?.();
    };
  }, []);

  const start = useCallback(async (count: number, intervalMs: number) => {
    if (activeRun.current) {
      return;
    }

    if (publishTimer.current) {
      clearTimeout(publishTimer.current);
      publishTimer.current = null;
    }

    const run = {
      stopped: false,
      controller: new AbortController(),
    };
    const runId = nextRunId++;
    activeRun.current = run;

    pendingResults.current = [];
    lastPublishedAt.current = Date.now();
    setResults([]);
    setTotalCount(count);
    setIsRunning(true);

    try {
      if (beforeRun) {
        try {
          await beforeRun();
        } catch {
          // Run setup (latency optimization, and on Android the router keep-alive
          // warm-up) is best-effort; pinging can continue without it.
        }
      }

      const prepared = await prepareRun(run.controller.signal);
      if ('failure' in prepared) {
        // The run never got past setup, so its real total is the one failure.
        if (isMounted.current) {
          setTotalCount(1);
        }
        pendingResults.current.push({ seq: 1, ...prepared.failure });
        await publishFinalResults();
        return;
      }

      // Label attempts that never produced a result the way each protocol
      // labels its own: the numeric address, plus the hostname only when it
      // differs from it. Without this a cancelled row reads differently from
      // the completed rows sitting next to it in the list.
      const target = {
        ip: prepared.ip,
        host: prepared.ip === prepared.host ? undefined : prepared.host,
      };

      const runPing = async (seq: number) => {
        let result: PingResult;
        try {
          result = await prepared.pingOnce(seq, run.controller.signal, `${runId}:${seq}`);
        } catch (error) {
          if (run.controller.signal.aborted) {
            result = {
              seq,
              ...target,
              cancelled: true,
              error: 'Cancelled',
            };
          } else {
            result = {
              seq,
              ...target,
              error: error instanceof Error ? error.message : 'Ping failed',
            };
          }
        }
        pendingResults.current.push(result);
        scheduleResultsPublish();
      };

      if (overlapPings) {
        const inFlight = new Set<Promise<void>>();
        for (let seq = 1; seq <= count && !run.stopped; seq++) {
          while (inFlight.size >= MAX_OVERLAPPING_PINGS && !run.stopped) {
            await Promise.race(inFlight);
          }
          if (run.stopped) {
            break;
          }

          let ping: Promise<void>;
          ping = runPing(seq).finally(() => inFlight.delete(ping));
          inFlight.add(ping);
          if (seq < count && !run.stopped) {
            await sleep(intervalMs, run);
          }
        }
        await Promise.all(inFlight);
      } else {
        for (let seq = 1; seq <= count && !run.stopped; seq++) {
          await runPing(seq);
          if (seq < count && !run.stopped) {
            await sleep(intervalMs, run);
          }
        }
      }

      await publishFinalResults();
    } catch (error) {
      // beforeRun/afterRun handle their own failures below, so what reaches
      // here is run setup (prepareRun re-throws on cancellation) or a publish
      // that threw. A cancellation is expected and needs no extra row, but
      // anything else is an unanticipated failure, so surface it rather than
      // ending the run with a silently empty list and no diagnostic at all.
      if (!run.controller.signal.aborted) {
        pendingResults.current.push({
          seq: 1,
          error: error instanceof Error ? error.message : 'Ping run failed',
        });
      }
      try {
        await publishFinalResults();
      } catch {
        // Nothing left to do; the run is over either way.
      }
    } finally {
      activeRun.current = null;
      try {
        if (afterRun) {
          try {
            await afterRun();
          } catch {
            // The cleanup hook is best-effort for the same reason as setup.
          }
        }
      } finally {
        if (isMounted.current) {
          setIsRunning(false);
        }
      }
    }
  }, [afterRun, beforeRun, overlapPings, prepareRun, publishFinalResults, scheduleResultsPublish]);

  const stop = useCallback(() => {
    if (activeRun.current) {
      activeRun.current.stopped = true;
      activeRun.current.controller.abort();
      activeRun.current.cancelSleep?.();
    }
  }, []);

  // Wipes any previously-completed run's results so the result tabs don't
  // show stale data after the user switches protocol/family/host. No-op
  // while a run is in flight; the active run owns the results then.
  const resetResults = useCallback(() => {
    if (activeRun.current) {
      return;
    }
    pendingResults.current = [];
    setResults([]);
  }, []);

  return {
    results,
    isRunning,
    completedCount: results.length,
    totalCount,
    start,
    stop,
    resetResults,
  };
}

function sleep(ms: number, run?: ActiveRun): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      if (run) {
        run.cancelSleep = undefined;
      }
      resolve();
    }
    if (run) {
      run.cancelSleep = finish;
    }
  });
}
