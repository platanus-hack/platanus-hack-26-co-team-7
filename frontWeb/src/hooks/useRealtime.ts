import { useEffect, useRef, useState } from "react";
import { WS_URL } from "../lib/constants";

/**
 * WebSocket realtime client (design D4):
 * - exponential backoff: 1000 ms ×2 up to 30 000 ms, ±20 % jitter per try;
 * - successful (re)connection resets the delay to 1000 ms;
 * - every open — first connect or after a drop — triggers a full REST
 *   reconciliation via the callbacks;
 * - CELLS_UPDATED / REPORT_CREATED messages trigger the matching refetch.
 *
 * A WS outage never breaks the UI: it keeps showing the last known data.
 */

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

export function useRealtime(
  onCellsUpdated: () => void,
  onReportCreated: () => void,
): boolean {
  const [connected, setConnected] = useState(false);

  // Latest callbacks without re-subscribing the socket on every render.
  const handlers = useRef({ onCellsUpdated, onReportCreated });
  handlers.current = { onCellsUpdated, onReportCreated };

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
        handlers.current.onCellsUpdated();
        handlers.current.onReportCreated();
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as { type?: string };
          if (msg.type === "CELLS_UPDATED") {
            handlers.current.onCellsUpdated();
          } else if (msg.type === "REPORT_CREATED") {
            handlers.current.onReportCreated();
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
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return connected;
}
