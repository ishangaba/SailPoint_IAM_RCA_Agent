FROM python:3.12-slim AS python-base
WORKDIR /app

# Install Node.js (needed to run the MCP server subprocess)
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Build MCP server first (build context is repo root)
COPY mcp-server/package*.json /mcp-server/
WORKDIR /mcp-server
RUN npm ci

COPY mcp-server/ /mcp-server/
RUN npm run build

# Install Python dependencies
WORKDIR /app
COPY agent/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy agent source
COPY agent/ .

EXPOSE 8000
CMD ["python", "main.py"]
