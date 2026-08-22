import type { EngineStatus, LedgerEntry, ProfileInput, RelayEvent, Telegram, TelegramDraft } from 'ziro-relay';

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

/** Mirrors AnnouncePresence in Kotlin: meeting a peer is itself the distress signal. */
const PRESENCE_DRAFT: TelegramDraft = {
  eventId: 'ZIRO-LIVE', event: 'EARTHQUAKE', status: 'EMERGENCY', location: BOGOTA, severity: 3,
};

const DEFAULT_PROFILE: ProfileInput = {
  userId: 'USER123', fullName: 'Juan Perez', docType: 'CC', docNumber: '1020304050',
  birthDate: '1991-03-14', bloodType: 'O', bloodRh: 'POSITIVE', allergies: ['penicilina'],
  chronicConditions: ['diabetes'], medications: ['warfarina'], disability: 'NONE', isPregnant: false,
  weightKg: 78, eps: 'Sanitas', emergencyContacts: [{ name: 'Ana Perez', phone: '+57...', relationship: 'madre' }],
  questionId: 'PET_NAME_42',
};

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
    verify: { question_id: 'PET_NAME_42', answer_hash: 'a'.repeat(64) },
    hmac: null,
    ...overrides,
  };
}

export function createFakeRelayClient(): RelayClient {
  let status: EngineStatus = 'IDLE';
  let profile = DEFAULT_PROFILE;
  const ledger = new Map<string, LedgerEntry>();
  const connectedPeers = new Set<string>();
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
    ledger.set(stored.id, { telegram: stored, receivedFrom: peerId, deliveredTo: [peerId] });
    emit({ type: 'TELEGRAM_RECEIVED', peerId, telegram: JSON.stringify(stored) });
  };

  /** Signs nothing and stores at hop 0, exactly like SendTelegram on the origin device. */
  const originate = (draft: TelegramDraft): Telegram => {
    const telegram = sampleTelegram({
      user_id: profile.userId,
      event_id: draft.eventId.trim(), event: draft.event, status: draft.status,
      location: draft.location, severity: draft.severity,
      vital: {
        name: profile.fullName, age: 35, blood: `${profile.bloodType}${profile.bloodRh === 'POSITIVE' ? '+' : '-'}`,
        allergies: profile.allergies, conditions: profile.chronicConditions, medications: profile.medications,
        disability: profile.disability, pregnant: profile.isPregnant,
      },
    });
    // The origin stores its own telegram at hop 0 - store-and-forward starts here.
    ledger.set(telegram.id, { telegram, receivedFrom: null, deliveredTo: [] });
    return telegram;
  };

  return {
    getStatus: () => status,

    async start() {
      setStatus('ADVERTISING');
      timers.push(
        setTimeout(() => emit({ type: 'PEER_DISCOVERED', peerId: 'fake-peer-01' }), 800),
        setTimeout(() => {
          connectedPeers.add('fake-peer-01');
          emit({ type: 'PEER_CONNECTED', peerId: 'fake-peer-01' });
          setStatus('SYNCING');
          // Meeting a peer is the trigger, same rule as RelayEngine. The heartbeat that
          // follows is not simulated here - see PresenceSchedule for the real ladder.
          const presence = originate(PRESENCE_DRAFT);
          emit({ type: 'TELEGRAM_SENT', peerId: 'fake-peer-01', telegramId: presence.id });
          emit({ type: 'TELEGRAM_DELIVERED', peerId: 'fake-peer-01', telegramId: presence.id });
        }, 1600),
        // A peer relaying something to us, which is the case the UI actually has to render.
        setTimeout(() => ingest(sampleTelegram({ user_id: 'USER456', severity: 4 }), 'fake-peer-01'), 2600),
      );
    },

    async stop() {
      timers.forEach(clearTimeout);
      timers.length = 0;
      connectedPeers.clear();
      setStatus('IDLE');
    },

    getPermissions: () => ({ fake: true }),
    getConnectedPeers: () => [...connectedPeers],
    async requestPermissions() {
      // Fake: pretend the relevant permissions are already granted so the UI keeps working.
      return { granted: ['FAKE'], denied: [] };
    },

    async getProfile() {
      return profile;
    },

    async saveProfile(nextProfile) {
      const { identityAnswer: _identityAnswer, ...storedProfile } = nextProfile;
      profile = storedProfile;
    },

    async sendTelegram(draft: TelegramDraft) {
      if (!draft.eventId.trim()) throw new Error('An event identifier is required.');
      if (draft.severity < 1 || draft.severity > 5) throw new Error('Severity must be between 1 and 5.');
      const telegram = originate(draft);
      emit({ type: 'TELEGRAM_SENT', peerId: 'fake-peer-01', telegramId: telegram.id });
      return telegram;
    },

    async getLedger() {
      return [...ledger.values()].sort((a, b) => b.telegram.timestamp - a.telegram.timestamp);
    },

    addRelayListener(listener) {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
}
