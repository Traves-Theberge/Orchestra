#!/bin/bash

# API Testing Script for Orchestra - Part 2
# Tests POST endpoints and issue operations

BASE_URL="http://localhost:4000"
AUTH_TOKEN="test-token"  # Update if needed

echo "=== Orchestra API Test Suite - Part 2 ==="
echo "Base URL: $BASE_URL"
echo ""

# Create a test issue
echo "1. Creating Test Issue"
CREATE_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/issues" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "title": "Test Issue for API Validation",
    "description": "This is a test issue created during API testing",
    "state": "Todo",
    "priority": 1,
    "assignee_id": "claude",
    "project_id": "f3a6da1e86bc8ccb146ad55d16e474c3"
  }')

echo "Create Response: $CREATE_RESPONSE"

# Extract issue identifier
ISSUE_ID=$(echo $CREATE_RESPONSE | jq -r '.identifier // empty')
echo "Created Issue ID: $ISSUE_ID"

if [ -n "$ISSUE_ID" ] && [ "$ISSUE_ID" != "null" ]; then
  echo ""
  echo "2. Testing Issue Operations"
  
  # Get issue details
  echo "Getting issue details..."
  curl -s "$BASE_URL/api/v1/issues/$ISSUE_ID" | jq . || echo "FAILED: Get issue"
  
  # Get issue logs
  echo "Getting issue logs..."
  curl -s "$BASE_URL/api/v1/issues/$ISSUE_ID/logs" | head -c 200 || echo "FAILED: Get logs"
  
  # Get issue diff
  echo "Getting issue diff..."
  curl -s "$BASE_URL/api/v1/issues/$ISSUE_ID/diff" | head -c 200 || echo "FAILED: Get diff"
  
  # Get artifacts
  echo "Getting artifacts..."
  curl -s "$BASE_URL/api/v1/issues/$ISSUE_ID/artifacts" | jq . || echo "FAILED: Get artifacts"
  
  # Patch issue
  echo "Patching issue..."
  curl -s -X PATCH "$BASE_URL/api/v1/issues/$ISSUE_ID" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -d '{"state": "In Progress"}' | jq . || echo "FAILED: Patch issue"
  
  echo ""
  echo "3. Testing MCP Operations"
  
  # Create MCP server
  echo "Creating MCP server..."
  MCP_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/mcp/servers" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -d '{"name": "test-server", "command": "echo test"}')
  echo "MCP Create Response: $MCP_RESPONSE"
  
  # Get MCP servers again
  echo "Getting MCP servers after creation..."
  curl -s "$BASE_URL/api/v1/mcp/servers" | jq . || echo "FAILED: Get MCP servers"
  
  # Extract MCP server ID
  MCP_ID=$(echo $MCP_RESPONSE | jq -r '.id // empty')
  if [ -n "$MCP_ID" ] && [ "$MCP_ID" != "null" ]; then
    echo "Deleting MCP server $MCP_ID..."
    curl -s -X DELETE "$BASE_URL/api/v1/mcp/servers/$MCP_ID" \
      -H "Authorization: Bearer $AUTH_TOKEN" || echo "FAILED: Delete MCP server"
  fi
  
  echo ""
  echo "4. Testing Project Operations"
  
  # Get project details
  PROJECT_ID="f3a6da1e86bc8ccb146ad55d16e474c3"
  echo "Getting project details..."
  curl -s "$BASE_URL/api/v1/projects/$PROJECT_ID" | jq . || echo "FAILED: Get project"
  
  # Get project tree
  echo "Getting project tree..."
  curl -s "$BASE_URL/api/v1/projects/$PROJECT_ID/tree" | jq . || echo "FAILED: Get project tree"
  
  # Get project git stats
  echo "Getting project git stats..."
  curl -s "$BASE_URL/api/v1/projects/$PROJECT_ID/git" | jq . || echo "FAILED: Get project git stats"
  
  echo ""
  echo "5. Cleanup - Deleting Test Issue"
  curl -s -X DELETE "$BASE_URL/api/v1/issues/$ISSUE_ID" \
    -H "Authorization: Bearer $AUTH_TOKEN" || echo "FAILED: Delete issue"
  
else
  echo "FAILED: Could not create test issue"
fi

echo ""
echo "=== API Test Suite - Part 2 Complete ==="
