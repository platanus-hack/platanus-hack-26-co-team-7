import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type {
  EngineStatus,
  LedgerEntry,
  PermissionResult,
  ProfileInput,
  RelayEvent,
  RelayPermissions,
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

interface PeerConnectionNotice {
  peerId: string;
  sequence: number;
}

/**
 * The only place the UI talks to the engine. Owner: developer B.
 *
 * Note the reconciliation on every event rather than appending in JS. The engine keeps
 * running while the JS thread is asleep, so events emitted during that window are gone
 * forever — but the Kotlin ledger and connected-peer snapshot are not. Treating durable
 * state as the source of truth and events only as a "something changed" signal makes a
 * missed event harmless.
 *
 * Do not build a parallel list in React state. That is how the two views drift.
 */
export function useRelay() {
  const client = useMemo(() => createRelayClient(), []);
  const [status, setStatus] = useState<EngineStatus>('IDLE');
  const [telegrams, setTelegrams] = useState<LedgerEntry[]>([]);
  const [peers, setPeers] = useState<string[]>([]);
  const [discoveredPeers, setDiscoveredPeers] = useState<string[]>([]);
  const [lastReject, setLastReject] = useState<string | null>(null);
  const [radioError, setRadioError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<PermissionResult>({ granted: [], denied: [] });
  const [deliveries, setDeliveries] = useState<Record<string, string>>({});
  const [relayEvents, setRelayEvents] = useState<RelayEvent[]>([]);
  const [profile, setProfile] = useState<ProfileInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastPeerConnection, setLastPeerConnection] = useState<PeerConnectionNotice | null>(null);
  const mounted = useRef(true);
  const peerConnectionSequence = useRef(0);

  const refresh = useCallback(async () => {
    const ledger = await client.getLedger();
    if (mounted.current) setTelegrams(ledger);
  }, [client]);

  const syncRuntimeState = useCallback(() => {
    const nextStatus = client.getStatus();
    const nextPermissions = toPermissionResult(client.getPermissions());
    const nextPeers = client.getConnectedPeers();
    if (!mounted.current) return;

    setStatus(nextStatus);
    setPermissions(nextPermissions);
    setPeers(nextPeers);

    const firstConnectedPeer = nextPeers[0];
    if (firstConnectedPeer) {
      setLastPeerConnection((current) => {
        if (current && nextPeers.includes(current.peerId)) return current;
        peerConnectionSequence.current += 1;
        return { peerId: firstConnectedPeer, sequence: peerConnectionSequence.current };
      });
    }
  }, [client]);

  useEffect(() => {
    mounted.current = true;

    const subscription = client.addRelayListener((event) => {
      setRelayEvents((current) => [event, ...current].slice(0, 20));
      switch (event.type) {
        case 'STATUS_CHANGED':
          setStatus(event.status);
          // Starting the relay announces this device, and that write produces no
          // TELEGRAM_SENT until a peer exists. Without this the sender's own outbound
          // telegram is missing from the inbox until something else happens to refresh.
          void refresh();
          break;
        case 'PEER_CONNECTED': {
          peerConnectionSequence.current += 1;
          setLastPeerConnection({ peerId: event.peerId, sequence: peerConnectionSequence.current });
          setPeers((current) => [...new Set([...current, event.peerId])]);
          void refresh();
          break;
        }
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
          setDiscoveredPeers((current) => [...new Set([...current, event.peerId])]);
          break;
      }
    });

    syncRuntimeState();
    void refresh();
    void client.getProfile().then(setProfile).catch((reason: unknown) => setError(messageFor(reason)));
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        syncRuntimeState();
        void refresh();
      }
    });

    return () => {
      mounted.current = false;
      subscription.remove();
      appStateSubscription.remove();
    };
  }, [client, refresh, syncRuntimeState]);

  // The ledger holds both directions on purpose - a node must carry its own telegram to
  // relay it. But the two mean very different things to a person, so the UI never mixes
  // them: `inbox` is other people asking for help, `outbox` is this device's own card.
  const inbox = useMemo(() => telegrams.filter(({ receivedFrom }) => receivedFrom !== null), [telegrams]);
  const outbox = useMemo(() => telegrams.filter(({ receivedFrom }) => receivedFrom === null), [telegrams]);

  return {
    status,
    telegrams,
    inbox,
    outbox,
    peerCount: peers.length,
    peers,
    discoveredPeers,
    lastReject,
    radioError,
    permissions,
    deliveries,
    relayEvents,
    profile,
    error,
    lastPeerConnection,
    start: useCallback(async () => {
      try {
        await client.start();
        setError(null);
      } catch (reason: unknown) {
        const message = messageFor(reason);
        setError(message);
        throw new Error(message);
      }
    }, [client]),
    stop: client.stop,
    requestPermissions: useCallback(async () => {
      try {
        const result = await client.requestPermissions();
        setPermissions(result);
        setError(null);
        return result;
      } catch (reason: unknown) {
        const message = messageFor(reason);
        setError(message);
        throw new Error(message);
      }
    }, [client]),
    saveProfile: useCallback(async (nextProfile: ProfileInput) => {
      try {
        await client.saveProfile(nextProfile);
        const { identityAnswer: _identityAnswer, ...persistedProfile } = nextProfile;
        setProfile(persistedProfile);
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
    sendSafeResponse: useCallback(async (telegramId: string, answer: string) => {
      try {
        const telegram = await client.sendSafeResponse(telegramId, answer);
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
