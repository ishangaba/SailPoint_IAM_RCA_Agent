from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # IIQ
    iiq_use_mock: bool = True
    iiq_base_url: str = ""
    iiq_username: str = "svc_api_integration"
    iiq_password: str = ""
    iiq_timeout_seconds: int = 10
    iiq_max_retries: int = 3
    mock_iiq_url: str = "http://localhost:3001"

    # ServiceNow
    snow_base_url: str = "https://instance.service-now.com"
    snow_username: str = ""
    snow_password: str = ""
    snow_iam_assignment_group: str = "IAM-Ops-Team"
    snow_l3_assignment_group: str = "IAM-L3-Team"

    # MCP Server
    mcp_server_host: str = "localhost"
    mcp_server_port: int = 3000

    # Agent
    agent_port: int = 8000

    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"  # Allow env vars not declared as fields


settings = Settings()
