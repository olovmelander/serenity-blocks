import { SHAPES, COLORS } from '../core/constants.js';
import { drawPieceSolid } from '../rendering/canvas/canvas-drawing-utils.js';
import { TetrominoStyleManager } from '../rendering/tetromino-style-manager.js';
import { eventBus, EVENTS } from '../events/event-bus.js';

const BASE_BLOCK_SIZE = 24;
const BASE_PADDING = 6;
const DEFAULT_EFFECTS = {
    glowRadius: 0,
    glowIntensity: 0,
    glowColor: 'auto',
    outline: false,
    outlineWidth: 0,
    outlineColor: '#ffffff',
    pulse: false,
    pulseSpeed: 0,
    pulseAmplitude: 0,
};

/**
 * Trim a piece shape matrix down to its occupied bounding box so previews are
 * sized/centred on the actual piece (e.g. the I-piece is 4×4 with blank rows).
 * @param {Array<Array<number>>} shape
 * @returns {Array<Array<number>>}
 */
function trimShape(shape) {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    shape.forEach((row, y) => row.forEach((cell, x) => {
        if (cell > 0) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }));
    if (maxX < minX) return shape; // empty, shouldn't happen
    const trimmed = [];
    for (let y = minY; y <= maxY; y++) {
        trimmed.push(shape[y].slice(minX, maxX + 1));
    }
    return trimmed;
}

let cachedNextPieces = [];
let listenersRegistered = false;
let unsubscribeThemeChanged = null;
let styleManager = null;
let pendingStyleInit = false;

function createFallbackStyle(color) {
    return {
        color,
        renderMode: 'solid',
        effects: { ...DEFAULT_EFFECTS, glowColor: color },
        rendererOverrides: {},
    };
}

function getStyleManager() {
    if (styleManager) {
        return styleManager;
    }

    if (pendingStyleInit) {
        return null;
    }

    const hasWindow = typeof window !== 'undefined';
    const themeManager = hasWindow ? window.themeManager : null;
    const settingsManager = hasWindow ? window.settingsManager : null;

    if (!themeManager || !settingsManager) {
        pendingStyleInit = true;
        setTimeout(() => {
            pendingStyleInit = false;
            if (cachedNextPieces.length > 0) {
                updateNextQueue(cachedNextPieces);
            }
        }, 100);
        return null;
    }

    styleManager = new TetrominoStyleManager(themeManager, settingsManager);
    styleManager.init();
    return styleManager;
}

function resolveStyleConfig(pieceKey) {
    const fallbackColor = COLORS[pieceKey] || '#808080';
    const manager = getStyleManager();
    const base = manager ? manager.getStyleForPiece(pieceKey) : createFallbackStyle(fallbackColor);

    // Render next-queue previews EXACTLY like the on-board (Phaser) pieces: the
    // premium "solid" treatment (gradient + gloss + white rim). The Phaser canvas
    // ignores theme glow/gradient/outline, so the queue must too — otherwise themed
    // pieces pick up a dark theme outline and glow the board never shows. We keep
    // only the themed COLOR.
    return {
        ...base,
        renderMode: 'solid',
        effects: {
            ...base.effects,
            outline: false,
            glowRadius: 0,
            glowIntensity: 0,
        },
        rendererOverrides: {
            ...base.rendererOverrides,
            canvas: {
                ...(base.rendererOverrides?.canvas || {}),
                outline: false,
                glowRadius: 0,
                glowIntensity: 0,
            },
        },
    };
}

function getEffectiveEffects(styleConfig) {
    const overrides = styleConfig.rendererOverrides?.canvas || {};
    return {
        ...styleConfig.effects,
        ...overrides,
    };
}

function ensureListeners() {
    if (listenersRegistered) {
        return;
    }
    listenersRegistered = true;

    if (eventBus && typeof eventBus.on === 'function') {
        unsubscribeThemeChanged = eventBus.on(EVENTS.THEME_CHANGED, () => {
            styleManager?.refresh?.();
            if (cachedNextPieces.length > 0) {
                updateNextQueue(cachedNextPieces);
            }
        });
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('settingsChanged', handleSettingsChanged);
        window.addEventListener('beforeunload', cleanupListeners);
    }
}

function cleanupListeners() {
    if (typeof window !== 'undefined') {
        window.removeEventListener('settingsChanged', handleSettingsChanged);
        window.removeEventListener('beforeunload', cleanupListeners);
    }
    if (unsubscribeThemeChanged) {
        unsubscribeThemeChanged();
        unsubscribeThemeChanged = null;
    }
    listenersRegistered = false;
}

function handleSettingsChanged(event) {
    if (event?.detail?.themeBasedTetrominos === undefined) {
        return;
    }
    styleManager?.refresh?.();
    if (cachedNextPieces.length > 0) {
        updateNextQueue(cachedNextPieces);
    }
}

export function drawPiece(canvas, pieceKey) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const shape = trimShape(SHAPES[pieceKey]);
    const styleConfig = resolveStyleConfig(pieceKey);

    const rows = shape.length;
    const cols = shape[0].length;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    // Measure the container to fit the piece within it (like multiplayer does)
    const slot = canvas.closest('.player-next-piece');
    const displayWidth = slot ? slot.clientWidth : (canvas.clientWidth || BASE_BLOCK_SIZE * cols + BASE_PADDING * 2);
    const displayHeight = slot ? slot.clientHeight : (canvas.clientHeight || BASE_BLOCK_SIZE * rows + BASE_PADDING * 2);

    const renderWidth = Math.max(1, Math.round(displayWidth * dpr));
    const renderHeight = Math.max(1, Math.round(displayHeight * dpr));

    if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
        canvas.width = renderWidth;
        canvas.height = renderHeight;
    }
    canvas.style.width = '100%';
    canvas.style.height = '100%';

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    // Disable anti-aliasing for crisp pixel-perfect rendering
    ctx.imageSmoothingEnabled = false;

    // Scale block size to fit within the container with padding
    const isHighlight = slot && slot.classList.contains('highlight');
    const paddingFactor = isHighlight ? 0.18 : 0.22;
    const padding = Math.max(BASE_PADDING, Math.min(displayWidth, displayHeight) * paddingFactor);
    const availableWidth = Math.max(1, displayWidth - padding * 2);
    const availableHeight = Math.max(1, displayHeight - padding * 2);
    const blockSize = Math.max(4, Math.floor(Math.min(
        availableWidth / cols,
        availableHeight / rows,
    )));

    // Center the piece within the container
    const pieceWidth = cols * blockSize;
    const pieceHeight = rows * blockSize;
    const offsetX = Math.round((displayWidth - pieceWidth) / 2);
    const offsetY = Math.round((displayHeight - pieceHeight) / 2);

    // Draw the entire piece as a solid unit (outer edges only)
    drawPieceSolid(ctx, shape, offsetX, offsetY, blockSize, styleConfig);

    ctx.restore();
}

export function updateNextQueue(nextPieces, containerId = 'next-queue-container') {
    ensureListeners();
    cachedNextPieces = Array.isArray(nextPieces) ? [...nextPieces] : [];

    const queueContainer = document.getElementById(containerId);
    if (!queueContainer) return;
    queueContainer.innerHTML = '';

    queueContainer.classList.remove('next-queue-container');
    queueContainer.classList.add('player-next-pieces', 'single-player-next');

    const slotsToRender = 3;

    for (let index = 0; index < slotsToRender; index += 1) {
        const pieceKey = nextPieces[index];
        const pieceContainer = document.createElement('div');
        pieceContainer.className = 'player-next-piece';
        if (index === 0) {
            pieceContainer.classList.add('highlight');
        }

        const canvas = document.createElement('canvas');
        pieceContainer.appendChild(canvas);
        queueContainer.appendChild(pieceContainer);

        if (pieceKey) {
            drawPiece(canvas, pieceKey);
        } else {
            pieceContainer.classList.add('empty');
        }
    }
}
