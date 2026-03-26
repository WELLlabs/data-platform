"""
User service for handling user data retrieval and validation operations.

This service provides methods to:
- Retrieve user data by API key
- Validate user permissions and relationships
- Check dataset ownership and organization membership
"""

import logging
from typing import Optional
from uuid import UUID

from db.session import get_session
from fastapi import Depends
from models.dataset import Dataset
from models.user import User
from models.user_contribution import UserContribution
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class UserService:
    """
    Service class for user operations with comprehensive validation and security.

    This service handles:
    - User data retrieval by API key
    - User permission validation (superuser, admin, high role)
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
            id, full_name, email, apikey, designation, student, organization,
            role, phone, contributions, created_at, modified_at, verified,
            is_superuser, is_verified
            Returns None if user not found
        """
        try:
            self.logger.info("Fetching user by apikey: %s", apikey)

            query = select(User).where(User.apikey == apikey)
            result = await self.session.execute(query)
            user: Optional[User] = result.scalar_one_or_none()

            if user is None:
                self.logger.info("User not found for apikey: %s", apikey)
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
                "apikey": user.apikey,
                "designation": user.designation,
                "student": user.student,
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
            self.logger.exception("Error fetching user by apikey %s: %s", apikey, e)
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
            self.logger.info("Checking superuser status by apikey: %s", apikey)

            query = select(User).where(User.apikey == apikey)
            result = await self.session.execute(query)
            user: Optional[User] = result.scalar_one_or_none()

            if user is None:
                self.logger.info("User not found for apikey: %s", apikey)
                return False

            is_superuser = user.is_superuser
            self.logger.info(
                "Superuser check result for apikey=%s: %s", apikey, is_superuser
            )
            return is_superuser

        except Exception as e:
            self.logger.exception(
                "Error checking superuser by apikey %s: %s", apikey, e
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
                apikey,
                organization_id,
            )

            query = select(User).where(User.apikey == apikey)
            result = await self.session.execute(query)
            user: Optional[User] = result.scalar_one_or_none()

            if user is None:
                self.logger.info("User not found for apikey: %s", apikey)
                return False

            # Check if role is 1
            if user.role != 1:
                self.logger.info(
                    "User role is not 1: apikey=%s, role=%s", apikey, user.role
                )
                return False

            # Check if organization matches
            if user.organization != organization_id:
                self.logger.info(
                    "Organization mismatch: apikey=%s, user_org=%s, expected_org=%s",
                    apikey,
                    user.organization,
                    organization_id,
                )
                return False

            self.logger.info(
                "Admin check passed: apikey=%s, organization=%s", apikey, organization_id
            )
            return True

        except Exception as e:
            self.logger.exception(
                "Error checking admin by apikey %s for organization %s: %s",
                apikey,
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

    async def check_if_high_role_by_key(self, apikey: str) -> bool:
        """
        Check if user has a high role (role > 0) by API key.

        Args:
            apikey: API key of the user

        Returns:
            True if user has role > 0, False otherwise or if user not found
        """
        try:
            self.logger.info("Checking high role status by apikey: %s", apikey)

            query = select(User).where(User.apikey == apikey)
            result = await self.session.execute(query)
            user: Optional[User] = result.scalar_one_or_none()

            if user is None:
                self.logger.info("User not found for apikey: %s", apikey)
                return False

            has_high_role = user.role > 0
            self.logger.info(
                "High role check result for apikey=%s: role=%s, result=%s",
                apikey,
                user.role,
                has_high_role,
            )
            return has_high_role

        except Exception as e:
            self.logger.exception(
                "Error checking high role by apikey %s: %s", apikey, e
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
                apikey,
                dataset_id,
            )

            # Get user by apikey
            user_data = await self.get_user_by_apikey(apikey)
            if user_data is None:
                self.logger.info("User not found for apikey: %s", apikey)
                return False

            organization_id = user_data["organization"]

            # Check if dataset belongs to user's organization
            belongs = await self.check_dataset_belongs_to_organization(
                dataset_id, organization_id
            )
            self.logger.info(
                "User belongs to dataset organization check result: apikey=%s, dataset_id=%s, user_org=%s, result=%s",
                apikey,
                dataset_id,
                organization_id,
                belongs,
            )
            return belongs

        except Exception as e:
            self.logger.exception(
                "Error checking user belongs to dataset organization by apikey: apikey=%s, dataset_id=%s, error=%s",
                apikey,
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
                apikey,
                dataset_id,
            )

            # Get user by apikey
            user_data = await self.get_user_by_apikey(apikey)
            if user_data is None:
                self.logger.info("User not found for apikey: %s", apikey)
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
                apikey,
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
                "Checking if apikey %s belongs to user %s", apikey, user_id
            )

            query = select(User).where(User.apikey == apikey)
            result = await self.session.execute(query)
            user: Optional[User] = result.scalar_one_or_none()

            if user is None:
                self.logger.info("User not found for apikey: %s", apikey)
                return False

            belongs = user.id == user_id
            self.logger.info(
                "Apikey belongs to user check result: apikey=%s, user_id=%s, found_user_id=%s, result=%s",
                apikey,
                user_id,
                user.id,
                belongs,
            )
            return belongs

        except Exception as e:
            self.logger.exception(
                "Error checking apikey belongs to user: apikey=%s, user_id=%s, error=%s",
                apikey,
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
                apikey,
                organization_id,
            )

            query = select(User).where(User.apikey == apikey)
            result = await self.session.execute(query)
            user: Optional[User] = result.scalar_one_or_none()

            if user is None:
                self.logger.info("User not found for apikey: %s", apikey)
                return False

            belongs = user.organization == organization_id
            self.logger.info(
                "User organization check result: apikey=%s, user_org=%s, expected_org=%s, result=%s",
                apikey,
                user.organization,
                organization_id,
                belongs,
            )
            return belongs

        except Exception as e:
            self.logger.exception(
                "Error checking user organization by apikey: apikey=%s, organization_id=%s, error=%s",
                apikey,
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
                apikey,
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
                self.logger.info("User not found for apikey: %s", apikey)
                return False

            same_organization = user_by_id.organization == user_by_apikey.organization
            self.logger.info(
                "Same organization check result: user_id=%s (org=%s), apikey=%s (org=%s), result=%s",
                user_id,
                user_by_id.organization,
                apikey,
                user_by_apikey.organization,
                same_organization,
            )
            return same_organization

        except Exception as e:
            self.logger.exception(
                "Error checking same organization: user_id=%s, apikey=%s, error=%s",
                user_id,
                apikey,
                e,
            )
            return False


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

