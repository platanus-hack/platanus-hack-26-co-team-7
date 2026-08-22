import type { HeatmapCell, Report } from "./types";

/**
 * Embedded demo data (design D3 dataset shape, res-8 cells around Bogotá).
 * Used ONLY when the backend API is unreachable, so the map and feed always
 * render — e.g. a static deploy without the FastAPI process behind it.
 */

export const FALLBACK_CELLS: HeatmapCell[] = [
  // person_count = distinct personas en peligro por celda (no telegrams)
  { h3_index: "8866e09053fffff", intensity: 9.4, person_count: 8, centroid: { lat: 4.6, lng: -74.1 }, window_start: "2026-08-22T12:00:00Z" },
  { h3_index: "8866e092e3fffff", intensity: 8.8, person_count: 7, centroid: { lat: 4.615, lng: -74.075 }, window_start: "2026-08-22T12:00:00Z" },
  { h3_index: "8866e0922bfffff", intensity: 8.2, person_count: 6, centroid: { lat: 4.645, lng: -74.11 }, window_start: "2026-08-22T12:00:00Z" },
  { h3_index: "8866e09257fffff", intensity: 7.6, person_count: 6, centroid: { lat: 4.655, lng: -74.085 }, window_start: "2026-08-22T12:00:00Z" },
  { h3_index: "8866e4289dfffff", intensity: 7.1, person_count: 5, centroid: { lat: 4.7, lng: -74.06 }, window_start: "2026-08-22T12:00:00Z" },
  { h3_index: "8866e09023fffff", intensity: 6.9, person_count: 4, centroid: { lat: 4.59, lng: -74.14 }, window_start: "2026-08-22T12:00:00Z" },
  { h3_index: "8866e42d29fffff", intensity: 6.4, person_count: 5, centroid: { lat: 4.66, lng: -74.055 }, window_start: "2026-08-22T12:00:00Z" },
  { h3_index: "8866e42dedfffff", intensity: 5.5, person_count: 3, centroid: { lat: 4.63, lng: -74.03 }, window_start: "2026-08-22T12:00:00Z" },
  { h3_index: "8866e09265fffff", intensity: 5.2, person_count: 3, centroid: { lat: 4.67, lng: -74.13 }, window_start: "2026-08-22T12:00:00Z" },
  { h3_index: "8866e09155fffff", intensity: 4.8, person_count: 4, centroid: { lat: 4.61, lng: -74.17 }, window_start: "2026-08-22T12:00:00Z" },
  { h3_index: "8866e4293bfffff", intensity: 4.1, person_count: 2, centroid: { lat: 4.735, lng: -74.165 }, window_start: "2026-08-22T12:00:00Z" },
  { h3_index: "8866e46697fffff", intensity: 3.6, person_count: 2, centroid: { lat: 4.68, lng: -74.18 }, window_start: "2026-08-22T12:00:00Z" },
  { h3_index: "8866e429ddfffff", intensity: 2.9, person_count: 2, centroid: { lat: 4.72, lng: -74.12 }, window_start: "2026-08-22T12:00:00Z" },
  { h3_index: "8866e42c25fffff", intensity: 1.8, person_count: 1, centroid: { lat: 4.65, lng: -74.01 }, window_start: "2026-08-22T12:00:00Z" },
  { h3_index: "8866e42ab1fffff", intensity: 0.7, person_count: 1, centroid: { lat: 4.74, lng: -74.05 }, window_start: "2026-08-22T12:00:00Z" },
];

const fallbackContent = (
  title: string,
  summary: string,
  recommendations: string[],
  figures: Record<string, number>,
) => ({ version: 1, title, summary, recommendations, figures });

export const FALLBACK_REPORTS: Report[] = [
  {
    id: "00000000-0000-0000-0000-000000000003",
    event_id: "DEMO-EARTHQUAKE001",
    source: "MANUAL",
    generated_at: "2026-08-22T13:30:00Z",
    content: fallbackContent(
      "Reporte manual del coordinador — cierre parcial de zonas",
      "El coordinador marca la zona norte como estabilizada. Persisten focos de atención al sur-occidente; se recomienda mantener el evento abierto hasta su verificación.",
      ["Mantener el evento abierto hasta confirmar SAFE en los focos activos."],
      { cells_active: 15, people_helped: 51 },
    ),
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    event_id: "DEMO-EARTHQUAKE001",
    source: "SCHEDULED",
    generated_at: "2026-08-22T12:45:00Z",
    content: fallbackContent(
      "Evolución a los 45 minutos: focos activos y estabilización",
      "La intensidad decrece en la mayoría de celdas respecto a la primera ventana. Dos focos permanecen con conteo creciente de telegrams.",
      ["Redirigir brigadas a los dos focos con tendencia creciente.", "Confirmar estado SAFE de las personas marcadas NEED_HELP."],
      { cells_active: 15, people_helped: 34 },
    ),
  },
  {
    id: "00000000-0000-0000-0000-000000000001",
    event_id: "DEMO-EARTHQUAKE001",
    source: "SCHEDULED",
    generated_at: "2026-08-22T12:15:00Z",
    content: fallbackContent(
      "Sismo M5.6 en Bogotá — evaluación inicial",
      "Se registran múltiples reportes desde el centro de Bogotá. Las celdas con mayor intensidad se concentran alrededor del centro y la zona sur-occidental.",
      ["Priorizar la verificación de personas atrapadas en las celdas de intensidad alta.", "Mantener abiertos los corredores de evacuación hacia el norte."],
      { cells_active: 15, people_helped: 18 },
    ),
  },
];
