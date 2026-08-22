import { NativeModulesProxy } from 'expo-modules-core';
import { Platform } from 'react-native';
import type {
  EngineStatus,
  PermissionResult,
  ProfileInput,
  RelayEvent,
  RelayPermissions,
  Telegram,
  TelegramDraft,
} from 'ziro-relay';

/**
 * PORT, on the JavaScript side. Owner: developer B.
 *
 * The same move as PeerTransport in Kotlin, applied one layer up. The screens depend on
 * this interface, never on the native module directly, and that buys B something concrete:
 *
 *   with the fake  -> runs in EXPO GO. Hot reload, no dev build, no Android SDK, no phone
 *                     pairing, no code from developer A. B can build every screen on day
 *                     one and iterate in seconds.
 *   with native    -> the real engine, in a dev client build.
 *
 * It is also the fastest diagnostic in the project:
 *   works on fake + fails on native  -> the engine is the problem (A)
 *   fails on fake                    -> the UI is the problem (B)
 */
export interface RelayClient {
  getStatus(): EngineStatus;
  start(): Promise<void>;
  stop(): Promise<void>;
  getPermissions(): RelayPermissions;
  /**
   * Returns the structured result of requesting the runtime permissions Nearby Connections
   * + the foreground service need. start() calls this internally and rejects if any are
   * denied; only call this directly to preflight before showing the start button.
   */
  requestPermissions(): Promise<PermissionResult>;
  getProfile(): Promise<ProfileInput>;
  saveProfile(profile: ProfileInput): Promise<void>;
  sendTelegram(draft: TelegramDraft): Promise<Telegram>;
  getLedger(): Promise<Telegram[]>;
  addRelayListener(listener: (event: RelayEvent) => void): { remove(): void };
}

/**
 * Flip to false once a dev client build is installed and the engine is wired.
 *
 * Keep it as a module constant rather than an env var: a single obvious line beats hunting
 * for why the app is showing invented data at 4am.
 */
export const USE_FAKE_ENGINE = Platform.OS !== 'android' || NativeModulesProxy.ZiroRelay === undefined;

export function createRelayClient(): RelayClient {
  if (USE_FAKE_ENGINE) {
    // Required lazily so Expo Go never tries to resolve the native module.
    const { createFakeRelayClient } = require('./fakeRelayClient') as typeof import('./fakeRelayClient');
    return createFakeRelayClient();
  }
  const native = require('ziro-relay') as typeof import('ziro-relay');
  return {
    getStatus: native.getStatus,
    start: native.start,
    stop: native.stop,
    getPermissions: native.getPermissions,
    requestPermissions: native.requestPermissions,
    getProfile: native.getProfile,
    saveProfile: native.saveProfile,
    sendTelegram: native.sendTelegram,
    getLedger: native.getLedger,
    addRelayListener: native.addRelayListener,
  };
}
