import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchHeatmap, fetchReports, stopDemoEvent, triggerDemoEvent } from "./lib/api";
import { FALLBACK_CELLS, FALLBACK_REPORTS } from "./lib/fallbackData";
import type { EventAlert, HeatmapCell, Report } from "./lib/types";
import Dashboard, { type DataMode } from "./components/Dashboard";
import LandingPage from "./components/LandingPage";
import { useRealtime } from "./hooks/useRealtime";

type View = "landing" | "dashboard";

/** Idle → the demo trigger is in flight → it failed and we said so. */
export type TriggerState = "idle" | "pending" | "error";

export default function App() {
  const [view, setView] = useState<View>("landing");
  const [cells, setCells] = useState<HeatmapCell[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [mode, setMode] = useState<DataMode>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [alert, setAlert] = useState<EventAlert | null>(null);
  const [triggerState, setTriggerState] = useState<TriggerState>("idle");

  // The id of the open event, straight from the backend: /heatmap returns null
  // when no event is open (cold start). This is what gates the heatmap — the
  // network only records people's data once an emergency is active.
  const [openEventId, setOpenEventId] = useState<string | null>(null);

  const initialLoad = useCallback(async () => {
    setMode("loading");
    try {
      const [heatmap, reps] = await Promise.all([fetchHeatmap(), fetchReports()]);
      setCells(heatmap.cells); // may be empty → explicit empty state
      setReports(reps.reports);
      setOpenEventId(heatmap.event_id ?? null);
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
      if (data.event_id) setOpenEventId(data.event_id);
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

  // EMSC/SGC (or the demo trigger) opened an event: surface it on the landing
  // hero and unlock the heatmap, even if the dashboard was never visited.
  const handleEventOpened = useCallback(
    (next: EventAlert) => {
      setAlert(next);
      setOpenEventId(next.event_id);
      setTriggerState("idle");
      // The announcement arrives before the aggregated data does.
      void refreshHeatmap();
      void refreshReports();
    },
    [refreshHeatmap, refreshReports],
  );

  const runDemoTrigger = useCallback(async () => {
    setTriggerState("pending");
    try {
      // The backend also broadcasts EVENT_OPENED, which lands in
      // handleEventOpened; applying the response too keeps the button working
      // even if the WebSocket happens to be down.
      handleEventOpened(await triggerDemoEvent());
    } catch {
      setTriggerState("error");
    }
  }, [handleEventOpened]);

  // The demo trigger's counterpart: closes the open event and drops the map
  // back into its cold-start (no event) state, on this dashboard and every
  // other one connected — same broadcast-plus-direct-apply pattern as above.
  const handleEventClosed = useCallback(() => {
    setAlert(null);
    setOpenEventId(null);
    setCells([]);
    setReports([]);
    setTriggerState("idle");
  }, []);

  const runStopTrigger = useCallback(async () => {
    setTriggerState("pending");
    try {
      await stopDemoEvent();
      handleEventClosed();
    } catch {
      setTriggerState("error");
    }
  }, [handleEventClosed]);

  // Initial load of both endpoints; retried via the error-state button. Kept
  // active regardless of view so the map/reports are warm the moment someone
  // opens the dashboard from the landing.
  useEffect(() => {
    void initialLoad();
  }, [initialLoad, reloadKey]);

  // Purely decorative clock — lets an operator eyeball how fresh the last
  // report is against the current time. Touches no fetch/WS state.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const clockLabel = useMemo(
    () => now.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    [now],
  );

  const wsConnected = useRealtime(refreshHeatmap, refreshReports, handleEventOpened, handleEventClosed);

  // Demo data has no real event behind it, so it must not unlock the map on
  // its own — otherwise an unreachable backend would look like an emergency.
  const hasOpenEvent = openEventId !== null;

  if (view === "landing" || !hasOpenEvent) {
    return (
      <LandingPage
        alert={alert}
        wsConnected={wsConnected}
        hasOpenEvent={hasOpenEvent}
        triggerState={triggerState}
        loading={mode === "loading"}
        onDismissAlert={() => setAlert(null)}
        onRunDemoTrigger={runDemoTrigger}
        onRunStopTrigger={runStopTrigger}
        onOpenDashboard={() => setView("dashboard")}
      />
    );
  }

  return (
    <Dashboard
      cells={cells}
      reports={reports}
      mode={mode}
      wsConnected={wsConnected}
      clockLabel={clockLabel}
      onRetry={() => setReloadKey((k) => k + 1)}
      onBack={() => setView("landing")}
    />
  );
}
