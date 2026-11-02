import React from "react";
import { render, screen } from "@testing-library/react";
import RasterMapViewer, { normaliseBounds } from "../RasterMapViewer";

jest.mock("maplibre-gl", () => ({}));
jest.mock("react-map-gl/maplibre", () => ({
  Map: ({ children, initialViewState }) => (
    <div data-testid="map" data-view={JSON.stringify(initialViewState)}>
      {children}
    </div>
  ),
  Source: ({ tiles }) => <div data-testid="tiles">{tiles[0]}</div>,
  Layer: () => null,
}));

function mockTiTiler({
  bounds,
  colorinterp = ["gray"],
  dtype = "float32",
  stats = { b1: { min: 0, max: 1, percentile_2: 0.1, percentile_98: 0.9, valid_pixels: 10 } },
  down = false,
}) {
  global.fetch = jest.fn(async (url) => {
    const path = new URL(url, "http://x").pathname;
    let body = null;
    if (down) return { ok: false, status: 502, json: async () => ({ detail: "Read failed" }) };
    if (path.endsWith("/tilejson.json")) body = { bounds, maxzoom: 14 };
    if (path.endsWith("/info")) body = { colorinterp, dtype, count: colorinterp.length, nodata_type: "Nodata" };
    if (path.endsWith("/statistics")) body = stats;
    return { ok: body !== null, json: async () => body };
  });
}

const props = { accessUrl: "https://bucket/k.tif", titilerUrl: "/titiler/cog" };

test("a raster whose CRS does not match its coordinates shows a clear message", async () => {
  mockTiTiler({ bounds: [2412614.78, 2021805.48, 5899790.78, 5595613.48], colorinterp: ["palette"] });
  render(<RasterMapViewer {...props} />);
  expect(await screen.findByText(/cannot be placed on the map/i)).toBeInTheDocument();
  expect(screen.queryByTestId("map")).not.toBeInTheDocument();
});

test("a paletted raster is drawn with its own colours and no stretch legend", async () => {
  mockTiTiler({ bounds: [62.15, 5.07, 101.32, 38.51], colorinterp: ["palette"] });
  render(<RasterMapViewer {...props} />);
  const tiles = (await screen.findByTestId("tiles")).textContent;
  expect(tiles).not.toMatch(/rescale=|colormap_name=/);
  expect(screen.queryByLabelText("Colour scale")).not.toBeInTheDocument();
  expect(global.fetch.mock.calls.some(([u]) => u.includes("/statistics"))).toBe(false);
});

test("a continuous raster is stretched to its values and the view fits its bounds", async () => {
  mockTiTiler({ bounds: [77.5, 12.9, 77.7, 13.1] });
  render(<RasterMapViewer {...props} />);
  const tiles = (await screen.findByTestId("tiles")).textContent;
  expect(tiles).toMatch(/rescale=0.1%2C0.9/);
  expect(tiles).toMatch(/colormap_name=viridis/);
  const view = JSON.parse(screen.getByTestId("map").dataset.view);
  expect(view.bounds).toEqual([[77.5, 12.9], [77.7, 13.1]]);
});

test("the server's verdict that a raster cannot be placed is shown without calling TiTiler", async () => {
  global.fetch = jest.fn();
  render(
    <RasterMapViewer {...props} georefStatus="unplaceable" georefNote="Several projections fit (EPSG:32643, EPSG:32644)." />
  );
  expect(await screen.findByText(/cannot be placed on the map/i)).toBeInTheDocument();
  expect(screen.getByText(/Several projections fit/)).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

test("an assumed CRS is explained above the map", async () => {
  mockTiTiler({ bounds: [62.15, 5.07, 101.32, 38.51], colorinterp: ["palette"] });
  render(<RasterMapViewer {...props} georefStatus="assumed" georefNote="The map assumes EPSG:7755." />);
  await screen.findByTestId("tiles");
  expect(screen.getByRole("note")).toHaveTextContent("EPSG:7755");
});

test("true-colour imagery is drawn from its red, green, and blue bands", async () => {
  mockTiTiler({ bounds: [77.5, 12.9, 77.7, 13.1], colorinterp: ["red", "green", "blue", "alpha"], dtype: "uint8" });
  render(<RasterMapViewer {...props} />);
  const tiles = (await screen.findByTestId("tiles")).textContent;
  expect(tiles).toMatch(/bidx=1&bidx=2&bidx=3/);
  expect(tiles).not.toMatch(/colormap_name=|rescale=/);
});

test("a raster with no valid pixels says so instead of drawing an empty map", async () => {
  mockTiTiler({ bounds: [77.5, 12.9, 77.7, 13.1], stats: { b1: { min: 0, max: 0, valid_pixels: 0 } } });
  render(<RasterMapViewer {...props} />);
  expect(await screen.findByText(/Nothing to draw/i)).toBeInTheDocument();
});

test("when TiTiler cannot open the file the user can try again", async () => {
  mockTiTiler({ down: true });
  render(<RasterMapViewer {...props} />);
  expect(await screen.findByText(/could not open this raster \(TiTiler .* returned 502: Read failed\)/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
});

test("bounds are clamped for the map and impossible ones are rejected", () => {
  expect(normaliseBounds([-180.00001, -90, 180.00001, 90]).box).toEqual([[-180, -85.0511], [180, 85.0511]]);
  expect(normaliseBounds([0, -90, 360, 90]).box[0][0]).toBe(-180);
  expect(normaliseBounds([2412614, 2021805, 5899790, 5595613]).invalid).toBe(true);
  expect(normaliseBounds(null)).toEqual({ box: null, invalid: false });
});
