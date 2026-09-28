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

export default function RasterMapViewer({
  accessUrl,
  titilerUrl,
  bidx = 1,
  rescale = "0,255",
  colormapName = "viridis",
}) {
  const [mapMod, setMapMod] = useState(null);
  const [bounds, setBounds] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const reactMap = await import("react-map-gl/maplibre");
        await import("maplibre-gl/dist/maplibre-gl.css");
        if (!cancelled) setMapMod(reactMap);
      } catch (e) {
        if (!cancelled) setError("Could not load the raster map viewer.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!titilerUrl || !accessUrl) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const infoUrl = `${titilerUrl}/bounds?url=${encodeURIComponent(accessUrl)}`;
        const resp = await fetch(infoUrl);
        if (!resp.ok) return;
        const data = await resp.json();
        const b = data.bounds || data;
        if (Array.isArray(b) && b.length === 4 && !cancelled) {
          setBounds([[b[0], b[1]], [b[2], b[3]]]);
        }
      } catch {
        /* bounds are optional */
      }
    })();
    return () => { cancelled = true; };
  }, [titilerUrl, accessUrl]);

  const tiles = useMemo(() => {
    if (!titilerUrl || !accessUrl) return [];
    const params = new URLSearchParams({
      url: accessUrl,
      bidx: String(bidx),
      rescale: String(rescale),
      colormap_name: colormapName,
    });
    return [`${titilerUrl}/tiles/WebMercatorQuad/{z}/{x}/{y}.png?${params.toString()}`];
  }, [titilerUrl, accessUrl, bidx, rescale, colormapName]);

  if (!titilerUrl) {
    return (
      <div className="preview-empty">
        <h3 className="display">Raster preview needs TiTiler</h3>
        <p>Set TITILER_BASE_URL so Cloud Optimized GeoTIFFs can be served with band, rescale, and colormap parameters.</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="preview-empty">
        <h3 className="display">Map unavailable</h3>
        <p>{error}</p>
      </div>
    );
  }
  if (!mapMod) return <div className="empty"><p>Loading raster map…</p></div>;

  const { Map, Source, Layer } = mapMod;
  const maxBounds = bounds
    ? [bounds[0][0] - 0.5, bounds[0][1] - 0.5, bounds[1][0] + 0.5, bounds[1][1] + 0.5]
    : undefined;

  return (
    <div className="preview-map">
      <Map
        mapLib={import("maplibre-gl")}
        mapStyle={OSM_STYLE}
        initialViewState={{ longitude: 78.96, latitude: 20.59, zoom: 4 }}
        style={{ width: "100%", height: "70vh", borderRadius: 10 }}
        maxBounds={maxBounds}
      >
        <Source id="viz-cog" type="raster" tiles={tiles} tileSize={256}>
          <Layer id="viz-cog-layer" type="raster" />
        </Source>
      </Map>
    </div>
  );
}
