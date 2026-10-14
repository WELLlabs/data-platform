from utils.filenames import FilenameError, file_extension, sanitize_storage_filename


def test_keeps_edited_basename_and_original_extension():
    assert sanitize_storage_filename("rainfall.final.csv", "rain.csv") == "rainfall.final.csv"


def test_rejects_extension_change():
    try:
        sanitize_storage_filename("rain.txt", "rain.csv")
    except FilenameError as exc:
        assert "extension" in str(exc)
    else:
        raise AssertionError("expected FilenameError")


def test_rejects_empty_dot_and_path():
    for name in ("", ".", "..", "   "):
        try:
            sanitize_storage_filename(name, "a.csv")
        except FilenameError:
            continue
        raise AssertionError(name)
    assert sanitize_storage_filename("folder/rain.csv", "rain.csv") == "rain.csv"
    assert file_extension("archive.tar.gz") == "gz"


def test_does_not_html_escape_ampersand():
    assert sanitize_storage_filename("Q&A.csv", "Q&A.csv") == "Q&A.csv"


def test_rejects_overlong_name():
    stem = "a" * 210
    try:
        sanitize_storage_filename(f"{stem}.csv", "x.csv")
    except FilenameError as exc:
        assert "too long" in str(exc)
    else:
        raise AssertionError("expected FilenameError")
