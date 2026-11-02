import React, { useCallback, useEffect, useMemo, useState } from "react";

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

// Web Mercator cannot show the poles; MapLibre rejects bounds beyond this.
const MERCATOR_MAX_LAT = 85.0511;
const INDIA_VIEW = { longitude: 78.96, latitude: 20.59, zoom: 4 };

/**
 * Raster preview through TiTiler.
 *
 * The server has already checked the georeferencing (georefStatus):
 *  - "unplaceable": no map; georefNote says why.
 *  - "assumed": the file's CRS was missing or wrong and was fixed in the
 *    preview copy; georefNote says what was assumed.
 *  - "ok": drawn as is.
 *
 * How it is drawn depends on the bands TiTiler reports:
 *  - a colour table (land-use classes): the file's own colours;
 *  - red/green/blue bands (photos, satellite true colour): RGB;
 *  - anything else: band `bidx` stretched between its 2nd and 98th
 *    percentiles with a colour ramp and legend.
 */
export default function RasterMapViewer({
  accessUrl,
  titilerUrl,
  bidx = 1,
  rescale = null,
  colormapName = "viridis",
  georefStatus = "ok",
  georefNote = "",
}) {
  const [mapMod, setMapMod] = useState(null);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState(null);
  const [render, setRender] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const unplaceable = georefStatus === "unplaceable";

  useEffect(() => {
    if (unplaceable) return undefined;
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
  }, [unplaceable]);

  const getJson = useCallback(
    async (path, extra) => {
      const params = new URLSearchParams({ url: accessUrl });
      Object.entries(extra || {}).forEach(([k, v]) => {
        (Array.isArray(v) ? v : [v]).forEach((item) => params.append(k, String(item)));
      });
      const resp = await fetch(`${titilerUrl}/${path}?${params.toString()}`);
      if (!resp.ok) {
        const body = await resp.json().catch(() => null);
        const detail = body && typeof body.detail === "string" ? `: ${body.detail}` : "";
        throw new Error(`TiTiler ${path} returned ${resp.status}${detail}`);
      }
      const type = resp.headers && resp.headers.get ? resp.headers.get("content-type") || "" : "";
      if (type.includes("text/html")) {
        // Nginx or the dev server answered instead of TiTiler.
        throw new Error(`${titilerUrl} is not routed to TiTiler (got an HTML page)`);
      }
      return resp.json();
    },
    [titilerUrl, accessUrl]
  );

  // 1. What TiTiler can read: bounds (always WGS84 in TileJSON), bands, zooms.
  useEffect(() => {
    if (unplaceable || !titilerUrl || !accessUrl) return undefined;
    let cancelled = false;
    setMeta(null);
    setRender(null);
    setError("");
    (async () => {
      const problems = [];
      const note = (e) => {
        problems.push(e && e.message ? e.message : "network error");
        return null;
      };
      const [tilejson, info] = await Promise.all([
        getJson("WebMercatorQuad/tilejson.json").catch(note),
        getJson("info").catch(note),
      ]);
      if (cancelled) return;
      if (!tilejson && !info) {
        setError(
          `The map server could not open this raster (${problems[0] || "no response"}). ` +
            "Check that the TiTiler service is running and can reach the file storage."
        );
        return;
      }
      const bounds = normaliseBounds(tilejson && tilejson.bounds);
      setMeta({
        bounds: bounds.box,
        badGeoref: bounds.invalid,
        maxzoom: Number.isFinite(tilejson && tilejson.maxzoom) ? tilejson.maxzoom : undefined,
        info: info || {},
      });
    })();
    return () => { cancelled = true; };
  }, [unplaceable, titilerUrl, accessUrl, getJson, attempt]);

  // 2. How to draw it.
  useEffect(() => {
    if (!meta || meta.badGeoref) return undefined;
    let cancelled = false;
    (async () => {
      const plan = await planRender(meta.info, { bidx, rescale, getJson });
      if (!cancelled) setRender(plan);
    })();
    return () => { cancelled = true; };
  }, [meta, bidx, rescale, getJson]);

  const tiles = useMemo(() => {
    if (!render || !titilerUrl || !accessUrl) return [];
    const params = new URLSearchParams({ url: accessUrl });
    render.bands.forEach((b) => params.append("bidx", String(b)));
    if (render.rescale) params.set("rescale", render.rescale);
    if (render.ramp) params.set("colormap_name", colormapName);
    if (render.nodata != null) params.set("nodata", String(render.nodata));
    return [`${titilerUrl}/tiles/WebMercatorQuad/{z}/{x}/{y}.png?${params.toString()}`];
  }, [render, titilerUrl, accessUrl, colormapName]);

  if (unplaceable) {
    return (
      <Message title="This raster cannot be placed on the map">
        {georefNote ||
          "The file's location information is missing or does not match its coordinates. Download the file to open it in GIS software."}
      </Message>
    );
  }
  if (!titilerUrl) {
    return (
      <Message title="Raster preview needs TiTiler">
        Set TITILER_BASE_URL so Cloud Optimized GeoTIFFs can be served with band, rescale, and colormap parameters.
      </Message>
    );
  }
  if (error) {
    return (
      <Message title="Map unavailable">
        {error}
        <br />
        <button type="button" className="btn" style={{ marginTop: 12 }} onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </Message>
    );
  }
  if (meta && meta.badGeoref) {
    return (
      <Message title="This raster cannot be placed on the map">
        The file&apos;s coordinate reference system does not match its coordinates (for example, it is labelled as
        latitude/longitude but its coordinates are in metres). Download the file to open it in GIS software, or
        re-upload it with the correct CRS.
      </Message>
    );
  }
  if (render && render.empty) {
    return (
      <Message title="Nothing to draw">
        Every pixel in this raster is marked as no-data, so the map would be empty. Download the file to check it.
      </Message>
    );
  }
  if (!mapMod || !meta || !render) {
    return <div className="empty"><p>Loading raster map…</p></div>;
  }

  const { Map, Source, Layer } = mapMod;
  const { bounds } = meta;
  const maxBounds = bounds
    ? [
        Math.max(-180, bounds[0][0] - 0.5),
        Math.max(-MERCATOR_MAX_LAT, bounds[0][1] - 0.5),
        Math.min(180, bounds[1][0] + 0.5),
        Math.min(MERCATOR_MAX_LAT, bounds[1][1] + 0.5),
      ]
    : undefined;

  return (
    <div className="preview-map">
      {georefStatus === "assumed" && georefNote && (
        <div role="note" style={styles.note}>
          <strong>Location adjusted for the preview.</strong> {georefNote}
        </div>
      )}
      <Map
        mapLib={import("maplibre-gl")}
        mapStyle={OSM_STYLE}
        initialViewState={bounds ? { bounds, fitBoundsOptions: { padding: 24 } } : INDIA_VIEW}
        style={{ width: "100%", height: "70vh", borderRadius: 10 }}
        maxBounds={maxBounds}
      >
        <Source
          key={tiles[0]}
          id="viz-cog"
          type="raster"
          tiles={tiles}
          tileSize={256}
          bounds={bounds ? [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]] : undefined}
          maxzoom={meta.maxzoom}
        >
          <Layer id="viz-cog-layer" type="raster" />
        </Source>
      </Map>
      {render.ramp && colormapName === "viridis" && (
        <div style={styles.legend} aria-label="Colour scale">
          <span>{fmtLegend(render.min)}</span>
          <span style={styles.legendBar} />
          <span>{fmtLegend(render.max)}</span>
          {render.bandLabel && <span style={{ marginLeft: 6 }}>{render.bandLabel}</span>}
        </div>
      )}
    </div>
  );
}

function Message({ title, children }) {
  return (
    <div className="preview-empty">
      <h3 className="display">{title}</h3>
      <p>{children}</p>
    </div>
  );
}

/** Decide bands, stretch, and no-data from TiTiler's /info and /statistics. */
export async function planRender(info, { bidx, rescale, getJson }) {
  const interp = (info.colorinterp || []).map((c) => String(c || "").toLowerCase());
  const count = Number(info.count) || interp.length || 1;
  const band = Math.min(Math.max(1, Number(bidx) || 1), count);
  const dtype = String(info.dtype || "").toLowerCase();

  // Classified rasters carry their own colours.
  if (!rescale && interp[band - 1] === "palette") {
    return { bands: [band], rescale: null, ramp: false };
  }

  // True-colour imagery: draw red, green, blue together.
  const rgb = ["red", "green", "blue"].map((c) => interp.indexOf(c) + 1);
  if (!rescale && rgb.every((i) => i > 0)) {
    if (dtype === "uint8") return { bands: rgb, rescale: null, ramp: false };
    const stats = await getJson("statistics", { bidx: rgb }).catch(() => null);
    const per = rgb.map((i) => bandStats(stats, i)).filter(Boolean);
    const lo = Math.min(...per.map((s) => pick(s.percentile_2, s.min)));
    const hi = Math.max(...per.map((s) => pick(s.percentile_98, s.max)));
    return {
      bands: rgb,
      rescale: Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? `${lo},${hi}` : null,
      ramp: false,
    };
  }

  if (rescale) {
    const [min, max] = String(rescale).split(",").map(Number);
    return { bands: [band], rescale: String(rescale), ramp: true, min, max };
  }

  // One band with a colour ramp, stretched to its own values.
  let nodata = null;
  let stats = bandStats(await getJson("statistics", { bidx: band }).catch(() => null), band);
  // Files without a declared no-data value often fill the area outside the
  // data with a large negative number. Mask it so it is not drawn.
  const declared = info.nodata_type && info.nodata_type !== "None";
  if (!declared && stats && Number.isFinite(stats.min) && stats.min <= -9999) {
    nodata = stats.min;
    const again = await getJson("statistics", { bidx: band, nodata }).catch(() => null);
    stats = bandStats(again, band) || stats;
  }
  if (stats && Number(stats.valid_pixels) === 0) {
    return { bands: [band], empty: true };
  }
  let lo = stats ? pick(stats.percentile_2, stats.min) : 0;
  let hi = stats ? pick(stats.percentile_98, stats.max) : 255;
  if (!(hi > lo) && stats) {
    lo = stats.min;
    hi = stats.max;
  }
  if (!Number.isFinite(lo)) lo = 0;
  if (!(hi > lo)) hi = lo + 1;
  const description = (info.band_descriptions || [])[band - 1];
  const label = Array.isArray(description) ? description[1] : "";
  return {
    bands: [band],
    rescale: `${lo},${hi}`,
    ramp: true,
    min: lo,
    max: hi,
    nodata,
    bandLabel: label && !/^b\d+$/i.test(label) ? label : count > 1 ? `Band ${band}` : "",
  };
}

function bandStats(data, band) {
  if (!data) return null;
  return data[`b${band}`] || Object.values(data)[0] || null;
}

function pick(preferred, fallback) {
  return Number.isFinite(preferred) ? preferred : fallback;
}

/**
 * TileJSON bounds as [[w, s], [e, n]] for MapLibre.
 * Small overshoots (a global grid starting at -180.00001) are clamped.
 * Longitudes in 0-360 or crossing the antimeridian become the whole world.
 * Values far outside degrees mean the CRS does not match the coordinates.
 */
export function normaliseBounds(raw) {
  if (!Array.isArray(raw) || raw.length !== 4) return { box: null, invalid: false };
  let [w, s, e, n] = raw.map(Number);
  if (![w, s, e, n].every(Number.isFinite)) return { box: null, invalid: true };
  const degrees = w >= -180.5 && e <= 360.5 && s >= -90.5 && n <= 90.5;
  if (!degrees || s >= n) return { box: null, invalid: true };
  if (e > 180 || w >= e) {
    w = -180;
    e = 180;
  }
  w = Math.max(-180, w);
  e = Math.min(180, e);
  s = Math.max(-MERCATOR_MAX_LAT, s);
  n = Math.min(MERCATOR_MAX_LAT, n);
  if (!(w < e && s < n)) return { box: null, invalid: false };
  return { box: [[w, s], [e, n]], invalid: false };
}

const legendFmt = new Intl.NumberFormat("en-IN", { maximumSignificantDigits: 4 });

function fmtLegend(v) {
  const n = Number(v);
  return Number.isFinite(n) ? legendFmt.format(n) : "";
}

const styles = {
  note: {
    background: "#FBF6EA",
    border: "1px solid #EAD9AE",
    color: "#6B5216",
    borderRadius: 8,
    padding: "10px 14px",
    marginBottom: 12,
    fontSize: 13,
    lineHeight: 1.5,
  },
  legend: { display: "flex", alignItems: "center", gap: 10, marginTop: 10, fontSize: 12, color: "#475569" },
  legendBar: {
    display: "inline-block",
    width: 220,
    height: 10,
    borderRadius: 3,
    background: "linear-gradient(to right, #440154, #3b528b, #21918c, #5ec962, #fde725)",
  },
};
