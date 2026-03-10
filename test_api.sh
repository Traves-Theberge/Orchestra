#!/bin/bash

# API Testing Script for Orchestra
# Tests all endpoints systematically

BASE_URL="http://localhost:4000"
AUTH_TOKEN="test-token"  # Update if needed

echo "=== Orchestra API Test Suite ==="
echo "Base URL: $BASE_URL"
echo ""

# Health checks
echo "1. Health Endpoints"
curl -s "$BASE_URL/healthz" | jq . || echo "FAILED: /healthz"
curl -s "$BASE_URL/api/v1/healthz" | jq . || echo "FAILED: /api/v1/healthz"
echo ""

# State and issues
echo "2. State and Issues"
curl -s "$BASE_URL/api/v1/state" | jq . || echo "FAILED: /api/v1/state"
curl -s "$BASE_URL/api/v1/issues" | jq . || echo "FAILED: /api/v1/issues"
echo ""

# Search and events
echo "3. Search and Events"
curl -s "$BASE_URL/api/v1/search?q=test" | jq . || echo "FAILED: /api/v1/search"
curl -s "$BASE_URL/api/v1/events" | head -c 200 || echo "FAILED: /api/v1/events"
echo ""

# Agents
echo "4. Agents"
curl -s "$BASE_URL/api/v1/agents" | jq . || echo "FAILED: /api/v1/agents"
curl -s "$BASE_URL/api/v1/config/agents" | jq . || echo "FAILED: /api/v1/config/agents"
echo ""

# Projects
echo "5. Projects"
curl -s "$BASE_URL/api/v1/projects" | jq . || echo "FAILED: /api/v1/projects"
echo ""

# MCP
echo "6. MCP"
curl -s "$BASE_URL/api/v1/mcp/tools" | jq . || echo "FAILED: /api/v1/mcp/tools"
curl -s "$BASE_URL/api/v1/mcp/servers" | jq . || echo "FAILED: /api/v1/mcp/servers"
echo ""

# Warehouse
echo "7. Warehouse"
curl -s "$BASE_URL/api/v1/warehouse/stats" | jq . || echo "FAILED: /api/v1/warehouse/stats"
echo ""

# Docs
echo "8. Docs"
curl -s "$BASE_URL/api/v1/docs" | jq . || echo "FAILED: /api/v1/docs"
echo ""

echo "=== Basic GET Tests Complete ==="
