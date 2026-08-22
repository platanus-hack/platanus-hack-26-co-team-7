import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
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
import { USE_FAKE_ENGINE } from '../native/relayClient';

const TABS = { RELAY: 'RELAY', CREATE: 'CREATE', INBOX: 'INBOX', PROFILE: 'PROFILE' } as const;
type Tab = (typeof TABS)[keyof typeof TABS];

const DEFAULT_DRAFT: TelegramDraft = {
  eventId: '', event: EVENT_TYPES.EARTHQUAKE, status: PERSON_STATUSES.EMERGENCY,
  location: { lat: 4.6097, lng: -74.0817 }, severity: 3,
};

export function HomeScreen() {
  const relay = useRelay();
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
  const showPermissionSetup = !USE_FAKE_ENGINE && !permissionsGranted && !permissionModalDismissed;

  const submitTelegram = async () => {
    const validation = validateTelegram(telegramDraft);
    if (validation) return Alert.alert('Check the telegram', validation);
    try {
      await relay.sendTelegram(telegramDraft);
      setTelegramDraft(DEFAULT_DRAFT);
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
      await relay.saveProfile(profileDraft);
      Alert.alert('Profile saved', 'Your private profile will be used in your next telegram.');
    } catch (error: unknown) {
      Alert.alert('Could not save profile', messageFor(error));
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View><Text style={styles.brand}>ZIRO</Text><Text style={styles.subtitle}>Offline emergency relay</Text></View>
        {USE_FAKE_ENGINE ? <Text style={styles.fake}>EXPO GO DEMO</Text> : null}
      </View>
      <View style={styles.tabs}>
        {Object.values(TABS).map((item) => <TabButton key={item} label={item} active={tab === item} onPress={() => setTab(item)} />)}
      </View>
      {relay.error ? <Text style={styles.error}>{relay.error}</Text> : null}
      {tab === TABS.RELAY ? <RelayPanel relay={relay} /> : null}
      {tab === TABS.CREATE ? <TelegramForm draft={telegramDraft} onChange={setTelegramDraft} onSubmit={() => void submitTelegram()} /> : null}
      {tab === TABS.INBOX ? <InboxPanel telegrams={relay.telegrams} deliveries={relay.deliveries} /> : null}
      {tab === TABS.PROFILE ? <ProfileForm draft={profileDraft} onChange={setProfileDraft} onSave={() => void saveProfile()} /> : null}
      <PermissionSetupModal relay={relay} visible={showPermissionSetup} onDismiss={() => setPermissionModalDismissed(true)} />
      <Modal transparent visible={connectedPeer !== null} animationType="fade" onRequestClose={() => setConnectedPeer(null)}>
        <View style={styles.modalBackdrop}><View style={styles.modalCard}><Text style={styles.heading}>Nearby device connected</Text><Text style={styles.help}>{connectedPeer} is connected. Pending telegrams are now exchanging locally.</Text><Action label="Dismiss" onPress={() => setConnectedPeer(null)} /></View></View>
      </Modal>
    </View>
  );
}

interface PermissionSetupModalProps { relay: ReturnType<typeof useRelay>; visible: boolean; onDismiss: () => void; }
function PermissionSetupModal({ relay, visible, onDismiss }: PermissionSetupModalProps) {
  return <Modal transparent visible={visible} animationType="fade" onRequestClose={onDismiss}>
    <View style={styles.modalBackdrop}><View style={styles.modalCard}>
      <Text style={styles.heading}>Set up the offline relay</Text>
      <Text style={styles.help}>ZIRO needs Nearby Bluetooth, nearby Wi-Fi, location where Android requires it, and notification permission before it can discover another phone. Android will show the exact system permission dialog after you tap Grant permissions.</Text>
      <Text style={styles.label}>Granted</Text><Text style={styles.permissionText}>{permissionList(relay.permissions.granted)}</Text>
      <Text style={styles.label}>Denied or still required</Text><Text style={relay.permissions.denied.length > 0 ? styles.errorInline : styles.permissionText}>{permissionList(relay.permissions.denied, 'No result yet')}</Text>
      {relay.error ? <Text style={styles.errorInline}>{relay.error}</Text> : null}
      <Action label="Grant permissions" onPress={() => { void relay.requestPermissions().catch(() => undefined); }} />
      <Action label="Not now" onPress={onDismiss} secondary />
    </View></View>
  </Modal>;
}

interface RelayPanelProps { relay: ReturnType<typeof useRelay>; }
function RelayPanel({ relay }: RelayPanelProps) {
  const permissionsGranted = allRequiredPermissionsGranted(relay.permissions);
  return <ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.heading}>Relay control</Text>
    <View style={styles.statusCard}>
      <Text style={styles.status}>Node {relay.status}</Text>
      <Text>{relay.peerCount} connected peer(s): {relay.peers.join(', ') || 'none'}</Text>
      <Text>Nearby discovery: {relay.discoveredPeers.join(', ') || 'waiting for another ZIRO device'}</Text>
      <Text>Permissions: {permissionsGranted ? 'ready' : 'required'}</Text>
      <Text>Granted: {permissionList(relay.permissions.granted)}</Text>
      <Text>Denied: {permissionList(relay.permissions.denied, 'none')}</Text>
    </View>
    {!permissionsGranted ? <Action label="Grant nearby permissions" onPress={() => { void relay.requestPermissions().catch(() => undefined); }} /> : null}
    {relay.permissions.denied.length > 0 ? <Text style={styles.error}>Permissions denied: {relay.permissions.denied.join(', ')}</Text> : null}
    <Action label="Start offline relay (requests permissions)" onPress={() => void relay.start().catch((error: unknown) => Alert.alert('Relay cannot start', messageFor(error)))} disabled={relay.status !== 'IDLE'} />
    <Action label="Stop relay" onPress={() => void relay.stop()} disabled={relay.status === 'IDLE'} secondary />
    <Text style={styles.help}>Keep Bluetooth and Wi-Fi enabled. Starting the relay makes this phone advertise and discover nearby ZIRO phones without Internet.</Text>
    {relay.lastReject ? <Text style={styles.error}>Last incoming telegram rejected: {relay.lastReject}</Text> : null}
    {relay.radioError ? <View><Text style={styles.error}>Radio: {relay.radioError}</Text><Action label="Reset relay radio" onPress={() => { void relay.stop().then(relay.start); }} secondary /></View> : null}
    <View style={styles.diagnostics}><Text style={styles.diagnosticTitle}>Recent relay activity</Text>{relay.relayEvents.length === 0 ? <Text style={styles.diagnosticLine}>No native relay events yet.</Text> : relay.relayEvents.slice(0, 5).map((event, index) => <Text key={`${event.type}-${index}`} style={styles.diagnosticLine}>{formatRelayEvent(event)}</Text>)}</View>
  </ScrollView>;
}

interface TelegramFormProps { draft: TelegramDraft; onChange: (draft: TelegramDraft) => void; onSubmit: () => void; }
function TelegramForm({ draft, onChange, onSubmit }: TelegramFormProps) {
  return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.heading}>Create emergency telegram</Text>
    <Text style={styles.help}>The relay generates ID, timestamp, hop, TTL, origin and your private medical block. Only this form’s current emergency facts are sent.</Text>
    <Field label="Event identifier *" value={draft.eventId} placeholder="e.g. BOG-2026-01" onChangeText={(eventId) => onChange({ ...draft, eventId })} />
    <Choice label="Event type" value={draft.event} options={Object.values(EVENT_TYPES)} onChange={(event) => onChange({ ...draft, event })} />
    <Choice label="Person status" value={draft.status} options={Object.values(PERSON_STATUSES)} onChange={(status) => onChange({ ...draft, status })} />
    <Choice label="Severity (1–5)" value={String(draft.severity)} options={['1', '2', '3', '4', '5']} onChange={(value) => onChange({ ...draft, severity: Number(value) })} />
    <Field label="Latitude *" value={String(draft.location.lat)} keyboardType="decimal-pad" onChangeText={(value) => onChange({ ...draft, location: { ...draft.location, lat: Number(value) } })} />
    <Field label="Longitude *" value={String(draft.location.lng)} keyboardType="decimal-pad" onChangeText={(value) => onChange({ ...draft, location: { ...draft.location, lng: Number(value) } })} />
    <Action label="Queue telegram for relay" onPress={onSubmit} />
  </ScrollView>;
}

interface InboxPanelProps { telegrams: LedgerEntry[]; deliveries: Record<string, string>; }
function InboxPanel({ telegrams, deliveries }: InboxPanelProps) {
  const receivedCount = telegrams.filter(({ receivedFrom }) => receivedFrom !== null).length;
  return <ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.heading}>Local telegram ledger</Text>
    <Text style={styles.help}>This is the device ledger. It remains available while connectivity is absent and after app restarts.</Text>
    {receivedCount > 0 ? <Text style={styles.receipt}>Received locally: {receivedCount} telegram(s)</Text> : null}
    {telegrams.length === 0 ? <Text style={styles.empty}>No telegrams stored yet. Create one or start the relay to receive one.</Text> : null}
    {telegrams.map(({ telegram, receivedFrom, deliveredTo }) => <View key={telegram.id} style={styles.telegramCard}>
      <Text style={styles.cardTitle}>{telegram.vital?.name ?? telegram.user_id} · {telegram.status}</Text>
      <Text>{telegram.event} / severity {telegram.severity}</Text><Text>TTL {telegram.ttl} · hops {telegram.hop}</Text>
      <Text>Origin {telegram.origin} · {new Date(telegram.timestamp * 1000).toLocaleString()}</Text>
      <Text>Coordinates {telegram.location.lat.toFixed(4)}, {telegram.location.lng.toFixed(4)}</Text>
      <Text style={styles.delivery}>{deliveries[telegram.id] ?? (receivedFrom ? `Received from ${receivedFrom}` : deliveredTo.length ? `Delivered to ${deliveredTo.join(', ')}` : 'Outbound: waiting for a peer')}</Text>
      {telegram.vital ? <Text>Blood {telegram.vital.blood ?? 'unknown'} · allergies {telegram.vital.allergies.join(', ') || 'none'}</Text> : null}
    </View>)}
  </ScrollView>;
}

interface ProfileFormProps { draft: ProfileInput | null; onChange: (profile: ProfileInput) => void; onSave: () => void; }
function ProfileForm({ draft, onChange, onSave }: ProfileFormProps) {
  if (!draft) return <View style={styles.content}><Text>Loading private profile…</Text></View>;
  const list = (key: 'allergies' | 'chronicConditions' | 'medications') => draft[key].join(', ');
  const setList = (key: 'allergies' | 'chronicConditions' | 'medications', value: string) => onChange({ ...draft, [key]: splitList(value) });
  const contact = draft.emergencyContacts[0] ?? { name: '', phone: '', relationship: '' };
  const setContact = (key: keyof typeof contact, value: string) => onChange({ ...draft, emergencyContacts: [{ ...contact, [key]: value }] });
  return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.heading}>Private profile</Text><Text style={styles.help}>This stays on this device. Only triage fields are copied into your telegram.</Text>
    <Field label="Anonymous user ID *" value={draft.userId} onChangeText={(userId) => onChange({ ...draft, userId })} />
    <Field label="Full name *" value={draft.fullName} onChangeText={(fullName) => onChange({ ...draft, fullName })} />
    <Choice label="Document type" value={draft.docType} options={Object.values(DOCUMENT_TYPES)} onChange={(docType) => onChange({ ...draft, docType: docType as ProfileInput['docType'] })} />
    <Field label="Document number *" value={draft.docNumber} onChangeText={(docNumber) => onChange({ ...draft, docNumber })} />
    <Field label="Birth date (YYYY-MM-DD) *" value={draft.birthDate} onChangeText={(birthDate) => onChange({ ...draft, birthDate })} />
    <Choice label="Blood group" value={draft.bloodType} options={Object.values(BLOOD_TYPES)} onChange={(bloodType) => onChange({ ...draft, bloodType: bloodType as ProfileInput['bloodType'] })} />
    <Choice label="Rh" value={draft.bloodRh} options={Object.values(BLOOD_RH)} onChange={(bloodRh) => onChange({ ...draft, bloodRh: bloodRh as ProfileInput['bloodRh'] })} />
    <Field label="Allergies (comma-separated)" value={list('allergies')} onChangeText={(value) => setList('allergies', value)} />
    <Field label="Chronic conditions (comma-separated)" value={list('chronicConditions')} onChangeText={(value) => setList('chronicConditions', value)} />
    <Field label="Medications (comma-separated)" value={list('medications')} onChangeText={(value) => setList('medications', value)} />
    <Choice label="Disability" value={draft.disability} options={Object.values(DISABILITIES)} onChange={(disability) => onChange({ ...draft, disability: disability as ProfileInput['disability'] })} />
    <View style={styles.switchRow}><Text>Pregnant</Text><Switch value={draft.isPregnant} onValueChange={(isPregnant) => onChange({ ...draft, isPregnant })} /></View>
    <Field label="Weight (kg)" value={draft.weightKg?.toString() ?? ''} keyboardType="number-pad" onChangeText={(value) => onChange({ ...draft, weightKg: value ? Number(value) : null })} />
    <Field label="EPS" value={draft.eps ?? ''} onChangeText={(eps) => onChange({ ...draft, eps: eps || null })} />
    <Field label="Emergency contact name" value={contact.name} onChangeText={(value) => setContact('name', value)} />
    <Field label="Emergency contact phone" value={contact.phone} keyboardType="phone-pad" onChangeText={(value) => setContact('phone', value)} />
    <Field label="Emergency contact relationship" value={contact.relationship} onChangeText={(value) => setContact('relationship', value)} />
    <Field label="Verification question ID *" value={draft.questionId} onChangeText={(questionId) => onChange({ ...draft, questionId })} />
    <Field label="Identity answer *" value={draft.identityAnswer ?? ''} secureTextEntry onChangeText={(identityAnswer) => onChange({ ...draft, identityAnswer })} />
    <Action label="Save private profile" onPress={onSave} />
  </ScrollView>;
}

interface FieldProps { label: string; value: string; placeholder?: string; keyboardType?: 'default' | 'decimal-pad' | 'number-pad' | 'phone-pad'; secureTextEntry?: boolean; onChangeText: (value: string) => void; }
function Field({ label, ...props }: FieldProps) { return <View><Text style={styles.label}>{label}</Text><TextInput style={styles.input} placeholder={props.placeholder} {...props} /></View>; }
interface ChoiceProps<T extends string> { label: string; value: T; options: readonly T[]; onChange: (value: T) => void; }
function Choice<T extends string>({ label, value, options, onChange }: ChoiceProps<T>) { return <View><Text style={styles.label}>{label}</Text><View style={styles.choices}>{options.map((option) => <Pressable key={option} style={[styles.choice, value === option && styles.choiceActive]} onPress={() => onChange(option)}><Text style={value === option ? styles.choiceTextActive : undefined}>{option}</Text></Pressable>)}</View></View>; }
interface ActionProps { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean; }
function Action({ label, onPress, disabled, secondary }: ActionProps) { return <Pressable style={[styles.action, secondary && styles.secondary, disabled && styles.disabled]} disabled={disabled} onPress={onPress}><Text style={[styles.actionText, secondary && styles.secondaryText]}>{label}</Text></Pressable>; }
interface TabButtonProps { label: string; active: boolean; onPress: () => void; }
function TabButton({ label, active, onPress }: TabButtonProps) { return <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}><Text style={active ? styles.tabTextActive : styles.tabText}>{label}</Text></Pressable>; }

function validateTelegram(draft: TelegramDraft): string | null { if (!draft.eventId.trim()) return 'Event identifier is required.'; if (!Number.isFinite(draft.location.lat) || draft.location.lat < -90 || draft.location.lat > 90) return 'Latitude must be between -90 and 90.'; if (!Number.isFinite(draft.location.lng) || draft.location.lng < -180 || draft.location.lng > 180) return 'Longitude must be between -180 and 180.'; return null; }
function validateProfile(profile: ProfileInput): string | null { if (!profile.userId.trim() || !profile.fullName.trim() || !profile.docNumber.trim() || !profile.birthDate.trim() || !profile.questionId.trim() || !profile.identityAnswer?.trim()) return 'User ID, name, document, birth date, verification question and identity answer are required.'; if (!/^\d{4}-\d{2}-\d{2}$/.test(profile.birthDate)) return 'Birth date must use YYYY-MM-DD.'; return null; }
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
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' }, header: { padding: 18, backgroundColor: '#102a43', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, brand: { color: 'white', fontSize: 28, fontWeight: '800' }, subtitle: { color: '#cbd5e1' }, fake: { color: '#fbbf24', fontWeight: '700', fontSize: 11 }, tabs: { flexDirection: 'row', backgroundColor: 'white' }, tab: { flex: 1, paddingVertical: 12, alignItems: 'center' }, tabActive: { borderBottomWidth: 3, borderBottomColor: '#0f766e' }, tabText: { color: '#64748b', fontSize: 11, fontWeight: '700' }, tabTextActive: { color: '#0f766e', fontSize: 11, fontWeight: '800' }, content: { padding: 16, gap: 12 }, heading: { fontSize: 21, fontWeight: '800', color: '#102a43' }, help: { color: '#475569', lineHeight: 20 }, statusCard: { backgroundColor: '#e0f2fe', padding: 14, borderRadius: 10, gap: 4 }, status: { fontSize: 18, fontWeight: '700' }, error: { color: '#b91c1c', paddingHorizontal: 16, paddingTop: 8 }, action: { backgroundColor: '#0f766e', padding: 14, borderRadius: 8 }, actionText: { color: 'white', fontWeight: '700', textAlign: 'center' }, secondary: { backgroundColor: 'white', borderColor: '#0f766e', borderWidth: 1 }, secondaryText: { color: '#0f766e' }, disabled: { opacity: 0.45 }, label: { fontWeight: '700', color: '#334155', marginBottom: 5 }, input: { backgroundColor: 'white', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 11 }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, choice: { padding: 8, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 16, backgroundColor: 'white' }, choiceActive: { backgroundColor: '#0f766e', borderColor: '#0f766e' }, choiceTextActive: { color: 'white', fontWeight: '700' }, telegramCard: { backgroundColor: 'white', padding: 13, borderRadius: 10, gap: 3, borderLeftWidth: 4, borderLeftColor: '#0f766e' }, cardTitle: { fontWeight: '800', fontSize: 16 }, delivery: { color: '#0369a1', fontWeight: '700' }, empty: { color: '#64748b', paddingVertical: 20 }, switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  receipt: { color: '#0369a1', fontWeight: '700' },
  diagnostics: { backgroundColor: '#f1f5f9', borderRadius: 8, padding: 12, gap: 4 },
  diagnosticTitle: { color: '#334155', fontWeight: '800' },
  diagnosticLine: { color: '#475569', fontSize: 12 },
  permissionText: { color: '#334155' },
  errorInline: { color: '#b91c1c' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: 'white', borderRadius: 14, padding: 20, gap: 14 },
});
