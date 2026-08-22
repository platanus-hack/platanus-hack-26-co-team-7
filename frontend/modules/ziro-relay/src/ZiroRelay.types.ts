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
  vital?: VitalBlock | null;
  verify?: VerifyBlock | null;
  hmac?: string | null;
}

export type RelayEvent =
  | { type: 'PEER_DISCOVERED'; peerId: string }
  | { type: 'PEER_CONNECTED'; peerId: string }
  | { type: 'PEER_DISCONNECTED'; peerId: string }
  | { type: 'TELEGRAM_RECEIVED'; peerId: string; telegram: string }
  | { type: 'TELEGRAM_SENT'; peerId: string; telegramId: string }
  | { type: 'TELEGRAM_REJECTED'; peerId: string; reason: RejectReason }
  | { type: 'STATUS_CHANGED'; status: EngineStatus }
  | { type: 'RADIO_ERROR'; message: string };

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

function requireString(t: Record<string, unknown>, field: string): void {
  if (typeof t[field] !== 'string') throw new ContractDriftError(field, t[field]);
}

function requireNumber(t: Record<string, unknown>, field: string): void {
  if (typeof t[field] !== 'number') throw new ContractDriftError(field, t[field]);
}
