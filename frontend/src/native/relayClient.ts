import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import type {
  EngineStatus,
  LedgerEntry,
  PermissionResult,
  ProfileInput,
  RelayEvent,
  RelayPermissions,
  Telegram,
  TelegramDraft,
  SecureSession,
  GatewaySyncSnapshot,
  ActiveEmergencyEvent,
  DeviceIdentity,
} from 'ziro-relay';

export interface RelayClient {
  getStatus(): EngineStatus;
  getConnectedPeers(): string[];
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
  sendSafeResponse(telegramId: string, answer: string): Promise<Telegram>;
  getLedger(): Promise<LedgerEntry[]>;
  loadSession(): Promise<SecureSession | null>;
  saveSession(session: SecureSession): Promise<void>;
  clearSession(): Promise<void>;
  getApiBaseUrl(): string | null;
  saveApiBaseUrl(value: string): void;
  hashIdentityAnswer(value: string): string;
  getGatewaySyncSnapshot(): Promise<GatewaySyncSnapshot>;
  getDeviceIdentity(): DeviceIdentity;
  scheduleGatewaySync(): Promise<void>;
  activateEmergency(event: ActiveEmergencyEvent): Promise<void>;
  setEmergencyUserStatus(status: string): Promise<void>;
  getCurrentLocation(): { lat: number; lng: number } | null;
  getRadioState(): { bluetoothEnabled: boolean; wifiEnabled: boolean };
  openBluetoothSettings(): void;
  openWifiSettings(): void;
  addRelayListener(listener: (event: RelayEvent) => void): { remove(): void };
}

const nativeRelay = Platform.OS === 'android' ? requireOptionalNativeModule<unknown>('ZiroRelay') : null;

export function getNativeRelayConfigurationError(): string | null {
  if (Platform.OS !== 'android') {
    return 'Replica Relay is available only in an Android development or release build.';
  }

  if (nativeRelay == null) {
    return 'Replica Relay native module is unavailable. Expo Go cannot run this app; install an Android development or release build that includes ZiroRelay.';
  }

  return null;
}

export function createRelayClient(): RelayClient {
  const configurationError = getNativeRelayConfigurationError();
  if (configurationError) {
    throw new Error(configurationError);
  }

  const native = require('ziro-relay') as typeof import('ziro-relay');
  return {
    getStatus: native.getStatus,
    getConnectedPeers: native.getConnectedPeers,
    start: native.start,
    stop: native.stop,
    getPermissions: native.getPermissions,
    requestPermissions: native.requestPermissions,
    getProfile: native.getProfile,
    saveProfile: native.saveProfile,
    sendTelegram: native.sendTelegram,
    sendSafeResponse: native.sendSafeResponse,
    getLedger: native.getLedger,
    loadSession: native.loadSession,
    saveSession: native.saveSession,
    clearSession: native.clearSession,
    getApiBaseUrl: native.getApiBaseUrl,
    saveApiBaseUrl: native.saveApiBaseUrl,
    hashIdentityAnswer: native.hashIdentityAnswer,
    getGatewaySyncSnapshot: native.getGatewaySyncSnapshot,
    getDeviceIdentity: native.getDeviceIdentity,
    scheduleGatewaySync: native.scheduleGatewaySync,
    activateEmergency: native.activateEmergency,
    setEmergencyUserStatus: native.setEmergencyUserStatus,
    getCurrentLocation: native.getCurrentLocation,
    getRadioState: native.getRadioState,
    openBluetoothSettings: native.openBluetoothSettings,
    openWifiSettings: native.openWifiSettings,
    addRelayListener: native.addRelayListener,
  };
}
