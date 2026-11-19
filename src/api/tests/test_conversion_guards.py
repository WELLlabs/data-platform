import subprocess
from pathlib import Path

import pytest
from services.conversion import ConversionError, _count_features, is_cog


def test_count_features_fails_when_ogrinfo_missing(monkeypatch):
    monkeypatch.setattr("services.conversion.shutil.which", lambda name: None)
    with pytest.raises(ConversionError, match="ogrinfo"):
        _count_features(Path("layer.geojson"), 30)


def test_count_features_fails_when_count_is_absent(monkeypatch):
    monkeypatch.setattr("services.conversion._ogrinfo", lambda: "ogrinfo")

    def _run(cmd, timeout):
        return subprocess.CompletedProcess(cmd, 0, stdout="Layer name: roads\n", stderr="")

    monkeypatch.setattr("services.conversion._run", _run)
    with pytest.raises(ConversionError, match="count"):
        _count_features(Path("layer.geojson"), 30)


def test_count_features_ignores_unknown_counts(monkeypatch):
    monkeypatch.setattr("services.conversion._ogrinfo", lambda: "ogrinfo")

    def _run(cmd, timeout):
        return subprocess.CompletedProcess(
            cmd, 0, stdout="Feature Count: -1\nFeature Count: 12\n", stderr=""
        )

    monkeypatch.setattr("services.conversion._run", _run)
    assert _count_features(Path("layer.geojson"), 30) == 12


def test_is_cog_reads_layout(monkeypatch, tmp_path):
    src = tmp_path / "scene.tif"
    src.write_bytes(b"not-a-real-tiff")
    monkeypatch.setattr(
        "services.conversion.shutil.which",
        lambda name: "/usr/bin/gdal" if name == "gdal" else None,
    )
    seen = {}

    def _run(cmd, timeout, env=None):
        seen["cmd"] = cmd
        return subprocess.CompletedProcess(
            cmd,
            0,
            stdout=f"{src}: GTiff, layout=COG, has CRS, has geotransform\n",
            stderr="",
        )

    monkeypatch.setattr("services.conversion._run", _run)
    assert is_cog(src, 30) is True
    assert seen["cmd"][:4] == ["/usr/bin/gdal", "dataset", "identify", str(src)]
    assert seen["cmd"][-1] == "--detailed"


def test_is_cog_is_false_for_a_plain_geotiff(monkeypatch, tmp_path):
    src = tmp_path / "scene.tif"
    src.write_bytes(b"x")
    monkeypatch.setattr(
        "services.conversion.shutil.which",
        lambda name: "/usr/bin/gdal" if name == "gdal" else None,
    )

    def _run(cmd, timeout, env=None):
        return subprocess.CompletedProcess(
            cmd, 0, stdout=f"{src}: GTiff, has CRS, has geotransform\n", stderr=""
        )

    monkeypatch.setattr("services.conversion._run", _run)
    assert is_cog(src, 30) is False


def test_is_cog_is_false_without_gdal(monkeypatch, tmp_path):
    src = tmp_path / "scene.tif"
    src.write_bytes(b"x")
    monkeypatch.setattr("services.conversion.shutil.which", lambda name: None)
    assert is_cog(src, 30) is False
