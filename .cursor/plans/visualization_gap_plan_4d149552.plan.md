---
name: Visualization gap plan
overview: Visualization already runs through /api/access_file and the existing Celery conversion worker. The remaining work is to turn on Excel and geospatial formats and unblock the viewers that already exist for them.
todos:
  - id: format-plans
    content: Enable xlsx, vector, and raster plans in formats.py and update conversion-plan tests
    status: completed
  - id: converter-guards
    content: Skip COG translate when the GeoTIFF is already a COG; fail vector conversion when feature count cannot be read
    status: completed
  - id: frontend-unblock
    content: Stop hiding supported geo and xlsx files on dataset info, bound PMTiles maps to the source extent, and switch the document viewer to the preview-file JavaScript package
    status: completed
isProject: false
---

# Visualization remaining work

Conversion stays on the existing Celery `cpu` worker in [`src/api/Dockerfile.conversion`](src/api/Dockerfile.conversion). No Lambda, no new image, and no new AWS resources.

## Already done

- `GET /api/access_file` is separate from `/api/download_url`. Preview does not write the download log or increment the download count.
- Tables `converted_files` and `file_access_log` match the schema (status `processing`, `available`, `removed`).
- `AUTO_REMOVE_CONVERTED_FILES` defaults to false. `CONVERTED_FILES_EXPIRY_TIME_DAYS` defaults to 30 and the hourly purge uses `last_accessed`.
- Access flow: reuse an available cloud-native file, return `processing` while a job runs, register an already cloud-native original, otherwise enqueue `cpu.convert_file`.
- Status polling, conversion failures, and the 2100-second timeout are wired. The preview page polls every 2 seconds.
- DuckDB on the API returns aggregated chart rows as JSON. The browser does not send SQL. Drawing the chart is the JavaScript library `d3`, already lazy-loaded with `import("d3")` in [`src/web/src/components/visualize/TableChartViewer.jsx`](src/web/src/components/visualize/TableChartViewer.jsx). It is an npm package in the React app. It is not installed on the API or the conversion worker, and it does not run in Python.
- TiTiler is deployed. A `raster_map` response includes `titiler_url`, `bidx`, `rescale`, and `colormap_name`.
- Frontend viewers exist and lazy-load when the `viewer` field is `document`, `table_chart`, `vector_map`, or `raster_map`. Charts use the JavaScript library D3. Vector maps use `react-map-gl` / MapLibre with FlatGeobuf and PMTiles. Raster maps use TiTiler. Dataset info shows a green dot for a cloud-native file when the file row is expanded.
- Converters in [`src/api/services/conversion.py`](src/api/services/conversion.py) already implement PDF (LibreOffice), Parquet (DuckDB, including xlsx), FlatGeobuf or PMTiles (GDAL, 100k feature split), and COG (`gdal_translate`).

Documents and CSV already go through this path. PDF and Parquet that are uploaded as-is are treated as cloud-native.

## Remaining, and what to change

### 1. Turn the format matrix on

[`src/api/services/formats.py`](src/api/services/formats.py) `plan_for_format` returns `None` for Excel and every geospatial type, so the API responds 400 and the converters never run. [`src/api/tests/test_conversion_plan.py`](src/api/tests/test_conversion_plan.py) currently asserts that `xlsx` and `geojson` return `None`.

Change `plan_for_format` so these resolve:

- `xlsx` to `table_chart`, convert to Parquet
- `geojson`, GeoPackage (`gpkg`), GeoParquet to `vector_map`, convert with GDAL
- FlatGeobuf and PMTiles to `vector_map`, no conversion
- GeoTIFF to `raster_map`, convert to COG
- COG to `raster_map`, no conversion

Shapefile, KML, and the other geo tokens stay unsupported. `pdf`, office files to PDF, `csv`/`tsv` to Parquet, and native Parquet stay as they are.

Update the test so `xlsx` and `geojson` return plans, and add cases for PMTiles, FlatGeobuf, COG, and GeoTIFF.

### 2. Two converter guards

In [`src/api/services/conversion.py`](src/api/services/conversion.py) and [`src/api/tasks/cpu.py`](src/api/tasks/cpu.py):

- Before converting a GeoTIFF, check with `gdalinfo` whether it is already a COG. If it is, store the original S3 key as `available` and do not write a second object. The purge task already refuses to delete a row whose key is the native file.
- If `ogrinfo` cannot count features, fail the vector job. Today a failed count is treated as 0, which sends a large file down the FlatGeobuf path.

### 3. Unblock the frontend for those formats

[`src/web/src/pages/DatasetInfo.jsx`](src/web/src/pages/DatasetInfo.jsx) `previewExcluded` hides xlsx, GeoJSON, GeoPackage, GeoParquet, FlatGeobuf, PMTiles, GeoTIFF, and COG even when the API sends a `viewer`. Remove those types from the exclusion. The eye icon and the green dot already render from `viewer` and `cloud_native_available` once a file is allowed.

[`src/web/src/components/visualize/VectorMapViewer.jsx`](src/web/src/components/visualize/VectorMapViewer.jsx) sets map bounds for FlatGeobuf only. For PMTiles, read the archive header (`minLon`, `minLat`, `maxLon`, `maxLat`) and the real vector layer name, then set `maxBounds` from that extent. The layer is currently hard-coded to `source-layer="default"`. Raster maps already restrict panning from the TiTiler bounds response.

Documents use the JavaScript package `preview-file`, lazy-loaded only when `viewer` is `document`. [`src/web/src/components/visualize/DocumentViewer.jsx`](src/web/src/components/visualize/DocumentViewer.jsx) currently renders with `react-pdf`, and that package is struck out of the frontend spec. Replace that viewer with `preview-file` and drop `react-pdf` from the document path. Chart code stays on `d3` in the browser. The server still only returns the aggregated rows.

## Left as they are

- Celery `conversion-worker` runs LibreOffice, DuckDB, and GDAL. DuckDB prepares Parquet and chart aggregates. D3 draws the chart in the browser.
- Image, text, and media viewers stay in addition to document, table chart, vector map, and raster map.
