#!/bin/bash

# API Testing Script for Orchestra - Project Operations
# Tests project-specific endpoints

BASE_URL="http://localhost:4010"
PROJECT_ID="f3a6da1e86bc8ccb146ad55d16e474c3"

echo "=== Project Operations Test ==="
echo "Project ID: $PROJECT_ID"
echo ""

# Test project details
echo "1. Project Details"
curl -s "$BASE_URL/api/v1/projects/$PROJECT_ID" | jq . || echo "FAILED: Get project details"
echo ""

# Test project tree
echo "2. Project File Tree"
curl -s "$BASE_URL/api/v1/projects/$PROJECT_ID/tree" | jq . || echo "FAILED: Get project tree"
echo ""

# Test project git stats
echo "3. Project Git Stats"
curl -s "$BASE_URL/api/v1/projects/$PROJECT_ID/git" | jq . || echo "FAILED: Get project git stats"
echo ""

# Test git operations
echo "4. Git Operations"
echo "Git commit..."
curl -s -X POST "$BASE_URL/api/v1/projects/$PROJECT_ID/git/commit" \
  -H "Content-Type: application/json" \
  -d '{"message": "test commit"}' | jq . || echo "FAILED: Git commit"
echo ""

echo "Git push..."
curl -s -X POST "$BASE_URL/api/v1/projects/$PROJECT_ID/git/push" \
  -H "Content-Type: application/json" \
  -d '{}' | jq . || echo "FAILED: Git push"
echo ""

echo "Git pull..."
curl -s -X POST "$BASE_URL/api/v1/projects/$PROJECT_ID/git/pull" \
  -H "Content-Type: application/json" \
  -d '{}' | jq . || echo "FAILED: Git pull"
echo ""

echo "=== Project Operations Test Complete ==="
