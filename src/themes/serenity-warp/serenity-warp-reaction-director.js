/**
 * Serenity Warp — whole-scene reaction director (renderer-free).
 *
 * The four best-in-class themes (Vesper Chrysalis, Starlight, Electric Dreams V3,
 * Blood Moon) all share one mechanism Serenity Warp lacked: a single eased scalar the
 * ENTIRE scene reacts to, so a combo surges the whole world together instead of pasting
 * a decal on a plane. This module is that brain — pure, testable, owns no Three.js.
 *
 * Composition (Vesper's pattern):
 *   sBaseline  — persistent world-energy, raised by perfect clears / level ups, slow decay
 *   sCombo     — ACCUMULATE-and-HOLD combo energy (max, capped), decays over seconds
 *   sFlare     — fast transient spikes from the dominant per-frame event
 *   sEased     — critically-damped ease toward clamp01(sBaseline + sCombo + sFlare)
 *
 * The theme reads getReactionState() each frame and pushes { surge, bloom, chroma } into
 * the intro renderer's opt-in additive levers (default 0 → intro unchanged).
 */

export const REACTION_EVENT_DOMINANCE = Object.freeze({
    perfectClear: 6,
    tspin: 5,
    lineClear: 4,
    b2b: 3,
    combo: 2,
    pieceLock: 1,
});

// Transient flare contribution per event (the "kick"). Locks are deliberately tiny —
// magnitude is reserved for clears/combos (every reference theme keeps locks subtle).
const EVENT_FLARE = Object.freeze({
    pieceLock: 0.05,
    lineClear: 0.14,
    tspin: 0.26,
    b2b: 0.12,
    perfectClear: 0.5,
    combo: 0,
});

const COMBO_PER_STEP = 0.075;
const COMBO_CAP = 0.62;
const BASELINE_PERFECT_CLEAR = 0.28;
const BASELINE_LEVEL_UP = 0.14;
const BASELINE_CAP = 0.5;

const SFLARE_CAP = 0.9;
const REDUCED_MOTION_SURGE = 0.34;
const REDUCED_MOTION_CHROMA = 0.5;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
    return clamp(value, 0, 1);
}

function finite(value, fallback = 0) {
    return Number.isFinite(value) ? Number(value) : fallback;
}

/** value → value·e^(−rate·dt); frame-rate independent decay toward zero. */
export function decayScalar(value, dt, rate) {
    if (!(dt > 0) || !(rate > 0)) return value;
    return value * Math.exp(-rate * dt);
}

/** Critically-damped ease of current toward target; frame-rate independent. */
export function easeToward(current, target, dt, rate) {
    if (!(dt > 0)) return current;
    return current + (target - current) * Math.min(1, dt * rate);
}

/**
 * Accumulate-and-HOLD: combo energy climbs with the live chain and never rewinds
 * mid-decay (a fresh count can only raise, never yank down the still-decaying value).
 */
export function accumulateComboBoost(current, count, perStep = COMBO_PER_STEP, cap = COMBO_CAP) {
    const target = clamp(finite(count) * perStep, 0, cap);
    return clamp(Math.max(finite(current), target), 0, cap);
}

/** A non-monotonic combo count (chain broke / new chain) resets the gate. */
export function isComboChainBreak(previousCount, count) {
    return finite(count) < finite(previousCount);
}

/**
 * Collapse a same-frame set of pending events to the single DOMINANT one
 * (perfectClear > tspin > lineClear > b2b > combo > pieceLock). Returns null if empty.
 */
export function pickDominantEvent(events) {
    if (!Array.isArray(events) || events.length === 0) return null;
    let best = null;
    let bestRank = -Infinity;
    for (let i = 0; i < events.length; i += 1) {
        const rank = REACTION_EVENT_DOMINANCE[events[i]?.kind] ?? 0;
        if (rank > bestRank) {
            bestRank = rank;
            best = events[i];
        }
    }
    return best;
}

export class SerenityWarpReactionDirector {
    constructor({ reducedMotion = false, intensity = 1 } = {}) {
        this.reducedMotion = Boolean(reducedMotion);
        this.intensity = clamp(finite(intensity, 1), 0, 2);
        this.sBaseline = 0;
        this.sCombo = 0;
        this.sFlare = 0;
        this.sEased = 0;
        this.lastComboCount = 0;
        this.pending = [];
        this.reaction = {
            surge: 0, bloom: 0, chroma: 0, energy: 0,
        };
    }

    setReducedMotion(enabled) {
        this.reducedMotion = Boolean(enabled);
    }

    setIntensity(intensity) {
        this.intensity = clamp(finite(intensity, 1), 0, 2);
    }

    configure({ reducedMotion, intensity } = {}) {
        if (reducedMotion !== undefined) this.setReducedMotion(reducedMotion);
        if (intensity !== undefined) this.setIntensity(intensity);
    }

    /**
     * Record a gameplay event. Contributions are BUFFERED and resolved on the next
     * update(dt) so several events in one frame collapse to a single dominant flare
     * (no double-stacking a combo and its own line-clear).
     */
    pulse(kind, payload = {}) {
        const normalized = normalizeKind(kind);
        if (!normalized) return;
        this.pending.push({ kind: normalized, payload });
    }

    _resolvePending() {
        if (this.pending.length === 0) return;

        // Combo drives the held energy directly (accumulate; chain-break resets).
        for (let i = 0; i < this.pending.length; i += 1) {
            const { kind, payload } = this.pending[i];
            if (kind === 'combo') {
                const count = Math.max(0, Math.floor(finite(payload.comboCount)));
                if (isComboChainBreak(this.lastComboCount, count)) this.sCombo = 0;
                this.lastComboCount = count;
                this.sCombo = accumulateComboBoost(this.sCombo, count);
            } else if (kind === 'perfectClear') {
                this.sBaseline = clamp(this.sBaseline + BASELINE_PERFECT_CLEAR, 0, BASELINE_CAP);
            } else if (kind === 'levelUp') {
                this.sBaseline = clamp(this.sBaseline + BASELINE_LEVEL_UP, 0, BASELINE_CAP);
            }
        }

        // One dominant transient flare per frame (no summing simultaneous events).
        const dominant = pickDominantEvent(this.pending);
        if (dominant) {
            const flare = flareForEvent(dominant);
            this.sFlare = clamp(Math.max(this.sFlare, flare), 0, SFLARE_CAP);
        }
        this.pending.length = 0;
    }

    update(dt) {
        const step = clamp(finite(dt, 0), 0, 0.1);
        this._resolvePending();

        this.sCombo = decayScalar(this.sCombo, step, 0.7);
        this.sFlare = decayScalar(this.sFlare, step, 1.6);
        this.sBaseline = decayScalar(this.sBaseline, step, 0.06);

        const target = clamp01(this.sBaseline + this.sCombo + this.sFlare);
        this.sEased = easeToward(this.sEased, target, step, 3.2);

        const motionScale = this.reducedMotion ? REDUCED_MOTION_SURGE : 1;
        const chromaScale = this.reducedMotion ? REDUCED_MOTION_CHROMA : 1;
        const gain = this.intensity;

        this.reaction.energy = this.sEased;
        // Surge rides the warp machinery — capped below a full warp-out so it kicks, not dismisses.
        this.reaction.surge = clamp(this.sEased * 0.62 * motionScale * gain, 0, 0.72);
        this.reaction.bloom = clamp(this.sEased * 0.9 * gain, 0, 1.4);
        this.reaction.chroma = clamp((this.sEased * 0.55 + this.sFlare * 0.35) * chromaScale * gain, 0, 1.3);
        return this.reaction;
    }

    getReactionState() {
        return this.reaction;
    }

    reset() {
        this.sBaseline = 0;
        this.sCombo = 0;
        this.sFlare = 0;
        this.sEased = 0;
        this.lastComboCount = 0;
        this.pending.length = 0;
        this.reaction = {
            surge: 0, bloom: 0, chroma: 0, energy: 0,
        };
    }

    dispose() {
        this.pending.length = 0;
    }
}

function normalizeKind(kind) {
    const key = String(kind || '').replace(/[\s_-]/g, '').toLowerCase();
    switch (key) {
    case 'piecelock':
    case 'lock':
        return 'pieceLock';
    case 'lineclear':
        return 'lineClear';
    case 'combo':
        return 'combo';
    case 'tspin':
        return 'tspin';
    case 'b2b':
        return 'b2b';
    case 'perfectclear':
        return 'perfectClear';
    case 'levelup':
        return 'levelUp';
    default:
        return null;
    }
}

function flareForEvent({ kind, payload }) {
    if (kind === 'lineClear') {
        const lineCount = clamp(Math.floor(finite(payload.lineCount, 1)), 1, 4);
        return EVENT_FLARE.lineClear + (lineCount - 1) * 0.07; // Tetris kicks harder
    }
    return EVENT_FLARE[kind] ?? 0;
}

export default SerenityWarpReactionDirector;
