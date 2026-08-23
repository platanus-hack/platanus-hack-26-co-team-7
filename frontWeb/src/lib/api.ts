import { API_BASE_URL } from "./constants";
import type { EventAlert, HeatmapResponse, PersonsResponse, ReportsResponse } from "./types";

/**
 * Typed fetches against the readonly public API
 * (backend/app/routers). Any network/HTTP failure rejects — callers decide
 * between empty states, retry UI or embedded fallback data.
 */

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export function fetchHeatmap(): Promise<HeatmapResponse> {
  return getJson<HeatmapResponse>("/api/v1/heatmap");
}

export function fetchPersons(): Promise<PersonsResponse> {
  return getJson<PersonsResponse>("/api/v1/persons");
}

export function fetchReports(): Promise<ReportsResponse> {
  return getJson<ReportsResponse>("/api/v1/reports");
}

/**
 * Stands in for the EMSC/SGC pollers during a demo: the backend rebuilds the
 * demo event and broadcasts EVENT_OPENED, so every connected dashboard reacts
 * exactly as it would for a real quake. Rejects when the trigger is disabled
 * (404) or the backend is unreachable — the caller decides what to show.
 */
export async function triggerDemoEvent(): Promise<EventAlert> {
  const res = await fetch(`${API_BASE_URL}/api/v1/demo/trigger`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`POST /api/v1/demo/trigger failed: ${res.status}`);
  }
  const data = (await res.json()) as { event_id: string; mag: number; place: string };
  return { event_id: data.event_id, mag: data.mag, place: data.place };
}

/**
 * Closes the demo event opened by triggerDemoEvent, mirroring it in reverse.
 * Rejects when the trigger is disabled (404) or the backend is unreachable.
 */
export async function stopDemoEvent(): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/v1/demo/stop`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`POST /api/v1/demo/stop failed: ${res.status}`);
  }
}
