/**
 * Murmuration — the show: what the swarm does when the board is played.
 *
 * Renderer-free and timer-free. Gameplay arrives as the play director's resolved calls
 * (`lock`, `clear`, `combo`, `crown`, `spin`, `levelUp`) plus `gameOver` / `gameStart`; this
 * class turns them into impulses on the simulation, formations, colour, and the handful of
 * numbers the sky, the lens and the post stack read each frame. Anything delayed sits in a
 * queue keyed on the show's own clock and runs from `update()`, so a capture can replay a
 * moment exactly and stopping the theme leaves nothing scheduled.
 *
 *   LOCK          a ring of light leaves the piece and crosses the swarm
 *   HARD DROP     the same, harder and faster, and the lens takes the hit
 *   CLEAR 1–3     a tall ellipse whose sides sweep outward across both wings
 *   CASCADE       each wave's ring rounder, wider, faster and brighter than the last
 *   BACK-TO-BACK  the clear's ring answered by a second, harder one right behind it
 *   QUAD          two rings, a swirl, the sky lights up, the swarm gathers into a shape
 *   T-SPIN        two counter-turning eddies and a knot — or the figure held pirouettes
 *   PERFECT CLEAR the swarm is drawn in to a point, then blooms in gold (the chain's crown)
 *   COMBO         the gyre spins up and the swarm warms toward gold; from four the flock
 *                 draws ONE figure and the chain grows it
 *   LEVEL UP      the palette steps on
 *   GAME OVER     a heart, held until the next run
 *
 * Fast play BUILDS here instead of popping (src/themes/shared/gameplay-surge.js). Every
 * frame-wide light is a Swell — a new hit adds to what is still lit, so a single after a quad
 * can only lift the sky — and a GameplaySurge measures the heat of play. What the world does
 * with it, act by act:
 *
 *   calm   as at rest: the swarm wheels slowly in its own colours.
 *   warm   the flock takes notice: the gyre quickens, the banking ripples come sooner and
 *          fold brighter, the rings a lock sends out run harder and farther.
 *   hot    the flock is alive with the player: the sunset begins (rose, then ember), the
 *          dust round it catches the light, the iris closes a little so the colours stay deep.
 *   fever  the chain's figure catches the sunset and burns ember-gold, the board's halo
 *          burns, the lens leans in and holds.
 *   crown  a perfect clear draws the whole hot flock in and blooms it out in gold; then the
 *          chain is over and the heat bleeds out over several seconds.
 *
 * The figure of a chain is never abandoned half-formed: lesser moments (a triple's roll, a
 * T-spin's knot, a quad) fold into the figure that is held — it grows larger and firmer, takes
 * a breath, pirouettes for a T-spin — and a new figure comes only once the last has formed and
 * held (a long chain's figure becomes a grander one; the perfect clear crowns it with a bloom).
 */
import { IMPULSE_TYPE } from '../sim/fluid-particles.js';
import {
    FIRE, PALETTE_LEVEL_STEP, PALETTE_SPAN, heatWarmth, samplePalette, turnHue,
} from './swarm-palette.js';
import { flashScale } from '../../../utils/photosensitivity.js';
import { GameplaySurge, Swell } from '../../shared/gameplay-surge.js';

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
// (A sunflower is a flat disc of points: as a crown it reads as a blob, so it is not one.)
const BLOOM_SHAPES = Object.freeze(['lotus', 'snowflake']);

/** A figure drawn for a play: the dust keeps flowing behind it. */
const EVENT_SHAPE = Object.freeze({ keepDust: true });
/** A long chain's grander figure: half the dust joins it (more birds), half keeps flowing. */
const GRAND_DUST = 0.5;

/**
 * A chain's figure, and the grander one it becomes once it has formed and held. A chain
 * commits to one of these at four; the grand figure shares its silhouette and is richer.
 */
const CHAIN_GRAND = Object.freeze({
    galaxy: Object.freeze({
        name: 'galaxy', opts: Object.freeze({ keepDust: GRAND_DUST, arms: 6, armTightness: 0.85 }),
    }),
    star: Object.freeze({ name: 'snowflake', opts: Object.freeze({ keepDust: GRAND_DUST }) }),
    ring: Object.freeze({ name: 'torus', opts: Object.freeze({ keepDust: GRAND_DUST }) }),
    sphere: Object.freeze({ name: 'wavySphere', opts: Object.freeze({ keepDust: GRAND_DUST }) }),
    infinity: Object.freeze({ name: 'trefoil', opts: Object.freeze({ keepDust: GRAND_DUST }) }),
    vortex: Object.freeze({ name: 'nautilus', opts: Object.freeze({ keepDust: GRAND_DUST }) }),
    butterfly: Object.freeze({ name: 'lotus', opts: Object.freeze({ keepDust: GRAND_DUST }) }),
    hexagon: Object.freeze({ name: 'snowflake', opts: Object.freeze({ keepDust: GRAND_DUST }) }),
});
/** The figures a chain may commit to. */
export const CHAIN_FIGURES = Object.freeze(Object.keys(CHAIN_GRAND));
/** Every figure a chain may grow into. */
export const CHAIN_GRAND_FIGURES = Object.freeze(CHAIN_FIGURES.map((name) => CHAIN_GRAND[name].name));

/** A chain's figure ranks between a quad's figure (2) and the perfect clear's bloom (3). */
const CHAIN_PRIORITY = 2.5;
/** Figures at or above this (the heart, one asked for by name) are never grown by play. */
const KEPT_PRIORITY = 5;
/**
 * The strength a chain's figure starts at — a suggestion: the flock leans into it and keeps
 * flowing, so the figure emerges out of the swarm and firms up as the chain grows — and the
 * most any figure grows to (1.5 = tight).
 */
const CHAIN_STRENGTH = 0.34;
const FIGURE_MAX = 1.15;
/** A figure has formed once it is this close to its strength; then it must hold this long. */
const FORMED = 0.95;
const FIGURE_HOLD = 2.2;
/** At full growth a figure is this much firmer and this much larger; each step breathes. */
const GROW_STRENGTH = 0.75;
const GROW_SCALE = 0.12;
const BREATH_SCALE = 0.05;
/** How much a figure grows for each thing that folds into it. */
const GROW = Object.freeze({
    step: 0.08, // a step of the chain
    milestone: 0.18, // the seventh and the tenth
    fold: 0.1, // a lesser figure's roll (a triple)
    tspin: 0.12,
    quad: 0.24,
    b2b: 0.1,
    wave: 0.05, // each cascade wave past the first
    spin: 0.05, // a T-spin that cleared nothing
    level: 0.08,
});
/** A figure held while play goes on is held a little longer for each fold. */
const FOLD_HOLD = 1.5;
/** A chain's figure is held this long past each step (seconds, by the chain's length). */
const chainHold = (n) => 3 + 0.25 * Math.min(n, 12);

const AXIS_IN = Object.freeze({ x: 0, y: 0, z: 1 });
const AXIS_OUT = Object.freeze({ x: 0, y: 0, z: -1 });

const BASE_GYRE = 0.26;
const BASE_TURBULENCE = 0.6;

/** Heat (the sunset): how fast it rises and bleeds out (1/s). */
const HEAT_RISE = 1.6;
const HEAT_FALL = 0.32;
/** A fast hand alone (no chain) turns the swarm this far toward the sunset. */
const PACE_HEAT = 0.45;
/** A perfect clear flushes the swarm gold, then the crowned chain keeps its heat this long. */
const CROWN_HEAT = 0.9;
const CROWN_HOLD = 2.6;

/** The flock's own clock (its banking ripple, its twinkle) runs this much faster in full play. */
const FLOCK_QUICKEN = 0.7;
/** How much brighter the banking ripple folds in full play. */
const TURN_LIFT = 0.35;
/** The light inside the cloud that play sustains (the sky's uPulse); the clears' own pulse
 * is held back by up to SKY_HOLD as play heats, so the cloud glows steadily instead of flaring. */
const SKY_GLOW = 0.1;
const SKY_HOLD = 0.35;
/** A figure held in hot play is let this much nearer the flock's own light. */
const FIGURE_LIFT = 0.15;
/** The iris closes this much in full play, so the heat deepens colour instead of adding haze. */
const IRIS = 0.07;
/** The board's halo burns this much brighter in a fever. */
const HALO_BURN = 0.15;
/** The lens leans in and holds this far (world units) in a fever. */
const LENS_HOLD = 0.2;
/** Reduced motion keeps this much of the show's own motion (pirouettes stop altogether). */
const CALM_MOTION = 0.4;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth01 = (v) => {
    const k = clamp01(v);
    return k * k * (3 - 2 * k);
};
const ease = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
const byTime = (a, b) => a.at - b.at;

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
            // How far the iris closes (post exposure) and how much brighter the board's halo burns.
            exposureDip: 0,
            haloBoost: 0,
        };
        // The swarm at rest; play adds to both.
        this.baseGyre = BASE_GYRE;
        this.baseTurbulence = BASE_TURBULENCE;
        this.simParams = { turbulence: BASE_TURBULENCE, gyre: BASE_GYRE };

        // The heat of play, and the light that accumulates with it.
        this.surge = new GameplaySurge();
        this.surgeState = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        this._sky = new Swell({ release: 1 / 2.4, ceiling: 1.6, knee: 1.0 });
        this._chroma = new Swell({ release: 1 / 13.4, ceiling: 0.007, knee: 0.0045 });
        this._bloom = new Swell({ release: 1 / 11.2, ceiling: 0.55, knee: 0.36 });
        this._vignette = new Swell({ release: 1 / 14.9, ceiling: 0.18, knee: 0.12 });
        this._comboGlow = new Swell({ release: 1.6, ceiling: 1.1, knee: 0.7 });
        /** The breath a figure takes each time it grows. */
        this._breath = new Swell({
            attack: 0.12, release: 0.5, ceiling: 1, knee: 0.7,
        });
        /** The perfect clear's gold. */
        this._crown = new Swell({
            attack: 0.35, release: 3, ceiling: 1, knee: 0.8,
        });

        this.combos = new Map();
        this.comboCount = 0;
        this.heat = 0;
        this.heatTarget = 0;
        /** When a crowned chain lets its heat go (Infinity: while the chain stands), and when it was crowned. */
        this._chainSpentAt = Infinity;
        this._crownedAt = -Infinity;
        this.level = 1;
        this.palettePhase = 0;
        this.palettePhaseTarget = 0;
        this.skyFlash = 0;
        /** The sky's inner light (uPulse): the combo pulse plus what play sustains. */
        this.skyPulse = 0;
        this.shapeColor = 0;
        /** How far the held figure has caught the sunset (0 keeps its own colours). */
        this.fire = 0;
        /** The flock's clock runs ahead of the show's by this much (see update()). */
        this.flockLead = 0;
        this.flockClock = 0;

        this.shape = {
            name: 'free',
            level: 0,
            target: 0,
            until: 0,
            since: 0,
            priority: 0,
            turning: false,
            // Growth: the strength it was asked for, how far it has grown, when it had formed.
            base: 0,
            growth: 0,
            formedAt: -1,
            chain: false,
            evolved: false,
            // Pose: its own sway clock, a pirouette in progress, its shown size.
            phase: 0,
            spin: 0,
            spinTarget: 0,
            scale: 1,
        };
        this._lastShapePick = null;
        this._queue = [];
        this._ready = [];
        this._point = { x: 0, y: 0, z: 0 };
        /** The ring a clear sent (a back-to-back answers it); and where the next ring starts. */
        this._ring = {
            x: 0, y: 0, z: 0, strength: 0, speed: 0, width: 0, flash: 0, squash: 1, decay: 1,
        };
        this._ringAt = { x: 0, y: 0, z: 0 };
        this._tint = [0, 0, 0];
        /** The swarm's middle hue right now (linear RGB), for anything that wants to match it. */
        this.haloTint = [0.45, 0.3, 1.0];
        this.surge.sample(this.time);
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

    /** The heat of play as last sampled (0..1). */
    get pace() {
        return this.surgeState.level;
    }

    /** Light the sky: the hit adds to what is still lit, it never cuts it. */
    _lightSky(amount) {
        this._sky.hit(amount, this.time);
        this.skyFlash = this._sky.valueAt(this.time);
    }

    /** The lens's flicks of light, each adding to what is still there. */
    _punch(chroma, bloom, vignette) {
        const t = this.time;
        this._chroma.hit(chroma, t);
        this._bloom.hit(bloom, t);
        this._vignette.hit(vignette, t);
        const { fx } = this;
        fx.chromaPunch = this._chroma.valueAt(t);
        fx.bloomPunch = this._bloom.valueAt(t);
        fx.vignettePunch = this._vignette.valueAt(t);
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
     * @param {number} priority  a lesser moment never interrupts a greater one mid-hold, and
     *                           an equal one waits until the figure has formed and held
     */
    requestShape(name, opts = {}, strength = 0.6, hold = 3, priority = 1) {
        if (!this.canRequestShape(priority)) return false;
        return this._form(name, opts, strength, hold, priority);
    }

    /** Draw a new figure, whatever is held. */
    _form(name, opts, strength, hold, priority) {
        if (!this.sim?.setShape(name, opts)) return false;
        const s = this.shape;
        s.name = name;
        s.base = strength;
        s.target = strength;
        s.growth = 0;
        s.until = this.time + hold;
        s.since = this.time;
        s.priority = priority;
        s.turning = TURNING_SHAPES.has(name);
        s.formedAt = -1;
        s.chain = false;
        s.evolved = false;
        s.phase = 0;
        s.spin = 0;
        s.spinTarget = 0;
        return true;
    }

    /** How long the figure held now has stood fully formed (seconds; 0 while it forms). */
    figureHeld() {
        const s = this.shape;
        return s.formedAt >= 0 && s.target > 0 ? Math.max(0, this.time - s.formedAt) : 0;
    }

    /** Would a formation of this priority be accepted right now? */
    canRequestShape(priority = 1) {
        const current = this.shape;
        if (current.name === 'free' || !(current.target > 0)) return true;
        if (priority > current.priority) return true;
        if (priority < current.priority && this.time < current.until) return false;
        // An equal moment never abandons a figure half-formed: it waits until it has held.
        return this.figureHeld() >= FIGURE_HOLD;
    }

    /**
     * Roll a formation from `pool` and gather into it. The roll is only spent when the
     * request can be accepted, so a refused moment never uses up the "not twice running"
     * memory; its energy folds into the figure held instead (it grows by `fold`).
     */
    requestRandomShape(pool, strength, hold, priority, fold = GROW.fold) {
        if (!this.canRequestShape(priority)) {
            this._grow(fold);
            return false;
        }
        const name = this.pickRandomShape(pool);
        return name ? this.requestShape(name, EVENT_SHAPE, strength, hold, priority) : false;
    }

    /**
     * The figure held takes a moment's energy: firmer, a little larger, a breath, and held a
     * little longer. False when there is nothing play may grow.
     */
    _grow(amount) {
        const s = this.shape;
        if (s.name === 'free' || !(s.target > 0) || s.priority >= KEPT_PRIORITY || !(amount > 0)) return false;
        s.growth = Math.min(1, s.growth + amount);
        s.target = Math.min(FIGURE_MAX, s.base + s.growth * GROW_STRENGTH);
        s.until = Math.max(s.until, this.time + FOLD_HOLD);
        this._breath.hit(Math.min(1, amount * 4), this.time);
        return true;
    }

    /** A T-spin turns the figure held once round (its twin the other way). */
    _pirouette() {
        const s = this.shape;
        if (this.reducedMotion || s.name === 'free' || !(s.target > 0)) return;
        s.spinTarget += Math.PI * 2;
    }

    /** The chain reached four: the flock draws its figure — or carries on the one it holds. */
    _commitChain(n) {
        const s = this.shape;
        const held = s.name !== 'free' && s.target > 0;
        if (held && s.priority >= CHAIN_PRIORITY) {
            this._grow(GROW.step); // a crown or a heart is showing: it takes the step
            return;
        }
        if (held) {
            // Adopt the figure already drawn (a quad's, a triple's): the chain carries it on.
            s.chain = true;
            s.priority = CHAIN_PRIORITY;
            s.base = Math.max(s.base, CHAIN_STRENGTH);
            s.until = Math.max(s.until, this.time + chainHold(n));
            this._grow(GROW.step);
            return;
        }
        const name = this.pickRandomShape(CHAIN_FIGURES);
        if (name && this._form(name, EVENT_SHAPE, CHAIN_STRENGTH, chainHold(n), CHAIN_PRIORITY)) {
            this.shape.chain = true;
        }
    }

    /** Each further step grows the chain's figure; once it has held, it becomes a grander one. */
    _growChain(n) {
        const s = this.shape;
        s.until = Math.max(s.until, this.time + chainHold(n));
        this._grow(n === 7 || n === 10 ? GROW.milestone : GROW.step);
        if (!s.evolved && n >= 7 && this.figureHeld() >= FIGURE_HOLD) this._evolve();
    }

    /** The chain's figure has formed and held: it becomes its grander sibling, keeping its growth. */
    _evolve() {
        const s = this.shape;
        const grand = CHAIN_GRAND[s.name];
        const name = grand ? grand.name : this.pickRandomShape(CHAIN_FIGURES);
        const opts = grand ? grand.opts : EVENT_SHAPE;
        const { growth, until } = s;
        if (!name || !this._form(name, opts, CHAIN_STRENGTH, 0, CHAIN_PRIORITY)) return;
        this._lastShapePick = name;
        s.chain = true;
        s.evolved = true;
        s.until = until;
        s.growth = growth;
        s.target = Math.min(FIGURE_MAX, s.base + growth * GROW_STRENGTH);
        this._breath.hit(1, this.time);
    }

    /** Let the formation dissolve back into the flow. */
    releaseShape() {
        this.shape.target = 0;
        this.shape.until = this.time;
        this.shape.chain = false;
    }

    // ── gameplay ────────────────────────────────────────────────────────────────

    lock(detail = {}) {
        const hard = detail.hardDrop === true;
        this.surge.lock(detail, this.time);
        const { pace } = this;
        const origin = this._origin(detail, SwarmShow.meanRow(detail.rows), detail.u ?? 0.5);
        // The ring is a hairline and the light it leaves is gone in two frames: what crosses
        // the swarm is a line of light. (The swarm is only nine units tall; a ring a unit
        // wide lights a fifth of it at once and reads as nothing in particular.) The faster
        // the hand, the harder and farther each ring runs.
        this._push(origin, (hard ? 10.5 : 4) * (1 + pace * 0.5), null, IMPULSE_TYPE.RADIAL, {
            speed: (hard ? 9.5 : 7.5) * (1 + pace * 0.2),
            width: (hard ? 0.2 : 0.16) * (1 + pace * 0.3),
            flash: (hard ? 1.4 : 1.0) * (1 + pace * 0.25),
            decay: hard ? 1.2 : 1.5,
        });
        // The lens takes the tap: a micro-shake, a breath of zoom, a flick of colour.
        if (!this.reducedMotion) {
            this.camera?.shake(hard ? 0.14 : 0.06, hard ? 200 : 160);
            this.camera?.fovPunch(hard ? -2.2 : -1.4);
            if (hard) this.camera?.dolly(0.08);
        }
        const k = 1 + pace * 0.5;
        this._punch((hard ? 0.0035 : 0.002) * k, (hard ? 0.18 : 0.10) * k, (hard ? 0.10 : 0.06) * k);
    }

    clear(detail = {}) {
        const lines = Math.max(1, Math.min(4, detail.lines || 1));
        const row = SwarmShow.meanRow(detail.rows, 18);
        const { fx } = this;
        this.surge.clear(detail, this.time);
        fx.comboPulse = Math.min(1, fx.comboPulse + lines * 0.12);
        // A cascade's later waves: each builds on the last.
        const deeper = Math.max(0, Math.min(9, Math.round(Number(detail.cascade) || 1) - 1));
        const { pace } = this;
        const ring = this._ring;

        if (detail.perfect) {
            this._perfectClear();
            ring.strength = 0;
        } else if (lines >= 4) {
            this._quad(detail, row, ring);
        } else {
            const origin = this._origin(detail, row, 0.5);
            // A tall ellipse: its two sides leave the board sideways as near-vertical
            // fronts and sweep the whole height of both wings. (Cleared rows are at the
            // foot of the board, where the swarm is thin; a round ring there lights little.)
            // Each wave of a cascade is rounder, wider, faster and brighter than the last:
            // a deep cascade is a train of rings racing out, not the first one again.
            ring.x = origin.x; ring.y = origin.y; ring.z = origin.z;
            ring.strength = (7 + lines * 2) * (1 + deeper * 0.18) * (1 + pace * 0.3);
            ring.speed = 6.5 * (1 + deeper * 0.12) * (1 + pace * 0.15);
            ring.width = (0.2 + lines * 0.02) * (1 + deeper * 0.2);
            ring.flash = (1.2 + lines * 0.12) * (1 + deeper * 0.12);
            ring.squash = Math.min(0.75, 0.4 + deeper * 0.08);
            ring.decay = 1.1;
            this._pushRing(ring, ring.strength);
            this._lightSky(0.12 * lines * (1 + deeper * 0.3));
            if (deeper > 0) this._grow(GROW.wave * deeper);
            // A T-spin draws its own knot below; a plain triple rolls from the whole pool.
            if (lines === 3 && !detail.tspin) this.requestRandomShape(RANDOM_SHAPE_POOL, 0.5, 2.8, 1);
        }
        if (detail.tspin) this._tspin(detail, row);
        if (detail.b2b) this._backToBack(ring);
    }

    /** Push the ring described by `ring` (a reused record) at `strength`. */
    _pushRing(ring, strength, scale = 1) {
        this._ringAt.x = ring.x; this._ringAt.y = ring.y; this._ringAt.z = ring.z;
        this._push(this._ringAt, strength, null, IMPULSE_TYPE.RADIAL, {
            speed: ring.speed * (scale > 1 ? 1.15 : 1),
            width: ring.width * scale,
            flash: ring.flash * (scale > 1 ? 1.25 : 1),
            squash: ring.squash,
            decay: ring.decay,
        });
    }

    /**
     * The second difficult clear in a row: its ring is answered by a second one right behind
     * it, harder, wider and brighter — back to back — and the sky and the reward light rise.
     */
    _backToBack(ring) {
        this._lightSky(0.45);
        this.fx.rewardPulse = Math.min(1, this.fx.rewardPulse + 0.3);
        this._grow(GROW.b2b);
        if (!(ring.strength > 0)) return;
        const echo = {
            x: ring.x,
            y: ring.y,
            z: ring.z,
            strength: ring.strength * 1.3,
            speed: ring.speed,
            width: ring.width,
            flash: ring.flash,
            squash: ring.squash,
            decay: ring.decay,
        };
        this.after(0.16, () => {
            this._pushRing(echo, echo.strength, 1.2);
            if (!this.reducedMotion) this.camera?.fovPunch(-1.8);
        });
    }

    _quad(detail, row, ring) {
        const origin = this._origin(detail, row, 0.5);
        const at = { x: origin.x, y: origin.y, z: origin.z };
        const { pace } = this;
        ring.x = at.x; ring.y = at.y; ring.z = at.z;
        ring.strength = 20 * (1 + pace * 0.3);
        ring.speed = 10 * (1 + pace * 0.15);
        ring.width = 0.3;
        ring.flash = 1.3;
        ring.squash = 1;
        ring.decay = 0.95;
        this._pushRing(ring, ring.strength);
        this.after(0.08, () => this._push(at, 3.5, AXIS_IN, IMPULSE_TYPE.VORTEX));
        this.after(0.22, () => this._push(at, 10 * (1 + pace * 0.3), null, IMPULSE_TYPE.RADIAL, {
            speed: 8, width: 0.2, flash: 1.0, decay: 1.1,
        }));
        // Added to what is lit: a quad after a perfect clear no longer darkens its sky.
        this._lightSky(1);
        this._punch(0, 0.3, 0);
        if (!this.reducedMotion) this.camera?.dolly(0.18);
        // In a chain the quad does not tear the chain's figure down: it grows it.
        this.requestRandomShape(RANDOM_SHAPE_POOL, 0.7, 4.5, 2, GROW.quad);
    }

    _tspin(detail, row) {
        const origin = this._origin(detail, row, detail.u ?? 0.5);
        const at = { x: origin.x, y: origin.y, z: origin.z };
        this._push({ x: at.x - 1.6, y: at.y, z: at.z }, 4.5, AXIS_IN, IMPULSE_TYPE.VORTEX);
        this._push({ x: at.x + 1.6, y: at.y, z: at.z }, 4.5, AXIS_OUT, IMPULSE_TYPE.VORTEX);
        this._lightSky(0.5);
        // A knot — or, with a figure held, the figure pirouettes and grows.
        if (!this.requestRandomShape(KNOT_SHAPES, 0.62, 3.2, 1, GROW.tspin)) this._pirouette();
    }

    /** A T-spin that cleared nothing: two small eddies at the piece, and a turn of the figure. */
    spin(detail = {}) {
        this.surge.spin(this.time);
        const origin = this._origin(detail, SwarmShow.meanRow(detail.rows), detail.u ?? 0.5);
        const at = { x: origin.x, y: origin.y, z: origin.z };
        this._push({ x: at.x - 1.2, y: at.y, z: at.z }, 2.6, AXIS_IN, IMPULSE_TYPE.VORTEX);
        this._push({ x: at.x + 1.2, y: at.y, z: at.z }, 2.6, AXIS_OUT, IMPULSE_TYPE.VORTEX);
        this._lightSky(0.15);
        if (this._grow(GROW.spin)) this._pirouette();
    }

    /**
     * A perfect clear that settled after its clear (physics sends it on its own, ~360 ms after
     * the last wave): the crown on the clear still playing — never a second clear.
     */
    crown() {
        this.surge.crown(this.time);
        this._perfectClear();
    }

    _perfectClear() {
        const at = { x: this.focal.x, y: this.focal.y, z: this.focal.z };
        const { pace } = this;
        // Drawn in to a point — the whole hot flock, harder the hotter it is …
        for (let i = 0; i < 3; i += 1) {
            this.after(i * 0.12, () => this._push(at, 6.5 * (1 + pace * 0.3), AXIS_IN, IMPULSE_TYPE.ATTRACTOR));
        }
        // … then the bloom, in gold.
        this._crown.hit(1, this.time + 0.42);
        this.after(0.42, () => {
            this._push(at, 24 * (1 + pace * 0.25), null, IMPULSE_TYPE.RADIAL, {
                speed: 11, width: 0.4, flash: 1.5, decay: 0.9,
            });
            this._lightSky(1.3);
            this._punch(0, 0.4, 0);
            this.requestRandomShape(BLOOM_SHAPES, 0.9, 5.5, 3);
        });
        // A perfect clear empties the board: the chain is over. Its heat bleeds out after the bloom.
        this._chainSpentAt = this.time + CROWN_HOLD;
        this._crownedAt = this.time;
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
        const { shape } = this;
        if (best < 4 && shape.chain && shape.target > 0) {
            // The chain broke: its figure loosens and spreads back into the flow.
            shape.chain = false;
            shape.until = Math.min(shape.until, this.time + 0.6);
        }
        if (best <= previous || best < 2) return;

        // A chain that grows again stands again (not the step that came with the crown itself).
        if (this.time > this._crownedAt) this._chainSpentAt = Infinity;
        const { fx } = this;
        this._comboGlow.hit(0.16 + best * 0.04, this.time);
        fx.comboIntensity = this._comboGlow.valueAt(this.time);
        fx.rewardPulse = Math.min(1, fx.rewardPulse + 0.15 + best * 0.05);
        // Each step of the chain gives the gyre a shove.
        this._push(this._focalPoint(), Math.min(4.5, 1.5 + best * 0.3), AXIS_IN, IMPULSE_TYPE.VORTEX);
        if (best >= 4) {
            if (shape.chain && shape.target > 0) this._growChain(best);
            else this._commitChain(best);
        }
        if (this.reducedMotion) return;
        if (best === 7 || best === 10) this.camera?.vertigo(0.8);
        else if (best >= 4) this.camera?.dolly(best >= 7 ? 0.06 : 0.12);
    }

    /** @param {number} level @param {{ silent?: boolean }} [options] silent = no wave */
    levelUp(level, options = {}) {
        this.level = Math.max(1, Math.round(level) || 1);
        this.palettePhaseTarget = (this.level - 1) * PALETTE_LEVEL_STEP;
        if (options.silent) {
            this.palettePhase = this.palettePhaseTarget;
            return;
        }
        this.surge.levelUp(this.time);
        this._push(this._focalPoint(), 4, null, IMPULSE_TYPE.RADIAL, {
            speed: 5, width: 0.5, flash: 0.9, decay: 0.6,
        });
        this._lightSky(0.5);
        this._grow(GROW.level);
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

    /**
     * A new run: no chain, no heat target, nothing queued, the swarm free. The heat of play
     * already lit is left to breathe out on its own.
     */
    resetSession() {
        this._queue.length = 0;
        this.combos.clear();
        this.comboCount = 0;
        this.heatTarget = 0;
        this._chainSpentAt = Infinity;
        this._crownedAt = -Infinity;
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
        this.skyPulse = 0;
        this.shapeColor = 0;
        this.fire = 0;
        this.flockLead = 0;
        this.flockClock = this.time;
        const s = this.shape;
        s.name = 'free';
        s.level = 0;
        s.target = 0;
        s.base = 0;
        s.growth = 0;
        s.formedAt = -1;
        s.evolved = false;
        s.phase = 0;
        s.spin = 0;
        s.spinTarget = 0;
        s.scale = 1;
        this._lastShapePick = null;
        this.surge.reset();
        this.surge.sample(this.time);
        this.surgeState.punch = 0;
        this.surgeState.level = 0;
        this.surgeState.fever = 0;
        this.surgeState.stage = 0;
        [this._sky, this._chroma, this._bloom, this._vignette, this._comboGlow, this._breath, this._crown]
            .forEach((swell) => swell.reset());
        Object.keys(this.fx).forEach((key) => { this.fx[key] = 0; });
        this.sim?.setShape('free');
        this.sim?.setShapeStrength(0);
    }

    // ── frame ───────────────────────────────────────────────────────────────────

    /** Run what the queue holds for `time`, oldest first, without allocating. */
    _runQueue(time) {
        const queue = this._queue;
        const ready = this._ready;
        let kept = 0;
        for (let i = 0; i < queue.length; i += 1) {
            const entry = queue[i];
            if (entry.at <= time) ready.push(entry);
            else queue[kept++] = entry;
        }
        queue.length = kept;
        if (ready.length === 0) return;
        ready.sort(byTime);
        for (let i = 0; i < ready.length; i += 1) ready[i].fn();
        ready.length = 0;
    }

    update(delta, time) {
        const dt = Math.max(0, Math.min(delta, 0.1));
        this.time = time;

        if (this._queue.length) this._runQueue(time);

        // The heat of play: one sample a frame, on the show's clock.
        const surge = this.surge.sample(time);
        const state = this.surgeState;
        state.punch = surge.punch;
        state.level = surge.level;
        state.fever = surge.fever;
        state.stage = surge.stage;
        const pace = surge.level;
        const calm = this.reducedMotion ? CALM_MOTION : 1;

        const { fx } = this;
        fx.comboIntensity = this._comboGlow.valueAt(time);
        fx.comboPulse *= Math.exp(-3.08 * dt);
        fx.rewardPulse *= Math.exp(-2.45 * dt);
        fx.chromaPunch = this._chroma.valueAt(time);
        fx.bloomPunch = this._bloom.valueAt(time);
        fx.vignettePunch = this._vignette.valueAt(time);
        fx.exposureDip = IRIS * pace;
        fx.haloBoost = HALO_BURN * surge.fever;
        this.skyFlash = this._sky.valueAt(time);

        // The sunset: the chain's heat (until a crowned chain lets it go), a share for a fast
        // hand, and the perfect clear's gold.
        const crown = this._crown.valueAt(time);
        let heatGoal = time < this._chainSpentAt ? this.heatTarget : 0;
        heatGoal = Math.max(heatGoal, PACE_HEAT * smooth01((pace - 0.3) / 0.6), CROWN_HEAT * crown);
        this.heat = ease(this.heat, heatGoal, heatGoal > this.heat ? HEAT_RISE : HEAT_FALL, dt);
        fx.stageHeat = this.heat;
        this.palettePhase = ease(this.palettePhase, this.palettePhaseTarget, 1.1, dt);
        // In a fever the figure held catches the sunset; the crown burns it gold.
        const fireGoal = Math.max(smooth01((surge.fever - 0.2) / 0.6), crown);
        this.fire = ease(this.fire, fireGoal, fireGoal > this.fire ? 1.4 : 0.5, dt);
        // The flock's clock runs ahead with the play: its banking ripples come sooner.
        this.flockLead += dt * FLOCK_QUICKEN * pace * calm;
        this.flockClock = time + this.flockLead;
        const drift = this.flockClock * 0.006;

        // Formation state.
        const { shape } = this;
        if (shape.name !== 'free' && time >= shape.until) {
            shape.target = 0;
            shape.chain = false;
        }
        shape.level = ease(shape.level, shape.target, shape.target > shape.level ? 5 : 2.6, dt);
        if (shape.formedAt < 0 && shape.target > 0 && shape.level >= shape.target * FORMED) shape.formedAt = time;
        if (shape.target === 0 && shape.level < 0.012 && shape.name !== 'free') {
            shape.level = 0;
            shape.name = 'free';
            shape.priority = 0;
            shape.growth = 0;
            shape.formedAt = -1;
            shape.evolved = false;
            this.sim?.setShape('free');
        }
        const held = clamp01(shape.level / 0.5);
        this.shapeColor = ease(this.shapeColor, shape.name !== 'free' && shape.target > 0 ? 1 : 0, 2.2, dt);
        shape.phase += dt * (1 + pace * 0.5 * calm);
        // A pirouette is quick: the figure is edge-on for a moment, not a beat.
        shape.spin = ease(shape.spin, shape.spinTarget, 4.5, dt);
        const yaw = (shape.turning ? shape.phase * 0.42 : Math.sin(shape.phase * 0.7) * 0.2) + shape.spin;
        const scaleGoal = 1 + shape.growth * GROW_SCALE + this._breath.valueAt(time) * BREATH_SCALE * calm;
        shape.scale = ease(shape.scale, shape.name === 'free' ? 1 : scaleGoal, 6, dt);

        // The flock: the chain spins the gyre up, play stirs it.
        this.simParams.turbulence = this.baseTurbulence + fx.comboIntensity * 0.4 + this.heat * 0.25 + pace * 0.1;
        this.simParams.gyre = this.baseGyre * (1 + this.heat * 1.6 + fx.comboIntensity * 0.7 + pace * 0.4);

        const { sim, visual, sky } = this;
        if (sim) {
            sim.setShapeStrength(shape.level);
            sim.setShapePose?.(shape.name === 'free' ? 0 : yaw, shape.name === 'free' ? 1 : shape.scale);
        }
        // How much of the swarm's colour the heat may take: a figure keeps most of its own
        // until it catches the fire.
        const keepsOwn = this.shapeColor * (1 - this.fire);
        if (visual?.uniforms) {
            const u = visual.uniforms;
            // The shader holds a figure's heat back by (1 - uShapeColor × 0.7); hand it the heat
            // that leaves the share the fire has caught.
            const shaderKeep = 1 - this.shapeColor * 0.7;
            u.uHeat.value = this.shapeColor > 0 ? (this.heat * (1 - keepsOwn * 0.7)) / shaderKeep : this.heat;
            u.uPalettePhase.value = this.palettePhase;
            u.uShapeColor.value = this.shapeColor;
            // A formation packs the swarm into a figure a quarter of its size; take the
            // exposure down with it, or the figure is a slab of white instead of motes (a figure
            // that has grown, in hot play, is let a little brighter, so a chain's figure never
            // reads dimmer than the flock it was drawn from). A hot swarm is a fast one, and
            // fast motes are bright ones: hold the total back so a long chain turns the swarm
            // gold instead of bleaching it.
            const relax = 1 - shape.growth * 0.25 - pace * FIGURE_LIFT;
            u.uExposure.value = (visual.baseExposure ?? 1) * (1 - held * 0.66 * relax) * (1 - this.heat * 0.3);
            if (u.uTurn) u.uTurn.value = 1 + pace * TURN_LIFT;
        }
        // The board's halo and the sky are lit by the swarm, so they warm as it does — along
        // the same turn of hue the motes take (shader: murm_turnHue).
        const warmth = heatWarmth(this.heat, keepsOwn);
        samplePalette(this.palettePhase + drift + PALETTE_SPAN * 0.3, this.haloTint);
        turnHue(this.haloTint, FIRE.amber, warmth, this.haloTint);
        this.skyPulse = fx.comboPulse * (1 - SKY_HOLD * pace) + SKY_GLOW * pace;
        if (sky?.uniforms) {
            const u = sky.uniforms;
            u.uHeat.value = this.heat;
            u.uPulse.value = this.skyPulse;
            if (u.uFlash) u.uFlash.value = this.skyFlash * flashScale();
            if (u.uTintA && u.uTintB) {
                const a = turnHue(
                    samplePalette(this.palettePhase + drift - PALETTE_SPAN * 0.2, this._tint),
                    FIRE.ember,
                    warmth * 0.8,
                    this._tint,
                );
                u.uTintA.value.setRGB(a[0] * 0.7, a[1] * 0.7, a[2] * 0.7);
                const b = turnHue(
                    samplePalette(this.palettePhase + drift + PALETTE_SPAN * 0.75, this._tint),
                    FIRE.gold,
                    warmth * 0.8,
                    this._tint,
                );
                u.uTintB.value.setRGB(b[0] * 0.7, b[1] * 0.7, b[2] * 0.7);
            }
            if (u.uWingA && u.uWingB) {
                // The hues the renderer gives the middle of each wing (seven units out).
                const at = this.palettePhase + drift;
                const wing = PALETTE_SPAN * 0.7;
                const a = turnHue(samplePalette(at - wing, this._tint), FIRE.ember, warmth, this._tint);
                u.uWingA.value.setRGB(a[0], a[1], a[2]);
                const b = turnHue(samplePalette(at + wing, this._tint), FIRE.gold, warmth, this._tint);
                u.uWingB.value.setRGB(b[0], b[1], b[2]);
            }
        }
        // In a fever the lens leans in and holds, instead of punching at every step.
        if (!this.reducedMotion) this.camera?.hold?.(LENS_HOLD * surge.fever);
    }

    getState() {
        return {
            combo: this.comboCount,
            heat: this.heat,
            level: this.level,
            palettePhase: this.palettePhase,
            shape: this.shape.name,
            shapeLevel: this.shape.level,
            growth: this.shape.growth,
            skyFlash: this.skyFlash,
            surge: this.surgeState.level,
            fever: this.surgeState.fever,
            fire: this.fire,
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
