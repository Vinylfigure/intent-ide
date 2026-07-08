#!/usr/bin/env bash
# API smoke tests for Intent IDE
# Usage: API_KEY=sk-ant-... bash scripts/test-api.sh
# Or for Ollama: PROVIDER=ollama bash scripts/test-api.sh

API_KEY="${API_KEY:-}"
PROVIDER="${PROVIDER:-claude}"
MODEL="${MODEL:-claude-sonnet-4-6}"
BASE_URL="${BASE_URL:-}"
HOST="${HOST:-http://localhost:3000}"

PASS=0
FAIL=0

run_test() {
  local name="$1"
  local status="$2"
  local body="$3"
  if echo "$body" | grep -q '"error"'; then
    echo "FAIL [$name]: $body"
    ((FAIL++))
  elif [ "$status" -ge 400 ]; then
    echo "FAIL [$name]: HTTP $status — $body"
    ((FAIL++))
  else
    echo "PASS [$name]"
    ((PASS++))
  fi
}

# Build common headers
HEADERS=(
  -H "Content-Type: application/json"
  -H "x-api-key: $API_KEY"
  -H "x-provider: $PROVIDER"
  -H "x-model: $MODEL"
)
if [ -n "$BASE_URL" ]; then
  HEADERS+=(-H "x-base-url: $BASE_URL")
fi

echo "=== Intent IDE API Tests ==="
echo "Provider: $PROVIDER | Model: $MODEL"
echo ""

# 1. Generate document
echo "--- /api/generate ---"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$HOST/api/generate" \
  "${HEADERS[@]}" \
  -d '{"prompt":"Write a 2-sentence summary of photosynthesis."}')
BODY=$(echo "$RESP" | head -1)
STATUS=$(echo "$RESP" | tail -1)
run_test "generate/basic" "$STATUS" "$BODY"

# Check content field exists
if echo "$BODY" | grep -q '"content"'; then
  echo "  content field: present"
  SNIPPET=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['content'][:80])" 2>/dev/null || echo "(parse failed)")
  echo "  preview: $SNIPPET"
fi

echo ""

# 2. Classify annotation
echo "--- /api/classify ---"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$HOST/api/classify" \
  "${HEADERS[@]}" \
  -d '{"transcript":"What does this paragraph mean?","context":"The mitochondria is the powerhouse of the cell."}')
BODY=$(echo "$RESP" | head -1)
STATUS=$(echo "$RESP" | tail -1)
run_test "classify/basic" "$STATUS" "$BODY"

if echo "$BODY" | grep -q '"type"'; then
  TYPE=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('type','?'))" 2>/dev/null || echo "?")
  echo "  classified as: $TYPE"
fi

echo ""

# 3. Resolve annotation
echo "--- /api/resolve ---"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$HOST/api/resolve" \
  "${HEADERS[@]}" \
  -d '{
    "annotation": {
      "id": "test-1",
      "type": "question",
      "transcript": "What does photosynthesis produce?",
      "anchor": { "from": 0, "to": 50, "scope": "sentence", "text": "Photosynthesis is a process." }
    },
    "sessionContext": "",
    "documentSlice": "Photosynthesis is a process used by plants."
  }')
BODY=$(echo "$RESP" | head -1)
STATUS=$(echo "$RESP" | tail -1)
run_test "resolve/basic" "$STATUS" "$BODY"

if echo "$BODY" | grep -q '"content"'; then
  SNIPPET=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['content'][:80])" 2>/dev/null || echo "(parse failed)")
  echo "  preview: $SNIPPET"
fi

echo ""

# 4. Missing API key (should fail with 401 for non-Ollama)
if [ "$PROVIDER" != "ollama" ]; then
  echo "--- Auth check ---"
  RESP=$(curl -s -w "\n%{http_code}" -X POST "$HOST/api/generate" \
    -H "Content-Type: application/json" \
    -H "x-provider: claude" \
    -d '{"prompt":"test"}')
  BODY=$(echo "$RESP" | head -1)
  STATUS=$(echo "$RESP" | tail -1)
  if [ "$STATUS" -eq 401 ]; then
    echo "PASS [auth/no-key-rejected]"
    ((PASS++))
  else
    echo "FAIL [auth/no-key-rejected]: expected 401, got $STATUS"
    ((FAIL++))
  fi
  echo ""
fi

echo "==========================="
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ] && exit 0 || exit 1
