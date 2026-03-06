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

    if (!manager) {
        return createFallbackStyle(fallbackColor);
    }

    return manager.getStyleForPiece(pieceKey);
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
    const shape = SHAPES[pieceKey];
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
