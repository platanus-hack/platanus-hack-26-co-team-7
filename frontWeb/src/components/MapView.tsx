import { useMemo } from "react";
import DeckGL from "@deck.gl/react";
import { MapView as DeckMapView } from "@deck.gl/core";
import { H3HexagonLayer, TileLayer } from "@deck.gl/geo-layers";
import { BitmapLayer } from "@deck.gl/layers";
import type { PickingInfo } from "@deck.gl/core";
import type { HeatmapCell } from "../lib/types";

/**
 * Planar map. The heavy MapLibre basemap engine (WebGL relief) is GONE.
 * Instead deck.gl renders BOTH parts:
 * - basemap: flat OSM raster tiles via TileLayer → BitmapLayer, no map engine;
 * - zones:  H3HexagonLayer (extruded:false) — fully 2D, native hexagon lib.
 * One renderer, flat vector + raster PNG, keeps the hexagon library intact.
 */

const INITIAL_VIEW = {
  latitude: 4.66,
  longitude: -74.1,
  zoom: 11,
  pitch: 0,
  bearing: 0,
};

/** OSM standard raster tiles, no key. */
const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** green (0) → yellow (5) → red (10), clamped. */
function intensityColor(intensity: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(10, intensity)) / 10;
  let r: number;
  let g: number;
  if (t < 0.5) {
    r = 76 + (t / 0.5) * (255 - 76);
    g = 175;
  } else {
    r = 220;
    g = 175 - ((t - 0.5) / 0.5) * (80 - 40);
  }
  return [Math.round(r), Math.round(g), 60, 185];
}

function intensityRgb(intensity: number): string {
  const [r, g, b] = intensityColor(intensity);
  return `rgb(${r} ${g} ${b})`;
}

/** Same thresholds used by the legend and the tooltip — keep both in sync. */
function riskLabel(intensity: number): "Bajo" | "Medio" | "Alto" {
  if (intensity < 10 / 3) return "Bajo";
  if (intensity < 20 / 3) return "Medio";
  return "Alto";
}

/** Gradient stops sampled from intensityColor, used by the legend bar. */
const LEGEND_GRADIENT = Array.from({ length: 6 }, (_, i) => intensityRgb((i / 5) * 10)).join(
  ", ",
);

interface MapViewProps {
  cells: HeatmapCell[];
}

export default function MapView({ cells }: MapViewProps) {
  const baseLayer = useMemo(
    () =>
      new TileLayer({
        id: "osm-basemap",
        data: OSM_TILES,
        minZoom: 0,
        maxZoom: 19,
        tileSize: 256,
        renderSubLayers: (props: any) => {
          const { boundingBox } = props.tile;
          return new BitmapLayer(props, {
            data: undefined,
            image: props.data,
            bounds: [
              boundingBox[0][0],
              boundingBox[0][1],
              boundingBox[1][0],
              boundingBox[1][1],
            ],
          });
        },
      }),
    [],
  );

  const zoneLayer = useMemo(
    () =>
      new H3HexagonLayer<HeatmapCell>({
        id: "replica-heatmap-2d",
        data: cells,
        getHexagon: (d: HeatmapCell) => d.h3_index,
        getFillColor: (d: HeatmapCell) => intensityColor(d.intensity),
        pickable: true,
        autoHighlight: true,
        stroked: false,
        extruded: false,
        opacity: 0.85,
      }),
    [cells],
  );

  const layers = useMemo(() => [baseLayer, zoneLayer], [baseLayer, zoneLayer]);

  return (
    <div className="relative h-full w-full">
      <DeckGL
        initialViewState={INITIAL_VIEW}
        controller={true}
        views={new DeckMapView({ id: "main", repeat: true })}
        getTooltip={(info: PickingInfo<HeatmapCell>) =>
          info.object
            ? {
                html: `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
                    <span style="display:inline-block;width:6px;height:6px;border-radius:9999px;background:${intensityRgb(info.object.intensity)}"></span>
                    <span style="letter-spacing:0.18em;text-transform:uppercase;font-size:0.6875rem;color:#8b8781">Riesgo ${riskLabel(info.object.intensity)}</span>
                  </div>
                  <b style="font-size:0.95rem;font-weight:600">${info.object.person_count}</b> <span style="color:#8b8781">personas en peligro</span><br/>
                  <span style="color:#5c5a55">intensidad ${info.object.intensity.toFixed(1)} / 10</span>`,
                style: {
                  backgroundColor: "#121211",
                  color: "#e9e5de",
                  fontSize: "0.8rem",
                  padding: "10px 12px",
                  borderRadius: "3px",
                  border: "1px solid #262523",
                },
              }
            : null
        }
        layers={layers}
      />

      <div className="pointer-events-none absolute bottom-3 left-3 rounded-card border border-hairline bg-void/90 px-3 py-2.5 shadow-card backdrop-blur-sm">
        <div className="label-mono mb-2 flex items-center gap-1.5 text-ash-dim">
          Intensidad
          <span
            className="pointer-events-auto cursor-help"
            title="Concentración ponderada de personas en peligro por celda H3 (~500 m), 0–10"
          >
            ⓘ
          </span>
        </div>
        <div
          className="h-1.5 w-40 sm:w-48"
          style={{ background: `linear-gradient(to right, ${LEGEND_GRADIENT})` }}
        />
        <div className="label-mono mt-2 flex justify-between gap-3 text-ash-dim">
          <span>0 Bajo</span>
          <span>5 Medio</span>
          <span>10 Alto</span>
        </div>
      </div>

      {/* Attribution required by the OSM tile usage policy. */}
      <div className="absolute bottom-0 right-0 bg-void/80 px-2 py-1 text-[10px] text-ash-dim backdrop-blur-sm">
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-ash focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bone/60"
        >
          © OpenStreetMap
        </a>
      </div>
    </div>
  );
}