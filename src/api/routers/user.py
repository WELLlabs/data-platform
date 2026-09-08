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
from redis.asyncio import Redis
from routers.dataset import _invalidate_dataset_cache, get_current_active_user_optional
from routers.upload import get_current_active_user
from services.auth import AuthService, get_auth_service
from services.auth import get_redis
from services.organization import OrganizationService, get_organization_service
from services.user import UserService, get_user_service
from services.typesense_index import safe_index_dataset
from tasks.email import send_upload_approval_response, send_user_approval_response
from utils.security import optional_api_key, sanitize_input

router = APIRouter()
logger = logging.getLogger(__name__)

_ROLE_TYPE_LABELS = {0: "Member", 1: "Admin", 2: "Reviewer"}

_USER_REJECTION_EMAIL_MESSAGE = (
    "Since your request is rejected, your profile is removed from the data portal, "
    "please contact the admin of the organization."
)

_DELETE_USER_EMAIL_MESSAGE = (
    "Your profile is removed from the data portal, please contact the admin of the organization."
)


def _role_type_label_for_email(assigned_role: int) -> str:
    return _ROLE_TYPE_LABELS.get(assigned_role, "Member")

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
        self,
        user_id: UUID,
        apikey: Optional[str] = None,
        current_user: Optional[User] = None,
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

            organization = None
            if user.organization:
                organization = await self.org_service.get_organization_by_id(
                    user.organization
                )
                if organization is None:
                    self.logger.warning(
                        "Organization not found: organization_id=%s",
                        user.organization,
                    )
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="Organization not found",
                    )

            has_edit_privilege = False
            has_user_datasets_privilege = True

            if current_user is not None and current_user.id == user_id:
                has_edit_privilege = True
                has_user_datasets_privilege = False
            elif apikey:
                apikey_belongs = await self.user_service.check_apikey_belongs_to_user(
                    apikey, user_id
                )
                if apikey_belongs:
                    has_edit_privilege = True
                    has_user_datasets_privilege = False

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
                "auth_provider": getattr(user, "auth_provider", None) or "password",
                "organization_name": organization.name if organization else None,
                "privileges": {
                    "edit": has_edit_privilege,
                    "user_datasets": has_user_datasets_privilege,
                },
            }

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

            await self.auth_service.user_db.update(user, {
                "full_name": sanitized_full_name,
                "email": sanitized_email,
                "designation": sanitized_designation,
                "organization": org.id,
                "phone": sanitized_phone,
            } | (
                {"is_verified": False} if sanitized_email != user.email else {}
            ) | (
                {"verified": False} if org.id != user.organization else {}
            ))
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

    async def get_pending_approvals(self, user: User) -> JSONResponse:
        """
        Get pending organization approvals for the signed-in user.

        Role behavior:
        - role 0: forbidden
        - role 1: pending datasets and users
        - role 2: pending datasets only
        """
        self.logger.info(
            "Fetching pending approvals for user_id=%s organization=%s role=%s",
            user.id,
            user.organization,
            user.role,
        )
        try:
            is_user_verified = await self.user_service.check_if_user_verified_by_id(
                user.id
            )
            if not is_user_verified:
                self.logger.warning(
                    "Pending approvals access blocked for unverified user_id=%s",
                    user.id,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="email address verification and/or organization approval pending.",
                )

            if user.role == 0:
                self.logger.warning(
                    "Pending approvals access denied for regular user_id=%s role=%s",
                    user.id,
                    user.role,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized to access pending approvals",
                )

            if user.role not in (1, 2):
                self.logger.warning(
                    "Pending approvals access denied for invalid role user_id=%s role=%s",
                    user.id,
                    user.role,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Invalid role for pending approvals access",
                )

            pending_datasets = await self.user_service.get_pending_dataset_approvals(
                user.organization
            )
            response_data = {"datasets": pending_datasets}

            if user.role == 1:
                response_data["users"] = (
                    await self.user_service.get_pending_user_approvals(
                        user.organization
                    )
                )

            self.logger.info(
                "Pending approvals fetched successfully for user_id=%s",
                user.id,
            )
            return JSONResponse(
                content=jsonable_encoder(response_data),
                status_code=status.HTTP_200_OK,
            )
        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Error fetching pending approvals for user_id=%s: %s", user.id, e
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error processing pending approvals request",
            )

    async def approve_user(
        self, signed_in_user: User, user_id: str, assigned_role: int = 0
    ) -> JSONResponse:
        """
        Approve a user in the signed-in admin's organization and assign role (0/1/2).
        """
        self.logger.info(
            "Approve user request received: approver_id=%s target_user_id=%s approver_role=%s assigned_role=%s",
            signed_in_user.id,
            user_id,
            signed_in_user.role,
            assigned_role,
        )
        try:
            try:
                target_user_id = UUID(user_id)
            except ValueError:
                self.logger.warning(
                    "Approve user validation failed: invalid UUID user_id=%s",
                    user_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid user_id UUID format",
                )

            is_user_verified = await self.user_service.check_if_user_verified_by_id(
                signed_in_user.id
            )
            if not is_user_verified:
                self.logger.warning(
                    "Approve user access blocked for unverified user_id=%s role=%s",
                    signed_in_user.id,
                    signed_in_user.role,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Verified account required",
                )

            if signed_in_user.role != 1:
                self.logger.warning(
                    "Approve user denied for non-admin approver_id=%s role=%s",
                    signed_in_user.id,
                    signed_in_user.role,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized to approve users",
                )

            approved_user = await self.user_service.approve_user(
                approver=signed_in_user,
                target_user_id=target_user_id,
                assigned_role=assigned_role,
            )
            role_type = _role_type_label_for_email(assigned_role)
            acceptance_message = (
                "Sign in to access the data platform with "
                f"{role_type} role permissions."
            )
            send_user_approval_response.apply_async(
                args=[
                    approved_user.email,
                    "accepted",
                    signed_in_user.full_name,
                    acceptance_message,
                ]
            )
            self.logger.info(
                "Approve user completed: approver_id=%s target_user_id=%s",
                signed_in_user.id,
                approved_user.id,
            )
            return JSONResponse(
                content={
                    "detail": "User approved successfully",
                    "user_id": str(approved_user.id),
                },
                status_code=status.HTTP_200_OK,
            )
        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Error processing approve user request: approver_id=%s target_user_id=%s error=%s",
                signed_in_user.id,
                user_id,
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error processing approve user request",
            )

    async def reject_user(self, signed_in_user: User, user_id: str) -> JSONResponse:
        """
        Reject a pending user: remove user and notify by email (admin, same org only).
        """
        self.logger.info(
            "Reject user request received: approver_id=%s target_user_id=%s approver_role=%s",
            signed_in_user.id,
            user_id,
            signed_in_user.role,
        )
        try:
            try:
                target_user_id = UUID(user_id)
            except ValueError:
                self.logger.warning(
                    "Reject user validation failed: invalid UUID user_id=%s",
                    user_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid user_id UUID format",
                )

            is_user_verified = await self.user_service.check_if_user_verified_by_id(
                signed_in_user.id
            )
            if not is_user_verified:
                self.logger.warning(
                    "Reject user access blocked for unverified user_id=%s role=%s",
                    signed_in_user.id,
                    signed_in_user.role,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Verified account required",
                )

            if signed_in_user.role != 1:
                self.logger.warning(
                    "Reject user denied for non-admin approver_id=%s role=%s",
                    signed_in_user.id,
                    signed_in_user.role,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized to reject users",
                )

            recipient_email = await self.user_service.reject_user(
                approver=signed_in_user,
                target_user_id=target_user_id,
            )
            send_user_approval_response.apply_async(
                args=[
                    recipient_email,
                    "rejected",
                    signed_in_user.full_name,
                    _USER_REJECTION_EMAIL_MESSAGE,
                ]
            )
            self.logger.info(
                "Reject user completed: approver_id=%s target_user_id=%s",
                signed_in_user.id,
                target_user_id,
            )
            return JSONResponse(
                content={"detail": "User rejected successfully"},
                status_code=status.HTTP_200_OK,
            )
        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Error processing reject user request: approver_id=%s target_user_id=%s error=%s",
                signed_in_user.id,
                user_id,
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error processing reject user request",
            )

    async def change_user_role(
        self, signed_in_user: User, user_id: str, new_role: int
    ) -> JSONResponse:
        """
        Change role for a user in the signed-in admin's organization (verified members).
        """
        self.logger.info(
            "Change user role request: actor_id=%s target_user_id=%s new_role=%s",
            signed_in_user.id,
            user_id,
            new_role,
        )
        try:
            try:
                target_user_id = UUID(user_id)
            except ValueError:
                self.logger.warning(
                    "Change user role validation failed: invalid UUID user_id=%s",
                    user_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid user_id UUID format",
                )

            is_user_verified = await self.user_service.check_if_user_verified_by_id(
                signed_in_user.id
            )
            if not is_user_verified:
                self.logger.warning(
                    "Change user role access blocked for unverified user_id=%s role=%s",
                    signed_in_user.id,
                    signed_in_user.role,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Verified account required",
                )

            if signed_in_user.role != 1:
                self.logger.warning(
                    "Change user role denied for non-admin actor_id=%s role=%s",
                    signed_in_user.id,
                    signed_in_user.role,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized to change user role",
                )

            if type(new_role) is not int or new_role not in (0, 1, 2):
                self.logger.warning(
                    "Change user role validation failed: invalid new_role=%s actor_id=%s",
                    new_role,
                    signed_in_user.id,
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Role must be 0 (Member), 1 (Admin), or 2 (Reviewer)",
                )

            updated_user = await self.user_service.change_user_role(
                actor=signed_in_user,
                target_user_id=target_user_id,
                new_role=new_role,
            )
            role_type = _role_type_label_for_email(new_role)
            update_message = f"Your role has been updated to {role_type}."
            send_user_approval_response.apply_async(
                args=[
                    updated_user.email,
                    "updated",
                    signed_in_user.full_name,
                    update_message,
                ]
            )
            self.logger.info(
                "Change user role completed: actor_id=%s target_user_id=%s",
                signed_in_user.id,
                updated_user.id,
            )
            return JSONResponse(
                content={
                    "detail": "User role updated successfully",
                    "user_id": str(updated_user.id),
                },
                status_code=status.HTTP_200_OK,
            )
        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Error processing change user role: actor_id=%s target_user_id=%s error=%s",
                signed_in_user.id,
                user_id,
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error processing change user role request",
            )

    async def delete_user(self, signed_in_user: User, user_id: str) -> JSONResponse:
        """
        Delete a user in the signed-in admin's organization (contributions + user row).
        """
        self.logger.info(
            "Delete user request: actor_id=%s target_user_id=%s",
            signed_in_user.id,
            user_id,
        )
        try:
            try:
                target_user_id = UUID(user_id)
            except ValueError:
                self.logger.warning(
                    "Delete user validation failed: invalid UUID user_id=%s",
                    user_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid user_id UUID format",
                )

            is_user_verified = await self.user_service.check_if_user_verified_by_id(
                signed_in_user.id
            )
            if not is_user_verified:
                self.logger.warning(
                    "Delete user access blocked for unverified user_id=%s role=%s",
                    signed_in_user.id,
                    signed_in_user.role,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Verified account required",
                )

            if signed_in_user.role != 1:
                self.logger.warning(
                    "Delete user denied for non-admin actor_id=%s role=%s",
                    signed_in_user.id,
                    signed_in_user.role,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized to delete users",
                )

            if not signed_in_user.is_active:
                self.logger.warning(
                    "Delete user denied: inactive account actor_id=%s",
                    signed_in_user.id,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized to perform action: account disabled",
                )

            recipient_email = await self.user_service.delete_user_by_admin(
                actor=signed_in_user,
                target_user_id=target_user_id,
            )
            send_user_approval_response.apply_async(
                args=[
                    recipient_email,
                    "deleted",
                    signed_in_user.full_name,
                    _DELETE_USER_EMAIL_MESSAGE,
                ]
            )
            self.logger.info(
                "Delete user completed: actor_id=%s target_user_id=%s",
                signed_in_user.id,
                target_user_id,
            )
            return JSONResponse(
                content={
                    "detail": "User deleted successfully",
                    "user_id": str(target_user_id),
                },
                status_code=status.HTTP_200_OK,
            )
        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Error processing delete user: actor_id=%s target_user_id=%s error=%s",
                signed_in_user.id,
                user_id,
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error processing delete user request",
            )

    async def approve_dataset(
        self,
        signed_in_user: User,
        dataset_id: str,
        redis: Redis,
    ) -> JSONResponse:
        """
        Approve a pending dataset in the signed-in user's organization.
        """
        self.logger.info(
            "Approve dataset request received: approver_id=%s dataset_id=%s role=%s",
            signed_in_user.id,
            dataset_id,
            signed_in_user.role,
        )
        try:
            try:
                target_dataset_id = UUID(dataset_id)
            except ValueError:
                self.logger.warning(
                    "Approve dataset validation failed: invalid UUID dataset_id=%s",
                    dataset_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid dataset_id UUID format",
                )

            is_user_verified = await self.user_service.check_if_user_verified_by_id(
                signed_in_user.id
            )
            if not is_user_verified:
                self.logger.warning(
                    "Approve dataset access blocked for unverified user_id=%s role=%s",
                    signed_in_user.id,
                    signed_in_user.role,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Verified account required",
                )

            if signed_in_user.role not in (1, 2) and not signed_in_user.is_superuser:
                self.logger.warning(
                    "Approve dataset denied for unauthorized approver_id=%s role=%s",
                    signed_in_user.id,
                    signed_in_user.role,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized to approve datasets",
                )

            approved_dataset = await self.user_service.approve_dataset(
                approver=signed_in_user,
                dataset_id=target_dataset_id,
            )
            await _invalidate_dataset_cache(
                approved_dataset.dataset_id, redis, self.logger
            )
            await safe_index_dataset(
                self.user_service.session, approved_dataset.dataset_id
            )
            creator_user = await self.auth_service.user_db.get(approved_dataset.creator)
            if creator_user is None:
                self.logger.warning(
                    "Approve dataset notification skipped: creator not found dataset_id=%s creator_id=%s",
                    approved_dataset.dataset_id,
                    approved_dataset.creator,
                )
            elif not creator_user.email:
                self.logger.warning(
                    "Approve dataset notification skipped: creator email missing dataset_id=%s creator_id=%s",
                    approved_dataset.dataset_id,
                    creator_user.id,
                )
            else:
                try:
                    send_upload_approval_response.apply_async(
                        args=[
                            creator_user.email,
                            approved_dataset.dataset_title,
                            signed_in_user.full_name,
                        ]
                    )
                except Exception as email_error:
                    self.logger.exception(
                        "Approve dataset notification enqueue failed dataset_id=%s creator_id=%s error=%s",
                        approved_dataset.dataset_id,
                        creator_user.id,
                        email_error,
                    )
            self.logger.info(
                "Approve dataset completed: approver_id=%s dataset_id=%s",
                signed_in_user.id,
                approved_dataset.dataset_id,
            )
            return JSONResponse(
                content={
                    "detail": "Dataset approved successfully",
                    "dataset_id": str(approved_dataset.dataset_id),
                },
                status_code=status.HTTP_200_OK,
            )
        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Error processing approve dataset request: approver_id=%s dataset_id=%s error=%s",
                signed_in_user.id,
                dataset_id,
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error processing approve dataset request",
            )

    async def reject_dataset(
        self,
        signed_in_user: User,
        dataset_id: str,
    ) -> JSONResponse:
        try:
            target_dataset_id = UUID(dataset_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid dataset_id UUID format",
            )
        is_user_verified = await self.user_service.check_if_user_verified_by_id(
            signed_in_user.id
        )
        if not is_user_verified:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Verified account required",
            )
        if signed_in_user.role not in (1, 2) and not signed_in_user.is_superuser:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized to reject datasets",
            )
        await self.user_service.reject_dataset(signed_in_user, target_dataset_id)
        return JSONResponse(
            content={"detail": "Dataset rejected", "dataset_id": dataset_id},
            status_code=status.HTTP_200_OK,
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
    apikey: Optional[str] = Depends(optional_api_key),
    current_user: Optional[User] = Depends(get_current_active_user_optional),
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

        return await controller.get_profile(user_uuid, apikey, current_user)

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


@router.get("/pending_approvals")
async def pending_approvals(
    user: User = Depends(get_current_active_user),
    controller: UserController = Depends(get_user_controller),
):
    """
    Get pending approvals for the signed-in user's organization.
    Requires a valid session cookie.
    """
    try:
        return await controller.get_pending_approvals(user)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in /pending_approvals: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing pending approvals request",
        )


@router.put("/approve_user/{user_id}/{role}")
async def approve_user_with_role(
    user_id: str,
    role: int,
    user: User = Depends(get_current_active_user),
    controller: UserController = Depends(get_user_controller),
):
    """
    Approve a pending user with explicit role (0=Member, 1=Admin, 2=Reviewer).
    Requires a valid session cookie; signed-in user must be org admin (role 1).
    """
    try:
        return await controller.approve_user(user, user_id, role)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            "Unexpected error in /approve_user/%s/%s: %s", user_id, role, e
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing approve user request",
        )


@router.put("/approve_user/{user_id}")
async def approve_user(
    user_id: str,
    user: User = Depends(get_current_active_user),
    controller: UserController = Depends(get_user_controller),
):
    """
    Approve a pending user with default role Member (0).
    Requires a valid session cookie.
    """
    try:
        return await controller.approve_user(user, user_id, 0)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in /approve_user/%s: %s", user_id, e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing approve user request",
        )


@router.delete("/reject_user/{user_id}")
async def reject_user(
    user_id: str,
    user: User = Depends(get_current_active_user),
    controller: UserController = Depends(get_user_controller),
):
    """
    Reject and remove a pending user in the signed-in admin's organization.
    Requires a valid session cookie.
    """
    try:
        return await controller.reject_user(user, user_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in /reject_user/%s: %s", user_id, e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing reject user request",
        )


@router.put("/change_user_role/{user_id}/{role}")
async def change_user_role(
    user_id: str,
    role: int,
    user: User = Depends(get_current_active_user),
    controller: UserController = Depends(get_user_controller),
):
    """
    Change a member's role in the signed-in admin's organization (0/1/2).
    Requires a valid session cookie; signed-in user must be org admin (role 1).
    """
    try:
        return await controller.change_user_role(user, user_id, role)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            "Unexpected error in /change_user_role/%s/%s: %s", user_id, role, e
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing change user role request",
        )


@router.delete("/delete_user/{user_id}")
async def delete_user(
    user_id: str,
    user: User = Depends(get_current_active_user),
    controller: UserController = Depends(get_user_controller),
):
    """
    Delete a user in the signed-in admin's organization (user_contributions + users).
    Requires a valid session cookie; signed-in user must be org admin (role 1).
    """
    try:
        return await controller.delete_user(user, user_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in /delete_user/%s: %s", user_id, e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing delete user request",
        )


@router.put("/approve_dataset/{dataset_id}")
async def approve_dataset(
    dataset_id: str,
    user: User = Depends(get_current_active_user),
    controller: UserController = Depends(get_user_controller),
    redis: Redis = Depends(get_redis),
):
    """
    Approve a pending dataset in the signed-in user's organization.
    Requires a valid session cookie.
    """
    try:
        return await controller.approve_dataset(user, dataset_id, redis)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in /approve_dataset/%s: %s", dataset_id, e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing approve dataset request",
        )


@router.delete("/reject_dataset/{dataset_id}")
async def reject_dataset(
    dataset_id: str,
    user: User = Depends(get_current_active_user),
    controller: UserController = Depends(get_user_controller),
):
    try:
        return await controller.reject_dataset(user, dataset_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in /reject_dataset/%s: %s", dataset_id, e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing reject dataset request",
        )

