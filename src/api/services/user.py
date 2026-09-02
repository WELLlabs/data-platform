"""
User service for handling user data retrieval and validation operations.

This service provides methods to:
- Retrieve user data by API key
- Validate user permissions and relationships
- Check email/org verification (verified and is_verified flags)
- Check dataset ownership and organization membership
"""

import logging
from typing import Any, Optional
from uuid import UUID

from db.session import get_session
from fastapi import Depends, HTTPException, status
from models.dataset import Dataset
from models.user import User
from models.user_contribution import UserContribution
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from utils.security import mask_apikey

logger = logging.getLogger(__name__)


class UserService:
    """
    Service class for user operations with comprehensive validation and security.

    This service handles:
    - User data retrieval by API key
    - User permission validation (superuser, admin, high role)
    - Verified-user checks (verified and is_verified)
    - Dataset ownership validation
    - User-organization relationship validation
    """

    def __init__(self, session: AsyncSession):
        self.session = session
        self.logger = logging.getLogger(__name__)

    async def get_user_by_apikey(self, apikey: str) -> Optional[dict]:
        """
        Get user data by API key.

        Args:
            apikey: API key of the user

        Returns:
            Dictionary containing user data with fields:
            id, full_name, email, designation, organization,
            role, phone, contributions, created_at, modified_at, verified,
            is_superuser, is_verified
            Returns None if user not found
        """
        try:
            self.logger.info("Fetching user by apikey: %s", mask_apikey(apikey))

            query = select(User).where(User.apikey == apikey)
            result = await self.session.execute(query)
            user: Optional[User] = result.scalar_one_or_none()

            if user is None:
                self.logger.info("User not found for apikey: %s", mask_apikey(apikey))
                return None

            try:
                contributions = await self.get_contributions_for_user(user.id)
            except Exception as e:
                self.logger.warning(
                    "Contributions fetch failed for user_id=%s, defaulting to 0: %s",
                    user.id,
                    e,
                )
                contributions = 0

            user_data = {
                "id": user.id,
                "full_name": user.full_name,
                "email": user.email,
                "designation": user.designation,
                "organization": user.organization,
                "role": user.role,
                "phone": user.phone,
                "contributions": contributions,
                "created_at": user.created_at,
                "modified_at": user.modified_at,
                "verified": user.verified,
                "is_superuser": user.is_superuser,
                "is_verified": user.is_verified,
            }

            self.logger.info("User found: user_id=%s, email=%s", user.id, user.email)
            return user_data

        except Exception as e:
            self.logger.exception(
                "Error fetching user by apikey %s: %s", mask_apikey(apikey), e
            )
            return None

    async def get_user_model_by_apikey(self, apikey: str) -> Optional[User]:
        """
        Get User model by API key. Returns the ORM User model directly for auth
        middleware use (e.g. download URL when session is not present).

        Args:
            apikey: API key of the user

        Returns:
            User instance or None if not found
        """
        try:
            query = select(User).where(User.apikey == apikey)
            result = await self.session.execute(query)
            return result.scalar_one_or_none()
        except Exception:
            self.logger.exception("Failed to fetch user by apikey")
            return None

    async def get_contributions_for_user(self, user_id: UUID) -> int:
        """
        Get contribution count for a user from user_contributions table.

        Args:
            user_id: User UUID

        Returns:
            Contribution count, or 0 if no row exists.

        Raises:
            Exception: Re-raised after logging if the database call fails.
        """
        try:
            result = await self.session.execute(
                select(UserContribution).where(UserContribution.user_id == user_id)
            )
            uc = result.scalar_one_or_none()
            return uc.contributions if uc else 0
        except Exception as e:
            self.logger.exception(
                "Error fetching contributions for user_id=%s: %s", user_id, e
            )
            raise

    async def check_if_superuser_by_id(self, user_id: UUID) -> bool:
        """
        Check if user is a superuser by user ID.

        Args:
            user_id: User ID to check

        Returns:
            True if user is superuser, False otherwise or if user not found
        """
        try:
            self.logger.info("Checking superuser status by user_id: %s", user_id)

            query = select(User).where(User.id == user_id)
            result = await self.session.execute(query)
            user: Optional[User] = result.scalar_one_or_none()

            if user is None:
                self.logger.info("User not found: user_id=%s", user_id)
                return False

            is_superuser = user.is_superuser
            self.logger.info(
                "Superuser check result for user_id=%s: %s", user_id, is_superuser
            )
            return is_superuser

        except Exception as e:
            self.logger.exception(
                "Error checking superuser by user_id %s: %s", user_id, e
            )
            return False

    async def check_if_superuser_by_key(self, apikey: str) -> bool:
        """
        Check if user is a superuser by API key.

        Args:
            apikey: API key of the user

        Returns:
            True if user is superuser, False otherwise or if user not found
        """
        try:
            self.logger.info("Checking superuser status by apikey: %s", mask_apikey(apikey))

            query = select(User).where(User.apikey == apikey)
            result = await self.session.execute(query)
            user: Optional[User] = result.scalar_one_or_none()

            if user is None:
                self.logger.info("User not found for apikey: %s", mask_apikey(apikey))
                return False

            is_superuser = user.is_superuser
            self.logger.info(
                "Superuser check result for apikey=%s: %s", mask_apikey(apikey), is_superuser
            )
            return is_superuser

        except Exception as e:
            self.logger.exception(
                "Error checking superuser by apikey %s: %s", mask_apikey(apikey), e
            )
            return False

    async def check_if_user_verified_by_id(self, user_id: UUID) -> bool:
        """
        Return True if both custom verified and fastapi-users is_verified are True.

        Args:
            user_id: User UUID

        Returns:
            True if both flags are True; False if not, user missing, or on error
        """
        try:
            self.logger.info("Checking verified status by user_id: %s", user_id)
            query = select(User).where(User.id == user_id)
            result = await self.session.execute(query)
            user: Optional[User] = result.scalar_one_or_none()
            if user is None:
                self.logger.info("User not found: user_id=%s", user_id)
                return False
            ok = bool(user.verified and user.is_verified)
            self.logger.info(
                "Verified check for user_id=%s: verified=%s is_verified=%s result=%s",
                user_id,
                user.verified,
                user.is_verified,
                ok,
            )
            return ok
        except Exception as e:
            self.logger.exception(
                "Error checking verified by user_id %s: %s", user_id, e
            )
            return False

    async def check_if_user_verified_by_apikey(self, apikey: str) -> bool:
        """
        Return True if both verified and is_verified for the user with this apikey.

        Args:
            apikey: User API key

        Returns:
            True if both flags are True; False if not, user missing, or on error
        """
        try:
            self.logger.info("Checking verified status by apikey")
            user = await self.get_user_model_by_apikey(apikey)
            if user is None:
                return False
            return bool(user.verified and user.is_verified)
        except Exception as e:
            self.logger.exception(
                "Error checking verified by apikey %s: %s", mask_apikey(apikey), e
            )
            return False

    async def check_if_admin_by_id(
        self, organization_id: str, user_id: UUID
    ) -> bool:
        """
        Check if user is an admin of the specified organization by user ID.

        Args:
            organization_id: Organization ID to check
            user_id: User ID to check

        Returns:
            True if user has role=1 and belongs to the organization, False otherwise
        """
        try:
            self.logger.info(
                "Checking admin status by user_id=%s for organization=%s",
                user_id,
                organization_id,
            )

            query = select(User).where(User.id == user_id)
            result = await self.session.execute(query)
            user: Optional[User] = result.scalar_one_or_none()

            if user is None:
                self.logger.info("User not found: user_id=%s", user_id)
                return False

            # Check if role is 1
            if user.role != 1:
                self.logger.info(
                    "User role is not 1: user_id=%s, role=%s", user_id, user.role
                )
                return False

            # Check if organization matches
            if user.organization != organization_id:
                self.logger.info(
                    "Organization mismatch: user_id=%s, user_org=%s, expected_org=%s",
                    user_id,
                    user.organization,
                    organization_id,
                )
                return False

            self.logger.info(
                "Admin check passed: user_id=%s, organization=%s", user_id, organization_id
            )
            return True

        except Exception as e:
            self.logger.exception(
                "Error checking admin by user_id %s for organization %s: %s",
                user_id,
                organization_id,
                e,
            )
            return False

    async def check_if_admin_by_key(
        self, organization_id: str, apikey: str
    ) -> bool:
        """
        Check if user is an admin of the specified organization by API key.

        Args:
            organization_id: Organization ID to check
            apikey: API key of the user

        Returns:
            True if user has role=1 and belongs to the organization, False otherwise
        """
        try:
            self.logger.info(
                "Checking admin status by apikey=%s for organization=%s",
                mask_apikey(apikey),
                organization_id,
            )

            query = select(User).where(User.apikey == apikey)
            result = await self.session.execute(query)
            user: Optional[User] = result.scalar_one_or_none()

            if user is None:
                self.logger.info("User not found for apikey: %s", mask_apikey(apikey))
                return False

            # Check if role is 1
            if user.role != 1:
                self.logger.info(
                    "User role is not 1: apikey=%s, role=%s", mask_apikey(apikey), user.role
                )
                return False

            # Check if organization matches
            if user.organization != organization_id:
                self.logger.info(
                    "Organization mismatch: apikey=%s, user_org=%s, expected_org=%s",
                    mask_apikey(apikey),
                    user.organization,
                    organization_id,
                )
                return False

            self.logger.info(
                "Admin check passed: apikey=%s, organization=%s", mask_apikey(apikey), organization_id
            )
            return True

        except Exception as e:
            self.logger.exception(
                "Error checking admin by apikey %s for organization %s: %s",
                mask_apikey(apikey),
                organization_id,
                e,
            )
            return False

    async def check_if_high_role_by_id(self, user_id: UUID) -> bool:
        """
        Check if user has a high role (role > 0) by user ID.

        Args:
            user_id: User ID to check

        Returns:
            True if user has role > 0, False otherwise or if user not found
        """
        try:
            self.logger.info("Checking high role status by user_id: %s", user_id)

            query = select(User).where(User.id == user_id)
            result = await self.session.execute(query)
            user: Optional[User] = result.scalar_one_or_none()

            if user is None:
                self.logger.info("User not found: user_id=%s", user_id)
                return False

            has_high_role = user.role > 0
            self.logger.info(
                "High role check result for user_id=%s: role=%s, result=%s",
                user_id,
                user.role,
                has_high_role,
            )
            return has_high_role

        except Exception as e:
            self.logger.exception(
                "Error checking high role by user_id %s: %s", user_id, e
            )
            return False

    async def check_if_organization_admin_by_id(self, user_id: UUID) -> bool:
        """
        Return True if the user exists and has organization admin role (role == 1).

        Used for user approve/reject flows where only org admins may act (not reviewers).
        """
        try:
            query = select(User).where(User.id == user_id)
            result = await self.session.execute(query)
            user: Optional[User] = result.scalar_one_or_none()
            if user is None:
                self.logger.info(
                    "Organization admin check: user not found user_id=%s", user_id
                )
                return False
            is_admin = user.role == 1
            self.logger.info(
                "Organization admin check: user_id=%s role=%s result=%s",
                user_id,
                user.role,
                is_admin,
            )
            return is_admin
        except Exception as e:
            self.logger.exception(
                "Error checking organization admin by user_id %s: %s", user_id, e
            )
            return False

    async def check_if_high_role_by_key(self, apikey: str) -> bool:
        """
        Check if user has a high role (role > 0) by API key.

        Args:
            apikey: API key of the user

        Returns:
            True if user has role > 0, False otherwise or if user not found
        """
        try:
            self.logger.info("Checking high role status by apikey: %s", mask_apikey(apikey))

            query = select(User).where(User.apikey == apikey)
            result = await self.session.execute(query)
            user: Optional[User] = result.scalar_one_or_none()

            if user is None:
                self.logger.info("User not found for apikey: %s", mask_apikey(apikey))
                return False

            has_high_role = user.role > 0
            self.logger.info(
                "High role check result for apikey=%s: role=%s, result=%s",
                mask_apikey(apikey),
                user.role,
                has_high_role,
            )
            return has_high_role

        except Exception as e:
            self.logger.exception(
                "Error checking high role by apikey %s: %s", mask_apikey(apikey), e
            )
            return False

    async def check_dataset_belongs_to_organization(
        self, dataset_id: UUID, organization_id: str
    ) -> bool:
        """
        Check if dataset belongs to the specified organization.

        Args:
            dataset_id: Dataset ID to check
            organization_id: Organization ID to check

        Returns:
            True if dataset belongs to the organization, False otherwise or if dataset not found
        """
        try:
            self.logger.info(
                "Checking if dataset %s belongs to organization %s",
                dataset_id,
                organization_id,
            )

            query = select(Dataset).where(Dataset.dataset_id == dataset_id)
            result = await self.session.execute(query)
            dataset: Optional[Dataset] = result.scalar_one_or_none()

            if dataset is None:
                self.logger.info("Dataset not found: dataset_id=%s", dataset_id)
                return False

            belongs = dataset.organization == organization_id
            self.logger.info(
                "Dataset organization check result: dataset_id=%s, dataset_org=%s, expected_org=%s, result=%s",
                dataset_id,
                dataset.organization,
                organization_id,
                belongs,
            )
            return belongs

        except Exception as e:
            self.logger.exception(
                "Error checking dataset organization: dataset_id=%s, organization_id=%s, error=%s",
                dataset_id,
                organization_id,
                e,
            )
            return False

    async def check_user_belongs_to_dataset_organization_by_key(
        self, apikey: str, dataset_id: UUID
    ) -> bool:
        """
        Check if user (by API key) belongs to the same organization as the dataset.

        Args:
            apikey: API key of the user
            dataset_id: Dataset ID to check

        Returns:
            True if user's organization matches dataset's organization, False otherwise or if user/dataset not found
        """
        try:
            self.logger.info(
                "Checking if user with apikey %s belongs to dataset %s organization",
                mask_apikey(apikey),
                dataset_id,
            )

            # Get user by apikey
            user_data = await self.get_user_by_apikey(apikey)
            if user_data is None:
                self.logger.info("User not found for apikey: %s", mask_apikey(apikey))
                return False

            organization_id = user_data["organization"]

            # Check if dataset belongs to user's organization
            belongs = await self.check_dataset_belongs_to_organization(
                dataset_id, organization_id
            )
            self.logger.info(
                "User belongs to dataset organization check result: apikey=%s, dataset_id=%s, user_org=%s, result=%s",
                mask_apikey(apikey),
                dataset_id,
                organization_id,
                belongs,
            )
            return belongs

        except Exception as e:
            self.logger.exception(
                "Error checking user belongs to dataset organization by apikey: apikey=%s, dataset_id=%s, error=%s",
                mask_apikey(apikey),
                dataset_id,
                e,
            )
            return False

    async def check_user_belongs_to_dataset_organization_by_id(
        self, user_id: UUID, dataset_id: UUID
    ) -> bool:
        """
        Check if user (by user ID) belongs to the same organization as the dataset.

        Args:
            user_id: User ID to check
            dataset_id: Dataset ID to check

        Returns:
            True if user's organization matches dataset's organization, False otherwise or if user/dataset not found
        """
        try:
            self.logger.info(
                "Checking if user %s belongs to dataset %s organization",
                user_id,
                dataset_id,
            )
            query = select(User).where(User.id == user_id)
            result = await self.session.execute(query)
            user: Optional[User] = result.scalar_one_or_none()
            if user is None:
                self.logger.info("User not found for user_id: %s", user_id)
                return False
            organization_id = user.organization
            belongs = await self.check_dataset_belongs_to_organization(
                dataset_id, organization_id
            )
            self.logger.info(
                "User belongs to dataset organization check result: user_id=%s, dataset_id=%s, user_org=%s, result=%s",
                user_id,
                dataset_id,
                organization_id,
                belongs,
            )
            return belongs
        except Exception as e:
            self.logger.exception(
                "Error checking user belongs to dataset organization by id: user_id=%s, dataset_id=%s, error=%s",
                user_id,
                dataset_id,
                e,
            )
            return False

    async def check_if_dataset_creator_by_id(
        self, user_id: UUID, dataset_id: UUID
    ) -> bool:
        """
        Check if user is the creator of the dataset by user ID.

        Args:
            user_id: User ID to check
            dataset_id: Dataset ID to check

        Returns:
            True if user is the creator, False otherwise or if dataset not found
        """
        try:
            self.logger.info(
                "Checking if user %s is creator of dataset %s", user_id, dataset_id
            )

            query = select(Dataset).where(Dataset.dataset_id == dataset_id)
            result = await self.session.execute(query)
            dataset: Optional[Dataset] = result.scalar_one_or_none()

            if dataset is None:
                self.logger.info("Dataset not found: dataset_id=%s", dataset_id)
                return False

            is_creator = dataset.creator == user_id
            self.logger.info(
                "Dataset creator check result: dataset_id=%s, creator=%s, user_id=%s, result=%s",
                dataset_id,
                dataset.creator,
                user_id,
                is_creator,
            )
            return is_creator

        except Exception as e:
            self.logger.exception(
                "Error checking dataset creator: user_id=%s, dataset_id=%s, error=%s",
                user_id,
                dataset_id,
                e,
            )
            return False

    async def check_if_dataset_creator_by_key(
        self, apikey: str, dataset_id: UUID
    ) -> bool:
        """
        Check if user is the creator of the dataset by API key.

        Args:
            apikey: API key of the user
            dataset_id: Dataset ID to check

        Returns:
            True if user is the creator, False otherwise or if user/dataset not found
        """
        try:
            self.logger.info(
                "Checking if user with apikey %s is creator of dataset %s",
                mask_apikey(apikey),
                dataset_id,
            )

            # Get user by apikey
            user_data = await self.get_user_by_apikey(apikey)
            if user_data is None:
                self.logger.info("User not found for apikey: %s", mask_apikey(apikey))
                return False

            user_id = user_data["id"]

            # Check if user is creator
            query = select(Dataset).where(Dataset.dataset_id == dataset_id)
            result = await self.session.execute(query)
            dataset: Optional[Dataset] = result.scalar_one_or_none()

            if dataset is None:
                self.logger.info("Dataset not found: dataset_id=%s", dataset_id)
                return False

            is_creator = dataset.creator == user_id
            self.logger.info(
                "Dataset creator check result: dataset_id=%s, creator=%s, user_id=%s, result=%s",
                dataset_id,
                dataset.creator,
                user_id,
                is_creator,
            )
            return is_creator

        except Exception as e:
            self.logger.exception(
                "Error checking dataset creator by apikey: apikey=%s, dataset_id=%s, error=%s",
                mask_apikey(apikey),
                dataset_id,
                e,
            )
            return False

    async def check_apikey_belongs_to_user(self, apikey: str, user_id: UUID) -> bool:
        """
        Check if API key belongs to the specified user.

        Args:
            apikey: API key to check
            user_id: User ID to check against

        Returns:
            True if API key belongs to the user, False otherwise or if user not found
        """
        try:
            self.logger.info(
                "Checking if apikey %s belongs to user %s", mask_apikey(apikey), user_id
            )

            query = select(User).where(User.apikey == apikey)
            result = await self.session.execute(query)
            user: Optional[User] = result.scalar_one_or_none()

            if user is None:
                self.logger.info("User not found for apikey: %s", mask_apikey(apikey))
                return False

            belongs = user.id == user_id
            self.logger.info(
                "Apikey belongs to user check result: apikey=%s, user_id=%s, found_user_id=%s, result=%s",
                mask_apikey(apikey),
                user_id,
                user.id,
                belongs,
            )
            return belongs

        except Exception as e:
            self.logger.exception(
                "Error checking apikey belongs to user: apikey=%s, user_id=%s, error=%s",
                mask_apikey(apikey),
                user_id,
                e,
            )
            return False

    async def check_user_belongs_to_organization_by_id(
        self, user_id: UUID, organization_id: str
    ) -> bool:
        """
        Check if user belongs to the specified organization by user ID.

        Args:
            user_id: User ID to check
            organization_id: Organization ID to check

        Returns:
            True if user belongs to the organization, False otherwise or if user not found
        """
        try:
            self.logger.info(
                "Checking if user %s belongs to organization %s", user_id, organization_id
            )

            query = select(User).where(User.id == user_id)
            result = await self.session.execute(query)
            user: Optional[User] = result.scalar_one_or_none()

            if user is None:
                self.logger.info("User not found: user_id=%s", user_id)
                return False

            belongs = user.organization == organization_id
            self.logger.info(
                "User organization check result: user_id=%s, user_org=%s, expected_org=%s, result=%s",
                user_id,
                user.organization,
                organization_id,
                belongs,
            )
            return belongs

        except Exception as e:
            self.logger.exception(
                "Error checking user organization: user_id=%s, organization_id=%s, error=%s",
                user_id,
                organization_id,
                e,
            )
            return False

    async def check_user_belongs_to_organization_by_key(
        self, apikey: str, organization_id: str
    ) -> bool:
        """
        Check if user belongs to the specified organization by API key.

        Args:
            apikey: API key of the user
            organization_id: Organization ID to check

        Returns:
            True if user belongs to the organization, False otherwise or if user not found
        """
        try:
            self.logger.info(
                "Checking if user with apikey %s belongs to organization %s",
                mask_apikey(apikey),
                organization_id,
            )

            query = select(User).where(User.apikey == apikey)
            result = await self.session.execute(query)
            user: Optional[User] = result.scalar_one_or_none()

            if user is None:
                self.logger.info("User not found for apikey: %s", mask_apikey(apikey))
                return False

            belongs = user.organization == organization_id
            self.logger.info(
                "User organization check result: apikey=%s, user_org=%s, expected_org=%s, result=%s",
                mask_apikey(apikey),
                user.organization,
                organization_id,
                belongs,
            )
            return belongs

        except Exception as e:
            self.logger.exception(
                "Error checking user organization by apikey: apikey=%s, organization_id=%s, error=%s",
                mask_apikey(apikey),
                organization_id,
                e,
            )
            return False

    async def check_apikey_same_organization_user_id(
        self, user_id: UUID, apikey: str
    ) -> bool:
        """
        Check if user (by ID) and user (by API key) belong to the same organization.

        Args:
            user_id: User ID to check
            apikey: API key of another user to check

        Returns:
            True if both users belong to the same organization, False otherwise or if either user not found
        """
        try:
            self.logger.info(
                "Checking if user %s and user with apikey %s belong to same organization",
                user_id,
                mask_apikey(apikey),
            )

            # Get user by ID
            query_user = select(User).where(User.id == user_id)
            result_user = await self.session.execute(query_user)
            user_by_id: Optional[User] = result_user.scalar_one_or_none()

            if user_by_id is None:
                self.logger.info("User not found: user_id=%s", user_id)
                return False

            # Get user by apikey
            query_apikey = select(User).where(User.apikey == apikey)
            result_apikey = await self.session.execute(query_apikey)
            user_by_apikey: Optional[User] = result_apikey.scalar_one_or_none()

            if user_by_apikey is None:
                self.logger.info("User not found for apikey: %s", mask_apikey(apikey))
                return False

            same_organization = user_by_id.organization == user_by_apikey.organization
            self.logger.info(
                "Same organization check result: user_id=%s (org=%s), apikey=%s (org=%s), result=%s",
                user_id,
                user_by_id.organization,
                mask_apikey(apikey),
                user_by_apikey.organization,
                same_organization,
            )
            return same_organization

        except Exception as e:
            self.logger.exception(
                "Error checking same organization: user_id=%s, apikey=%s, error=%s",
                user_id,
                mask_apikey(apikey),
                e,
            )
            return False

    async def get_pending_dataset_approvals(
        self, organization: str
    ) -> list[dict[str, Any]]:
        """
        Get unapproved datasets for an organization with creator names.

        Args:
            organization: Organization ID to filter datasets by

        Returns:
            List of dictionaries containing dataset_id, creator, creator_name,
            and dataset_title. Returns an empty list when no rows match.
        """
        try:
            self.logger.info(
                "Fetching pending dataset approvals for organization=%s",
                organization,
            )
            result = await self.session.execute(
                select(
                    Dataset.dataset_id,
                    Dataset.creator,
                    User.full_name,
                    Dataset.dataset_title,
                )
                .join(User, User.id == Dataset.creator)
                .where(
                    Dataset.organization == organization,
                    Dataset.approved.is_(False),
                )
            )
            rows = result.all()
            pending_datasets = [
                {
                    "dataset_id": row.dataset_id,
                    "creator": row.creator,
                    "creator_name": row.full_name,
                    "dataset_title": row.dataset_title,
                }
                for row in rows
            ]
            self.logger.info(
                "Found %d pending dataset approvals for organization=%s",
                len(pending_datasets),
                organization,
            )
            return pending_datasets
        except Exception as e:
            self.logger.exception(
                "Error fetching pending dataset approvals for organization=%s: %s",
                organization,
                e,
            )
            raise

    async def get_pending_user_approvals(
        self, organization: str
    ) -> list[dict[str, Any]]:
        """
        Get unverified users for an organization.

        Args:
            organization: Organization ID to filter users by

        Returns:
            List of dictionaries containing user_id, full_name, designation,
            and email. Returns an empty list when no rows match.
        """
        try:
            self.logger.info(
                "Fetching pending user approvals for organization=%s",
                organization,
            )
            result = await self.session.execute(
                select(User.id, User.full_name, User.designation, User.email).where(
                    User.organization == organization,
                    User.verified.is_(False),
                )
            )
            rows = result.all()
            pending_users = [
                {
                    "user_id": row.id,
                    "full_name": row.full_name,
                    "designation": row.designation,
                    "email": row.email,
                }
                for row in rows
            ]
            self.logger.info(
                "Found %d pending user approvals for organization=%s",
                len(pending_users),
                organization,
            )
            return pending_users
        except Exception as e:
            self.logger.exception(
                "Error fetching pending user approvals for organization=%s: %s",
                organization,
                e,
            )
            raise

    async def approve_user(
        self, approver: User, target_user_id: UUID, assigned_role: int = 0
    ) -> User:
        """
        Approve a user within the approver's organization.

        Args:
            approver: Signed-in admin performing the approval
            target_user_id: UUID of the user to approve
            assigned_role: Role to assign (0=Member, 1=Admin, 2=Reviewer)

        Returns:
            Updated user model

        Raises:
            HTTPException:
                - 400: Invalid assigned_role
                - 404: Target user not found
                - 403: Target user is outside the approver's organization
        """
        try:
            if assigned_role not in (0, 1, 2):
                self.logger.warning(
                    "Approve user validation failed: invalid assigned_role=%s",
                    assigned_role,
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="assigned_role must be 0, 1, or 2",
                )

            self.logger.info(
                "Attempting user approval: approver_id=%s target_user_id=%s assigned_role=%s",
                approver.id,
                target_user_id,
                assigned_role,
            )
            result = await self.session.execute(
                select(User).where(User.id == target_user_id)
            )
            target_user: Optional[User] = result.scalar_one_or_none()

            if target_user is None:
                self.logger.warning(
                    "Approval target not found: target_user_id=%s",
                    target_user_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="User not found",
                )

            if target_user.organization != approver.organization:
                self.logger.warning(
                    "Approval denied due to organization mismatch: approver_id=%s approver_org=%s target_user_id=%s target_org=%s",
                    approver.id,
                    approver.organization,
                    target_user.id,
                    target_user.organization,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized to approve users outside your organization",
                )

            target_user.verified = True
            target_user.role = assigned_role
            await self.session.commit()
            await self.session.refresh(target_user)

            self.logger.info(
                "User approved successfully: approver_id=%s target_user_id=%s role=%s",
                approver.id,
                target_user.id,
                assigned_role,
            )
            return target_user
        except HTTPException:
            raise
        except Exception as e:
            await self.session.rollback()
            self.logger.exception(
                "Error approving user: approver_id=%s target_user_id=%s error=%s",
                approver.id,
                target_user_id,
                e,
            )
            raise

    async def change_user_role(
        self, actor: User, target_user_id: UUID, new_role: int
    ) -> User:
        """
        Change an existing user's role within the actor's organization (verified users).

        Args:
            actor: Signed-in org admin performing the change
            target_user_id: UUID of the user whose role is updated
            new_role: New role (0=Member, 1=Admin, 2=Reviewer)

        Raises:
            HTTPException: 400 invalid role or last-admin self-change; 403 org mismatch;
                404 user not found
        """
        try:
            if new_role not in (0, 1, 2):
                self.logger.warning(
                    "Change user role validation failed: invalid new_role=%s",
                    new_role,
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="assigned_role must be 0, 1, or 2",
                )

            self.logger.info(
                "Attempting role change: actor_id=%s target_user_id=%s new_role=%s",
                actor.id,
                target_user_id,
                new_role,
            )
            result = await self.session.execute(
                select(User).where(User.id == target_user_id)
            )
            target_user: Optional[User] = result.scalar_one_or_none()

            if target_user is None:
                self.logger.warning(
                    "Change role target not found: target_user_id=%s",
                    target_user_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="User not found",
                )

            if target_user.organization != actor.organization:
                self.logger.warning(
                    "Change role denied due to organization mismatch: actor_id=%s target_user_id=%s",
                    actor.id,
                    target_user_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized to change user role outside your organization",
                )

            if actor.id == target_user.id:
                admin_count_result = await self.session.execute(
                    select(func.count())
                    .select_from(User)
                    .where(
                        User.organization == actor.organization,
                        User.role == 1,
                    )
                )
                admin_count = int(admin_count_result.scalar_one() or 0)
                if admin_count <= 1:
                    self.logger.warning(
                        "Change role denied: sole admin cannot change own role actor_id=%s",
                        actor.id,
                    )
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Organization should have atleast one Admin",
                    )

            target_user.role = new_role
            await self.session.commit()
            await self.session.refresh(target_user)

            self.logger.info(
                "User role changed: actor_id=%s target_user_id=%s new_role=%s",
                actor.id,
                target_user.id,
                new_role,
            )
            return target_user
        except HTTPException:
            raise
        except Exception as e:
            await self.session.rollback()
            self.logger.exception(
                "Error changing user role: actor_id=%s target_user_id=%s error=%s",
                actor.id,
                target_user_id,
                e,
            )
            raise

    async def delete_user_by_admin(self, actor: User, target_user_id: UUID) -> str:
        """
        Remove a user in the actor's organization: user_contributions then users row.

        Deleting a user who created datasets cascades per FK (see Dataset.creator).

        Args:
            actor: Signed-in org admin performing the deletion
            target_user_id: UUID of the user to remove

        Returns:
            Recipient email captured before delete (for notification after commit)

        Raises:
            HTTPException: 400 last-admin self-delete; 403 org mismatch; 404 not found
        """
        try:
            self.logger.info(
                "Attempting user delete by admin: actor_id=%s target_user_id=%s",
                actor.id,
                target_user_id,
            )
            result = await self.session.execute(
                select(User).where(User.id == target_user_id)
            )
            target_user: Optional[User] = result.scalar_one_or_none()

            if target_user is None:
                self.logger.warning(
                    "Delete user target not found: target_user_id=%s",
                    target_user_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="User not found",
                )

            if target_user.organization != actor.organization:
                self.logger.warning(
                    "Delete user denied due to organization mismatch: actor_id=%s target_user_id=%s",
                    actor.id,
                    target_user_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized to delete users outside your organization",
                )

            if actor.id == target_user.id:
                admin_count_result = await self.session.execute(
                    select(func.count())
                    .select_from(User)
                    .where(
                        User.organization == actor.organization,
                        User.role == 1,
                    )
                )
                admin_count = int(admin_count_result.scalar_one() or 0)
                if admin_count <= 1:
                    self.logger.warning(
                        "Delete user denied: sole admin cannot delete self actor_id=%s",
                        actor.id,
                    )
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Organization should have atleast one Admin",
                    )

            recipient_email = target_user.email

            await self.session.execute(
                delete(UserContribution).where(
                    UserContribution.user_id == target_user_id
                )
            )
            await self.session.execute(delete(User).where(User.id == target_user_id))
            await self.session.commit()

            self.logger.info(
                "User deleted by admin: actor_id=%s target_user_id=%s",
                actor.id,
                target_user_id,
            )
            return recipient_email
        except HTTPException:
            raise
        except Exception as e:
            await self.session.rollback()
            self.logger.exception(
                "Error deleting user: actor_id=%s target_user_id=%s error=%s",
                actor.id,
                target_user_id,
                e,
            )
            raise

    async def reject_user(self, approver: User, target_user_id: UUID) -> str:
        """
        Reject a pending user: delete user_contributions row(s) and users row.
        Router should still enforce session verification; this method adds defense-in-depth.

        Deleting a user who created datasets cascades per FK (see Dataset.creator).

        Args:
            approver: Signed-in admin performing the rejection
            target_user_id: UUID of the user to remove

        Returns:
            Recipient email (for notification after successful commit)

        Raises:
            HTTPException:
                - 400: Target user is not pending (verified is True)
                - 403: Approver is not org admin, self-rejection, or org mismatch
                - 404: Target user not found
        """
        try:
            self.logger.info(
                "Attempting user rejection: approver_id=%s target_user_id=%s",
                approver.id,
                target_user_id,
            )

            if not await self.check_if_organization_admin_by_id(approver.id):
                self.logger.warning(
                    "Rejection denied: approver is not organization admin approver_id=%s",
                    approver.id,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized to reject users",
                )

            if approver.id == target_user_id:
                self.logger.warning(
                    "Rejection denied: cannot reject self approver_id=%s",
                    approver.id,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot reject your own account",
                )

            result = await self.session.execute(
                select(User).where(User.id == target_user_id)
            )
            target_user: Optional[User] = result.scalar_one_or_none()

            if target_user is None:
                self.logger.warning(
                    "Rejection target not found: target_user_id=%s",
                    target_user_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="User not found",
                )

            if target_user.organization != approver.organization:
                self.logger.warning(
                    "Rejection denied due to organization mismatch: approver_id=%s approver_org=%s target_user_id=%s target_org=%s",
                    approver.id,
                    approver.organization,
                    target_user.id,
                    target_user.organization,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized to reject users outside your organization",
                )

            if target_user.verified is not False:
                self.logger.warning(
                    "Rejection denied: target user is not pending verified=%s target_user_id=%s",
                    target_user.verified,
                    target_user_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="User is not pending approval",
                )

            recipient_email = target_user.email

            await self.session.execute(
                delete(UserContribution).where(
                    UserContribution.user_id == target_user_id
                )
            )
            await self.session.execute(delete(User).where(User.id == target_user_id))
            await self.session.commit()

            self.logger.info(
                "User rejected and removed: approver_id=%s target_user_id=%s",
                approver.id,
                target_user_id,
            )
            return recipient_email
        except HTTPException:
            raise
        except Exception as e:
            await self.session.rollback()
            self.logger.exception(
                "Error rejecting user: approver_id=%s target_user_id=%s error=%s",
                approver.id,
                target_user_id,
                e,
            )
            raise

    async def approve_dataset(self, approver: User, dataset_id: UUID) -> Dataset:
        """
        Approve a dataset within the approver's organization.

        Args:
            approver: Signed-in high-role user performing the approval
            dataset_id: UUID of the dataset to approve

        Returns:
            Updated dataset model

        Raises:
            HTTPException:
                - 403: Approver lacks permission or org access
                - 404: Dataset not found
        """
        try:
            self.logger.info(
                "Attempting dataset approval: approver_id=%s dataset_id=%s",
                approver.id,
                dataset_id,
            )

            has_high_role = await self.check_if_high_role_by_id(approver.id)
            if not has_high_role and not approver.is_superuser:
                self.logger.warning(
                    "Dataset approval denied due to insufficient role: approver_id=%s dataset_id=%s",
                    approver.id,
                    dataset_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized to approve datasets",
                )

            result = await self.session.execute(
                select(Dataset).where(Dataset.dataset_id == dataset_id)
            )
            dataset: Optional[Dataset] = result.scalar_one_or_none()
            if dataset is None:
                self.logger.warning(
                    "Dataset approval target not found: dataset_id=%s",
                    dataset_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Dataset not found",
                )

            belongs_to_org = await self.check_user_belongs_to_dataset_organization_by_id(
                approver.id, dataset_id
            )
            if not belongs_to_org and not approver.is_superuser:
                self.logger.warning(
                    "Dataset approval denied due to organization mismatch: approver_id=%s approver_org=%s dataset_id=%s dataset_org=%s",
                    approver.id,
                    approver.organization,
                    dataset_id,
                    dataset.organization,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized to approve datasets outside your organization",
                )

            dataset.approved = True
            dataset.approved_by = approver.id
            await self.session.commit()
            await self.session.refresh(dataset)

            self.logger.info(
                "Dataset approved successfully: approver_id=%s dataset_id=%s",
                approver.id,
                dataset_id,
            )
            return dataset
        except HTTPException:
            raise
        except Exception as e:
            await self.session.rollback()
            self.logger.exception(
                "Error approving dataset: approver_id=%s dataset_id=%s error=%s",
                approver.id,
                dataset_id,
                e,
            )
            raise

    async def reject_dataset(self, actor: User, dataset_id: UUID) -> None:
        """Reject an unapproved dataset by deleting it."""
        from services.typesense_index import safe_delete_dataset_documents

        has_high_role = await self.check_if_high_role_by_id(actor.id)
        if not has_high_role and not actor.is_superuser:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized to reject datasets",
            )
        result = await self.session.execute(
            select(Dataset).where(Dataset.dataset_id == dataset_id)
        )
        dataset = result.scalar_one_or_none()
        if dataset is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Dataset not found",
            )
        if dataset.approved:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Approved datasets cannot be rejected from the queue",
            )
        belongs = await self.check_user_belongs_to_dataset_organization_by_id(
            actor.id, dataset_id
        )
        if not belongs and not actor.is_superuser:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized to reject datasets outside your organization",
            )
        await self.session.delete(dataset)
        await self.session.commit()
        await safe_delete_dataset_documents(dataset_id)


# Dependency function to get user service
async def get_user_service(
    session: AsyncSession = Depends(get_session),
) -> UserService:
    """
    Dependency function to get UserService instance.

    Args:
        session: Database session

    Returns:
        UserService instance
    """
    return UserService(session)

