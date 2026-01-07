"""
User router for handling user profile operations.
"""

import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from services.auth import AuthService, get_auth_service
from services.organization import OrganizationService, get_organization_service
from services.user import UserService, get_user_service

router = APIRouter()
logger = logging.getLogger(__name__)


class UserController:
    """
    Class-based user controller with comprehensive error handling and security.
    """

    def __init__(
        self,
        auth_service: AuthService,
        user_service: UserService,
        org_service: OrganizationService,
    ):
        self.auth_service = auth_service
        self.user_service = user_service
        self.org_service = org_service
        self.logger = logging.getLogger(__name__)

    async def get_profile(
        self, user_id: UUID, apikey: Optional[str] = None
    ) -> JSONResponse:
        """
        Get user profile information with conditional privileges and apikey visibility.

        Args:
            user_id: UUID of the user to fetch
            apikey: Optional API key for privilege checking

        Returns:
            JSONResponse containing user profile data with privileges

        Raises:
            HTTPException: If user not found or organization not found
        """
        try:
            self.logger.info("Fetching profile for user_id: %s", user_id)

            # Fetch user by ID
            user = await self.auth_service.user_db.get(user_id)
            if user is None:
                self.logger.warning("User not found: user_id=%s", user_id)
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="User not found",
                )

            # Fetch organization name
            organization = await self.org_service.get_organization_by_id(
                user.organization
            )
            if organization is None:
                self.logger.warning(
                    "Organization not found: organization_id=%s", user.organization
                )
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Organization not found",
                )

            # Determine privileges based on apikey
            has_edit_privilege = False
            has_user_datasets_privilege = True
            include_apikey = False

            if apikey:
                # Check if apikey belongs to the user
                apikey_belongs = await self.user_service.check_apikey_belongs_to_user(
                    apikey, user_id
                )
                if apikey_belongs:
                    has_edit_privilege = True
                    has_user_datasets_privilege = False
                    include_apikey = True
                    self.logger.info(
                        "Apikey belongs to user: user_id=%s, privileges=edit",
                        user_id,
                    )
                else:
                    self.logger.info(
                        "Apikey does not belong to user: user_id=%s, privileges=user_datasets",
                        user_id,
                    )
            else:
                self.logger.info(
                    "No apikey provided: user_id=%s, privileges=user_datasets", user_id
                )

            # Build response data
            response_data = {
                "full_name": user.full_name,
                "id": str(user.id),
                "email": user.email,
                "designation": user.designation,
                "organization": user.organization,
                "verified": user.verified,
                "role": user.role,
                "phone": user.phone,
                "contributions": user.contributions,
                "created_at": user.created_at.isoformat() if user.created_at else None,
                "modified_at": user.modified_at.isoformat()
                if user.modified_at
                else None,
                "is_verified": user.is_verified,
                "is_superuser": user.is_superuser,
                "organization_name": organization.name,
                "privileges": {
                    "edit": has_edit_privilege,
                    "user_datasets": has_user_datasets_privilege,
                },
            }

            # Conditionally include apikey
            if include_apikey:
                response_data["apikey"] = user.apikey

            self.logger.info(
                "Profile fetched successfully: user_id=%s, has_edit=%s, has_user_datasets=%s",
                user_id,
                has_edit_privilege,
                has_user_datasets_privilege,
            )

            return JSONResponse(
                content=jsonable_encoder(response_data),
                status_code=status.HTTP_200_OK,
            )

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception("Error fetching profile: user_id=%s, error=%s", user_id, e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error processing profile request",
            )


async def get_user_controller(
    auth_service: AuthService = Depends(get_auth_service),
    user_service: UserService = Depends(get_user_service),
    org_service: OrganizationService = Depends(get_organization_service),
) -> UserController:
    """Dependency to get user controller."""
    return UserController(
        auth_service=auth_service,
        user_service=user_service,
        org_service=org_service,
    )


@router.get("/profile")
async def profile(
    user_id: str = Query(..., description="User ID (UUID)"),
    apikey: Optional[str] = Query(None, description="Optional API key for privilege checking"),
    controller: UserController = Depends(get_user_controller),
):
    """
    Get user profile information with conditional privileges and apikey visibility.

    Args:
        user_id: User ID (UUID) - required query parameter
        apikey: Optional API key for privilege checking
        controller: User controller (from dependency)

    Returns:
        JSON response containing user profile data

    Raises:
        HTTPException:
            - 400: Invalid user_id UUID format
            - 404: User or organization not found
            - 500: Internal server error
    """
    try:
        try:
            user_uuid = UUID(user_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid user_id UUID format",
            )

        return await controller.get_profile(user_uuid, apikey)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in /profile: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing profile request",
        )

