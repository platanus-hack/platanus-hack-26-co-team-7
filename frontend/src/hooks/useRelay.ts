import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EngineStatus, Telegram } from 'ziro-relay';

import { createRelayClient } from '../native/relayClient';

/**
 * The only place the UI talks to the engine. Owner: developer B.
 *
 * Note the reconciliation on every event rather than appending in JS. The engine keeps
 * running while the JS thread is asleep, so events emitted during that window are gone
 * forever — but the Kotlin ledger is not. Treating the ledger as the source of truth and
 * events only as a "something changed" signal makes a missed event harmless.
 *
 * Do not build a parallel list in React state. That is how the two views drift.
 */
export function useRelay() {
  const client = useMemo(() => createRelayClient(), []);
  const [status, setStatus] = useState<EngineStatus>('IDLE');
  const [telegrams, setTelegrams] = useState<Telegram[]>([]);
  const [peers, setPeers] = useState<string[]>([]);
  const [lastReject, setLastReject] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const ledger = await client.getLedger();
    if (mounted.current) setTelegrams(ledger);
  }, [client]);

  useEffect(() => {
    mounted.current = true;
    setStatus(client.getStatus());
    void refresh();

    const subscription = client.addRelayListener((event) => {
      switch (event.type) {
        case 'STATUS_CHANGED':
          setStatus(event.status);
          break;
        case 'PEER_CONNECTED':
          setPeers((current) => [...new Set([...current, event.peerId])]);
          break;
        case 'PEER_DISCONNECTED':
          setPeers((current) => current.filter((p) => p !== event.peerId));
          break;
        case 'TELEGRAM_RECEIVED':
        case 'TELEGRAM_SENT':
          void refresh();
          break;
        case 'TELEGRAM_REJECTED':
          // Surfaced on purpose. A silent DUPLICATE looks identical to a broken radio.
          setLastReject(event.reason);
          break;
        case 'PEER_DISCOVERED':
        case 'RADIO_ERROR':
          break;
      }
    });

    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, [client, refresh]);

  return {
    status,
    telegrams,
    peerCount: peers.length,
    lastReject,
    start: client.start,
    stop: client.stop,
    sendTest: useCallback(
      () => client.sendTelegram('EARTHQUAKE001', { lat: 4.6097, lng: -74.0817 }),
      [client],
    ),
  };
}
