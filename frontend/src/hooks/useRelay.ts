import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type {
  EngineStatus,
  PermissionResult,
  ProfileInput,
  RelayPermissions,
  Telegram,
  TelegramDraft,
} from 'ziro-relay';

import { createRelayClient } from '../native/relayClient';

/** Convert the sync grant-state map (getPermissions) into the structured result shape
 *  (requestPermissions) so the hook can store a single `permissions` value across both. */
function toPermissionResult(perms: RelayPermissions): PermissionResult {
  const granted: string[] = [];
  const denied: string[] = [];
  for (const [key, value] of Object.entries(perms)) {
    (value ? granted : denied).push(key);
  }
  return { granted, denied };
}

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
  const [radioError, setRadioError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<PermissionResult>({ granted: [], denied: [] });
  const [deliveries, setDeliveries] = useState<Record<string, string>>({});
  const [profile, setProfile] = useState<ProfileInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const ledger = await client.getLedger();
    if (mounted.current) setTelegrams(ledger);
  }, [client]);

  useEffect(() => {
    mounted.current = true;
    setStatus(client.getStatus());
    setPermissions(toPermissionResult(client.getPermissions()));
    void refresh();
    void client.getProfile().then(setProfile).catch((reason: unknown) => setError(messageFor(reason)));

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
          void refresh();
          break;
        case 'TELEGRAM_SENT':
          setDeliveries((current) => ({ ...current, [event.telegramId]: 'Sending' }));
          void refresh();
          break;
        case 'TELEGRAM_DELIVERED':
          setDeliveries((current) => ({ ...current, [event.telegramId]: `Delivered to ${event.peerId}` }));
          void refresh();
          break;
        case 'TELEGRAM_REJECTED':
          // Surfaced on purpose. A silent DUPLICATE looks identical to a broken radio.
          setLastReject(event.reason);
          break;
        case 'RADIO_ERROR':
          setRadioError(event.message);
          break;
        case 'PEER_DISCOVERED':
          break;
      }
    });
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') setPermissions(toPermissionResult(client.getPermissions()));
    });

    return () => {
      mounted.current = false;
      subscription.remove();
      appStateSubscription.remove();
    };
  }, [client, refresh]);

  return {
    status,
    telegrams,
    peerCount: peers.length,
    lastReject,
    radioError,
    permissions,
    deliveries,
    profile,
    error,
    start: client.start,
    stop: client.stop,
    requestPermissions: useCallback(async () => {
      const result = await client.requestPermissions();
      setPermissions(result);
      return result;
    }, [client]),
    saveProfile: useCallback(async (nextProfile: ProfileInput) => {
      try {
        await client.saveProfile(nextProfile);
        setProfile(nextProfile);
        setError(null);
      } catch (reason: unknown) {
        const message = messageFor(reason);
        setError(message);
        throw new Error(message);
      }
    }, [client]),
    sendTelegram: useCallback(async (draft: TelegramDraft) => {
      try {
        const telegram = await client.sendTelegram(draft);
        setError(null);
        setDeliveries((current) => ({ ...current, [telegram.id]: 'Pending relay acknowledgement' }));
        await refresh();
        return telegram;
      } catch (reason: unknown) {
        const message = messageFor(reason);
        setError(message);
        throw new Error(message);
      }
    }, [client, refresh]),
  };
}

function messageFor(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'The offline relay could not complete that action.';
}
