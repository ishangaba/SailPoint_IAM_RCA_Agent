"""
Agent startup: connect MCP client, start FastAPI webhook server.
"""
import asyncio
import sys
import os
import uvicorn

# Add project root to sys.path so the `agent` package is importable as `agent.xxx`
# This makes relative imports within sub-packages (agent.agent, agent.servicenow) work correctly.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load .env into os.environ early so the MCP server subprocess inherits all env vars
# (pydantic-settings reads .env but does NOT put the values into os.environ)
try:
    from dotenv import load_dotenv
    _env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    load_dotenv(_env_file, override=False)
except ImportError:
    pass

from agent.agent.rca_agent import RCAAgent
from agent.mcp_client import MCPClient
from agent.servicenow.client import ServiceNowClient
from agent.servicenow.webhook import app, set_dependencies
from agent.config import settings


async def startup() -> None:
    print(f"[main] Starting IIQ RCA Agent (mock={settings.iiq_use_mock})")

    # 1. Start MCP server subprocess and initialize connection
    mcp = MCPClient()
    await mcp.start()
    print("[main] MCP client connected")

    # 2. Create RCA agent
    agent = RCAAgent(mcp_client=mcp)

    # 3. Create ServiceNow client
    try:
        snow = ServiceNowClient()
    except ValueError as e:
        print(f"[main] WARNING: ServiceNow client not configured: {e}")
        print("[main] Work-notes write-back will be disabled")
        snow = None  # type: ignore

    # 4. Wire up dependencies into FastAPI app
    set_dependencies(agent, snow)  # type: ignore
    print(f"[main] Agent ready. Listening on port {settings.agent_port}")


def main() -> None:
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(startup())

    config = uvicorn.Config(
        app=app,
        host="0.0.0.0",
        port=settings.agent_port,
        loop="asyncio",
        log_level="info",
    )
    server = uvicorn.Server(config)
    loop.run_until_complete(server.serve())


if __name__ == "__main__":
    main()
