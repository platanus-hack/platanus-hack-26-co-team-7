import { requireNativeModule } from 'expo-modules-core';
import type { EventSubscription } from 'expo-modules-core';

import {
  parseTelegram,
  type EngineStatus,
  type RelayEvent,
  type RelayPermissions,
  type ProfileInput,
  type Telegram,
  type TelegramDraft,
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
  getProfile(): Promise<string>;
  saveProfile(profile: string): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getPermissions(): RelayPermissions;
  requestPermissions(): RelayPermissions;
  /** Returns the created telegram as a wire JSON string. */
  sendTelegram(
    draft: string,
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

export async function getProfile(): Promise<ProfileInput> {
  return JSON.parse(await native.getProfile()) as ProfileInput;
}

export function saveProfile(profile: ProfileInput): Promise<void> {
  return native.saveProfile(JSON.stringify(profile));
}

export function start(): Promise<void> {
  return native.start();
}

export function stop(): Promise<void> {
  return native.stop();
}

export function getPermissions(): RelayPermissions {
  return native.getPermissions();
}

export function requestPermissions(): RelayPermissions {
  return native.requestPermissions();
}

export async function sendTelegram(draft: TelegramDraft): Promise<Telegram> {
  const wire = await native.sendTelegram(JSON.stringify(draft));
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
