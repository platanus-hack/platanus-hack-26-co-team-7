/**
 * TypeScript mirror of the Kotlin contract. SHARED — both developers sign this file.
 *
 * This is the honest cost of the hybrid split: the contract exists twice, in two
 * languages, and no compiler checks that the halves agree. Three things keep that cheap:
 *
 *  1. The bridge speaks the SAME JSON as the radio, so this mirrors the wire format in
 *     openspec/protocol.md rather than some intermediate bridge shape.
 *  2. The surface is deliberately tiny — one telegram type and eight event variants.
 *  3. `parseTelegram` validates at runtime, so a drift between the two declarations fails
 *     loudly at the boundary instead of surfacing as an undefined three screens later.
 *
 * Source of truth on the Kotlin side:
 *   modules/ziro-relay/android/src/main/java/com/ziro/relay/domain/Telegram.kt
 *
 * If you change one side, change the other in the SAME commit. That rule is the whole
 * reason `contract-drift` errors exist below.
 */

export type EventType = 'EARTHQUAKE' | 'FIRE' | 'FLOOD' | 'MEDICAL' | 'OTHER';

export type PersonStatus = 'EMERGENCY' | 'NEED_HELP' | 'SAFE';

export type Disability = 'NONE' | 'MOBILITY' | 'VISUAL' | 'HEARING' | 'COGNITIVE';

export type EngineStatus = 'IDLE' | 'ADVERTISING' | 'SYNCING' | 'RELAY' | 'ORPHAN';

export type RejectReason =
  | 'MALFORMED'
  | 'UNSUPPORTED_VERSION'
  | 'BAD_SIGNATURE'
  | 'DUPLICATE'
  | 'EXPIRED'
  | 'INVALID_FIELDS';

export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * What a rescuer needs OFFLINE to decide how to act in the next ten minutes.
 *
 * Notice what is absent: document number, insurer, family phone numbers. Those never
 * leave the origin device — the backend already holds them from onboarding, keyed by
 * user_id. Do not add them here. See openspec/protocol.md.
 */
export interface VitalBlock {
  name?: string | null;
  age?: number | null;
  /** Blood group and Rh combined, e.g. "O+". */
  blood?: string | null;
  allergies: string[];
  conditions: string[];
  medications: string[];
  disability: Disability;
  pregnant: boolean;
}

export interface VerifyBlock {
  question_id: string;
  /** SHA-256 of the expected answer. The plaintext answer never travels. */
  answer_hash: string;
}

export interface Telegram {
  v: number;
  /** UUID v4. The universal deduplication key. */
  id: string;
  user_id: string;
  event_id: string;
  event: EventType;
  status: PersonStatus;
  /** 1-5. Drives rescuer triage ordering. */
  severity: number;
  location: GeoPoint;
  /** Epoch seconds, set by the ORIGIN — not when this node received it. */
  timestamp: number;
  /** Hops already travelled. The receiver increments, so an origin telegram is 0. */
  hop: number;
  ttl: number;
  origin: string;
  vital: VitalBlock | null;
  verify: VerifyBlock | null;
  hmac: string | null;
}

export type RelayEvent =
  | { type: 'PEER_DISCOVERED'; peerId: string }
  | { type: 'PEER_CONNECTED'; peerId: string }
  | { type: 'PEER_DISCONNECTED'; peerId: string }
  | { type: 'TELEGRAM_RECEIVED'; peerId: string; telegram: string }
  | { type: 'TELEGRAM_SENT'; peerId: string; telegramId: string }
  | { type: 'TELEGRAM_DELIVERED'; peerId: string; telegramId: string }
  | { type: 'TELEGRAM_REJECTED'; peerId: string; reason: RejectReason }
  | { type: 'STATUS_CHANGED'; status: EngineStatus }
  | { type: 'RADIO_ERROR'; message: string };

export type RelayPermissions = Record<string, boolean>;

export const EVENT_TYPES = {
  EARTHQUAKE: 'EARTHQUAKE',
  FIRE: 'FIRE',
  FLOOD: 'FLOOD',
  MEDICAL: 'MEDICAL',
  OTHER: 'OTHER',
} as const;

export const PERSON_STATUSES = {
  EMERGENCY: 'EMERGENCY',
  NEED_HELP: 'NEED_HELP',
  SAFE: 'SAFE',
} as const;

export const DISABILITIES = {
  NONE: 'NONE',
  MOBILITY: 'MOBILITY',
  VISUAL: 'VISUAL',
  HEARING: 'HEARING',
  COGNITIVE: 'COGNITIVE',
} as const;

export const DOCUMENT_TYPES = {
  CC: 'CC',
  TI: 'TI',
  CE: 'CE',
  PA: 'PA',
  NIT: 'NIT',
} as const;

export const BLOOD_TYPES = { A: 'A', B: 'B', AB: 'AB', O: 'O' } as const;
export const BLOOD_RH = { POSITIVE: 'POSITIVE', NEGATIVE: 'NEGATIVE' } as const;

export interface EmergencyContactInput {
  name: string;
  phone: string;
  relationship: string;
}

/** Private on-device profile. It is never placed on the relay wire format. */
export interface ProfileInput {
  userId: string;
  fullName: string;
  docType: keyof typeof DOCUMENT_TYPES;
  docNumber: string;
  birthDate: string;
  bloodType: keyof typeof BLOOD_TYPES;
  bloodRh: keyof typeof BLOOD_RH;
  allergies: string[];
  chronicConditions: string[];
  medications: string[];
  disability: keyof typeof DISABILITIES;
  isPregnant: boolean;
  weightKg: number | null;
  eps: string | null;
  emergencyContacts: EmergencyContactInput[];
  questionId: string;
  /** Save-only plaintext. Native Kotlin hashes it and never returns or persists it. */
  identityAnswer?: string;
}

/** Local ledger metadata, never part of the Telegram wire contract. */
export interface LedgerEntry {
  telegram: Telegram;
  receivedFrom: string | null;
  deliveredTo: string[];
}

export interface TelegramDraft {
  eventId: string;
  event: EventType;
  status: PersonStatus;
  location: GeoPoint;
  severity: number;
}

/** Thrown when the two halves of the contract have drifted apart. */
export class ContractDriftError extends Error {
  constructor(field: string, received: unknown) {
    super(
      `contract-drift: telegram field "${field}" is missing or wrong. ` +
        `Received: ${JSON.stringify(received)}. ` +
        `Kotlin domain/Telegram.kt and ZiroRelay.types.ts are out of sync — ` +
        `fix both in the same commit.`,
    );
    this.name = 'ContractDriftError';
  }
}

/**
 * Parses a wire telegram and fails loudly on drift.
 *
 * Only the fields the protocol declares mandatory are checked. Optional blocks are passed
 * through: a missing `vital` is a valid telegram from a device with no profile loaded, not
 * an error.
 */
export function parseTelegram(wireJson: string): Telegram {
  const raw: unknown = JSON.parse(wireJson);

  if (typeof raw !== 'object' || raw === null) {
    throw new ContractDriftError('<root>', raw);
  }
  const t = raw as Record<string, unknown>;

  requireNumber(t, 'v');
  requireString(t, 'id');
  requireString(t, 'user_id');
  requireString(t, 'event_id');
  requireString(t, 'event');
  requireString(t, 'status');
  requireNumber(t, 'severity');
  requireNumber(t, 'timestamp');
  requireNumber(t, 'hop');
  requireNumber(t, 'ttl');
  requireString(t, 'origin');
  if (t.hmac !== null && typeof t.hmac !== 'string') throw new ContractDriftError('hmac', t.hmac);
  if (t.vital !== null && typeof t.vital !== 'object') throw new ContractDriftError('vital', t.vital);
  if (t.verify !== null && typeof t.verify !== 'object') throw new ContractDriftError('verify', t.verify);

  const location = t.location;
  if (
    typeof location !== 'object' ||
    location === null ||
    typeof (location as GeoPoint).lat !== 'number' ||
    typeof (location as GeoPoint).lng !== 'number'
  ) {
    throw new ContractDriftError('location', location);
  }

  return raw as Telegram;
}

export function parseLedgerEntries(wireJson: string): LedgerEntry[] {
  const raw: unknown = JSON.parse(wireJson);
  if (!Array.isArray(raw)) throw new ContractDriftError('ledger', raw);
  return raw.map((item) => {
    if (typeof item !== 'object' || item === null) throw new ContractDriftError('ledger entry', item);
    const entry = item as Record<string, unknown>;
    const telegram = parseTelegram(JSON.stringify(entry.telegram));
    if (entry.receivedFrom !== null && entry.receivedFrom !== undefined && typeof entry.receivedFrom !== 'string') {
      throw new ContractDriftError('receivedFrom', entry.receivedFrom);
    }
    if (!Array.isArray(entry.deliveredTo) || !entry.deliveredTo.every((peer) => typeof peer === 'string')) {
      throw new ContractDriftError('deliveredTo', entry.deliveredTo);
    }
    return { telegram, receivedFrom: (entry.receivedFrom as string | null | undefined) ?? null, deliveredTo: entry.deliveredTo as string[] };
  });
}

function requireString(t: Record<string, unknown>, field: string): void {
  if (typeof t[field] !== 'string') throw new ContractDriftError(field, t[field]);
}

function requireNumber(t: Record<string, unknown>, field: string): void {
  if (typeof t[field] !== 'number') throw new ContractDriftError(field, t[field]);
}

/**
 * Result of a runtime permission request for Nearby Connections + the foreground service.
 *
 * Mirrors the JSON produced by ZiroRelayModule.requestPermissions(). Both lists contain
 * fully-qualified Android permission strings, e.g. "android.permission.BLUETOOTH_SCAN".
 */
export interface PermissionResult {
  granted: string[];
  denied: string[];
}

/**
 * Parses the permission request payload and fails loudly on drift. The Kotlin bridge uses
 * the same `Json` instance for permission results and telegrams, so the shape and ordering
 * are identical to what `parseTelegram` expects at the root level — just two string arrays.
 */
export function parsePermissionResult(wireJson: string): PermissionResult {
  const raw: unknown = JSON.parse(wireJson);

  if (typeof raw !== 'object' || raw === null) {
    throw new ContractDriftError('<root>', raw);
  }
  const r = raw as Record<string, unknown>;

  if (!Array.isArray(r.granted)) {
    throw new ContractDriftError('granted', r.granted);
  }
  if (!Array.isArray(r.denied)) {
    throw new ContractDriftError('denied', r.denied);
  }

  return {
    granted: r.granted.filter((x): x is string => typeof x === 'string'),
    denied: r.denied.filter((x): x is string => typeof x === 'string'),
  };
}
