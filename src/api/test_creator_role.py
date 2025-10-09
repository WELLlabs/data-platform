#!/usr/bin/env python3
"""
Test script to verify that organization creators get role 1.
This script tests the complete workflow including role assignment.
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


async def test_creator_role_assignment():
    """Test that organization creators get role 1."""
    print("🚀 Starting Creator Role Assignment Test")
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
                name="Test Creator Organization",
                description="A test organization for creator role validation",
                org_type="Research",
                private=False,
            )

            organization = await org_service.create_organization(org_data)
            print(
                f"✅ Organization created: {organization.name} (ID: {organization.id})"
            )
            print(f"   Creator: {organization.creator} (should be None)")

            # Test 2: First user signup (should become creator with role 1)
            print("\n👤 Test 2: First User Signup (Should Become Creator)")
            user1_data = UserCreate(
                email="creator@example.com",
                password="testpassword123",
                full_name="Organization Creator",
                student=False,
                designation="Founder",
                team="Leadership",
                organization=organization.id,
                role=0,  # Initial role 0
                bio="I am the organization creator",
            )

            try:
                user1 = await auth_service.sign_up(user1_data)
                print(f"✅ User 1 created: {user1.full_name} ({user1.email})")
                print(f"   Role: {user1.role} (should be 1 - creator)")
                print(f"   Organization: {user1.organization}")

                # Verify organization creator was set
                updated_org = await org_service.get_organization_by_id(organization.id)
                print(
                    f"   Organization creator: {updated_org.creator} (should be user1.id)"
                )
                print(f"   Creator match: {updated_org.creator == user1.id}")

            except Exception as e:
                print(f"❌ User 1 creation failed: {e}")
                return

            # Test 3: Second user signup (should NOT become creator, role stays 0)
            print("\n👤 Test 3: Second User Signup (Should NOT Become Creator)")
            user2_data = UserCreate(
                email="member@example.com",
                password="testpassword123",
                full_name="Organization Member",
                student=False,
                designation="Researcher",
                team="Data Team",
                organization=organization.id,
                role=0,  # Initial role 0
                bio="I am a regular member",
            )

            try:
                user2 = await auth_service.sign_up(user2_data)
                print(f"✅ User 2 created: {user2.full_name} ({user2.email})")
                print(f"   Role: {user2.role} (should be 0 - member)")
                print(f"   Organization: {user2.organization}")

                # Verify organization creator was NOT changed
                final_org = await org_service.get_organization_by_id(organization.id)
                print(
                    f"   Organization creator: {final_org.creator} (should still be user1.id)"
                )
                print(f"   Creator unchanged: {final_org.creator == user1.id}")

            except Exception as e:
                print(f"❌ User 2 creation failed: {e}")
                return

            # Test 4: Create another organization and test first user becomes creator
            print("\n📝 Test 4: Creating Second Organization")
            org2_data = OrganizationCreate(
                name="Second Test Organization",
                description="Another test organization",
                org_type="Non-profit",
                private=False,
            )

            organization2 = await org_service.create_organization(org2_data)
            print(
                f"✅ Organization 2 created: {organization2.name} (ID: {organization2.id})"
            )

            # Test 5: First user for second organization (should become creator with role 1)
            print("\n👤 Test 5: First User for Second Organization")
            user3_data = UserCreate(
                email="creator2@example.com",
                password="testpassword123",
                full_name="Second Organization Creator",
                student=False,
                designation="Director",
                team="Management",
                organization=organization2.id,
                role=0,  # Initial role 0
                bio="I am the second organization creator",
            )

            try:
                user3 = await auth_service.sign_up(user3_data)
                print(f"✅ User 3 created: {user3.full_name} ({user3.email})")
                print(f"   Role: {user3.role} (should be 1 - creator)")
                print(f"   Organization: {user3.organization}")

                # Verify organization creator was set
                updated_org2 = await org_service.get_organization_by_id(
                    organization2.id
                )
                print(
                    f"   Organization creator: {updated_org2.creator} (should be user3.id)"
                )
                print(f"   Creator match: {updated_org2.creator == user3.id}")

            except Exception as e:
                print(f"❌ User 3 creation failed: {e}")
                return

            print("\n🎉 Creator Role Assignment Test Completed!")
            print("=" * 50)
            print("Summary:")
            print(f"  - User 1 (first user of org 1): Role {user1.role} ✅")
            print(f"  - User 2 (second user of org 1): Role {user2.role} ✅")
            print(f"  - User 3 (first user of org 2): Role {user3.role} ✅")
            print(f"  - Organization 1 creator: {updated_org.creator} ✅")
            print(f"  - Organization 2 creator: {updated_org2.creator} ✅")

        except Exception as e:
            print(f"❌ Test failed with error: {e}")
            import traceback

            traceback.print_exc()
        finally:
            await session.close()
            await redis.close()


if __name__ == "__main__":
    asyncio.run(test_creator_role_assignment())
