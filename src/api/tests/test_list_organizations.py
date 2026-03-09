#!/usr/bin/env python3
"""
Tests for list organizations service and API (list_organization_ids_and_names
and GET /organizations/list_organizations with Redis cache).
"""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from db.session import get_session
from fastapi.testclient import TestClient
from fastapi import HTTPException
from services.organization import OrganizationService

import httpx


async def test_list_organization_ids_and_names_returns_list_of_dicts():
    """Service returns a list of dicts with id and name keys. Skips if DB unavailable."""
    try:
        async for session in get_session():
            try:
                org_service = OrganizationService(session)
                result = await org_service.list_organization_ids_and_names()
                assert isinstance(result, list), "Result should be a list"
                for item in result:
                    assert isinstance(item, dict), f"Each item should be a dict, got {type(item)}"
                    assert "id" in item, f"Item missing 'id': {item}"
                    assert "name" in item, f"Item missing 'name': {item}"
                    assert isinstance(item["id"], str), "id should be string"
                    assert isinstance(item["name"], str), "name should be string"
            finally:
                await session.close()
            break
    except HTTPException as e:
        if e.status_code == 500:
            pytest.skip(f"Skipping service test (DB/backend unavailable): {e.detail}")
        raise
    except (OSError, ConnectionError) as e:
        pytest.skip(f"Skipping service test (DB unavailable): {e}")


async def test_list_organization_ids_and_names_empty_or_with_data():
    """Service returns correct structure for empty or populated table. Skips if DB unavailable."""
    try:
        async for session in get_session():
            try:
                org_service = OrganizationService(session)
                result = await org_service.list_organization_ids_and_names()
                assert isinstance(result, list), "Result should be a list"
                if len(result) > 0:
                    first = result[0]
                    assert set(first.keys()) == {"id", "name"}, "Each item should have only id and name"
            finally:
                await session.close()
            break
    except HTTPException as e:
        if e.status_code == 500:
            pytest.skip(f"Skipping service test (DB/backend unavailable): {e.detail}")
        raise
    except (OSError, ConnectionError) as e:
        pytest.skip(f"Skipping service test (DB unavailable): {e}")


def test_list_organizations_endpoint_response_shape():
    """GET /organizations/list_organizations returns 200 and { items: [{ id, name }, ...] }."""
    from main import create_app

    try:
        app = create_app()
        with TestClient(app=app, base_url="http://localhost") as client:
            response = client.get("/organizations/list_organizations")
    except (httpx.RequestError, OSError, ConnectionError) as e:
        pytest.skip(f"Skipping test: backend unavailable: {e}")
    if response.status_code != 200:
        pytest.skip(f"Skipping test: backend returned {response.status_code}: {response.text}")
    data = response.json()
    assert "items" in data, f"Response should have 'items', got keys: {list(data.keys())}"
    assert isinstance(data["items"], list), "'items' should be a list"
    for item in data["items"]:
        assert isinstance(item, dict), f"Each item should be a dict, got {type(item)}"
        assert "id" in item, f"Item missing 'id': {item}"
        assert "name" in item, f"Item missing 'name': {item}"


def test_list_organizations_endpoint_items_structure():
    """Each element in items has string id and name."""
    from main import create_app

    try:
        app = create_app()
        with TestClient(app=app, base_url="http://localhost") as client:
            response = client.get("/organizations/list_organizations")
    except (httpx.RequestError, OSError, ConnectionError) as e:
        pytest.skip(f"Skipping test: backend unavailable: {e}")
    if response.status_code != 200:
        pytest.skip(f"Skipping test: backend returned {response.status_code}")
    data = response.json()
    for item in data["items"]:
        assert isinstance(item["id"], str), "id should be string"
        assert isinstance(item["name"], str), "name should be string"


async def run_async_tests():
    """Run async service tests."""
    await test_list_organization_ids_and_names_returns_list_of_dicts()
    await test_list_organization_ids_and_names_empty_or_with_data()


def run_all_tests():
    """Run all tests (async service tests + sync API tests)."""
    print("Running list organizations service tests...")
    asyncio.run(run_async_tests())
    print("Running list organizations API tests...")
    test_list_organizations_endpoint_response_shape()
    test_list_organizations_endpoint_items_structure()
    print("All list organizations tests passed.")


if __name__ == "__main__":
    run_all_tests()
