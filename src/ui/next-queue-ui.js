import { SHAPES, COLORS } from '../core/constants.js';
import { drawPieceSolid, trimShape } from '../rendering/canvas/canvas-drawing-utils.js';
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

const queueStates = new Map();
const canvasSlots = new WeakMap();
const trimmedShapes = new Map();
let listenersRegistered = false;
let unsubscribeThemeChanged = null;
let unsubscribeViewportChanged = null;
let styleManager = null;
let pendingStyleInit = null;
let resizeFrame = null;
let resizeObserver = null;
let styleRevision = 0;

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
        pendingStyleInit = setTimeout(() => {
            pendingStyleInit = null;
            renderQueues(getLiveQueues());
        }, 100);
        return null;
    }

    styleManager = new TetrominoStyleManager(themeManager, settingsManager);
    styleManager.init();
    styleRevision += 1;
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

function ensureListeners() {
    if (listenersRegistered) {
        return;
    }
    listenersRegistered = true;

    if (eventBus && typeof eventBus.on === 'function') {
        unsubscribeThemeChanged = eventBus.on(EVENTS.THEME_CHANGED, () => {
            styleManager?.refresh?.();
            styleRevision += 1;
            renderQueues(getLiveQueues());
        });
        unsubscribeViewportChanged = eventBus.on(EVENTS.VIEWPORT_RESIZED, handleResize);
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('settingsChanged', handleSettingsChanged);
        window.addEventListener('beforeunload', cleanupListeners);
    }
    const Observer = globalThis.ResizeObserver || globalThis.window?.ResizeObserver;
    if (Observer) {
        resizeObserver = new Observer((entries) => {
            const live = getLiveQueues();
            live.forEach((state) => {
                if (entries.some((entry) => state.slots.some((slot) => slot.element === entry.target))) {
                    state.measureNeeded = true;
                }
            });
            scheduleResize();
        });
    }
}

function cleanupListeners() {
    if (typeof window !== 'undefined') {
        window.removeEventListener('settingsChanged', handleSettingsChanged);
        window.removeEventListener('beforeunload', cleanupListeners);
    }
    if (pendingStyleInit !== null) clearTimeout(pendingStyleInit);
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    pendingStyleInit = null;
    resizeFrame = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    queueStates.clear();
    styleManager?.destroy();
    styleManager = null;
    if (unsubscribeThemeChanged) {
        unsubscribeThemeChanged();
        unsubscribeThemeChanged = null;
    }
    unsubscribeViewportChanged?.();
    unsubscribeViewportChanged = null;
    listenersRegistered = false;
}

function handleSettingsChanged(event) {
    if (event?.detail?.themeBasedTetrominos === undefined) {
        return;
    }
    styleManager?.refresh?.();
    styleRevision += 1;
    renderQueues(getLiveQueues());
}

function drawMeasuredPiece(canvas, pieceKey, displayWidth, displayHeight, dpr, isHighlight, styleConfig) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let shape = trimmedShapes.get(pieceKey);
    if (!shape) {
        shape = trimShape(SHAPES[pieceKey]);
        trimmedShapes.set(pieceKey, shape);
    }

    const rows = shape.length;
    const cols = shape[0].length;

    const renderWidth = Math.max(1, Math.round(displayWidth * dpr));
    const renderHeight = Math.max(1, Math.round(displayHeight * dpr));

    if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
        canvas.width = renderWidth;
        canvas.height = renderHeight;
    }
    if (canvas.style.width !== '100%') canvas.style.width = '100%';
    if (canvas.style.height !== '100%') canvas.style.height = '100%';

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    // Disable anti-aliasing for crisp pixel-perfect rendering
    ctx.imageSmoothingEnabled = false;

    // Scale block size to fit within the container with padding
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

export function drawPiece(canvas, pieceKey) {
    if (!canvas || !SHAPES[pieceKey]) return;
    const ownedSlot = canvasSlots.get(canvas);
    if (ownedSlot) ownedSlot.lastDraw = null;
    const shape = trimShape(SHAPES[pieceKey]);
    const slot = canvas.closest('.player-next-piece');
    const displayWidth = slot ? slot.clientWidth : (canvas.clientWidth || BASE_BLOCK_SIZE * shape[0].length + BASE_PADDING * 2);
    const displayHeight = slot ? slot.clientHeight : (canvas.clientHeight || BASE_BLOCK_SIZE * shape.length + BASE_PADDING * 2);
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    drawMeasuredPiece(
        canvas,
        pieceKey,
        displayWidth,
        displayHeight,
        dpr,
        !!slot?.classList.contains('highlight'),
        resolveStyleConfig(pieceKey),
    );
}

function getLiveQueues() {
    const live = [];
    queueStates.forEach((state, id) => {
        if (document.getElementById(id) === state.container) {
            live.push(state);
        } else {
            state.slots.forEach((slot) => resizeObserver?.unobserve(slot.element));
            queueStates.delete(id);
        }
    });
    return live;
}

function scheduleResize() {
    if (resizeFrame !== null) return;
    resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        renderQueues(getLiveQueues());
    });
}

function handleResize() {
    getLiveQueues().forEach((state) => { state.measureNeeded = true; });
    scheduleResize();
}

function renderQueues(states) {
    if (states.some((state) => state.nextPieces.some((pieceKey) => SHAPES[pieceKey]))) getStyleManager();
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    // Read every affected slot before changing any canvas backing store.
    states.forEach((state) => {
        if (!state.measureNeeded && resizeObserver) return;
        state.slots.forEach((slot) => {
            slot.width = slot.element.clientWidth;
            slot.height = slot.element.clientHeight;
        });
        state.measureNeeded = false;
    });
    states.forEach((state) => {
        state.slots.forEach((slot, index) => {
            const pieceKey = SHAPES[state.nextPieces[index]] ? state.nextPieces[index] : null;
            const last = slot.lastDraw;
            if (last?.pieceKey === pieceKey && last.width === slot.width
                && last.height === slot.height && last.dpr === dpr && last.revision === styleRevision
                && (!pieceKey || (slot.canvas.width === Math.max(1, Math.round(slot.width * dpr))
                    && slot.canvas.height === Math.max(1, Math.round(slot.height * dpr))))) return;
            slot.element.classList.toggle('empty', !pieceKey);
            if (pieceKey) {
                drawMeasuredPiece(
                    slot.canvas,
                    pieceKey,
                    slot.width,
                    slot.height,
                    dpr,
                    index === 0,
                    resolveStyleConfig(pieceKey),
                );
            } else if (!last || last.pieceKey) {
                const ctx = slot.canvas.getContext('2d');
                ctx?.clearRect(0, 0, slot.canvas.width, slot.canvas.height);
            }
            slot.lastDraw = {
                pieceKey, width: slot.width, height: slot.height, dpr, revision: styleRevision,
            };
        });
    });
}

export function updateNextQueue(nextPieces, containerId = 'next-queue-container') {
    ensureListeners();
    const queueContainer = document.getElementById(containerId);
    getLiveQueues();
    if (!queueContainer) return;
    let state = queueStates.get(containerId);
    if (!state || state.slots.some((slot) => slot.element.parentNode !== queueContainer
        || slot.canvas.parentNode !== slot.element)) {
        state?.slots.forEach((slot) => resizeObserver?.unobserve(slot.element));
        queueContainer.innerHTML = '';
        queueContainer.classList.remove('next-queue-container');
        queueContainer.classList.add('player-next-pieces', 'single-player-next');
        state = {
            container: queueContainer, nextPieces: [], slots: [], measureNeeded: true,
        };
        const fragment = document.createDocumentFragment();
        for (let index = 0; index < 3; index += 1) {
            const element = document.createElement('div');
            element.className = 'player-next-piece';
            if (index === 0) element.classList.add('highlight');
            const canvas = document.createElement('canvas');
            element.appendChild(canvas);
            fragment.appendChild(element);
            const slot = { element, canvas, lastDraw: null };
            state.slots.push(slot);
            canvasSlots.set(canvas, slot);
            canvas.addEventListener('contextrestored', () => {
                if (queueStates.get(containerId) !== state) return;
                slot.lastDraw = null;
                renderQueues([state]);
            });
        }
        queueContainer.appendChild(fragment);
        queueStates.set(containerId, state);
        state.slots.forEach((slot) => resizeObserver?.observe(slot.element));
    }
    state.nextPieces = Array.isArray(nextPieces) ? nextPieces.slice(0, 3) : [];
    renderQueues([state]);
}
