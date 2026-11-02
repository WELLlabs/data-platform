import pytest

from services.raster_georef import (
    GEOREF_ASSUMED,
    GEOREF_OK,
    GEOREF_UNPLACEABLE,
    RasterGeoref,
    assess,
    native_bounds,
    parse_candidates,
    parse_region,
)

CANDIDATES = parse_candidates(
    "EPSG:7755,EPSG:3857,EPSG:32642,EPSG:32643,EPSG:32644,EPSG:32645,EPSG:32646,EPSG:32647"
)
SOUTH_ASIA = parse_region("60,-5,105,40")

# NRSC LULC 250K 2015-16 as uploaded: labelled EPSG:4326, coordinates in metres.
LULC_GT = (2412614.784555125, 56.0, 0.0, 5595613.480211262, 0.0, -56.0)


def run(width, height, gt, crs=None, gcps=False):
    return assess(RasterGeoref(width, height, gt, crs, gcps), CANDIDATES, SOUTH_ASIA)


def test_lulc_labelled_wgs84_in_metres_is_placed_with_india_lcc():
    d = run(62271, 63818, LULC_GT, "EPSG:4326")
    assert d.status == GEOREF_ASSUMED
    assert d.assign_crs == "EPSG:7755"
    west, south, east, north = d.wgs84_bounds
    assert 60 < west < 70 and 95 < east < 105 and 0 < south < 10 and 35 < north < 40
    assert "EPSG:7755" in d.note and "metres" in d.note


def test_sound_wgs84_and_utm_files_are_ok():
    assert run(600, 600, (77.0, 0.001, 0, 13.0, 0, -0.001), "EPSG:4326").status == GEOREF_OK
    utm = run(600, 600, (600000, 30, 0, 1450000, 0, -30), "EPSG:32643")
    assert utm.status == GEOREF_OK and utm.assign_crs is None


def test_global_grid_a_hair_past_the_antimeridian_is_ok():
    d = run(3600, 1800, (-180.00001, 0.1, 0, 90.00001, 0, -0.1), "EPSG:4326")
    assert d.status == GEOREF_OK


def test_zero_to_360_longitudes_are_ok():
    assert run(3600, 1800, (0, 0.1, 0, 90, 0, -0.1), "EPSG:4326").status == GEOREF_OK


def test_missing_crs_with_degree_coordinates_assumes_wgs84():
    d = run(600, 600, (77.0, 0.001, 0, 13.0, 0, -0.001), None)
    assert d.status == GEOREF_ASSUMED and d.assign_crs == "EPSG:4326"


def test_missing_crs_with_utm_coordinates_is_ambiguous():
    # Every UTM zone over India fits, so no zone is guessed.
    d = run(600, 600, (600000, 30, 0, 1450000, 0, -30), None)
    assert d.status == GEOREF_UNPLACEABLE
    assert "Several projections fit" in d.note


def test_projected_label_with_degree_coordinates_assumes_wgs84():
    d = run(1000, 1000, (77.0, 0.001, 0, 13.0, 0, -0.001), "EPSG:32643")
    assert d.status == GEOREF_ASSUMED and d.assign_crs == "EPSG:4326"


def test_metres_outside_the_region_are_not_guessed():
    # Web Mercator metres over Europe: no candidate lands in South Asia.
    d = run(1000, 1000, (1000000, 10, 0, 6500000, 0, -10), "EPSG:4326")
    assert d.status == GEOREF_UNPLACEABLE
    assert "None of the common projections" in d.note


def test_gcps_only_are_warped():
    d = run(500, 500, None, None, gcps=True)
    assert d.status == GEOREF_ASSUMED and d.warp_gcps and d.needs_rewrite


def test_no_location_at_all_is_unplaceable():
    d = run(500, 500, None, None)
    assert d.status == GEOREF_UNPLACEABLE and "no location information" in d.note


def test_unreadable_crs_is_treated_as_missing():
    d = run(600, 600, (77.0, 0.001, 0, 13.0, 0, -0.001), "NOT A CRS")
    assert d.status == GEOREF_ASSUMED and d.assign_crs == "EPSG:4326"


@pytest.mark.parametrize(
    "gt",
    [(0, 0, 0, 0, 0, 0), (1, float("nan"), 0, 1, 0, -1), (1, 2, 3)],
)
def test_degenerate_geotransforms_have_no_bounds(gt):
    assert native_bounds(gt, 10, 10) is None


def test_rotated_grid_uses_all_corners():
    assert native_bounds((0, 1, 1, 0, 1, -1), 10, 10) == (0, -10, 20, 10)


def test_bad_region_falls_back_to_world():
    assert parse_region("nonsense") == (-180.0, -90.0, 180.0, 90.0)
    assert parse_region("10,10,5,5") == (-180.0, -90.0, 180.0, 90.0)
