"""
Python MCP client for the iiq-rca-server.
Starts the MCP server as a subprocess and communicates via stdio.
"""
import asyncio
import json
import os
import subprocess
import sys
from typing import Any


class MCPClient:
    def __init__(self):
        self._process: asyncio.subprocess.Process | None = None
        self._request_id = 0
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        """Start the MCP server subprocess."""
        mcp_server_path = os.path.join(
            os.path.dirname(__file__), "..", "mcp-server"
        )
        # Prefer compiled dist/index.js if available (works cross-platform).
        # Fall back to ts-node-dev for development environments without a build.
        dist_path = os.path.join(mcp_server_path, "dist", "index.js")
        # Resolve node executable — on Windows it may not be on the subprocess PATH
        node_exe = "node"
        if sys.platform == "win32":
            # Search common install locations so the subprocess can find node
            candidates = [
                r"C:\Program Files\nodejs\node.exe",
                r"C:\Program Files (x86)\nodejs\node.exe",
                os.path.join(os.environ.get("APPDATA", ""), r"nvm\current\node.exe"),
            ]
            for candidate in candidates:
                if os.path.exists(candidate):
                    node_exe = candidate
                    break
        if os.path.exists(dist_path):
            cmd = [node_exe, "dist/index.js"]
        else:
            # On Windows npx is npx.cmd; use sys.platform to pick the right name
            npx = "npx.cmd" if sys.platform == "win32" else "npx"
            cmd = [npx, "ts-node-dev", "--transpile-only", "src/index.ts"]

        env = {**os.environ}

        self._process = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=mcp_server_path,
            env=env,
        )

        assert self._process.stdin
        assert self._process.stdout

        self._writer = self._process.stdin
        self._reader = self._process.stdout

        # Start stderr logging
        asyncio.create_task(self._log_stderr())

        # Initialize MCP session
        await self._initialize()

    async def _log_stderr(self) -> None:
        assert self._process and self._process.stderr
        while True:
            line = await self._process.stderr.readline()
            if not line:
                break
            print(f"[MCP] {line.decode().rstrip()}", file=sys.stderr)

    async def _initialize(self) -> None:
        """Send MCP initialize request."""
        response = await self._send_request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "clientInfo": {"name": "iiq-rca-agent", "version": "1.0.0"},
        })
        # Send initialized notification
        await self._send_notification("notifications/initialized", {})

    async def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> Any:
        """Call an MCP tool and return the parsed result."""
        response = await self._send_request("tools/call", {
            "name": tool_name,
            "arguments": arguments,
        })

        if "error" in response:
            raise RuntimeError(f"MCP tool error: {response['error']}")

        content = response.get("result", {}).get("content", [])
        if content and content[0].get("type") == "text":
            return json.loads(content[0]["text"])
        return response

    async def _send_request(self, method: str, params: dict) -> dict:
        async with self._lock:
            self._request_id += 1
            request_id = self._request_id

            message = {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": method,
                "params": params,
            }

            await self._write_message(message)
            return await self._read_response(request_id)

    async def _send_notification(self, method: str, params: dict) -> None:
        message = {"jsonrpc": "2.0", "method": method, "params": params}
        await self._write_message(message)

    async def _write_message(self, message: dict) -> None:
        # MCP SDK >=1.x uses newline-delimited JSON (not Content-Length framing)
        assert self._writer
        data = json.dumps(message) + "\n"
        self._writer.write(data.encode())
        await self._writer.drain()

    async def _read_response(self, expected_id: int) -> dict:
        assert self._reader
        # Read a complete newline-terminated JSON line
        while True:
            line = await self._reader.readline()
            if not line:
                raise ConnectionError("MCP server closed connection")
            stripped = line.decode().strip()
            if not stripped:
                continue  # Skip blank lines
            response = json.loads(stripped)
            if response.get("id") == expected_id:
                return response
            # Skip notifications and messages with non-matching ids

    async def stop(self) -> None:
        if self._process:
            self._process.terminate()
            await self._process.wait()
