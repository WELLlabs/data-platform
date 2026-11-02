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

function boundsFromHeader(header) {
  if (!header) return null;
  const { minLon, minLat, maxLon, maxLat } = header;
  const values = [minLon, minLat, maxLon, maxLat];
  if (!values.every((n) => Number.isFinite(n))) return null;
  if (minLon > maxLon || minLat > maxLat) return null;
  if (minLon === maxLon && minLat === maxLat) return null;
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

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
  const [sourceLayer, setSourceLayer] = useState("default");

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
          const pm = await import("pmtiles");
          const { Protocol, PMTiles } = pm;
          const ml = maplibre.default || maplibre;
          if (!window.__pmtilesProtocol) {
            const protocol = new Protocol();
            ml.addProtocol("pmtiles", protocol.tile);
            window.__pmtilesProtocol = true;
          }
          const archive = new PMTiles(url);
          const header = await archive.getHeader();
          let layerName = "default";
          try {
            let meta = await archive.getMetadata();
            if (typeof meta === "string") meta = JSON.parse(meta);
            const layers = meta && (meta.vector_layers || meta.vectorLayers);
            const id = Array.isArray(layers) && layers[0] && (layers[0].id || layers[0].name);
            if (id) layerName = String(id);
          } catch {
            layerName = "default";
          }
          if (cancelled) return;
          setSourceLayer(layerName);
          setBounds(boundsFromHeader(header));
          setPmtilesUrl(`pmtiles://${url}`);
          return;
        }
        const fgb = await import("flatgeobuf");
        // Read the whole file with one plain GET and stream-decode it.
        // Passing the URL string makes flatgeobuf do a bounding-box query
        // with ranged reads, which throws when no box is given and also
        // needs Range in the bucket's CORS rules.
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`The file could not be read (HTTP ${resp.status}).`);
        const fc = { type: "FeatureCollection", features: [] };
        const iter = resp.body
          ? fgb.geojson.deserialize(resp.body)
          : fgb.geojson.deserialize(new Uint8Array(await resp.arrayBuffer()));
        for await (const feature of iter) {
          if (cancelled) return;
          fc.features.push(feature);
          if (fc.features.length >= 100000) break;
        }
        if (cancelled) return;
        if (!fc.features.length) {
          setError("This file has no features to draw.");
          return;
        }
        setGeojson(fc);
        setBounds(bboxOf(fc));
      } catch (e) {
        if (!cancelled) {
          const detail = e && e.message ? ` ${e.message}` : "";
          setError(`Could not load vector features for this file.${detail}`);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [url, format]);

  const initialView = useMemo(() => {
    if (!bounds) return { longitude: 78.96, latitude: 20.59, zoom: 4 };
    const [[w, s], [e, n]] = bounds;
    // A single point has no extent to fit.
    if (w === e && s === n) return { longitude: w, latitude: s, zoom: 12 };
    return { bounds, fitBoundsOptions: { padding: 32, maxZoom: 16 } };
  }, [bounds]);

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
    ? [
        Math.max(-180, bounds[0][0] - 0.5),
        Math.max(-85, bounds[0][1] - 0.5),
        Math.min(180, bounds[1][0] + 0.5),
        Math.min(85, bounds[1][1] + 0.5),
      ]
    : undefined;

  return (
    <div className="preview-map">
      <Map
        key={bounds ? bounds.flat().join(",") : "default"}
        mapLib={import("maplibre-gl")}
        mapStyle={OSM_STYLE}
        initialViewState={initialView}
        style={{ width: "100%", height: "70vh", borderRadius: 10 }}
        maxBounds={maxBounds}
      >
        {geojson && (
          <Source id="viz-vector" type="geojson" data={geojson}>
            <Layer
              id="viz-fill"
              type="fill"
              filter={["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false]}
              paint={{ "fill-color": "#2563eb", "fill-opacity": 0.25 }}
            />
            <Layer
              id="viz-line"
              type="line"
              filter={["match", ["geometry-type"], ["Point", "MultiPoint"], false, true]}
              paint={{ "line-color": "#1d4ed8", "line-width": 2 }}
            />
            <Layer
              id="viz-circle"
              type="circle"
              filter={["match", ["geometry-type"], ["Point", "MultiPoint"], true, false]}
              paint={{ "circle-radius": 4, "circle-color": "#1d4ed8" }}
            />
          </Source>
        )}
        {pmtilesUrl && (
          <Source id="viz-pmtiles" type="vector" url={pmtilesUrl}>
            <Layer
              id="viz-pm-fill"
              type="fill"
              source-layer={sourceLayer}
              paint={{ "fill-color": "#2563eb", "fill-opacity": 0.25 }}
            />
            <Layer
              id="viz-pm-line"
              type="line"
              source-layer={sourceLayer}
              paint={{ "line-color": "#1d4ed8", "line-width": 1.5 }}
            />
            <Layer
              id="viz-pm-circle"
              type="circle"
              source-layer={sourceLayer}
              paint={{ "circle-radius": 4, "circle-color": "#1d4ed8" }}
            />
          </Source>
        )}
      </Map>
    </div>
  );
}
