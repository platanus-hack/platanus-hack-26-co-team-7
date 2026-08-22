import { useMemo } from "react";
import DeckGL from "@deck.gl/react";
import { MapView as DeckMapView } from "@deck.gl/core";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import type { PickingInfo } from "@deck.gl/core";
import { Map } from "@vis.gl/react-maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { MAP_STYLE_URL } from "../lib/constants";
import type { HeatmapCell } from "../lib/types";

/**
 * Deferred chunk (design D8): MapLibre GL basemap (OpenFreeMap liberty style,
 * no API key) + deck.gl H3HexagonLayer consuming `h3_index` directly.
 * Color ramp by `intensity` (green → yellow → red, 0–10); elevation by
 * `telegram_count`. Imported via React.lazy from App — never in the critical
 * bundle.
 */

const INITIAL_VIEW = {
  latitude: 4.66,
  longitude: -74.1,
  zoom: 11,
  pitch: 30,
  bearing: 0,
};

/** green (0) → yellow (5) → red (10), clamped. */
function intensityColor(intensity: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(10, intensity)) / 10;
  let r: number;
  let g: number;
  if (t < 0.5) {
    r = 76 + t / 0.5 * (255 - 76);
    g = 175;
  } else {
    r = 220;
    g = 175 - (t - 0.5) / 0.5 * (80 - 40);
  }
  return [Math.round(r), Math.round(g), 60, 200];
}

interface MapViewProps {
  cells: HeatmapCell[];
}

export default function MapView({ cells }: MapViewProps) {
  const layer = useMemo(
    () =>
      new H3HexagonLayer<HeatmapCell>({
        id: "replica-heatmap",
        data: cells,
        getHexagon: (d: HeatmapCell) => d.h3_index,
        getFillColor: (d: HeatmapCell) => intensityColor(d.intensity),
        getElevation: (d: HeatmapCell) => d.telegram_count,
        elevationScale: 8,
        extruded: true,
        pickable: true,
        autoHighlight: true,
        stroked: false,
        opacity: 0.85,
      }),
    [cells],
  );

  return (
    <DeckGL
      initialViewState={INITIAL_VIEW}
      controller={true}
      views={new DeckMapView({ id: "main", repeat: true })}
      getTooltip={(info: PickingInfo<HeatmapCell>) =>
        info.object
          ? {
              html: `<b>Personas en peligro:</b> ${info.object.telegram_count}`,
              style: {
                backgroundColor: "#141a24",
                color: "#e6edf3",
                fontSize: "0.8rem",
                padding: "6px 10px",
                borderRadius: "6px",
                border: "1px solid #2a3547",
              },
            }
          : null
      }
      layers={[layer]}
    >
      <Map id="basemap" mapStyle={MAP_STYLE_URL} />
    </DeckGL>
  );
}
