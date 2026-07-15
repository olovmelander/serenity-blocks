// @ts-check
/**
 * Pure synchronous cascade resolver (remediation plan §5.2 — shipped DARK).
 *
 * resolveCascade computes the COMPLETE result of a lock's line-clear/cascade
 * resolution — every wave, hole mask, score delta, level progression, gravity
 * step — synchronously, with no callbacks, no delays, and no writes to any
 * gameState. It is the extraction target of processPhysics' 350-line async
 * while-loop: once proven equivalent (the §5.10 differential gate),
 * physics.js will compute this result FIRST and drive the flash/gravity
 * animation as a replay of the precomputed waves, which is what turns the
 * measured 330–400ms cascade input dead-time into ≤1 tick.
 *
 * FIDELITY RULES (this must reproduce processPhysics' results exactly):
 *  - Steps with exported legacy implementations are REUSED, not re-written
 *    (detectFullLines, removeClearedLines, findConnectedComponents,
 *    isPartOfPiece, calculateQuadraLineScore) — reused directly so results match.
 *  - The wave loop, hole-mask fallback ladder, movedArray lifecycle, level
 *    progression, B2B arming, and the gravity settle order replicate
 *    physics.js (comments cite the corresponding physics.js lines).
 *  - The gravity pass iterates a bottom-edge-DESC sort taken ONCE before the
 *    settle loop and never re-sorted (physics.js:197-198) — piece y mutations
 *    do not re-order iteration mid-settle; changing this changes movedArray
 *    and therefore competitive hole masks.
 *
 * NOT wired into gameplay. Consumers today: the differential equivalence
 * suite (tests/unit/cascade-resolver-differential.test.js), which drives this
 * and the legacy path from identical inputs and asserts identical outcomes.
 */
import {
    COLS, ROWS, HIDDEN_ROWS, LEVEL_SPEEDS,
} from './constants.js';
import { rebuildBoardGridFromPieces, cloneBoardGrid, updatePiecePositionInGrid } from './board.js';
import {
    detectFullLines, removeClearedLines, findConnectedComponents, isPartOfPiece,
} from './cascade-helpers.js';
import { calculateQuadraLineScore } from './scoring.js';

/** Deep-clone locked pieces (removeClearedLines mutates p.shape rows). */
function clonePieces(pieces) {
    return (pieces || []).map((p) => ({
        ...p,
        shape: p.shape.map((row) => row.slice()),
    }));
}

/**
 * Mirror of the calculateHoleColumnsFromBoardDelta fallback (physics.js:424-448).
 * @param {Array<Array<boolean>>|null} preGravityBoard
 * @param {Array<Array<Object|null>>} currentBoard
 * @param {number[]} fullLines
 */
function holeColumnsFromBoardDelta(preGravityBoard, currentBoard, fullLines) {
    if (!preGravityBoard || fullLines.length === 0) return [];
    const holeColumns = new Set();
    fullLines.forEach((y) => {
        const prevRow = preGravityBoard[y];
        const currRow = currentBoard[y];
        if (!currRow) return;
        for (let x = 0; x < COLS; x += 1) {
            const wasFilled = prevRow ? prevRow[x] : false;
            const isFilled = currRow[x] !== null;
            if (!wasFilled && isFilled) holeColumns.add(x);
        }
    });
    return Array.from(holeColumns).sort((a, b) => a - b);
}

/**
 * Mirror of calculateCascadeHoleColumns (physics.js:360-415), logging removed.
 */
function cascadeHoleColumns(movedArray, fullLines) {
    if (!movedArray || fullLines.length === 0) return [Math.floor(COLS / 2)];
    const movedColumns = new Set();
    fullLines.forEach((y) => {
        if (movedArray[y]) {
            for (let x = 0; x < COLS; x += 1) {
                if (movedArray[y][x]) movedColumns.add(x);
            }
        }
    });
    const holeColumns = Array.from(movedColumns).sort((a, b) => a - b);
    if (holeColumns.length === 0) return [Math.floor(COLS / 2)];
    return holeColumns;
}

/**
 * Synchronous mirror of applyGravity's settle loop (physics.js:185-323):
 * same once-sorted bottom-edge-DESC iteration, same canFall check with
 * isPartOfPiece self-exclusion, same movedArray marking at the NEW position,
 * same incremental grid updates. Returns the number of animation steps
 * (passes in which ≥1 block fell) — the onGravityStep/draw replay count.
 * @returns {number} gravity steps
 */
function settleGravity(lockedPieces, boardGrid, movedArray) {
    const visiblePieces = [...lockedPieces]
        .sort((a, b) => b.y + b.shape.length - (a.y + a.shape.length));
    const currentBoard = boardGrid;
    let steps = 0;
    let blocksStillFalling = true;

    while (blocksStillFalling) {
        blocksStillFalling = false;

        for (const piece of visiblePieces) {
            let canFall = true;
            piece.shape.forEach((row, localY) => {
                row.forEach((cell, localX) => {
                    if (cell > 0) {
                        const boardX = piece.x + localX;
                        const boardY = piece.y + localY + 1;
                        if (boardY >= currentBoard.length) {
                            canFall = false;
                            return;
                        }
                        if (currentBoard[boardY][boardX] !== null
                            && !isPartOfPiece(boardX, boardY, piece)) {
                            canFall = false;
                        }
                    }
                });
            });

            if (canFall) {
                if (movedArray) {
                    piece.shape.forEach((row, localY) => {
                        row.forEach((cell, localX) => {
                            if (cell > 0) {
                                const boardX = piece.x + localX;
                                const boardY = piece.y + localY + 1;
                                if (boardY < movedArray.length && boardX < movedArray[0].length) {
                                    movedArray[boardY][boardX] = true;
                                }
                            }
                        });
                    });
                }
                const oldY = piece.y;
                piece.y += 1;
                updatePiecePositionInGrid(piece, oldY, boardGrid);
                blocksStillFalling = true;
            }
        }

        if (blocksStillFalling) steps += 1;
    }
    return steps;
}

/**
 * @typedef {Object} CascadeWave
 * @property {number} cascadeCount 1-based wave number
 * @property {number[]} fullLines cleared row Ys (detectFullLines order: bottom-up)
 * @property {boolean[][]} holeMasks per-cleared-row COLS-wide mask (true = hole)
 * @property {number[]} holeColumns merged sorted hole columns for the wave
 * @property {number} points score awarded this wave (post combo-multiplier)
 * @property {boolean} tSpin
 * @property {boolean} b2bFired
 * @property {number|null} leveledTo new level if this wave crossed a threshold
 * @property {number} gravitySteps animation steps after this wave's clear
 * @property {number} speedMultiplierClass flash-speed multiplier (1.0/0.8/0.6/0.5)
 */

/**
 * Pure cascade resolution — see module docs.
 *
 * @param {Array<Object>} lockedPieces input pieces (NOT mutated)
 * @param {Object} context sim inputs (NOT mutated):
 *   {boardHeight?, level, lines, linesUntilNextLevel, dropInterval,
 *    disableLevelProgression?, speedMultiplier?, b2bActive?,
 *    comboMultiplierEnabled?, comboMultiplier?, comboCount?,
 *    lastPlacedPieceX?, lineClearCounts?: boolean,
 *    comboState?: {lockFootprint?, manualColumns?, depth?, complexity?,
 *                  tSpin?, sourceColor?, sourcePiece?, sequence?}}
 * @returns {Object} the complete resolution result
 */
export function resolveCascade(lockedPieces, context = {}) {
    // ── Working copies: the resolver owns everything it touches ──
    const pieces = { current: clonePieces(lockedPieces) };
    const boardHeight = context.boardHeight || (ROWS + HIDDEN_ROWS);
    const boardGrid = Array.from({ length: boardHeight }, () => Array(COLS).fill(null));

    // ── comboState + manual columns (physics.js:633-641) ──
    const comboState = context.comboState || {
        manualColumns: context.lastPlacedPieceX || [],
        lockFootprint: [],
    };
    let manualHoleColumns = [Math.floor(COLS / 2)];
    if (comboState.manualColumns && comboState.manualColumns.length > 0) {
        manualHoleColumns = comboState.manualColumns;
    } else if (context.lastPlacedPieceX && context.lastPlacedPieceX.length > 0) {
        manualHoleColumns = context.lastPlacedPieceX;
    }

    let depth = comboState.depth || 0;
    let complexity = comboState.complexity || 0;
    const holeMaskMatrix = [];
    let sendForClean = false;

    // ── movedArray seeded from the lock footprint (physics.js:648-667) ──
    const movedArray = Array.from({ length: boardHeight }, () => Array(COLS).fill(false));
    if (comboState.lockFootprint && comboState.lockFootprint.length > 0) {
        comboState.lockFootprint.forEach(({ x, y }) => {
            const floorY = Math.floor(y);
            const floorX = Math.floor(x);
            if (floorY >= 0 && floorY < movedArray.length && floorX >= 0 && floorX < COLS) {
                movedArray[floorY][floorX] = true;
            }
        });
    }

    // ── Mutable progression mirrors (writes stay resolver-local) ──
    let level = context.level ?? 1;
    let lines = context.lines ?? 0;
    let linesUntilNextLevel = context.linesUntilNextLevel ?? 15;
    let { dropInterval } = context;
    let b2bActive = Boolean(context.b2bActive);
    let scoreDelta = 0;
    let linesClearedThisTurn = 0;
    let cascadeCount = 0;
    let preGravityBoard = null;
    const waves = [];
    const lineClearCountsDelta = {};

    // ── The wave loop (physics.js:671-939) ──
    for (;;) {
        rebuildBoardGridFromPieces(pieces.current, boardGrid);
        const boardData = boardGrid;
        const fullLines = detectFullLines(boardData);
        if (fullLines.length === 0) break;

        lineClearCountsDelta[fullLines.length] = (lineClearCountsDelta[fullLines.length] || 0) + 1;
        cascadeCount += 1;

        // Hole-mask capture with the exact fallback ladder (physics.js:719-765).
        const waveHoleMasks = [];
        const waveHoleColumns = new Set();
        for (const y of fullLines) {
            const mask = Array(COLS).fill(false);
            if (movedArray[y]) {
                for (let x = 0; x < COLS; x += 1) {
                    if (movedArray[y][x]) mask[x] = true;
                }
            }
            if (!mask.some((value) => value)) {
                let fallbackColumns = [];
                if (cascadeCount === 1 && manualHoleColumns.length > 0) {
                    fallbackColumns = manualHoleColumns;
                } else {
                    fallbackColumns = holeColumnsFromBoardDelta(preGravityBoard, boardData, [y]);
                }
                if (fallbackColumns.length === 0) {
                    fallbackColumns = cascadeHoleColumns(movedArray, [y]);
                }
                fallbackColumns.forEach((col) => {
                    if (col >= 0 && col < COLS) mask[col] = true;
                });
            }
            mask.forEach((flag, x) => { if (flag) waveHoleColumns.add(x); });
            holeMaskMatrix.push(mask.slice());
            waveHoleMasks.push(mask.slice());
        }

        depth += fullLines.length;
        complexity += 1;
        const holeColumns = Array.from(waveHoleColumns).sort((a, b) => a - b);

        // Scoring/progression (physics.js:788-828).
        linesClearedThisTurn += fullLines.length;
        const oldLevel = level;
        lines += fullLines.length;
        linesUntilNextLevel -= fullLines.length;
        let leveledTo = null;
        if (linesUntilNextLevel <= 0 && !context.disableLevelProgression) {
            level += 1;
            linesUntilNextLevel += 15;
            dropInterval = LEVEL_SPEEDS[Math.min(level - 1, LEVEL_SPEEDS.length - 1)];
            if (context.speedMultiplier) {
                dropInterval /= context.speedMultiplier;
            }
            leveledTo = level;
        } else if (linesUntilNextLevel <= 0) {
            linesUntilNextLevel += 15;
        }
        const levelChanged = oldLevel !== level;

        let points = calculateQuadraLineScore(fullLines.length, level, cascadeCount, false);
        if (context.comboMultiplierEnabled && context.comboMultiplier > 1) {
            points = Math.round(points * context.comboMultiplier);
        }
        scoreDelta += points;

        // T-spin / B2B (physics.js:842-857). NOTE: legacy reads the LIVE
        // gameState.comboState?.tSpin, not the defaulted local — mirrored via
        // context.comboState?.tSpin.
        const tSpin = cascadeCount === 1 && Boolean(context.comboState?.tSpin);
        const isDifficultClear = fullLines.length >= 4 || tSpin;
        let b2bFired = false;
        if (isDifficultClear) {
            if (b2bActive) b2bFired = true;
            b2bActive = true;
        } else if (cascadeCount === 1) {
            b2bActive = false;
        }

        // moved[][] cleared AFTER hole capture, tracks gravity next (physics.js:866).
        for (let y = 0; y < movedArray.length; y += 1) movedArray[y].fill(false);

        let speedMultiplierClass = 0.5;
        if (cascadeCount === 1) speedMultiplierClass = 1.0;
        else if (cascadeCount <= 4) speedMultiplierClass = 0.8;
        else if (cascadeCount <= 9) speedMultiplierClass = 0.6;

        // Clear + split + settle (physics.js:920-930).
        pieces.current = removeClearedLines(pieces.current, fullLines);
        rebuildBoardGridFromPieces(pieces.current, boardGrid);
        pieces.current = findConnectedComponents(boardGrid);
        preGravityBoard = cloneBoardGrid(boardGrid).map((row) => row.map((cell) => cell !== null));
        const gravitySteps = settleGravity(pieces.current, boardGrid, movedArray);

        if (pieces.current.length === 0) sendForClean = true;

        waves.push({
            cascadeCount,
            fullLines: fullLines.slice(),
            holeMasks: waveHoleMasks,
            holeColumns,
            points,
            tSpin,
            b2bFired,
            leveledTo: levelChanged ? level : leveledTo,
            gravitySteps,
            speedMultiplierClass,
        });
    }

    // ── Post-loop (physics.js:941-1003) ──
    let perfectClear = null;
    if (sendForClean && depth > 0) {
        let bonus = calculateQuadraLineScore(depth, level, complexity, true)
            - calculateQuadraLineScore(depth, level, complexity, false);
        if (context.comboMultiplierEnabled && context.comboMultiplier > 1) {
            bonus = Math.round(bonus * context.comboMultiplier);
        }
        scoreDelta += bonus;
        perfectClear = { depth, bonus };
    }

    let garbageSummary = null;
    if (linesClearedThisTurn > 0) {
        garbageSummary = {
            totalLines: depth,
            depth,
            comboStages: complexity,
            complexity,
            holeMask: holeMaskMatrix.map((mask) => mask.slice()),
            manualColumns: [...manualHoleColumns],
            sendForClean,
            lockFootprint: comboState.lockFootprint
                ? comboState.lockFootprint.map((cell) => ({ ...cell }))
                : [],
            sourceColor: comboState.sourceColor,
            sourcePiece: comboState.sourcePiece,
            sequence: comboState.sequence,
        };
    }

    const comboStateAfter = {
        depth,
        complexity,
        holeMask: holeMaskMatrix.map((mask) => mask.slice()),
        sendForClean,
        manualColumns: [...manualHoleColumns],
        lockFootprint: [],
        sourceColor: null,
    };

    let comboCountAfter = context.comboCount;
    let comboMultiplierAfter = context.comboMultiplier;
    if (context.comboMultiplierEnabled) {
        comboCountAfter = linesClearedThisTurn > 0 ? (context.comboCount || 0) + 1 : 0;
        comboMultiplierAfter = 1 + (comboCountAfter * 0.5);
    }

    rebuildBoardGridFromPieces(pieces.current, boardGrid);

    return {
        waves,
        cascadeCount,
        linesClearedThisTurn,
        scoreDelta,
        linesAfter: lines,
        levelAfter: level,
        linesUntilNextLevelAfter: linesUntilNextLevel,
        dropIntervalAfter: dropInterval,
        b2bActiveAfter: b2bActive,
        perfectClear,
        garbageSummary,
        comboStateAfter,
        comboCountAfter,
        comboMultiplierAfter,
        lockedPiecesAfter: pieces.current,
        boardAfter: boardGrid,
        lineClearCountsDelta,
    };
}
