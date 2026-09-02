import json
import logging
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from models.user import User
from routers.dataset import get_current_active_user_optional
from routers.upload import get_current_active_user
from utils.security import optional_api_key
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from redis.asyncio import Redis
from schemas.organization import (
    OrganizationAddMember,
    OrganizationCreate,
    OrganizationListItem,
    OrganizationListResponse,
    OrganizationRead,
    OrganizationSearch,
    OrganizationUpdate,
)
from services.auth import get_redis
from services.organization import OrganizationService, get_organization_service
from services.user import UserService, get_user_service

from core.config import settings

ORGANIZATION_LIST_CACHE_KEY = "organization:list:v2"

router = APIRouter()


class OrganizationController:
    """
    Class-based organization controller with comprehensive error handling.
    """

    def __init__(self, org_service: OrganizationService, user_service: UserService):
        self.org_service = org_service
        self.user_service = user_service
        self.logger = logging.getLogger(__name__)

    async def create_organization(self, org_data: OrganizationCreate) -> JSONResponse:
        """
        Create a new organization.

        Args:
            org_data: Organization creation data

        Returns:
            JSONResponse with created organization data

        Raises:
            HTTPException: If creation fails
        """
        try:
            self.logger.info("Creating organization: %s", org_data.name)

            organization = await self.org_service.create_organization(org_data)

            # Convert to OrganizationRead schema
            org_read = OrganizationRead.from_orm(organization)

            return JSONResponse(
                content=jsonable_encoder(org_read.dict()),
                status_code=status.HTTP_201_CREATED,
            )

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception("Unexpected error creating organization: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Organization creation service error",
            )

    async def get_organization(
        self,
        org_id: UUID,
        apikey: Optional[str] = None,
        current_user: Optional[User] = None,
    ) -> JSONResponse:
        """
        Get organization by ID with detailed information.

        Args:
            org_id: Organization ID
            apikey: Optional API key for privilege checking

        Returns:
            JSONResponse with organization data including creator_name, members, and privileges

        Raises:
            HTTPException: If organization not found
        """
        try:
            self.logger.info("Fetching organization: %s", org_id)

            # Get organization with details
            org_dict = await self.org_service.get_organization_with_details(org_id)

            if not org_dict:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Organization not found",
                )

            # Calculate privileges
            create_privilege = False
            edit_privilege = False

            if current_user is not None:
                if current_user.is_superuser:
                    create_privilege = True
                is_admin = await self.user_service.check_if_admin_by_id(
                    org_id, current_user.id
                )
                if is_admin:
                    edit_privilege = True
            elif apikey:
                user_data = await self.user_service.get_user_by_apikey(apikey)
                if user_data and user_data.get("is_superuser"):
                    create_privilege = True
                    self.logger.info("User has create privilege (superuser)")
                is_admin = await self.user_service.check_if_admin_by_key(org_id, apikey)
                if is_admin:
                    edit_privilege = True
                    self.logger.info("User has edit privilege (admin)")

            # Add privileges to response
            org_dict["privileges"] = {
                "create": create_privilege,
                "edit": edit_privilege,
            }

            return JSONResponse(
                content=jsonable_encoder(org_dict),
                status_code=status.HTTP_200_OK,
            )

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Unexpected error fetching organization %s: %s", org_id, e
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Organization fetch service error",
            )

    async def update_organization(
        self, org_id: str, org_data: OrganizationUpdate
    ) -> JSONResponse:
        """
        Update an existing organization.

        Args:
            org_id: Organization ID
            org_data: Organization update data

        Returns:
            JSONResponse with updated organization data

        Raises:
            HTTPException: If update fails
        """
        try:
            self.logger.info("Updating organization: %s", org_id)

            organization = await self.org_service.update_organization(org_id, org_data)

            if not organization:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Organization not found",
                )

            # Convert to OrganizationRead schema
            org_read = OrganizationRead.from_orm(organization)

            return JSONResponse(
                content=jsonable_encoder(org_read.dict()),
                status_code=status.HTTP_200_OK,
            )

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Unexpected error updating organization %s: %s", org_id, e
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Organization update service error",
            )

    async def search_organizations(
        self,
        query: str = Query(None, description="Search query"),
        org_type: str = Query(None, description="Filter by organization type"),
        private: bool = Query(None, description="Filter by privacy setting"),
        limit: int = Query(20, ge=1, le=100, description="Maximum number of results"),
        offset: int = Query(0, ge=0, description="Number of results to skip"),
    ) -> JSONResponse:
        """
        Search organizations with filters.

        Args:
            query: Search query
            org_type: Filter by organization type
            private: Filter by privacy setting
            limit: Maximum number of results
            offset: Number of results to skip

        Returns:
            JSONResponse with search results

        Raises:
            HTTPException: If search fails
        """
        try:
            self.logger.info("Searching organizations with query: %s", query)

            search_params = OrganizationSearch(
                query=query,
                org_type=org_type,
                private=private,
                limit=limit,
                offset=offset,
            )

            organizations = await self.org_service.search_organizations(search_params)

            # Convert to OrganizationRead schemas
            org_reads = [OrganizationRead.from_orm(org) for org in organizations]

            return JSONResponse(
                content=jsonable_encoder([org.dict() for org in org_reads]),
                status_code=status.HTTP_200_OK,
            )

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception("Unexpected error searching organizations: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Organization search service error",
            )

    async def delete_organization(self, org_id: str) -> JSONResponse:
        """
        Delete an organization.

        Args:
            org_id: Organization ID

        Returns:
            JSONResponse with deletion confirmation

        Raises:
            HTTPException: If deletion fails
        """
        try:
            self.logger.info("Deleting organization: %s", org_id)

            deleted = await self.org_service.delete_organization(org_id)

            if not deleted:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Organization not found",
                )

            return JSONResponse(
                content={"detail": "Organization deleted successfully"},
                status_code=status.HTTP_200_OK,
            )

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Unexpected error deleting organization %s: %s", org_id, e
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Organization deletion service error",
            )

    async def validate_organization_id(self, org_id: str) -> JSONResponse:
        """
        Validate if organization ID exists.

        Args:
            org_id: Organization ID to validate

        Returns:
            JSONResponse with validation result

        Raises:
            HTTPException: If validation fails
        """
        try:
            self.logger.info("Validating organization ID: %s", org_id)

            exists = await self.org_service.validate_organization_id(org_id)

            return JSONResponse(
                content={"exists": exists, "org_id": org_id},
                status_code=status.HTTP_200_OK,
            )

        except Exception as e:
            self.logger.exception(
                "Unexpected error validating organization ID %s: %s", org_id, e
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Organization validation service error",
            )

    async def list_organizations(self, redis: Redis) -> JSONResponse:
        """
        Return list of all organizations (id and name). Uses Redis cache key
        organization:list; on miss loads from DB and caches the response.
        """
        try:
            cached = await redis.get(ORGANIZATION_LIST_CACHE_KEY)
            if cached is not None:
                try:
                    data = json.loads(cached)
                    self.logger.info(
                        "Organization list served from Redis cache (key=%s)",
                        ORGANIZATION_LIST_CACHE_KEY,
                    )
                    return JSONResponse(
                        content=data,
                        status_code=status.HTTP_200_OK,
                    )
                except (json.JSONDecodeError, TypeError) as e:
                    self.logger.warning(
                        "Invalid organization list cache value, refetching: %s", e
                    )
            self.logger.info("Organization list cache miss; fetching from database")
            items = await self.org_service.list_organization_ids_and_names()
            response_data = OrganizationListResponse(
                items=[OrganizationListItem(**x) for x in items]
            )
            body = jsonable_encoder(response_data)
            ttl = settings.ORGANIZATION_LIST_CACHE_AGE_SECONDS
            cache_value = json.dumps(body)
            try:
                await redis.setex(
                    ORGANIZATION_LIST_CACHE_KEY,
                    ttl,
                    cache_value,
                )
                self.logger.info(
                    "Organization list cached in Redis (key=%s, TTL=%s seconds)",
                    ORGANIZATION_LIST_CACHE_KEY,
                    ttl,
                )
            except Exception as e:
                self.logger.warning(
                    "Failed to set organization list cache: %s",
                    e,
                    exc_info=True,
                )
            return JSONResponse(
                content=body,
                status_code=status.HTTP_200_OK,
            )
        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Unexpected error listing organizations: %s", e
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Organization list service error",
            )


# Dependency to get organization controller
async def get_organization_controller(
    org_service: OrganizationService = Depends(get_organization_service),
    user_service: UserService = Depends(get_user_service),
) -> OrganizationController:
    return OrganizationController(org_service, user_service)


# Route handlers
@router.post("/", response_model=OrganizationRead, include_in_schema=False)
async def create_organization(
    org_data: OrganizationCreate,
    controller: OrganizationController = Depends(get_organization_controller),
    redis: Redis = Depends(get_redis),
):
    """
    Create a new organization.
    """
    response = await controller.create_organization(org_data)
    if response.status_code == status.HTTP_201_CREATED:
        try:
            await redis.delete(ORGANIZATION_LIST_CACHE_KEY)
        except Exception as e:
            logging.getLogger(__name__).warning(
                "Failed to invalidate organization list cache: %s", e
            )
    return response


@router.get("/list_organizations")
async def list_organizations(
    controller: OrganizationController = Depends(get_organization_controller),
    redis: Redis = Depends(get_redis),
):
    """
    List all organizations (id and name). Response is cached in Redis.
    """
    return await controller.list_organizations(redis)


@router.get("/{org_id}")
async def get_organization(
    org_id: UUID,
    apikey: Optional[str] = Depends(optional_api_key),
    current_user: Optional[User] = Depends(get_current_active_user_optional),
    controller: OrganizationController = Depends(get_organization_controller),
):
    """
    Get organization by ID with detailed information.
    """
    return await controller.get_organization(org_id, apikey, current_user)


@router.post("/{org_id}/members")
async def add_organization_member(
    org_id: UUID,
    payload: OrganizationAddMember,
    current_user: User = Depends(get_current_active_user),
    org_service: OrganizationService = Depends(get_organization_service),
):
    member = await org_service.add_member(
        org_id,
        current_user,
        payload.email,
        role=payload.role,
        approve_now=payload.approve_now,
    )
    return JSONResponse(
        content={
            "detail": "Member added",
            "user_id": str(member.id),
            "verified": member.verified,
            "role": member.role,
        },
        status_code=status.HTTP_201_CREATED,
    )


@router.put("/{org_id}", response_model=OrganizationRead, include_in_schema=False)
async def update_organization(
    org_id: UUID,
    org_data: OrganizationUpdate,
    controller: OrganizationController = Depends(get_organization_controller),
    redis: Redis = Depends(get_redis),
):
    """
    Update an existing organization.
    """
    response = await controller.update_organization(org_id, org_data)
    if response.status_code == status.HTTP_200_OK:
        try:
            await redis.delete(ORGANIZATION_LIST_CACHE_KEY)
        except Exception as e:
            logging.getLogger(__name__).warning(
                "Failed to invalidate organization list cache: %s", e
            )
    return response


@router.get("/", response_model=List[OrganizationRead], include_in_schema=False)
async def search_organizations(
    query: str = Query(None, description="Search query"),
    org_type: str = Query(None, description="Filter by organization type"),
    private: bool = Query(None, description="Filter by privacy setting"),
    limit: int = Query(20, ge=1, le=100, description="Maximum number of results"),
    offset: int = Query(0, ge=0, description="Number of results to skip"),
    controller: OrganizationController = Depends(get_organization_controller),
):
    """
    Search organizations with filters.
    """
    return await controller.search_organizations(
        query, org_type, private, limit, offset
    )


@router.delete("/{org_id}", include_in_schema=False)
async def delete_organization(
    org_id: UUID,
    controller: OrganizationController = Depends(get_organization_controller),
    redis: Redis = Depends(get_redis),
):
    """
    Delete an organization.
    """
    response = await controller.delete_organization(org_id)
    if response.status_code == status.HTTP_200_OK:
        try:
            await redis.delete(ORGANIZATION_LIST_CACHE_KEY)
        except Exception as e:
            logging.getLogger(__name__).warning(
                "Failed to invalidate organization list cache: %s", e
            )
    return response


@router.get("/validate/{org_id}", include_in_schema=False)
async def validate_organization_id(
    org_id: UUID,
    controller: OrganizationController = Depends(get_organization_controller),
):
    """
    Validate if organization ID exists.
    """
    return await controller.validate_organization_id(org_id)
