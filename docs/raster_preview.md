# Raster preview

How a GeoTIFF upload becomes a map preview, and what happens when its
georeferencing is wrong.

## Flow

1. **API fast path** (`services/visualization.py::_sound_native_cog`). A few
   ranged reads of the TIFF header (`services/cog_check.py::inspect_tiff`)
   give the COG layout, the grid, and the EPSG code. When the file is a COG,
   names an EPSG code, and converts cleanly to longitude/latitude, it is
   served as uploaded. No conversion, no worker, no download.
2. **Worker** (`tasks/cpu.py::_convert_raster`) for everything else.
   `gdalinfo -json` reads only the header over a presigned URL, and
   `services/raster_inspect.py::plan_raster` decides:

   | Situation | Result |
   | --- | --- |
   | Sound georeferencing, already a COG (GDAL `LAYOUT=COG` or COG structure from another tool) | Served as uploaded |
   | Sound georeferencing, not a COG | Converted to COG |
   | CRS missing or mislabelled, true CRS identifiable | COG written with the corrected CRS (`gdal_translate -a_srs`) |
   | Ground control points only | Warped to a regular grid (`gdalwarp`) |
   | No location information, or the true CRS cannot be identified safely | Served as uploaded; the preview explains why there is no map |

   A derivative is checked again with `gdalinfo` before it is published.
3. **Viewer** (`RasterMapViewer.jsx`) draws paletted rasters with their own
   colours, red/green/blue imagery as RGB, and other rasters as one band
   stretched between its 2nd and 98th percentiles.

The downloaded file is never changed. A file name or format label containing
"cog" is not trusted; the file itself is checked.

## Identifying a wrong or missing CRS

`services/raster_georef.py::assess` handles:

* No CRS, coordinates in degrees: WGS 84 (EPSG:4326) is assumed.
* Labelled in degrees, coordinates in metres (for example NRSC/Bhuvan LULC
  250K exports, which are really EPSG:7755, India NSF LCC).
* Labelled in metres, coordinates in degrees: EPSG:4326 is assumed.
* No CRS, coordinates in metres.

For the metre cases each projection in `RASTER_CRS_CANDIDATES` is tried. A
guess is used only when **exactly one** candidate places the data inside
`RASTER_EXPECTED_REGION`. A UTM file without a zone fits several zones, so it
is reported as unplaceable instead of being drawn in the wrong place.

Previews made before this check (`converted_files.georef_status` is NULL)
are checked again the next time they are opened.
