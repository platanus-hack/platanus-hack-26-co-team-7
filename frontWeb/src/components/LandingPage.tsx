import type { ReactNode } from "react";
import type { TriggerState } from "../App";
import type { EventAlert } from "../lib/types";
import { APK_DOWNLOAD_URL } from "../lib/constants";
import SeismographTrace from "./SeismographTrace";

interface LandingPageProps {
  alert: EventAlert | null;
  wsConnected: boolean;
  hasOpenEvent: boolean;
  triggerState: TriggerState;
  loading: boolean;
  onDismissAlert: () => void;
  onRunDemoTrigger: () => void;
  onRunStopTrigger: () => void;
  onOpenDashboard: () => void;
}

const STEPS = [
  {
    n: "01",
    title: "Relevo entre teléfonos",
    body: "Sin señal celular, tu teléfono pasa el mensaje a los dispositivos cercanos por Wi-Fi Direct y Bluetooth. Cada salto lo acerca a alguien con conexión.",
  },
  {
    n: "02",
    title: "Un teléfono sincroniza",
    body: "El primero que recupera internet sube en lote los mensajes firmados que la red fue acumulando, y los saca de la zona sin cobertura.",
  },
  {
    n: "03",
    title: "Se agrupa por zona",
    body: "Las ubicaciones se agregan en celdas de unos 500 metros. El mapa muestra zonas, nunca un punto ni una persona.",
  },
  {
    n: "04",
    title: "Se resume la situación",
    body: "Cada pocos minutos se genera un reporte con el estado de las zonas afectadas y recomendaciones para los equipos de respuesta.",
  },
];

/**
 * The three states a telegram can carry (backend TelegramInput.status:
 * EMERGENCY / NEED_HELP / SAFE), styled with the same badge treatment the
 * mobile app uses on its stored-telegram cards.
 */
const STATES = [
  {
    label: "Emergencia",
    body: "Riesgo inmediato para la vida. Es el estado que más peso tiene en el mapa.",
    className: "border-signal-emergency/50 bg-signal-emergency/15 text-signal-emergency",
    dot: "bg-signal-emergency",
  },
  {
    label: "Necesito ayuda",
    body: "Necesita asistencia, sin riesgo inmediato de muerte.",
    className: "border-signal-help/50 text-signal-help",
    dot: "bg-signal-help",
  },
  {
    label: "Estoy a salvo",
    body: "Sin novedades. Descarta la zona de la búsqueda y libera equipos.",
    className: "border-signal-safe/50 text-signal-safe",
    dot: "bg-signal-safe",
  },
];

/** One rhythm for every band on the page, so the scale reads as intentional. */
function Section({
  id,
  eyebrow,
  heading,
  lead,
  alt,
  children,
}: {
  id?: string;
  eyebrow: string;
  heading: string;
  lead?: string;
  alt?: boolean;
  children?: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`px-5 py-20 sm:py-28 ${alt ? "bg-shell" : "border-t border-hairline"}`}
    >
      <div className="mx-auto max-w-2xl">
        <p className="label-mono text-ash-dim">{eyebrow}</p>
        <h2 className="mt-5 text-2xl font-light leading-[1.15] tracking-tight text-bone sm:text-4xl">
          {heading}
        </h2>
        {lead && <p className="mt-6 max-w-xl text-base leading-relaxed text-ash">{lead}</p>}
        {children}
      </div>
    </section>
  );
}

export default function LandingPage({
  alert,
  wsConnected,
  hasOpenEvent,
  triggerState,
  loading,
  onDismissAlert,
  onRunDemoTrigger,
  onRunStopTrigger,
  onOpenDashboard,
}: LandingPageProps) {
  return (
    <div className="min-h-screen bg-void text-bone">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-hairline bg-void/90 px-5 py-4 backdrop-blur">
        <div>
          <p className="wordmark text-sm text-bone sm:text-base">Replica</p>
          <p
            className="label-mono mt-1.5 flex items-center gap-1.5 text-ash-dim"
            role="status"
            aria-live="polite"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                wsConnected ? "animate-breathe bg-signal-safe" : "animate-signal-blink bg-signal-help"
              }`}
            />
            {wsConnected ? "Red activa" : "Reconectando"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {hasOpenEvent ? (
            <button
              type="button"
              onClick={onRunStopTrigger}
              disabled={triggerState === "pending"}
              title={
                triggerState === "error"
                  ? "No se pudo detener. Revisá que el backend esté corriendo."
                  : undefined
              }
              className="label-mono rounded-card border border-signal-safe/60 px-4 py-2.5 text-signal-safe transition-colors hover:bg-signal-safe/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal-safe focus-visible:ring-offset-2 focus-visible:ring-offset-panel disabled:cursor-not-allowed disabled:opacity-50"
            >
              Detener
            </button>
          ) : (
            <button
              type="button"
              onClick={onRunDemoTrigger}
              disabled={triggerState === "pending"}
              title={
                triggerState === "error"
                  ? "No se pudo activar. Revisá que el backend esté corriendo."
                  : undefined
              }
              className="label-mono rounded-card border border-signal-emergency/60 px-4 py-2.5 text-signal-emergency transition-colors hover:bg-signal-emergency/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal-emergency focus-visible:ring-offset-2 focus-visible:ring-offset-panel disabled:cursor-not-allowed disabled:opacity-50"
            >
              Demo
            </button>
          )}
          {hasOpenEvent && (
            <button
              type="button"
              onClick={onOpenDashboard}
              className="label-mono rounded-card border border-hairline px-4 py-2.5 text-ash transition-colors hover:border-ash-dim hover:text-bone focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bone/60"
            >
              Mapa en vivo
            </button>
          )}
        </div>
      </header>

      <main>
        {/* Hero — two states: resting (brand + APK CTA) and an earthquake
            takeover. The ambient aurora swaps from neutral mesh to emergency
            red, and the copy + primary action change with it. */}
        <section className="relative overflow-hidden px-5 pb-16 pt-12 sm:pb-24 sm:pt-16">
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 ${alert ? "bg-aurora-alert" : "bg-hero-rest"}`}
          />
          <div className="relative mx-auto flex min-h-[72vh] max-w-5xl flex-col justify-center">
            {alert ? (
              <div className="animate-rise">
                <div className="flex items-center justify-between">
                  <p className="label-mono flex items-center gap-2 text-signal-emergency">
                    <span className="animate-signal-blink h-1.5 w-1.5 rounded-full bg-signal-emergency" />
                    Sismo detectado
                  </p>
                  <button
                    type="button"
                    onClick={onDismissAlert}
                    aria-label="Descartar alerta"
                    className="flex h-9 w-9 items-center justify-center rounded-card text-ash-dim transition-colors hover:text-bone focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bone/60"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                      <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>

                <h1 className="mt-8 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight text-bone sm:text-6xl">
                  Hay un terremoto en este momento.
                </h1>

                {/* Instrument readout: label above value — the same figure
                    language the dashboard feed uses, so the takeover reads as
                    the system going loud, not as a marketing banner. */}
                <dl className="mt-12 grid max-w-xl gap-8 sm:grid-cols-2 sm:gap-10">
                  <div>
                    <dt className="label-mono text-signal-emergency">Magnitud</dt>
                    <dd className="mt-3 font-mono-figures text-5xl font-semibold tabular-nums leading-none tracking-tight text-bone sm:text-6xl">
                      {alert.mag != null ? `M ${alert.mag.toFixed(1)}` : "M —"}
                    </dd>
                  </div>
                  <div>
                    <dt className="label-mono text-signal-emergency">Ubicación</dt>
                    <dd className="mt-3 text-xl font-medium leading-snug text-bone">
                      {alert.place ?? "Ubicación en verificación"}
                    </dd>
                  </div>
                </dl>

                <div className="mt-12">
                  <button
                    type="button"
                    onClick={onOpenDashboard}
                    className="label-mono inline-flex items-center gap-2 rounded-card bg-signal-emergency px-5 py-3.5 text-void transition-colors hover:bg-signal-help focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal-emergency focus-visible:ring-offset-2 focus-visible:ring-offset-void"
                  >
                    Ver mapa de calor
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                      <path d="M5 12h14m0 0-6-6m6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
                <div className="animate-rise">
                  <h1 className="wordmark text-4xl text-bone sm:text-5xl">Replica</h1>
                  <SeismographTrace className="mt-8 h-8 w-full max-w-xs text-ash-dim" />
                  <p className="label-mono mt-8 text-ash-dim">Red de emergencia</p>
                  <p className="label-mono mt-3 flex items-center gap-1.5 text-ash-dim">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        loading ? "animate-signal-blink bg-ash-dim" : "bg-signal-safe"
                      }`}
                    />
                    {loading ? "Consultando estado" : "Lista"}
                  </p>
                </div>

                <div className="animate-rise stagger-2">
                  <h2 className="max-w-xl text-3xl font-light leading-[1.12] tracking-tight text-bone sm:text-4xl">
                    La información sobrevive aunque la red no lo haga.
                  </h2>
                  <p className="mt-6 max-w-xl text-base leading-relaxed text-ash">
                    Cuando un desastre deja sin cobertura a una zona, Replica convierte los teléfonos que
                    quedaron ahí en la red. Los reportes viajan de persona a persona hasta que alguien con
                    conexión los sincroniza.
                  </p>
                  <div className="mt-9 flex flex-wrap items-center gap-4">
                    <a
                      href={APK_DOWNLOAD_URL}
                      className="label-mono inline-flex items-center gap-2 rounded-card bg-bone px-5 py-3.5 text-void transition-colors hover:bg-ash focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bone focus-visible:ring-offset-2 focus-visible:ring-offset-void"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                        <path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Descargar la app
                    </a>
                    <span className="label-mono text-ash-dim">Android · APK</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <Section
          id="como-funciona"
          alt
          eyebrow="Cómo funciona"
          heading="Cuatro saltos entre el teléfono de alguien afectado y un mapa que un equipo de respuesta puede leer."
        >
          <ol className="mt-14">
            {STEPS.map((step) => (
              <li
                key={step.n}
                className="grid grid-cols-[2.5rem_1fr] gap-x-4 border-t border-hairline py-7 last:border-b sm:grid-cols-[4rem_1fr] sm:gap-x-8"
              >
                <span className="font-mono-figures pt-1 text-2xl font-light tabular-nums text-ash sm:text-3xl">
                  {step.n}
                </span>
                <div>
                  <h3 className="text-base font-medium text-bone">{step.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-ash">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section
          eyebrow="Lo que viaja por la red"
          heading="Cada telegrama pesa menos de 1 KB y va firmado."
          lead="Solo lleva un estado, una ubicación aproximada y la hora. Nada más sale del teléfono."
        >
          <ul className="mt-14 space-y-7">
            {STATES.map((state) => (
              <li key={state.label} className="grid gap-3 sm:grid-cols-[11rem_1fr] sm:gap-6">
                <span
                  className={`label-mono inline-flex items-center gap-2 self-start justify-self-start rounded-card border px-3 py-2 ${state.className}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${state.dot}`} />
                  {state.label}
                </span>
                <p className="text-sm leading-relaxed text-ash sm:pt-2">{state.body}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          alt
          eyebrow="Detección automática"
          heading="Replica no espera a que alguien reporte el sismo."
          lead="Dos servicios sismológicos independientes vigilan la actividad en tiempo real. Apenas uno registra un evento sobre el umbral configurado para Colombia, se abre el evento y el mapa empieza a recibir datos."
        >
          <dl className="mt-14">
            <div className="border-t border-hairline py-7">
              <dt className="label-mono text-signal-mesh">EMSC</dt>
              <dd className="mt-2.5 text-sm leading-relaxed text-ash">
                European-Mediterranean Seismological Centre. Escucha permanente por WebSocket, en
                tiempo casi real.
              </dd>
            </div>
            <div className="border-y border-hairline py-7">
              <dt className="label-mono text-signal-mesh">SGC</dt>
              <dd className="mt-2.5 text-sm leading-relaxed text-ash">
                Servicio Geológico Colombiano. Consulta periódica del registro sísmico nacional.
              </dd>
            </div>
          </dl>
          <p className="mt-7 text-xs leading-relaxed text-ash-dim">
            Los dos corren en paralelo y se deduplican entre sí: si ambos ven el mismo sismo, se
            abre un solo evento.
          </p>
        </Section>

        <Section
          eyebrow="Privacidad"
          heading="Nadie queda expuesto en el mapa."
          lead="El mapa público solo muestra zonas de unos 500 metros con un conteo de personas en peligro. Nunca se publica una coordenada individual, un nombre ni un identificador de dispositivo."
        />
      </main>

      <footer className="border-t border-hairline px-5 py-12">
        <div className="mx-auto flex max-w-2xl flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="wordmark text-sm text-bone">Replica</p>
            <p className="label-mono mt-2 text-ash-dim">Red de emergencia sin cobertura</p>
          </div>
          <SeismographTrace className="h-5 w-16 text-ash-dim sm:w-20" />
          <p className="label-mono text-ash-dim">Platanus Hack 26 · Bogotá</p>
        </div>
      </footer>
    </div>
  );
}
