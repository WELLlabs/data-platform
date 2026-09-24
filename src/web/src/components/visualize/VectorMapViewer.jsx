import React, { useEffect, useMemo, useState } from "react";

const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

function bboxOf(geojson) {
  let minX = 180;
  let minY = 90;
  let maxX = -180;
  let maxY = -90;
  const walk = (coords) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number") {
      const [x, y] = coords;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }
    coords.forEach(walk);
  };
  (geojson.features || []).forEach((f) => {
    if (f.geometry && f.geometry.coordinates) walk(f.geometry.coordinates);
  });
  if (minX > maxX) return null;
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

export default function VectorMapViewer({ url, format }) {
  const [mapMod, setMapMod] = useState(null);
  const [geojson, setGeojson] = useState(null);
  const [pmtilesUrl, setPmtilesUrl] = useState("");
  const [error, setError] = useState("");
  const [bounds, setBounds] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const reactMap = await import("react-map-gl/maplibre");
        await import("maplibre-gl/dist/maplibre-gl.css");
        if (!cancelled) setMapMod(reactMap);
      } catch (e) {
        if (!cancelled) setError("Could not load the map viewer.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fmt = (format || "").toLowerCase();
        if (fmt === "pmtiles") {
          const maplibre = await import("maplibre-gl");
          const { Protocol } = await import("pmtiles");
          const ml = maplibre.default || maplibre;
          if (!window.__pmtilesProtocol) {
            const protocol = new Protocol();
            ml.addProtocol("pmtiles", protocol.tile);
            window.__pmtilesProtocol = true;
          }
          if (!cancelled) setPmtilesUrl(`pmtiles://${url}`);
          return;
        }
        const fgb = await import("flatgeobuf");
        const fc = { type: "FeatureCollection", features: [] };
        const iter = fgb.geojson.deserialize(url);
        for await (const feature of iter) {
          fc.features.push(feature);
          if (fc.features.length >= 100000) break;
        }
        if (cancelled) return;
        setGeojson(fc);
        setBounds(bboxOf(fc));
      } catch (e) {
        if (!cancelled) setError("Could not load vector features for this file.");
      }
    })();
    return () => { cancelled = true; };
  }, [url, format]);

  const initialView = useMemo(() => ({ longitude: 78.96, latitude: 20.59, zoom: 4 }), []);

  if (error) {
    return (
      <div className="preview-empty">
        <h3 className="display">Map unavailable</h3>
        <p>{error}</p>
      </div>
    );
  }
  if (!mapMod) return <div className="empty"><p>Loading map…</p></div>;

  const { Map, Source, Layer } = mapMod;
  const maxBounds = bounds
    ? [bounds[0][0] - 0.5, bounds[0][1] - 0.5, bounds[1][0] + 0.5, bounds[1][1] + 0.5]
    : undefined;

  return (
    <div className="preview-map">
      <Map
        mapLib={import("maplibre-gl")}
        mapStyle={OSM_STYLE}
        initialViewState={initialView}
        style={{ width: "100%", height: "70vh", borderRadius: 10 }}
        maxBounds={maxBounds}
      >
        {geojson && (
          <Source id="viz-vector" type="geojson" data={geojson}>
            <Layer id="viz-fill" type="fill" paint={{ "fill-color": "#2563eb", "fill-opacity": 0.25 }} />
            <Layer id="viz-line" type="line" paint={{ "line-color": "#1d4ed8", "line-width": 1.5 }} />
            <Layer id="viz-circle" type="circle" paint={{ "circle-radius": 4, "circle-color": "#1d4ed8" }} />
          </Source>
        )}
        {pmtilesUrl && (
          <Source id="viz-pmtiles" type="vector" url={pmtilesUrl}>
            <Layer
              id="viz-pm-fill"
              type="fill"
              source-layer="default"
              paint={{ "fill-color": "#2563eb", "fill-opacity": 0.25 }}
            />
          </Source>
        )}
      </Map>
    </div>
  );
}
