import { Suspense, lazy } from "react";
import type { HeatmapCell, PersonMarker, Report } from "../lib/types";
import ReportFeed from "./ReportFeed";

// Map chunk is deferred (design D8): deck.gl + maplibre-gl load only here,
// after the shell (header + feed + states) has painted.
const MapView = lazy(() => import("./MapView"));

export type DataMode = "loading" | "live" | "fallback";

interface DashboardProps {
  cells: HeatmapCell[];
  persons: PersonMarker[];
  reports: Report[];
  mode: DataMode;
  wsConnected: boolean;
  clockLabel: string;
  onRetry: () => void;
  onBack: () => void;
}

export default function Dashboard({
  cells,
  persons,
  reports,
  mode,
  wsConnected,
  clockLabel,
  onRetry,
  onBack,
}: DashboardProps) {
  return (
    <div className="flex h-screen flex-col bg-void text-bone">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline bg-void px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Volver al inicio"
            className="flex h-9 w-9 items-center justify-center rounded-card border border-hairline text-ash-dim transition-colors hover:border-ash-dim hover:text-bone focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bone/60"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div>
            <p className="wordmark text-sm text-bone">Replica</p>
            <p className="label-mono mt-1 text-ash-dim">Estado del desastre</p>
          </div>
        </div>
        <div role="status" aria-live="polite" className="label-mono flex items-center gap-4">
          <time className="font-mono-figures hidden text-xs tabular-nums tracking-normal text-ash-dim sm:inline">
            {clockLabel}
          </time>
          {mode === "loading" && <span className="text-ash-dim">Cargando</span>}
          {mode === "live" && (
            <span className={`flex items-center gap-2 ${wsConnected ? "text-signal-safe" : "text-signal-help"}`}>
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  wsConnected ? "animate-breathe bg-signal-safe" : "animate-signal-blink bg-signal-help"
                }`}
              />
              {wsConnected ? "En vivo" : "Reconectando"}
            </span>
          )}
          {mode === "fallback" && (
            <span className="flex items-center gap-2 text-signal-help">
              <span className="h-1.5 w-1.5 rounded-full bg-signal-help" />
              Datos de demostración
            </span>
          )}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="relative min-h-[50vh] flex-1">
          <Suspense
            fallback={
              <div className="label-mono flex h-full items-center justify-center text-ash-dim">
                Cargando mapa
              </div>
            }
          >
            <MapView cells={cells} persons={persons} />
          </Suspense>
          {mode === "loading" && (
            <div className="label-mono absolute inset-0 flex flex-col items-center justify-center gap-4 bg-void/80 text-ash">
              <div className="h-5 w-5 animate-spin rounded-full border border-hairline border-t-signal-mesh" />
              Cargando datos del evento
            </div>
          )}
          {mode === "fallback" && (
            <div role="alert" className="absolute inset-x-0 top-0 flex justify-center p-3">
              <button
                type="button"
                onClick={onRetry}
                className="label-mono flex items-center gap-2 rounded-card border border-signal-help/50 bg-void/90 px-3 py-2.5 text-signal-help backdrop-blur-sm transition-colors hover:bg-signal-help/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal-help"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
                  <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Backend no disponible — reintentar
              </button>
            </div>
          )}
          {mode === "live" && cells.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="label-mono flex items-center gap-2 rounded-card border border-hairline bg-void/90 px-4 py-3 text-ash backdrop-blur-sm">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4 text-ash-dim">
                  <path d="M12 21c-4.4-4-7-7.5-7-11a7 7 0 1 1 14 0c0 3.5-2.6 7-7 11Z" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="12" cy="10" r="2.5" />
                </svg>
                Aún no hay datos del evento
              </p>
            </div>
          )}
        </section>

        <ReportFeed reports={reports} loading={mode === "loading"} />
      </main>
    </div>
  );
}
