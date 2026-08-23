import type { EventAlert } from "../lib/types";
import SeismographTrace from "./SeismographTrace";

interface AlertBannerProps {
  alert: EventAlert;
  onOpenMap: () => void;
  onDismiss: () => void;
}

export default function AlertBanner({ alert, onOpenMap, onDismiss }: AlertBannerProps) {
  return (
    <div
      role="alert"
      className="relative overflow-hidden rounded-card border border-signal-emergency/45 bg-panel text-left"
    >
      {/* Breathing accent bar — anchors the left edge without shouting. */}
      <span
        aria-hidden="true"
        className="animate-breathe pointer-events-none absolute inset-y-0 left-0 w-px bg-signal-emergency"
      />
      {/* Live instrument readout along the bottom edge — never behind the text. */}
      <SeismographTrace
        variant="alert"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-6 text-signal-emergency opacity-40"
      />
      <div className="relative flex flex-col gap-5 p-5 pb-9 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="flex items-start gap-3">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="mt-0.5 h-5 w-5 shrink-0 text-signal-emergency"
          >
            <path
              d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div>
            <p className="label-mono flex items-center gap-2 text-signal-emergency">
              <span className="animate-signal-blink">Sismo detectado</span>
            </p>
            <p className="display-num mt-2 text-4xl leading-none text-bone">
              {alert.mag != null ? `M ${alert.mag.toFixed(1)}` : "M —"}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-bone">
              {alert.place ?? "Ubicación en verificación"}
            </p>
            <p className="mt-1 text-xs text-ash">
              Evento abierto automáticamente por la vigilancia sísmica.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenMap}
            className="label-mono rounded-card border border-signal-emergency/60 px-4 py-3 text-signal-emergency transition-colors hover:bg-signal-emergency/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal-emergency focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
          >
            Ver mapa en vivo
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Descartar alerta"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card text-ash-dim transition-colors hover:text-bone focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bone/60"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
