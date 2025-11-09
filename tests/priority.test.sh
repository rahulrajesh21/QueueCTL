#!/bin/bash
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo "Testing Job Priority Queue"
echo "=========================="
echo ""

# Clean up
rm -rf data/

echo "Test: Priority Queue Processing"
echo "--------------------------------"

# Enqueue jobs with different priorities
queuectl enqueue '{"command":"echo Low Priority","priority":0}' > /dev/null
LOW_ID=$(queuectl list --state pending | grep "Low Priority" -B 1 | grep "ID:" | awk '{print $2}')

queuectl enqueue '{"command":"echo Normal Priority","priority":1}' > /dev/null
NORMAL_ID=$(queuectl list --state pending | grep "Normal Priority" -B 1 | grep "ID:" | awk '{print $2}')

queuectl enqueue '{"command":"echo High Priority","priority":2}' > /dev/null
HIGH_ID=$(queuectl list --state pending | grep "High Priority" -B 1 | grep "ID:" | awk '{print $2}')

queuectl enqueue '{"command":"echo URGENT Priority","priority":3}' > /dev/null
URGENT_ID=$(queuectl list --state pending | grep "URGENT Priority" -B 1 | grep "ID:" | awk '{print $2}')

echo "Enqueued 4 jobs with priorities: Low(0), Normal(1), High(2), Urgent(3)"
echo ""

# Start worker and process one job at a time
queuectl worker start &
WORKER_PID=$!
sleep 2

# Check which job was processed first (should be URGENT)
FIRST_COMPLETED=$(queuectl list --state completed | grep "ID:" | head -1 | awk '{print $2}')

if [ "$FIRST_COMPLETED" = "$URGENT_ID" ]; then
    echo -e "${GREEN}✓ PASS${NC}: Urgent priority job processed first"
else
    echo -e "${RED}✗ FAIL${NC}: Wrong job processed first"
fi

# Wait for all jobs to complete
sleep 5

kill $WORKER_PID 2>/dev/null
wait $WORKER_PID 2>/dev/null

echo ""
echo "Priority Queue Test Complete!"
