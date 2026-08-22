import type { EngineStatus, RelayEvent, Telegram } from 'ziro-relay';

import type { RelayClient } from './relayClient';

/**
 * In-process fake engine. Owner: developer B.
 *
 * Mirrors the Kotlin pipeline closely enough to be useful: it deduplicates by id,
 * increments hop on ingest, and keeps a ledger. It is NOT a second implementation of the
 * protocol — it is a stand-in so the UI can be built and demoed without a dev build.
 *
 * Anything about the protocol that matters is verified in Kotlin by TelegramContractTest.
 * Do not grow this file into a JS reimplementation of the engine.
 */

const BOGOTA = { lat: 4.6097, lng: -74.0817 };

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function sampleTelegram(overrides: Partial<Telegram> = {}): Telegram {
  return {
    v: 1,
    id: uuid(),
    user_id: 'USER123',
    event_id: 'EARTHQUAKE001',
    event: 'EARTHQUAKE',
    status: 'EMERGENCY',
    severity: 3,
    location: BOGOTA,
    timestamp: Math.floor(Date.now() / 1000),
    hop: 0,
    ttl: 8,
    origin: 'fake0001',
    vital: {
      name: 'Juan Perez',
      age: 35,
      blood: 'O+',
      allergies: ['penicilina'],
      conditions: ['diabetes'],
      medications: ['warfarina'],
      disability: 'NONE',
      pregnant: false,
    },
    verify: { question_id: 'PET_NAME_42', answer_hash: 'abc123' },
    hmac: null,
    ...overrides,
  };
}

export function createFakeRelayClient(): RelayClient {
  let status: EngineStatus = 'IDLE';
  const ledger = new Map<string, Telegram>();
  const listeners = new Set<(event: RelayEvent) => void>();
  const timers: ReturnType<typeof setTimeout>[] = [];

  const emit = (event: RelayEvent) => listeners.forEach((l) => l(event));

  const setStatus = (next: EngineStatus) => {
    if (status === next) return;
    status = next;
    emit({ type: 'STATUS_CHANGED', status: next });
  };

  /** Mirrors RelayPolicy.onIngest: mutate once, on ingest, then dedup. */
  const ingest = (telegram: Telegram, peerId: string) => {
    if (ledger.has(telegram.id)) {
      emit({ type: 'TELEGRAM_REJECTED', peerId, reason: 'DUPLICATE' });
      return;
    }
    if (telegram.ttl <= 0) {
      emit({ type: 'TELEGRAM_REJECTED', peerId, reason: 'EXPIRED' });
      return;
    }
    const stored: Telegram = { ...telegram, hop: telegram.hop + 1, ttl: telegram.ttl - 1 };
    ledger.set(stored.id, stored);
    emit({ type: 'TELEGRAM_RECEIVED', peerId, telegram: JSON.stringify(stored) });
  };

  return {
    getStatus: () => status,

    async start() {
      setStatus('ADVERTISING');
      timers.push(
        setTimeout(() => emit({ type: 'PEER_DISCOVERED', peerId: 'fake-peer-01' }), 800),
        setTimeout(() => {
          emit({ type: 'PEER_CONNECTED', peerId: 'fake-peer-01' });
          setStatus('SYNCING');
        }, 1600),
        // A peer relaying something to us, which is the case the UI actually has to render.
        setTimeout(() => ingest(sampleTelegram({ user_id: 'USER456', severity: 4 }), 'fake-peer-01'), 2600),
      );
    },

    async stop() {
      timers.forEach(clearTimeout);
      timers.length = 0;
      setStatus('IDLE');
    },

    async sendTelegram(eventId, location, severity = 3) {
      const telegram = sampleTelegram({ event_id: eventId, location, severity });
      // The origin stores its own telegram at hop 0 — store-and-forward starts here.
      ledger.set(telegram.id, telegram);
      emit({ type: 'TELEGRAM_SENT', peerId: 'fake-peer-01', telegramId: telegram.id });
      return telegram;
    },

    async getLedger() {
      return [...ledger.values()].sort((a, b) => b.timestamp - a.timestamp);
    },

    addRelayListener(listener) {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
}
