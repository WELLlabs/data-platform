import io
import zipfile

from services.zip_stream import open_dataset_download


def _read(payloads):
    def read_chunks(member):
        yield payloads[member["arcname"]]

    return read_chunks


def test_single_file_is_raw_bytes():
    members = [{"arcname": "rain.csv"}]
    media, name, body = open_dataset_download(
        members, _read({"rain.csv": b"a,b\n1,2\n"}), "dataset.zip"
    )
    assert media == "text/csv"
    assert name == "rain.csv"
    assert b"".join(body) == b"a,b\n1,2\n"


def test_multiple_files_are_a_zip():
    members = [{"arcname": "rain.csv"}, {"arcname": "notes.txt"}]
    media, name, body = open_dataset_download(
        members,
        _read({"rain.csv": b"csv", "notes.txt": b"notes"}),
        "rainfall.zip",
    )
    assert media == "application/zip"
    assert name == "rainfall.zip"
    with zipfile.ZipFile(io.BytesIO(b"".join(body))) as archive:
        assert archive.read("rain.csv") == b"csv"
        assert archive.read("notes.txt") == b"notes"
