import type { ReactNode } from "react";
import type { TriggerState } from "../App";
import type { EventAlert } from "../lib/types";
import AlertBanner from "./AlertBanner";
import SeismographTrace from "./SeismographTrace";

interface LandingPageProps {
  alert: EventAlert | null;
  wsConnected: boolean;
  hasOpenEvent: boolean;
  triggerState: TriggerState;
  loading: boolean;
  onDismissAlert: () => void;
  onRunDemoTrigger: () => void;
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
      className={`border-t border-hairline px-5 py-20 sm:py-28 ${alt ? "bg-shell" : ""}`}
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
                wsConnected ? "bg-signal-safe" : "animate-signal-blink bg-signal-help"
              }`}
            />
            {wsConnected ? "Red activa" : "Reconectando"}
          </p>
        </div>
        {hasOpenEvent && (
          <button
            type="button"
            onClick={onOpenDashboard}
            className="label-mono rounded-card border border-hairline px-4 py-2.5 text-ash transition-colors hover:border-ash-dim hover:text-bone focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bone/60"
          >
            Mapa en vivo
          </button>
        )}
      </header>

      <main>
        {/* Hero — mirrors the app's login screen: wordmark, seismic rule,
            eyebrow, then the promise. */}
        <section className="px-5 pb-16 pt-12 sm:pb-24 sm:pt-16">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="wordmark text-3xl text-bone sm:text-5xl">Replica</h1>
            <SeismographTrace className="mx-auto mt-6 h-7 w-full max-w-sm text-ash-dim" />
            <p className="label-mono mt-5 text-ash-dim">Red de emergencia</p>

            <p className="mx-auto mt-11 max-w-xl text-2xl font-light leading-[1.15] tracking-tight text-bone sm:text-4xl">
              La información sobrevive aunque la red no lo haga.
            </p>
            <p className="mx-auto mt-6 max-w-md text-sm leading-relaxed text-ash sm:text-base">
              Cuando un desastre deja sin cobertura a una zona, Replica convierte los teléfonos que
              quedaron ahí en la red. Los reportes viajan de persona a persona hasta que alguien con
              conexión los sincroniza.
            </p>
          </div>

          {/* Operational state: the map exists only while an event is open. */}
          <div className="mx-auto mt-12 max-w-2xl">
            {alert ? (
              <AlertBanner alert={alert} onOpenMap={onOpenDashboard} onDismiss={onDismissAlert} />
            ) : (
              <div className="rounded-card border border-hairline bg-panel p-6 text-center">
                <p className="label-mono flex items-center justify-center gap-2 text-ash-dim">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      loading ? "animate-signal-blink bg-ash-dim" : "bg-signal-safe"
                    }`}
                  />
                  {loading ? "Consultando estado" : "Sin evento activo"}
                </p>
                <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-ash">
                  El mapa de calor solo existe mientras hay una emergencia abierta: la red
                  únicamente registra datos de personas a partir de ese momento.
                </p>

                <div className="mt-6 border-t border-hairline pt-6">
                  <p className="mx-auto max-w-md text-sm leading-relaxed text-ash">
                    Para la demostración, este botón ocupa el lugar de EMSC y SGC: abre un evento
                    real en el backend y lo anuncia igual que lo haría un sismo detectado.
                  </p>
                  <button
                    type="button"
                    onClick={onRunDemoTrigger}
                    disabled={triggerState === "pending"}
                    className="label-mono mt-5 rounded-card border border-signal-emergency/60 px-8 py-4 text-signal-emergency transition-colors hover:bg-signal-emergency/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal-emergency focus-visible:ring-offset-2 focus-visible:ring-offset-panel disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {triggerState === "pending" ? "Activando…" : "Simular sismo"}
                  </button>
                  {triggerState === "error" && (
                    <p role="alert" className="mt-4 text-xs leading-relaxed text-signal-help">
                      No se pudo activar. Revisá que el backend esté corriendo y que
                      DEMO_WEB_TRIGGER_ENABLED esté en true.
                    </p>
                  )}
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
                <span className="font-mono-figures pt-0.5 text-base tabular-nums text-ash-dim">
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
          heading="Cada mensaje pesa unos 120 bytes y va firmado."
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
          lead="El mapa público solo muestra celdas de unos 500 metros con un conteo de personas y una intensidad. Nunca se publica una coordenada individual, un nombre ni un identificador de dispositivo."
        />
      </main>

      <footer className="border-t border-hairline px-5 py-8">
        <p className="label-mono text-center text-ash-dim">Replica · Platanus Hack 26</p>
      </footer>
    </div>
  );
}
