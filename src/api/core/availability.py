"""Dataset availability levels and visibility helpers."""

from typing import Optional
from uuid import UUID

from models.dataset import Dataset
from models.dataset_owner import DatasetOwner
from models.user import User
from sqlalchemy import and_, exists, or_, select, true
from sqlalchemy.sql.elements import ColumnElement

AVAILABILITY_PUBLIC = 0
AVAILABILITY_PRIVATE = 1
AVAILABILITY_ORGANIZATION = 2
AVAILABILITY_ADMINS = 3
AVAILABILITY_OWNERS = 4

AVAILABILITY_MIN = 0
AVAILABILITY_MAX = 4

AVAILABILITY_LABELS = {
    AVAILABILITY_PUBLIC: "Public",
    AVAILABILITY_PRIVATE: "Private",
    AVAILABILITY_ORGANIZATION: "Organization",
    AVAILABILITY_ADMINS: "Admins",
    AVAILABILITY_OWNERS: "Owners",
}


def parse_availability(value) -> int:
    """Coerce input to an availability int; invalid values become public."""
    if value is None or value is False:
        return AVAILABILITY_PUBLIC
    if value is True:
        return AVAILABILITY_ORGANIZATION
    try:
        level = int(value)
    except (TypeError, ValueError):
        return AVAILABILITY_PUBLIC
    if level < AVAILABILITY_MIN or level > AVAILABILITY_MAX:
        return AVAILABILITY_PUBLIC
    return level


def clamp_availability_for_org(availability: int, org_is_private: bool) -> int:
    """Restricted levels (1–4) are allowed only when the organization is private."""
    level = parse_availability(availability)
    if level != AVAILABILITY_PUBLIC and not org_is_private:
        return AVAILABILITY_PUBLIC
    return level


def viewer_can_see_dataset(
    *,
    availability: int,
    dataset_organization: str,
    creator_id: UUID,
    viewer: Optional[User],
    is_owner: bool,
) -> bool:
    """Whether a viewer may see or download a dataset (creator always can)."""
    level = parse_availability(availability)
    if level == AVAILABILITY_PUBLIC:
        return True
    if viewer is None:
        return False
    if viewer.is_superuser or viewer.id == creator_id:
        return True
    if level == AVAILABILITY_PRIVATE:
        return False
    if level == AVAILABILITY_ORGANIZATION:
        return viewer.organization == dataset_organization
    if level == AVAILABILITY_ADMINS:
        if is_owner:
            return True
        return viewer.organization == dataset_organization and viewer.role == 1
    if level == AVAILABILITY_OWNERS:
        return is_owner
    return False


def approved_dataset_visibility_clause(user: Optional[User]) -> ColumnElement:
    """SQLAlchemy filter for listing approved datasets a viewer may see."""
    public = Dataset.availability == AVAILABILITY_PUBLIC
    if user is None:
        return public
    if user.is_superuser:
        return true()
    owner_exists = exists(
        select(DatasetOwner.user_id).where(
            DatasetOwner.dataset_id == Dataset.dataset_id,
            DatasetOwner.user_id == user.id,
        )
    )
    return or_(
        public,
        Dataset.creator == user.id,
        and_(
            Dataset.availability == AVAILABILITY_ORGANIZATION,
            Dataset.organization == user.organization,
        ),
        and_(
            Dataset.availability == AVAILABILITY_ADMINS,
            Dataset.organization == user.organization,
            user.role == 1,
        ),
        and_(
            Dataset.availability.in_(
                (AVAILABILITY_ADMINS, AVAILABILITY_OWNERS)
            ),
            owner_exists,
        ),
    )


def search_visibility_sql(user: Optional[User]) -> tuple[str, dict]:
    """SQL fragment and bind params for global_search_index visibility."""
    if user is None:
        return "availability = 0", {}
    if user.is_superuser:
        return "true", {}
    sql = """
    (
      availability = 0
      OR EXISTS (
        SELECT 1 FROM datasets d
        WHERE d.dataset_id = global_search_index.dataset_id
          AND d.creator = :viewer_id
      )
      OR (availability = 2 AND organization_id = :viewer_org)
      OR (availability = 3 AND organization_id = :viewer_org AND :viewer_role = 1)
      OR (
        availability IN (3, 4)
        AND EXISTS (
          SELECT 1 FROM dataset_owners o
          WHERE o.dataset_id = global_search_index.dataset_id
            AND o.user_id = :viewer_id
        )
      )
    )
    """
    return sql, {
        "viewer_id": user.id,
        "viewer_org": user.organization,
        "viewer_role": user.role,
    }
