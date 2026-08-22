import { requireNativeModule } from 'expo-modules-core';
import type { EventSubscription } from 'expo-modules-core';

import {
  parsePermissionResult,
  parseTelegram,
  type EngineStatus,
  type PermissionResult,
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
  /**
   * Request all runtime permissions Nearby Connections + the foreground service need.
   * Returns the wire JSON: {"granted":[...], "denied":[...]}. `start()` calls this
   * internally — you only need to call it explicitly if you want to preflight the
   * permissions before showing the start button (e.g. to render a "we need these" hint).
   */
  requestPermissions(): Promise<string>;
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

/**
 * Requests the runtime permissions Nearby Connections needs to discover and advertise.
 *
 * `start()` already invokes this internally and rejects if anything is denied, so most UI
 * flows never need to call this directly. The explicit form is here for the rare case
 * where the app wants to check or preflight permissions before the user can press start
 * — e.g. to disable the start button and show a rationale screen.
 */
export async function requestPermissions(): Promise<PermissionResult> {
  const wire = await native.requestPermissions();
  return parsePermissionResult(wire);
}

export function addRelayListener(
  listener: (event: RelayEvent) => void,
): EventSubscription {
  return native.addListener('onRelayEvent', listener);
}
