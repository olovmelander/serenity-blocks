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
 * Every event has an instrument of its own. The simulation still shoves the flock (a ring, a
 * swirl, a pull); the LIGHT is a front of the event's own shape, drawn by the mote shader
 * (composition/swarm-fronts.js):
 *
 *   LOCK          a puff of the piece's own colour where it came to rest
 *   HARD DROP     a chevron: the bow wave the drop throws up and out, and the lens takes the hit
 *   CLEAR 1–3     a beam along each cleared row, leaving the board to both sides: one row, one
 *                 beam, so the eye can count them
 *   CASCADE       each wave's beams faster and brighter than the last
 *   BACK-TO-BACK  the beams are answered: gold ones come back in from the frame's edges
 *   QUAD          four beams, a swirl, the sky lights — and the flock spreads into two great
 *                 WINGS either side of the board and beats them (the board is the body)
 *   TWIST         a pinwheel unwinds at the piece, two counter-turning eddies, and a knot —
 *                 or the figure held pirouettes
 *   PERFECT CLEAR the swarm is drawn in to a point, then blooms in gold: a gold ring through
 *                 the flock, a gold figure that stays gold, and a shower of shooting stars
 *   COMBO         each step runs down every ribbon like a fuse; the gyre spins up and the swarm
 *                 warms toward gold; from four the flock draws ONE figure and the chain grows it
 *   LEVEL UP      the new palette crosses the flock as one wave, and the flock moves on a mood
 *   GAME OVER     the flock comes down to ROOST along the foot of the frame; it lifts again by
 *                 itself after a while, and at once when the next run starts
 *
 * The flock is never one shape for long (composition/swarm-moods.js): five moods turn by the
 * clock in every mode, each with its own form, flow, trails, colours and sky, and things happen
 * by themselves — a shooting star, a great fold of light sweeping the whole flock, a falcon's
 * stoop.
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
 * Twist's knot, a quad) fold into the figure that is held — it grows larger and firmer, takes
 * a breath, pirouettes for a twist — and a new figure comes only once the last has formed and
 * held (a long chain's figure becomes a grander one; the perfect clear crowns it with a bloom).
 */
import { IMPULSE_TYPE } from '../sim/fluid-particles.js';
import {
    FIRE, PALETTE_LEVEL_STEP, PALETTE_SPAN, heatWarmth, samplePalette, turnHue,
} from './swarm-palette.js';
import { FRONT, FrontTable } from './swarm-fronts.js';
import {
    MOODS, falconPath, happeningAt, meteorLine, moodAt, moodForm, moodPhase, stepMood,
} from './swarm-moods.js';
import { flashScale } from '../../../utils/photosensitivity.js';
import { GameplaySurge, Swell } from '../../shared/gameplay-surge.js';

/**
 * Every formation a gameplay moment may roll. 'free' is the release state, 'roost' is kept for
 * game over and 'wings' for four lines, so none of them is in the pool. The flock never draws
 * the game's pieces (the board shows those), and it no longer draws hard-edged solids either:
 * a cube or a pyramid is a particle demo, not something a flock does.
 */
export const RANDOM_SHAPE_POOL = Object.freeze([
    'sphere', 'torus', 'helix', 'galaxy', 'star', 'wave', 'butterfly', 'ring',
    'sunflower', 'infinity', 'trefoil', 'vortex', 'wavySphere',
    'snowflake', 'lotus', 'crescent', 'mobius', 'comet', 'nautilus',
]);

/** Solids turn all the way round; everything else faces the camera and only sways. */
const TURNING_SHAPES = new Set([
    'sphere', 'helix', 'cube', 'pyramid', 'octahedron', 'wavySphere', 'crystalShard', 'trefoil', 'mobius',
]);
/** Figures that face the camera and never turn or sway: they are fitted to the frame. */
const STILL_SHAPES = new Set(['wings', 'roost']);
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
    twist: 0.12,
    quad: 0.24,
    b2b: 0.1,
    wave: 0.05, // each cascade wave past the first
    spin: 0.05, // a twist that cleared nothing
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

/** The wings of a quad: their strength, how long they are held, their beat (rad/s) and its swing. */
const WINGS_STRENGTH = 0.85;
const WINGS_HOLD = 5.2;
const WING_BEAT = 3.5;
const WING_SWING = 0.24;
/** The roost: how firmly the flock settles, how long before it lifts again by itself. */
const ROOST_STRENGTH = 0.36;
const ROOST_HOLD = 16;
/** A crown's figure stays this far in the fire for as long as it is held. */
const CROWN_FIRE = 0.9;
/** How much each lock's puff is held back by the puffs just sent (a quick hand never floods the frame). */
const LOCK_CROWDING = 1.3;
/** A chain's fuse runs a ribbon's length in about this long (s). */
const FUSE_SECONDS = 1.15;
/** A new level's colours take this long to cross the flock (s). */
const WIPE_SECONDS = 2.4;
/** How fast the flock takes up a new level's mood (1/s). */
const MOOD_STEP_RATE = 0.55;
/** How brightly the great turn folds as it sweeps the flock. */
const GREAT_TURN = 0.8;
/** How hard the falcon's stoop parts the motes it flies through. */
const FALCON_PUSH = 30;
/** How far up and down the wings a clear's rays fan (shares of the frame's half-height), by line count. */
const BEAM_FAN = Object.freeze([0, 0.22, 0.34, 0.46]);

const FRAME_DEFAULT = Object.freeze({ halfWidth: 10.1, halfHeight: 5.68, aspect: 16 / 9 });
const GOLD = Object.freeze([1, 0.72, 0.26]);
const SILVER = Object.freeze([0.86, 0.93, 1]);

/** A CSS hex colour as linear RGB in `out`, or null. */
function hexToLinear(hex, out) {
    if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
    for (let i = 0; i < 3; i += 1) {
        const c = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
        out[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }
    return out;
}

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

        // Play's light: the fronts the mote shader draws.
        this.fronts = new FrontTable({
            rows: visual?.frontRows || null,
            count: visual?.uniforms?.uFrontCount || null,
        });
        /** The view at the focal plane (world half-size and aspect): set by the theme on resize. */
        this.frame = { ...FRAME_DEFAULT };
        // The mood: the level's step (eased) plus the clock. `moodHold` pins a mood (captures).
        this.moodStep = 0;
        this.moodHold = null;
        this.mood = moodAt(0, {});
        this._formWeights = [1, 0, 0, 0, 0];
        this._lockLoad = 0;
        this._fuse = { at: -Infinity, light: 0 };
        this._wipe = { at: -Infinity, delta: 0 };
        /** The palette the sky and the halo wear follows the motes' at its own ease. */
        this.tintPhase = 0;
        /** How far the crown has turned the flock to gold (0..1). */
        this.gold = 0;
        /** Until when the roost holds before the flock lifts by itself. */
        this._roostUntil = -Infinity;
        this.roosting = 0;
        /** The crown's shower of shooting stars. */
        this._showerAt = -Infinity;
        this._happening = happeningAt(0);
        this._falcon = {
            slot: -1, id: 0, key: -1, front: null,
        };
        this._line = [0, 0, 0];
        this._falconAt = { x: 0, y: 0, z: 0 };
        this._rgb = [1, 1, 1];
        this._base = null;

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

    /** The view at the focal plane: world half-size and aspect (the theme calls it on resize). */
    setFrame(frame) {
        if (!frame) return;
        if (frame.halfWidth > 0) this.frame.halfWidth = frame.halfWidth;
        if (frame.halfHeight > 0) this.frame.halfHeight = frame.halfHeight;
        this.frame.aspect = frame.aspect > 0 ? frame.aspect : this.frame.halfWidth / this.frame.halfHeight;
    }

    /** Send a front of light, placed from a world point on the focal plane. */
    _front(kind, at, spec) {
        return this.fronts.add({
            ...spec, kind, x: at.x - this.focal.x, y: at.y - this.focal.y,
        });
    }

    /** The swarm's hue `offset` of the way round the palette from its middle, lifted toward white. */
    _hue(offset, white = 0.35, out = this._rgb) {
        samplePalette(this.palettePhase + this.flockClock * 0.006 + offset, out);
        for (let i = 0; i < 3; i += 1) out[i] += (1 - out[i]) * white;
        return out;
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
        s.still = STILL_SHAPES.has(name);
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

    /** A twist turns the figure held once round (its twin the other way). */
    _pirouette() {
        const s = this.shape;
        if (this.reducedMotion || s.name === 'free' || s.still || !(s.target > 0)) return;
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
            flash: hard ? 0.3 : 0.2,
            decay: hard ? 1.2 : 1.5,
        });
        // The light: a puff of the piece's own colour — or, for a hard drop, the bow wave it
        // throws up and out. A quick hand is held back by what it has just sent, so a lock a
        // second is whole and four a second never flood the flock.
        const crowd = (1 + pace * 0.3) / (1 + LOCK_CROWDING * this._lockLoad);
        this._lockLoad += hard ? 1.3 : 1;
        const rgb = hexToLinear(detail.color, this._rgb) || this._hue(0.5, 0.2);
        if (hard) {
            for (let i = 0; i < 3; i += 1) rgb[i] += (1 - rgb[i]) * 0.3;
            this._front(FRONT.chevron, origin, {
                speed: 11 * (1 + pace * 0.2), width: 0.42, reach: 8.5, light: 1.25 * crowd, rgb, life: 1.0,
            });
        } else {
            this._front(FRONT.ring, origin, {
                speed: 5.2 * (1 + pace * 0.2), width: 0.36, reach: 5.2, light: 1.1 * crowd, rgb, life: 1.0,
            });
        }
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
            this._beams(detail, lines, row, 1 + lines * 0.12 + deeper * 0.2, 0.24);
            this._lightSky(0.12 * lines * (1 + deeper * 0.3));
            if (deeper > 0) this._grow(GROW.wave * deeper);
            // A twist draws its own knot below; a plain triple rolls from the whole pool.
            if (lines === 3 && !detail.twist) this.requestRandomShape(RANDOM_SHAPE_POOL, 0.5, 2.8, 1);
        }
        if (detail.twist) this._twist(detail, row);
        if (detail.b2b) this._backToBack(ring);
    }

    /** Push the ring described by `ring` (a reused record) at `strength`. */
    _pushRing(ring, strength, scale = 1) {
        this._ringAt.x = ring.x; this._ringAt.y = ring.y; this._ringAt.z = ring.z;
        // The ring is the shove; its light is the beams', so the simulation's own is a trace.
        this._push(this._ringAt, strength, null, IMPULSE_TYPE.RADIAL, {
            speed: ring.speed * (scale > 1 ? 1.15 : 1),
            width: ring.width * scale,
            flash: ring.flash * 0.2 * (scale > 1 ? 1.25 : 1),
            squash: ring.squash,
            decay: ring.decay,
        });
    }

    /**
     * A beam for each cleared row: a ray of light from the row out through both wings of the
     * flock, struck one after another. Rows clear at the foot of the board, where the flock is
     * thin, so a band at the row's own height lit almost nothing: each line's ray climbs (or
     * falls) to a height of its own in the wings instead, and the rays fan out from the rows
     * they left — one, two, three or four of them, to be counted. `kind` is FRONT.beam, or
     * FRONT.answer for the ones that come back in.
     */
    _beams(detail, lines, row, light, halfHeight, kind = FRONT.beam, delay = 0, rgb = null) {
        const rows = detail.rows && detail.rows.length ? detail.rows : null;
        const count = rows ? Math.min(4, rows.length) : lines;
        const { pace } = this;
        const { halfWidth, halfHeight: tall } = this.frame;
        const reach = Math.hypot(halfWidth, tall) + 1.5;
        const tint = rgb || this._hue(0.5, 0.45);
        const r = tint[0]; const g = tint[1]; const b = tint[2];
        // Where the rays cross the middle of a wing: spread over the flock's height.
        const across = Math.max(2.5, halfWidth * 0.62);
        const spread = tall * BEAM_FAN[Math.min(count, BEAM_FAN.length) - 1];
        for (let i = 0; i < count; i += 1) {
            const at = this._origin(detail, rows ? rows[i] : row - (count - 1) * 0.5 + i, 0.5);
            const target = this.focal.y + (count > 1 ? ((count - 1 - i) / (count - 1) - 0.5) * 2 * spread : 0);
            this._rgb[0] = r; this._rgb[1] = g; this._rgb[2] = b;
            this._front(kind, at, {
                speed: (kind === FRONT.answer ? 15 : 13) * (1 + pace * 0.15),
                width: 0.5,
                reach,
                light,
                rgb: this._rgb,
                shape: halfHeight,
                angle: Math.atan2(target - at.y, across),
                glow: 0.7,
                wake: 0.9,
                life: reach / 13 + 0.9,
                delay: delay + i * 0.05,
            });
        }
        // Remembered for a back-to-back's answer.
        this._beamsSent = {
            player: detail.player, rows: rows ? rows.slice(0, 4) : null, screen: null, lines, row, light, halfHeight,
        };
    }

    /**
     * The second difficult clear in a row: its ring is answered by a second one right behind
     * it, harder, wider and brighter — back to back — and the sky and the reward light rise.
     */
    _backToBack(ring) {
        this._lightSky(0.45);
        this.fx.rewardPulse = Math.min(1, this.fx.rewardPulse + 0.3);
        this._grow(GROW.b2b);
        // The answer: gold beams come back in along the same rows, from the frame's edges.
        const sent = this._beamsSent;
        if (sent && ring.strength > 0) {
            this._beams(sent, sent.lines, sent.row, sent.light * 1.1, sent.halfHeight, FRONT.answer, 0.34, GOLD);
        }
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
        // Four beams, wider and brighter than a triple's.
        this._beams(detail, 4, row, 1.45, 0.3);
        // Added to what is lit: a quad after a perfect clear no longer darkens its sky.
        this._lightSky(1);
        this._punch(0, 0.3, 0);
        if (!this.reducedMotion) this.camera?.dolly(0.18);
        // The flock spreads its wings. In a chain the quad does not tear the chain's figure
        // down: it grows it.
        this._spreadWings();
    }

    /**
     * The great wings: with room beside the boards they unfold from the card's edges and the
     * board is the body; without, a whole bird where the layout puts figures. False when a
     * figure of the chain is held (it grows instead).
     */
    _spreadWings() {
        if (!this.canRequestShape(2)) {
            this._grow(GROW.quad);
            return false;
        }
        const beside = this.sim?.hasRoomBeside?.() === true;
        const opts = beside ? { layout: 'center', keepDust: true, jitter: 0.05 } : { keepDust: true, jitter: 0.05 };
        return this.requestShape('wings', opts, WINGS_STRENGTH, WINGS_HOLD, 2);
    }

    _twist(detail, row) {
        const origin = this._origin(detail, row, detail.u ?? 0.5);
        const at = { x: origin.x, y: origin.y, z: origin.z };
        this._push({ x: at.x - 1.6, y: at.y, z: at.z }, 4.5, AXIS_IN, IMPULSE_TYPE.VORTEX);
        this._push({ x: at.x + 1.6, y: at.y, z: at.z }, 4.5, AXIS_OUT, IMPULSE_TYPE.VORTEX);
        // The pinwheel: three thin arms unwind out from behind the board, through both wings,
        // and turn — the whole flock is the twist's wheel. (Unwound from the piece itself, at
        // the foot of the board, it turned where the flock is thinnest and was not seen.)
        this._pinwheelWay = -(this._pinwheelWay || 1);
        this._front(FRONT.pinwheel, this.focal, {
            speed: 9,
            width: 0.3,
            reach: Math.hypot(this.frame.halfWidth, this.frame.halfHeight) * 0.92,
            light: 1.35,
            rgb: this._hue(0.42, 0.45),
            shape: 3 * this._pinwheelWay,
            life: 2.1,
            wake: 0.6,
        });
        this._lightSky(0.5);
        // A knot — or, with a figure held, the figure pirouettes and grows.
        if (!this.requestRandomShape(KNOT_SHAPES, 0.62, 3.2, 1, GROW.twist)) this._pirouette();
    }

    /** A twist that cleared nothing: two small eddies at the piece, and a turn of the figure. */
    spin(detail = {}) {
        this.surge.spin(this.time);
        const origin = this._origin(detail, SwarmShow.meanRow(detail.rows), detail.u ?? 0.5);
        const at = { x: origin.x, y: origin.y, z: origin.z };
        this._push({ x: at.x - 1.2, y: at.y, z: at.z }, 2.6, AXIS_IN, IMPULSE_TYPE.VORTEX);
        this._push({ x: at.x + 1.2, y: at.y, z: at.z }, 2.6, AXIS_OUT, IMPULSE_TYPE.VORTEX);
        // A small pinwheel of two arms: the turn without the lines.
        this._pinwheelWay = -(this._pinwheelWay || 1);
        this._front(FRONT.pinwheel, this.focal, {
            speed: 8,
            width: 0.24,
            reach: this.frame.halfWidth * 0.62,
            light: 1.15,
            rgb: this._hue(0.42, 0.45),
            shape: 2 * this._pinwheelWay,
            life: 1.4,
            wake: 0.6,
        });
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
                speed: 11, width: 0.4, flash: 0.3, decay: 0.9,
            });
            this._lightSky(1.3);
            this._punch(0, 0.4, 0);
            this.requestRandomShape(BLOOM_SHAPES, 0.9, 5.5, 3);
        });
        // The bloom's light: one wide gold ring through the whole flock, then a shower of
        // shooting stars falling away from the board.
        this._front(FRONT.ring, at, {
            speed: 12, width: 0.8, reach: this.frame.halfWidth * 1.6, light: 1.7, rgb: GOLD, life: 1.6, delay: 0.42,
        });
        this._showerAt = this.time + 0.55;
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
        // Each step of the chain gives the gyre a shove, and runs down every ribbon like a fuse.
        this._push(this._focalPoint(), Math.min(4.5, 1.5 + best * 0.3), AXIS_IN, IMPULSE_TYPE.VORTEX);
        this._fuse.at = this.time;
        this._fuse.light = Math.min(1.5, 0.55 + best * 0.1);
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
            // A rebuild or a capture: the level's palette and mood at once, no wave.
            this.palettePhase = this.palettePhaseTarget;
            this.tintPhase = this.palettePhaseTarget;
            this.moodStep = stepMood(this.moodStep, this.level, 1);
            this._wipe.delta = 0;
            return;
        }
        this.surge.levelUp(this.time);
        // The new colours cross the flock as ONE wave: the motes take the new palette at once,
        // and ahead of the wave's front they still wear the old one.
        this._wipe.delta = this.palettePhaseTarget - this.palettePhase
            + (this.time - this._wipe.at < WIPE_SECONDS ? this._wipe.delta : 0);
        this._wipe.at = this.time;
        this.palettePhase = this.palettePhaseTarget;
        this._push(this._focalPoint(), 4, null, IMPULSE_TYPE.RADIAL, {
            speed: 5, width: 0.5, flash: 0.2, decay: 0.6,
        });
        this._lightSky(0.5);
        this._grow(GROW.level);
    }

    /**
     * The run is over: the flock comes down to roost along the foot of the frame, where a
     * murmuration ends its evening. It is held until the next run starts — or, so that no menu
     * ever stands over a dead sky, until it lifts again by itself.
     */
    gameOver() {
        if (!this.reducedMotion) this.camera?.pullBack(0.6);
        // (The dust stays in the air: a ghost of the flock still wheels over the roost.)
        this.requestShape('roost', { layout: 'center', jitter: 0.1, keepDust: true }, ROOST_STRENGTH, Infinity, 5);
        this._roostUntil = this.time + ROOST_HOLD;
        // One last slow fold of light goes down through the flock with it.
        const top = { x: this.focal.x, y: this.focal.y + this.frame.halfHeight * 1.5, z: this.focal.z };
        this._front(FRONT.ring, top, {
            speed: 4.2, width: 1.1, reach: this.frame.halfHeight * 4, light: 0.55, rgb: this._hue(0.1, 0.5), life: 3.2,
        });
    }

    /** True while the flock is down (or coming down) at the roost. */
    isRoosting() {
        return this.shape.name === 'roost' && this.shape.target > 0;
    }

    /**
     * A new run. From the roost the flock lifts in a rush; either way a fold of first light
     * rises through it.
     */
    gameStart() {
        const roosting = this.isRoosting();
        this.resetSession();
        const below = { x: this.focal.x, y: this.focal.y - this.frame.halfHeight * 1.35, z: this.focal.z };
        if (roosting) {
            this._push(below, 16, null, IMPULSE_TYPE.RADIAL, {
                speed: 8, width: 2.4, flash: 0, decay: 0.8,
            });
        }
        this._front(FRONT.ring, below, {
            speed: 8.5,
            width: 0.9,
            reach: this.frame.halfHeight * 4.2,
            // (From the roost the flock is packed along the frame's foot: a gentler light there.)
            light: roosting ? 0.5 : 0.55,
            rgb: this._hue(0.5, 0.55),
            life: 2.0,
        });
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
        this._roostUntil = -Infinity;
        this._beamsSent = null;
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
        this.tintPhase = 0;
        this.moodStep = 0;
        this.moodNow = 0;
        this.skyFlash = 0;
        this.skyPulse = 0;
        this.shapeColor = 0;
        this.fire = 0;
        this.gold = 0;
        this.roosting = 0;
        this.flockLead = 0;
        this.flockClock = this.time;
        this.fronts.clear();
        this._lockLoad = 0;
        this._fuse.at = -Infinity;
        this._wipe.at = -Infinity;
        this._wipe.delta = 0;
        this._showerAt = -Infinity;
        this._falcon.slot = -1;
        this._falcon.front = null;
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
        if (this.shape.priority === 3 && this.shape.target > 0) heatGoal = Math.max(heatGoal, CROWN_HEAT);
        this.heat = ease(this.heat, heatGoal, heatGoal > this.heat ? HEAT_RISE : HEAT_FALL, dt);
        fx.stageHeat = this.heat;
        // (A level's wave snaps the motes' palette and carries the change itself; this eases
        // whatever else moved it, and the sky's tints behind it.)
        this.palettePhase = ease(this.palettePhase, this.palettePhaseTarget, 1.1, dt);
        this.tintPhase = ease(this.tintPhase, this.palettePhaseTarget, 1.1, dt);
        this._lockLoad *= Math.exp(-dt);
        if (time - this._wipe.at >= WIPE_SECONDS) this._wipe.delta = 0;
        // In a fever the figure held catches the sunset; the crown burns it gold, and its
        // figure stays gold for as long as it stands.
        const crowned = this.shape.priority === 3 && this.shape.target > 0;
        const fireGoal = Math.max(smooth01((surge.fever - 0.2) / 0.6), crown, crowned ? CROWN_FIRE : 0);
        this.fire = ease(this.fire, fireGoal, fireGoal > this.fire ? 1.4 : 0.5, dt);
        // … and gold through and through while the crown stands.
        const goldGoal = Math.max(crown, crowned ? 1 : 0);
        this.gold = ease(this.gold, goldGoal, goldGoal > this.gold ? 2.6 : 0.7, dt);
        // The flock's clock runs ahead with the play: its banking ripples come sooner.
        this.flockLead += dt * FLOCK_QUICKEN * pace * calm;
        this.flockClock = time + this.flockLead;
        const drift = this.flockClock * 0.006;

        // The mood: the level's step, eased the short way round, plus the clock.
        this.moodStep = stepMood(this.moodStep, this.level, 1 - Math.exp(-MOOD_STEP_RATE * dt));
        const moodNow = this.moodHold === null ? moodPhase(this.moodStep, time) : this.moodHold;
        const mood = moodAt(moodNow, this.mood);
        this.moodNow = moodNow;

        // Formation state.
        const { shape } = this;
        // The roost lifts by itself after a while: no menu stands over a dead sky.
        if (shape.name === 'roost' && shape.target > 0 && time >= this._roostUntil) this.releaseShape();
        this.roosting = ease(this.roosting, this.isRoosting() ? 1 : 0, 0.9, dt);
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
        let yaw = (shape.turning ? shape.phase * 0.42 : Math.sin(shape.phase * 0.7) * 0.2) + shape.spin;
        if (shape.still) yaw = 0;
        const scaleGoal = 1 + shape.growth * GROW_SCALE + this._breath.valueAt(time) * BREATH_SCALE * calm;
        shape.scale = ease(shape.scale, shape.name === 'free' ? 1 : scaleGoal, 6, dt);

        // The flock: the mood sets its pace, the chain spins the gyre up, play stirs it.
        this.simParams.turbulence = (this.baseTurbulence + fx.comboIntensity * 0.4 + this.heat * 0.25 + pace * 0.1)
            * mood.turb;
        this.simParams.gyre = this.baseGyre * mood.gyre * (1 + this.heat * 1.6 + fx.comboIntensity * 0.7 + pace * 0.4);

        const { sim, visual, sky } = this;
        if (sim) {
            sim.setShapeStrength(shape.level);
            sim.setShapePose?.(shape.name === 'free' ? 0 : yaw, shape.name === 'free' ? 1 : shape.scale);
            // The wings beat (slower and smaller under reduced motion).
            const beat = shape.name === 'wings' ? WING_SWING * calm * Math.min(1, shape.level * 2) : 0;
            sim.setShapeFlap?.(shape.phase * WING_BEAT, beat);
            // The mood's form, flow and lean.
            const form = moodForm(mood, time, this.frame.aspect, this._formWeights);
            sim.setForm?.(form[0], form[1], form[2], form[3], form[4]);
            sim.uTilt?.value.set(mood.tiltX, mood.tiltY);
            sim.uFlowGains?.value.set(mood.coarse, mood.fine);
        }
        this._happen(time, dt);
        this.fronts.update(time);
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
            if (u.uCrown) u.uCrown.value = this.gold;
            // A formation packs the swarm into a figure a quarter of its size; take the
            // exposure down with it, or the figure is a slab of white instead of motes (a figure
            // that has grown, in hot play, is let a little brighter, so a chain's figure never
            // reads dimmer than the flock it was drawn from). A hot swarm is a fast one, and
            // fast motes are bright ones: hold the total back so a long chain turns the swarm
            // gold instead of bleaching it.
            // (The wings span the whole frame, so they are packed far less; the roost is a
            // strip along its foot, packed far more, and glows like embers going out.)
            const wide = shape.name === 'wings' ? 0.36 : 0;
            const relax = 1 - shape.growth * 0.25 - pace * FIGURE_LIFT - wide;
            u.uExposure.value = (visual.baseExposure ?? 1) * (1 - held * 0.66 * relax) * (1 - this.heat * 0.3)
                * (1 - this.roosting * 0.2);
            // The mood: how long the trails are, how many hues the flock wears, how the turn folds.
            const base = this._base || (this._base = {
                stretch: u.uStretch?.value ?? 0.1, span: u.uPaletteSpan?.value ?? PALETTE_SPAN,
            });
            if (u.uStretch) u.uStretch.value = base.stretch * mood.stretch;
            if (u.uPaletteSpan) u.uPaletteSpan.value = base.span * (mood.span / MOODS[0].span);
            if (u.uTurn) u.uTurn.value = mood.turn * (1 + pace * TURN_LIFT);
            // A chain's fuse, and a level's wave of colour.
            if (u.uFuse) {
                const ran = (time - this._fuse.at) / FUSE_SECONDS;
                u.uFuse.value.set(ran * 1.15 - 0.05, ran >= 0 && ran < 1 ? this._fuse.light * (1 - ran * ran) : 0);
            }
            if (u.uWipe) {
                const ran = (time - this._wipe.at) / WIPE_SECONDS;
                const live = ran >= 0 && ran < 1;
                const tallFrame = this.frame.aspect < 0.85;
                const reach = (tallFrame ? this.frame.halfHeight : this.frame.halfWidth) + 2.6;
                const turn = this._happening;
                if (live) {
                    const crest = Math.sin(Math.PI * Math.min(1, ran * 1.15)) * 0.9;
                    u.uWipe.value.set((ran * 2 - 1) * reach, this._wipe.delta, crest);
                    u.uWipeAxis?.value.set(tallFrame ? 0 : 1, tallFrame ? 1 : 0);
                } else if (turn.kind === 'turn' && turn.live && !this.isRoosting()) {
                    // The great turn: the same front without a change of colour, from a bearing
                    // of its own, end to end through the whole flock.
                    const done = turn.age / turn.length;
                    const bearing = turn.seed * Math.PI * 2;
                    const across = Math.hypot(this.frame.halfWidth, this.frame.halfHeight) + 2.6;
                    u.uWipe.value.set((done * 2 - 1) * across, 0, Math.sin(Math.PI * done) * GREAT_TURN * calm);
                    u.uWipeAxis?.value.set(Math.cos(bearing), Math.sin(bearing));
                } else {
                    u.uWipe.value.set(reach * 4, 0, 0);
                }
            }
        }
        // The board's halo and the sky are lit by the swarm, so they warm as it does — along
        // the same turn of hue the motes take (shader: murm_turnHue).
        const warmth = heatWarmth(this.heat, keepsOwn);
        samplePalette(this.tintPhase + drift + PALETTE_SPAN * 0.3, this.haloTint);
        turnHue(this.haloTint, FIRE.amber, warmth, this.haloTint);
        this.skyPulse = fx.comboPulse * (1 - SKY_HOLD * pace) + SKY_GLOW * pace;
        if (sky?.uniforms) {
            const u = sky.uniforms;
            u.uHeat.value = this.heat;
            u.uPulse.value = this.skyPulse;
            if (u.uFlash) u.uFlash.value = this.skyFlash * flashScale();
            // The mood's sky; with the flock at roost the gas sinks and the stars come out.
            u.uMood?.value.set(
                mood.nebula * (1 - this.roosting * 0.35),
                mood.stars * (1 + this.roosting * 0.5),
                mood.dusk,
                mood.violet,
            );
            this._writeSky(time);
            if (u.uTintA && u.uTintB) {
                const a = turnHue(
                    samplePalette(this.tintPhase + drift - PALETTE_SPAN * 0.2, this._tint),
                    FIRE.ember,
                    warmth * 0.8,
                    this._tint,
                );
                u.uTintA.value.setRGB(a[0] * 0.7, a[1] * 0.7, a[2] * 0.7);
                const b = turnHue(
                    samplePalette(this.tintPhase + drift + PALETTE_SPAN * 0.75, this._tint),
                    FIRE.gold,
                    warmth * 0.8,
                    this._tint,
                );
                u.uTintB.value.setRGB(b[0] * 0.7, b[1] * 0.7, b[2] * 0.7);
            }
            if (u.uWingA && u.uWingB) {
                // The hues the renderer gives the middle of each wing (seven units out).
                const at = this.tintPhase + drift;
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

    // ── things that happen by themselves ────────────────────────────────────────

    /**
     * The clock's happenings. The sky's (a shooting star, a shower) and the flock's great turn
     * are closed forms of the happening's age (`_writeSky`, and the wave of light in update());
     * the falcon is the one that needs the simulation: a hard little push that flies a straight
     * line through one wing, with a silver flare on the motes it parts. Armed on the first
     * frame inside its own window, so a seek into the middle of a stoop still shows it.
     */
    _happen(time, dt) {
        const h = happeningAt(time, this._happening);
        const falcon = this._falcon;
        // Not under reduced motion, and not while a figure stands or the play is hot: the flock is busy.
        const flying = h.kind === 'falcon' && h.live && !this.reducedMotion
            && !(this.shape.target > 0) && this.surgeState.stage < 2;
        const at = this._falconAt;
        if (!flying) {
            // The stoop is over (or called off): let go of the push and the flare.
            if (falcon.key >= 0) {
                at.x = 0; at.y = 0; at.z = 0;
                this.sim?.steerImpulse?.(falcon.key, falcon.id, at, 0);
                falcon.key = -1;
            }
            if (falcon.front) {
                if (falcon.front.live && falcon.front.speed === 0) falcon.front.life = 0;
                falcon.front = null;
            }
            return;
        }
        const done = h.age / h.length;
        falconPath(h.seed, done, this.frame, at);
        at.x += this.focal.x; at.y += this.focal.y; at.z = this.focal.z;
        const strength = FALCON_PUSH * Math.sin(Math.PI * Math.min(1, done * 1.1));
        const held = falcon.slot === h.slot && falcon.key >= 0
            && this.sim?.steerImpulse?.(falcon.key, falcon.id, at, strength) === true;
        if (!held && dt >= 0) {
            // Its own tight push: a wave that stands still and does not fade, steered every frame.
            const key = this._push(at, strength, null, IMPULSE_TYPE.RADIAL, {
                radius: 0, width: 1.1, speed: 0, flash: 0, decay: 0,
            });
            falcon.key = Number.isInteger(key) ? key : -1;
            falcon.id = falcon.key >= 0 ? (this.sim?.impulseId?.(falcon.key) ?? 0) : 0;
        }
        if (falcon.slot !== h.slot) {
            falcon.slot = h.slot;
            falcon.front = this._front(FRONT.ring, at, {
                speed: 0, width: 0.6, reach: 2.4, light: 0.9, rgb: SILVER, life: h.length - h.age, attack: 0.25,
            });
        }
        if (falcon.front && falcon.front.live) {
            falcon.front.x = at.x - this.focal.x;
            falcon.front.y = at.y - this.focal.y;
        }
    }

    /** Shooting stars: written from the happening's age, never from a timer. */
    _writeSky(time) {
        const { sky } = this;
        const rows = sky?.meteorRows;
        const u = sky?.uniforms;
        if (!u) return;
        const h = this._happening;
        const { aspect } = this.frame;
        let live = 0;
        const line = this._line;
        if (rows) {
            const put = (seed, age) => {
                if (live >= rows.length || !(age >= 0) || age >= 1.15) return;
                meteorLine(seed, aspect, line);
                rows[live].set(line[0], line[1], line[2], age);
                live += 1;
            };
            if (h.kind === 'meteor' && h.live) put(h.seed, h.age);
            if (h.kind === 'shower' && h.live) {
                // Five, a second apart, each on a line of its own.
                for (let i = 0; i < 5; i += 1) put(h.seed + i * 0.173 + 0.31, h.age - i * 1.05);
            }
            // The crown's shower: six at once, falling away from the board to both sides.
            const since = time - this._showerAt;
            if (since >= 0 && since < 2.2) {
                for (let i = 0; i < 6; i += 1) put(0.07 + i * 0.151 + this._crownedAt * 0.013, since - i * 0.14);
            }
            if (u.uMeteorCount) u.uMeteorCount.value = live;
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
            growth: this.shape.growth,
            skyFlash: this.skyFlash,
            surge: this.surgeState.level,
            fever: this.surgeState.fever,
            fire: this.fire,
            queued: this._queue.length,
            mood: this.moodNow ?? 0,
            fronts: this.fronts.pending(),
            roosting: this.isRoosting(),
            happening: this._happening.live ? this._happening.kind : null,
        };
    }

    dispose() {
        this._queue.length = 0;
        this.combos.clear();
        this.fronts.clear();
        this.fronts.attach(null, null);
        this.sim = null;
        this.visual = null;
        this.sky = null;
        this.camera = null;
        this.locate = null;
    }
}
