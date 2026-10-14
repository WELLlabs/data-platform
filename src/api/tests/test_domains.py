from types import SimpleNamespace

from utils.security import organization_accepts_email, registration_email_error


def test_multiple_domains_and_case():
    allowed = "ifmr.ac.in, welllabs.org"
    assert registration_email_error("Ada@WellLabs.org", allowed) is None
    assert registration_email_error("ada@ifmr.ac.in", allowed) is None
    assert registration_email_error("ada@gmail.com", allowed) == "Email domain is not allowed"


def test_malformed_addresses():
    for email in ("", "ada", "ada@", "@welllabs.org", "ada @welllabs.org", "a@b"):
        assert registration_email_error(email, "") == "Invalid email address"


def test_empty_allowlist_permits_any_well_formed_domain():
    assert registration_email_error("ada@custom.example", "") is None


def test_password_only_and_google_only_organisations():
    custom = SimpleNamespace(
        allowed_email_domains=["custom.example"],
        allow_password=True,
        allow_google=False,
    )
    google = SimpleNamespace(
        allowed_email_domains=["welllabs.org"],
        allow_password=False,
        allow_google=True,
    )
    assert organization_accepts_email(custom, "ada@custom.example", "password", "") is None
    assert (
        organization_accepts_email(custom, "ada@custom.example", "google", "")
        == "This organisation does not accept Google sign-in"
    )
    assert organization_accepts_email(google, "ada@welllabs.org", "google", "welllabs.org,custom.example") is None
    assert (
        organization_accepts_email(google, "ada@custom.example", "password", "welllabs.org,custom.example")
        == "This organisation does not accept that email domain"
    )


def test_profile_email_change_outside_allowlist():
    org = SimpleNamespace(allowed_email_domains=None, allow_password=True, allow_google=True)
    assert (
        organization_accepts_email(org, "ada@elsewhere.org", "password", "welllabs.org")
        == "Email domain is not allowed"
    )


def test_unset_org_domains_keep_global_rule_only():
    org = SimpleNamespace(allowed_email_domains=None, allow_password=True, allow_google=True)
    assert organization_accepts_email(org, "ada@custom.example", "password", "") is None
