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
        lambda name: "/usr/bin/gdalinfo" if name == "gdalinfo" else None,
    )

    def _run(cmd, timeout):
        return subprocess.CompletedProcess(cmd, 0, stdout="LAYOUT=COG\n", stderr="")

    monkeypatch.setattr("services.conversion._run", _run)
    assert is_cog(src, 30) is True


def test_is_cog_is_false_without_gdalinfo(monkeypatch, tmp_path):
    src = tmp_path / "scene.tif"
    src.write_bytes(b"x")
    monkeypatch.setattr("services.conversion.shutil.which", lambda name: None)
    assert is_cog(src, 30) is False
