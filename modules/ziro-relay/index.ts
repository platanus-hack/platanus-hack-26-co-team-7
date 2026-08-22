import { requireNativeModule } from 'expo-modules-core';
import type { EventSubscription } from 'expo-modules-core';

import {
  parseTelegram,
  type EngineStatus,
  type RelayEvent,
  type Telegram,
} from './src/ZiroRelay.types';

export * from './src/ZiroRelay.types';

/**
 * The JS face of the relay engine. SHARED — this signature is the bridge contract.
 *
 * Keep it thin. Everything here is a hand-synced mirror of ZiroRelayModule.kt with no
 * compiler watching, so every method added is a maintenance cost. If something can be
 * derived in JS from a telegram that already crossed, derive it in JS.
 */
interface ZiroRelayNativeModule {
  getStatus(): EngineStatus;
  getOriginHash(): string;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Returns the created telegram as a wire JSON string. */
  sendTelegram(
    eventId: string,
    lat: number,
    lng: number,
    severity: number,
  ): Promise<string>;
  /** The whole local ledger as a JSON array of telegrams. */
  getLedger(): Promise<string>;
  addListener(event: 'onRelayEvent', listener: (payload: RelayEvent) => void): EventSubscription;
}

const native = requireNativeModule<ZiroRelayNativeModule>('ZiroRelay');

export function getStatus(): EngineStatus {
  return native.getStatus();
}

export function getOriginHash(): string {
  return native.getOriginHash();
}

export function start(): Promise<void> {
  return native.start();
}

export function stop(): Promise<void> {
  return native.stop();
}

export async function sendTelegram(
  eventId: string,
  location: { lat: number; lng: number },
  severity = 3,
): Promise<Telegram> {
  const wire = await native.sendTelegram(eventId, location.lat, location.lng, severity);
  return parseTelegram(wire);
}

/**
 * Reads the whole ledger from Kotlin.
 *
 * Call this on mount, not just on events. The engine keeps running while the JS thread is
 * asleep, so events emitted during that time are gone — but the ledger is not. This is the
 * reconciliation path, and it is why the ledger lives in Kotlin.
 */
export async function getLedger(): Promise<Telegram[]> {
  const wire = await native.getLedger();
  const raw: unknown = JSON.parse(wire);
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => parseTelegram(JSON.stringify(item)));
}

export function addRelayListener(
  listener: (event: RelayEvent) => void,
): EventSubscription {
  return native.addListener('onRelayEvent', listener);
}
