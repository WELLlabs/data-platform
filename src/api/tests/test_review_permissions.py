from services.review_access import metadata_edit_allowed


def test_approver_can_edit_pending_dataset():
    assert metadata_edit_allowed(
        is_creator_or_owner=False,
        is_approved=False,
        same_org=True,
        high_role=True,
    )


def test_member_cannot_edit():
    assert not metadata_edit_allowed(
        is_creator_or_owner=False,
        is_approved=False,
        same_org=True,
        high_role=False,
    )


def test_approver_cannot_edit_after_approval():
    assert not metadata_edit_allowed(
        is_creator_or_owner=False,
        is_approved=True,
        same_org=True,
        high_role=True,
    )


def test_owner_can_still_edit_after_approval():
    assert metadata_edit_allowed(
        is_creator_or_owner=True,
        is_approved=True,
        same_org=False,
        high_role=False,
    )


def test_approver_from_another_organisation_cannot_edit():
    assert not metadata_edit_allowed(
        is_creator_or_owner=False,
        is_approved=False,
        same_org=False,
        high_role=True,
    )
