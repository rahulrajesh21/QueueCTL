#!/bin/bash
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo "Testing Job Output Logging Feature"
echo "===================================="
echo ""

# Clean up
rm -rf data/

# Test 1: Successful job with output
echo "Test 1: Capture output from successful job"
echo "-------------------------------------------"
node index.js enqueue '{"command":"echo Success Output Test"}' > /dev/null
node index.js worker start &
WORKER_PID=$!
sleep 2
kill $WORKER_PID 2>/dev/null
wait $WORKER_PID 2>/dev/null

JOB_ID=$(node index.js list --state completed | grep "ID:" | head -1 | awk '{print $2}')
OUTPUT=$(node index.js logs "$JOB_ID" | grep "Success Output Test")

if [ ! -z "$OUTPUT" ]; then
    echo -e "${GREEN}✓ PASS${NC}: Output captured for successful job"
else
    echo -e "${RED}✗ FAIL${NC}: Output not captured"
fi
echo ""

# Test 2: Failed job with error output
echo "Test 2: Capture error output from failed job"
echo "---------------------------------------------"
node index.js enqueue '{"command":"ls /nonexistent","max_retries":1}' > /dev/null
node index.js worker start &
WORKER_PID=$!
sleep 3
kill $WORKER_PID 2>/dev/null
wait $WORKER_PID 2>/dev/null

DLQ_JOB_ID=$(node index.js dlq list | grep "ID:" | head -1 | awk '{print $2}')
ERROR_OUTPUT=$(node index.js logs "$DLQ_JOB_ID" | grep "No such file")

if [ ! -z "$ERROR_OUTPUT" ]; then
    echo -e "${GREEN}✓ PASS${NC}: Error output captured for failed job"
else
    echo -e "${RED}✗ FAIL${NC}: Error output not captured"
fi
echo ""

# Test 3: Output preview in list command
echo "Test 3: Output preview in list command"
echo "---------------------------------------"
LIST_OUTPUT=$(node index.js list --state completed | grep "Output:")

if [ ! -z "$LIST_OUTPUT" ]; then
    echo -e "${GREEN}✓ PASS${NC}: Output preview shown in list"
else
    echo -e "${RED}✗ FAIL${NC}: Output preview not shown"
fi

echo "===================================="
echo "Logging Feature Tests Complete!"
echo "===================================="
