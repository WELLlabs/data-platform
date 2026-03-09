"""
User router for handling user profile operations.
"""

import logging
import re
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Form, HTTPException, Query, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from models.user import User
from routers.upload import get_current_active_user
from services.auth import AuthService, get_auth_service
from services.organization import OrganizationService, get_organization_service
from services.user import UserService, get_user_service
from utils.security import sanitize_input

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

            # Get contributions from user_contributions table
            contributions = await self.user_service.get_contributions_for_user(user_id)

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
                "contributions": contributions,
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

    async def edit_profile(
        self,
        user: User,
        full_name: str,
        email: str,
        designation: Optional[str],
        organization: str,
        phone: Optional[str],
    ) -> JSONResponse:
        """
        Update the signed-in user's profile. Validates and sanitizes inputs,
        resets is_verified on email change and verified on organization change.
        """
        self.logger.info("Edit profile attempt for user_id=%s", user.id)
        try:
            # Sanitize all inputs
            sanitized_full_name = sanitize_input(full_name)
            sanitized_email = sanitize_input(email)
            sanitized_designation = sanitize_input(designation) if designation else None
            sanitized_organization = sanitize_input(organization)
            sanitized_phone = sanitize_input(phone) if phone else None

            # Required fields non-empty after sanitization
            if not sanitized_full_name:
                self.logger.warning("Edit profile validation failed: full_name empty")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Full name is required and cannot be empty",
                )
            if not sanitized_email:
                self.logger.warning("Edit profile validation failed: email empty")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Email is required and cannot be empty",
                )
            # RFC-style email format validation (preserves + and other valid local-part chars).
            # Domain: 2 or more labels (e.g. example.com, email.ac.in).
            _label = r"[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?"
            email_re = re.compile(
                rf"^[a-zA-Z0-9._%+-]+@(?:{_label})(?:\.{_label})+$"
            )
            if not email_re.fullmatch(sanitized_email):
                self.logger.warning("Edit profile validation failed: invalid email format")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid email address format",
                )
            if not sanitized_organization:
                self.logger.warning("Edit profile validation failed: organization empty")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Organization is required and cannot be empty",
                )

            # Length validation (per User model)
            if len(sanitized_full_name) > 50:
                self.logger.warning("Edit profile validation failed: full_name too long")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Full name must be at most 50 characters",
                )
            if sanitized_designation is not None and len(sanitized_designation) > 25:
                self.logger.warning("Edit profile validation failed: designation too long")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Designation must be at most 25 characters",
                )
            if len(sanitized_organization) > 50:
                self.logger.warning("Edit profile validation failed: organization too long")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Organization must be at most 50 characters",
                )
            if sanitized_phone is not None and len(sanitized_phone) > 20:
                self.logger.warning("Edit profile validation failed: phone too long")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Phone must be at most 20 characters",
                )

            # Email uniqueness if email is being changed
            if sanitized_email != user.email:
                existing = await self.auth_service.user_db.get_by_email(sanitized_email)
                if existing is not None and existing.id != user.id:
                    self.logger.warning(
                        "Edit profile conflict: email already in use for user_id=%s",
                        user.id,
                    )
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Email already in use",
                    )

            # Organization must exist
            org = await self.org_service.get_organization_by_id(sanitized_organization)
            if org is None:
                self.logger.warning(
                    "Edit profile: organization not found: %s", sanitized_organization
                )
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Organization not found",
                )

            # Build update dict
            update_data = {
                "full_name": sanitized_full_name,
                "email": sanitized_email,
                "designation": sanitized_designation,
                "organization": sanitized_organization,
                "phone": sanitized_phone,
            }
            if sanitized_email != user.email:
                update_data["is_verified"] = False
            if sanitized_organization != user.organization:
                update_data["verified"] = False

            await self.auth_service.user_db.update(user, update_data)
            self.logger.info("Profile updated successfully for user_id=%s", user.id)
            return JSONResponse(
                content={"detail": "Profile updated successfully"},
                status_code=status.HTTP_200_OK,
            )
        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Error updating profile for user_id=%s: %s", user.id, e
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error processing edit profile request",
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


@router.put("/edit_profile")
async def edit_profile(
    user: User = Depends(get_current_active_user),
    controller: UserController = Depends(get_user_controller),
    full_name: str = Form(..., description="Full name"),
    email: str = Form(..., description="Email"),
    designation: Optional[str] = Form(None, description="Designation"),
    organization: str = Form(..., description="Organization ID"),
    phone: Optional[str] = Form(None, description="Phone"),
):
    """
    Update the signed-in user's profile from form data.
    Requires valid session cookie. Resets is_verified if email changes,
    verified if organization changes.
    """
    try:
        return await controller.edit_profile(
            user=user,
            full_name=full_name,
            email=email,
            designation=designation,
            organization=organization,
            phone=phone,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in /edit_profile: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing edit profile request",
        )

