import { useState } from "react";
import type { Report } from "../lib/types";

/**
 * AI report feed (spec dashboard-web-ui): the most recent report is always
 * highlighted; older reports stay accessible in a collapsible list.
 * `content` (schema v1, design D2) renders defensively — missing fields
 * never crash the UI. REPORT_CREATED realtime refetches land here via props.
 * Styling is 100 % Tailwind utilities (no custom CSS).
 */

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-CO", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function ReportCard({ report, highlighted }: { report: Report; highlighted?: boolean }) {
  const content = report.content;
  return (
    <article
      className={`rounded-lg border p-4 ${
        highlighted
          ? "border-sky-500/60 bg-slate-800 shadow-lg shadow-sky-500/10"
          : "border-slate-700 bg-slate-800/50"
      }`}
    >
      <header className="mb-2 flex items-center justify-between gap-2 text-xs">
        <span
          className={`rounded px-2 py-0.5 font-semibold uppercase tracking-wide ${
            highlighted ? "bg-sky-500/20 text-sky-300" : "bg-slate-700 text-slate-300"
          }`}
        >
          {highlighted ? "Último reporte · " : ""}
          {report.source}
        </span>
        <time className="text-slate-400">{formatDate(report.generated_at)}</time>
      </header>
      <h3 className="mb-1 font-semibold text-slate-100">
        {content?.title ?? "(sin título)"}
      </h3>
      {content?.summary && <p className="text-sm leading-relaxed text-slate-300">{content.summary}</p>}
      {Array.isArray(content?.recommendations) && content.recommendations.length > 0 && (
        <div className="mt-3">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Recomendaciones
          </h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
            {content!.recommendations!.map((rec, i) => (
              <li key={i}>{rec}</li>
            ))}
          </ul>
        </div>
      )}
      {content?.figures && Object.keys(content.figures).length > 0 && (
        <footer className="mt-3 flex flex-wrap gap-2">
          {Object.entries(content.figures).map(([key, value]) => (
            <span
              key={key}
              className="rounded-full bg-slate-700 px-2.5 py-0.5 text-xs text-slate-200"
            >
              {key}: <strong>{value}</strong>
            </span>
          ))}
        </footer>
      )}
    </article>
  );
}

interface ReportFeedProps {
  reports: Report[];
  loading?: boolean;
}

export default function ReportFeed({ reports, loading = false }: ReportFeedProps) {
  const [showOlder, setShowOlder] = useState(false);

  return (
    <aside className="flex w-full flex-col gap-3 overflow-y-auto border-t border-slate-700 bg-slate-900 p-4 lg:w-96 lg:border-l lg:border-t-0">
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">
        Reportes IA
      </h2>
      {loading && reports.length === 0 && (
        <p className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 text-sm text-slate-400">
          Cargando reportes…
        </p>
      )}
      {!loading && reports.length === 0 && (
        <p className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 text-sm text-slate-400">
          Aún no hay reportes del evento.
        </p>
      )}
      {reports.length > 0 && (() => {
        const [latest, ...older] = reports;
        return (
          <>
            <ReportCard report={latest} highlighted />
            {older.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowOlder((v) => !v)}
                  className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700"
                >
                  {showOlder
                    ? "Ocultar reportes anteriores ▲"
                    : `Reportes anteriores (${older.length}) ▼`}
                </button>
                {showOlder && (
                  <div className="flex flex-col gap-3">
                    {older.map((r) => (
                      <ReportCard key={r.id} report={r} />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        );
      })()}
    </aside>
  );
}
