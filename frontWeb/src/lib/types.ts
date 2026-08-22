/**
 * Mirror of the backend public dashboard contracts
 * (backend/app/schemas/dashboard.py). The report `content` field follows
 * schema v1 of design decision D2 — rendered defensively: a missing field
 * must never crash the UI.
 */

export interface Centroid {
  lat: number;
  lng: number;
}

export interface HeatmapCell {
  h3_index: string;
  intensity: number;
  person_count: number;
  centroid: Centroid;
  window_start: string;
}

export interface HeatmapResponse {
  event_id?: string | null;
  cells: HeatmapCell[];
}

/** Schema v1 (design D2). All fields optional at render time. */
export interface ReportContent {
  version?: number;
  title?: string;
  summary?: string;
  recommendations?: string[];
  figures?: Record<string, number>;
}

export interface Report {
  id: string;
  event_id: string;
  source: string;
  generated_at: string;
  content: ReportContent | null;
}

export interface ReportsResponse {
  event_id?: string | null;
  reports: Report[];
}
