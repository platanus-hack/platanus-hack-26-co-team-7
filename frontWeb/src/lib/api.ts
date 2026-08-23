import { API_BASE_URL } from "./constants";
import type { HeatmapResponse, ReportsResponse } from "./types";

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

export function fetchReports(): Promise<ReportsResponse> {
  return getJson<ReportsResponse>("/api/v1/reports");
}
