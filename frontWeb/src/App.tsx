import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { fetchHeatmap, fetchReports } from "./lib/api";
import { FALLBACK_CELLS, FALLBACK_REPORTS } from "./lib/fallbackData";
import type { HeatmapCell, Report } from "./lib/types";
import ReportFeed from "./components/ReportFeed";
import { useRealtime } from "./hooks/useRealtime";

// Map chunk is deferred (design D8): deck.gl + maplibre-gl load only here,
// after the shell (header + feed + states) has painted.
const MapView = lazy(() => import("./components/MapView"));

type DataMode = "loading" | "live" | "fallback";

export default function App() {
  const [cells, setCells] = useState<HeatmapCell[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [mode, setMode] = useState<DataMode>("loading");
  const [reloadKey, setReloadKey] = useState(0);

  const initialLoad = useCallback(async () => {
    setMode("loading");
    try {
      const [heatmap, reps] = await Promise.all([fetchHeatmap(), fetchReports()]);
      setCells(heatmap.cells); // may be empty → explicit empty state
      setReports(reps.reports);
      setMode("live");
    } catch {
      // Backend unreachable: embedded demo data keeps the dashboard alive.
      setCells(FALLBACK_CELLS);
      setReports(FALLBACK_REPORTS);
      setMode("fallback");
    }
  }, []);

  const refreshHeatmap = useCallback(async () => {
    try {
      const data = await fetchHeatmap();
      if (data.cells.length > 0) setCells(data.cells);
    } catch {
      /* keep last known cells */
    }
  }, []);

  const refreshReports = useCallback(async () => {
    try {
      const data = await fetchReports();
      if (data.reports.length > 0) setReports(data.reports);
    } catch {
      /* keep last known reports */
    }
  }, []);

  // Initial load of both endpoints; retried via the error-state button.
  useEffect(() => {
    void initialLoad();
  }, [initialLoad, reloadKey]);

  const wsConnected = useRealtime(refreshHeatmap, refreshReports);

  return (
    <div className="flex h-screen flex-col bg-slate-900 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-700 bg-slate-950 px-4 py-3">
        <h1 className="text-lg font-bold tracking-tight sm:text-xl">
          ZIRO — Estado del desastre
        </h1>
        <div className="flex items-center gap-2 text-xs sm:text-sm">
          {mode === "loading" && (
            <span className="rounded-full bg-slate-800 px-3 py-1 font-medium text-slate-300">
              Cargando…
            </span>
          )}
          {mode === "live" && (
            <>
              <span className="rounded-full bg-slate-800 px-3 py-1 font-medium text-slate-300">
                Datos en vivo
              </span>
              <span
                className={`rounded-full px-3 py-1 font-medium ${
                  wsConnected
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-amber-500/15 text-amber-400"
                }`}
              >
                {wsConnected ? "● En vivo" : "● Reconectando…"}
              </span>
            </>
          )}
          {mode === "fallback" && (
            <span className="rounded-full bg-amber-500/15 px-3 py-1 font-medium text-amber-400">
              Datos de demostración — backend no disponible
            </span>
          )}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="relative min-h-[50vh] flex-1">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                Cargando mapa…
              </div>
            }
          >
            <MapView cells={cells} />
          </Suspense>
          {mode === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/70 text-sm text-slate-300">
              Cargando datos del evento…
            </div>
          )}
          {mode === "fallback" && (
            <div className="absolute inset-x-0 top-0 flex justify-center p-2">
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                className="rounded-md border border-amber-500/40 bg-slate-950/90 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-slate-900"
              >
                Backend no disponible — reintentar conexión
              </button>
            </div>
          )}
          {mode === "live" && cells.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="rounded-lg bg-slate-950/85 px-4 py-2 text-sm text-slate-300">
                Aún no hay datos del evento.
              </p>
            </div>
          )}
        </section>

        <ReportFeed reports={reports} loading={mode === "loading"} />
      </main>
    </div>
  );
}
