"""
Shared pytest fixtures for integration tests.
Tests run against the mock server (IIQ_USE_MOCK=true).
"""
import pytest
import httpx
import os
import asyncio
from typing import AsyncGenerator

# Mock server base URL (mock server must be running on port 3001)
MOCK_IIQ_URL = os.environ.get("MOCK_IIQ_URL", "http://localhost:3001")
AGENT_URL = os.environ.get("AGENT_URL", "http://localhost:8000")
MOCK_SNOW_BASE = MOCK_IIQ_URL  # Same process, different routes


@pytest.fixture(scope="session")
def event_loop():
    """Create a single event loop for all async tests."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
async def agent_client() -> AsyncGenerator[httpx.AsyncClient, None]:
    """HTTP client pointing at the running agent webhook."""
    async with httpx.AsyncClient(base_url=AGENT_URL, timeout=60) as client:
        yield client


@pytest.fixture
async def mock_client() -> AsyncGenerator[httpx.AsyncClient, None]:
    """HTTP client pointing at the mock IIQ/ServiceNow server."""
    async with httpx.AsyncClient(base_url=MOCK_IIQ_URL, timeout=30) as client:
        yield client


def make_incident_payload(
    scenario: str,
    caller_id: str,
    short_description: str,
    application: str = "",
    sys_id: str = "INC0001234",
) -> dict:
    """Build a ServiceNow incident webhook payload for testing."""
    return {
        "sys_id": sys_id,
        "number": sys_id,
        "caller_id": {"user_name": caller_id},
        "short_description": short_description,
        "description": short_description,
        "category": "Access",
        "u_affected_app": application,
        "scenario": scenario,
    }
