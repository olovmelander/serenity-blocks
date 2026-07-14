// @ts-check

import { ROWS } from './constants.js';

export const INFINITY_SPAWN_POLICY_CAMERA_V1 = 'camera-v1';
export const INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1 = 'board-anchor-v1';

/**
 * @param {unknown} value
 * @returns {'camera-v1'|'board-anchor-v1'}
 */
export function normalizeInfinitySpawnPolicy(value) {
    if (value === undefined || value === null || value === INFINITY_SPAWN_POLICY_CAMERA_V1) {
        return INFINITY_SPAWN_POLICY_CAMERA_V1;
    }
    if (value === INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1) {
        return INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1;
    }
    throw new TypeError(`Unsupported Infinity spawn policy: ${String(value)}`);
}

/** @param {Record<string, any>|null|undefined} gameState */
export function usesDeterministicInfinitySpawn(gameState) {
    return Boolean(
        gameState?.isInfinityMode
        && gameState.infinitySpawnPolicy === INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1,
    );
}

/**
 * Return the first occupied row, or board.length for an empty board.
 * @param {unknown[][]} board
 */
export function findHighestOccupiedInfinityRow(board) {
    for (let row = 0; row < board.length; row += 1) {
        if (board[row].some((cell) => cell !== null)) return row;
    }
    return board.length;
}

/**
 * Resolve the deterministic top row of Infinity's simulation viewport. This
 * mirrors the established camera target (tower at 20% of the viewport) but is
 * derived only from snapshottable board/rules state, never Phaser lerp state.
 *
 * @param {Record<string, any>} gameState
 * @param {number|null} [knownHighestOccupiedRow]
 */
export function resolveInfinitySimulationCameraRow(
    gameState,
    knownHighestOccupiedRow = null,
) {
    // boardGrid is collision/simulation truth. `board` is an Infinity render
    // compatibility alias and can briefly point at the pre-restore grid until
    // ensureBoardCache repairs it. Spawn resolution runs before that repair,
    // so consulting the alias first can place exactly one piece from stale
    // presentation state.
    const board = gameState?.boardGrid || gameState?.board;
    if (!Array.isArray(board) || board.length === 0) return 0;

    const configuredVisibleRows = Number(gameState.infinityVisibleRows);
    const visibleRows = Number.isSafeInteger(configuredVisibleRows) && configuredVisibleRows > 0
        ? configuredVisibleRows
        : ROWS;
    const maxCameraRow = Math.max(0, board.length - visibleRows);
    const highestOccupiedRow = Number.isSafeInteger(knownHighestOccupiedRow)
        && knownHighestOccupiedRow >= 0
        && knownHighestOccupiedRow <= board.length
        ? knownHighestOccupiedRow
        : findHighestOccupiedInfinityRow(board);

    if (highestOccupiedRow >= board.length) return maxCameraRow;

    const topPaddingRows = Math.floor(visibleRows * 0.2);
    return Math.max(0, Math.min(maxCameraRow, highestOccupiedRow - topPaddingRows));
}

/**
 * @param {Record<string, any>} gameState
 * @param {number|null} [knownHighestOccupiedRow]
 */
export function resolveInfinitySpawnRow(gameState, knownHighestOccupiedRow = null) {
    const configuredOffset = Number(gameState?.infinitySpawnOffsetRows);
    const spawnOffsetRows = Number.isSafeInteger(configuredOffset) && configuredOffset >= 0
        ? configuredOffset
        : 2;
    const board = gameState?.boardGrid || gameState?.board;
    const configuredVisibleRows = Number(gameState?.infinityVisibleRows);
    if (
        gameState?.piecesPlaced === 0
        && Array.isArray(board)
        && Number.isSafeInteger(configuredVisibleRows)
        && configuredVisibleRows > ROWS
    ) {
        // Odyssey's virtual window includes authored starting garbage below
        // its 20-row presentation viewport. The first piece retains the legacy
        // bottom anchor; later spawns follow the canonical occupied-board row.
        return Math.max(0, board.length - configuredVisibleRows - spawnOffsetRows);
    }
    return Math.max(
        0,
        resolveInfinitySimulationCameraRow(gameState, knownHighestOccupiedRow) - spawnOffsetRows,
    );
}

/**
 * Publish the deterministic simulation anchor into the compatibility fields
 * consumed by snapshots/debug tooling. Renderers cannot overwrite these fields
 * while the deterministic policy owns them.
 *
 * @param {Record<string, any>} gameState
 * @param {number|null} [knownHighestOccupiedRow]
 */
export function synchronizeInfinitySimulationCamera(
    gameState,
    knownHighestOccupiedRow = null,
) {
    if (!usesDeterministicInfinitySpawn(gameState)) return false;
    const cameraRow = resolveInfinitySimulationCameraRow(
        gameState,
        knownHighestOccupiedRow,
    );
    const visibleRows = Number.isSafeInteger(gameState.infinityVisibleRows)
        && gameState.infinityVisibleRows > 0
        ? gameState.infinityVisibleRows
        : ROWS;
    gameState.cameraRow = cameraRow;
    gameState.cameraCenterRow = cameraRow + visibleRows / 2;
    return true;
}

/**
 * Legacy compatibility boundary for Phaser/presentation camera projection.
 * In deterministic Infinity sessions the simulation owns cameraRow, so visual
 * interpolation remains internal to the renderer and this write is rejected.
 *
 * @param {Record<string, any>|null|undefined} gameState
 * @param {number} cameraRow
 * @param {number|null} [cameraCenterRow]
 */
export function projectInfinityPresentationCamera(
    gameState,
    cameraRow,
    cameraCenterRow = null,
) {
    if (!gameState || usesDeterministicInfinitySpawn(gameState)) return false;
    if (Number.isFinite(cameraRow)) gameState.cameraRow = cameraRow;
    if (Number.isFinite(cameraCenterRow)) gameState.cameraCenterRow = cameraCenterRow;
    return true;
}
