#!/bin/bash

# Garbage System Test Runner
# Runs all unit and integration tests for the Quadra-style garbage system

echo "================================================"
echo "  Serenity Blocks - Garbage System Test Suite"
echo "================================================"
echo ""

TESTS_PASSED=0
TESTS_FAILED=0

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to run a test file
run_test() {
    local test_file=$1
    local test_name=$2

    echo -e "${YELLOW}Running: ${test_name}${NC}"
    echo "----------------------------------------"

    if node "$test_file"; then
        echo -e "${GREEN}✓ ${test_name} PASSED${NC}"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}✗ ${test_name} FAILED${NC}"
        ((TESTS_FAILED++))
    fi

    echo ""
}

# Run unit tests
echo "=== UNIT TESTS ==="
echo ""
run_test "tests/unit/test-garbage-system.js" "Garbage Calculation Unit Tests"

# Run integration tests
echo "=== INTEGRATION TESTS ==="
echo ""
run_test "tests/integration/test-garbage-queue.js" "Garbage Queue Integration Tests"
run_test "tests/integration/test-garbage-insertion.js" "Garbage Insertion Integration Tests"
run_test "tests/integration/test-end-to-end-pipeline.js" "End-to-End Pipeline Tests"

# Summary
echo "================================================"
echo "  TEST SUMMARY"
echo "================================================"
echo "Test Suites Passed: $TESTS_PASSED"
echo "Test Suites Failed: $TESTS_FAILED"
echo "Total Test Suites:  $((TESTS_PASSED + TESTS_FAILED))"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ ALL TEST SUITES PASSED!${NC}"
    echo ""
    echo "The Quadra-style garbage system is working correctly:"
    echo "  ✓ Deterministic hole mask generation"
    echo "  ✓ Cascade tracking with position changes"
    echo "  ✓ Clean field bonus calculation"
    echo "  ✓ FIFO garbage queueing"
    echo "  ✓ Garbage insertion and top-out detection"
    echo "  ✓ Blind attack handling"
    echo "  ✓ Serialization for network play"
    echo ""
    exit 0
else
    echo -e "${RED}❌ SOME TEST SUITES FAILED${NC}"
    echo ""
    echo "Please review the failed tests above."
    echo ""
    exit 1
fi
