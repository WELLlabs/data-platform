#!/usr/bin/env python3
"""
Test script to verify organization functionality and signup flow.
This script tests the complete organization workflow.
"""

import asyncio
import os
import sys

# Add src to path so we can import our modules
sys.path.append(os.path.join(os.path.dirname(__file__)))

from core.config import settings
from db.session import get_session
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from models.user import User
from redis.asyncio import Redis
from schemas.organization import OrganizationCreate
from schemas.user import UserCreate
from services.auth import AuthService
from services.organization import OrganizationService


async def test_organization_flow():
    """Test the complete organization workflow."""
    print("🚀 Starting Organization Flow Test")
    print("=" * 50)

    # Get database session
    async for session in get_session():
        try:
            # Initialize services
            user_db = SQLAlchemyUserDatabase(session, User)
            redis = Redis.from_url(settings.REDIS_URL, decode_responses=True)
            org_service = OrganizationService(session)
            auth_service = AuthService(user_db, redis, org_service)

            print("✅ Services initialized")

            # Test 1: Create an organization
            print("\n📝 Test 1: Creating Organization")
            org_data = OrganizationCreate(
                name="Test Organization",
                description="A test organization for validation",
                org_type="Research",
                contact="test@example.com",
                website="https://testorg.com",
                private=False,
                focus=["Data Science", "Research"],
                roi_states=["California", "New York"],
            )

            organization = await org_service.create_organization(org_data)
            print(
                f"✅ Organization created: {organization.name} (ID: {organization.id})"
            )

            # Test 2: Validate organization ID
            print("\n🔍 Test 2: Validating Organization ID")
            org_id = organization.id
            is_valid = await org_service.validate_organization_id(org_id)
            print(f"✅ Organization ID validation: {is_valid}")

            # Test 3: Test invalid organization ID
            print("\n❌ Test 3: Testing Invalid Organization ID")
            invalid_org_id = "invalid-org-id"
            is_invalid = await org_service.validate_organization_id(invalid_org_id)
            print(f"✅ Invalid organization ID validation: {not is_invalid}")

            # Test 4: Test signup with valid organization
            print("\n👤 Test 4: Testing Signup with Valid Organization")
            user_data = UserCreate(
                email="testuser@example.com",
                password="testpassword123",
                full_name="Test User",
                student=False,
                designation="Researcher",
                team="Data Team",
                organization=org_id,  # Use valid organization ID
                role=0,
                bio="Test user bio",
                phone=1234567890,
            )

            try:
                user = await auth_service.sign_up(user_data)
                print(f"✅ User created successfully: {user.full_name} ({user.email})")

                # Test 5: Check if user was set as organization creator
                print("\n👑 Test 5: Checking Organization Creator")
                updated_org = await org_service.get_organization_by_id(org_id)
                if updated_org.creator == user.id:
                    print(f"✅ User set as organization creator: {updated_org.creator}")
                else:
                    print(
                        f"❌ User not set as organization creator. Creator: {updated_org.creator}"
                    )

            except Exception as e:
                print(f"❌ User creation failed: {e}")

            # Test 6: Test signup with invalid organization
            print("\n❌ Test 6: Testing Signup with Invalid Organization")
            invalid_user_data = UserCreate(
                email="testuser2@example.com",
                password="testpassword123",
                full_name="Test User 2",
                student=False,
                designation="Researcher",
                team="Data Team",
                organization="invalid-org-id",  # Use invalid organization ID
                role=0,
                bio="Test user bio 2",
                phone=1234567890,
            )

            try:
                user2 = await auth_service.sign_up(invalid_user_data)
                print(
                    f"❌ User creation should have failed but succeeded: {user2.full_name}"
                )
            except Exception as e:
                print(
                    f"✅ User creation correctly failed with invalid organization: {e}"
                )

            print("\n🎉 Organization Flow Test Completed!")
            print("=" * 50)

        except Exception as e:
            print(f"❌ Test failed with error: {e}")
            import traceback

            traceback.print_exc()
        finally:
            await session.close()
            await redis.close()


if __name__ == "__main__":
    asyncio.run(test_organization_flow())
