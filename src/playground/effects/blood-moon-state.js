/** Shared, renderer-independent composition and bounded event envelopes. */
import { GameplaySurge, Swell, softCeiling } from '../../themes/shared/gameplay-surge.js';

/**
 * starLayers: lattice star layers (1–2). milky: the Milky Way's two cloud reads. cellReach: the
 * salt cells' second Voronoi pass (1 = 3×3, cheaper and a little less exact; 2 = 5×5).
 * ripples: rings on the water at once. sparks: particles per combo shower.
 */
export const BLOOD_MOON_TIERS = Object.freeze({
    Minimal: Object.freeze({
        starLayers: 1, milky: false, cellReach: 1, ripples: 4, sparks: 180, surfaceSize: 512,
    }),
    Low: Object.freeze({
        starLayers: 1, milky: true, cellReach: 1, ripples: 4, sparks: 300, surfaceSize: 512,
    }),
    Medium: Object.freeze({
        starLayers: 2, milky: true, cellReach: 2, ripples: 6, sparks: 600, surfaceSize: 1024,
    }),
    High: Object.freeze({
        starLayers: 2, milky: true, cellReach: 2, ripples: 8, sparks: 1000, surfaceSize: 1024,
    }),
    Ultra: Object.freeze({
        starLayers: 2, milky: true, cellReach: 2, ripples: 8, sparks: 1400, surfaceSize: 2048,
    }),
    Extreme: Object.freeze({
        starLayers: 2, milky: true, cellReach: 2, ripples: 8, sparks: 1800, surfaceSize: 2048,
    }),
});

const EMPTY = Object.freeze({});
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);

/** Clearance between the moon's limb and a board, as a fraction of viewport height. */
const BOARD_CLEARANCE = 0.03;
/** Sky kept between the horizon and the moon's lower limb. */
const HORIZON_GAP = 0.05;

/**
 * x/y are normalized from the bottom left; radius is a fraction of viewport height; horizon is
 * where the salt flat meets the sky, also from the bottom. Rectangles arrive in CSS pixels from
 * the top left. This runs on resize, not per frame. The moon always stands clear above the
 * horizon; a fully occupied viewport yields a zero-radius moon instead of covering the board.
 */
export function resolveBloodMoonLayout(width, height, rects = []) {
    const w = Math.max(1, finite(width, 1));
    const h = Math.max(1, finite(height, 1));
    const aspect = w / h;
    const portrait = aspect < 0.9;
    const edge = Math.min(0.02, aspect * 0.04);
    const horizon = portrait ? 0.45 : 0.34;
    const lowest = horizon + HORIZON_GAP;
    const desiredRadius = Math.min(portrait ? 0.11 : 0.15, (Math.min(aspect, 1) - edge * 2) * 0.5);
    const desiredX = clamp(
        (portrait ? 0.72 : 0.22) * aspect,
        desiredRadius + edge,
        aspect - desiredRadius - edge,
    );
    const desiredY = portrait ? 0.83 : 0.7;
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
        const y = clamp(rawY, lowest, 1 - edge);
        let radius = Math.min(desiredRadius, x - edge, aspect - x - edge, y - lowest, 1 - y - edge);
        for (const rect of obstacles) {
            const dx = Math.max(rect.left - x, 0, x - rect.right);
            const dy = Math.max(rect.bottom - y, 0, y - rect.top);
            radius = Math.min(radius, Math.max(0, Math.hypot(dx, dy) - BOARD_CLEARANCE));
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
        const clearance = desiredRadius + BOARD_CLEARANCE;
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
                consider(edge + (aspect - edge * 2) * (xi / 24), lowest + (1 - edge - lowest) * (yi / 20));
            }
        }
    }
    return {
        x: bestX / aspect, y: bestY, radius: Math.max(0, bestRadius), horizon,
    };
}

/** Wave fronts round the moon at once: a cascade's waves race out as concentric rings. */
export const WAVE_FRONTS = 4;
/** A front's base speed, in viewport heights per second. */
export const WAVE_SPEED = 0.13;
/** Seconds a front lives; its light (exp(-1.5 age), the wave overlay's) is spent by then. */
const WAVE_LIFE = 4;
const WAVE_FADE = 1.5;

const smooth = (low, high, value) => {
    const t = clamp((value - low) / (high - low), 0, 1);
    return t * t * (3 - 2 * t);
};

/**
 * Everything the moon does with the game, renderer-free and on its own clock (`time`, the sum of
 * the update steps).
 *
 * Fast light (pulse, impact, corona, starBoost, burst) is a Swell each: a hit ADDS to what is
 * still lit and never restarts it, so a single after a quad can only lift the light and a run of
 * clears rides up under a soft ceiling. Events within one update merge by strength first (their
 * order never matters), then join the swell at the update's time.
 *
 * Four lunar halos, four wave fronts and the moments: the perfect clear's crown and its diamond
 * ring (the shadow steps aside for a beat), a T-spin's whirl, back-to-back's volcano flare, and
 * the exhale when a long chain ends. The true combo arrives from the theme's ComboTracker
 * (`combo`); COMBO events carry the cascade depth of one lock and are read as depth.
 *
 * The heat of play (src/themes/shared/gameplay-surge.js) is sampled every update into
 * `crescendo`: the standing numbers the world spends (corona floor and reach, the moon's blood,
 * the red sky, the water, the volcano, the meteor storm, the iris). Calm play leaves them at 0.
 * No event objects, timers, queues, or particle allocations are created here.
 */
export class BloodMoonReactions {
    constructor(options = EMPTY) {
        this._reducedMotion = false;
        this.lunarPulses = Array.from({ length: 4 }, () => ({
            age: Infinity, duration: 1.25, strength: 0, combo: 0,
        }));
        this.waves = Array.from({ length: WAVE_FRONTS }, () => ({
            age: Infinity, strength: 0, speed: WAVE_SPEED, width: 1,
        }));
        this._pulse = new Swell({ release: 1 / 2.8, ceiling: 1, knee: 0.7 });
        this._impact = new Swell({ release: 1 / 12, ceiling: 1, knee: 0.8 });
        this._corona = new Swell({ release: 1 / 1.35, ceiling: 1, knee: 0.7 });
        this._stars = new Swell({ release: 1 / 1.6, ceiling: 1, knee: 0.7 });
        this._burst = new Swell({ release: 1 / 1.1, ceiling: 1, knee: 0.75 });
        /** The perfect clear: the corona's crown, and the diamond ring as the shadow steps aside. */
        this.crown = new Swell({
            attack: 0.25, release: 2.4, ceiling: 1.2, knee: 0.9,
        });
        this.diamond = new Swell({
            attack: 0.3, release: 1.3, ceiling: 1, knee: 0.9,
        });
        /** A T-spin whirls the corona's fire; back-to-back wakes the volcano. */
        this.spin = new Swell({
            attack: 0.06, release: 0.9, ceiling: 1.6, knee: 1.1,
        });
        this.flare = new Swell({
            attack: 0.18, release: 1.8, ceiling: 1.3, knee: 1,
        });
        /** A long chain's end: the world breathes out. */
        this.exhale = new Swell({
            attack: 0.35, release: 2.2, ceiling: 1, knee: 0.8,
        });
        this.surge = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        this.crescendo = {
            warm: 0,
            hot: 0,
            fever: 0,
            crown: 0,
            exhale: 0,
            flare: 0,
            corona: 0,
            reach: 1,
            blood: 0,
            sky: 0,
            stars: 0,
            volcano: 0,
            water: 0,
            storm: 0,
            spin: 0,
            diamond: 0,
            iris: 1,
            punch: 0,
            chain: 0,
            towardMoon: 0,
            shower: 0,
        };
        this._frame = {
            lock: false,
            hardDrop: false,
            locked: false,
            lines: 0,
            cascade: 1,
            tspin: false,
            tspinLines: 0,
            b2b: false,
            perfect: false,
            levelUp: false,
        };
        this.reset();
        this.reducedMotion = options?.reducedMotion === true;
    }

    get reducedMotion() { return this._reducedMotion; }

    set reducedMotion(value) {
        this._reducedMotion = value === true;
        if (this._reducedMotion) {
            this._clearLunarPulses();
            this._clearWaves();
            this.burstAge = Infinity;
            this._hold(this._burst, '_frameBurst', 0);
            this._hold(this._pulse, '_framePulse', 0.18);
            this._hold(this._corona, '_frameCorona', 0.24);
            this._hold(this._stars, '_frameStars', 0.1);
            this._hold(this._impact, '_frameImpact', 0);
            this.diamond.reset();
            this.spin.reset();
        }
    }

    /** What a fast swell shows now: its history and this update's cues. */
    _read(swell, pending) {
        return softCeiling(swell.rawAt(this.time) + pending, swell.knee, swell.ceiling);
    }

    /** Keep at most `cap` of what a swell shows (reduced motion). */
    _hold(swell, key, cap) {
        const value = this._read(swell, this[key]);
        swell.reset();
        this[key] = 0;
        if (cap > 0 && value > 0) swell.hit(Math.min(value, cap), this.time);
    }

    get pulse() { return this._read(this._pulse, this._framePulse); }

    get impact() { return this._read(this._impact, this._frameImpact); }

    get corona() { return this._read(this._corona, this._frameCorona); }

    get starBoost() { return this._read(this._stars, this._frameStars); }

    get burst() { return this._read(this._burst, this._frameBurst); }

    /** The newest wave front's age (Infinity when it has gone) and strength. */
    get waveAge() {
        const front = this.waves[this._newestFront];
        return front ? front.age : Infinity;
    }

    get waveStrength() {
        const front = this.waves[this._newestFront];
        return front && front.age !== Infinity ? front.strength : 0;
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
        for (const swell of [this._pulse, this._impact, this._corona, this._stars, this._burst,
            this.crown, this.diamond, this.spin, this.flare, this.exhale]) swell.reset();
        this.surge.reset();
        this.heat.punch = 0;
        this.heat.level = 0;
        this.heat.fever = 0;
        this.heat.stage = 0;
        const c = this.crescendo;
        for (const key of Object.keys(c)) c[key] = 0;
        c.reach = 1;
        c.iris = 1;
        /** The true combo (consecutive clearing locks), and the chain as shown (it eases out). */
        this.combo = 0;
        this.chain = 0;
        this.burstAge = Infinity;
        this._clearLunarPulses();
        this._clearWaves();
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

    _clearWaves() {
        for (const front of this.waves) {
            front.age = Infinity;
            front.strength = 0;
            front.speed = WAVE_SPEED;
            front.width = 1;
        }
        this._newestFront = -1;
        this._waveSlot = -1;
        this._twinSlot = -1;
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

    /**
     * A front for a new wave: a free one, else the one with the least light left (never the
     * one this update already lit, `except`). The others keep racing out.
     */
    _takeFront(except = -1) {
        let best = -1;
        let least = Infinity;
        for (let i = 0; i < this.waves.length; i++) {
            if (i === except) continue;
            const front = this.waves[i];
            if (front.age === Infinity) {
                best = i;
                break;
            }
            const left = front.strength * Math.exp(-Math.max(0, front.age) * WAVE_FADE);
            if (left < least) {
                least = left;
                best = i;
            }
        }
        const front = this.waves[best];
        front.age = 0;
        front.strength = 0;
        front.speed = WAVE_SPEED;
        front.width = 1;
        return best;
    }

    _clearFrame() {
        this._cuePulse = 0;
        this._cueImpact = 0;
        this._cueCorona = 0;
        this._cueStars = 0;
        this._cueWave = 0;
        this._cueBurst = 0;
        this._cueSpeed = 1;
        this._cueWidth = 1;
        this._framePulse = 0;
        this._frameImpact = 0;
        this._frameCorona = 0;
        this._frameStars = 0;
        this._frameBurst = 0;
        this._crownHit = 0;
        this._spinHit = 0;
        this._flareHit = 0;
        this._comboGain = 0;
        this._waveSlot = -1;
        this._twinSlot = -1;
        this._burstCued = false;
        this._lunarSlot = -1;
        const f = this._frame;
        f.lock = false;
        f.hardDrop = false;
        f.locked = false;
        f.lines = 0;
        f.cascade = 1;
        f.tspin = false;
        f.tspinLines = 0;
        f.b2b = false;
        f.perfect = false;
        f.levelUp = false;
    }

    /** The true combo after a clear (the theme's ComboTracker); 0 when a chain broke. */
    setCombo(value) {
        const combo = Math.floor(finite(Number(value), 0));
        this.combo = clamp(combo, 0, 99);
    }

    /** A piece locked (bookkeeping only: a lock that clears nothing ends the chain). */
    noteLock() {
        this._frame.locked = true;
    }

    cue(kind, payload = EMPTY) {
        const lines = clamp(Math.floor(finite(payload?.lineCount ?? payload?.lines, 1)), 1, 4);
        const depth = clamp(Math.floor(finite(payload?.comboCount ?? payload?.combo, 1)), 1, 12);
        const chain = Math.min(10, this.combo);
        const f = this._frame;
        let pulse = 0;
        let impact = 0;
        let corona = 0;
        let stars = 0;
        let wave = 0;
        let burst = 0;
        let speed = 1;
        let width = 1;
        let lunarStrength = 0;
        let lunarCombo = 0;
        let lunarDuration = 1.25;
        switch (kind) {
        case 'lock':
            f.lock = true;
            f.locked = true;
            pulse = 0.18;
            corona = 0.16;
            stars = 0.34;
            impact = 0.3;
            lunarStrength = 1;
            lunarCombo = 0.12;
            break;
        case 'hardDrop':
            // HARD_DROP arrives just before its PIECE_LOCK: the same lock, landing harder.
            f.hardDrop = true;
            pulse = 0.22;
            corona = 0.2;
            stars = 0.42;
            impact = 0.55;
            break;
        case 'clear':
            f.lines = Math.max(f.lines, lines);
            f.cascade = Math.max(f.cascade, clamp(Math.floor(finite(payload?.cascadeCount, 1)), 1, 12));
            pulse = 0.22 + lines * 0.11 + chain * 0.012;
            corona = 0.32 + lines * 0.14 + chain * 0.02;
            stars = 0.3 + lines * 0.12;
            impact = 0.25 + lines * 0.14;
            wave = 0.2 + lines * 0.135 + chain * 0.025;
            // From the third clear of a chain even a single throws embers.
            burst = lines >= 2 || chain >= 3 ? 0.45 + lines * 0.12 + chain * 0.02 : 0;
            lunarStrength = 0.85 + lines * 0.1;
            lunarCombo = Math.max(lines / 8, Math.min(1, chain / 10));
            lunarDuration = 1.25 + lines * 0.075;
            break;
        case 'combo':
            // COMBO is the cascade depth of one lock: each wave races out faster and wider.
            f.cascade = Math.max(f.cascade, depth);
            this._comboGain = Math.max(this._comboGain, 0.15 + depth * 0.055);
            pulse = 0.24 + depth * 0.07;
            corona = 0.45 + depth * 0.08;
            stars = 0.3 + depth * 0.06;
            impact = 0.25 + depth * 0.07;
            wave = 0.4 + depth * 0.04;
            burst = depth >= 2 ? 0.65 + depth * 0.055 : 0;
            speed = 1 + (depth - 1) * 0.12;
            width = 1 + (depth - 1) * 0.3;
            lunarStrength = Math.min(1.35, 1 + depth * 0.04);
            lunarCombo = Math.min(1, depth / 8);
            lunarDuration = Math.min(1.9, 1.35 + depth * 0.05);
            break;
        case 'tetris':
            f.lines = 4;
            f.cascade = Math.max(f.cascade, clamp(Math.floor(finite(payload?.cascadeCount, 1)), 1, 12));
            pulse = 0.62 + chain * 0.012;
            corona = 0.9;
            stars = 0.6;
            wave = 0.95;
            burst = 0.9;
            impact = 0.85;
            width = 1.25;
            lunarStrength = 1.25; lunarCombo = Math.max(0.55, Math.min(1, chain / 10)); lunarDuration = 1.65;
            break;
        case 'tspin': {
            // A T-spin whirls the corona's fire; with lines it is a big clear's answer too.
            const spun = clamp(Math.floor(finite(payload?.lineCount ?? payload?.lines, 1)), 0, 4);
            f.tspin = true;
            f.tspinLines = Math.max(f.tspinLines, spun);
            this._spinHit = Math.max(this._spinHit, 0.45 + spun * 0.25);
            if (spun === 0) {
                pulse = 0.2; corona = 0.3; stars = 0.2; impact = 0.2;
                lunarStrength = 0.9; lunarCombo = 0.2; lunarDuration = 1.3;
            } else {
                pulse = 0.4 + spun * 0.06; corona = 0.6 + spun * 0.08; stars = 0.3 + spun * 0.06;
                wave = 0.65 + spun * 0.1; burst = 0.6 + spun * 0.08; impact = 0.55 + spun * 0.1;
                lunarStrength = 1.2; lunarCombo = 0.5; lunarDuration = 1.55;
            }
            break;
        }
        case 'b2b':
            // Back-to-back: a twin front and the volcano wakes (see below).
            f.b2b = true;
            this._flareHit = 1;
            pulse = 0.3; corona = 0.55; stars = 0.3; wave = 0.7; impact = 0.4;
            lunarStrength = 1.1; lunarCombo = 0.6; lunarDuration = 1.6;
            break;
        case 'perfectClear':
            // Lands ~360 ms after its quad, in a frame of its own: a crown on the clear still
            // playing (the quad's front and shower keep going), never a second clear.
            f.perfect = true;
            this._crownHit = 1;
            pulse = 0.7; corona = 1; stars = 0.8; wave = 1; burst = 1;
            impact = 1;
            width = 1.8;
            lunarStrength = 1.35; lunarCombo = 1; lunarDuration = 1.9;
            break;
        case 'levelUp':
            f.levelUp = true;
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
        this._cueSpeed = Math.max(this._cueSpeed, speed);
        this._cueWidth = Math.max(this._cueWidth, width);
        const gain = this.reducedMotion ? 0.24 : 1;
        this._frameImpact = this.reducedMotion ? 0 : Math.min(1, this._cueImpact);
        this._framePulse = Math.min(1, this._cuePulse + this._comboGain * 0.2) * gain;
        this._frameCorona = Math.min(1, this._cueCorona + this._comboGain * 0.3) * gain;
        this._frameStars = Math.min(1, this._cueStars + this._comboGain * 0.2) * (this.reducedMotion ? 0.12 : 1);
        if (this.reducedMotion) return 0;
        if (lunarStrength > 0) this._cueLunarPulse(lunarStrength, lunarCombo, lunarDuration);
        if (this._cueWave > 0) {
            // Each update's waves share one front; a later wave takes a front of its own, so the
            // fronts before it keep racing out instead of snapping back to the limb.
            if (this._waveSlot < 0) {
                this._waveSlot = this._takeFront(this._twinSlot);
                this._newestFront = this._waveSlot;
            }
            const front = this.waves[this._waveSlot];
            front.strength = Math.max(front.strength, Math.min(1, this._cueWave + this._comboGain * 0.25));
            front.speed = Math.max(front.speed, WAVE_SPEED * this._cueSpeed);
            front.width = Math.max(front.width, this._cueWidth);
        }
        if (kind === 'b2b' && this._twinSlot < 0) {
            // Its twin follows a beat behind, a little wider.
            this._twinSlot = this._takeFront(this._waveSlot);
            const twin = this.waves[this._twinSlot];
            twin.age = -0.16;
            twin.strength = 0.75;
            twin.speed = WAVE_SPEED * 1.1;
            twin.width = 1.4;
        }
        if (this._cueBurst > 0) {
            if (!this._burstCued) this.burstAge = 0;
            this._burstCued = true;
            this._frameBurst = Math.min(1, this._cueBurst + this._comboGain * 0.15);
        }
        return burst > 0 ? this.burst : 0;
    }

    /** Fold this update's cues into the swells and the surge at the update's time. */
    _commit() {
        const t = this.time;
        this._pulse.hit(this._framePulse, t);
        this._impact.hit(this._frameImpact, t);
        this._corona.hit(this._frameCorona, t);
        this._stars.hit(this._frameStars, t);
        this._burst.hit(this._frameBurst, t);
        this.crown.hit(this._crownHit, t);
        if (!this.reducedMotion) {
            this.diamond.hit(this._crownHit, t);
            this.spin.hit(this._spinHit, t);
        }
        this.flare.hit(this._flareHit, t);
        const f = this._frame;
        const { surge } = this;
        if (f.lock || f.hardDrop) surge.lock({ hardDrop: f.hardDrop }, t);
        if (f.lines > 0 || f.perfect || f.tspin || f.b2b) {
            // A cascade's later waves add a wave's weight each; only a lock's first clear is a
            // step of the combo. A late perfect clear or a zero-line T-spin weighs as a single.
            surge.clear({
                lines: f.lines > 0 ? f.lines : 1,
                cascade: f.cascade >= 2 ? 2 : 1,
                combo: f.lines > 0 && f.cascade < 2 ? this.combo : 1,
                tspin: f.tspin && f.tspinLines > 0,
                b2b: f.b2b,
                perfect: f.perfect,
            }, t);
        }
        if (f.levelUp) surge.levelUp(t);
        // A lock that cleared nothing ends the chain; a long one ends in a slow breath out.
        if (f.locked && f.lines === 0 && !f.perfect) {
            const chain = Math.max(this.combo, this.chain);
            if (chain >= 2.5) {
                const size = Math.min(1, 0.3 + chain * 0.07);
                this.exhale.hit(size, t);
                if (!this.reducedMotion) {
                    const front = this.waves[this._takeFront()];
                    front.strength = 0.3 + size * 0.35;
                    front.speed = WAVE_SPEED * 0.55;
                    front.width = 2.6;
                }
            }
            this.combo = 0;
        }
    }

    /** The heat of play, sampled once an update, and what the world makes of it. */
    _sampleCrescendo(dt) {
        const t = this.time;
        const s = this.surge.sample(t);
        const { heat } = this;
        heat.punch = s.punch;
        heat.level = s.level;
        heat.fever = s.fever;
        heat.stage = s.stage;
        // The chain as shown: up at once, easing out over a second or two when it breaks.
        const target = Math.min(12, this.combo);
        this.chain = target >= this.chain
            ? this.chain + (target - this.chain) * (1 - Math.exp(-dt * 10))
            : target + (this.chain - target) * Math.exp(-dt / 1.2);
        const warm = smooth(0.22, 0.6, s.level);
        const hot = smooth(0.45, 0.85, s.level);
        const { fever } = s;
        const crown = this.crown.valueAt(t);
        const exhale = this.exhale.valueAt(t);
        const flare = this.flare.valueAt(t);
        // Reduced motion: the light builds at half strength; nothing moves for it.
        const light = this.reducedMotion ? 0.5 : 1;
        const motion = this.reducedMotion ? 0 : 1;
        const c = this.crescendo;
        c.warm = warm;
        c.hot = hot;
        c.fever = fever;
        c.crown = crown;
        c.exhale = exhale;
        c.flare = flare;
        c.corona = Math.min(0.85, 0.2 * warm + 0.12 * hot + 0.3 * fever + 0.3 * crown + 0.12 * exhale) * light;
        c.reach = 1 + (0.3 * warm + 0.25 * hot + 0.55 * fever + 0.45 * crown + 0.3 * exhale) * light;
        c.blood = Math.min(1, 0.3 * warm + 0.25 * hot + 0.45 * fever + 0.2 * crown) * light;
        c.sky = Math.min(1.2, 0.2 * warm + 0.3 * hot + 0.5 * fever + 0.3 * crown + 0.2 * exhale) * light;
        c.stars = (0.15 * warm + 0.2 * hot + 0.3 * fever) * light;
        c.volcano = Math.min(1.6, 0.1 * warm + 0.3 * hot + 0.6 * fever + 0.9 * flare + 0.3 * crown) * light;
        c.water = (0.25 * warm + 0.35 * hot + 0.55 * fever + 0.3 * crown) * motion;
        c.storm = (0.5 * hot + 1.3 * fever + 0.8 * crown) * motion;
        c.spin = this.spin.valueAt(t) * motion;
        c.diamond = this.diamond.valueAt(t) * motion;
        c.iris = 1 - 0.08 * smooth(0.2, 0.9, s.level) - 0.04 * fever;
        c.punch = s.punch;
        c.chain = this.chain;
        c.towardMoon = Math.min(0.85, 0.5 * hot + 0.35 * fever);
        c.shower = Math.min(1, 0.35 * warm + 0.3 * hot + 0.35 * fever);
    }

    update(delta) {
        const dt = clamp(finite(delta, 0), 0, 60);
        this._commit();
        this.time += dt;
        for (const pulse of this.lunarPulses) {
            if (pulse.age === Infinity) continue;
            pulse.age += dt;
            if (pulse.age >= pulse.duration) {
                pulse.age = Infinity;
                pulse.strength = 0;
                pulse.combo = 0;
            }
        }
        for (const front of this.waves) {
            if (front.age === Infinity) continue;
            front.age += dt;
            if (front.age >= WAVE_LIFE) {
                front.age = Infinity;
                front.strength = 0;
            }
        }
        if (this.burstAge !== Infinity) {
            this.burstAge += dt;
            if (this.burstAge >= 3.6) this.burstAge = Infinity;
        }
        this._sampleCrescendo(dt);
        this._clearFrame();
    }
}
