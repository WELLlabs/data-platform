from services.raster_georef import GEOREF_ASSUMED, GEOREF_OK, GEOREF_UNPLACEABLE
from services.raster_inspect import (
    georef_from_gdalinfo,
    gdalinfo_json,
    layout_is_cog,
    plan_raster,
    verify_output,
)
from tests.test_raster_georef import CANDIDATES, LULC_GT, SOUTH_ASIA

WGS84_WKT = (
    'GEOGCRS["WGS 84",DATUM["World Geodetic System 1984",ELLIPSOID["WGS 84",'
    '6378137,298.257223563]],CS[ellipsoidal,2],AXIS["latitude",north],'
    'AXIS["longitude",east],ANGLEUNIT["degree",0.0174532925199433],ID["EPSG",4326]]'
)


def doc(gt=(77.0, 0.001, 0.0, 13.0, 0.0, -0.001), wkt=WGS84_WKT, size=(600, 600), cog=True, gcps=None):
    out = {"driver": "GTiff", "size": list(size), "bands": [{"band": 1, "type": "Byte"}]}
    if gt is not None:
        out["geoTransform"] = list(gt)
    if wkt is not None:
        out["coordinateSystem"] = {"wkt": wkt, "dataAxisToSRSAxisMapping": [2, 1]}
    if cog:
        out["metadata"] = {"IMAGE_STRUCTURE": {"LAYOUT": "COG", "COMPRESSION": "DEFLATE"}}
    if gcps:
        out["gcps"] = {"gcpList": gcps}
    return out


def never():
    raise AssertionError("structural check should not run")


def plan(d, structural=never):
    return plan_raster(d, structural, CANDIDATES, SOUTH_ASIA)


def test_parsing_gdalinfo_json():
    g = georef_from_gdalinfo(doc())
    assert (g.width, g.height) == (600, 600)
    assert g.geotransform == [77.0, 0.001, 0.0, 13.0, 0.0, -0.001]
    assert g.crs.startswith("GEOGCRS")
    assert layout_is_cog(doc()) and not layout_is_cog(doc(cog=False))
    empty = georef_from_gdalinfo({"size": [5, 5], "coordinateSystem": {"wkt": ""}})
    assert empty.crs is None and empty.geotransform is None


def test_sound_cog_is_served_as_uploaded():
    p = plan(doc())
    assert p.reuse_native and p.decision.status == GEOREF_OK


def test_cog_written_without_layout_tag_is_found_by_structure():
    p = plan(doc(cog=False), structural=lambda: True)
    assert p.reuse_native


def test_sound_plain_geotiff_is_converted():
    p = plan(doc(cog=False), structural=lambda: False)
    assert not p.reuse_native and p.decision.assign_crs is None


def test_mislabelled_cog_is_rewritten_with_the_right_crs():
    p = plan(doc(gt=LULC_GT, size=(62271, 63818)))
    assert not p.reuse_native
    assert p.decision.status == GEOREF_ASSUMED and p.decision.assign_crs == "EPSG:7755"


def test_unplaceable_file_is_not_rewritten():
    p = plan(doc(gt=None, wkt=None))
    assert p.reuse_native and p.decision.status == GEOREF_UNPLACEABLE


def test_gcp_file_is_warped():
    p = plan(doc(gt=None, gcps=[{"pixel": 0, "line": 0, "x": 77, "y": 13}]))
    assert not p.reuse_native and p.decision.warp_gcps


def test_verified_derivative_keeps_the_assumption_note():
    expected = plan(doc(gt=LULC_GT, size=(62271, 63818))).decision
    fixed = doc(gt=LULC_GT, size=(62271, 63818), wkt="EPSG:7755")
    out = verify_output(fixed, expected, CANDIDATES, SOUTH_ASIA)
    assert out.status == GEOREF_ASSUMED and out.note == expected.note


def test_derivative_that_is_still_wrong_is_unplaceable():
    expected = plan(doc(gt=LULC_GT, size=(62271, 63818))).decision
    still_wrong = doc(gt=LULC_GT, size=(62271, 63818))
    assert verify_output(still_wrong, expected, CANDIDATES, SOUTH_ASIA).status == GEOREF_UNPLACEABLE


def test_gdalinfo_reads_presigned_urls_without_head(monkeypatch):
    seen = {}

    class Proc:
        stdout = '{"size": [1, 1]}'

    def run(cmd, timeout, env):
        seen["cmd"], seen["env"] = cmd, env
        return Proc()

    monkeypatch.setattr("services.raster_inspect.shutil.which", lambda name: "/usr/bin/gdalinfo")
    assert gdalinfo_json("/vsicurl/https://s3/x.tif?X-Amz-Signature=1", run) == {"size": [1, 1]}
    assert seen["env"]["CPL_VSIL_CURL_USE_HEAD"] == "NO"
    assert seen["cmd"][:2] == ["/usr/bin/gdalinfo", "-json"]
