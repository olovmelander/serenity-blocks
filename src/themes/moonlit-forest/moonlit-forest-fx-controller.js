/**
 * Moonlit Forest reactive FX controller.
 *
 * Centralizes event-driven intensity state and deterministic envelopes so
 * visual reactions can be driven by renderer systems instead of direct DOM writes.
 */
import { readLockViewportOrigin } from '../../events/lock-origin.js';

const BOARD_COLUMNS = 10;
const VISIBLE_ROWS = 20;
const HIDDEN_ROWS = 4;
const MAX_PENDING_BURSTS = 64;

const BURST_NAMES = new Set([
    'fireflies',
    'spores',
    'enchantedLeaves',
    'wisps',
    'sparkles',
    'runes',
    'mist',
    'shootingStars',
    'auroraStrength',
]);

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function copyFinitePosition(position) {
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return null;
    const copy = { x: Number(position.x), y: Number(position.y) };
    if (Number.isFinite(position.z)) copy.z = Number(position.z);
    return copy;
}

function cloneOrigin(origin) {
    if (!origin || typeof origin !== 'object') return null;
    return {
        board: origin.board ? { ...origin.board } : null,
        normalized: origin.normalized ? { ...origin.normalized } : null,
        centered: origin.centered ? { ...origin.centered } : null,
        position: origin.position ? { ...origin.position } : null,
        player: origin.player ?? null,
    };
}

function originKey(origin) {
    if (!origin) return 'global';
    const normalized = origin.normalized || {};
    const position = origin.position || {};
    return [
        origin.player ?? '',
        normalized.x ?? '',
        normalized.y ?? '',
        position.x ?? '',
        position.y ?? '',
        position.z ?? '',
    ].join(':');
}

/**
 * Convert the canonical PIECE_LOCK payload into a renderer-neutral board origin.
 * `normalized` is top-left based (0..1); `centered` is -1..1 with positive Y up.
 * The optional canonical `position` field is retained verbatim for runtimes that
 * already provide a screen/world interaction origin.
 */
export function resolveMoonlitPieceLockOrigin(payload = {}) {
    const piece = payload?.piece;
    const shape = Array.isArray(piece?.shape) ? piece.shape : null;
    let centroidX = Number.isFinite(piece?.x) ? Number(piece.x) + 0.5 : BOARD_COLUMNS / 2;
    let centroidY = Number.isFinite(piece?.y)
        ? Number(piece.y) + 0.5
        : HIDDEN_ROWS + (VISIBLE_ROWS / 2);

    if (shape && Number.isFinite(piece?.x) && Number.isFinite(piece?.y)) {
        let occupiedCells = 0;
        let sumX = 0;
        let sumY = 0;

        shape.forEach((row, rowIndex) => {
            if (!Array.isArray(row)) return;
            row.forEach((cell, columnIndex) => {
                if (!cell) return;
                sumX += Number(piece.x) + columnIndex + 0.5;
                sumY += Number(piece.y) + rowIndex + 0.5;
                occupiedCells += 1;
            });
        });

        if (occupiedCells > 0) {
            centroidX = sumX / occupiedCells;
            centroidY = sumY / occupiedCells;
        }
    }

    // A scrolling/nonstandard mode (Infinity) supplies the ON-SCREEN lock position; prefer it
    // over the fixed-board normalization so the effect tracks where the piece actually landed.
    const viewport = readLockViewportOrigin(payload);
    const normalizedX = viewport ? viewport.x : clamp01(centroidX / BOARD_COLUMNS);
    const normalizedY = viewport ? viewport.y : clamp01((centroidY - HIDDEN_ROWS) / VISIBLE_ROWS);

    return {
        board: { x: centroidX, y: centroidY },
        normalized: { x: normalizedX, y: normalizedY },
        centered: {
            x: (normalizedX * 2) - 1,
            y: 1 - (normalizedY * 2),
        },
        position: copyFinitePosition(payload?.position),
        player: payload?.player ?? null,
    };
}

export class MoonlitForestFXController {
    constructor() {
        this.reset();
    }

    reset() {
        this.time = 0;
        this.linePulse = 0;
        this.comboEnergy = 0;
        this.pieceLockPulse = 0;
        this.mushroomPulse = 0;
        this.moonbeamPulse = 0;
        this.wildlifePulse = 0;
        this.atmospherePulse = 0;
        this.pendingBursts = [];
    }

    step(delta) {
        if (!Number.isFinite(delta) || delta <= 0) return;
        this.time += delta;
        this.linePulse = Math.max(0, this.linePulse - (delta * 1.6));
        this.comboEnergy = Math.max(0, this.comboEnergy - (delta * 0.55));
        this.pieceLockPulse = Math.max(0, this.pieceLockPulse - (delta * 3.0));
        this.mushroomPulse = Math.max(0, this.mushroomPulse - (delta * 2.0));
        this.moonbeamPulse = Math.max(0, this.moonbeamPulse - (delta * 1.8));
        this.wildlifePulse = Math.max(0, this.wildlifePulse - (delta * 1.4));
        this.atmospherePulse = Math.max(0, this.atmospherePulse - (delta * 0.9));
    }

    queueBurst(name, amount, origin = null) {
        if (!BURST_NAMES.has(name)) return;
        const numeric = Number(amount);
        if (!Number.isFinite(numeric) || numeric <= 0) return;

        const normalizedAmount = name === 'auroraStrength' ? numeric : Math.floor(numeric);
        if (normalizedAmount <= 0) return;

        const originSnapshot = cloneOrigin(origin);
        const key = originKey(originSnapshot);
        const existing = this.pendingBursts.find((burst) => (
            burst.name === name && burst.originKey === key
        ));

        if (existing) {
            existing.amount = name === 'auroraStrength'
                ? Math.max(existing.amount, normalizedAmount)
                : existing.amount + normalizedAmount;
            return;
        }

        if (this.pendingBursts.length >= MAX_PENDING_BURSTS) return;
        this.pendingBursts.push({
            name,
            amount: normalizedAmount,
            origin: originSnapshot,
            originKey: key,
        });
    }

    setAuroraStrength(strength) {
        this.queueBurst('auroraStrength', strength);
    }

    onLineClear(lineCount, qualityConfig) {
        const lines = Math.max(1, Number(lineCount) || 1);
        const comboEffects = qualityConfig?.comboEffects ?? {};

        this.linePulse = Math.min(1.5, this.linePulse + (lines * 0.3));

        const fireflyMultiplier = comboEffects.fireflyMultiplier ?? 0;
        const sporesMultiplier = comboEffects.sporesMultiplier ?? 0;
        const fireflyCount = lines >= 2 ? Math.ceil(lines * 3 * fireflyMultiplier) : 0;
        const sporesCount = Math.ceil(lines * 4 * sporesMultiplier);
        const enchantedLeafCount = lines >= 3 ? lines * 2 : 0;

        this.mushroomPulse = Math.min(2.8, this.mushroomPulse + (lines * 0.5));
        this.moonbeamPulse = Math.min(2.5, this.moonbeamPulse + (lines * 0.42));
        this.atmospherePulse = Math.min(2.4, this.atmospherePulse + (lines * 0.28));

        this.queueBurst('fireflies', fireflyCount);
        this.queueBurst('spores', sporesCount);
        this.queueBurst('enchantedLeaves', enchantedLeafCount);

        return {
            mushroomIntensity: lines,
            moonbeamIntensity: lines,
            fireflyCount,
            sporesCount,
            enchantedLeafCount,
        };
    }

    onCombo(comboCount, qualityConfig) {
        const combo = Math.max(1, Number(comboCount) || 1);
        const comboEffects = qualityConfig?.comboEffects ?? {};

        this.comboEnergy = Math.min(2.5, this.comboEnergy + (combo * 0.22));

        const wispsMultiplier = comboEffects.wispsMultiplier ?? 0;
        const wispCount = Math.ceil(combo * 2 * wispsMultiplier);
        const sparkleCount = Math.min(combo * 2, 10);
        const runesCount = combo >= 4 ? Math.min(combo * 2, 8) : 0;
        const enableAurora = combo >= 3 && comboEffects.auroraEnabled === true;
        const enableShootingStars = combo >= 5 && comboEffects.shootingStarsEnabled === true;
        const shootingStarCount = enableShootingStars ? Math.min(combo, 6) : 0;
        const mistCount = Math.max(1, Math.floor(combo * 0.7));

        this.wildlifePulse = Math.min(2.7, this.wildlifePulse + (combo * 0.32));
        this.mushroomPulse = Math.min(2.8, this.mushroomPulse + (combo * 0.12));
        this.moonbeamPulse = Math.min(2.5, this.moonbeamPulse + (combo * 0.16));
        this.atmospherePulse = Math.min(2.5, this.atmospherePulse + (combo * 0.3));

        this.queueBurst('wisps', wispCount);
        this.queueBurst('sparkles', sparkleCount);
        this.queueBurst('runes', runesCount);
        this.queueBurst('mist', mistCount);
        this.queueBurst('shootingStars', shootingStarCount);
        if (enableAurora) {
            this.setAuroraStrength(combo);
        }

        return {
            combo,
            wispCount,
            enableAurora,
            enableShootingStars,
            sparkleCount,
            mistCount,
        };
    }

    onPieceLock(payload = {}) {
        this.pieceLockPulse = Math.min(1.0, this.pieceLockPulse + 0.4);
        this.mushroomPulse = Math.min(2.8, this.mushroomPulse + 0.15);
        this.moonbeamPulse = Math.min(2.5, this.moonbeamPulse + 0.1);
        this.atmospherePulse = Math.min(2.5, this.atmospherePulse + 0.16);

        const origin = resolveMoonlitPieceLockOrigin(payload);
        const sparkleCount = 1;
        const mistCount = 1;

        this.queueBurst('sparkles', sparkleCount, origin);
        this.queueBurst('mist', mistCount, origin);

        return {
            sparkleCount,
            mistCount,
            origin: cloneOrigin(origin),
        };
    }

    drainParticleBursts() {
        const bursts = this.pendingBursts.map(({ name, amount, origin }) => ({
            name,
            amount,
            origin: cloneOrigin(origin),
        }));
        this.pendingBursts = [];
        return bursts;
    }

    getSignals() {
        return {
            linePulse: this.linePulse,
            comboEnergy: this.comboEnergy,
            pieceLockPulse: this.pieceLockPulse,
            mushroomPulse: this.mushroomPulse,
            moonbeamPulse: this.moonbeamPulse,
            wildlifePulse: this.wildlifePulse,
            atmospherePulse: this.atmospherePulse,
            time: this.time,
        };
    }
}
