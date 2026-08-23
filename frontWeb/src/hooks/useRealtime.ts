import { useEffect, useRef, useState } from "react";
import { WS_URL } from "../lib/constants";
import type { EventAlert } from "../lib/types";

/**
 * WebSocket realtime client (design D4):
 * - exponential backoff: 1000 ms ×2 up to 30 000 ms, ±20 % jitter per try;
 * - successful (re)connection resets the delay to 1000 ms;
 * - every open — first connect or after a drop — triggers a full REST
 *   reconciliation via the callbacks;
 * - CELLS_UPDATED / REPORT_CREATED messages trigger the matching refetch.
 * - EVENT_OPENED (trigger_emsc / trigger_sgc) fires `onEventOpened` directly,
 *   unthrottled — an earthquake alert must never be dropped by the burst
 *   collapsing applied to the other two message kinds. EVENT_CLOSED
 *   (demo stop) fires `onEventClosed` the same way.
 *
 * A WS outage never breaks the UI: it keeps showing the last known data.
 */

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

/**
 * Minimum gap between two visible-same refetches of the same kind.
 * WS bursts (e.g. several CELLS_UPDATED in one second) collapse into a single
 * REST refetch instead of hammering the API and churning the deck.gl layer.
 */
const MIN_UPDATE_INTERVAL_MS = 5000;

export function useRealtime(
  onCellsUpdated: () => void,
  onReportCreated: () => void,
  onEventOpened?: (alert: EventAlert) => void,
  onEventClosed?: () => void,
): boolean {
  const [connected, setConnected] = useState(false);

  // Latest callbacks without re-subscribing the socket on every render.
  const handlers = useRef({ onCellsUpdated, onReportCreated, onEventOpened, onEventClosed });
  handlers.current = { onCellsUpdated, onReportCreated, onEventOpened, onEventClosed };

  // Throttle per handler: keeps the last-scheduled fire so a burst still
  // triggers exactly one refetch at most MIN_UPDATE_INTERVAL_MS apart.
  const lastFireAt = useRef({ cells: 0, reports: 0 });
  const pending = useRef({ cells: 0, reports: 0, timer: 0 as ReturnType<typeof setTimeout> | 0 });

  const schedule = (kind: "cells" | "reports") => {
    const now = Date.now();
    const last = lastFireAt.current[kind];
    if (now - last >= MIN_UPDATE_INTERVAL_MS) {
      lastFireAt.current[kind] = now;
      if (kind === "cells") handlers.current.onCellsUpdated();
      else handlers.current.onReportCreated();
      return;
    }
    // Collapse the burst into one trailing call at the interval boundary.
    pending.current[kind] = 1;
    if (!pending.current.timer) {
      pending.current.timer = setTimeout(() => {
        pending.current.timer = 0;
        if (pending.current[kind]) {
          pending.current[kind] = 0;
          lastFireAt.current[kind] = Date.now();
          if (kind === "cells") handlers.current.onCellsUpdated();
          else handlers.current.onReportCreated();
        }
      }, MIN_UPDATE_INTERVAL_MS - (now - last));
    }
  };

  useEffect(() => {
    let ws: WebSocket | null = null;
    let delay = BASE_DELAY_MS;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        delay = BASE_DELAY_MS; // reset after any successful connection
        setConnected(true);
        // Full REST reconciliation on first connect and after each drop.
        schedule("cells");
        schedule("reports");
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as {
            type?: string;
            event_id?: string;
            mag?: number | null;
            place?: string | null;
            flynn_region?: string | null;
          };
          if (msg.type === "CELLS_UPDATED") {
            schedule("cells");
          } else if (msg.type === "REPORT_CREATED") {
            schedule("reports");
          } else if (msg.type === "EVENT_OPENED" && msg.event_id) {
            handlers.current.onEventOpened?.({
              event_id: msg.event_id,
              mag: msg.mag ?? null,
              place: msg.place ?? msg.flynn_region ?? null,
            });
          } else if (msg.type === "EVENT_CLOSED") {
            handlers.current.onEventClosed?.();
          }
        } catch {
          // Malformed frame: ignore, keep last known state.
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (!disposed) {
          const jitter = delay * (0.8 + Math.random() * 0.4); // ±20 %
          timer = setTimeout(connect, jitter);
          delay = Math.min(delay * 2, MAX_DELAY_MS);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (pending.current.timer) clearTimeout(pending.current.timer);
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return connected;
}
