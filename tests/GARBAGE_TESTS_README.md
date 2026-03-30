# Quadra-Style Garbage System Tests

This directory contains comprehensive unit and integration tests for the Serenity Blocks deterministic garbage system.

## Test Structure

```
tests/
├── unit/
│   └── test-garbage-system.js          # Unit tests for garbage calculation
├── integration/
│   ├── test-garbage-queue.js           # Integration tests for FIFO queue
│   ├── test-garbage-insertion.js       # Integration tests for board insertion
│   └── test-end-to-end-pipeline.js     # End-to-end scenario tests
├── run-garbage-tests.sh                # Test runner script
└── GARBAGE_TESTS_README.md             # This file
```

## Running Tests

### Run All Tests

```bash
# From project root
./tests/run-garbage-tests.sh
```

### Run Individual Test Suites

```bash
# Unit tests
node tests/unit/test-garbage-system.js

# Queue tests
node tests/integration/test-garbage-queue.js

# Insertion tests
node tests/integration/test-garbage-insertion.js

# End-to-end tests
node tests/integration/test-end-to-end-pipeline.js
```

## Test Coverage

### Unit Tests (`test-garbage-system.js`)

Tests the core garbage calculation logic:

- ✅ Basic single line clear (generates 0 garbage)
- ✅ Double line clear (generates 1 garbage line)
- ✅ Tetris clear (generates 3 garbage lines)
- ✅ Cascade combo complexity tracking
- ✅ Clean field bonus calculation
- ✅ O-piece multi-column holes (2 columns)
- ✅ Attack serialization and deserialization
- ✅ Hole mask position changes across cascades
- ✅ Empty summary handling
- ✅ Fallback to center column for missing holes

**Key Validation:** Proves that `calculateGarbage()` correctly converts cascade summaries into attack payloads with proper hole masks.

### Queue Integration Tests (`test-garbage-queue.js`)

Tests the FIFO garbage queue system:

- ✅ Basic enqueue and dequeue operations
- ✅ FIFO ordering maintenance
- ✅ Burst boundary detection (isLastInBurst flag)
- ✅ Blind attack separation
- ✅ Clean bonus lines come before normal lines
- ✅ Connection flags (connectAbove, connectBelow)
- ✅ Queue serialization for network play
- ✅ Multiple attack accumulation
- ✅ Empty queue behavior
- ✅ Clear operation

**Key Validation:** Proves that the queue maintains correct order, properly separates attack types, and preserves all metadata.

### Insertion Integration Tests (`test-garbage-insertion.js`)

Tests garbage insertion into the playfield:

- ✅ Single garbage line insertion with hole
- ✅ Multiple garbage lines stacking
- ✅ Multi-column holes (O-piece: 2 columns, I-piece: 4 columns)
- ✅ Existing pieces shift up correctly
- ✅ Top-out detection when overflow occurs
- ✅ Clean variant marking (CLEAN_GARBAGE vs GARBAGE)
- ✅ Wide holes from horizontal I-piece
- ✅ Empty entry list handling
- ✅ Non-line entries are filtered out
- ✅ Attack metadata preservation

**Key Validation:** Proves that garbage is inserted at the correct board position with accurate hole patterns and properly detects top-out conditions.

### End-to-End Pipeline Tests (`test-end-to-end-pipeline.js`)

Tests complete scenarios from clear → attack → queue → insertion:

- ✅ Simple 2-player attack exchange
- ✅ Cascade combo with progressive hole patterns
- ✅ Clean field bonus grants extra lines
- ✅ Blind attack applies duration without lines
- ✅ Large cascade combo (4 stages, 12 lines)
- ✅ Multiple attacks accumulate in queue
- ✅ Deterministic hole patterns (same position = same holes)
- ✅ Heavy garbage can cause top-out
- ✅ Mixed attack types process in correct order
- ✅ Cascade position tracking (right → left scenario)

**Key Validation:** Proves that the entire pipeline works correctly for real gameplay scenarios as described in the Quadra specification.

## What These Tests Prove

### 1. Hole Masks Respect Cascades ✅

Tests demonstrate that:
- Initial clears use the locked piece's column footprint
- Cascade clears use the board delta (columns that changed from empty → filled)
- Each cascade wave generates its own distinct hole pattern
- Multi-column pieces create multi-column holes

**Example from tests:**
```
Initial: I-piece at columns 3-6 clears 1 line
  → Sends 0 lines (depth-1 = 0)

Cascade: Blocks fall, vertical I at column 1 clears 4 lines
  → Sends 4 lines with hole at column 1
```

### 2. Clean Attacks Award Bonus Lines ✅

Tests verify the clean field bonus formula:
```
cleanBonus = floor((depth + 1) / 2)
totalLines = (depth - 1) + cleanBonus
```

**Example from tests:**
```
Clear 5 lines and empty field:
  Base garbage: 4 lines (5 - 1)
  Clean bonus: 3 lines (floor(6/2))
  Total sent: 7 lines (4 + 3)
```

### 3. Blind Logic Applies Correctly ✅

Tests confirm:
- Blind attacks are queued separately from line attacks
- Blind entries are processed before line bursts
- Full blind applies board-wide duration
- Duration decrements correctly on piece locks

### 4. Serialization Works ✅

Tests validate:
- Attack payloads can be serialized to JSON
- Deserialization restores all data correctly
- Hole patterns are preserved exactly
- Queue state can be saved/restored for replays

## Test Metrics

- **Total Test Cases:** 40+
- **Code Coverage Areas:**
  - Garbage calculation (`calculateGarbage`)
  - Queue operations (`GarbageQueue`)
  - Insertion logic (`insertGarbageEntries`)
  - Attack expansion (`expandEntries`)
  - Serialization (`toJSON`, `fromJSON`)

## Requirements Checklist

Based on the Quadra specification, these tests verify:

| Requirement | Test Coverage | Status |
|-------------|---------------|--------|
| `moved[row][col]` tracking | Unit tests 1-8 | ✅ |
| Per-row hole masks | Unit tests 6, 8 | ✅ |
| Clean bonus calculation | Unit test 5, E2E test 3 | ✅ |
| Cascade hole detection | Unit test 8, E2E test 10 | ✅ |
| Attack packaging | All unit tests | ✅ |
| FIFO queue | Queue tests 1-10 | ✅ |
| Blind attack handling | Queue test 4, E2E test 4 | ✅ |
| Garbage insertion | Insertion tests 1-10 | ✅ |
| Top-out detection | Insertion test 5, E2E test 8 | ✅ |
| Serialization | Unit test 7, Queue test 7 | ✅ |

## Adding New Tests

To add new test cases:

1. **Unit Tests:** Add to `test-garbage-system.js` using `runTest()` helper
2. **Integration Tests:** Create new file in `tests/integration/`
3. **Update Runner:** Add new test file to `run-garbage-tests.sh`

Example test structure:
```javascript
runTest('Test description', () => {
    // Arrange
    const input = { ... };

    // Act
    const result = functionUnderTest(input);

    // Assert
    assertEquals(result.value, expected, 'Should match expected value');
});
```

## Troubleshooting

### Tests fail with "Cannot find module"

Make sure you're running tests from the project root:
```bash
cd /path/to/serenity-blocks
./tests/run-garbage-tests.sh
```

### Tests pass locally but fail in CI

Ensure Node.js version matches. Tests are designed for Node.js 14+.

## Future Enhancements

Potential additional tests:

- [ ] Performance tests (large cascade chains)
- [ ] Stress tests (queue with 100+ attacks)
- [ ] Concurrent multiplayer scenarios (3+ players)
- [ ] Network latency simulation
- [ ] Replay validation (deterministic replay from seed)

## References

- [QUADRA_GARBAGE_SYSTEM.md](../QUADRA_GARBAGE_SYSTEM.md) - Full specification
- [src/core/garbage.js](../src/core/garbage.js) - Implementation
- [src/core/physics.js](../src/core/physics.js) - Physics and cascade logic
- [src/core/multiplayer.js](../src/core/multiplayer.js) - Multiplayer integration
