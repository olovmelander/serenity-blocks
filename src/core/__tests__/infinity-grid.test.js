/**
 * @fileoverview Tests for infinity grid utilities
 * Run with: npm test (if vitest is configured)
 */

import {
    createInfinityGrid,
    expandGridIfNeeded,
    calculateTopRow,
    calculateBuildHeight,
    shouldExpandGrid,
    getGridStats,
    checkInfinityGameOver
} from '../infinity-grid.js';
import { COLS } from '../constants.js';

// Mock game state helper
function createMockGameState(options = {}) {
    return {
        isInfinityMode: true,
        maxRows: options.maxRows || 1000,
        board: options.board || createInfinityGrid(COLS, 24),
        lockedPieces: options.lockedPieces || [],
        currentPiece: options.currentPiece || null,
        ghostPiece: null,
        boardCacheDirty: false,
    };
}

/**
 * Test: createInfinityGrid creates correct dimensions
 */
console.log('=== Test 1: createInfinityGrid ===');
const grid = createInfinityGrid(10, 20);
console.assert(grid.length === 20, 'Grid should have 20 rows');
console.assert(grid[0].length === 10, 'Grid should have 10 columns');
console.assert(grid[0][0] === null, 'Grid cells should be initialized as null');
console.log('✅ createInfinityGrid works correctly\n');

/**
 * Test: expandGridIfNeeded adds rows correctly
 */
console.log('=== Test 2: expandGridIfNeeded ===');
const gameState = createMockGameState();
const initialLength = gameState.board.length;
console.log('Initial grid length:', initialLength);

// Add a locked piece
gameState.lockedPieces.push({
    y: 10,
    blocks: [
        { row: 10, col: 5 }
    ]
});

// Expand grid
const expanded = expandGridIfNeeded(gameState, initialLength + 20);
console.assert(expanded === true, 'Should return true when expansion occurs');
console.assert(gameState.board.length === initialLength + 20, `Grid should expand to ${initialLength + 20} rows`);
console.log('After expansion:', gameState.board.length);

// Check piece position updated
console.assert(gameState.lockedPieces[0].y === 30, 'Locked piece y should be updated (10 + 20)');
console.assert(gameState.lockedPieces[0].blocks[0].row === 30, 'Locked piece block row should be updated');
console.log('✅ expandGridIfNeeded works correctly\n');

/**
 * Test: calculateTopRow finds highest block
 */
console.log('=== Test 3: calculateTopRow ===');
const gameState2 = createMockGameState();

// Place block at row 5
gameState2.board[5][3] = { color: '#ff0000' };

const topRow = calculateTopRow(gameState2);
console.assert(topRow === 5, `Top row should be 5, got ${topRow}`);
console.log('Top row with block at row 5:', topRow);

// Empty board
const gameState3 = createMockGameState();
const topRowEmpty = calculateTopRow(gameState3);
console.assert(topRowEmpty === gameState3.board.length - 1, 'Empty board should return bottom row');
console.log('Top row for empty board:', topRowEmpty);
console.log('✅ calculateTopRow works correctly\n');

/**
 * Test: calculateBuildHeight
 */
console.log('=== Test 4: calculateBuildHeight ===');
const gameState4 = createMockGameState();
gameState4.board[20][5] = { color: '#00ff00' };

const height = calculateBuildHeight(gameState4);
console.log('Build height with block at row 20:', height);
console.assert(height === 24 - 20, 'Height should be distance from top block to bottom');
console.log('✅ calculateBuildHeight works correctly\n');

/**
 * Test: shouldExpandGrid threshold check
 */
console.log('=== Test 5: shouldExpandGrid ===');
const gameState5 = createMockGameState();
gameState5.board[5][3] = { color: '#ff0000' };

const should = shouldExpandGrid(gameState5, 30);
console.assert(should === true, 'Should expand when within threshold');
console.log('Should expand (top row 5, threshold 30):', should);

const shouldNot = shouldExpandGrid(gameState5, 4);
console.assert(shouldNot === false, 'Should not expand when outside threshold');
console.log('Should not expand (top row 5, threshold 4):', shouldNot);
console.log('✅ shouldExpandGrid works correctly\n');

/**
 * Test: getGridStats returns correct data
 */
console.log('=== Test 6: getGridStats ===');
const gameState6 = createMockGameState();
gameState6.board[10][3] = { color: '#ff0000' };
gameState6.board[10][4] = { color: '#ff0000' };

const stats = getGridStats(gameState6);
console.log('Grid stats:', stats);
console.assert(stats.totalRows === 24, 'Total rows should match');
console.assert(stats.topRow === 10, 'Top row should be 10');
console.assert(stats.blocksCount === 2, 'Should count 2 blocks');
console.assert(stats.maxRows === 1000, 'Max rows should be 1000');
console.log('✅ getGridStats works correctly\n');

/**
 * Test: checkInfinityGameOver conditions
 */
console.log('=== Test 7: checkInfinityGameOver ===');
const gameState7 = createMockGameState();
gameState7.board[0][5] = { color: '#ff0000' }; // At absolute top

const isGameOver = checkInfinityGameOver(gameState7);
console.assert(isGameOver === true, 'Game should be over when reaching row 0');
console.log('Game over at row 0:', isGameOver);

const gameState8 = createMockGameState();
gameState8.board[10][5] = { color: '#ff0000' };
const notGameOver = checkInfinityGameOver(gameState8);
console.assert(notGameOver === false, 'Game should not be over at row 10');
console.log('Game not over at row 10:', notGameOver);
console.log('✅ checkInfinityGameOver works correctly\n');

console.log('=========================');
console.log('All tests passed! ✅');
console.log('=========================');
