import { useEffect, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  BLOOD_RH,
  BLOOD_TYPES,
  DISABILITIES,
  DOCUMENT_TYPES,
  EVENT_TYPES,
  PERSON_STATUSES,
  type ProfileInput,
  type LedgerEntry,
  type PermissionResult,
  type RelayEvent,
  type TelegramDraft,
} from 'ziro-relay';

import { useRelay } from '../hooks/useRelay';
import { createRelayClient } from '../native/relayClient';
import type { PrivateApi } from '../api/privateApi';
import { C, F, SAFE_TOP, shared, statusColor, initials } from '../theme';

const TABS = { RELAY: 'RELAY', CREATE: 'CREATE', INBOX: 'INBOX', PROFILE: 'PROFILE' } as const;
type Tab = (typeof TABS)[keyof typeof TABS];

interface EmergencyAlertProps {
  emergencyStatus: string;
  onSafe: () => void;
  onNeedHelp: () => void;
  onTimeout: () => void;
}

function EmergencyAlertScreen({ emergencyStatus, onSafe, onNeedHelp, onTimeout }: EmergencyAlertProps) {
  const [secondsLeft, setSecondsLeft] = useState(20);

  useEffect(() => {
    if (secondsLeft <= 0) {
      onTimeout();
      return;
    }
    const id = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  const eventIdMatch = emergencyStatus.match(/Event detected: (\S+)/);
  const eventId = eventIdMatch ? eventIdMatch[1] : 'EVT-ACTIVE';

  return (
    <ScrollView
      contentContainerStyle={ea.container}
      showsVerticalScrollIndicator={false}
    >
      {/* Top banner */}
      <Text style={ea.banner}>● EMERGENCY PROTOCOL ACTIVATED ●</Text>

      {/* Alert icon */}
      <View style={ea.iconBox}>
        <Text style={ea.iconText}>⚠</Text>
      </View>

      {/* Event type */}
      <Text style={ea.eventType}>EARTHQUAKE</Text>

      {/* DETECTED label */}
      <Text style={ea.detected}>DETECTED</Text>

      {/* Location */}
      <Text style={ea.location}>Bogotá, Colombia</Text>

      {/* Magnitude */}
      <Text style={ea.magnitude}>Magnitude 6.8</Text>

      {/* Event ID + time */}
      <Text style={ea.eventMeta}>
        {eventId} · {new Date().toLocaleTimeString('en-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
      </Text>

      {/* Divider */}
      <View style={[shared.divider, ea.divider]} />

      {/* Report label */}
      <Text style={ea.reportLabel}>REPORT YOUR STATUS</Text>

      {/* Countdown */}
      <Text style={ea.countdown}>{mm}:{ss}</Text>

      {/* Help text */}
      <Text style={ea.helpText}>
        {'If you don\'t respond,\nReplica will mark your status as ALERT.'}
      </Text>

      {/* I'M SAFE button */}
      <Pressable style={ea.btnSafe} onPress={onSafe}>
        <Text style={ea.btnSafeText}>I'M SAFE</Text>
      </Pressable>

      {/* I NEED HELP button */}
      <Pressable style={ea.btnHelp} onPress={onNeedHelp}>
        <Text style={ea.btnHelpText}>I NEED HELP</Text>
      </Pressable>
    </ScrollView>
  );
}

const DEFAULT_DRAFT: TelegramDraft = {
  eventId: '', event: EVENT_TYPES.EARTHQUAKE, status: PERSON_STATUSES.EMERGENCY,
  location: null, severity: 3,
};

interface HomeScreenProps { onProfileSave: (profile: ProfileInput) => Promise<void>; onLogout: () => Promise<void>; api: PrivateApi | null; showDemoTrigger: boolean; emergencyStatus: string; onTriggerDemo: () => void; }
export function HomeScreen({ onProfileSave, onLogout, api, showDemoTrigger, emergencyStatus, onTriggerDemo }: HomeScreenProps) {
  const relay = useRelay();
  const [emergencyResponded, setEmergencyResponded] = useState(false);
  const [tab, setTab] = useState<Tab>(TABS.RELAY);
  const [telegramDraft, setTelegramDraft] = useState(DEFAULT_DRAFT);
  const [profileDraft, setProfileDraft] = useState<ProfileInput | null>(null);
  const [connectedPeer, setConnectedPeer] = useState<string | null>(null);
  const [permissionModalDismissed, setPermissionModalDismissed] = useState(false);

  useEffect(() => {
    if (relay.profile) setProfileDraft(relay.profile);
  }, [relay.profile]);

  useEffect(() => {
    if (relay.lastPeerConnection) setConnectedPeer(relay.lastPeerConnection.peerId);
  }, [relay.lastPeerConnection]);

  const permissionsGranted = allRequiredPermissionsGranted(relay.permissions);
  const showPermissionSetup = !permissionsGranted && !permissionModalDismissed;

  const submitTelegram = async () => {
    const validation = validateTelegram(telegramDraft);
    if (validation) return Alert.alert('Check the telegram', validation);
    try {
      await relay.sendTelegram(telegramDraft);
      setTelegramDraft(DEFAULT_DRAFT);
      Alert.alert('Telegram sent', 'Your telegram has been queued.');
      setTab(TABS.INBOX);
    } catch (error: unknown) {
      Alert.alert('Could not queue telegram', messageFor(error));
    }
  };

  const saveProfile = async () => {
    if (!profileDraft) return;
    const validation = validateProfile(profileDraft);
    if (validation) return Alert.alert('Check the profile', validation);
    try {
      await onProfileSave(profileDraft);
      Alert.alert('Profile saved', 'Your private profile will be used in your next telegram.');
    } catch (error: unknown) {
      Alert.alert('Could not save profile', messageFor(error));
    }
  };

  const userAvatarLabel = relay.profile?.fullName
    ? initials(relay.profile.fullName)
    : relay.profile?.userId
      ? initials(relay.profile.userId)
      : '??';

  const networkActive = relay.status !== 'IDLE';

  const sendEmergencyTelegram = async (status: 'EMERGENCY' | 'NEED_HELP' | 'SAFE') => {
    const client = createRelayClient();
    try { await client.setEmergencyUserStatus(status); } catch { /* native may not be available */ }
    const eventIdMatch = emergencyStatus.match(/Event detected: (\S+)/);
    const eventId = eventIdMatch?.[1] ?? 'DEMO-EMERGENCY';
    try {
      await relay.sendTelegram({ eventId, event: EVENT_TYPES.EARTHQUAKE, status, location: null, severity: status === PERSON_STATUSES.EMERGENCY ? 5 : status === PERSON_STATUSES.NEED_HELP ? 4 : 1 });
    } catch { /* telegram queuing may fail without full relay */ }
    setEmergencyResponded(true);
  };

  if (!emergencyResponded && emergencyStatus.includes('Relay active')) {
    return (
      <View style={shared.screenBg}>
        <EmergencyAlertScreen
          emergencyStatus={emergencyStatus}
          onSafe={() => void sendEmergencyTelegram(PERSON_STATUSES.SAFE)}
          onNeedHelp={() => void sendEmergencyTelegram(PERSON_STATUSES.NEED_HELP)}
          onTimeout={() => void sendEmergencyTelegram(PERSON_STATUSES.EMERGENCY)}
        />
      </View>
    );
  }

  return (
    <View style={shared.screenBg}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.brand}>REPLICA</Text>
          <View style={s.networkRow}>
            <View style={[s.networkDot, networkActive && s.networkDotActive]} />
            <Text style={[s.networkLabel, networkActive && s.networkLabelActive]}>
              {networkActive ? 'NETWORK ACTIVE' : 'IDLE'}
            </Text>
          </View>
        </View>
        <View style={s.headerRight}>
          <Text style={s.statusLabel}>{relay.status}</Text>
          <View style={shared.avatar}>
            <Text style={shared.avatarText}>{userAvatarLabel}</Text>
          </View>
        </View>
      </View>

      <View style={s.tabs}>
        {Object.values(TABS).map((item) => (
          <TabButton
            key={item}
            label={item}
            active={tab === item}
            onPress={() => setTab(item)}
          />
        ))}
      </View>

      {relay.error ? <Text style={s.error}>{relay.error}</Text> : null}

      {tab === TABS.RELAY ? (
        <RelayPanel
          relay={relay}
          api={api}
          showDemoTrigger={showDemoTrigger}
          emergencyStatus={emergencyStatus}
          onTriggerDemo={onTriggerDemo}
        />
      ) : null}
      {tab === TABS.CREATE ? (
        <TelegramForm
          draft={telegramDraft}
          onChange={setTelegramDraft}
          onSubmit={() => void submitTelegram()}
        />
      ) : null}
      {tab === TABS.INBOX ? (
        <InboxPanel
          telegrams={relay.inbox}
          onSafeResponse={(id, answer) => relay.sendSafeResponse(id, answer)}
        />
      ) : null}
      {tab === TABS.PROFILE ? (
        <ProfileForm
          draft={profileDraft}
          onChange={setProfileDraft}
          onSave={() => void saveProfile()}
        />
      ) : null}

      <PermissionSetupModal
        relay={relay}
        visible={showPermissionSetup}
        onDismiss={() => setPermissionModalDismissed(true)}
      />

      <Modal
        transparent
        visible={connectedPeer !== null}
        animationType="fade"
        onRequestClose={() => setConnectedPeer(null)}
      >
        <View style={shared.modalBackdrop}>
          <View style={shared.modalCard}>
            <Text style={shared.heading}>Nearby device connected</Text>
            <Text style={shared.textSecondary}>
              {connectedPeer} is connected. Your emergency card left automatically with your current position, and everything that device is carrying is arriving in your inbox.
            </Text>
            <Action label="Dismiss" onPress={() => setConnectedPeer(null)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

interface PermissionSetupModalProps { relay: ReturnType<typeof useRelay>; visible: boolean; onDismiss: () => void; }
function PermissionSetupModal({ relay, visible, onDismiss }: PermissionSetupModalProps) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onDismiss}>
      <View style={shared.modalBackdrop}>
        <View style={shared.modalCard}>
          <Text style={shared.heading}>Set up the offline relay</Text>
          <Text style={shared.textSecondary}>
            Replica needs Nearby Bluetooth, nearby Wi-Fi, location where Android requires it, and notification permission before it can discover another phone. Android will show the exact system permission dialog after you tap Grant permissions.
          </Text>
          <Text style={shared.label}>Granted</Text>
          <Text style={shared.text}>{permissionList(relay.permissions.granted)}</Text>
          <Text style={shared.label}>Denied or still required</Text>
          <Text style={relay.permissions.denied.length > 0 ? shared.error : shared.text}>
            {permissionList(relay.permissions.denied, 'No result yet')}
          </Text>
          {relay.error ? <Text style={shared.error}>{relay.error}</Text> : null}
          <Action
            label="Grant permissions"
            onPress={() => { void relay.requestPermissions().catch(() => undefined); }}
          />
          <Action label="Not now" onPress={onDismiss} secondary />
        </View>
      </View>
    </Modal>
  );
}

interface RelayPanelProps { relay: ReturnType<typeof useRelay>; api: PrivateApi | null; showDemoTrigger: boolean; emergencyStatus: string; onTriggerDemo: () => void; }
function RelayPanel({ relay, api, showDemoTrigger, emergencyStatus, onTriggerDemo }: RelayPanelProps) {
  const permissionsGranted = allRequiredPermissionsGranted(relay.permissions);

  const allTelegrams = [...relay.inbox, ...relay.outbox];
  const emergencyCount = allTelegrams.filter((e) => e.telegram.status === 'EMERGENCY').length;
  const needHelpCount = allTelegrams.filter((e) => e.telegram.status === 'NEED_HELP').length;
  const safeCount = allTelegrams.filter((e) => e.telegram.status === 'SAFE').length;
  const totalCount = relay.inbox.length + relay.outbox.length;

  const peerDots = Array.from({ length: 4 }, (_, i) => i < relay.peerCount);

  return (
    <ScrollView contentContainerStyle={s.content}>
      <View style={shared.card}>
        <Text style={shared.label}>Local emergency reports</Text>
        <View style={s.statsRow}>
          <View style={s.statCol}>
            <Text style={[s.statNumber, { color: C.text }]}>{totalCount}</Text>
            <Text style={shared.label}>TOTAL</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statCol}>
            <Text style={[s.statNumber, { color: C.emergency }]}>{emergencyCount}</Text>
            <Text style={shared.label}>EMRG</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statCol}>
            <Text style={[s.statNumber, { color: C.needHelp }]}>{needHelpCount}</Text>
            <Text style={shared.label}>HELP</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statCol}>
            <Text style={[s.statNumber, { color: C.safe }]}>{safeCount}</Text>
            <Text style={shared.label}>SAFE</Text>
          </View>
        </View>
      </View>

      <View style={shared.card}>
        <View style={s.meshRow}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[shared.label, { color: C.accent, letterSpacing: 1 }]}>MESH NETWORK</Text>
            <Text style={shared.textSecondary}>
              {relay.peerCount} nearby · {totalCount} stored · {Object.keys(relay.deliveries).length} relayed
            </Text>
          </View>
          <View style={s.peerDots}>
            {peerDots.map((connected, i) => (
              <View
                key={i}
                style={[s.peerDot, connected ? s.peerDotConnected : s.peerDotEmpty]}
              />
            ))}
          </View>
        </View>
      </View>

      <OwnCard telegrams={relay.outbox} deliveries={relay.deliveries} />

      <View style={shared.card}>
        <Text style={shared.label}>Emergency activation</Text>
        <Text style={shared.textSecondary}>{emergencyStatus}</Text>
        {showDemoTrigger ? (
          <Action label="Activate demo emergency" onPress={onTriggerDemo} />
        ) : null}
      </View>

      {relay.status === 'ORPHAN' ? (
        <View style={[shared.card, s.orphanCard]}>
          <View style={s.orphanRow}>
            <View style={s.orphanDot} />
            <Text style={[shared.textSecondary, { color: C.error, flex: 1 }]}>
              ORPHAN: no peers are reachable. Keep Bluetooth and Wi-Fi enabled; the relay will recover automatically when another Replica device is discovered.
            </Text>
          </View>
        </View>
      ) : null}

      <RadioCheck />

      {relay.status === 'IDLE' ? (
        <Action
          label="Start offline relay"
          onPress={() => void relay.start().catch((error: unknown) => Alert.alert('Relay cannot start', messageFor(error)))}
        />
      ) : (
        <Action
          label="Stop relay"
          onPress={() => void relay.stop()}
          secondary
        />
      )}

      {!permissionsGranted ? (
        <Action
          label="Grant nearby permissions"
          onPress={() => { void relay.requestPermissions().catch(() => undefined); }}
          secondary
        />
      ) : null}

      {relay.permissions.denied.length > 0 ? (
        <Text style={s.error}>Permissions denied: {relay.permissions.denied.join(', ')}</Text>
      ) : null}

      {api ? (
        <>
          <GatewaySyncPanel />
          <PublicDashboardPanel api={api} />
        </>
      ) : null}

      <Text style={shared.textSecondary}>
        Keep Bluetooth and Wi-Fi enabled. The moment another Replica phone connects, your profile leaves automatically as a telegram with your position at that instant. It repeats on a widening gap while you stay in range: 3, 6, 12, 24, 48 minutes, then hourly. Editing your profile sends an update right away. Use Create only to report a specific incident.
      </Text>

      {relay.lastReject ? (
        <Text style={s.error}>Last incoming telegram rejected: {relay.lastReject}</Text>
      ) : null}

      {relay.radioError ? (
        <View style={{ gap: 8 }}>
          <Text style={s.error}>Radio: {relay.radioError}</Text>
          <Action
            label="Reset relay radio"
            onPress={() => { void relay.stop().then(relay.start); }}
            secondary
          />
        </View>
      ) : null}

      <View style={shared.card}>
        <Text style={[shared.label, { marginBottom: 4 }]}>Recent relay activity</Text>
        {relay.relayEvents.length === 0 ? (
          <Text style={shared.textSecondary}>No native relay events yet.</Text>
        ) : (
          relay.relayEvents.slice(0, 5).map((event, index) => (
            <Text key={`${event.type}-${index}`} style={shared.textSecondary}>
              {formatRelayEvent(event)}
            </Text>
          ))
        )}
      </View>
    </ScrollView>
  );
}

function RadioCheck() {
  const client = createRelayClient();
  const [radio, setRadio] = useState<{ bluetoothEnabled: boolean; wifiEnabled: boolean } | null>(null);
  useEffect(() => { setRadio(client.getRadioState()); }, []);
  if (!radio) return null;
  if (radio.bluetoothEnabled && radio.wifiEnabled) return null;
  return (
    <View style={[shared.card, { borderColor: C.emergency }]}>
      <Text style={[shared.label, { color: C.emergency }]}>RADIOS REQUIRED</Text>
      {!radio.bluetoothEnabled ? (
        <View style={{ gap: 8 }}>
          <Text style={shared.textSecondary}>Bluetooth is off. The relay needs it for peer discovery.</Text>
          <Action label="Open Bluetooth settings" onPress={() => client.openBluetoothSettings()} secondary />
        </View>
      ) : null}
      {!radio.wifiEnabled ? (
        <View style={{ gap: 8 }}>
          <Text style={shared.textSecondary}>WiFi is off. The relay needs it for data transfer.</Text>
          <Action label="Open WiFi settings" onPress={() => client.openWifiSettings()} secondary />
        </View>
      ) : null}
    </View>
  );
}

function GatewaySyncPanel() {
  const client = createRelayClient();
  const [snapshot, setSnapshot] = useState<import('ziro-relay').GatewaySyncSnapshot | null>(null);
  const refreshSnapshot = async () => setSnapshot(await client.getGatewaySyncSnapshot());
  useEffect(() => { void refreshSnapshot(); }, []);
  const sync = async () => {
    try { await client.scheduleGatewaySync(); await refreshSnapshot(); }
    catch (error) { Alert.alert('Gateway sync failed', messageFor(error)); }
  };
  return (
    <View style={shared.card}>
      <Text style={shared.label}>Private gateway sync</Text>
      <Text style={shared.textSecondary}>{snapshot?.pendingCount ?? 0} telegram(s) pending gateway</Text>
      <Text style={shared.textSecondary}>
        Last sync: {snapshot?.lastSyncAt ? new Date(snapshot.lastSyncAt).toLocaleString() : 'never'}
      </Text>
      <Text style={shared.textSecondary}>
        {snapshot?.lastConfirmedPurgeAt
          ? `Sensitive local data purged after server ${snapshot.lastConfirmedPurgeOutcome} at ${new Date(snapshot.lastConfirmedPurgeAt).toLocaleString()}.`
          : 'Sensitive local data stays on this device until the server confirms it.'}
      </Text>
      {snapshot?.items.slice(0, 3).map((item) => (
        <Text key={item.id} style={shared.textSecondary}>
          {item.id.slice(0, 8)}: {gatewayOutcomeLabel(item.status, item.error)}
        </Text>
      ))}
      <Action label="Sync private outbox" onPress={() => void sync()} />
    </View>
  );
}

function PublicDashboardPanel({ api }: { api: PrivateApi }) {
  const [summary, setSummary] = useState<import('../api/privateApi').PublicDashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => void api.publicDashboardSummary().then(setSummary).catch((reason: unknown) => setError(messageFor(reason)));
  return (
    <View style={shared.card}>
      <Text style={shared.label}>Public situation dashboard</Text>
      <Text style={shared.textSecondary}>
        Read-only H3 heatmap and aggregate reports. This view never requests personal or telegram records.
      </Text>
      {summary ? (
        <>
          <Text style={shared.textSecondary}>{summary.heatmapCells} aggregated heatmap cell(s) online</Text>
          {summary.reports.map((report) => (
            <Text key={report.title} style={shared.textSecondary}>{report.title}: {report.summary}</Text>
          ))}
        </>
      ) : (
        <Text style={shared.textSecondary}>{error ?? 'Not loaded.'}</Text>
      )}
      <Action label="Refresh public summary" onPress={load} secondary />
    </View>
  );
}

interface TelegramFormProps { draft: TelegramDraft; onChange: (draft: TelegramDraft) => void; onSubmit: () => void; }
function TelegramForm({ draft, onChange, onSubmit }: TelegramFormProps) {
  return (
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={shared.heading}>Create emergency telegram</Text>
      <Text style={shared.textSecondary}>
        The relay generates ID, timestamp, hop, TTL, origin and your private medical block. Only this form's current emergency facts are sent.
      </Text>
      <Field
        label="Event identifier *"
        value={draft.eventId}
        placeholder="e.g. BOG-2026-01"
        onChangeText={(eventId) => onChange({ ...draft, eventId })}
      />
      <Choice
        label="Event type"
        value={draft.event}
        options={Object.values(EVENT_TYPES)}
        onChange={(event) => onChange({ ...draft, event })}
      />
      <Choice
        label="Person status"
        value={draft.status}
        options={Object.values(PERSON_STATUSES)}
        onChange={(status) => onChange({ ...draft, status })}
      />
      <Choice
        label="Severity (1–5)"
        value={String(draft.severity)}
        options={['1', '2', '3', '4', '5']}
        onChange={(value) => onChange({ ...draft, severity: Number(value) })}
      />
      <Field
        label="Latitude *"
        value={String(draft.location?.lat ?? '')}
        keyboardType="decimal-pad"
        onChangeText={(value) => onChange({ ...draft, location: { lat: Number(value), lng: draft.location?.lng ?? 0 } })}
      />
      <Field
        label="Longitude *"
        value={String(draft.location?.lng ?? '')}
        keyboardType="decimal-pad"
        onChangeText={(value) => onChange({ ...draft, location: { lat: draft.location?.lat ?? 0, lng: Number(value) } })}
      />
      <Action label="Queue telegram for relay" onPress={onSubmit} />
    </ScrollView>
  );
}

interface InboxPanelProps { telegrams: LedgerEntry[]; onSafeResponse: (id: string, answer: string) => Promise<unknown>; }
/**
 * Other people, only. This device's own card is NOT here even though the ledger carries
 * it: an inbox that lists what you sent yourself reads like a bug, and it buries the one
 * thing that matters - somebody nearby needs help. Your own card lives in RELAY.
 */
function InboxPanel({ telegrams, onSafeResponse }: InboxPanelProps) {
  const [selected, setSelected] = useState<LedgerEntry | null>(null);
  const [showCoordinates, setShowCoordinates] = useState(false);
  const [answer, setAnswer] = useState('');
  const safe = async () => {
    if (!selected || !answer.trim()) return Alert.alert('SAFE answer required', 'Ask the nearby person and enter their answer.');
    try {
      await onSafeResponse(selected.telegram.id, answer);
      setAnswer('');
      Alert.alert('SAFE telegram queued', 'The helping device signed it and it is now relaying.');
    } catch (error: unknown) {
      Alert.alert('Could not send SAFE response', messageFor(error));
    }
  };

  return (
    <ScrollView contentContainerStyle={s.content}>
      <Text style={shared.label}>Telegrams stored locally</Text>

      {telegrams.length === 0 ? (
        <View style={[shared.card, { alignItems: 'center', paddingVertical: 32 }]}>
          <Text style={shared.textSecondary}>Nobody has reached this device yet. Start the relay and wait for another Replica phone.</Text>
        </View>
      ) : null}

      {telegrams.map((entry) => {
        const { telegram, receivedFrom } = entry;
        const avatarLabel = telegram.vital?.name
          ? initials(telegram.vital.name)
          : initials(telegram.user_id);
        const statusC = statusColor(telegram.status);
        const locationText = telegram.location
          ? `${telegram.location.lat.toFixed(4)}, ${telegram.location.lng.toFixed(4)}`
          : 'Position unavailable';
        const timeText = new Date(telegram.timestamp * 1000).toLocaleTimeString();

        return (
          <Pressable
            key={telegram.id}
            style={[shared.card, { borderLeftWidth: 3, borderLeftColor: statusC, gap: 10 }]}
            onPress={() => { setSelected(entry); setShowCoordinates(false); }}
          >
            <View style={s.telegramCardRow}>
              <View style={shared.avatar}>
                <Text style={shared.avatarText}>{avatarLabel}</Text>
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <View style={s.telegramCardNameRow}>
                  <Text style={s.telegramName}>{telegram.vital?.name ?? telegram.user_id}</Text>
                  <StatusBadge status={telegram.status} />
                </View>
                <Text style={shared.textSecondary}>
                  {locationText} · {timeText}
                </Text>
                <Text style={{ color: C.textMuted, fontSize: 12 }}>
                  Telegram stored locally · relayed by {receivedFrom}
                </Text>
              </View>
            </View>
          </Pressable>
        );
      })}

      <Modal
        transparent
        visible={selected !== null}
        onRequestClose={() => setSelected(null)}
      >
        <View style={shared.modalBackdrop}>
          <ScrollView contentContainerStyle={shared.modalCard}>
            {selected ? (
              <>
                <Text style={shared.heading}>Inbound triage</Text>
                <Text style={shared.text}>
                  {selected.telegram.vital?.name ?? selected.telegram.user_id} · {selected.telegram.status}
                </Text>
                <Text style={shared.textSecondary}>Clinical priority: {selected.telegram.severity}/5</Text>
                <Text style={shared.textSecondary}>
                  Event: {selected.telegram.event} / {selected.telegram.event_id}
                </Text>
                <Text style={shared.textSecondary}>
                  Sender: {selected.receivedFrom ?? 'unknown'} · origin {selected.telegram.origin}
                </Text>
                <Text style={shared.textSecondary}>
                  Received telegram: {new Date(selected.telegram.timestamp * 1000).toLocaleString()} · hops {selected.telegram.hop} · TTL {selected.telegram.ttl}
                </Text>
                <View style={shared.divider} />
                <Text style={shared.textSecondary}>Blood: {selected.telegram.vital?.blood ?? 'unknown'}</Text>
                <Text style={shared.textSecondary}>
                  Allergies: {selected.telegram.vital?.allergies.join(', ') || 'none reported'}
                </Text>
                <Text style={shared.textSecondary}>
                  Conditions: {selected.telegram.vital?.conditions.join(', ') || 'none reported'}
                </Text>
                <Text style={shared.textSecondary}>
                  Medication: {selected.telegram.vital?.medications.join(', ') || 'none reported'}
                </Text>
                <Text style={shared.textSecondary}>
                  Disability: {selected.telegram.vital?.disability ?? 'unknown'} · pregnant: {String(selected.telegram.vital?.pregnant ?? false)}
                </Text>
                <Action
                  label={showCoordinates ? 'Hide exact coordinates' : 'Reveal exact coordinates deliberately'}
                  onPress={() => setShowCoordinates(!showCoordinates)}
                  secondary
                />
                {showCoordinates ? (
                  <Text style={shared.textSecondary}>
                    {selected.telegram.location
                      ? `Coordinates ${selected.telegram.location.lat.toFixed(5)}, ${selected.telegram.location.lng.toFixed(5)}`
                      : 'Position unavailable'}
                  </Text>
                ) : null}
                {selected.receivedFrom && selected.telegram.verify ? (
                  <>
                    <Text style={shared.textSecondary}>
                      SAFE verification question ID: {selected.telegram.verify.question_id}
                    </Text>
                    <Field
                      label="Nearby person's answer"
                      value={answer}
                      secureTextEntry
                      onChangeText={setAnswer}
                    />
                    <Action label="Send signed SAFE response" onPress={() => void safe()} />
                  </>
                ) : null}
                <Action label="Close" onPress={() => setSelected(null)} secondary />
              </>
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}

interface OwnCardProps { telegrams: LedgerEntry[]; deliveries: Record<string, string>; }
/** Proof this device is on the air: what it sent, when, and who acknowledged it. */
function OwnCard({ telegrams, deliveries }: OwnCardProps) {
  const latest = telegrams[0];
  if (!latest) return null;
  return (
    <View style={[shared.card, { borderLeftWidth: 3, borderLeftColor: C.emergency }]}>
      <Text style={[shared.label, { color: C.accent }]}>Your emergency card</Text>
      <Text style={shared.textSecondary}>
        Sent {telegrams.length} time(s) · last {new Date(latest.telegram.timestamp * 1000).toLocaleTimeString()}
      </Text>
      <Text style={shared.textSecondary}>
        {latest.telegram.location
          ? `Position ${latest.telegram.location.lat.toFixed(4)}, ${latest.telegram.location.lng.toFixed(4)}`
          : 'Position unavailable'}
      </Text>
      <Text style={shared.textSecondary}>
        {deliveries[latest.telegram.id] ?? (latest.deliveredTo.length ? `Delivered to ${latest.deliveredTo.join(', ')}` : 'Waiting for a peer to acknowledge')}
      </Text>
    </View>
  );
}

interface ProfileFormProps { draft: ProfileInput | null; onChange: (profile: ProfileInput) => void; onSave: () => void; }
function ProfileForm({ draft, onChange, onSave }: ProfileFormProps) {
  const [showIdentityAnswer, setShowIdentityAnswer] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  if (!draft) return (
    <View style={s.content}>
      <Text style={shared.textSecondary}>Loading private profile…</Text>
    </View>
  );
  const list = (key: 'allergies' | 'chronicConditions' | 'medications') => draft[key].join(', ');
  const setList = (key: 'allergies' | 'chronicConditions' | 'medications', value: string) => onChange({ ...draft, [key]: splitList(value) });
  const contact = draft.emergencyContacts[0] ?? { name: '', phone: '', relationship: '' };
  const setContact = (key: keyof typeof contact, value: string) => onChange({ ...draft, emergencyContacts: [{ ...contact, [key]: value }] });

  return (
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={shared.heading}>Private profile</Text>
      <Text style={shared.textSecondary}>This stays on this device. Only triage fields are copied into your telegram.</Text>
      <Field
        label="Anonymous user ID *"
        value={draft.userId}
        onChangeText={(userId) => onChange({ ...draft, userId })}
      />
      <Field
        label="Full name *"
        value={draft.fullName}
        onChangeText={(fullName) => onChange({ ...draft, fullName })}
      />
      <Choice
        label="Document type"
        value={draft.docType}
        options={Object.values(DOCUMENT_TYPES)}
        onChange={(docType) => onChange({ ...draft, docType: docType as ProfileInput['docType'] })}
      />
      <Field
        label="Document number *"
        value={draft.docNumber}
        onChangeText={(docNumber) => onChange({ ...draft, docNumber })}
      />
      <View style={{ gap: 6 }}>
        <Text style={shared.label}>Birth date *</Text>
        <Pressable onPress={() => setShowDatePicker(true)} style={shared.input}>
          <Text style={{ color: draft.birthDate ? C.text : C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 15 }}>
            {draft.birthDate || 'Select date'}
          </Text>
        </Pressable>
        {showDatePicker && (
          <DateTimePicker
            value={draft.birthDate ? new Date(draft.birthDate + 'T00:00:00') : new Date(2000, 0, 1)}
            mode="date"
            maximumDate={new Date(Date.now() - 86400000)}
            onChange={(_, date) => {
              setShowDatePicker(Platform.OS === 'ios');
              if (date) {
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const d = String(date.getDate()).padStart(2, '0');
                onChange({ ...draft, birthDate: `${y}-${m}-${d}` });
              }
            }}
          />
        )}
      </View>
      <Choice
        label="Blood group"
        value={draft.bloodType}
        options={Object.values(BLOOD_TYPES)}
        onChange={(bloodType) => onChange({ ...draft, bloodType: bloodType as ProfileInput['bloodType'] })}
      />
      <Choice
        label="Rh"
        value={draft.bloodRh}
        options={Object.values(BLOOD_RH)}
        onChange={(bloodRh) => onChange({ ...draft, bloodRh: bloodRh as ProfileInput['bloodRh'] })}
      />
      <Field
        label="Allergies (comma-separated)"
        value={list('allergies')}
        onChangeText={(value) => setList('allergies', value)}
      />
      <Field
        label="Chronic conditions (comma-separated)"
        value={list('chronicConditions')}
        onChangeText={(value) => setList('chronicConditions', value)}
      />
      <Field
        label="Medications (comma-separated)"
        value={list('medications')}
        onChangeText={(value) => setList('medications', value)}
      />
      <Choice
        label="Disability"
        value={draft.disability}
        options={Object.values(DISABILITIES)}
        onChange={(disability) => onChange({ ...draft, disability: disability as ProfileInput['disability'] })}
      />
      <View style={shared.switchRow}>
        <Text style={shared.text}>Pregnant</Text>
        <Switch
          value={draft.isPregnant}
          onValueChange={(isPregnant) => onChange({ ...draft, isPregnant })}
          trackColor={{ false: C.cardBorder, true: C.accent }}
          thumbColor={draft.isPregnant ? C.bg : C.textMuted}
        />
      </View>
      <Field
        label="Weight (kg)"
        value={draft.weightKg?.toString() ?? ''}
        keyboardType="number-pad"
        onChangeText={(value) => onChange({ ...draft, weightKg: value ? Number(value) : null })}
      />
      <Field
        label="EPS"
        value={draft.eps ?? ''}
        onChangeText={(eps) => onChange({ ...draft, eps: eps || null })}
      />
      <Field
        label="Emergency contact name *"
        value={contact.name}
        onChangeText={(value) => setContact('name', value)}
      />
      <View style={{ gap: 6 }}>
        <Text style={shared.label}>Emergency contact phone *</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={[shared.input, { paddingHorizontal: 10, justifyContent: 'center', borderTopRightRadius: 0, borderBottomRightRadius: 0 }]}>
            <Text style={{ color: C.text }}>+57</Text>
          </View>
          <TextInput
            style={[shared.input, { flex: 1, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }]}
            value={contact.phone.startsWith('+57') ? contact.phone.slice(3) : contact.phone}
            onChangeText={(val) => setContact('phone', val ? `+57${val}` : '')}
            keyboardType="phone-pad"
            placeholderTextColor={C.textMuted}
            placeholder="3001234567"
          />
        </View>
      </View>
      <Field
        label="Emergency contact relationship *"
        value={contact.relationship}
        onChangeText={(value) => setContact('relationship', value)}
      />
      <Field
        label="Verification question ID *"
        value={draft.questionId}
        onChangeText={(questionId) => onChange({ ...draft, questionId })}
      />
      <View style={{ gap: 6 }}>
        <Text style={shared.label}>New identity answer (only to change it)</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TextInput
            style={[shared.input, { flex: 1 }]}
            value={draft.identityAnswer ?? ''}
            secureTextEntry={!showIdentityAnswer}
            onChangeText={(identityAnswer) => onChange({ ...draft, identityAnswer })}
            placeholderTextColor={C.textMuted}
            placeholder="Optional"
          />
          <Pressable onPress={() => setShowIdentityAnswer(!showIdentityAnswer)} style={{ paddingHorizontal: 10 }}>
            <Text style={{ fontSize: 18 }}>{showIdentityAnswer ? '👁' : '🔒'}</Text>
          </Pressable>
        </View>
      </View>
      <Action label="Save private profile" onPress={onSave} />
    </ScrollView>
  );
}

interface FieldProps { label: string; value: string; placeholder?: string; keyboardType?: 'default' | 'decimal-pad' | 'number-pad' | 'phone-pad'; secureTextEntry?: boolean; onChangeText: (value: string) => void; }
function Field({ label, ...props }: FieldProps) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={shared.label}>{label}</Text>
      <TextInput style={shared.input} placeholderTextColor={C.textMuted} {...props} />
    </View>
  );
}

interface ChoiceProps<T extends string> { label: string; value: T; options: readonly T[]; onChange: (value: T) => void; }
function Choice<T extends string>({ label, value, options, onChange }: ChoiceProps<T>) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={shared.label}>{label}</Text>
      <View style={shared.chips}>
        {options.map((opt) => (
          <Pressable
            key={opt}
            style={[shared.chip, value === opt && shared.chipActive]}
            onPress={() => onChange(opt)}
          >
            <Text style={value === opt ? shared.chipTextActive : shared.chipText}>{enumLabel(opt)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

interface ActionProps { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean; }
function Action({ label, onPress, disabled, secondary }: ActionProps) {
  return (
    <Pressable
      style={[secondary ? shared.btnSecondary : shared.btnPrimary, disabled && shared.btnDisabled]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={secondary ? shared.btnSecondaryText : shared.btnPrimaryText}>{label}</Text>
    </Pressable>
  );
}

interface TabButtonProps { label: string; active: boolean; onPress: () => void; }
function TabButton({ label, active, onPress }: TabButtonProps) {
  return (
    <Pressable style={[s.tab, active && s.tabActive]} onPress={onPress}>
      <Text style={active ? s.tabTextActive : s.tabText}>{label}</Text>
    </Pressable>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = statusColor(status);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: color, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ fontFamily: F.bold, color, fontSize: 11, letterSpacing: 0.5 }}>{status.replace('_', ' ')}</Text>
    </View>
  );
}

function enumLabel(value: string): string {
  const MAP: Record<string, string> = {
    POSITIVE: 'Rh+',
    NEGATIVE: 'Rh-',
    NONE: 'None',
    EMERGENCY: 'Emergency',
    NEED_HELP: 'Need Help',
    SAFE: 'Safe',
  };
  return MAP[value] ?? value;
}

function validateTelegram(draft: TelegramDraft): string | null { if (!draft.eventId.trim()) return 'Event identifier is required.'; if (draft.location !== null) { if (!Number.isFinite(draft.location.lat) || draft.location.lat < -90 || draft.location.lat > 90) return 'Latitude must be between -90 and 90.'; if (!Number.isFinite(draft.location.lng) || draft.location.lng < -180 || draft.location.lng > 180) return 'Longitude must be between -180 and 180.'; } return null; }
function validateProfile(profile: ProfileInput): string | null { if (!profile.userId.trim() || !profile.fullName.trim() || !profile.docNumber.trim() || !profile.birthDate.trim() || !profile.questionId.trim() || (!profile.identityAnswer?.trim() && !profile.answerHash)) return 'User ID, name, document, birth date, verification question and identity answer are required.'; if (profile.emergencyContacts.length === 0 || profile.emergencyContacts.some((contact) => !contact.name.trim() || !contact.phone.trim() || !contact.relationship.trim())) return 'At least one complete emergency contact is required.'; if (!/^\d{4}-\d{2}-\d{2}$/.test(profile.birthDate)) return 'Birth date must use YYYY-MM-DD.'; return null; }
function gatewayOutcomeLabel(status: string, error: string | null): string { if (status === 'pending') return 'Pending gateway'; if (status === 'accepted') return 'Valid SAFE or telegram accepted'; if (status === 'invalid_safe_verification') return 'Invalid SAFE response'; if (status === 'ignored_safe') return 'Ignored: target already SAFE'; return error ? `${status}: ${error}` : status; }
function splitList(value: string): string[] { return value.split(',').map((entry) => entry.trim()).filter(Boolean); }
function messageFor(error: unknown): string { return error instanceof Error ? error.message : 'Unexpected offline relay error.'; }
function allRequiredPermissionsGranted(permissions: PermissionResult): boolean { return permissions.granted.length > 0 && permissions.denied.length === 0; }
function permissionList(permissions: string[], empty = 'none'): string { return permissions.length > 0 ? permissions.join(', ') : empty; }
function formatRelayEvent(event: RelayEvent): string {
  switch (event.type) {
    case 'PEER_DISCOVERED': return `Discovered ${event.peerId}`;
    case 'PEER_CONNECTED': return `Connected to ${event.peerId}`;
    case 'PEER_DISCONNECTED': return `Disconnected from ${event.peerId}`;
    case 'TELEGRAM_RECEIVED': return `Telegram received from ${event.peerId}`;
    case 'TELEGRAM_SENT': return `Telegram ${event.telegramId} sent to ${event.peerId}`;
    case 'TELEGRAM_DELIVERED': return `Telegram ${event.telegramId} delivered to ${event.peerId}`;
    case 'TELEGRAM_REJECTED': return `Telegram rejected by ${event.peerId}: ${event.reason}`;
    case 'STATUS_CHANGED': return `Relay state: ${event.status}`;
    case 'RADIO_ERROR': return `Radio error: ${event.message}`;
    case 'GATEWAY_CONNECTIVITY': return 'Internet connection available for gateway sync';
  }
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: SAFE_TOP + 12,
    paddingBottom: 12,
    backgroundColor: C.bg,
  },
  headerLeft: {
    gap: 4,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  brand: {
    fontFamily: F.black,
    color: C.text,
    fontSize: 28,
    letterSpacing: 3,
  },
  networkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  networkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.textMuted,
  },
  networkDotActive: {
    backgroundColor: C.active,
  },
  networkLabel: {
    fontFamily: F.semibold,
    color: C.textMuted,
    fontSize: 11,
    letterSpacing: 1,
  },
  networkLabelActive: {
    color: C.active,
  },
  statusLabel: {
    fontFamily: F.semibold,
    color: C.textSecondary,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: C.bg,
    borderBottomWidth: 1,
    borderBottomColor: C.cardBorder,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: C.accent,
  },
  tabText: {
    fontFamily: F.semibold,
    color: C.textMuted,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  tabTextActive: {
    fontFamily: F.bold,
    color: C.accent,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  content: {
    padding: 16,
    gap: 12,
  },
  error: {
    fontFamily: F.medium,
    color: C.error,
    paddingHorizontal: 16,
    paddingTop: 8,
    fontSize: 13,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 8,
  },
  statCol: {
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  statNumber: {
    fontFamily: F.extrabold,
    fontSize: 32,
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: C.cardBorder,
  },
  meshRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  peerDots: {
    flexDirection: 'row',
    gap: 6,
  },
  peerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  peerDotConnected: {
    backgroundColor: C.active,
  },
  peerDotEmpty: {
    backgroundColor: C.cardBorder,
  },
  orphanCard: {
    borderColor: C.error,
  },
  orphanRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  orphanDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.error,
    marginTop: 4,
  },
  telegramCardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  telegramCardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  telegramName: {
    fontFamily: F.bold,
    color: C.text,
    fontSize: 16,
    flex: 1,
  },
});

const ea = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 16,
    backgroundColor: C.bg,
  },
  banner: {
    fontFamily: F.semibold,
    color: C.accent,
    fontSize: 12,
    letterSpacing: 2,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  iconBox: {
    width: 80,
    height: 80,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(201, 168, 108, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.card,
    marginVertical: 4,
  },
  iconText: {
    fontSize: 32,
    color: C.accent,
  },
  eventType: {
    fontFamily: F.extrabold,
    fontSize: 36,
    color: C.text,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  detected: {
    fontFamily: F.bold,
    fontSize: 28,
    color: C.accent,
    textAlign: 'center',
  },
  location: {
    fontFamily: F.regular,
    fontSize: 16,
    color: C.textSecondary,
    textAlign: 'center',
  },
  magnitude: {
    fontFamily: F.bold,
    fontSize: 22,
    color: C.text,
    textAlign: 'center',
  },
  eventMeta: {
    fontFamily: F.regular,
    fontSize: 13,
    color: C.textMuted,
    textAlign: 'center',
    letterSpacing: 1,
  },
  divider: {
    width: '100%',
    marginVertical: 4,
  },
  reportLabel: {
    fontFamily: F.semibold,
    fontSize: 12,
    color: C.accent,
    letterSpacing: 2,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  countdown: {
    fontFamily: F.extrabold,
    fontSize: 64,
    color: C.accent,
    textAlign: 'center',
    letterSpacing: -2,
  },
  helpText: {
    fontFamily: F.regular,
    fontSize: 14,
    color: C.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  btnSafe: {
    width: '100%',
    borderWidth: 1,
    borderColor: C.textSecondary,
    backgroundColor: 'transparent',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 18,
    marginTop: 4,
  },
  btnSafeText: {
    fontFamily: F.bold,
    color: C.text,
    fontSize: 14,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  btnHelp: {
    width: '100%',
    borderWidth: 1,
    borderColor: C.needHelp,
    backgroundColor: 'transparent',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 18,
  },
  btnHelpText: {
    fontFamily: F.bold,
    color: C.needHelp,
    fontSize: 14,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});
