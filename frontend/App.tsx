import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Platform, Pressable, SafeAreaView, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { BLOOD_RH, BLOOD_TYPES, DISABILITIES, DOCUMENT_TYPES, type ProfileInput } from 'ziro-relay';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, Inter_900Black } from '@expo-google-fonts/inter';

import { HomeScreen } from './src/screens/HomeScreen';
import { ApiConfigurationError, getBuildApiBaseUrl, isBuildDemoTriggerEnabled, validateApiBaseUrl } from './src/api/apiConfiguration';
import { PrivateApi } from './src/api/privateApi';
import { createRelayClient, getNativeRelayConfigurationError } from './src/native/relayClient';
import { C, shared, F, SAFE_TOP } from './src/theme';

export default function App() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, Inter_900Black });

  const nativeRelayConfigurationError = getNativeRelayConfigurationError();
  if (nativeRelayConfigurationError) return <ConfigurationErrorScreen message={nativeRelayConfigurationError} />;

  if (!fontsLoaded) return <SafeAreaView style={[shared.screenBg, { justifyContent: 'center', alignItems: 'center' }]}><StatusBar style="light" /><ActivityIndicator color={C.accent} size="large" /></SafeAreaView>;

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
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registration, setRegistration] = useState<ProfileInput>(blankProfile());
  const api = useMemo(() => new PrivateApi(relay, baseUrl), [baseUrl, relay]);
  useEffect(() => { const override = relay.getApiBaseUrl(); if (override) { try { setBaseUrl(validateApiBaseUrl(override, 'Saved API base URL')); } catch { relay.saveApiBaseUrl(buildApiBaseUrl); } } }, [buildApiBaseUrl, relay]);
  useEffect(() => { void (async () => { try { const restored = await api.restoreProfile(); if (restored) { await relay.saveProfile(restored); setProfile(restored); } } catch (error) { setSessionError(error instanceof Error ? error.message : 'Unable to restore session.'); } finally { setLoading(false); } })(); }, [api, relay]);
  const authenticate = async () => {
    try { const next = await api.login(login.docType, login.docNumber, login.password); await relay.saveProfile(next); Alert.alert('Welcome back!', 'Session started.'); setProfile(next); } catch (error) { Alert.alert('Login failed', error instanceof Error ? error.message : 'Unknown error'); }
  };
  const syncOutbox = async () => {
    await relay.scheduleGatewaySync();
    setEmergencyStatus('Native gateway sync scheduled.');
  };
  const emergencyActivated = useRef(false);
  const reconcileActiveEvents = async () => {
    if (emergencyActivated.current) return;
    const events = await api.activeEvents();
    const event = events.at(0);
    if (!event) return;
    emergencyActivated.current = true;
    setEmergencyStatus(`Event detected: ${event.eventId} revision ${event.revision}.`);
    try { await relay.activateEmergency({ eventId: event.eventId, event: event.event, revision: event.revision }); } catch { /* native relay may not be available */ }
    try { await relay.start(); } catch { /* auto-start relay on emergency */ }
    setEmergencyStatus('Relay active; durable emergency outbox created.');
    try { await syncOutbox(); } catch { /* gateway sync optional */ }
  };
  useEffect(() => {
    if (!profile) return;
    let active = true;
    const reconcile = () => { if (active && AppState.currentState === 'active') void reconcileActiveEvents().catch((error: unknown) => active && setEmergencyStatus(`Emergency activation error: ${error instanceof Error ? error.message : 'unknown error'}`)); };
    reconcile();
    const interval = setInterval(reconcile, 5_000);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') reconcile(); });
    return () => { active = false; clearInterval(interval); subscription.remove(); };
  }, [api, profile, relay]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const register = async () => { const filled = { ...registration, allergies: registration.allergies.length > 0 ? registration.allergies : ['none'], chronicConditions: registration.chronicConditions.length > 0 ? registration.chronicConditions : ['none'], medications: registration.medications.length > 0 ? registration.medications : ['none'] }; const errors = validateRegistration(filled, login.password); setFieldErrors(errors); if (Object.keys(errors).length > 0) return; try { const next = await api.register(filled, login.password); await relay.saveProfile(next); Alert.alert('Account created', 'Welcome to Replica!'); setProfile(next); } catch (error) { const msg = error instanceof Error ? error.message : 'Registration failed.'; setSessionError(msg); Alert.alert('Registration failed', msg); } };
  const logout = async () => { await api.logout(); setProfile(null); setLogin({ docType: 'CC', docNumber: '', password: '' }); setSessionError(null); };
  const triggerDemo = async () => {
    activationKey.current ??= createIdempotencyKey();
    try {
      setEmergencyStatus('Trigger requested.');
      const event = await api.activateDemoEvent(activationKey.current);
      emergencyActivated.current = true;
      setEmergencyStatus(`Event detected: ${event.eventId} revision ${event.revision}.`);
      try { await relay.activateEmergency({ eventId: event.eventId, event: event.event, revision: event.revision }); } catch { /* native relay may not be available in demo */ }
      try { await relay.start(); } catch { /* auto-start relay on emergency */ }
      setEmergencyStatus('Relay active; durable emergency outbox created.');
      try { await syncOutbox(); } catch { /* gateway sync optional in demo */ }
    } catch (error) {
      setEmergencyStatus(`Trigger error: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  };
  const saveUrl = () => { try { const validBaseUrl = validateApiBaseUrl(baseUrlInput, 'API base URL'); relay.saveApiBaseUrl(validBaseUrl); setBaseUrl(validBaseUrl); setBaseUrlInput(validBaseUrl); Alert.alert('Saved', 'The API URL is stored locally (not as a secret). The build-time environment URL is used again when the app restarts.'); } catch (error) { Alert.alert('Invalid URL', error instanceof Error ? error.message : 'Use http:// or https://'); } };
  const saveProfile = async (next: ProfileInput) => { const saved = await api.saveProfile(next); await relay.saveProfile(saved); setProfile(saved); };

  if (loading) {
    return (
      <SafeAreaView style={[shared.screenBg, { justifyContent: 'center', alignItems: 'center', paddingTop: SAFE_TOP }]}>
        <StatusBar style="light" />
        <Text style={[shared.text, { textAlign: 'center', margin: 24 }]}>Restoring secure session…</Text>
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={[shared.screenBg, { backgroundColor: C.bg, paddingTop: SAFE_TOP }]}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 28, paddingTop: 48, paddingBottom: 56, gap: 0 }} style={{ backgroundColor: C.bg }}>

          {/* Brand area */}
          <View style={{ alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Text style={{ fontFamily: F.black, color: C.text, fontSize: 44, letterSpacing: 8, textTransform: 'uppercase' }}>REPLICA</Text>
            <View style={{ width: '80%', height: 1, backgroundColor: C.cardBorder }} />
            <Text style={{ fontFamily: F.semibold, color: C.accent, fontSize: 12, letterSpacing: 3, textTransform: 'uppercase' }}>Emergency Network</Text>
            <Text style={{ fontFamily: F.regular, color: C.textSecondary, fontSize: 16, lineHeight: 24, textAlign: 'center' }}>
              {'The information survives\neven when the network doesn\'t.'}
            </Text>
          </View>

          {sessionError ? <Text style={[shared.error, { marginBottom: 12, textAlign: 'center' }]}>{sessionError}</Text> : null}

          {registering ? (
            <View style={{ gap: 20, marginTop: 24 }}>
              <RegistrationForm
                profile={registration}
                onChange={setRegistration}
                password={login.password}
                onPasswordChange={(password) => setLogin({ ...login, password })}
                onRegister={() => void register()}
                errors={fieldErrors}
              />
            </View>
          ) : (
            /* Login form — directly on dark background, no card wrapper */
            <View style={{ gap: 20, marginTop: 40 }}>

              <Field label="Document Type">
                <View style={shared.chips}>
                  {Object.values(DOCUMENT_TYPES).map((opt) => (
                    <Pressable
                      key={opt}
                      style={[shared.chip, login.docType === opt && shared.chipActive]}
                      onPress={() => setLogin({ ...login, docType: opt as ProfileInput['docType'] })}
                    >
                      <Text style={login.docType === opt ? shared.chipTextActive : shared.chipText}>{opt}</Text>
                    </Pressable>
                  ))}
                </View>
              </Field>

              <Field label="Document Number">
                <TextInput
                  style={shared.input}
                  value={login.docNumber}
                  onChangeText={(docNumber) => setLogin({ ...login, docNumber })}
                  keyboardType="numeric"
                  placeholderTextColor={C.textMuted}
                  placeholder="Enter your document number"
                />
              </Field>

              <Field label="Password">
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <TextInput
                    style={[shared.input, { flex: 1 }]}
                    value={login.password}
                    secureTextEntry={!showLoginPassword}
                    onChangeText={(password) => setLogin({ ...login, password })}
                    placeholderTextColor={C.textMuted}
                    placeholder="••••••••••••"
                  />
                  <Pressable onPress={() => setShowLoginPassword(!showLoginPassword)} style={{ paddingHorizontal: 10 }}>
                    <Ionicons name={showLoginPassword ? 'eye' : 'lock-closed'} size={20} color={C.textMuted} />
                  </Pressable>
                </View>
              </Field>

              {/* SIGN IN — outlined premium button */}
              <Pressable
                style={{
                  backgroundColor: '#1a1a1a',
                  borderWidth: 1,
                  borderColor: C.accent,
                  paddingVertical: 18,
                  borderRadius: 10,
                  alignItems: 'center',
                  marginTop: 4,
                }}
                onPress={() => void authenticate()}
              >
                <Text style={{ fontFamily: F.bold, color: C.text, fontSize: 14, letterSpacing: 2, textTransform: 'uppercase' }}>Sign In</Text>
              </Pressable>

              {/* or divider */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1, height: 1, backgroundColor: C.cardBorder }} />
                <Text style={{ color: C.textMuted, fontFamily: F.regular, fontSize: 13 }}>or</Text>
                <View style={{ flex: 1, height: 1, backgroundColor: C.cardBorder }} />
              </View>

              {/* Create profile — outlined subtle button */}
              <Pressable
                style={{
                  backgroundColor: 'transparent',
                  borderWidth: 1,
                  borderColor: C.cardBorder,
                  paddingVertical: 18,
                  borderRadius: 10,
                  alignItems: 'center',
                }}
                onPress={() => setRegistering(true)}
              >
                <Text style={{ fontFamily: F.semibold, color: C.textSecondary, fontSize: 14, letterSpacing: 0.5 }}>Create private profile</Text>
              </Pressable>
            </View>
          )}

          {/* Back to login when in registration mode */}
          {registering ? (
            <Pressable style={{ alignItems: 'center', paddingVertical: 16, marginTop: 8 }} onPress={() => setRegistering(false)}>
              <Text style={{ fontFamily: F.semibold, color: C.accent, fontSize: 13, letterSpacing: 0.5 }}>I already have an account</Text>
            </Pressable>
          ) : null}

          {/* API URL — collapsible section at the bottom */}
          <ApiUrlConfig baseUrlInput={baseUrlInput} onChangeText={setBaseUrlInput} onSave={saveUrl} />

          <Text style={{ fontFamily: F.regular, color: C.textMuted, fontSize: 11, textAlign: 'center', marginTop: 8 }}>
            Android development or release build required.
          </Text>

        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[shared.screenBg, { backgroundColor: C.bg, paddingTop: SAFE_TOP }]}>
      <StatusBar style="light" />
      <HomeScreen
        onProfileSave={saveProfile}
        onLogout={logout}
        api={api}
        showDemoTrigger={isBuildDemoTriggerEnabled()}
        emergencyStatus={emergencyStatus}
        onTriggerDemo={() => void triggerDemo()}
      />
    </SafeAreaView>
  );
}

function ConfigurationErrorScreen({ message }: { message: string }) {
  return (
    <SafeAreaView style={[shared.screenBg, { justifyContent: 'center', paddingTop: SAFE_TOP }]}>
      <StatusBar style="light" />
      <View style={{ padding: 24, gap: 16 }}>
        <Text style={{ fontFamily: F.extrabold, color: C.text, fontSize: 22 }}>Configuration required</Text>
        <Text style={shared.error}>{message}</Text>
        <Text style={shared.textSecondary}>
          No simulated relay, profile, session, peer, ledger, or Telegram data is available in this build.
        </Text>
      </View>
    </SafeAreaView>
  );
}

/** Labeled wrapper for form fields */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[shared.label, { fontFamily: F.regular }]}>{label}</Text>
      {children}
    </View>
  );
}

/** Collapsible API URL configuration — shown at the bottom of the login screen */
function ApiUrlConfig({
  baseUrlInput,
  onChangeText,
  onSave,
}: {
  baseUrlInput: string;
  onChangeText: (value: string) => void;
  onSave: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={{ marginTop: 24, gap: 10 }}>
      <Pressable
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8 }}
        onPress={() => setExpanded(!expanded)}
      >
        <Text style={{ fontFamily: F.regular, color: C.textMuted, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>
          API Server {expanded ? '▲' : '▼'}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={{ gap: 10 }}>
          <TextInput
            style={shared.input}
            value={baseUrlInput}
            onChangeText={onChangeText}
            autoCapitalize="none"
            placeholder="https://api.example.com"
            placeholderTextColor={C.textMuted}
          />
          <Pressable style={shared.btnSecondary} onPress={onSave}>
            <Text style={shared.btnSecondaryText}>Save API URL</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <Text style={{ fontFamily: F.medium, color: C.error, fontSize: 12, marginTop: 2 }}>{message}</Text>;
}

function RegistrationForm({
  profile,
  onChange,
  password,
  onPasswordChange,
  onRegister,
  errors,
}: {
  profile: ProfileInput;
  onChange: (profile: ProfileInput) => void;
  password: string;
  onPasswordChange: (password: string) => void;
  onRegister: () => void;
  errors: FieldErrors;
}) {
  const [showIdentityAnswer, setShowIdentityAnswer] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const contact = profile.emergencyContacts[0];

  const errorBorder = { borderColor: C.error, borderWidth: 1.5 };

  const textField = (
    label: string,
    key: 'fullName' | 'docNumber' | 'questionId' | 'identityAnswer',
    opts?: { placeholder?: string; secure?: boolean },
  ) => (
    <Field key={key} label={label}>
      <TextInput
        style={[shared.input, errors[key] && errorBorder]}
        value={profile[key] ?? ''}
        onChangeText={(value) => onChange({ ...profile, [key]: value })}
        secureTextEntry={opts?.secure ?? key === 'identityAnswer'}
        placeholder={opts?.placeholder}
        placeholderTextColor={C.textMuted}
      />
      <FieldError message={errors[key]} />
    </Field>
  );

  const listField = (label: string, key: 'allergies' | 'chronicConditions' | 'medications') => (
    <Field key={key} label={label}>
      <TextInput
        style={[shared.input, errors[key] && errorBorder]}
        value={profile[key].join(', ')}
        onChangeText={(value) =>
          onChange({ ...profile, [key]: value.split(',').map((item) => item.trim()).filter(Boolean) })
        }
        placeholder="Optional — separate with commas"
        placeholderTextColor={C.textMuted}
      />
      <FieldError message={errors[key]} />
    </Field>
  );

  return (
    <>
      {/* IDENTITY */}
      <View style={shared.card}>
        <Text style={[shared.label, { marginBottom: 4 }]}>Identity</Text>

        {textField('Full name *', 'fullName')}

        <Field label="Document type *">
          <View style={[shared.chips, errors.docType && { borderWidth: 1.5, borderColor: C.error, borderRadius: 12, padding: 6 }]}>
            {Object.values(DOCUMENT_TYPES).map((opt) => (
              <Pressable
                key={opt}
                style={[shared.chip, profile.docType === opt && shared.chipActive]}
                onPress={() => onChange({ ...profile, docType: opt as ProfileInput['docType'] })}
              >
                <Text style={profile.docType === opt ? shared.chipTextActive : shared.chipText}>{opt}</Text>
              </Pressable>
            ))}
          </View>
          <FieldError message={errors.docType} />
        </Field>

        {textField('Document number *', 'docNumber')}
        <Field label="Birth date *">
          <Pressable onPress={() => setShowDatePicker(true)} style={[shared.input, errors.birthDate && errorBorder]}>
            <Text style={{ color: profile.birthDate ? C.text : C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 15 }}>
              {profile.birthDate || 'Select date'}
            </Text>
          </Pressable>
          {showDatePicker && (
            <DateTimePicker
              value={profile.birthDate ? new Date(profile.birthDate + 'T00:00:00') : new Date(2000, 0, 1)}
              mode="date"
              maximumDate={new Date(Date.now() - 86400000)}
              onChange={(_, date) => {
                setShowDatePicker(Platform.OS === 'ios');
                if (date) {
                  const y = date.getFullYear();
                  const m = String(date.getMonth() + 1).padStart(2, '0');
                  const d = String(date.getDate()).padStart(2, '0');
                  onChange({ ...profile, birthDate: `${y}-${m}-${d}` });
                }
              }}
            />
          )}
          <FieldError message={errors.birthDate} />
        </Field>
      </View>

      <View style={shared.divider} />

      {/* MEDICAL */}
      <View style={shared.card}>
        <Text style={[shared.label, { marginBottom: 4 }]}>Medical</Text>

        <Field label="Blood group *">
          <View style={[shared.chips, errors.bloodType && { borderWidth: 1.5, borderColor: C.error, borderRadius: 12, padding: 6 }]}>
            {Object.values(BLOOD_TYPES).map((opt) => (
              <Pressable
                key={opt}
                style={[shared.chip, profile.bloodType === opt && shared.chipActive]}
                onPress={() => onChange({ ...profile, bloodType: opt as ProfileInput['bloodType'] })}
              >
                <Text style={profile.bloodType === opt ? shared.chipTextActive : shared.chipText}>{opt}</Text>
              </Pressable>
            ))}
          </View>
          <FieldError message={errors.bloodType} />
        </Field>

        <Field label="Rh factor *">
          <View style={[shared.chips, errors.bloodRh && { borderWidth: 1.5, borderColor: C.error, borderRadius: 12, padding: 6 }]}>
            {Object.values(BLOOD_RH).map((opt) => (
              <Pressable
                key={opt}
                style={[shared.chip, profile.bloodRh === opt && shared.chipActive]}
                onPress={() => onChange({ ...profile, bloodRh: opt as ProfileInput['bloodRh'] })}
              >
                <Text style={profile.bloodRh === opt ? shared.chipTextActive : shared.chipText}>{enumLabel(opt)}</Text>
              </Pressable>
            ))}
          </View>
          <FieldError message={errors.bloodRh} />
        </Field>

        {listField('Allergies *', 'allergies')}
        {listField('Chronic conditions *', 'chronicConditions')}
        {listField('Medications *', 'medications')}

        <Field label="Disability *">
          <View style={[shared.chips, errors.disability && { borderWidth: 1.5, borderColor: C.error, borderRadius: 12, padding: 6 }]}>
            {Object.values(DISABILITIES).map((opt) => (
              <Pressable
                key={opt}
                style={[shared.chip, profile.disability === opt && shared.chipActive]}
                onPress={() => onChange({ ...profile, disability: opt as ProfileInput['disability'] })}
              >
                <Text style={profile.disability === opt ? shared.chipTextActive : shared.chipText}>{enumLabel(opt)}</Text>
              </Pressable>
            ))}
          </View>
          <FieldError message={errors.disability} />
        </Field>

        <Field label="Weight (kg)">
          <TextInput
            style={shared.input}
            value={profile.weightKg != null ? String(profile.weightKg) : ''}
            onChangeText={(value) => {
              const num = parseInt(value, 10);
              onChange({ ...profile, weightKg: isNaN(num) ? null : num });
            }}
            keyboardType="numeric"
            placeholder="Optional"
            placeholderTextColor={C.textMuted}
          />
        </Field>

        <View style={shared.switchRow}>
          <Text style={shared.text}>Pregnant *</Text>
          <Switch
            value={profile.isPregnant}
            onValueChange={(isPregnant) => onChange({ ...profile, isPregnant })}
            trackColor={{ false: C.inputBorder, true: C.accent }}
            thumbColor={profile.isPregnant ? C.bg : C.textSecondary}
          />
        </View>
      </View>

      <View style={shared.divider} />

      {/* EMERGENCY CONTACT */}
      <View style={shared.card}>
        <Text style={[shared.label, { marginBottom: 4 }]}>Emergency contact</Text>

        <Field label="Name *">
          <TextInput
            style={[shared.input, errors.contactName && errorBorder]}
            value={contact.name}
            onChangeText={(name) => onChange({ ...profile, emergencyContacts: [{ ...contact, name }] })}
            placeholderTextColor={C.textMuted}
            placeholder="Full name"
          />
          <FieldError message={errors.contactName} />
        </Field>

        <Field label="Phone *">
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={[shared.input, { paddingHorizontal: 10, justifyContent: 'center', marginRight: 0, borderTopRightRadius: 0, borderBottomRightRadius: 0 }, errors.contactPhone && errorBorder]}>
              <Text style={{ color: C.text, fontFamily: 'Inter_400Regular' }}>+57</Text>
            </View>
            <TextInput
              style={[shared.input, { flex: 1, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }, errors.contactPhone && errorBorder]}
              value={contact.phone.startsWith('+57') ? contact.phone.slice(3) : contact.phone}
              onChangeText={(val) => onChange({ ...profile, emergencyContacts: [{ ...contact, phone: val ? `+57${val}` : '' }] })}
              keyboardType="phone-pad"
              placeholderTextColor={C.textMuted}
              placeholder="3001234567"
            />
          </View>
          <FieldError message={errors.contactPhone} />
        </Field>

        <Field label="Relationship *">
          <TextInput
            style={[shared.input, errors.contactRelationship && errorBorder]}
            value={contact.relationship}
            onChangeText={(relationship) => onChange({ ...profile, emergencyContacts: [{ ...contact, relationship }] })}
            placeholderTextColor={C.textMuted}
            placeholder="e.g. Mother, Spouse"
          />
          <FieldError message={errors.contactRelationship} />
        </Field>
      </View>

      <View style={shared.divider} />

      {/* SECURITY */}
      <View style={shared.card}>
        <Text style={[shared.label, { marginBottom: 4 }]}>Security</Text>

        {textField('Verification question ID *', 'questionId', { placeholder: 'Question identifier' })}

        <Field label="SAFE answer *">
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TextInput
              style={[shared.input, { flex: 1 }, errors.identityAnswer && errorBorder]}
              value={profile.identityAnswer ?? ''}
              onChangeText={(value) => onChange({ ...profile, identityAnswer: value })}
              secureTextEntry={!showIdentityAnswer}
              placeholder="••••••••"
              placeholderTextColor={C.textMuted}
            />
            <Pressable onPress={() => setShowIdentityAnswer(!showIdentityAnswer)} style={{ paddingHorizontal: 10 }}>
              <Ionicons name={showIdentityAnswer ? 'eye' : 'lock-closed'} size={20} color={C.textMuted} />
            </Pressable>
          </View>
          <FieldError message={errors.identityAnswer} />
        </Field>

        <Field label="Password (8+ characters) *">
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TextInput
              style={[shared.input, { flex: 1 }, errors.password && errorBorder]}
              value={password}
              onChangeText={onPasswordChange}
              secureTextEntry={!showPassword}
              placeholderTextColor={C.textMuted}
              placeholder="••••••••••••"
            />
            <Pressable onPress={() => setShowPassword(!showPassword)} style={{ paddingHorizontal: 10 }}>
              <Ionicons name={showPassword ? 'eye' : 'lock-closed'} size={20} color={C.textMuted} />
            </Pressable>
          </View>
          <FieldError message={errors.password} />
        </Field>
      </View>

      <Pressable style={shared.btnPrimary} onPress={onRegister}>
        <Text style={shared.btnPrimaryText}>Register profile and device key</Text>
      </Pressable>
    </>
  );
}

function createIdempotencyKey(): string {
  const random = Math.random().toString(16).slice(2);
  return `${Date.now().toString(16)}-${random}`;
}

function blankProfile(): ProfileInput {
  return {
    userId: 'pending-registration',
    fullName: '',
    docType: '' as ProfileInput['docType'],
    docNumber: '',
    birthDate: '',
    bloodType: '' as ProfileInput['bloodType'],
    bloodRh: '' as ProfileInput['bloodRh'],
    allergies: [],
    chronicConditions: [],
    medications: [],
    disability: '' as ProfileInput['disability'],
    isPregnant: false,
    weightKg: null,
    eps: null,
    emergencyContacts: [{ name: '', phone: '', relationship: '' }],
    questionId: '',
    identityAnswer: '',
  };
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

type FieldErrors = Record<string, string>;

function validateRegistration(profile: ProfileInput, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!profile.fullName.trim()) errors.fullName = 'Required';
  if (!Object.values(DOCUMENT_TYPES).includes(profile.docType)) errors.docType = 'Select one';
  if (!profile.docNumber.trim()) errors.docNumber = 'Required';
  if (!profile.birthDate.trim()) errors.birthDate = 'Required';
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(profile.birthDate)) errors.birthDate = 'Use YYYY-MM-DD';
  if (!Object.values(BLOOD_TYPES).includes(profile.bloodType)) errors.bloodType = 'Select one';
  if (!Object.values(BLOOD_RH).includes(profile.bloodRh)) errors.bloodRh = 'Select one';
  if (!Object.values(DISABILITIES).includes(profile.disability)) errors.disability = 'Select one';
  // Empty lists auto-fill with "none" — no validation error needed
  if (!profile.questionId?.trim()) errors.questionId = 'Required';
  if (!profile.identityAnswer?.trim()) errors.identityAnswer = 'Required';
  if (password.length < 8) errors.password = 'At least 8 characters';
  const contact = profile.emergencyContacts[0];
  if (!contact?.name.trim()) errors.contactName = 'Required';
  if (!contact?.phone.trim()) errors.contactPhone = 'Required';
  if (!contact?.relationship.trim()) errors.contactRelationship = 'Required';
  return errors;
}
