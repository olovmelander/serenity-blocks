/**
 * @fileoverview Main drawing logic for Serenity Blocks
 * Handles rendering of the game board, pieces, and next pieces
 */

import { COLS, ROWS, HIDDEN_ROWS, BLOCK_SIZE, SHAPES, COLORS } from '../core/constants.js';
import { generateBoard } from '../core/board.js';
import { isValidPosition } from '../core/board.js';
import {
    getGridCache,
    drawBlock,
    drawGhostPiece,
    updateCanvasStyle,
    getLastRenderedLevel
} from './canvas-utils.js';

// Piece trail system for motion fluidity
let pieceTrails = [];
const MAX_TRAILS = 3;

const COMBO_COLOR_STEPS = [
    { max: 2, color: '#22d3ee' },  // Cyan
    { max: 3, color: '#8b5cf6' },  // Purple
    { max: Infinity, color: '#d946ef' } // Magenta
];

function getComboColor(comboCount) {
    for (const step of COMBO_COLOR_STEPS) {
        if (comboCount <= step.max) {
            return step.color;
        }
    }
    return COMBO_COLOR_STEPS[COMBO_COLOR_STEPS.length - 1].color;
}

/**
 * Adds a piece trail (afterimage) for motion fluidity
 * Tetris Effect-inspired subtle motion trails
 * @param {Object} piece - Current piece to trail
 */
export function addPieceTrail(piece) {
    if (!piece) return;

    // Add new trail snapshot
    pieceTrails.push({
        piece: {
            ...piece,
            shape: piece.shape.map(row => [...row])
        },
        timestamp: Date.now(),
        opacity: 0.15
    });

    // Limit trail count
    if (pieceTrails.length > MAX_TRAILS) {
        pieceTrails.shift();
    }
}

/**
 * Updates and draws piece trails with fade-out
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 */
function drawPieceTrails(ctx) {
    const now = Date.now();
    const trailDuration = 150; // 150ms fade

    // Filter out expired trails and draw remaining ones
    pieceTrails = pieceTrails.filter(trail => {
        const age = now - trail.timestamp;
        if (age > trailDuration) return false;

        // Calculate fade opacity
        const fadeProgress = age / trailDuration;
        const opacity = trail.opacity * (1 - fadeProgress);

        // Draw trail piece
        trail.piece.shape.forEach((row, y) => {
            row.forEach((cell, x) => {
                if (cell > 0 && trail.piece.y + y >= HIDDEN_ROWS) {
                    ctx.save();
                    ctx.globalAlpha = opacity;
                    ctx.fillStyle = trail.piece.color;
                    ctx.fillRect(
                        (trail.piece.x + x) * BLOCK_SIZE,
                        (trail.piece.y + y - HIDDEN_ROWS) * BLOCK_SIZE,
                        BLOCK_SIZE,
                        BLOCK_SIZE
                    );
                    ctx.restore();
                }
            });
        });

        return true;
    });
}

/**
 * Main draw function - renders the entire game state
 * @param {HTMLCanvasElement} canvas - The game canvas
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} gameState - Current game state containing:
 *   - lockedPieces: Array of locked pieces
 *   - currentPiece: Currently falling piece
 *   - level: Current level (for canvas styling)
 */
export function draw(canvas, ctx, gameState) {
    const { lockedPieces, currentPiece, level } = gameState;

    // Only update canvas styles when level changes (performance optimization)
    if (level !== getLastRenderedLevel()) {
        updateCanvasStyle(canvas, level);
    }

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Use cached grid instead of redrawing it every frame
    const gridCache = getGridCache();
    if (gridCache) {
        ctx.drawImage(gridCache, 0, 0);
    }

    // Draw piece trails first (behind everything)
    drawPieceTrails(ctx);

    // Generate board data for border detection
    const boardData = generateBoard(lockedPieces);

    // Draw locked pieces (with animation support for garbage)
    lockedPieces.forEach(piece => {
        // Calculate Y offset for animating garbage
        let yOffset = 0;
        if (piece.isAnimating && piece.animationOffset !== undefined) {
            yOffset = piece.animationOffset; // Will be reduced over time
        }

        piece.shape.forEach((row, localY) => {
            row.forEach((cell, localX) => {
                if (cell > 0) {
                    const boardX = piece.x + localX;
                    const boardY = piece.y + localY;
                    const renderY = boardY + yOffset;

                    // Skip if outside visible area
                    if (renderY < HIDDEN_ROWS) return;
                    if (renderY >= ROWS + HIDDEN_ROWS) return;

                    // Determine color
                    let blockColor = piece.color;
                    if (piece.shapeKey && COLORS[piece.shapeKey]) {
                        blockColor = COLORS[piece.shapeKey];
                    }
                    // Fallback to gray if color is undefined/null to prevent black rendering
                    if (!blockColor) {
                        blockColor = '#808080';
                    }

                    // For animating pieces, use piece shape for borders instead of boardData
                    // This fixes border rendering when garbage is animating with offset
                    const useBoardData = !piece.isAnimating || yOffset === 0;

                    // Draw with optional fade for cleared pieces (alpha property)
                    const alpha = piece.alpha !== undefined ? piece.alpha : 1.0;
                    if (alpha < 1.0) {
                        ctx.save();
                        ctx.globalAlpha = alpha;
                    }

                    drawBlock(
                        ctx,
                        boardX,
                        renderY - HIDDEN_ROWS,
                        blockColor,
                        useBoardData ? boardData : null,
                        false,
                        useBoardData ? null : piece.shape,
                        useBoardData ? 0 : piece.x,
                        useBoardData ? 0 : renderY - HIDDEN_ROWS,
                        useBoardData ? boardX : localX,
                        useBoardData ? renderY : localY
                    );

                    if (alpha < 1.0) {
                        ctx.restore();
                    }
                }
            });
        });
    });

    // Draw current piece with ghost
    if (currentPiece) {
        // Calculate ghost position
        let ghostY = currentPiece.y;
        while (isValidPosition(currentPiece, currentPiece.x, ghostY + 1, lockedPieces)) {
            ghostY++;
        }

        // Draw ghost piece first (so it appears behind the actual piece)
        drawGhostPiece(ctx, currentPiece, ghostY);

        // Draw current piece
        currentPiece.shape.forEach((row, y) => {
            row.forEach((cell, x) => {
                if (cell > 0 && currentPiece.y + y >= HIDDEN_ROWS) {
                    drawBlock(
                        ctx,
                        currentPiece.x + x,
                        currentPiece.y + y - HIDDEN_ROWS,
                        currentPiece.color,
                        null,
                        false,
                        currentPiece.shape,
                        currentPiece.x,
                        currentPiece.y - HIDDEN_ROWS,
                        x,
                        y
                    );
                }
            });
        });
    }
}

/**
 * Draws the next pieces in their preview canvases
 * @param {Array<HTMLCanvasElement>} nextCanvases - Array of canvas elements for next pieces
 * @param {Array<string>} nextPieces - Array of next piece keys (e.g., 'I', 'O', 'T')
 */
export function drawNextPieces(nextCanvases, nextPieces) {
    nextCanvases.forEach((canv, idx) => {
        const ctx = canv.getContext('2d');
        ctx.clearRect(0, 0, canv.width, canv.height);

        if (nextPieces[idx]) {
            const shape = SHAPES[nextPieces[idx]];
            const color = COLORS[nextPieces[idx]];

            // Scale blocks based on which preview (first is larger)
            const blockSize = BLOCK_SIZE * (idx === 0 ? 0.4 : 0.33);

            // Center the shape in the canvas
            const offsetX = (canv.width - shape[0].length * blockSize) / 2;
            const offsetY = (canv.height - shape.length * blockSize) / 2;

            shape.forEach((row, y) => {
                row.forEach((cell, x) => {
                    if (cell > 0) {
                        // Draw block
                        ctx.fillStyle = color;
                        ctx.fillRect(
                            offsetX + x * blockSize,
                            offsetY + y * blockSize,
                            blockSize,
                            blockSize
                        );

                        // Add highlight for first piece (most prominent)
                        if (idx === 0) {
                            const highlightSize = Math.max(1, blockSize / 4);
                            const highlightOffset = Math.max(1, blockSize / 12);
                            ctx.fillStyle = 'rgba(255,255,255,0.3)';
                            ctx.fillRect(
                                offsetX + x * blockSize + highlightOffset,
                                offsetY + y * blockSize + highlightOffset,
                                highlightSize,
                                highlightSize
                            );
                        }

                        // Draw border
                        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
                        ctx.lineWidth = Math.max(0.5, blockSize / 15);
                        ctx.strokeRect(
                            offsetX + x * blockSize,
                            offsetY + y * blockSize,
                            blockSize,
                            blockSize
                        );
                    }
                });
            });
        }
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
        const angle = (Math.PI / 3) + (i / particleCount) * (Math.PI / 1.5);
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
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;

    // Calculate center point of cleared lines
    const avgRow = clearedRows.reduce((a, b) => a + b, 0) / clearedRows.length;
    const centerY = (avgRow - HIDDEN_ROWS) * BLOCK_SIZE + (BLOCK_SIZE / 2);

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
        const x = (corner.x * BLOCK_SIZE) + (BLOCK_SIZE / 2);
        const y = ((corner.y - HIDDEN_ROWS) * BLOCK_SIZE) + (BLOCK_SIZE / 2);

        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;

        // Slight delay stagger for multiple corners
        ripple.style.animationDelay = `${index * 30}ms`;

        container.appendChild(ripple);

        setTimeout(() => {
            if (ripple.parentNode === container) {
                container.removeChild(ripple);
            }
        }, 400 + (index * 30));
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
                    { x: x, y: y },           // Top-left
                    { x: x + 1, y: y },       // Top-right
                    { x: x, y: y + 1 },       // Bottom-left
                    { x: x + 1, y: y + 1 }    // Bottom-right
                ];

                blockCorners.forEach(corner => {
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
                    { x: x - 1, y: y, side: 'left' },
                    { x: x + 1, y: y, side: 'right' },
                    { x: x, y: y - 1, side: 'top' },
                    { x: x, y: y + 1, side: 'bottom' }
                ];

                adjacents.forEach(adj => {
                    // Check if this position has a locked block
                    if (adj.y >= 0 && adj.y < board.length &&
                        adj.x >= 0 && adj.x < COLS &&
                        board[adj.y][adj.x] !== null) {

                        // Calculate glow position at the contact edge
                        let glowX, glowY;

                        if (adj.side === 'left') {
                            glowX = x * BLOCK_SIZE;
                            glowY = y * BLOCK_SIZE + (BLOCK_SIZE / 2);
                        } else if (adj.side === 'right') {
                            glowX = (x + 1) * BLOCK_SIZE;
                            glowY = y * BLOCK_SIZE + (BLOCK_SIZE / 2);
                        } else if (adj.side === 'top') {
                            glowX = x * BLOCK_SIZE + (BLOCK_SIZE / 2);
                            glowY = y * BLOCK_SIZE;
                        } else { // bottom
                            glowX = x * BLOCK_SIZE + (BLOCK_SIZE / 2);
                            glowY = (y + 1) * BLOCK_SIZE;
                        }

                        contactPoints.push({ x: glowX, y: glowY - (HIDDEN_ROWS * BLOCK_SIZE), side: adj.side });
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

        setTimeout(() => {
            if (glow.parentNode === container) {
                container.removeChild(glow);
            }
        }, 120 + (index * 15));
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

    popup.addEventListener('animationend', () => {
        if (popup.parentNode === container) {
            container.removeChild(popup);
        }
    }, { once: true });
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
 * @param {Object} stats - Game statistics:
 *   - score: Current score
 *   - lines: Lines cleared
 *   - level: Current level
 *   - linesUntilNextLevel: Lines needed for next level
 *   - startTime: Game start timestamp
 *   - piecesPlaced: Total pieces placed
 */
export function updateStats(stats) {
    const { score, lines, level, linesUntilNextLevel, startTime, piecesPlaced } = stats;

    document.getElementById('score').textContent = score;
    document.getElementById('lines').textContent = lines;

    const levelEl = document.getElementById('level');
    levelEl.textContent = level;
    levelEl.className = 'stat-value';
    if (level >= 10) levelEl.classList.add('danger');
    else if (level >= 5) levelEl.classList.add('warning');

    document.getElementById('next-level').textContent = linesUntilNextLevel;

    // Speed multiplier
    const LEVEL_SPEEDS = [1000, 900, 800, 700, 600, 500, 400, 350, 300, 250, 200, 175, 150, 125, 100, 90, 80, 70, 60, 50];
    const baseSpeed = LEVEL_SPEEDS[0];
    const currentSpeed = LEVEL_SPEEDS[Math.min(level - 1, LEVEL_SPEEDS.length - 1)];
    const speedMultiplier = (baseSpeed / currentSpeed).toFixed(1);

    const speedEl = document.getElementById('speed');
    speedEl.textContent = `${speedMultiplier}x`;
    speedEl.className = 'stat-value';
    if (parseFloat(speedMultiplier) >= 20) speedEl.classList.add('danger');
    else if (parseFloat(speedMultiplier) >= 5) speedEl.classList.add('warning');

    // BPM (Blocks Per Minute)
    const elapsedMinutes = (Date.now() - startTime) / 60000;
    const bpm = elapsedMinutes > 0 ? Math.floor(piecesPlaced * 4 / elapsedMinutes) : 0;
    document.getElementById('bpm').textContent = bpm;
}
