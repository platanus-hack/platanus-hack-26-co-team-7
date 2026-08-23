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

// Direct download of the mobile APK, served as a static asset from
// frontWeb/public/replica.apk (Vite copies public/* to the site root, so it
// resolves to /replica.apk). Set VITE_APK_URL only to point at an
// externally-hosted build instead.
export const APK_DOWNLOAD_URL: string =
  (import.meta.env.VITE_APK_URL as string | undefined) ??
  `${import.meta.env.BASE_URL}replica.apk`;
