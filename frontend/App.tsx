import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Pressable, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { BLOOD_RH, BLOOD_TYPES, DISABILITIES, DOCUMENT_TYPES, type ProfileInput } from 'ziro-relay';

import { HomeScreen } from './src/screens/HomeScreen';
import { ApiConfigurationError, getBuildApiBaseUrl, isBuildDemoTriggerEnabled, validateApiBaseUrl } from './src/api/apiConfiguration';
import { PrivateApi } from './src/api/privateApi';
import { createRelayClient, getNativeRelayConfigurationError } from './src/native/relayClient';

export default function App() {
  const nativeRelayConfigurationError = getNativeRelayConfigurationError();
  if (nativeRelayConfigurationError) return <ConfigurationErrorScreen message={nativeRelayConfigurationError} />;

  try {
    return <ConfiguredApp apiBaseUrl={getBuildApiBaseUrl()} />;
  } catch (error) {
    return <ConfigurationErrorScreen message={error instanceof ApiConfigurationError ? error.message : 'Unable to read API configuration.'} />;
  }
}

function ConfiguredApp({ apiBaseUrl: buildApiBaseUrl }: { apiBaseUrl: string }) {
  const relay = useMemo(() => createRelayClient(), []);
  const [baseUrl, setBaseUrl] = useState(buildApiBaseUrl);
  const [baseUrlInput, setBaseUrlInput] = useState(buildApiBaseUrl);
  const [profile, setProfile] = useState<ProfileInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [emergencyStatus, setEmergencyStatus] = useState('Waiting for an active event.');
  const activationKey = useRef<string | null>(null);
  const [login, setLogin] = useState({ docType: 'CC' as ProfileInput['docType'], docNumber: '', password: '' });
  const [registering, setRegistering] = useState(false);
  const [registration, setRegistration] = useState<ProfileInput>(blankProfile());
  const api = useMemo(() => new PrivateApi(relay, baseUrl), [baseUrl, relay]);
  useEffect(() => { const override = relay.getApiBaseUrl(); if (override) { try { setBaseUrl(validateApiBaseUrl(override, 'Saved API base URL')); } catch { relay.saveApiBaseUrl(buildApiBaseUrl); } } }, [buildApiBaseUrl, relay]);
  useEffect(() => { void (async () => { try { const restored = await api.restoreProfile(); if (restored) { await relay.saveProfile(restored); setProfile(restored); } } catch (error) { setSessionError(error instanceof Error ? error.message : 'Unable to restore session.'); } finally { setLoading(false); } })(); }, [api, relay]);
  const authenticate = async () => {
    try { const next = await api.login(login.docType, login.docNumber, login.password); await relay.saveProfile(next); setProfile(next); } catch (error) { Alert.alert('Login failed', error instanceof Error ? error.message : 'Unknown error'); }
  };
  const syncOutbox = async () => {
    await relay.scheduleGatewaySync();
    setEmergencyStatus('Native gateway sync scheduled.');
  };
  const reconcileActiveEvents = async () => {
    const events = await api.activeEvents();
    const event = events.at(0);
    if (!event) return;
    setEmergencyStatus(`Event detected: ${event.eventId} revision ${event.revision}.`);
    await relay.activateEmergency({ eventId: event.eventId, event: event.event, revision: event.revision });
    setEmergencyStatus('Relay active; durable emergency outbox created.');
    await syncOutbox();
  };
  useEffect(() => {
    if (!profile) return;
    let active = true;
    const reconcile = () => { if (active && AppState.currentState === 'active') void reconcileActiveEvents().catch((error: unknown) => active && setEmergencyStatus(`Emergency activation error: ${error instanceof Error ? error.message : 'unknown error'}`)); };
    reconcile();
    const interval = setInterval(reconcile, 30_000);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') reconcile(); });
    return () => { active = false; clearInterval(interval); subscription.remove(); };
  }, [api, profile, relay]);
  const register = async () => { const validation = validateRegistration(registration, login.password); if (validation) return Alert.alert('Registration incomplete', validation); try { const next = await api.register(registration, login.password); await relay.saveProfile(next); setProfile(next); } catch (error) { setSessionError(error instanceof Error ? error.message : 'Registration failed.'); } };
  const logout = async () => { await api.logout(); setProfile(null); setLogin({ docType: 'CC', docNumber: '', password: '' }); setSessionError(null); };
  const triggerDemo = async () => {
    activationKey.current ??= createIdempotencyKey();
    try {
      setEmergencyStatus('Trigger requested.');
      const event = await api.activateDemoEvent(activationKey.current);
      setEmergencyStatus(`Trigger committed: ${event.eventId} revision ${event.revision}.`);
      await reconcileActiveEvents();
    } catch (error) {
      setEmergencyStatus(`Trigger error: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  };
  const saveUrl = () => { try { const validBaseUrl = validateApiBaseUrl(baseUrlInput, 'API base URL'); relay.saveApiBaseUrl(validBaseUrl); setBaseUrl(validBaseUrl); setBaseUrlInput(validBaseUrl); Alert.alert('Saved', 'The API URL is stored locally (not as a secret). The build-time environment URL is used again when the app restarts.'); } catch (error) { Alert.alert('Invalid URL', error instanceof Error ? error.message : 'Use http:// or https://'); } };
  const saveProfile = async (next: ProfileInput) => { const saved = await api.saveProfile(next); await relay.saveProfile(saved); setProfile(saved); };
  if (loading) return <SafeAreaView style={styles.root}><Text style={styles.loading}>Restoring secure session…</Text></SafeAreaView>;
  if (!profile) return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.auth}><Text style={styles.title}>Replica private access</Text>{sessionError ? <Text style={styles.error}>{sessionError}</Text> : null}<Text>API base URL</Text><TextInput style={styles.input} value={baseUrlInput} onChangeText={setBaseUrlInput} autoCapitalize="none" placeholder="https://api.example.com" /><Pressable style={styles.button} onPress={saveUrl}><Text style={styles.buttonText}>Save API URL</Text></Pressable>{registering ? <RegistrationForm profile={registration} onChange={setRegistration} password={login.password} onPasswordChange={(password) => setLogin({ ...login, password })} onRegister={() => void register()} /> : <><Text>Document type</Text><TextInput style={styles.input} value={login.docType} onChangeText={(docType) => setLogin({ ...login, docType: docType as ProfileInput['docType'] })} /><Text>Document number</Text><TextInput style={styles.input} value={login.docNumber} onChangeText={(docNumber) => setLogin({ ...login, docNumber })} /><Text>Password</Text><TextInput style={styles.input} value={login.password} secureTextEntry onChangeText={(password) => setLogin({ ...login, password })} /><Pressable style={styles.button} onPress={() => void authenticate()}><Text style={styles.buttonText}>Login</Text></Pressable></>}<Pressable onPress={() => setRegistering(!registering)}><Text>{registering ? 'I already have an account' : 'Create private profile'}</Text></Pressable><Text style={styles.help}>Android development or release build required. Expo Go is unsupported.</Text></ScrollView></SafeAreaView>;
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="auto" />
      <HomeScreen onProfileSave={saveProfile} onLogout={logout} api={api} showDemoTrigger={isBuildDemoTriggerEnabled()} emergencyStatus={emergencyStatus} onTriggerDemo={() => void triggerDemo()} />
    </SafeAreaView>
  );
}

function ConfigurationErrorScreen({ message }: { message: string }) {
  return <SafeAreaView style={styles.root}><View style={styles.auth}><Text style={styles.title}>Configuration required</Text><Text style={styles.warning}>{message}</Text><Text style={styles.help}>No simulated relay, profile, session, peer, ledger, or Telegram data is available in this build.</Text></View></SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { margin: 24 },
  auth: { padding: 20, gap: 10 },
  title: { fontSize: 26, fontWeight: '800' },
  input: { borderWidth: 1, borderColor: '#94a3b8', padding: 10, borderRadius: 6 },
  button: { backgroundColor: '#0f766e', padding: 12, borderRadius: 6 },
  buttonText: { color: 'white', textAlign: 'center', fontWeight: '700' },
  warning: { color: '#b45309' },
  error: { color: '#b91c1c' },
  help: { color: '#475569' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});

function createIdempotencyKey(): string {
  const random = Math.random().toString(16).slice(2);
  return `${Date.now().toString(16)}-${random}`;
}

function blankProfile(): ProfileInput { return { userId: 'pending-registration', fullName: '', docType: '' as ProfileInput['docType'], docNumber: '', birthDate: '', bloodType: '' as ProfileInput['bloodType'], bloodRh: '' as ProfileInput['bloodRh'], allergies: [], chronicConditions: [], medications: [], disability: '' as ProfileInput['disability'], isPregnant: false, weightKg: null, eps: null, emergencyContacts: [{ name: '', phone: '', relationship: '' }], questionId: '', identityAnswer: '' }; }
function RegistrationForm({ profile, onChange, password, onPasswordChange, onRegister }: { profile: ProfileInput; onChange: (profile: ProfileInput) => void; password: string; onPasswordChange: (password: string) => void; onRegister: () => void }) { const field = (label: string, key: 'fullName' | 'docNumber' | 'birthDate' | 'questionId' | 'identityAnswer') => <View key={key}><Text>{label}</Text><TextInput style={styles.input} value={profile[key] ?? ''} onChangeText={(value) => onChange({ ...profile, [key]: value })} secureTextEntry={key === 'identityAnswer'} /></View>; const list = (label: string, key: 'allergies' | 'chronicConditions' | 'medications') => <View><Text>{label} (write “none” if none)</Text><TextInput style={styles.input} value={profile[key].join(', ')} onChangeText={(value) => onChange({ ...profile, [key]: value.split(',').map((item) => item.trim()).filter(Boolean) })} /></View>; const contact = profile.emergencyContacts[0]; return <>{field('Full name *', 'fullName')}<Text>Document type *</Text><TextInput style={styles.input} value={profile.docType} onChangeText={(value) => onChange({ ...profile, docType: value as ProfileInput['docType'] })} placeholder={Object.values(DOCUMENT_TYPES).join('/')} />{field('Document number *', 'docNumber')}{field('Birth date (YYYY-MM-DD) *', 'birthDate')}<Text>Blood group *</Text><TextInput style={styles.input} value={profile.bloodType} onChangeText={(value) => onChange({ ...profile, bloodType: value as ProfileInput['bloodType'] })} placeholder={Object.values(BLOOD_TYPES).join('/')} /><Text>Rh *</Text><TextInput style={styles.input} value={profile.bloodRh} onChangeText={(value) => onChange({ ...profile, bloodRh: value as ProfileInput['bloodRh'] })} placeholder={Object.values(BLOOD_RH).join('/')} />{list('Allergies *', 'allergies')}{list('Chronic conditions *', 'chronicConditions')}{list('Medication *', 'medications')}<Text>Disability *</Text><TextInput style={styles.input} value={profile.disability} onChangeText={(value) => onChange({ ...profile, disability: value as ProfileInput['disability'] })} placeholder={Object.values(DISABILITIES).join('/')} /><View style={styles.switchRow}><Text>Pregnant *</Text><Switch value={profile.isPregnant} onValueChange={(isPregnant) => onChange({ ...profile, isPregnant })} /></View><Text>Emergency contact name *</Text><TextInput style={styles.input} value={contact.name} onChangeText={(name) => onChange({ ...profile, emergencyContacts: [{ ...contact, name }] })} /><Text>Emergency contact phone *</Text><TextInput style={styles.input} value={contact.phone} onChangeText={(phone) => onChange({ ...profile, emergencyContacts: [{ ...contact, phone }] })} /><Text>Emergency contact relationship *</Text><TextInput style={styles.input} value={contact.relationship} onChangeText={(relationship) => onChange({ ...profile, emergencyContacts: [{ ...contact, relationship }] })} />{field('Verification question ID *', 'questionId')}{field('SAFE answer *', 'identityAnswer')}<Text>Password (12+ characters) *</Text><TextInput style={styles.input} value={password} onChangeText={onPasswordChange} secureTextEntry /><Pressable style={styles.button} onPress={onRegister}><Text style={styles.buttonText}>Register profile and device key</Text></Pressable></>; }
function validateRegistration(profile: ProfileInput, password: string): string | null { if (!profile.fullName.trim() || !profile.docNumber.trim() || !profile.birthDate.trim() || !profile.questionId.trim() || !profile.identityAnswer?.trim() || password.length < 12) return 'Complete all identity, SAFE answer, and password fields.'; if (!Object.values(DOCUMENT_TYPES).includes(profile.docType) || !Object.values(BLOOD_TYPES).includes(profile.bloodType) || !Object.values(BLOOD_RH).includes(profile.bloodRh) || !Object.values(DISABILITIES).includes(profile.disability)) return 'Select document, blood/Rh, and disability values explicitly.'; if (!/^\d{4}-\d{2}-\d{2}$/.test(profile.birthDate)) return 'Birth date must use YYYY-MM-DD.'; if (profile.allergies.length === 0 || profile.chronicConditions.length === 0 || profile.medications.length === 0) return 'Confirm allergies, conditions, and medication. Write “none” when applicable.'; const contact = profile.emergencyContacts[0]; if (!contact?.name.trim() || !contact.phone.trim() || !contact.relationship.trim()) return 'A complete emergency contact is required.'; return null; }
