import { useState } from "react";
import type { Report } from "../lib/types";

/**
 * AI report feed (spec dashboard-web-ui): the most recent report is always
 * highlighted; older reports stay accessible in a collapsible list.
 * `content` (schema v1, design D2) renders defensively — missing fields
 * never crash the UI. REPORT_CREATED realtime refetches land here via props.
 * Card treatment mirrors the mobile app's stored-telegram cards: hairline
 * border, mono caps badge, warm neutrals.
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

/** `source` is a free-form string server-side — always fall back to a generic icon. */
function SourceIcon({ source }: { source: string }) {
  if (source === "SCHEDULED") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (source === "MANUAL") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
        <path
          d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 8v4m2-2h-4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
      <path
        d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M14 3v5h5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReportCard({ report, highlighted }: { report: Report; highlighted?: boolean }) {
  const content = report.content;
  return (
    <article
      className={`relative overflow-hidden rounded-card border p-4 ${
        highlighted
          ? "animate-report-in border-signal-mesh/45 bg-panel-raised shadow-highlight"
          : "border-hairline bg-panel"
      }`}
    >
      {highlighted && <div className="absolute inset-x-0 top-0 h-px bg-signal-mesh/70" />}
      <header className="label-mono mb-3 flex items-start justify-between gap-2">
        <span
          className={`flex items-center gap-2 ${highlighted ? "text-signal-mesh" : "text-ash-dim"}`}
        >
          <SourceIcon source={report.source} />
          {highlighted ? "Último · " : ""}
          {report.source}
        </span>
        <time className="font-mono-figures shrink-0 text-[10px] tabular-nums tracking-normal text-ash-dim">
          {formatDate(report.generated_at)}
        </time>
      </header>
      <h3 className="text-sm font-medium leading-snug text-bone">
        {content?.title ?? "(sin título)"}
      </h3>
      {content?.summary && (
        <p className="mt-2 text-sm leading-relaxed text-ash">{content.summary}</p>
      )}
      {Array.isArray(content?.recommendations) && content.recommendations.length > 0 && (
        <div className="mt-4 border-t border-hairline pt-3">
          <h4 className="label-mono mb-2 text-ash-dim">Recomendaciones</h4>
          <ul className="space-y-1.5 text-sm text-ash">
            {content!.recommendations!.map((rec, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-ash-dim">—</span>
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}
      {content?.figures && Object.keys(content.figures).length > 0 && (
        <footer className="mt-4 flex flex-wrap gap-2">
          {Object.entries(content.figures).map(([key, value]) => (
            <span
              key={key}
              className="label-mono rounded-card border border-hairline px-2 py-1.5 text-ash-dim"
            >
              {key}{" "}
              <strong className="font-mono-figures font-semibold tabular-nums tracking-normal text-bone">
                {value}
              </strong>
            </span>
          ))}
        </footer>
      )}
    </article>
  );
}

function ReportCardSkeleton() {
  return (
    <div className="animate-pulse rounded-card border border-hairline bg-panel p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="h-3 w-24 rounded-card bg-panel-raised" />
        <div className="h-3 w-20 rounded-card bg-panel-raised" />
      </div>
      <div className="mb-3 h-3.5 w-3/4 rounded-card bg-panel-raised" />
      <div className="mb-2 h-3 w-full rounded-card bg-panel-raised" />
      <div className="h-3 w-5/6 rounded-card bg-panel-raised" />
    </div>
  );
}

interface ReportFeedProps {
  reports: Report[];
  loading?: boolean;
}

export default function ReportFeed({ reports, loading = false }: ReportFeedProps) {
  const [showOlder, setShowOlder] = useState(false);

  return (
    <aside className="flex w-full flex-col gap-3 overflow-y-auto border-t border-hairline bg-shell p-4 lg:w-96 lg:border-l lg:border-t-0">
      <h2 className="label-mono py-1 text-ash-dim">Reportes IA</h2>
      {loading && reports.length === 0 && (
        <div className="flex flex-col gap-3" aria-label="Cargando reportes">
          <ReportCardSkeleton />
          <ReportCardSkeleton />
        </div>
      )}
      {!loading && reports.length === 0 && (
        <p className="flex items-center gap-2.5 rounded-card border border-hairline bg-panel p-4 text-sm text-ash">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4 shrink-0 text-ash-dim">
            <path
              d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M14 3v5h5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Aún no hay reportes del evento.
        </p>
      )}
      {reports.length > 0 && (() => {
        const [latest, ...older] = reports;
        return (
          <>
            <ReportCard key={latest.id} report={latest} highlighted />
            {older.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowOlder((v) => !v)}
                  aria-expanded={showOlder}
                  aria-controls="older-reports"
                  className="label-mono flex items-center gap-2 self-start rounded-card border border-hairline px-3 py-2.5 text-ash transition-colors hover:border-ash-dim hover:text-bone focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bone/60"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className={`h-3 w-3 transition-transform ${showOlder ? "rotate-180" : ""}`}
                  >
                    <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {showOlder ? "Ocultar anteriores" : `Anteriores (${older.length})`}
                </button>
                <div
                  id="older-reports"
                  className={`grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out ${
                    showOlder ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  }`}
                >
                  <div className="flex min-h-0 flex-col gap-3">
                    {older.map((r) => (
                      <ReportCard key={r.id} report={r} />
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        );
      })()}
    </aside>
  );
}
