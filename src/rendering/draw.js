/**
 * @fileoverview Next-piece previews, line-clear / lock visual effects, score and
 * combo popups, and HUD stat updates for Serenity Blocks. The game board itself is
 * rendered by the Phaser board scene (`src/rendering/phaser/base-board-scene.js`);
 * the former 2-D canvas board renderer was removed as unreachable dead code.
 */

import {
    COLS, HIDDEN_ROWS, BLOCK_SIZE, SHAPES, COLORS,
} from '../core/constants.js';
import { generateBoard } from '../core/board.js';
import { drawPieceSolid, trimShape } from './canvas/canvas-drawing-utils.js';
import { TetrominoStyleManager } from './tetromino-style-manager.js';

const COMBO_COLOR_STEPS = [
    { max: 2, color: '#22d3ee' }, // Cyan
    { max: 3, color: '#8b5cf6' }, // Purple
    { max: Infinity, color: '#d946ef' }, // Magenta
];

// PERFORMANCE: Cache DOM elements and constants for updateStats
const LEVEL_SPEEDS = [
    1000, 900, 800, 700, 600, 500, 400, 350, 300, 250, 200, 175, 150, 125, 100, 90, 80, 70, 60, 50,
];

const statElements = {
    score: null,
    lines: null,
    level: null,
    nextLevel: null,
    levelProgress: null,
    stage: null,
    speed: null,
    bpm: null,
    ppm: null,
};

/** Quadra: 15 lines per level (GameState.linesUntilNextLevel counts down from it). */
const LINES_PER_LEVEL = 15;
/** The well turns coral when the stack stands this many rows of 20 high, and calms
    only once it is DANGER_CALM rows lower (keystone-solo.css). */
const DANGER_ROWS = 15;
const DANGER_CALM = 3;
const wellDanger = { grid: null, version: null };

const lastStatValues = {
    score: null,
    lines: null,
    level: null,
    linesUntilNextLevel: null,
    speedMultiplier: null,
    bpm: null,
    ppm: null,
};

function getComboColor(comboCount) {
    for (const step of COMBO_COLOR_STEPS) {
        if (comboCount <= step.max) {
            return step.color;
        }
    }
    return COMBO_COLOR_STEPS[COMBO_COLOR_STEPS.length - 1].color;
}

let nextPieceStyleManager = null;
let nextPieceStyleRevision = 0;
const nextCanvasDraws = new WeakMap();
const watchedNextCanvases = new WeakSet();
const fallbackNextStyles = new Map();
const trimmedNextShapes = new Map();

function getNextPieceStyleManager() {
    if (nextPieceStyleManager) {
        return nextPieceStyleManager;
    }

    const hasWindow = typeof window !== 'undefined';
    const themeManager = hasWindow ? window.themeManager : null;
    const settingsManager = hasWindow ? window.settingsManager : null;

    if (!themeManager || !settingsManager) {
        return null;
    }

    nextPieceStyleManager = new TetrominoStyleManager(themeManager, settingsManager, () => {
        nextPieceStyleRevision += 1;
    });
    nextPieceStyleManager.init();
    return nextPieceStyleManager;
}

function createFallbackStyle(color) {
    return {
        color,
        renderMode: 'solid',
        effects: {
            glowRadius: 0,
            glowIntensity: 0,
            glowColor: color,
            outline: false,
            outlineWidth: 0,
            outlineColor: color,
            pulse: false,
            pulseSpeed: 0,
            pulseAmplitude: 0,
        },
        rendererOverrides: {},
    };
}

function getPreviewStyleState(styleConfig) {
    const effects = { ...styleConfig.effects, ...styleConfig.rendererOverrides?.canvas };
    const { renderMode } = styleConfig;
    // Snapshot only fields consumed by the canvas renderer, including mutable
    // gradient stops. A style can be edited in place between queue updates.
    const signature = JSON.stringify([
        styleConfig.color, renderMode, effects.outline, effects.outlineWidth, effects.outlineColor,
        renderMode === 'glow' ? [
            effects.glowRadius, effects.glowIntensity, effects.glowColor,
            effects.pulse, effects.pulseSpeed, effects.pulseAmplitude,
        ] : null,
        renderMode === 'gradient' ? [
            effects.gradientType,
            effects.gradientStops?.map((stop) => [stop.offset, stop.color, stop.opacity]),
        ] : null,
    ]);
    return { signature, animated: renderMode === 'glow' && effects.pulse };
}

/**
 * The well turns coral near the top (single player; keystone-solo.css): the stack's
 * height from the floor, measured only when the board changes.
 * @param {Object} gameState
 */
function updateWellDanger(gameState) {
    const grid = gameState?.boardGrid;
    const { stage } = statElements;
    if (!stage || !grid?.length || gameState.isInfinityMode) return;
    const version = gameState.boardVersion;
    if (wellDanger.grid === grid && wellDanger.version === version && version !== undefined) return;
    wellDanger.grid = grid;
    wellDanger.version = version;
    let top = grid.length;
    for (let y = 0; y < grid.length && top === grid.length; y++) {
        if (grid[y]?.some(Boolean)) top = y;
    }
    const stack = grid.length - top;
    // The stage's own attribute is the state, so a mode that clears it on leaving
    // (SinglePlayerMode) never leaves this out of step.
    const shown = stage.hasAttribute('data-danger');
    const on = stack >= DANGER_ROWS || (shown && stack > DANGER_ROWS - DANGER_CALM);
    if (on !== shown) stage.toggleAttribute('data-danger', on);
}

/**
 * Draws the next pieces in their preview canvases
 * @param {Array<HTMLCanvasElement>} nextCanvases - Array of canvas elements for next pieces
 * @param {Array<string>} nextPieces - Array of next piece keys (e.g., 'I', 'O', 'T')
 */
export function drawNextPieces(nextCanvases, nextPieces = []) {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const styleManager = getNextPieceStyleManager();
    // Complete layout reads before resizing or drawing any preview canvas.
    const previews = nextCanvases.map((canv) => {
        if (!(canv instanceof HTMLCanvasElement)) return null;
        return {
            canv,
            slot: canv.closest('.player-next-piece, .next-queue-piece'),
            displayWidth: canv.clientWidth || canv.width || 0,
            displayHeight: canv.clientHeight || canv.height || 0,
        };
    });

    previews.forEach((preview, idx) => {
        if (!preview) return;
        const {
            canv, slot, displayWidth, displayHeight,
        } = preview;

        const ctx = canv.getContext('2d');
        if (!ctx) return;
        if (!watchedNextCanvases.has(canv)) {
            watchedNextCanvases.add(canv);
            canv.addEventListener('contextrestored', () => {
                const previous = nextCanvasDraws.get(canv);
                nextCanvasDraws.delete(canv);
                if (!previous) return;
                const restoredCanvases = Array(previous.index + 1).fill(null);
                const restoredPieces = Array(previous.index + 1).fill(null);
                restoredCanvases[previous.index] = canv;
                restoredPieces[previous.index] = previous.nextKey;
                drawNextPieces(restoredCanvases, restoredPieces);
            });
        }

        const nextKey = nextPieces[idx];
        if (!fallbackNextStyles.has(nextKey)) {
            fallbackNextStyles.set(nextKey, createFallbackStyle(COLORS[nextKey] || '#808080'));
        }
        const styleConfig = styleManager?.getStyleForPiece(nextKey) ?? fallbackNextStyles.get(nextKey);
        const styleState = getPreviewStyleState(styleConfig);
        const last = nextCanvasDraws.get(canv);
        const renderWidth = Math.max(1, Math.round(displayWidth * dpr));
        const renderHeight = Math.max(1, Math.round(displayHeight * dpr));
        if (!styleState.animated && last?.nextKey === nextKey && last.displayWidth === displayWidth
            && last.displayHeight === displayHeight && last.dpr === dpr && last.index === idx
            && last.styleSignature === styleState.signature
            && last.revision === nextPieceStyleRevision
            && canv.width === renderWidth && canv.height === renderHeight) return;
        nextCanvasDraws.set(canv, {
            nextKey,
            displayWidth,
            displayHeight,
            dpr,
            index: idx,
            styleSignature: styleState.signature,
            revision: nextPieceStyleRevision,
        });

        if (canv.width !== renderWidth || canv.height !== renderHeight) {
            canv.width = renderWidth;
            canv.height = renderHeight;
        }

        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, displayWidth, displayHeight);
        ctx.imageSmoothingEnabled = false;

        if (!nextKey || !SHAPES[nextKey]) {
            if (slot) slot.classList.add('empty');
            ctx.imageSmoothingEnabled = true;
            ctx.restore();
            return;
        }

        if (slot) slot.classList.remove('empty');

        // Fit and centre the piece itself, not its rotation matrix (blank rows and columns).
        let shape = trimmedNextShapes.get(nextKey);
        if (!shape) {
            shape = trimShape(SHAPES[nextKey]);
            trimmedNextShapes.set(nextKey, shape);
        }
        const rows = shape.length;
        const cols = shape[0].length;

        const paddingFactor = idx === 0 ? 0.18 : 0.22;
        const padding = Math.max(6, Math.min(displayWidth, displayHeight) * paddingFactor);
        const availableWidth = Math.max(1, displayWidth - padding * 2);
        const availableHeight = Math.max(1, displayHeight - padding * 2);
        const blockSize = Math.max(4, Math.floor(Math.min(
            availableWidth / cols,
            availableHeight / rows,
        )));

        const pieceWidth = cols * blockSize;
        const pieceHeight = rows * blockSize;
        const offsetX = Math.round((displayWidth - pieceWidth) / 2);
        const offsetY = Math.round((displayHeight - pieceHeight) / 2);

        // Draw the entire piece as a solid unit (outer edges only)
        drawPieceSolid(ctx, shape, offsetX, offsetY, blockSize, styleConfig);

        ctx.imageSmoothingEnabled = true;
        ctx.restore();
    });
}

/**
 * Triggers the line clear flash effect on specific rows
 * Tetris Effect-inspired: particles, prismatic waves, and energy bursts
 * @param {Array<number>} clearedRows - Array of Y coordinates of cleared rows
 * @param {HTMLElement} customContainer - Optional custom container element (for multiplayer)
 */
export function triggerLineClearFlash(clearedRows = [], customContainer = null) {
    const container = customContainer || document.getElementById('line-clear-flash');
    if (!container) return;

    // Clear any existing flashes
    container.innerHTML = '';

    // Create a flash element for each cleared row
    clearedRows.forEach((rowY, index) => {
        const flashBar = document.createElement('div');
        flashBar.className = 'line-flash-bar';

        // Position the flash bar at the specific row
        const rowHeight = BLOCK_SIZE;
        const topPosition = (rowY - HIDDEN_ROWS) * rowHeight;

        flashBar.style.top = `${topPosition}px`;
        flashBar.style.height = `${rowHeight}px`;

        // Stagger animation slightly for multiple lines (Tetris Effect technique)
        const staggerDelay = index * 20;
        flashBar.style.animationDelay = `${staggerDelay}ms`;

        container.appendChild(flashBar);

        // Add particle burst effect (Tetris Effect signature)
        createParticleBurst(container, topPosition, rowHeight, staggerDelay);

        // Trigger animation
        setTimeout(() => {
            flashBar.classList.add('active');
        }, 10 + staggerDelay);

        // Remove after animation completes
        setTimeout(() => {
            if (flashBar.parentNode === container) {
                container.removeChild(flashBar);
            }
        }, 600 + staggerDelay);
    });

    // Add center radial burst for multi-line clears (Tetris Effect style)
    if (clearedRows.length >= 2) {
        createRadialBurst(container, clearedRows);
    }
}

/**
 * Creates a particle burst effect from a cleared line
 * Inspired by Tetris Effect's explosive particle systems
 */
function createParticleBurst(container, topPosition, rowHeight, delay) {
    const particleCount = 12;
    const centerY = topPosition + rowHeight / 2;

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'line-particle';

        // Position at center of line
        particle.style.top = `${centerY}px`;
        particle.style.left = `${50}%`;

        // Random angle for particle trajectory
        const angle = Math.PI / 3 + (i / particleCount) * (Math.PI / 1.5);
        const distance = 50 + Math.random() * 50;
        const endX = Math.cos(angle) * distance;
        const endY = Math.sin(angle) * distance * (Math.random() > 0.5 ? 1 : -1);

        particle.style.setProperty('--tx', `${endX}px`);
        particle.style.setProperty('--ty', `${endY}px`);

        // Color variation for prismatic effect
        const hue = (i / particleCount) * 60 + 180; // Cyan to blue range
        particle.style.setProperty('--particle-hue', hue);

        particle.style.animationDelay = `${delay}ms`;

        container.appendChild(particle);

        setTimeout(() => {
            if (particle.parentNode === container) {
                container.removeChild(particle);
            }
        }, 500 + delay);
    }
}

/**
 * Creates a radial energy burst for multi-line clears
 * Tetris Effect-style expanding ring effect
 */
function createRadialBurst(container, clearedRows) {
    if (!container) return;

    // Calculate center point of cleared lines
    const avgRow = clearedRows.reduce((a, b) => a + b, 0) / clearedRows.length;
    const centerY = (avgRow - HIDDEN_ROWS) * BLOCK_SIZE + BLOCK_SIZE / 2;

    const burst = document.createElement('div');
    burst.className = 'radial-burst';
    burst.style.top = `${centerY}px`;
    burst.style.left = '50%';

    // More intense burst for 4-line clears
    if (clearedRows.length >= 4) {
        burst.classList.add('intense');
    }

    container.appendChild(burst);

    setTimeout(() => {
        if (burst.parentNode === container) {
            container.removeChild(burst);
        }
    }, 600);
}

/**
 * Creates ripple effects when a piece locks
 * Tetris Effect-inspired tactile feedback
 * @param {Object} piece - The locked piece with x, y, shape
 * @param {Array} lockedPieces - Already locked pieces to detect contact points
 */
export function createPieceLockRipple(piece, lockedPieces = [], containerElement = null) {
    const container = containerElement || document.getElementById('line-clear-flash');
    if (!container) return;

    // Find the corner positions of the piece
    const corners = findPieceCorners(piece);

    corners.forEach((corner, index) => {
        const ripple = document.createElement('div');
        ripple.className = 'lock-ripple';

        // Position at corner
        const x = corner.x * BLOCK_SIZE + BLOCK_SIZE / 2;
        const y = (corner.y - HIDDEN_ROWS) * BLOCK_SIZE + BLOCK_SIZE / 2;

        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;

        // Slight delay stagger for multiple corners
        ripple.style.animationDelay = `${index * 30}ms`;

        container.appendChild(ripple);

        setTimeout(
            () => {
                if (ripple.parentNode === container) {
                    container.removeChild(ripple);
                }
            },
            400 + index * 30,
        );
    });

    // Add block merge glows at contact points
    createBlockMergeGlows(piece, lockedPieces, container);
}

/**
 * Finds corner positions of a piece for ripple effects
 * @param {Object} piece - Piece with x, y, shape
 * @returns {Array} Array of {x, y} corner positions
 */
function findPieceCorners(piece) {
    const corners = [];
    const visited = new Set();

    piece.shape.forEach((row, localY) => {
        row.forEach((cell, localX) => {
            if (cell > 0) {
                const x = piece.x + localX;
                const y = piece.y + localY;

                // Check all 4 corners of this block
                const blockCorners = [
                    { x, y }, // Top-left
                    { x: x + 1, y }, // Top-right
                    { x, y: y + 1 }, // Bottom-left
                    { x: x + 1, y: y + 1 }, // Bottom-right
                ];

                blockCorners.forEach((corner) => {
                    const key = `${corner.x},${corner.y}`;
                    if (!visited.has(key)) {
                        // Check if this is an outer corner (exposed to empty space)
                        const isOuterCorner = isExposedCorner(corner, piece, localX, localY);
                        if (isOuterCorner) {
                            corners.push(corner);
                            visited.add(key);
                        }
                    }
                });
            }
        });
    });

    return corners;
}

/**
 * Checks if a corner is exposed to empty space
 * @param {Object} corner - Corner position {x, y}
 * @param {Object} piece - The piece
 * @param {number} localX - Local X in piece
 * @param {number} localY - Local Y in piece
 * @returns {boolean} True if corner is exposed
 */
function isExposedCorner(corner, piece, localX, localY) {
    // Simple heuristic: corners at piece boundaries are exposed
    // This is a simplified version - could be enhanced
    return true;
}

/**
 * Creates subtle white glows at contact points when blocks merge
 * Micro-detail for satisfying connection feedback
 * @param {Object} piece - The newly locked piece
 * @param {Array} lockedPieces - Already locked pieces
 */
function createBlockMergeGlows(piece, lockedPieces, containerElement = null) {
    const container = containerElement || document.getElementById('line-clear-flash');
    if (!container || !lockedPieces.length) return;

    // Generate board to check adjacencies
    const board = generateBoard(lockedPieces);
    const contactPoints = [];

    // Check each block in the piece for adjacent blocks
    piece.shape.forEach((row, localY) => {
        row.forEach((cell, localX) => {
            if (cell > 0) {
                const x = piece.x + localX;
                const y = piece.y + localY;

                // Check all 4 adjacent positions
                const adjacents = [
                    { x: x - 1, y, side: 'left' },
                    { x: x + 1, y, side: 'right' },
                    { x, y: y - 1, side: 'top' },
                    { x, y: y + 1, side: 'bottom' },
                ];

                adjacents.forEach((adj) => {
                    // Check if this position has a locked block
                    if (
                        adj.y >= 0
                        && adj.y < board.length
                        && adj.x >= 0
                        && adj.x < COLS
                        && board[adj.y][adj.x] !== null
                    ) {
                        // Calculate glow position at the contact edge
                        let glowX;
                        let glowY;

                        if (adj.side === 'left') {
                            glowX = x * BLOCK_SIZE;
                            glowY = y * BLOCK_SIZE + BLOCK_SIZE / 2;
                        } else if (adj.side === 'right') {
                            glowX = (x + 1) * BLOCK_SIZE;
                            glowY = y * BLOCK_SIZE + BLOCK_SIZE / 2;
                        } else if (adj.side === 'top') {
                            glowX = x * BLOCK_SIZE + BLOCK_SIZE / 2;
                            glowY = y * BLOCK_SIZE;
                        } else {
                            // bottom
                            glowX = x * BLOCK_SIZE + BLOCK_SIZE / 2;
                            glowY = (y + 1) * BLOCK_SIZE;
                        }

                        contactPoints.push({
                            x: glowX,
                            y: glowY - HIDDEN_ROWS * BLOCK_SIZE,
                            side: adj.side,
                        });
                    }
                });
            }
        });
    });

    // Create glow elements at each contact point
    contactPoints.forEach((point, index) => {
        const glow = document.createElement('div');
        glow.className = 'merge-glow';
        glow.classList.add(point.side);

        glow.style.left = `${point.x}px`;
        glow.style.top = `${point.y}px`;
        glow.style.animationDelay = `${index * 15}ms`;

        container.appendChild(glow);

        setTimeout(
            () => {
                if (glow.parentNode === container) {
                    container.removeChild(glow);
                }
            },
            120 + index * 15,
        );
    });
}

/**
 * Triggers a subtle background pulse on line clear
 * Tetris Effect-inspired ambient reaction
 * @param {number} lineCount - Number of lines cleared (affects intensity)
 */
export function triggerBackgroundPulse(lineCount = 1) {
    const backgroundCanvas = document.getElementById('background-canvas');
    const themeContainers = document.querySelectorAll('.theme-container.active');

    if (!backgroundCanvas && themeContainers.length === 0) return;

    // Create pulse overlay
    const pulse = document.createElement('div');
    pulse.className = 'background-pulse';

    // Adjust intensity based on line count
    if (lineCount >= 4) {
        pulse.classList.add('intense'); // Tetris
    } else if (lineCount >= 3) {
        pulse.classList.add('strong'); // Triple
    } else if (lineCount >= 2) {
        pulse.classList.add('medium'); // Double
    }

    document.body.appendChild(pulse);

    // Trigger animation
    setTimeout(() => {
        pulse.classList.add('active');
    }, 10);

    // Remove after animation
    setTimeout(() => {
        if (pulse.parentNode === document.body) {
            document.body.removeChild(pulse);
        }
    }, 800);
}

/**
 * Shows a score popup notification
 * @param {number} points - Points to display
 */
export function showScorePopup(points) {
    const el = document.createElement('div');
    el.className = 'score-popup';
    el.textContent = `+${points}`;
    el.style.left = '50%';
    el.style.top = '50%';

    const container = document.getElementById('score-popups');
    container.appendChild(el);

    setTimeout(() => container.removeChild(el), 1000);
}

/**
 * Shows a floating combo notification for cascade clears
 * @param {number} comboCount - Current combo count (2+)
 * @param {HTMLElement} customContainer - Optional custom container element (for multiplayer)
 */
export function showComboPopup(comboCount, customContainer = null) {
    const container = customContainer || document.getElementById('score-popups');
    if (!container) return;

    const popup = document.createElement('div');
    popup.className = 'combo-popup';
    popup.textContent = `${comboCount}x COMBO`;

    const color = getComboColor(comboCount);
    const scale = Math.min(1 + (comboCount - 2) * 0.18, 1.8);

    popup.style.setProperty('--combo-color', color);
    popup.style.setProperty('--combo-scale', scale);

    container.appendChild(popup);

    popup.addEventListener(
        'animationend',
        () => {
            if (popup.parentNode === container) {
                container.removeChild(popup);
            }
        },
        { once: true },
    );
}

/**
 * Shows a level up notification
 * @param {number} level - New level number
 */
export function showLevelUpNotification(level) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: absolute;
        top: 30%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-family: 'Orbitron', sans-serif;
        font-size: 32px;
        font-weight: 900;
        color: #fbbf24;
        text-shadow: 0 0 20px rgba(251, 191, 36, 0.8);
        animation: levelUp 1.5s ease-out forwards;
        pointer-events: none;
        z-index: 100;
    `;
    notification.textContent = `LEVEL ${level}!`;

    const style = document.createElement('style');
    style.textContent = `
        @keyframes levelUp {
            0% {
                transform: translate(-50%, -50%) scale(0.5);
                opacity: 0;
            }
            50% {
                transform: translate(-50%, -50%) scale(1.2);
                opacity: 1;
            }
            100% {
                transform: translate(-50%, -200%) scale(1);
                opacity: 0;
            }
        }
    `;

    document.head.appendChild(style);
    const container = document.getElementById('score-popups');
    container.appendChild(notification);

    setTimeout(() => {
        container.removeChild(notification);
        document.head.removeChild(style);
    }, 1500);
}

/**
 * Updates the stats display
 * PERFORMANCE OPTIMIZED: Caches DOM elements and only updates when values change
 * @param {Object} stats - Game statistics:
 *   - score: Current score
 *   - lines: Lines cleared
 *   - level: Current level
 *   - linesUntilNextLevel: Lines needed for next level
 *   - startTime: Game start timestamp
 *   - piecesPlaced: Total pieces placed
 */
export function updateStats(stats) {
    const {
        score, lines, level, linesUntilNextLevel, startTime, piecesPlaced,
    } = stats;

    // PERFORMANCE: Lazy-load DOM elements (only once)
    if (!statElements.score) {
        statElements.score = document.getElementById('score');
        statElements.lines = document.getElementById('lines');
        statElements.level = document.getElementById('level');
        statElements.nextLevel = document.getElementById('next-level');
        statElements.levelProgress = document.getElementById('level-progress');
        statElements.stage = document.querySelector?.('.single-player-stage') || null;
        statElements.speed = document.getElementById('speed');
        statElements.bpm = document.getElementById('bpm');
        statElements.ppm = document.getElementById('ppm');
    }

    // Restart all changed stat animations with one shared layout barrier.
    const pulseElements = [];
    const pulseElement = (el) => {
        if (!el) return;
        pulseElements.push(el);
    };

    // PERFORMANCE: Only update if values changed
    if (lastStatValues.score !== score && statElements.score) {
        lastStatValues.score = score;
        statElements.score.textContent = Number(score || 0).toLocaleString();
        pulseElement(statElements.score);
    }

    if (lastStatValues.lines !== lines && statElements.lines) {
        lastStatValues.lines = lines;
        statElements.lines.textContent = lines;
        pulseElement(statElements.lines);
    }

    // PERFORMANCE: Only update level if changed
    if (lastStatValues.level !== level && statElements.level) {
        lastStatValues.level = level;
        statElements.level.textContent = level;
        statElements.level.className = 'single-player-stat-value';
        if (level >= 10) statElements.level.classList.add('danger');
        else if (level >= 5) statElements.level.classList.add('warning');
        pulseElement(statElements.level);
    }

    if (lastStatValues.linesUntilNextLevel !== linesUntilNextLevel && statElements.nextLevel) {
        lastStatValues.linesUntilNextLevel = linesUntilNextLevel;
        statElements.nextLevel.textContent = linesUntilNextLevel;
        // The ledger's bar toward the next level.
        const done = 1 - Math.min(LINES_PER_LEVEL, Math.max(0, linesUntilNextLevel)) / LINES_PER_LEVEL;
        statElements.levelProgress?.style.setProperty('--sp-level', done.toFixed(3));
        pulseElement(statElements.nextLevel);
    }
    updateWellDanger(stats);

    // PERFORMANCE: Calculate speed using cached constant array
    const baseSpeed = LEVEL_SPEEDS[0];
    const currentSpeed = LEVEL_SPEEDS[Math.min(level - 1, LEVEL_SPEEDS.length - 1)];
    const speedMultiplier = (baseSpeed / currentSpeed).toFixed(1);

    if (lastStatValues.speedMultiplier !== speedMultiplier && statElements.speed) {
        lastStatValues.speedMultiplier = speedMultiplier;
        statElements.speed.textContent = `${speedMultiplier}x`;
        statElements.speed.className = 'single-player-stat-value';
        const speedValue = parseFloat(speedMultiplier);
        if (speedValue >= 20) statElements.speed.classList.add('danger');
        else if (speedValue >= 5) statElements.speed.classList.add('warning');
        pulseElement(statElements.speed);
    }

    // Calculate BPM (Blocks/Pieces Per Minute)
    const elapsedMs = startTime ? (Date.now() - startTime) : 0;
    const elapsedMinutes = elapsedMs / 60000;
    const pieces = piecesPlaced || 0;

    if (statElements.bpm) {
        const bpm = elapsedMinutes > 0.05 ? Math.round(pieces / elapsedMinutes) : 0; // Wait 3s before calculating

        if (lastStatValues.bpm !== bpm) {
            lastStatValues.bpm = bpm;
            statElements.bpm.textContent = bpm;
            // Only pulse on meaningful changes (avoid constant pulsing)
            if (bpm > 0 && pieces % 5 === 0) {
                pulseElement(statElements.bpm);
            }
        }
    }

    // Calculate PPM (Points Per Minute) - like Quadra
    if (statElements.ppm) {
        const ppm = elapsedMinutes > 0.05 ? Math.round(score / elapsedMinutes) : 0; // Wait 3s before calculating

        if (lastStatValues.ppm !== ppm) {
            lastStatValues.ppm = ppm;
            statElements.ppm.textContent = ppm.toLocaleString();
            // Only pulse on meaningful score changes
            if (ppm > 0 && score % 100 === 0) {
                pulseElement(statElements.ppm);
            }
        }
    }
    if (pulseElements.length > 0) {
        pulseElements.forEach((el) => el.classList.remove('pulse'));
        void pulseElements[0].offsetWidth;
        pulseElements.forEach((el) => el.classList.add('pulse'));
    }
}
