import logging
from typing import List, Optional
from uuid import UUID, uuid4

from db.session import get_session
from fastapi import Depends, HTTPException, status
from models.organization import Organization
from models.user import User
from models.user_contribution import UserContribution
from schemas.organization import (
    OrganizationCreate,
    OrganizationSearch,
    OrganizationUpdate,
)
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession


class OrganizationService:
    """
    Service class for organization operations with comprehensive validation and security.
    """

    def __init__(self, session: AsyncSession):
        self.session = session
        self.logger = logging.getLogger(__name__)

    @staticmethod
    def coerce_org_id(org_id: UUID | str) -> UUID:
        if isinstance(org_id, UUID):
            return org_id
        return UUID(str(org_id).strip())

    @staticmethod
    def generate_organization_id(name: str | None = None) -> UUID:
        """Stable unique org primary key (UUID). Name is display-only."""
        return uuid4()

    async def validate_organization_id(self, org_id: str) -> bool:
        """
        Validate if organization ID exists in the database.

        Args:
            org_id: Organization ID to validate

        Returns:
            True if organization exists, False otherwise
        """
        try:
            self.logger.info("Validating organization ID: %s", org_id)
            try:
                org_uuid = self.coerce_org_id(org_id)
            except (ValueError, TypeError, AttributeError):
                return False

            query = select(Organization).where(Organization.id == org_uuid)
            result = await self.session.execute(query)
            organization = result.scalar_one_or_none()

            exists = organization is not None
            self.logger.info("Organization ID validation result: %s", exists)

            return exists

        except Exception as e:
            self.logger.exception("Error validating organization ID %s: %s", org_id, e)
            return False

    async def get_organization_by_id(self, org_id: str) -> Optional[Organization]:
        """
        Get organization by ID.

        Args:
            org_id: Organization ID

        Returns:
            Organization object or None if not found
        """
        try:
            self.logger.info("Fetching organization by ID: %s", org_id)
            try:
                org_uuid = self.coerce_org_id(org_id)
            except (ValueError, TypeError, AttributeError):
                return None

            query = select(Organization).where(Organization.id == org_uuid)
            result = await self.session.execute(query)
            organization = result.scalar_one_or_none()

            if organization:
                self.logger.info("Organization found: %s", organization.name)
            else:
                self.logger.info("Organization not found: %s", org_id)

            return organization

        except Exception as e:
            self.logger.exception("Error fetching organization %s: %s", org_id, e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error fetching organization",
            )

    async def get_organization_with_details(
        self, org_id: str
    ) -> Optional[dict]:
        """
        Get organization by ID with creator name and members.

        Args:
            org_id: Organization ID

        Returns:
            Dictionary containing organization data with creator_name and members,
            or None if organization not found
        """
        try:
            self.logger.info("Fetching organization with details: %s", org_id)

            # Get organization
            organization = await self.get_organization_by_id(org_id)
            if not organization:
                return None

            # Get creator's full_name
            creator_name = None
            if organization.creator:
                creator_query = select(User).where(User.id == organization.creator)
                creator_result = await self.session.execute(creator_query)
                creator_user = creator_result.scalar_one_or_none()
                if creator_user:
                    creator_name = creator_user.full_name
                    self.logger.info(
                        "Creator found: %s (ID: %s)", creator_name, organization.creator
                    )

            # Get all members
            members_query = select(User).where(
                User.organization == organization.id
            )
            members_result = await self.session.execute(members_query)
            members_users = members_result.scalars().all()

            # Get contributions for all members from user_contributions
            member_ids = [m.id for m in members_users]
            contributions_map: dict[UUID, int] = {}
            if member_ids:
                uc_result = await self.session.execute(
                    select(UserContribution).where(
                        UserContribution.user_id.in_(member_ids)
                    )
                )
                for uc in uc_result.scalars().all():
                    contributions_map[uc.user_id] = (
                        contributions_map.get(uc.user_id, 0) + uc.contributions
                    )

            members = []
            org_contributions_sum = 0
            for member in members_users:
                contributions = contributions_map.get(member.id, 0)
                org_contributions_sum += contributions
                members.append(
                    {
                        "full_name": member.full_name,
                        "id": str(member.id),
                        "designation": member.designation,
                        "email": member.email,
                        "role": member.role,
                        "contributions": contributions,
                        "verified": member.verified,
                    }
                )

            self.logger.info("Found %d members for organization %s", len(members), org_id)

            # Build response dictionary (contributions = sum of all members' contributions)
            org_dict = {
                "id": organization.id,
                "name": organization.name,
                "creator": organization.creator,
                "description": organization.description,
                "org_type": organization.org_type,
                "contact": organization.contact,
                "website": organization.website,
                "private": organization.private,
                "focus": organization.focus,
                "roi_states": organization.roi_states,
                "created_at": organization.created_at,
                "modified_at": organization.modified_at,
                "creator_name": creator_name,
                "contributions": org_contributions_sum,
                "members": members,
            }

            return org_dict

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Error fetching organization with details %s: %s", org_id, e
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error fetching organization details",
            )

    async def create_organization(
        self,
        org_data: OrganizationCreate,
        creator_id: Optional[UUID] = None,
    ) -> Organization:
        """
        Create a new organization.

        Args:
            org_data: Organization creation data
            creator_id: Optional user id recorded as organization creator

        Returns:
            Created organization object

        Raises:
            HTTPException: If creation fails
        """
        try:
            self.logger.info("Creating organization: %s", org_data.name)

            # Create organization object
            organization = Organization(
                id=self.generate_organization_id(),
                name=org_data.name,
                description=org_data.description,
                org_type=org_data.org_type,
                contact=org_data.contact,
                website=org_data.website,
                private=org_data.private,
                focus=org_data.focus,
                roi_states=org_data.roi_states,
                allowed_email_domains=org_data.allowed_email_domains,
                allow_password=org_data.allow_password,
                allow_google=org_data.allow_google,
                creator=creator_id,
            )

            self.session.add(organization)
            await self.session.commit()
            await self.session.refresh(organization)

            self.logger.info(
                "Organization created successfully: %s (ID: %s)",
                organization.name,
                organization.id,
            )

            return organization

        except HTTPException:
            raise
        except IntegrityError as e:
            self.logger.exception("Integrity error creating organization: %s", e)
            await self.session.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Organization with this name already exists",
            )
        except Exception as e:
            self.logger.exception("Error creating organization: %s", e)
            await self.session.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error creating organization",
            )

    async def update_organization(
        self, org_id: str, org_data: OrganizationUpdate
    ) -> Optional[Organization]:
        """
        Update an existing organization.

        Args:
            org_id: Organization ID
            org_data: Organization update data

        Returns:
            Updated organization object or None if not found

        Raises:
            HTTPException: If update fails
        """
        try:
            self.logger.info("Updating organization: %s", org_id)

            # Get existing organization
            organization = await self.get_organization_by_id(org_id)
            if not organization:
                return None

            # Update fields
            update_data = org_data.dict(exclude_unset=True)

            # Update organization
            query = (
                update(Organization)
                .where(Organization.id == self.coerce_org_id(org_id))
                .values(**update_data)
            )
            await self.session.execute(query)
            await self.session.commit()

            updated_org = await self.get_organization_by_id(org_id)

            self.logger.info("Organization updated successfully: %s", org_id)

            return updated_org

        except HTTPException:
            raise
        except IntegrityError as e:
            self.logger.exception("Integrity error updating organization: %s", e)
            await self.session.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Organization update failed due to constraint violation",
            )
        except Exception as e:
            self.logger.exception("Error updating organization %s: %s", org_id, e)
            await self.session.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error updating organization",
            )

    async def set_organization_creator(self, org_id: str, user_id: UUID) -> bool:
        """
        Set the creator for an organization if it doesn't already have one.

        Args:
            org_id: Organization ID
            user_id: User ID to set as creator

        Returns:
            True if creator was set, False if organization already has a creator

        Raises:
            HTTPException: If operation fails
        """
        try:
            self.logger.info("Setting creator for organization %s: %s", org_id, user_id)

            # Get organization
            organization = await self.get_organization_by_id(org_id)
            if not organization:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Organization not found",
                )

            # Check if organization already has a creator
            if organization.creator is not None:
                self.logger.info(
                    "Organization %s already has creator: %s",
                    org_id,
                    organization.creator,
                )
                return False

            # Set creator
            query = (
                update(Organization)
                .where(Organization.id == self.coerce_org_id(org_id))
                .values(creator=user_id)
            )
            await self.session.execute(query)
            await self.session.commit()

            self.logger.info("Creator set for organization %s: %s", org_id, user_id)
            return True

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Error setting creator for organization %s: %s", org_id, e
            )
            await self.session.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error setting organization creator",
            )

    async def search_organizations(
        self, search_params: OrganizationSearch
    ) -> List[Organization]:
        """
        Search organizations with filters.

        Args:
            search_params: Search parameters

        Returns:
            List of matching organizations

        Raises:
            HTTPException: If search fails
        """
        try:
            self.logger.info(
                "Searching organizations with params: %s", search_params.dict()
            )

            query = select(Organization)

            # Apply filters
            if search_params.query:
                query = query.where(Organization.name.ilike(f"%{search_params.query}%"))

            if search_params.org_type:
                query = query.where(Organization.org_type == search_params.org_type)

            if search_params.private is not None:
                query = query.where(Organization.private == search_params.private)

            # Apply pagination
            query = query.offset(search_params.offset).limit(search_params.limit)

            result = await self.session.execute(query)
            organizations = result.scalars().all()

            self.logger.info("Found %d organizations", len(organizations))

            return list(organizations)

        except Exception as e:
            self.logger.exception("Error searching organizations: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error searching organizations",
            )

    async def list_organization_ids_and_names(
        self,
    ) -> List[dict]:
        """
        Return all organizations as a list of dicts with id and name only.

        Returns:
            List of dicts: [{"id": "...", "name": "..."}, ...]

        Raises:
            HTTPException: If the query fails
        """
        try:
            self.logger.info("Listing organization ids and names")
            query = select(
                Organization.id,
                Organization.name,
                Organization.description,
                Organization.org_type,
                Organization.private,
                Organization.focus,
                Organization.roi_states,
                Organization.created_at,
                Organization.allowed_email_domains,
                Organization.allow_password,
                Organization.allow_google,
            )
            result = await self.session.execute(query)
            rows = result.all()
            items = [
                {
                    "id": row.id,
                    "name": row.name,
                    "description": row.description,
                    "org_type": row.org_type,
                    "private": bool(row.private),
                    "focus": row.focus,
                    "roi_states": row.roi_states,
                    "created_at": row.created_at,
                    "allowed_email_domains": row.allowed_email_domains,
                    "allow_password": bool(row.allow_password),
                    "allow_google": bool(row.allow_google),
                }
                for row in rows
            ]
            self.logger.info("Found %d organizations for list", len(items))
            return items
        except Exception as e:
            self.logger.exception("Error listing organization ids and names: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error listing organizations",
            )

    async def delete_organization(self, org_id: str) -> bool:
        """
        Delete an organization.

        Args:
            org_id: Organization ID

        Returns:
            True if deleted, False if not found

        Raises:
            HTTPException: If deletion fails
        """
        try:
            self.logger.info("Deleting organization: %s", org_id)

            # Check if organization exists
            organization = await self.get_organization_by_id(org_id)
            if not organization:
                return False

            # Delete organization
            query = delete(Organization).where(
                Organization.id == self.coerce_org_id(org_id)
            )
            await self.session.execute(query)
            await self.session.commit()

            self.logger.info("Organization deleted successfully: %s", org_id)

            return True

        except Exception as e:
            self.logger.exception("Error deleting organization %s: %s", org_id, e)
            await self.session.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error deleting organization",
            )

    async def add_member(
        self,
        org_id: UUID | str,
        actor: User,
        email: str,
        role: int = 0,
        approve_now: bool = False,
    ) -> User:
        """Add an existing user to this organization by email."""
        org_uuid = self.coerce_org_id(org_id)
        organization = await self.get_organization_by_id(org_uuid)
        if not organization:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Organization not found",
            )
        is_admin = actor.role == 1 and actor.organization == org_uuid
        if not (actor.is_superuser or is_admin):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only organization admins can add members",
            )
        if role not in (0, 1, 2):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid role",
            )
        email_norm = email.strip().lower()
        result = await self.session.execute(
            select(User).where(func.lower(User.email) == email_norm)
        )
        target = result.scalar_one_or_none()
        if target is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No account exists for that email. Ask them to sign up first.",
            )
        if target.organization is not None and target.organization != org_uuid:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="That user already belongs to another organization",
            )
        if target.organization == org_uuid and target.verified:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="That user is already a member of this organization",
            )
        target.organization = org_uuid
        target.role = role
        target.verified = bool(approve_now)
        uc_result = await self.session.execute(
            select(UserContribution).where(UserContribution.user_id == target.id)
        )
        if uc_result.scalar_one_or_none() is None:
            self.session.add(
                UserContribution(
                    user_id=target.id,
                    organization_id=org_uuid,
                    contributions=0,
                )
            )
        await self.session.commit()
        await self.session.refresh(target)
        return target


# Dependency to get organization service
async def get_organization_service(
    session: AsyncSession = Depends(get_session),
) -> OrganizationService:
    return OrganizationService(session)
