/**
 * Murmuration — the show: what the swarm does when the board is played.
 *
 * Renderer-free and timer-free. Gameplay arrives as the play director's resolved calls
 * (`lock`, `clear`, `combo`, `levelUp`) plus `gameOver` / `gameStart`; this class turns
 * them into impulses on the simulation, formations, colour, and the handful of numbers
 * the sky, the lens and the post stack read each frame. Anything delayed sits in a queue
 * keyed on the show's own clock and runs from `update()`, so a capture can replay a
 * moment exactly and stopping the theme leaves nothing scheduled.
 *
 *   LOCK          a ring of light leaves the piece and crosses the swarm
 *   HARD DROP     the same, harder and faster, and the lens takes the hit
 *   CLEAR 1–3     a tall ellipse whose sides sweep outward across both wings
 *   QUAD          two rings, a swirl, the sky lights up, the swarm gathers into a shape
 *   T-SPIN        two counter-turning eddies and a knot
 *   PERFECT CLEAR the swarm is drawn in to a point, then blooms
 *   COMBO         the gyre spins up and the swarm warms toward gold; long chains draw shapes
 *   LEVEL UP      the palette steps on
 *   GAME OVER     a heart, held until the next run
 */
import { IMPULSE_TYPE } from '../sim/fluid-particles.js';
import { PALETTE_LEVEL_STEP, PALETTE_SPAN, samplePalette } from './swarm-palette.js';

/**
 * Every formation a gameplay moment may roll. 'free' is the release state and 'heart' is
 * kept for game over, so neither is in the pool.
 */
export const RANDOM_SHAPE_POOL = Object.freeze([
    'sphere', 'torus', 'helix', 'galaxy', 'cube', 'star', 'wave', 'butterfly',
    'ring', 'tetromino', 'tetrominoSet', 'pyramid', 'octahedron', 'hexagon',
    'sunflower', 'infinity', 'trefoil', 'vortex', 'wavySphere', 'lightning',
    'snowflake', 'lotus', 'crescent', 'crystalShard', 'mobius', 'comet', 'nautilus',
]);

/** Solids turn all the way round; everything else faces the camera and only sways. */
const TURNING_SHAPES = new Set([
    'sphere', 'helix', 'cube', 'pyramid', 'octahedron', 'wavySphere', 'crystalShard', 'trefoil', 'mobius',
]);
const KNOT_SHAPES = Object.freeze(['trefoil', 'infinity', 'mobius', 'vortex']);
const BLOOM_SHAPES = Object.freeze(['lotus', 'sunflower', 'snowflake']);

/** A figure drawn for a play: the dust keeps flowing behind it. */
const EVENT_SHAPE = Object.freeze({ keepDust: true });

const AXIS_IN = Object.freeze({ x: 0, y: 0, z: 1 });
const AXIS_OUT = Object.freeze({ x: 0, y: 0, z: -1 });

const BASE_GYRE = 0.26;
const BASE_TURBULENCE = 0.6;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ease = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

export class SwarmShow {
    /**
     * @param {{
     *   sim: object, visual?: object|null, sky?: object|null, camera?: object|null,
     *   focal?: {x:number,y:number,z:number}, random?: () => number,
     *   locate?: (detail: object, row: number, u: number, out: {x:number,y:number,z:number}) => boolean,
     * }} parts
     *   `locate` maps a play-director detail to a world point on the focal plane. Without
     *   it (or when it returns false) every event starts at the focal point.
     */
    constructor({
        sim, visual = null, sky = null, camera = null, focal = null, random = Math.random, locate = null,
    }) {
        this.sim = sim;
        this.visual = visual;
        this.sky = sky;
        this.camera = camera;
        this.focal = { x: focal?.x ?? 0, y: focal?.y ?? 0, z: focal?.z ?? 0 };
        this.random = random;
        this.locate = locate;
        this.reducedMotion = false;

        this.time = 0;
        // The numbers the post stack reads. Punches decay within a couple of hundred ms.
        this.fx = {
            stageHeat: 0,
            comboIntensity: 0,
            comboPulse: 0,
            rewardPulse: 0,
            actProgress: 0,
            chromaPunch: 0,
            bloomPunch: 0,
            vignettePunch: 0,
        };
        // The swarm at rest; play adds to both.
        this.baseGyre = BASE_GYRE;
        this.baseTurbulence = BASE_TURBULENCE;
        this.simParams = { turbulence: BASE_TURBULENCE, gyre: BASE_GYRE };

        this.combos = new Map();
        this.comboCount = 0;
        this.heat = 0;
        this.heatTarget = 0;
        this.level = 1;
        this.palettePhase = 0;
        this.palettePhaseTarget = 0;
        this.skyFlash = 0;
        this.shapeColor = 0;

        this.shape = {
            name: 'free', level: 0, target: 0, until: 0, since: 0, priority: 0, turning: false,
        };
        this._lastShapePick = null;
        this._queue = [];
        this._point = { x: 0, y: 0, z: 0 };
        this._tint = [0, 0, 0];
        /** The swarm's middle hue right now (linear RGB), for anything that wants to match it. */
        this.haloTint = [0.45, 0.3, 1.0];
    }

    // ── helpers ─────────────────────────────────────────────────────────────────

    /** An impulse on the simulation, if there still is one (the fluid can be torn down). */
    _push(position, strength, dir, type, wave = null) {
        return this.sim?.pushImpulse?.(position, strength, dir, type, wave);
    }

    /** Run `fn` when the show's clock reaches now + delay (seconds). */
    after(delay, fn) {
        this._queue.push({ at: this.time + delay, fn });
    }

    _origin(detail, row, u) {
        const out = this._point;
        if (this.locate && this.locate(detail, row, u, out)) return out;
        out.x = this.focal.x; out.y = this.focal.y; out.z = this.focal.z;
        return out;
    }

    _focalPoint() {
        const out = this._point;
        out.x = this.focal.x; out.y = this.focal.y; out.z = this.focal.z;
        return out;
    }

    static meanRow(rows, fallback = 12) {
        if (!rows || rows.length === 0) return fallback;
        let total = 0;
        for (let i = 0; i < rows.length; i += 1) total += rows[i];
        return total / rows.length;
    }

    /** A random formation, never the same twice running. */
    pickRandomShape(pool = RANDOM_SHAPE_POOL) {
        if (!pool || pool.length === 0) return null;
        if (pool.length === 1) return pool[0];
        let pick = pool[Math.floor(this.random() * pool.length) % pool.length];
        if (pick === this._lastShapePick) {
            const rest = pool.filter((name) => name !== this._lastShapePick);
            pick = rest[Math.floor(this.random() * rest.length) % rest.length];
        }
        this._lastShapePick = pick;
        return pick;
    }

    // ── formations ──────────────────────────────────────────────────────────────

    /**
     * Gather the swarm into a formation.
     * @param {string} name      a shape-formations.js name
     * @param {object} opts      shape options
     * @param {number} strength  0..1.5
     * @param {number} hold      seconds before it lets go (Infinity = until released)
     * @param {number} priority  a lesser moment never interrupts a greater one mid-hold,
     *                           and nothing re-rolls a formation that is still arriving
     */
    requestShape(name, opts = {}, strength = 0.6, hold = 3, priority = 1) {
        const current = this.shape;
        if (!this.canRequestShape(priority)) return false;
        if (!this.sim?.setShape(name, opts)) return false;
        current.name = name;
        current.target = strength;
        current.until = this.time + hold;
        current.since = this.time;
        current.priority = priority;
        current.turning = TURNING_SHAPES.has(name);
        return true;
    }

    /** Would a formation of this priority be accepted right now? */
    canRequestShape(priority = 1) {
        const current = this.shape;
        if (current.name === 'free' || !(current.target > 0)) return true;
        if (priority < current.priority && this.time < current.until) return false;
        return !(priority <= current.priority && this.time - current.since < 1.4);
    }

    /**
     * Roll a formation from `pool` and gather into it. The roll is only spent when the
     * request can be accepted, so a refused moment never uses up the "not twice running" memory.
     */
    requestRandomShape(pool, strength, hold, priority) {
        if (!this.canRequestShape(priority)) return false;
        const name = this.pickRandomShape(pool);
        return name ? this.requestShape(name, EVENT_SHAPE, strength, hold, priority) : false;
    }

    /** Let the formation dissolve back into the flow. */
    releaseShape() {
        this.shape.target = 0;
        this.shape.until = this.time;
    }

    // ── gameplay ────────────────────────────────────────────────────────────────

    lock(detail = {}) {
        const hard = detail.hardDrop === true;
        const origin = this._origin(detail, SwarmShow.meanRow(detail.rows), detail.u ?? 0.5);
        // The ring is a hairline and the light it leaves is gone in two frames: what crosses
        // the swarm is a line of light. (The swarm is only nine units tall; a ring a unit
        // wide lights a fifth of it at once and reads as nothing in particular.)
        this._push(origin, hard ? 10.5 : 4, null, IMPULSE_TYPE.RADIAL, {
            speed: hard ? 9.5 : 7.5,
            width: hard ? 0.2 : 0.16,
            flash: hard ? 1.4 : 1.0,
            decay: hard ? 1.2 : 1.5,
        });
        // The lens takes the tap: a micro-shake, a breath of zoom, a flick of colour.
        if (!this.reducedMotion) {
            this.camera?.shake(hard ? 0.14 : 0.06, hard ? 200 : 160);
            this.camera?.fovPunch(hard ? -2.2 : -1.4);
            if (hard) this.camera?.dolly(0.08);
        }
        const { fx } = this;
        fx.chromaPunch = Math.max(fx.chromaPunch, hard ? 0.012 : 0.008);
        fx.bloomPunch = Math.max(fx.bloomPunch, hard ? 0.18 : 0.10);
        fx.vignettePunch = Math.max(fx.vignettePunch, hard ? 0.10 : 0.06);
    }

    clear(detail = {}) {
        const lines = Math.max(1, Math.min(4, detail.lines || 1));
        const row = SwarmShow.meanRow(detail.rows, 18);
        const { fx } = this;
        fx.comboPulse = Math.min(1, fx.comboPulse + lines * 0.12);

        if (detail.perfect) {
            this._perfectClear();
        } else if (lines >= 4) {
            this._quad(detail, row);
        } else {
            const origin = this._origin(detail, row, 0.5);
            // A tall ellipse: its two sides leave the board sideways as near-vertical
            // fronts and sweep the whole height of both wings. (Cleared rows are at the
            // foot of the board, where the swarm is thin; a round ring there lights little.)
            this._push(origin, 7 + lines * 2, null, IMPULSE_TYPE.RADIAL, {
                speed: 6.5,
                width: 0.2 + lines * 0.02,
                flash: 1.2 + lines * 0.12,
                squash: 0.4,
                decay: 1.1,
            });
            this.skyFlash = Math.max(this.skyFlash, 0.12 * lines);
            // A T-spin draws its own knot below; a plain triple rolls from the whole pool.
            if (lines === 3 && !detail.tspin) this.requestRandomShape(RANDOM_SHAPE_POOL, 0.5, 2.8, 1);
        }
        if (detail.tspin) this._tspin(detail, row);
        if (detail.b2b) {
            this.skyFlash = Math.max(this.skyFlash, 0.45);
            fx.rewardPulse = Math.min(1, fx.rewardPulse + 0.3);
        }
    }

    _quad(detail, row) {
        const origin = this._origin(detail, row, 0.5);
        const at = { x: origin.x, y: origin.y, z: origin.z };
        this._push(at, 20, null, IMPULSE_TYPE.RADIAL, {
            speed: 10, width: 0.3, flash: 1.3, decay: 0.95,
        });
        this.after(0.08, () => this._push(at, 3.5, AXIS_IN, IMPULSE_TYPE.VORTEX));
        this.after(0.22, () => this._push(at, 10, null, IMPULSE_TYPE.RADIAL, {
            speed: 8, width: 0.2, flash: 1.0, decay: 1.1,
        }));
        this.skyFlash = 1;
        this.fx.bloomPunch = Math.max(this.fx.bloomPunch, 0.3);
        if (!this.reducedMotion) this.camera?.dolly(0.18);
        this.requestRandomShape(RANDOM_SHAPE_POOL, 0.7, 4.5, 2);
    }

    _tspin(detail, row) {
        const origin = this._origin(detail, row, detail.u ?? 0.5);
        const at = { x: origin.x, y: origin.y, z: origin.z };
        this._push({ x: at.x - 1.6, y: at.y, z: at.z }, 4.5, AXIS_IN, IMPULSE_TYPE.VORTEX);
        this._push({ x: at.x + 1.6, y: at.y, z: at.z }, 4.5, AXIS_OUT, IMPULSE_TYPE.VORTEX);
        this.skyFlash = Math.max(this.skyFlash, 0.5);
        this.requestRandomShape(KNOT_SHAPES, 0.62, 3.2, 1);
    }

    _perfectClear() {
        const at = { x: this.focal.x, y: this.focal.y, z: this.focal.z };
        // Drawn in to a point …
        for (let i = 0; i < 3; i += 1) {
            this.after(i * 0.12, () => this._push(at, 6.5, AXIS_IN, IMPULSE_TYPE.ATTRACTOR));
        }
        // … then the bloom.
        this.after(0.42, () => {
            this._push(at, 24, null, IMPULSE_TYPE.RADIAL, {
                speed: 11, width: 0.4, flash: 1.5, decay: 0.9,
            });
            this.skyFlash = 1.4;
            this.fx.bloomPunch = Math.max(this.fx.bloomPunch, 0.4);
            this.requestRandomShape(BLOOM_SHAPES, 0.8, 5.5, 3);
        });
        if (!this.reducedMotion) this.camera?.vertigo(0.6);
    }

    /** The true consecutive-clear combo for a player (0 = the chain broke). */
    combo(count, player = 0) {
        const n = Math.max(0, Math.trunc(count) || 0);
        if (n > 0) this.combos.set(player, n);
        else this.combos.delete(player);
        let best = 0;
        this.combos.forEach((value) => { if (value > best) best = value; });
        const previous = this.comboCount;
        this.comboCount = best;
        this.heatTarget = clamp01((best - 1) / 8);
        if (best <= previous || best < 2) return;

        const { fx } = this;
        fx.comboIntensity = Math.min(1.1, Math.max(fx.comboIntensity, 0.2 + best * 0.08));
        fx.rewardPulse = Math.min(1, fx.rewardPulse + 0.15 + best * 0.05);
        // Each step of the chain gives the gyre a shove.
        this._push(this._focalPoint(), Math.min(4.5, 1.5 + best * 0.3), AXIS_IN, IMPULSE_TYPE.VORTEX);
        if (best >= 7) {
            if (!this.reducedMotion) this.camera?.vertigo(0.8);
            this.requestRandomShape(RANDOM_SHAPE_POOL, 0.85, 5, 2);
        } else if (best >= 4) {
            if (!this.reducedMotion) this.camera?.dolly(0.12);
            this.requestRandomShape(RANDOM_SHAPE_POOL, 0.55, 2.8, 1);
        }
    }

    /** @param {number} level @param {{ silent?: boolean }} [options] silent = no wave */
    levelUp(level, options = {}) {
        this.level = Math.max(1, Math.round(level) || 1);
        this.palettePhaseTarget = (this.level - 1) * PALETTE_LEVEL_STEP;
        if (options.silent) {
            this.palettePhase = this.palettePhaseTarget;
            return;
        }
        this._push(this._focalPoint(), 4, null, IMPULSE_TYPE.RADIAL, {
            speed: 5, width: 0.5, flash: 0.9, decay: 0.6,
        });
        this.skyFlash = Math.max(this.skyFlash, 0.5);
    }

    /** The heart, held until the next run starts. */
    gameOver() {
        if (!this.reducedMotion) this.camera?.pullBack(0.6);
        // One heart, centred: the run is over and the card no longer needs the middle.
        this.requestShape('heart', { scale: 0.65, depth: 1.8, layout: 'center' }, 0.75, Infinity, 5);
        const at = { x: this.focal.x, y: this.focal.y, z: this.focal.z };
        for (let i = 0; i < 12; i += 1) {
            this.after(i * 0.15, () => this._push(at, 1.8, AXIS_IN, IMPULSE_TYPE.ATTRACTOR));
        }
    }

    gameStart() {
        this.resetSession();
    }

    /** A new run: no chain, no heat, nothing queued, the swarm free. */
    resetSession() {
        this._queue.length = 0;
        this.combos.clear();
        this.comboCount = 0;
        this.heatTarget = 0;
        this.shape.priority = 0;
        this.releaseShape();
    }

    /** Back to the first frame: level 1, cold, free (captures replay from here). */
    reset() {
        this.resetSession();
        this.heat = 0;
        this.level = 1;
        this.palettePhase = 0;
        this.palettePhaseTarget = 0;
        this.skyFlash = 0;
        this.shapeColor = 0;
        this.shape.name = 'free';
        this.shape.level = 0;
        this.shape.target = 0;
        this._lastShapePick = null;
        Object.keys(this.fx).forEach((key) => { this.fx[key] = 0; });
        this.sim?.setShape('free');
        this.sim?.setShapeStrength(0);
    }

    // ── frame ───────────────────────────────────────────────────────────────────

    update(delta, time) {
        const dt = Math.max(0, Math.min(delta, 0.1));
        this.time = time;

        if (this._queue.length) {
            const due = this._queue.filter((entry) => entry.at <= time);
            if (due.length) {
                this._queue = this._queue.filter((entry) => entry.at > time);
                due.sort((a, b) => a.at - b.at).forEach((entry) => entry.fn());
            }
        }

        const { fx } = this;
        fx.comboIntensity *= Math.exp(-1.83 * dt);
        fx.comboPulse *= Math.exp(-3.08 * dt);
        fx.rewardPulse *= Math.exp(-2.45 * dt);
        fx.chromaPunch *= Math.exp(-13.4 * dt);
        fx.bloomPunch *= Math.exp(-11.2 * dt);
        fx.vignettePunch *= Math.exp(-14.9 * dt);

        this.heat = ease(this.heat, this.heatTarget, this.heatTarget > this.heat ? 1.6 : 0.45, dt);
        fx.stageHeat = this.heat;
        this.palettePhase = ease(this.palettePhase, this.palettePhaseTarget, 1.1, dt);
        this.skyFlash *= Math.exp(-2.4 * dt);

        // Formation state.
        const { shape } = this;
        if (shape.name !== 'free' && time >= shape.until) shape.target = 0;
        shape.level = ease(shape.level, shape.target, shape.target > shape.level ? 5 : 2.6, dt);
        if (shape.target === 0 && shape.level < 0.012 && shape.name !== 'free') {
            shape.level = 0;
            shape.name = 'free';
            shape.priority = 0;
            this.sim?.setShape('free');
        }
        const held = clamp01(shape.level / 0.5);
        this.shapeColor = ease(this.shapeColor, shape.name !== 'free' && shape.target > 0 ? 1 : 0, 2.2, dt);
        const elapsed = time - shape.since;
        const yaw = shape.turning ? elapsed * 0.42 : Math.sin(elapsed * 0.7) * 0.2;

        this.simParams.turbulence = this.baseTurbulence + fx.comboIntensity * 0.4 + this.heat * 0.25;
        this.simParams.gyre = this.baseGyre * (1 + this.heat * 1.6 + fx.comboIntensity * 0.8);

        const { sim, visual, sky } = this;
        if (sim) {
            sim.setShapeStrength(shape.level);
            sim.setShapePose?.(shape.name === 'free' ? 0 : yaw, 1);
        }
        if (visual?.uniforms) {
            const u = visual.uniforms;
            u.uHeat.value = this.heat;
            u.uPalettePhase.value = this.palettePhase;
            u.uShapeColor.value = this.shapeColor;
            // A formation packs the swarm into a figure a quarter of its size; take the
            // exposure down with it, or the figure is a slab of white instead of motes.
            // A hot swarm is a fast one, and fast motes are bright ones: hold the total back
            // so a long chain turns the swarm gold instead of bleaching it.
            u.uExposure.value = (visual.baseExposure ?? 1) * (1 - held * 0.66) * (1 - this.heat * 0.3);
        }
        samplePalette(this.palettePhase + time * 0.006 + PALETTE_SPAN * 0.3, this.haloTint);
        if (sky?.uniforms) {
            const u = sky.uniforms;
            u.uHeat.value = this.heat;
            u.uPulse.value = fx.comboPulse;
            if (u.uFlash) u.uFlash.value = this.skyFlash;
            if (u.uTintA && u.uTintB) {
                const drift = time * 0.006;
                const a = samplePalette(this.palettePhase + drift - PALETTE_SPAN * 0.2, this._tint);
                u.uTintA.value.setRGB(a[0] * 0.7, a[1] * 0.7, a[2] * 0.7);
                const b = samplePalette(this.palettePhase + drift + PALETTE_SPAN * 0.75, this._tint);
                u.uTintB.value.setRGB(b[0] * 0.7, b[1] * 0.7, b[2] * 0.7);
            }
        }
    }

    getState() {
        return {
            combo: this.comboCount,
            heat: this.heat,
            level: this.level,
            palettePhase: this.palettePhase,
            shape: this.shape.name,
            shapeLevel: this.shape.level,
            skyFlash: this.skyFlash,
            queued: this._queue.length,
        };
    }

    dispose() {
        this._queue.length = 0;
        this.combos.clear();
        this.sim = null;
        this.visual = null;
        this.sky = null;
        this.camera = null;
        this.locate = null;
    }
}
