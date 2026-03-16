"""
ServiceNow Table API client.
Credentials always loaded from environment variables — never hardcoded.
"""
import httpx
import os
from typing import Any, Optional
from ..config import settings


class ServiceNowClient:
    """
    HTTP client for ServiceNow Table API.
    Uses Basic Auth. Credentials from environment variables.
    """

    def __init__(self):
        if not settings.snow_username or not settings.snow_password:
            raise ValueError(
                "SNOW_USERNAME and SNOW_PASSWORD must be set in environment"
            )
        self._base_url = settings.snow_base_url.rstrip("/")
        self._auth = (settings.snow_username, settings.snow_password)
        self._headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    async def get_incident(self, sys_id: str) -> dict[str, Any]:
        """Get a single incident by sys_id."""
        async with httpx.AsyncClient(auth=self._auth, headers=self._headers, timeout=15) as client:
            resp = await client.get(
                f"{self._base_url}/api/now/table/incident/{sys_id}",
                params={"sysparm_display_value": "true"},
            )
            resp.raise_for_status()
            return resp.json().get("result", {})

    async def update_incident(
        self,
        sys_id: str,
        work_notes: str,
        state: Optional[str] = None,
        assignment_group: Optional[str] = None,
        resolution_code: Optional[str] = None,
        resolution_notes: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        PATCH an incident with work notes and optional state/assignment changes.

        State values:
          "1" = New
          "2" = In Progress
          "6" = Resolved
        """
        payload: dict[str, Any] = {"work_notes": work_notes}
        if state is not None:
            payload["state"] = state
        if assignment_group is not None:
            payload["assignment_group"] = assignment_group
        if resolution_code is not None:
            payload["resolution_code"] = resolution_code
        if resolution_notes is not None:
            payload["close_notes"] = resolution_notes

        async with httpx.AsyncClient(auth=self._auth, headers=self._headers, timeout=15) as client:
            resp = await client.patch(
                f"{self._base_url}/api/now/table/incident/{sys_id}",
                json=payload,
            )
            resp.raise_for_status()
            return resp.json().get("result", {})

    async def get_user(self, user_name: str) -> dict[str, Any]:
        """Look up a ServiceNow user record by user_name."""
        async with httpx.AsyncClient(auth=self._auth, headers=self._headers, timeout=15) as client:
            resp = await client.get(
                f"{self._base_url}/api/now/table/sys_user",
                params={
                    "sysparm_query": f"user_name={user_name}",
                    "sysparm_fields": "sys_id,user_name,email,first_name,last_name,employee_number,active",
                    "sysparm_limit": "1",
                },
            )
            resp.raise_for_status()
            results = resp.json().get("result", [])
            return results[0] if results else {}
