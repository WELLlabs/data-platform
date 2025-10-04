"""
Simple test script to verify authentication endpoints
"""

import asyncio
from typing import Any, Dict

import httpx


class APITester:
    """Simple API tester for authentication endpoints"""

    def __init__(self, base_url: str = "http://localhost:8000"):
        self.base_url = base_url
        self.client = httpx.AsyncClient()

    async def test_health(self) -> bool:
        """Test health endpoint"""
        try:
            response = await self.client.get(f"{self.base_url}/health")
            print(f"Health check: {response.status_code} - {response.json()}")
            return response.status_code == 200
        except Exception as e:
            print(f"Health check failed: {e}")
            return False

    async def test_signup(self, user_data: Dict[str, Any]) -> bool:
        """Test user signup"""
        try:
            response = await self.client.post(
                f"{self.base_url}/api/v1/auth/signup", json=user_data
            )
            print(f"Signup: {response.status_code}")
            if response.status_code == 201:
                user_data = response.json()
                print(
                    f"User created: {user_data.get('email')} - API Key: {user_data.get('apikey', 'N/A')[:10]}..."
                )
                return True
            else:
                print(f"Signup error: {response.text}")
                return False
        except Exception as e:
            print(f"Signup failed: {e}")
            return False

    async def test_signin(self, email: str, password: str) -> bool:
        """Test user signin"""
        try:
            response = await self.client.post(
                f"{self.base_url}/api/v1/auth/signin",
                data={"email": email, "password": password},
            )
            print(f"Signin: {response.status_code}")
            if response.status_code == 200:
                user_data = response.json()
                print(f"User signed in: {user_data.get('email')}")
                return True
            else:
                print(f"Signin error: {response.text}")
                return False
        except Exception as e:
            print(f"Signin failed: {e}")
            return False

    async def close(self):
        """Close the HTTP client"""
        await self.client.aclose()


async def main():
    """Run API tests"""
    tester = APITester()

    print("Testing API endpoints...")
    print("=" * 50)

    # Test health endpoint
    print("1. Testing health endpoint...")
    health_ok = await tester.test_health()
    print()

    if not health_ok:
        print("Health check failed. Make sure the server is running.")
        await tester.close()
        return

    # Test user data
    test_user = {
        "email": "test@example.com",
        "password": "testpassword123",
        "full_name": "Test User",
        "student": False,
        "organization": "Test Organization",
        "role": 1,
        "bio": "Test bio",
        "phone": 1234567890,
    }

    # Test signup
    print("2. Testing user signup...")
    signup_ok = await tester.test_signup(test_user)
    print()

    if not signup_ok:
        print("Signup failed. Check server logs.")
        await tester.close()
        return

    # Test signin
    print("3. Testing user signin...")
    signin_ok = await tester.test_signin(test_user["email"], test_user["password"])
    print()

    # Test invalid signin
    print("4. Testing invalid signin...")
    invalid_signin = await tester.test_signin("invalid@example.com", "wrongpassword")
    print()

    # Summary
    print("=" * 50)
    print("Test Summary:")
    print(f"Health: {'✓' if health_ok else '✗'}")
    print(f"Signup: {'✓' if signup_ok else '✗'}")
    print(f"Signin: {'✓' if signin_ok else '✗'}")
    print(f"Invalid Signin (should fail): {'✓' if not invalid_signin else '✗'}")

    await tester.close()


if __name__ == "__main__":
    asyncio.run(main())
