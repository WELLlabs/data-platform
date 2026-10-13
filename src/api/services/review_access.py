"""Pure rules for who may edit dataset and file metadata during review."""


def reviewer_may_edit_metadata(
    *, is_approved: bool, same_org: bool, high_role: bool
) -> bool:
    """Approvers may correct metadata only while the submission is still pending."""
    return (not is_approved) and same_org and high_role


def metadata_edit_allowed(
    *,
    is_creator_or_owner: bool,
    is_approved: bool,
    same_org: bool,
    high_role: bool,
) -> bool:
    if is_creator_or_owner:
        return True
    return reviewer_may_edit_metadata(
        is_approved=is_approved, same_org=same_org, high_role=high_role
    )
