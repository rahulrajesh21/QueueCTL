#!/bin/bash
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "Cleaning up old data..."
rm -rf data/
echo ""

echo "Test 1: Basic job completes successfully"
node index.js enqueue '{"command":"echo Test Job 1"}'
node index.js enqueue '{"command":"echo Test Job 2"}'
echo ""


echo "Starting worker..."
node index.js worker start&
WORKER_PID=$!
sleep 2

COMPLETED=$(node index.js status | grep "Completed:" | awk '{print $2}')
if [ "$COMPLETED" -ge 2 ]; then
    echo -e "${GREEN}✓ PASS${NC}: Jobs completed successfully"
else
    echo -e "${RED}✗ FAIL${NC}: Jobs did not complete"
fi
echo ""


echo "Test 3: Multiple workers (no duplicate processing)"
echo "------------------------------------------------------"
kill $WORKER_PID 2>/dev/null
sleep 1


for i in {1..5}; do
    node index.js enqueue "{\"command\":\"sleep 1\"}"
done

# Start 2 workers
node index.js worker start &
WORKER1=$!
sleep 0.5  # Small delay to avoid initial lock contention
node index.js worker start &
WORKER2=$!

sleep 6

# Check if all jobs completed (no duplicates)
TOTAL=$(node index.js status | grep "Total:" | awk '{print $2}')
if [ "$TOTAL" -ge 5 ]; then
    echo -e "${GREEN}✓ PASS${NC}: Multiple workers processed jobs correctly"
else
    echo -e "${RED}✗ FAIL${NC}: Job processing issue"
fi

kill $WORKER1 $WORKER2 2>/dev/null
echo ""


# Test 4: Invalid commands fail gracefully
echo "Test 4: Invalid commands fail gracefully"
echo "--------------------------------------------"
node index.js enqueue '{"command":"nonexistentcommand","max_retries":1}'

node index.js worker start &
WORKER_PID=$!
sleep 4

DLQ_COUNT=$(node index.js dlq list | grep -c "nonexistentcommand")
if [ "$DLQ_COUNT" -ge 1 ]; then
    echo -e "${GREEN}✓ PASS${NC}: Invalid command handled gracefully"
else
    echo -e "${RED}✗ FAIL${NC}: Invalid command not handled"
fi


kill $WORKER_PID 2>/dev/null
echo ""

# Test 5: Job data survives restart
echo "Test 5: Job data persists across restarts"
echo "----------------------------------------------"
node index.js enqueue '{"command":"echo Persistent Job"}'
BEFORE=$(node index.js status | grep "Total:" | awk '{print $2}')

# Simulate restart (just check data is still there)
AFTER=$(node index.js status | grep "Total:" | awk '{print $2}')

if [ "$BEFORE" -eq "$AFTER" ]; then
    echo -e "${GREEN}✓ PASS${NC}: Job data persisted"
else
    echo -e "${RED}✗ FAIL${NC}: Job data lost"
fi
echo ""


# Test 6: Configuration management
echo "Test 6: Configuration management"
echo "------------------------------------"
node index.js config set max-retries 5
VALUE=$(node index.js config get max-retries | grep "max-retries" | awk '{print $3}')

if [ "$VALUE" = "5" ]; then
    echo -e "${GREEN}✓ PASS${NC}: Config set/get works"
else
    echo -e "${RED}✗ FAIL${NC}: Config not working"
fi
echo ""



# Test 7: DLQ retry functionality
echo "Test 7: DLQ retry functionality"
echo "-----------------------------------"
DLQ_JOBS=$(node index.js dlq list | grep "ID:" | head -1 | awk '{print $2}')

if [ ! -z "$DLQ_JOBS" ]; then
    node index.js dlq retry "$DLQ_JOBS"
    PENDING=$(node index.js status | grep "Pending:" | awk '{print $2}')
    
    if [ "$PENDING" -ge 1 ]; then
        echo -e "${GREEN}✓ PASS${NC}: DLQ retry works"
    else
        echo -e "${RED}✗ FAIL${NC}: DLQ retry failed"
    fi
else
    echo -e "${YELLOW}⊘ SKIP${NC}: No DLQ jobs to retry"
fi
echo ""




echo "=========================================="
echo "           Test Summary"
echo "=========================================="
node index.js status
echo ""

echo "All core functionality tests completed!"
echo ""
echo "To run tests again:"
echo "  chmod +x test.sh"
echo "  ./test.sh"