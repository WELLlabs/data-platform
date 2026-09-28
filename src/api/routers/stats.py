"""Public homepage aggregate statistics."""

from fastapi import APIRouter, Depends

from schemas.stats import HomepageStatsResponse
from services.stats import StatsService, get_stats_service

router = APIRouter(tags=["Stats"])


class StatsController:
    """Thin controller delegating to StatsService."""

    def __init__(self, stats_service: StatsService) -> None:
        self.stats_service = stats_service

    async def get_homepage_stats(self) -> HomepageStatsResponse:
        return await self.stats_service.get_homepage_stats()


def get_stats_controller(
    stats_service: StatsService = Depends(get_stats_service),
) -> StatsController:
    return StatsController(stats_service=stats_service)


@router.get("/homepage_stats", response_model=HomepageStatsResponse)
async def homepage_stats(
    controller: StatsController = Depends(get_stats_controller),
) -> HomepageStatsResponse:
    """Aggregate open dataset count, top contributors, and top organizations."""
    return await controller.get_homepage_stats()
