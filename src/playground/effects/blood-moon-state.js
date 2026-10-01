/** Shared, renderer-independent composition and bounded event envelopes. */

export const BLOOD_MOON_TIERS = Object.freeze({
    Minimal: Object.freeze({
        stars: 450, motes: 35, sparks: 180, surfaceSize: 512,
    }),
    Low: Object.freeze({
        stars: 900, motes: 70, sparks: 300, surfaceSize: 512,
    }),
    Medium: Object.freeze({
        stars: 1500, motes: 130, sparks: 600, surfaceSize: 1024,
    }),
    High: Object.freeze({
        stars: 2200, motes: 240, sparks: 1000, surfaceSize: 1024,
    }),
    Ultra: Object.freeze({
        stars: 3000, motes: 360, sparks: 1400, surfaceSize: 2048,
    }),
    Extreme: Object.freeze({
        stars: 4000, motes: 500, sparks: 1800, surfaceSize: 2048,
    }),
});

const EMPTY = Object.freeze({});
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);

/**
 * x/y are normalized from the bottom left; radius is a fraction of viewport height.
 * Rectangles arrive in CSS pixels from the top left. This runs on resize, not per frame.
 * A fully occupied viewport yields a zero-radius moon instead of covering the board.
 */
export function resolveBloodMoonLayout(width, height, rects = []) {
    const w = Math.max(1, finite(width, 1));
    const h = Math.max(1, finite(height, 1));
    const aspect = w / h;
    const portrait = aspect < 0.9;
    const edge = Math.min(0.02, aspect * 0.04);
    const desiredRadius = Math.min(portrait ? 0.14 : 0.23, (Math.min(aspect, 1) - edge * 2) * 0.5);
    const desiredX = clamp(
        (portrait ? 0.72 : 0.235) * aspect,
        desiredRadius + edge,
        aspect - desiredRadius - edge,
    );
    const desiredY = portrait ? 0.82 : 0.62;
    const obstacles = [];
    if (Array.isArray(rects)) {
        for (const rect of rects) {
            if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)
                || !Number.isFinite(rect.right) || !Number.isFinite(rect.bottom)) continue;
            const left = clamp(rect.left / h, 0, aspect);
            const right = clamp(rect.right / h, 0, aspect);
            const bottom = clamp(1 - rect.bottom / h, 0, 1);
            const top = clamp(1 - rect.top / h, 0, 1);
            if (right > left && top > bottom) {
                obstacles.push({
                    left, right, bottom, top,
                });
            }
        }
    }

    let bestX = desiredX;
    let bestY = desiredY;
    let bestRadius = 0;
    let bestScore = -Infinity;
    const consider = (rawX, rawY) => {
        const x = clamp(rawX, edge, aspect - edge);
        const y = clamp(rawY, edge, 1 - edge);
        let radius = Math.min(desiredRadius, x - edge, aspect - x - edge, y - edge, 1 - y - edge);
        for (const rect of obstacles) {
            const dx = Math.max(rect.left - x, 0, x - rect.right);
            const dy = Math.max(rect.bottom - y, 0, y - rect.top);
            radius = Math.min(radius, Math.max(0, Math.hypot(dx, dy) - 0.014));
        }
        // Keep a readable disk, then prefer the intended upper-side composition.
        const score = radius * 8 - Math.hypot((x - desiredX) / Math.max(aspect, 1), y - desiredY) * 0.3;
        if (score > bestScore) {
            bestScore = score;
            bestX = x;
            bestY = y;
            bestRadius = radius;
        }
    };

    consider(desiredX, desiredY);
    if (bestRadius < desiredRadius - 1e-8) {
        // Obstacle-aligned candidates preserve the intended moon size in narrow side lanes.
        const clearance = desiredRadius + 0.014;
        for (const rect of obstacles) {
            consider(rect.left - clearance, desiredY);
            consider(rect.right + clearance, desiredY);
            consider(desiredX, rect.bottom - clearance);
            consider(desiredX, rect.top + clearance);
            consider(rect.left - clearance, rect.bottom - clearance);
            consider(rect.right + clearance, rect.top + clearance);
        }
        // Bounded search also handles several boards and gaps smaller than the hero disk.
        for (let yi = 0; yi <= 20; yi++) {
            for (let xi = 0; xi <= 24; xi++) {
                consider(edge + (aspect - edge * 2) * (xi / 24), edge + (1 - edge * 2) * (yi / 20));
            }
        }
    }
    return { x: bestX / aspect, y: bestY, radius: Math.max(0, bestRadius) };
}

/**
 * Four independent lunar halos, one corona wave and an envelope for pooled bursts.
 * Events within an update merge by strength; combo decorates the same clear.
 * No event objects, timers, queues, or particle allocations are created here.
 */
export class BloodMoonReactions {
    constructor(options = EMPTY) {
        this._reducedMotion = false;
        this.lunarPulses = Array.from({ length: 4 }, () => ({
            age: Infinity, duration: 1.25, strength: 0, combo: 0,
        }));
        this.reset();
        this.reducedMotion = options?.reducedMotion === true;
    }

    get reducedMotion() { return this._reducedMotion; }

    set reducedMotion(value) {
        this._reducedMotion = value === true;
        if (this._reducedMotion) {
            this._clearLunarPulses();
            this.waveAge = Infinity;
            this.waveStrength = 0;
            this.burstAge = Infinity;
            this.burst = 0;
            this.pulse = Math.min(this.pulse, 0.18);
            this.corona = Math.min(this.corona, 0.24);
            this.starBoost = Math.min(this.starBoost, 0.1);
            this.impact = 0;
        }
    }

    get lunarEnergy() {
        let energy = 0;
        for (const pulse of this.lunarPulses) {
            if (pulse.age < pulse.duration) {
                energy += Math.sin((pulse.age / pulse.duration) * Math.PI)
                    * pulse.strength * (0.42 + pulse.combo * 0.45);
            }
        }
        return Math.min(1.8, energy);
    }

    reset() {
        this.time = 0;
        this.pulse = 0;
        this.impact = 0;
        this.corona = 0;
        this.starBoost = 0;
        this.burst = 0;
        this.waveAge = Infinity;
        this.waveStrength = 0;
        this.burstAge = Infinity;
        this._clearLunarPulses();
        this._clearFrame();
    }

    _clearLunarPulses() {
        for (const pulse of this.lunarPulses) {
            pulse.age = Infinity;
            pulse.duration = 1.25;
            pulse.strength = 0;
            pulse.combo = 0;
        }
        this._lunarSlot = -1;
    }

    _cueLunarPulse(strength, combo, duration) {
        if (this._lunarSlot < 0) {
            let shortestRemaining = Infinity;
            for (let i = 0; i < this.lunarPulses.length; i++) {
                const candidate = this.lunarPulses[i];
                if (candidate.age === Infinity) {
                    this._lunarSlot = i;
                    break;
                }
                const remaining = candidate.duration - candidate.age;
                if (remaining < shortestRemaining) {
                    shortestRemaining = remaining;
                    this._lunarSlot = i;
                }
            }
            const pulse = this.lunarPulses[this._lunarSlot];
            pulse.age = 0;
            pulse.strength = 0;
            pulse.combo = 0;
            pulse.duration = 0;
        }
        // One lock/clear/combo chain shares its halo without rewinding older rings.
        const pulse = this.lunarPulses[this._lunarSlot];
        pulse.strength = Math.max(pulse.strength, strength);
        pulse.combo = Math.max(pulse.combo, combo);
        pulse.duration = Math.max(pulse.duration, duration);
    }

    _clearFrame() {
        this._cuePulse = 0;
        this._cueImpact = 0;
        this._cueCorona = 0;
        this._cueStars = 0;
        this._cueWave = 0;
        this._cueBurst = 0;
        this._comboGain = 0;
        this._waveCued = false;
        this._burstCued = false;
        this._lunarSlot = -1;
    }

    cue(kind, payload = EMPTY) {
        const lines = clamp(Math.floor(finite(payload?.lineCount ?? payload?.lines, 1)), 1, 4);
        const combo = clamp(Math.floor(finite(payload?.comboCount ?? payload?.combo, 1)), 1, 12);
        let pulse = 0;
        let impact = 0;
        let corona = 0;
        let stars = 0;
        let wave = 0;
        let burst = 0;
        let lunarStrength = 0;
        let lunarCombo = 0;
        let lunarDuration = 1.25;
        switch (kind) {
        case 'lock':
            pulse = 0.18;
            corona = 0.16;
            stars = 0.62;
            impact = 0.3;
            lunarStrength = 1;
            lunarCombo = 0.12;
            break;
        case 'clear':
            pulse = 0.22 + lines * 0.11;
            corona = 0.32 + lines * 0.14;
            stars = 0.26 + lines * 0.12;
            impact = 0.25 + lines * 0.14;
            wave = 0.2 + lines * 0.135;
            burst = lines >= 2 ? 0.45 + lines * 0.12 : 0;
            lunarStrength = 0.85 + lines * 0.1;
            lunarCombo = lines / 8;
            lunarDuration = 1.25 + lines * 0.075;
            break;
        case 'combo':
            this._comboGain = Math.max(this._comboGain, 0.15 + combo * 0.055);
            pulse = 0.24 + combo * 0.07;
            corona = 0.45 + combo * 0.08;
            stars = 0.3 + combo * 0.06;
            impact = 0.25 + combo * 0.07;
            wave = 0.4 + combo * 0.04;
            burst = combo >= 2 ? 0.65 + combo * 0.055 : 0;
            lunarStrength = Math.min(1.35, 1 + combo * 0.04);
            lunarCombo = Math.min(1, combo / 8);
            lunarDuration = Math.min(1.9, 1.35 + combo * 0.05);
            break;
        case 'tetris':
            pulse = 0.55; corona = 0.75; stars = 0.5; wave = 0.9; burst = 0.85;
            impact = 0.8;
            lunarStrength = 1.25; lunarCombo = 0.55; lunarDuration = 1.65;
            break;
        case 'tspin':
            pulse = 0.48; corona = 0.65; stars = 0.4; wave = 0.8; burst = 0.7;
            impact = 0.7;
            lunarStrength = 1.2; lunarCombo = 0.5; lunarDuration = 1.55;
            break;
        case 'perfectClear':
            pulse = 0.7; corona = 0.95; stars = 0.68; wave = 1; burst = 1;
            impact = 1;
            lunarStrength = 1.35; lunarCombo = 1; lunarDuration = 1.9;
            break;
        case 'levelUp':
            pulse = 0.32; corona = 0.5; stars = 0.35; wave = 0.55;
            lunarStrength = 0.9; lunarCombo = 0.25; lunarDuration = 1.4;
            break;
        default:
            return 0;
        }
        this._cuePulse = Math.max(this._cuePulse, pulse);
        this._cueImpact = Math.max(this._cueImpact, impact);
        this._cueCorona = Math.max(this._cueCorona, corona);
        this._cueStars = Math.max(this._cueStars, stars);
        this._cueWave = Math.max(this._cueWave, wave);
        this._cueBurst = Math.max(this._cueBurst, burst);
        const gain = this.reducedMotion ? 0.24 : 1;
        this.impact = this.reducedMotion ? 0 : Math.max(this.impact, Math.min(1, this._cueImpact));
        this.pulse = Math.max(this.pulse, Math.min(1, this._cuePulse + this._comboGain * 0.2) * gain);
        this.corona = Math.max(this.corona, Math.min(1, this._cueCorona + this._comboGain * 0.3) * gain);
        this.starBoost = Math.max(
            this.starBoost,
            Math.min(1, this._cueStars + this._comboGain * 0.2) * (this.reducedMotion ? 0.12 : 1),
        );
        if (this.reducedMotion) return 0;
        this._cueLunarPulse(lunarStrength, lunarCombo, lunarDuration);
        if (this._cueWave > 0) {
            if (!this._waveCued) {
                this.waveAge = 0;
                this.waveStrength = 0;
            }
            this._waveCued = true;
            this.waveStrength = Math.max(this.waveStrength, Math.min(1, this._cueWave + this._comboGain * 0.25));
        }
        if (this._cueBurst > 0) {
            if (!this._burstCued) this.burstAge = 0;
            this._burstCued = true;
            this.burst = Math.max(this.burst, Math.min(1, this._cueBurst + this._comboGain * 0.15));
        }
        return burst > 0 ? this.burst : 0;
    }

    update(delta) {
        const dt = clamp(finite(delta, 0), 0, 60);
        this.time += dt;
        this.pulse *= Math.exp(-dt * 2.8);
        this.impact *= Math.exp(-dt * 12);
        this.corona *= Math.exp(-dt * 1.35);
        this.starBoost *= Math.exp(-dt * 1.6);
        this.burst *= Math.exp(-dt * 1.1);
        for (const pulse of this.lunarPulses) {
            if (pulse.age === Infinity) continue;
            pulse.age += dt;
            if (pulse.age >= pulse.duration) {
                pulse.age = Infinity;
                pulse.strength = 0;
                pulse.combo = 0;
            }
        }
        if (this.waveAge !== Infinity) {
            this.waveAge += dt;
            if (this.waveAge >= 4) {
                this.waveAge = Infinity;
                this.waveStrength = 0;
            }
        }
        if (this.burstAge !== Infinity) {
            this.burstAge += dt;
            if (this.burstAge >= 3.6) {
                this.burstAge = Infinity;
                this.burst = 0;
            }
        }
        this._clearFrame();
    }
}
