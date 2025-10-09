import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from schemas.organization import (
    OrganizationCreate,
    OrganizationRead,
    OrganizationSearch,
    OrganizationUpdate,
)
from services.organization import OrganizationService, get_organization_service

router = APIRouter()


class OrganizationController:
    """
    Class-based organization controller with comprehensive error handling.
    """

    def __init__(self, org_service: OrganizationService):
        self.org_service = org_service
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

    async def get_organization(self, org_id: str) -> JSONResponse:
        """
        Get organization by ID.

        Args:
            org_id: Organization ID

        Returns:
            JSONResponse with organization data

        Raises:
            HTTPException: If organization not found
        """
        try:
            self.logger.info("Fetching organization: %s", org_id)

            organization = await self.org_service.get_organization_by_id(org_id)

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


# Dependency to get organization controller
async def get_organization_controller(
    org_service: OrganizationService = Depends(get_organization_service),
) -> OrganizationController:
    return OrganizationController(org_service)


# Route handlers
@router.post("/", response_model=OrganizationRead)
async def create_organization(
    org_data: OrganizationCreate,
    controller: OrganizationController = Depends(get_organization_controller),
):
    """
    Create a new organization.
    """
    return await controller.create_organization(org_data)


@router.get("/{org_id}", response_model=OrganizationRead)
async def get_organization(
    org_id: str,
    controller: OrganizationController = Depends(get_organization_controller),
):
    """
    Get organization by ID.
    """
    return await controller.get_organization(org_id)


@router.put("/{org_id}", response_model=OrganizationRead)
async def update_organization(
    org_id: str,
    org_data: OrganizationUpdate,
    controller: OrganizationController = Depends(get_organization_controller),
):
    """
    Update an existing organization.
    """
    return await controller.update_organization(org_id, org_data)


@router.get("/", response_model=List[OrganizationRead])
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


@router.delete("/{org_id}")
async def delete_organization(
    org_id: str,
    controller: OrganizationController = Depends(get_organization_controller),
):
    """
    Delete an organization.
    """
    return await controller.delete_organization(org_id)


@router.get("/validate/{org_id}")
async def validate_organization_id(
    org_id: str,
    controller: OrganizationController = Depends(get_organization_controller),
):
    """
    Validate if organization ID exists.
    """
    return await controller.validate_organization_id(org_id)
