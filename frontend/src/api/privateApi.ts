import type { EventType, ProfileInput, SecureSession } from 'ziro-relay';

import type { RelayClient } from '../native/relayClient';
import { validateApiBaseUrl } from './apiConfiguration';

export interface ActiveEvent { eventId: string; event: EventType; occurredAt: string; revision: number; source: string | null; }
export interface PublicDashboardSummary { heatmapCells: number; reports: Array<{ title: string; summary: string }>; }
interface TokenResponse { access_token: string; refresh_token: string; expires_in: number; }
interface ApiProfile { user_id: string; full_name: string; doc_type: ProfileInput['docType']; doc_number: string; birth_date: string; blood_type: ProfileInput['bloodType']; blood_rh: ProfileInput['bloodRh']; allergies: string[]; chronic_conditions: string[]; medications: string[]; disability: ProfileInput['disability']; is_pregnant: boolean; weight_kg: number | null; eps: string | null; emergency_contacts: ProfileInput['emergencyContacts']; question_id: string; answer_hash: string; }

export class PrivateApi {
  private refreshPromise: Promise<SecureSession | null> | null = null;
  private readonly baseUrl: string;

  constructor(private readonly relay: RelayClient, baseUrl: string) {
    this.baseUrl = validateApiBaseUrl(baseUrl, 'API base URL');
  }
  async restoreProfile(): Promise<ProfileInput | null> { const session = await this.relay.loadSession(); if (!session) return null; try { return await this.profile(); } catch (error) { if (!isUnauthorized(error)) throw error; const refreshed = await this.refresh(); return refreshed ? this.profile() : null; } }
  async login(docType: ProfileInput['docType'], docNumber: string, password: string): Promise<ProfileInput> { await this.tokens('/auth/login', { doc_type: docType, doc_number: docNumber, password }); return this.profile(); }
  async register(profile: ProfileInput, password: string): Promise<ProfileInput> { const apiProfile = await this.profileBody(profile); const identity = this.relay.getDeviceIdentity(); await this.request('/auth/register', { method: 'POST', body: JSON.stringify({ ...apiProfile, password, device_identity: { key_id: identity.keyId, public_key: identity.publicKey, binding_proof: identity.bindingProof } }) }); return this.login(profile.docType, profile.docNumber, password); }
  async saveProfile(profile: ProfileInput): Promise<ProfileInput> { const result = await this.request<ApiProfile>('/profile', { method: 'PUT', body: JSON.stringify({ ...(await this.profileBody(profile)), device_identity: toApiDeviceIdentity(this.relay) }) }); return mapProfile(result); }
  async logout(): Promise<void> { const session = await this.relay.loadSession(); if (session) { try { await this.request('/auth/logout', { method: 'POST', body: JSON.stringify({ refresh_token: session.refreshToken }), authenticated: false }); } finally { await this.relay.clearSession(); } } }
  async publicDashboardSummary(): Promise<PublicDashboardSummary> {
    const publicBase = this.baseUrl.replace(/\/api\/v1\/private$/, '');
    const [heatmap, reports] = await Promise.all([
      fetch(`${publicBase}/api/v1/heatmap`).then(readPublicJson),
      fetch(`${publicBase}/api/v1/reports`).then(readPublicJson),
    ]);
    const cells = Array.isArray(heatmap.cells) ? heatmap.cells.length : 0;
    const publicReports = Array.isArray(reports.reports) ? reports.reports : [];
    return { heatmapCells: cells, reports: publicReports.map((report: unknown) => publicReport(report)).filter((report): report is { title: string; summary: string } => report !== null) };
  }
  async activeEvents(): Promise<ActiveEvent[]> { const events = await this.request<Array<{ event_id: string; event: EventType; occurred_at: string; activation_revision: number; activation_source: string | null }>>('/events/active'); return events.map((event) => ({ eventId: event.event_id, event: event.event, occurredAt: event.occurred_at, revision: event.activation_revision, source: event.activation_source })); }
  async activateDemoEvent(idempotencyKey: string): Promise<ActiveEvent> {
    const event = await this.request<{ event_id: string; event: EventType; activation_revision: number; activation_source: string }>('/demo/events/activate', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } });
    return { eventId: event.event_id, event: event.event, occurredAt: new Date().toISOString(), revision: event.activation_revision, source: event.activation_source };
  }
  private async profile(): Promise<ProfileInput> { return mapProfile(await this.request<ApiProfile>('/profile')); }
  private async tokens(path: string, body: unknown): Promise<void> { const response = await this.request<TokenResponse>(path, { method: 'POST', body: JSON.stringify(body), authenticated: false }); await this.relay.saveSession({ accessToken: response.access_token, refreshToken: response.refresh_token, expiresIn: response.expires_in }); }
  private async refresh(): Promise<SecureSession | null> { if (!this.refreshPromise) this.refreshPromise = (async () => { const current = await this.relay.loadSession(); if (!current) return null; try { await this.tokens('/auth/refresh', { refresh_token: current.refreshToken }); return this.relay.loadSession(); } catch { await this.relay.clearSession(); return null; } finally { this.refreshPromise = null; } })(); return this.refreshPromise; }
  private async profileBody(profile: ProfileInput): Promise<Omit<ApiProfile, 'user_id'>> { const answerHash = profile.identityAnswer ? this.relay.hashIdentityAnswer(profile.identityAnswer) : profile.answerHash; if (!answerHash) throw new Error('A SAFE answer is required when creating or changing the verification answer.'); return { full_name: profile.fullName, doc_type: profile.docType, doc_number: profile.docNumber, birth_date: profile.birthDate, blood_type: profile.bloodType, blood_rh: profile.bloodRh, allergies: profile.allergies, chronic_conditions: profile.chronicConditions, medications: profile.medications, disability: profile.disability, is_pregnant: profile.isPregnant, weight_kg: profile.weightKg, eps: profile.eps, emergency_contacts: profile.emergencyContacts, question_id: profile.questionId, answer_hash: answerHash }; }
  private async request<T>(path: string, init: RequestInit & { authenticated?: boolean } = {}): Promise<T> { const session = init.authenticated === false ? null : await this.relay.loadSession(); const response = await fetch(`${this.baseUrl}/api/v1/private${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}), ...init.headers } }); if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`); return response.status === 204 ? undefined as T : await response.json() as T; }
}

function mapProfile(profile: ApiProfile): ProfileInput { return { userId: profile.user_id, fullName: profile.full_name, docType: profile.doc_type, docNumber: profile.doc_number, birthDate: profile.birth_date, bloodType: profile.blood_type, bloodRh: profile.blood_rh, allergies: profile.allergies, chronicConditions: profile.chronic_conditions, medications: profile.medications, disability: profile.disability, isPregnant: profile.is_pregnant, weightKg: profile.weight_kg, eps: profile.eps, emergencyContacts: profile.emergency_contacts, questionId: profile.question_id, answerHash: profile.answer_hash }; }
function isUnauthorized(error: unknown): boolean { return error instanceof Error && error.message.startsWith('API 401:'); }
function toApiDeviceIdentity(relay: RelayClient): { key_id: string; public_key: string; binding_proof: string } { const identity = relay.getDeviceIdentity(); return { key_id: identity.keyId, public_key: identity.publicKey, binding_proof: identity.bindingProof }; }
async function readPublicJson(response: Response): Promise<Record<string, unknown>> { if (!response.ok) throw new Error(`Public dashboard ${response.status}.`); const value: unknown = await response.json(); if (typeof value !== 'object' || value === null) throw new Error('Public dashboard returned an invalid response.'); return value as Record<string, unknown>; }
function publicReport(value: unknown): { title: string; summary: string } | null { if (typeof value !== 'object' || value === null) return null; const report = value as Record<string, unknown>; const content = report.content; if (typeof content !== 'object' || content === null) return null; const parsed = content as Record<string, unknown>; return typeof parsed.title === 'string' && typeof parsed.summary === 'string' ? { title: parsed.title, summary: parsed.summary } : null; }
