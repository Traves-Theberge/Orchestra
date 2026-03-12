#!/bin/bash
# Orchestra Project Verification Script
BASE_URL="http://127.0.0.1:4010"
TOKEN="dev-token"
DB_PATH="/tmp/orchestra/.orchestra/warehouse.db"

echo "🔍 STEP 1: Checking Database Entries..."
sqlite3 "$DB_PATH" "SELECT id, name, root_path FROM projects;"

echo -e "\n🔍 STEP 2: Verifying Disk Access..."
PROJECTS=$(sqlite3 "$DB_PATH" "SELECT root_path FROM projects;")
for path in $PROJECTS; do
    if [ -d "$path" ]; then
        echo "✅ EXISTS: $path"
        if [ -d "$path/.git" ]; then
            echo "   ⚓ GIT FOUND"
        else
            echo "   ❌ NO .GIT FOLDER"
        fi
    else
        echo "❌ MISSING ON DISK: $path"
    fi
done

echo -e "\n🔍 STEP 3: Testing API Endpoints..."
# Get the ID for 'Fetch' or the first project
PID=$(sqlite3 "$DB_PATH" "SELECT id FROM projects LIMIT 1;")

if [ -z "$PID" ]; then
    echo "❌ No projects found in DB to test."
    exit 1
fi

echo "Testing Project ID: $PID"

echo -e "\n--- API: File Tree ---"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/v1/projects/$PID/tree" | jq '.[0:3]'

echo -e "\n--- API: Git History ---"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/v1/projects/$PID/git" | jq '.[0:3]'
