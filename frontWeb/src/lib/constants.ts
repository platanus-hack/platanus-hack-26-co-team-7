// H3 resolution used by the aggregator server-side (~500 m cells).
// Cites openspec/DECISIONS.md (dashboard-web design D1): single source of
// documentation lives there. NOTE (task 3.2): H3HexagonLayer consumes the
// `h3_index` string directly, so this constant has NO runtime use in the UI —
// it is kept only for D1 traceability.
export const H3_CELL_RESOLUTION = 8;

export const API_BASE_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8000";

export const WS_URL: string =
  (import.meta.env.VITE_WS_URL as string | undefined) ?? "ws://localhost:8000/ws";

/** OpenFreeMap style: open basemap, no API key required (design D8). */
export const MAP_STYLE_URL =
  "https://tiles.openfreemap.org/styles/liberty";
