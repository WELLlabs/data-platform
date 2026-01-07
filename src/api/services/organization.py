import logging
import re
from typing import List, Optional
from uuid import UUID

from db.session import get_session
from fastapi import Depends, HTTPException, status
from models.organization import Organization
from models.user import User
from schemas.organization import (
    OrganizationCreate,
    OrganizationSearch,
    OrganizationUpdate,
)
from sqlalchemy import delete, select, update
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
    def generate_organization_id(name: str) -> str:
        """
        Generate organization ID from name by making it lowercase,
        removing special characters, and replacing spaces with hyphens.

        Args:
            name: Organization name

        Returns:
            Generated organization ID
        """
        # Convert to lowercase
        org_id = name.lower()

        # Remove special characters except hyphens and alphanumeric
        org_id = re.sub(r"[^a-z0-9\s-]", "", org_id)

        # Replace spaces with hyphens
        org_id = re.sub(r"\s+", "-", org_id)

        # Remove multiple consecutive hyphens
        org_id = re.sub(r"-+", "-", org_id)

        # Remove leading/trailing hyphens
        org_id = org_id.strip("-")

        return org_id

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

            query = select(Organization).where(Organization.id == org_id)
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

            query = select(Organization).where(Organization.id == org_id)
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
            members_query = select(User).where(User.organization == org_id)
            members_result = await self.session.execute(members_query)
            members_users = members_result.scalars().all()

            members = []
            for member in members_users:
                members.append(
                    {
                        "full_name": member.full_name,
                        "id": str(member.id),
                        "designation": member.designation,
                        "email": member.email,
                        "role": member.role,
                        "contributions": member.contributions,
                        "verified": member.verified,
                    }
                )

            self.logger.info("Found %d members for organization %s", len(members), org_id)

            # Build response dictionary
            org_dict = {
                "id": organization.id,
                "name": organization.name,
                "creator": organization.creator,
                "description": organization.description,
                "org_type": organization.org_type,
                "contact": organization.contact,
                "website": organization.website,
                "private": organization.private,
                "contributions": organization.contributions,
                "focus": organization.focus,
                "roi_states": organization.roi_states,
                "created_at": organization.created_at,
                "modified_at": organization.modified_at,
                "creator_name": creator_name,
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

    async def create_organization(self, org_data: OrganizationCreate) -> Organization:
        """
        Create a new organization.

        Args:
            org_data: Organization creation data

        Returns:
            Created organization object

        Raises:
            HTTPException: If creation fails
        """
        try:
            self.logger.info("Creating organization: %s", org_data.name)

            # Generate organization ID
            org_id = self.generate_organization_id(org_data.name)

            # Check if organization with this ID already exists
            if await self.validate_organization_id(org_id):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Organization with name '{org_data.name}' already exists",
                )

            # Create organization object
            organization = Organization(
                id=org_id,
                name=org_data.name,
                description=org_data.description,
                org_type=org_data.org_type,
                contact=org_data.contact,
                website=org_data.website,
                private=org_data.private,
                focus=org_data.focus,
                roi_states=org_data.roi_states,
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

            # If name is being updated, generate new ID
            if "name" in update_data:
                new_org_id = self.generate_organization_id(update_data["name"])
                if new_org_id != org_id:
                    # Check if new ID already exists
                    if await self.validate_organization_id(new_org_id):
                        raise HTTPException(
                            status_code=status.HTTP_409_CONFLICT,
                            detail=f"Organization with name '{update_data['name']}' already exists",
                        )
                    update_data["id"] = new_org_id

            # Update organization
            query = (
                update(Organization)
                .where(Organization.id == org_id)
                .values(**update_data)
            )
            await self.session.execute(query)
            await self.session.commit()

            # Fetch updated organization
            updated_org = await self.get_organization_by_id(
                update_data.get("id", org_id)
            )

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
                .where(Organization.id == org_id)
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
            query = delete(Organization).where(Organization.id == org_id)
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


# Dependency to get organization service
async def get_organization_service(
    session: AsyncSession = Depends(get_session),
) -> OrganizationService:
    return OrganizationService(session)
