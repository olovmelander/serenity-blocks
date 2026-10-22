/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Moonlit Greenhouse — the night garden under glass: the world.
 *
 * The eye stands on a little landing at the head of a lily canal that runs down the middle of a
 * Victorian palm house and looks along it. The full moon stands beyond the glass to the left of
 * the card (above it on an upright phone); its light falls through the iron and glass of the
 * pointed vault, so the lattice of the glazing lies across the floor, the leaves and the water,
 * and every beam in the mist (drawn by the post stack) carries it. Everything is built here and
 * shared with the playground effect (src/playground/effects/moonlit-greenhouse.effect.js), so
 * what is iterated there ships.
 *
 * Parts (showOnlyParts names): see MOONLIT_GREENHOUSE_PARTS.
 *
 * Every part is built from ONE context, { tier, U, noise, plan, seed }, and may be handed the
 * world each frame (part.update(world)); parts read the uniforms in U and never write them. The
 * world owns every value.
 *
 * What the board does to it:
 *   lock        a seed of light in the piece's colour leaves the card's edge at the piece's
 *               height and arcs into the garden beside the card (lower pieces nearer, columns
 *               further from the middle further out); where it lands a night flower opens in
 *               that colour, in the beds, or a water lily on the canal with a ring running out.
 *   hard drop   the house shudders: a curtain of dew shakes loose from the glass and falls
 *               glittering through the beams; the bloom opens larger and the ring is stronger.
 *   clear       the garden exhales: each cleared row releases a ribbon of fireflies from the
 *               card's edges into the garden; a wave of moonlight runs across the glazing pane by
 *               pane, one front a line; the oldest blooms give up their pollen, which rises
 *               through the beams to the glass, and close.
 *   combo       the fireflies fall into step (their own rhythms, then rolling waves down the
 *               house, then one flash); the swarm thickens; bioluminescent moss climbs the iron
 *               columns a step a link; the lanterns burn up. The chain breaking lets it all go.
 *   T-spin      a turn of the air: the fireflies, the moths, the motes and the pollen wheel
 *               round the canal and the fronds sway.
 *   four lines  the house holds its breath: a cloud crosses the moon, every light sinks, the
 *               fireflies go dark. Then the Queen of the Night opens behind the card, her long
 *               white petals reaching out round it; moonlight floods every pane and every
 *               firefly flashes at once. A perfect clear opens a second whorl and rings the moon.
 *   level up    the night moves one step along the wheel of six (moonlit-greenhouse-core.js
 *               NIGHTS); the clock alone drifts it there too, and the moon drifts with the clock.
 *   back-to-back the moon answers: its beams blaze through the glass and a ring of moonlight runs
 *               out over the panes from the moon itself (higher and wider for each in a row).
 *   cascade     each wave's fronts run brighter and faster than the last, turning to the canal's
 *               glow, and release more fireflies.
 *
 * Nothing restarts: every flash, jolt, flood and turn ADDS to what is still lit or moving
 * (src/themes/shared/swell.js), and the house remembers how hot play runs
 * (src/themes/shared/gameplay-surge.js, sampled once a frame in update()). Calm, it is the house
 * at rest. Warm, it takes notice: more of the swarm comes out, the lanterns burn up, the clears
 * leave their blooms open so the beds fill with colour. Hot, it is alive with the player: the
 * fireflies start pulsing together, the fronds stir, the beams stand out in the mist. Fever, the
 * house sings: the swarm flashes as one, and on every beat a front of the canal's glow rolls down
 * the glass with it while the moss pulses up the columns, the lanterns blaze and the sky clears
 * to its stars. The quad then only inhales (its hush is as deep as play is cold), the Queen opens
 * and the full garden gives up all its pollen at once; the perfect clear crowns her. When the
 * hands rest it all breathes back to the quiet house.
 */
import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import {
    ARC, DEG, EYE, FLASH, FLOOR, GLAZING, HOUSE, MOON_RADIUS, NIGHTS, NIGHT_COLOURS, NIGHT_SECONDS, TIMING, approach,
    clamp, clamp01, groundAt, houseExit, lerp, moonDrift, mossForCombo, mulberry32, nightAt, pieceLight, skyDirection,
    smooth, swarmFlash, swarmForCombo, syncForCombo, vaultHeightAt,
} from './moonlit-greenhouse-core.js';
import { tierFor } from './moonlit-greenhouse-quality.js';
import { LANTERN_FLAME_DROP, palmCrownCentre, planGarden } from './moonlit-greenhouse-plan.js';
import {
    REST_RIG, aimLanding, aimLeave, boardFor, boardPoint, cardFor, fallbackLayout, fovForAspect, frameFor,
} from './moonlit-greenhouse-composition.js';
import { createGardenNoise, createNight, tune } from './moonlit-greenhouse-tsl.js';
import { createGlass } from './moonlit-greenhouse-glass.js';
import { createIron } from './moonlit-greenhouse-iron.js';
import { createFloor } from './moonlit-greenhouse-floor.js';
import { createLanterns } from './moonlit-greenhouse-lanterns.js';
import {
    createFerns, createLeaves, createPalms, createVines,
} from './moonlit-greenhouse-flora.js';
import { createPads, createReeds, createWater } from './moonlit-greenhouse-pond.js';
import {
    DEW, createDew, createFireflies, createMoths, createMotes, dropFall, turnOfTheAirAt,
} from './moonlit-greenhouse-air.js';
import { createBlooms, createQueen } from './moonlit-greenhouse-blooms.js';
import { createGlows } from './moonlit-greenhouse-glows.js';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { drainSteps } from '../shared/build-steps.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';

export { REST_RIG, fovForAspect };

/** The parts a capture can show alone. */
export const MOONLIT_GREENHOUSE_PARTS = Object.freeze([
    'glass', 'iron', 'floor', 'lanterns', 'palms', 'ferns', 'leaves', 'vines', 'water', 'pads', 'reeds',
    'fireflies', 'moths', 'motes', 'dew', 'blooms', 'queen', 'glows',
]);

const byScore = (a, b) => b.score - a.score;

/** The Queen of the Night's whole life: opening, holding, closing (seconds). */
const QUEEN_LIFE = TIMING.queenOpen + TIMING.queenHold + TIMING.queenClose;

/** How old (seconds) a Queen opening from shut would be at openness `open` (the opening curve, inverted). */
function openingAge(open) {
    let lo = 0;
    let hi = TIMING.queenOpen;
    for (let i = 0; i < 18; i += 1) {
        const mid = (lo + hi) / 2;
        if (smooth(0, TIMING.queenOpen, mid) < open) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

/** How long a level's step along the wheel of nights takes to arrive (seconds). */
const NIGHT_TURN = 7;

/**
 * `from` moved by whole turns of the wheel to within half a turn of `to`, so the ease between
 * them goes the short way round: a new run after level 15 turns two nights back, not fourteen.
 */
function nearOnWheel(from, to) {
    const n = NIGHTS.length;
    return to + ((((from - to) % n) + n * 1.5) % n) - n / 2;
}
/** Seconds of trail a seed of light leaves behind it, and the points it is drawn with. */
const SEED_TRAIL = 0.16;
const SEED_POINTS = 12;
/** A cleared row's fireflies: how many a row (each side), and how long they glow once out. */
const STREAM_FLIERS = 9;
const STREAM_LINGER = 2.4;
/** Pollen a released bloom gives up. */
const POLLEN_MOTES = 7;
/** Shares of the tier's glows the cleared rows' fireflies and the pollen may hold. */
const FLIER_SHARE = 0.45;
const POLLEN_SHARE = 0.3;
/**
 * Over this share of their budget the oldest fireflies or pollen fade out over FADE_OUT seconds
 * instead of vanishing mid-flight.
 */
const SOFT_SHARE = 0.8;
const FADE_OUT = 0.35;
/** A time no event reaches. */
const NEVER = Infinity;

/** How far round (radians) a T-spin turns the air, and how many turns can run at once. */
const TURN_ANGLE = Math.PI * 1.2;
const TURN_SLOTS = 3;
/** A T-spin that cleared nothing turns it this share of that. */
const SPIN_TURN = 0.4;

/**
 * How long a hard drop's curtain of dew takes to come down: its last drop's release (the shake,
 * and the curtain loosened outward from the middle), its fall from under the ridge to the canal,
 * and its splash. A curtain still falling is never restarted (see shakeDew).
 */
const DEW_SPAN = DEW.shake + 0.15
    + dropFall(vaultHeightAt(0) - 0.2, FLOOR.canal.water, DEW.terminal[0], 0, DEW.kick[0]).lands + DEW.splash;
/** What each hard drop on a falling curtain adds to its glitter (up to DEW.most). */
const DEW_ADD = 0.15;

/**
 * Past `soft` × `most` the oldest in `list` (oldest first) begin to fade (fadeAt = now); past
 * `most` the oldest go at once (the glows' buffer is the hard limit).
 */
function cull(list, most, now) {
    if (list.length > most) list.splice(0, list.length - most);
    const over = list.length - Math.floor(most * SOFT_SHARE);
    for (let i = 0; i < over; i += 1) {
        if (list[i].fadeAt > now) list[i].fadeAt = now;
    }
}

/** How much of a fade-out started at `fadeAt` is left at `now` (1 before it starts). */
const fadeLeft = (fadeAt, now) => (now <= fadeAt ? 1 : 1 - smooth(0, FADE_OUT, now - fadeAt));

const tmpRay = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpP = new THREE.Vector3();

/** A point on a quadratic arc from a to c over the control b, at s in 0..1. */
function arcPoint(a, b, c, s, out) {
    const t = 1 - s;
    out.x = t * t * a.x + 2 * t * s * b.x + s * s * c.x;
    out.y = t * t * a.y + 2 * t * s * b.y + s * s * c.y;
    out.z = t * t * a.z + 2 * t * s * b.z + s * s * c.z;
    return out;
}

export class MoonlitGreenhouseWorld {
    /**
     * @param {object} p
     * @param {THREE.Scene} p.scene
     * @param {string} [p.quality='High']
     * @param {boolean} [p.capture=false]   built for a deterministic capture (reported in getState)
     * @param {number} [p.seed]
     * @param {number} [p.night]   hold the night at this place on the wheel, whatever the level
     *                             and the clock say (0 silver moon, 1 lavender, … 2.5 half-way)
     * @param {object} [p.tune]    overrides for TUNE (the playground's P.<name>=)
     * @param {object} [p.renderer]  unused (kept for the adapter's contract)
     */
    constructor({
        scene, quality = 'High', capture = false, seed = 1861, night = null, tune: overrides = null,
    }) {
        tune(overrides);
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture === true;
        this.seed = seed;
        this.rand = mulberry32(seed);
        this.group = new THREE.Group();
        this.group.name = 'moonlit-greenhouse-world';
        this.parts = {};
        this.updating = [];
        this.camera = null;
        this.aspect = 16 / 9;
        this.viewport = { w: 1920, h: 1080 };
        this.layout = null;
        this.reducedMotion = false;
        /** The frame's time (the camera breathes on it) and the world's own clock. */
        this.time = 0;
        this.clock = 0;
        this.frame = frameFor(this.aspect, null);
        this.night = {
            from: 0, to: 0, at: -100, pin: Number.isFinite(night) ? night : null,
        };
        this.light = nightAt(0);
        this.nightRows = NIGHT_COLOURS.map(() => new THREE.Vector4(0, 0, 0, 0));
        this.lanternRowsV = Array.from({ length: 8 }, () => new THREE.Vector4(0, -100, 0, 0));
        this.bloomRowsV = Array.from({ length: 16 }, () => new THREE.Vector4(0, -100, 0, 0));
        this.ringRowsV = Array.from({ length: this.tier.rings * 2 }, () => new THREE.Vector4(0, 0, -100, 0));
        this.waveRowsV = Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, -100, 0));
        this.crownRowsV = Array.from({ length: this.tier.crowns * 2 }, () => new THREE.Vector4(0, -100, 0, 1));
        this.U = {
            time: uniform(0),
            night: createNight(uniformArray(this.nightRows, 'vec4')),
            moon: uniform(new THREE.Vector3(-0.4, 0.36, -0.84).normalize()),
            moonNdc: uniform(new THREE.Vector2(-0.5, 0.6)),
            moonNdcRadius: uniform(0.06),
            moonRight: uniform(new THREE.Vector3(1, 0, 0)),
            moonUp: uniform(new THREE.Vector3(0, 1, 0)),
            moonSize: uniform(Math.sin(MOON_RADIUS * DEG)),
            /** The bay (index along the house, side −1/+1) the eye sees the moon through: its blind is up. */
            moonBay: uniform(new THREE.Vector2(-1000, -1)),
            aspect: uniform(16 / 9),
            moonCover: uniform(0),
            moonLight: uniform(1),
            stars: uniform(1),
            cloud: uniform(0.35),
            cloudDrift: uniform(new THREE.Vector2(0, 0)),
            lanternRows: uniformArray(this.lanternRowsV, 'vec4'),
            lanternCount: uniform(0),
            lanternGain: uniform(1),
            bloomLights: uniformArray(this.bloomRowsV, 'vec4'),
            bloomLightCount: uniform(0),
            crowns: uniformArray(this.crownRowsV, 'vec4'),
            crownCount: uniform(0),
            sync: uniform(0),
            swarm: uniform(0.42),
            fireflyGlow: uniform(0),
            /** How bright the swarm burns: 1 at rest, more as play heats (see update()). */
            swarmGain: uniform(1),
            moss: uniform(0),
            mossGlow: uniform(0),
            gust: uniform(0),
            turn: uniform(new THREE.Vector4(0, 0, 0, -8)),
            rings: uniformArray(this.ringRowsV, 'vec4'),
            ringCount: uniform(0),
            paneWaves: uniformArray(this.waveRowsV, 'vec4'),
            paneWaveCount: uniform(0),
            flood: uniform(0),
            queen: uniform(new THREE.Vector4(0, 0, -100, 0)),
            // The Queen of the Night's light: her heart (xyz) and the reach of her light (w, 0 when
            // she is closed), for what draws her apart from the blooms (her glow on the water).
            queenLight: uniform(new THREE.Vector4(0, -100, 0, 0)),
            dew: uniform(new THREE.Vector4(-100, 0, 0, 0)),
            pixelAngle: uniform(0.0008),
            eye: uniform(new THREE.Vector3(EYE.x, EYE.y, EYE.z)),
            hush: uniform(0),
        };
        this.ringCount = 0;
        this.waves = [];
        /** Seeds of light in flight: { from, ctrl, to, t0, t1, rgb, hard, onWater, bloom }. */
        this.seeds = [];
        /** Fireflies released by cleared rows: { from, ctrl, to, t0, t1, rgb, seed }. */
        this.fliers = [];
        /** Pollen rising from released blooms: { x, y, z, t0, rgb, seed, fadeAt }. */
        this.pollen = [];
        /** The turns of the air in flight (T-spins): when each began and what share of a turn. */
        this.turns = Array.from({ length: TURN_SLOTS }, () => ({ at: -100, amp: 0 }));
        /**
         * Envelopes that ACCUMULATE (src/themes/shared/swell.js): a new event adds to what is
         * still lit and never restarts it. The post flash; the lens's jolt on a hard drop; the
         * moonlight flooding the panes (four lines, a perfect clear); the moon's answer to a
         * back-to-back.
         */
        this.flash = new Swell({ release: 0.25, ceiling: 0.45, knee: 0.3 });
        this.kick = new Swell({ release: 1 / 9, ceiling: 1.6, knee: 1.1 });
        this.flood = new Swell({
            attack: 0.15, release: 1.4, ceiling: 1.15, knee: 0.85,
        });
        this.moonCall = new Swell({
            attack: 0.08, release: 1.8, ceiling: 1.8, knee: 1.2,
        });
        /**
         * How hot play runs (src/themes/shared/gameplay-surge.js), fed by the events below and
         * sampled once a frame on the world's clock: the house wakes with it (see update()).
         */
        this.surge = new GameplaySurge();
        this.heat = this.surge.sample(-100);
        /** Where the eye sees the moon through the glazing (along the house, metres of arc). */
        this.moonPane = { along: -30, s: ARC.length };
        this._tint = [1, 1, 1];
        this.state = {
            combo: 0,
            level: 1,
            sync: 0,
            moss: 0,
            swarm: swarmForCombo(0),
            lanternKick: 0,
            gust: 0,
            hushAt: -100,
            hushDepth: 1,
            queenAt: -100,
            queenSpinAt: -100,
            perfectAt: -100,
            queenPerfect: false,
            turnBase: 0,
            turnSign: 1,
            dewAt: -100,
            dewGain: 0,
            dewShown: 0,
            dewNextAt: NEVER,
            dewNextGain: 0,
            beat: -1,
            locks: 0,
            clears: 0,
            blooms: 0,
            released: 0,
            queens: 0,
            pitch: null,
        };
        this.moonScreen = { x: 0.24, y: 0.2, visible: 1 };
        this._point = { x: 0.5, y: 0.5 };
        this._landing = { x: 0.5, y: 0.9 };
        this._leave = { x: 0.5, y: 0.5 };
        this._jitter = [0, 0];
        this._released = [];
        this._seedP = { x: 0, y: 0, z: 0 };
        this._exit = {
            t: 0, along: 0, s: 0, wall: false, side: -1,
        };
        this._dir = { x: 0, y: 0, z: -1 };
        this._drift = { az: 0, el: 0 };
        this._scored = [];
        this._post = {
            exposure: 1,
            flash: 0,
            bloomBoost: 0,
            moonX: 0.24,
            moonY: 0.2,
            moonVisible: 1,
            shafts: 1,
            hush: 0,
            flood: 0,
            gradeShadow: [0, 0, 0],
            gradeLight: [1, 1, 1],
            time: 0,
        };
        const fov = fovForAspect(this.aspect);
        this.restLens = new THREE.PerspectiveCamera(fov, this.aspect, REST_RIG.near, REST_RIG.far);
        this.applyNight();
    }

    build() {
        drainSteps(this.buildSteps());
        return this;
    }

    /**
     * The build as steps, the plan and then a part to a step: run at once by build(), or with a
     * breath between steps while the theme comes in (shared/build-steps.js), so no single task
     * holds the page for the whole build. The same parts in the same order.
     */
    * buildSteps() {
        const { tier, U } = this;
        this.noise = createGardenNoise(tier.noise);
        this.plan = planGarden(tier, this.seed);
        yield 'plan';
        const ctx = {
            tier, U, noise: this.noise, plan: this.plan, seed: this.seed,
        };
        this.ctx = ctx;
        const make = {
            glass: createGlass,
            iron: createIron,
            floor: createFloor,
            lanterns: createLanterns,
            palms: createPalms,
            ferns: createFerns,
            leaves: createLeaves,
            vines: createVines,
            water: createWater,
            pads: createPads,
            reeds: createReeds,
            fireflies: createFireflies,
            moths: createMoths,
            motes: createMotes,
            dew: createDew,
            blooms: createBlooms,
            queen: createQueen,
        };
        for (const name of Object.keys(make)) {
            this.parts[name] = make[name](ctx);
            yield name;
        }
        this.parts.glows = createGlows({ capacity: tier.glows, U });
        Object.values(this.parts).forEach((part) => this.group.add(part.mesh));
        this.scene.add(this.group);
        // The parts that change every frame (the blooms and the glows are driven by the world itself).
        this.updating = Object.keys(this.parts)
            .filter((name) => name !== 'blooms' && name !== 'glows' && typeof this.parts[name].update === 'function')
            .map((name) => this.parts[name]);
        // The lanterns' lights: the nearest to the eye, as many as the tier adds up, in whole
        // pairs (two identical lanterns side by side, only one of them lighting its surroundings,
        // would show).
        const most = Math.floor(Math.min(tier.lights, this.lanternRowsV.length) / 2) * 2;
        const lit = [...this.plan.lanterns].sort((a, b) => b.z - a.z).slice(0, most);
        this.litLanterns = lit;
        lit.forEach((l, i) => this.lanternRowsV[i].set(l.x, l.y - LANTERN_FLAME_DROP, l.z, 1));
        U.lanternCount.value = lit.length;
        this.crownCentres = this.plan.palms.map((palm) => palmCrownCentre(palm));
        this._crownMoon = new THREE.Vector3(0, -1, 0);
        this._turned = { x: 0, y: 0, z: 0 };
        this.pickCrowns();
    }

    bindCamera(camera) {
        this.camera = camera;
        camera.near = REST_RIG.near;
        camera.far = REST_RIG.far;
        camera.fov = fovForAspect(this.aspect);
        camera.updateProjectionMatrix();
        this.updateCamera(camera, {
            time: this.time, delta: 0, pointerX: 0, pointerY: 0,
        });
    }

    /** Drawing-buffer size (pixels) and the CSS aspect. */
    setViewport(bufferWidth, bufferHeight, aspect) {
        this.viewport.w = Math.max(1, bufferWidth);
        this.viewport.h = Math.max(1, bufferHeight);
        if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
        const fov = fovForAspect(this.aspect);
        this.U.pixelAngle.value = (2 * Math.tan((fov * DEG) / 2)) / this.viewport.h;
        this.U.aspect.value = this.aspect;
        if (this.camera) {
            this.camera.fov = fov;
            this.camera.aspect = this.aspect;
            this.camera.updateProjectionMatrix();
        }
        frameFor(this.aspect, this.layout, this.frame);
    }

    /** The live gameplay rects (screen fractions), or null when no board is on screen. */
    setLayout(rects, aspect) {
        this.layout = rects || null;
        if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
        frameFor(this.aspect, this.layout, this.frame);
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Draw only the named parts (captures). */
    showOnlyParts(names) {
        const wanted = new Set(names);
        Object.keys(this.parts).forEach((name) => {
            this.parts[name].mesh.visible = wanted.has(name);
        });
    }

    // ── time ────────────────────────────────────────────────────────────────────

    /** Put the world at `time` with nothing in flight, on the night the clock alone gives. */
    seek(time) {
        this.time = Math.max(0, time);
        this.clock = this.time;
        this.rand = mulberry32(this.seed);
        this.resetSession();
        // What a run left eased (the chain's gauges, the turn's way, the crowns picked, the heat
        // of play) goes too: a seek is the world at `time` with no history.
        const s = this.state;
        s.sync = 0;
        s.moss = 0;
        s.swarm = swarmForCombo(0);
        s.turnSign = 1;
        s.turnBase = 0;
        s.beat = -1;
        this.surge.reset();
        this.heat = this.surge.sample(this.clock);
        this._crownMoon?.set(0, -1, 0);
        this.night.from = 0;
        this.night.to = 0;
        this.night.at = -100;
        this.state.pitch = null;
        this.applyNight();
    }

    /**
     * A new run: no bloom, no chain, nothing in the air. The clock runs on, and with it the
     * night's drift; what the last run's levels added eases back off.
     */
    resetSession() {
        const s = this.state;
        const { night } = this;
        const was = this.levelPlace();
        night.to = 0;
        night.from = nearOnWheel(was, night.to);
        night.at = this.clock;
        s.combo = 0;
        s.level = 1;
        s.lanternKick = 0;
        s.gust = 0;
        s.hushAt = -100;
        s.hushDepth = 1;
        s.queenAt = -100;
        s.queenSpinAt = -100;
        s.perfectAt = -100;
        s.queenPerfect = false;
        s.dewAt = -100;
        s.dewGain = 0;
        s.dewShown = 0;
        s.dewNextAt = NEVER;
        s.dewNextGain = 0;
        this.flash.reset();
        this.kick.reset();
        this.flood.reset();
        this.moonCall.reset();
        // Nothing turning (the angle so far stays: with nothing turning it moves nothing). The
        // heat of play is not reset here: it breathes out by itself.
        for (let i = 0; i < this.turns.length; i += 1) this.turns[i].amp = 0;
        s.locks = 0;
        s.clears = 0;
        s.blooms = 0;
        s.released = 0;
        s.queens = 0;
        this.ringCount = 0;
        this.waves.length = 0;
        this.seeds.length = 0;
        this.fliers.length = 0;
        this.pollen.length = 0;
        this.parts.blooms?.reset?.();
    }

    // ── camera ──────────────────────────────────────────────────────────────────

    /** The rest pose: the eye on the landing, the lens lifted by the frame's pitch. */
    restCamera(camera = this.restLens) {
        camera.position.set(EYE.x, EYE.y, EYE.z);
        camera.up.set(0, 1, 0);
        const pitch = this.frame.pitch * DEG;
        camera.lookAt(EYE.x, EYE.y + Math.sin(pitch), EYE.z - Math.cos(pitch));
        camera.updateMatrixWorld();
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
        return camera;
    }

    updateCamera(camera, sim) {
        const s = this.state;
        const target = this.frame.pitch;
        if (s.pitch === null) s.pitch = target;
        else s.pitch += (target - s.pitch) * approach(1.2, sim.delta);
        const t = sim.time;
        const still = this.reducedMotion ? 0 : 1;
        // Standing, breathing: a slow sway of a few centimetres and a hair of turn.
        const breathe = still * Math.sin(t * 0.42) * 0.5;
        const sway = still * (Math.sin(t * 0.17) * 0.6 + Math.sin(t * 0.11 + 1.3) * 0.4);
        const px = still * (sim.pointerX || 0);
        const py = still * (sim.pointerY || 0);
        // A hard drop shudders the house: a small jolt of the lens that dies in a few tenths
        // (rapid drops add to the jolt still running instead of restarting it).
        const jolt = still * this.kick.valueAt(this.clock) * Math.sin(t * 41) * 0.28;
        const yaw = (sway * 0.35 + px * 1.4) * DEG;
        const pitch = (s.pitch + breathe * 0.12 - py * 0.8 + jolt) * DEG;
        camera.position.set(EYE.x + px * 0.16 + sway * 0.03, EYE.y + breathe * 0.015, EYE.z);
        camera.up.set(Math.sin(sway * 0.003), 1, 0).normalize();
        tmpRay.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
        camera.lookAt(camera.position.x + tmpRay.x, camera.position.y + tmpRay.y, camera.position.z + tmpRay.z);
        // The shared breath (shared/camera-breath.js) on top of the sway above: the view only
        // turns (an eye looking down the house has no one subject), off under reduced motion.
        applyCameraBreath(camera, t, { scale: this.reducedMotion ? 0 : 1 });
        camera.updateMatrixWorld();
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    }

    /** A screen point (fractions, y down) → the world ray through it (unit). */
    screenRay(x, y, out = tmpRay, camera = this.camera) {
        return out.set(x * 2 - 1, 1 - y * 2, 0.5).unproject(camera).sub(camera.position).normalize();
    }

    /**
     * Where a screen point's ray meets the garden: the water in the canal, the path or a bed's
     * soil (the first it reaches), clamped to the house. Returns { x, y, z, kind }.
     */
    castGround(x, y, out = {}) {
        const { camera } = this;
        const ray = this.screenRay(x, y, tmpV);
        const p = camera.position;
        // A ray at or above the horizon is bent down onto the floor far off (it is clamped to the
        // house below), so every aim lands somewhere the eye sees.
        if (ray.y > -0.04) {
            ray.y = -0.04;
            ray.normalize();
        }
        // Each surface is flat: the ray meets the highest it reaches first. Where it crosses a level
        // over ground that stands HIGHER, it struck that ground's side (a bed's kerb): it lands on
        // its top edge.
        let hit = null;
        for (const level of [FLOOR.bed.soil, 0, FLOOR.canal.water]) {
            const t = (level - p.y) / ray.y;
            if (t <= 0) continue;
            const hx = p.x + ray.x * t;
            const hz = p.z + ray.z * t;
            const g = groundAt(hx, hz);
            if (g.y >= level - 1e-3) {
                hit = {
                    x: hx, y: g.y, z: hz, kind: g.kind,
                };
                break;
            }
        }
        if (!hit) {
            const t = (FLOOR.canal.water - p.y) / ray.y;
            const hx = p.x + ray.x * t;
            const hz = p.z + ray.z * t;
            const g = groundAt(hx, hz);
            hit = {
                x: hx, y: g.y, z: hz, kind: g.kind,
            };
        }
        hit.x = clamp(hit.x, -(HOUSE.halfSpan - 0.6), HOUSE.halfSpan - 0.6);
        hit.z = clamp(hit.z, -44, FLOOR.canal.head - 0.3);
        const g = groundAt(hit.x, hit.z);
        // Nothing grows on the path: a bloom meant for it opens at the bed's front beyond it, slid
        // out along the eye's ray over the ground, so it keeps its column on the screen.
        if (g.kind === 'path') {
            const k = (FLOOR.bed.inner + 0.3) / Math.max(Math.abs(hit.x - p.x), 1e-3);
            hit.x = p.x + (hit.x - p.x) * k;
            hit.z = Math.max(p.z + (hit.z - p.z) * k, -44);
            hit.kind = 'bed';
            hit.y = FLOOR.bed.soil;
        } else {
            hit.kind = g.kind;
            hit.y = g.y;
        }
        // On the water, keep clear of the coping.
        if (hit.kind === 'water') hit.x = clamp(hit.x, -(FLOOR.canal.half - 0.35), FLOOR.canal.half - 0.35);
        Object.assign(out, hit);
        return out;
    }

    /** The layout events aim at: the live one, else the stylesheet's solo layout for this shape. */
    aimLayout() {
        return this.layout || fallbackLayout(this.aspect * 1000, 1000);
    }

    // ── tables ──────────────────────────────────────────────────────────────────

    /**
     * A ring on the canal at (x, z), born at `at` (it may be in the future). The table full, the
     * ring with the least of its run left makes way (the faintest), never one just born.
     */
    addRing(x, z, at, strength, rgb, light) {
        const cap = this.ringRowsV.length / 2;
        let k = this.ringCount * 2;
        if (this.ringCount >= cap) {
            let least = Infinity;
            for (let i = 0; i < this.ringCount; i += 1) {
                const row = this.ringRowsV[i * 2];
                const left = row.w * clamp01(1 - (this.clock - row.z) / TIMING.ringLife);
                if (left < least) {
                    least = left;
                    k = i * 2;
                }
            }
        } else this.ringCount += 1;
        this.ringRowsV[k].set(x, z, at, strength);
        this.ringRowsV[k + 1].set(rgb[0], rgb[1], rgb[2], light);
    }

    /**
     * A wave of moonlight across the glazing from (along, s) on the vault, born at `at`. The
     * table full, the front with the least light left makes way (the faintest, far down the
     * glass), never the newest.
     */
    addWave(along, s, at, strength, rgb, speed = TIMING.paneWave) {
        let wave = null;
        if (this.waves.length >= this.waveRowsV.length / 2) {
            let least = Infinity;
            for (let i = 0; i < this.waves.length; i += 1) {
                const v = this.waves[i];
                const left = v.strength * Math.exp(-0.45 * Math.max(0, this.clock - v.at));
                if (left < least) {
                    least = left;
                    wave = v;
                }
            }
        } else {
            wave = { rgb: [0, 0, 0] };
            this.waves.push(wave);
        }
        wave.along = along;
        wave.s = s;
        wave.at = at;
        wave.strength = strength;
        wave.rgb[0] = rgb[0];
        wave.rgb[1] = rgb[1];
        wave.rgb[2] = rgb[2];
        wave.speed = speed;
    }

    /**
     * The moon rings: a front of moonlight runs out across the glazing from the moon's own pane,
     * and a fainter one of the canal's glow behind it (a back-to-back, a perfect clear's crown).
     */
    ringMoon(at, strength) {
        const { along, s } = this.moonPane;
        this.addWave(along, s, at, strength, this.light.moonlight, TIMING.paneWave * 0.6);
        this.addWave(along, s, at + 0.32, strength * 0.6, this.light.glow, TIMING.paneWave * 0.6);
    }

    /**
     * Pollen from the blooms in `released` ({ x, y, z, rgb, at }), as much as the budget holds:
     * fewer motes a bloom when a whole garden gives up its pollen at once, the oldest fading out
     * past the budget instead of vanishing.
     */
    givePollen(released) {
        const most = Math.floor(this.tier.glows * POLLEN_SHARE);
        const motes = Math.max(3, Math.min(POLLEN_MOTES, Math.floor(most / Math.max(1, released.length))));
        for (let i = 0; i < released.length; i += 1) {
            const b = released[i];
            for (let k = 0; k < motes; k += 1) {
                this.pollen.push({
                    x: b.x, y: b.y, z: b.z, t0: b.at + k * 0.05, rgb: b.rgb, seed: this.rand(), fadeAt: NEVER,
                });
            }
        }
        cull(this.pollen, most, this.clock);
    }

    // ── events ──────────────────────────────────────────────────────────────────

    /** A piece locked: { player, rows, u, hardDrop, color, screen }. */
    onLock(c) {
        if (!this.camera) return;
        const s = this.state;
        s.locks += 1;
        const hard = c.hardDrop === true;
        const rgb = pieceLight(c.color, [1, 0.84, 0.52]);
        let landX = 0.25;
        let landY = 0.85;
        let leaveX = 0.42;
        let leaveY = 0.6;
        if (c.screen) {
            landX = c.screen.x;
            landY = Math.max(c.screen.y, 0.56);
            leaveX = c.screen.x;
            leaveY = c.screen.y;
        } else {
            const layout = this.aimLayout();
            const board = boardFor(layout, c.player || 0);
            if (board) {
                const rows = c.rows?.length ? c.rows : [19];
                const row = rows[Math.floor(rows.length / 2)];
                const u = clamp01(c.u ?? 0.5);
                boardPoint(board, u, row, this._point);
                const card = cardFor(layout, board) || board;
                this._jitter[0] = this.rand() * 2 - 1;
                this._jitter[1] = this.rand() * 2 - 1;
                aimLanding(layout, card, this._point, u, row, this._jitter, this._landing);
                aimLeave(card, this._point, this._landing, this._leave);
                landX = this._landing.x;
                landY = this._landing.y;
                leaveX = this._leave.x;
                leaveY = this._leave.y;
            }
        }
        const to = this.castGround(landX, landY, {});
        const t0 = this.clock;
        const t1 = t0 + TIMING.seedFlight * (hard ? 0.7 : 1);
        const onWater = to.kind === 'water';
        const bloom = this.parts.blooms?.add?.({
            x: to.x,
            y: to.y,
            z: to.z,
            rgb,
            at: t1,
            hard,
            onWater,
            seed: this.rand(),
        });
        if (bloom) s.blooms += 1;
        // The bloom stands where the blooms part put it (slid along the eye's line to the bed's
        // front, or into open water): the seed comes down on its heart and the ring runs from it.
        const at = bloom || to;
        const land = bloom?.heart || { x: to.x, y: to.y + 0.25, z: to.z };
        const ray = this.screenRay(leaveX, leaveY, tmpV);
        const p = this.camera.position;
        const from = { x: p.x + ray.x * 3.2, y: p.y + ray.y * 3.2, z: p.z + ray.z * 3.2 };
        const ctrl = {
            x: lerp(from.x, land.x, 0.5),
            y: Math.max(from.y, land.y) + 1.4 + this.rand() * 0.8,
            z: lerp(from.z, land.z, 0.5),
        };
        this.seeds.push({
            from, ctrl, to: { x: land.x, y: land.y, z: land.z }, t0, t1, rgb: [rgb[0], rgb[1], rgb[2]], hard,
        });
        if (onWater) this.addRing(at.x, at.z, t1, hard ? 1.6 : 1, rgb, hard ? 1.4 : 1);
        if (hard) {
            this.shakeDew();
            this.flash.hit(0.05, this.clock);
            s.gust = Math.min(1, s.gust + 0.25);
            this.kick.hit(1, this.clock);
        }
        this.surge.lock(c, this.clock);
    }

    /**
     * A hard drop shakes dew loose from the glass. A curtain still coming down is never
     * restarted (its drops would vanish mid-fall): it glitters brighter, and the next curtain
     * follows it down as soon as it has landed, so rapid hard drops keep a heavier rain coming.
     * The hotter play runs, the brighter each curtain.
     */
    shakeDew() {
        const s = this.state;
        const t = this.clock;
        const gain = 1 + 0.35 * this.heat.level;
        if (s.dewNextAt === NEVER && t - s.dewAt >= DEW_SPAN) {
            s.dewAt = t;
            s.dewGain = gain;
            s.dewShown = gain;
            return;
        }
        s.dewGain = Math.min(DEW.most, s.dewGain + DEW_ADD);
        if (s.dewNextAt === NEVER) {
            s.dewNextAt = s.dewAt + DEW_SPAN;
            s.dewNextGain = gain;
        } else s.dewNextGain = Math.min(DEW.most, s.dewNextGain + DEW_ADD);
    }

    /**
     * Lines cleared: { player, rows, lines, combo, cascade, tspin, perfect, b2b, crown, screen }.
     * A clear with no lines of its own (moonlit-greenhouse-director.js) is a perfect clear's crown
     * on the clear still playing, a T-spin that cleared nothing, or a lone back-to-back.
     */
    onClear(c) {
        if (!this.camera) return;
        const s = this.state;
        if (!(Math.round(Number(c.lines)) > 0)) {
            if (c.crown === true) this.crown();
            else if (c.tspin === true) this.spin();
            if (c.b2b === true) this.answerB2B();
            return;
        }
        s.clears += 1;
        const lines = Math.max(1, Math.min(4, Math.round(Number(c.lines)) || 1));
        const big = lines >= 4 || c.perfect === true;
        // How deep in a cascade this wave is, and the chain it belongs to.
        const depth = Math.max(1, Math.min(10, Math.round(Number(c.cascade)) || 1));
        const chainLength = Math.max(1, Math.round(Number(c.combo ?? s.combo)) || 1);
        const { level } = this.heat;
        // Four lines while the Queen is still open (or about to open): she stays open, no second
        // hush, the panes flood again; otherwise the house holds its breath first.
        const qAge = this.clock - s.queenAt;
        const pending = qAge < 0;
        const awake = qAge >= 0 && qAge < QUEEN_LIFE;
        let delay = 0;
        if (big) {
            if (pending) delay = -qAge;
            else if (!awake) delay = TIMING.hush;
        }
        const layout = this.aimLayout();
        const board = boardFor(layout, c.player || 0);
        const card = board ? cardFor(layout, board) || board : null;
        const rows = c.rows?.length ? c.rows : [19];
        const night = this.light;
        // Each cleared row releases a ribbon of fireflies from both edges of the card: more of
        // them and brighter for each wave of a cascade, brighter down a chain and in hot play.
        if (card && board) {
            const p = this.camera.position;
            const fliers = STREAM_FLIERS + Math.min(4, depth - 1);
            const gain = (1 + 0.15 * (depth - 1)) * (1 + 0.04 * Math.min(chainLength - 1, 10)) * (1 + 0.25 * level);
            for (let r = 0; r < Math.min(4, rows.length); r += 1) {
                boardPoint(board, 0.5, rows[r], this._point);
                for (const side of [-1, 1]) {
                    const ex = side < 0 ? card.x0 : card.x1;
                    const ray = this.screenRay(ex, this._point.y, tmpV);
                    const from = { x: p.x + ray.x * 3.4, y: p.y + ray.y * 3.4, z: p.z + ray.z * 3.4 };
                    for (let k = 0; k < fliers; k += 1) {
                        const to = {
                            x: side * lerp(3.2, 6.2, this.rand()),
                            y: lerp(0.8, 4.2, this.rand()),
                            z: lerp(-2, -26, this.rand() ** 1.4),
                        };
                        const ctrl = {
                            x: lerp(from.x, to.x, 0.35) + side * 0.8,
                            y: Math.max(from.y, to.y) + lerp(0.2, 1.6, this.rand()),
                            z: lerp(from.z, to.z, 0.6),
                        };
                        const t0 = this.clock + r * 0.07 + k * 0.035;
                        this.fliers.push({
                            from,
                            ctrl,
                            to,
                            t0,
                            t1: t0 + TIMING.streamFlight * lerp(0.75, 1.25, this.rand()),
                            seed: this.rand(),
                            gain,
                            fadeAt: NEVER,
                        });
                    }
                }
            }
            cull(this.fliers, Math.floor(this.tier.glows * FLIER_SHARE), this.clock);
        }
        // A wave of moonlight runs across the glazing, one front a line, from the ridge above the
        // card toward the eye. A cascade's fronts run brighter and faster wave by wave and turn
        // to the canal's glow; a chain lifts them a little.
        const lift = 1 + 0.22 * (depth - 1) + 0.03 * Math.min(chainLength - 1, 10);
        const pace = TIMING.paneWave * (1 + 0.07 * Math.min(depth - 1, 6));
        const deep = Math.min(1, 0.25 * (depth - 1));
        const tint = this._tint;
        for (let i = 0; i < lines; i += 1) {
            const at = this.clock + i * 0.24 + delay;
            const base = i % 2 === 0 ? night.moonlight : night.glow;
            tint[0] = lerp(base[0], night.glow[0], deep);
            tint[1] = lerp(base[1], night.glow[1], deep);
            tint[2] = lerp(base[2], night.glow[2], deep);
            this.addWave(-30, ARC.length, at, ((big ? 1.4 : 0.8) + lines * 0.15) * lift, tint, pace);
        }
        // The blooms give up their pollen. Four lines: the Queen opens and then the whole garden
        // gives its pollen up at once, every bloom closing. Otherwise the oldest close, one a line
        // and more in a chain; the hotter play runs the more of them stay open and give their
        // pollen anyway, so a quick hand fills the beds with colour instead of emptying them as
        // fast as it plants them.
        const released = this._released;
        released.length = 0;
        if (big) {
            this.parts.blooms?.release?.(Infinity, this.clock + delay + 0.3, released);
            s.released += released.length;
        } else {
            const chain = Math.min(3, Math.floor((chainLength - 1) / 2));
            const due = lines + chain;
            const close = Math.round(due * (1 - smooth(0.15, 0.6, level)));
            this.parts.blooms?.release?.(close, this.clock + 0.1, released);
            s.released += released.length;
            this.parts.blooms?.pollinate?.(due - close, this.clock + 0.1, released);
        }
        this.givePollen(released);
        s.lanternKick = Math.min(1.5, s.lanternKick + 0.25 + lines * 0.1 + 0.05 * (depth - 1));
        this.flash.hit(0.04 + lines * 0.03, this.clock + delay);
        if (c.tspin) {
            this.turnAir(1);
            s.gust = Math.min(1.2, s.gust + 0.6);
        }
        if (c.b2b === true) this.answerB2B();
        if (big) {
            if (awake || pending) {
                // Reopen from wherever she is (closing, or still opening), never snapping: her
                // opening curves pick up where they are, her turning (queenSpinAt) runs on, and a
                // perfect clear's second whorl unfurls from now. One still waiting opens on time.
                if (awake) s.queenAt = this.clock - openingAge(this.U.queen.value.x);
                if (c.perfect === true && !s.queenPerfect) {
                    s.queenPerfect = true;
                    s.perfectAt = Math.max(this.clock, s.queenAt);
                }
                this.flood.hit(0.8, Math.max(this.clock, s.queenAt));
            } else {
                // The house holds its breath: as deep as play is cold (four lines from rest go
                // dark, four lines mid-fever only inhale), shallower under Reduce flashing.
                s.hushAt = this.clock;
                s.hushDepth = (1 - 0.8 * level) * flashScale();
                s.queenAt = this.clock + TIMING.hush;
                s.queenSpinAt = s.queenAt;
                s.queenPerfect = c.perfect === true;
                s.perfectAt = s.queenAt;
                this.flood.hit(1, s.queenAt);
            }
            s.queens += 1;
        }
        this.surge.clear(c, this.clock + delay);
    }

    /**
     * A T-spin's turn of the air (`amp` a share of a full turn). It never restarts the turn in
     * flight: each runs its own course and they add, the air going on round the same way while
     * any is moving; a fresh turn may go either way.
     */
    turnAir(amp) {
        const s = this.state;
        const t = this.clock;
        const sign = this.rand() < 0.5 ? -1 : 1;
        let free = null;
        let oldest = null;
        let moving = false;
        for (let i = 0; i < this.turns.length; i += 1) {
            const turn = this.turns[i];
            if (turn.amp > 0 && t - turn.at >= TIMING.turn) this.foldTurn(turn);
            if (turn.amp > 0) {
                moving = true;
                if (!oldest || turn.at < oldest.at) oldest = turn;
            } else if (!free) free = turn;
        }
        if (!moving) s.turnSign = sign;
        if (!free) {
            // Three turns already: the oldest keeps how far it has carried the air, and starts again.
            s.turnBase += s.turnSign * TURN_ANGLE * oldest.amp * smooth(0, TIMING.turn, t - oldest.at);
            free = oldest;
        }
        free.at = t;
        // (Under reduced motion the air only stirs.)
        free.amp = amp * (this.reducedMotion ? 0.35 : 1);
    }

    /** A turn that has run its course leaves its angle in the base (wrapped: only its sine and cosine count). */
    foldTurn(turn) {
        const s = this.state;
        s.turnBase = (s.turnBase + s.turnSign * TURN_ANGLE * turn.amp) % (Math.PI * 2);
        turn.amp = 0;
    }

    /** A T-spin that cleared nothing: a small turn of the air and a breath through the fronds. */
    spin() {
        this.turnAir(SPIN_TURN);
        this.state.gust = Math.min(1.2, this.state.gust + 0.3);
        this.surge.spin(this.clock);
    }

    /**
     * A perfect clear settled after the clear's last wave (the director's crown): the crowning
     * moment on the clear still playing, never a second hush. The Queen's second whorl unfurls as
     * she opens (from now, if she already is), the moon wears its corona, every firefly flashes
     * once more and the moon rings over the glass. With no Queen awake (a perfect clear on a
     * smaller clear) she opens at once, with no hush, and the garden gives up its pollen.
     */
    crown() {
        const s = this.state;
        const t = this.clock;
        const qAge = t - s.queenAt;
        if (qAge >= 0 && qAge < QUEEN_LIFE) {
            s.queenAt = t - openingAge(this.U.queen.value.x);
        } else if (qAge >= QUEEN_LIFE) {
            s.queenAt = t;
            s.queenSpinAt = t;
            s.queenPerfect = false;
            s.queens += 1;
            const released = this._released;
            released.length = 0;
            this.parts.blooms?.release?.(Infinity, t + 0.3, released);
            s.released += released.length;
            this.givePollen(released);
        }
        const at = Math.max(t, s.queenAt);
        if (!s.queenPerfect) {
            s.queenPerfect = true;
            s.perfectAt = at;
        }
        this.flood.hit(0.4, at);
        this.flash.hit(0.06, at);
        this.ringMoon(at, 1.8);
        this.surge.crown(t);
    }

    /**
     * Back-to-back: the moon answers. Its beams through the glass blaze and its light runs
     * stronger through the house (moonCall: U.moonLight and the post's shafts), and a ring of
     * moonlight runs out over the panes from the moon's own pane. A second back-to-back while
     * the first still burns lifts it higher and rings wider.
     */
    answerB2B() {
        const t = this.clock;
        const burning = this.moonCall.valueAt(t);
        this.moonCall.hit(1, t);
        this.ringMoon(t, 1.3 + 0.6 * burning);
    }

    /** Whether the Queen of the Night is anywhere in her life (opening, open or closing). */
    queenAlive() {
        const age = this.clock - this.state.queenAt;
        return age >= 0 && age < QUEEN_LIFE;
    }

    /** The longest chain any board is holding (0 = it broke). */
    onCombo(combo) {
        this.state.combo = Math.max(0, combo | 0);
    }

    /** A new level: the night moves one step along the wheel (`silent`: it simply is that level). */
    levelUp(level, { silent = false } = {}) {
        const s = this.state;
        const { night } = this;
        s.level = Math.max(1, level | 0);
        const was = this.levelPlace();
        night.to = s.level - 1;
        night.from = silent ? night.to : nearOnWheel(was, night.to);
        night.at = silent ? -100 : this.clock;
        this.applyNight();
        // The new night announces itself: a slow wave of its own glow runs across the glazing from
        // the ridge above the card.
        if (!silent) {
            const next = nightAt(night.to + this.clock / NIGHT_SECONDS, {});
            this.addWave(-24, ARC.length, this.clock + 0.4, 1.4, next.glow, TIMING.paneWave * 0.55);
            this.surge.levelUp(this.clock);
        }
    }

    // ── the night ───────────────────────────────────────────────────────────────

    /** The place the level holds on the wheel right now (eased while it turns). */
    levelPlace() {
        const { night } = this;
        const k = smooth(0, NIGHT_TURN, this.clock - night.at);
        return lerp(night.from, night.to, k);
    }

    /** Where the house stands on the wheel: the level's place plus what the clock has drifted. */
    nightPlace() {
        return this.night.pin ?? this.levelPlace() + this.clock / NIGHT_SECONDS;
    }

    /** Hand the night's colours to the shaders. */
    applyNight() {
        const { U } = this;
        const light = nightAt(this.nightPlace(), this.light);
        for (let i = 0; i < NIGHT_COLOURS.length; i += 1) {
            const colour = light[NIGHT_COLOURS[i]];
            this.nightRows[i].set(colour[0], colour[1], colour[2], 0);
        }
        // A fever clears the sky: the cloud thins and the stars come out over the glass.
        const { fever } = this.heat;
        U.stars.value = light.stars * (1 + 0.8 * fever);
        U.cloud.value = light.cloud * (1 - 0.7 * fever);
    }

    /** Point the moon where the frame wants it (through the rest lens) plus the clock's drift. */
    placeMoon(camera) {
        const { U } = this;
        const rest = this.restLens;
        rest.aspect = this.aspect;
        rest.fov = fovForAspect(this.aspect);
        rest.updateProjectionMatrix();
        this.restCamera(rest);
        const dir = this.screenRay(this.frame.moonX, this.frame.moonY, tmpP, rest);
        let az = Math.atan2(dir.x, -dir.z) / DEG;
        const el = Math.asin(clamp(dir.y, -1, 1)) / DEG;
        // The moon is seen between two ribs, never behind one: its line of sight is moved to cross
        // the vault in the middle of the nearest bay (one Newton step on its azimuth). The clock's
        // drift then moves it less than half a bay either way.
        const exit = houseExit(rest.position, skyDirection(az, el, this._dir), this._exit);
        if (!exit.wall) {
            const at = exit.along;
            const nudged = houseExit(rest.position, skyDirection(az + 0.5, el, this._dir), this._exit).along;
            const perDegree = (nudged - at) / 0.5;
            const bay = GLAZING.ribEvery;
            const middle = Math.round((at - bay / 2) / bay) * bay + bay / 2;
            if (Math.abs(perDegree) > 1e-3) az += clamp((middle - at) / perDegree, -6, 6);
        }
        const drift = moonDrift(this.clock, this._drift);
        const a = (az + drift.az) * DEG;
        const e = (el + drift.el) * DEG;
        U.moon.value.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
        // The disc's frame on the sky (the water's mirror draws it about the moon's direction).
        const m = U.moon.value;
        U.moonRight.value.set(-m.z, 0, m.x).normalize();
        if (m.z > 0) U.moonRight.value.negate();
        U.moonUp.value.crossVectors(U.moonRight.value, m).normalize();
        if (U.moonUp.value.y < 0) U.moonUp.value.negate();
        // The bay the eye sees it through keeps its blind up: the moon is never behind the laths.
        const seen = houseExit(rest.position, m, this._exit);
        U.moonBay.value.set(seen.wall ? -1000 : Math.floor(seen.along / GLAZING.ribEvery), seen.side);
        this.moonPane.along = seen.along;
        this.moonPane.s = seen.s;
        // Where it stands in the live lens (the glass draws the disc in the image plane).
        if (camera) {
            tmpV.copy(m).multiplyScalar(100).add(camera.position).project(camera);
            U.moonNdc.value.set(tmpV.x, tmpV.y);
            U.moonNdcRadius.value = Math.tan(MOON_RADIUS * DEG) / Math.tan((camera.fov * DEG) / 2);
            const ahead = tmpRay.set(0, 0, -1).transformDirection(camera.matrixWorld).dot(m);
            this.moonScreen.x = tmpV.x * 0.5 + 0.5;
            this.moonScreen.y = 0.5 - tmpV.y * 0.5;
            this.moonScreen.visible = ahead > 0.2 ? 1 : 0;
        }
    }

    /**
     * The palm crowns whose fronds shadow what the eye sees: those whose shadow falls inside the
     * house in front of the eye (with the moon on the left, the left palms), nearest first.
     * Picked again whenever the moon has moved.
     */
    pickCrowns() {
        const m = this.U.moon.value;
        if (!this.plan || this._crownMoon.angleTo(m) < 0.008) return;
        this._crownMoon.copy(m);
        const scored = [];
        this.plan.palms.forEach((palm, i) => {
            const c = this.crownCentres[i];
            const k = c.y / Math.max(m.y, 0.05);
            const sx = c.x - m.x * k;
            const sz = c.z - m.z * k;
            // Its shadow on the floor must fall inside the house and in front of the eye; the beams
            // just under it show wherever it stands.
            const inside = Math.abs(sx) < HOUSE.halfSpan && sz < EYE.z && sz > -46;
            const near = Math.abs(sx) < HOUSE.halfSpan + 3 && sz < EYE.z + 6;
            if (!inside && !near) return;
            scored.push({ palm, c, score: (inside ? 0 : 40) + Math.abs(sz + 12) });
        });
        scored.sort((a, b) => a.score - b.score);
        const n = Math.min(this.tier.crowns, scored.length);
        for (let i = 0; i < n; i += 1) {
            const { palm, c } = scored[i];
            this.crownRowsV[i * 2].set(c.x, c.y, c.z, palm.crown);
            this.crownRowsV[i * 2 + 1].set(palm.fronds, palm.twist, palm.seed, 0);
        }
        this.U.crownCount.value = n;
    }

    // ── frame ───────────────────────────────────────────────────────────────────

    update(sim, camera) {
        if (!this.parts.glass) return;
        const dt = Math.max(0, sim.delta);
        this.time = sim.time;
        const { U } = this;
        const s = this.state;
        this.clock += dt;
        const t = this.clock;
        U.time.value = t;
        // How hot play runs (src/themes/shared/gameplay-surge.js): the acts the house plays.
        const heat = this.surge.sample(t);
        this.heat = heat;
        const { level, fever, punch } = heat;
        const warm = smooth(0.12, 0.5, level);
        const hot = smooth(0.4, 0.85, level);
        // What only moves (the fronds' sway) is stilled under reduced motion; light is not.
        const calm = this.reducedMotion ? 0.3 : 1;
        this.applyNight();
        this.placeMoon(camera);
        this.pickCrowns();
        U.cloudDrift.value.set(t * 0.0021, -t * 0.0009);
        const beat = swarmFlash(t);

        // The chain: the fireflies fall into step, the swarm thickens, the moss climbs. The heat
        // of play does it too, in its own measure: a quick hand calls more of the swarm out and
        // starts it pulsing together, a fever brings it into step and the moss up the columns.
        // In a fever the moss pulses with the swarm's flash.
        const { combo } = s;
        const sync = Math.max(syncForCombo(combo), 0.35 * hot + 0.55 * fever);
        s.sync += (sync - s.sync) * approach(sync > s.sync ? 1.1 : 0.45, dt);
        const moss = Math.max(mossForCombo(combo), 1.2 * hot + (HOUSE.spring + 1) * fever);
        s.moss += (moss - s.moss) * approach(moss > s.moss ? 1.6 : 0.3, dt);
        const swarm = Math.max(swarmForCombo(combo), clamp01(0.42 + 0.22 * warm + 0.2 * hot + 0.16 * fever));
        s.swarm += (swarm - s.swarm) * approach(0.8, dt);
        U.sync.value = s.sync;
        U.moss.value = s.moss;
        U.mossGlow.value = clamp01(s.moss / 1.2) * (1 + 0.15 * hot) + fever * (0.25 + 0.6 * beat);
        U.swarm.value = s.swarm;

        // The hush (as deep as it was made: see onClear) and the Queen of the Night.
        const hushAge = t - s.hushAt;
        const hush = hushAge >= 0 && hushAge < TIMING.hush + 1.2
            ? smooth(0, 0.12, hushAge) * (1 - smooth(TIMING.hush, TIMING.hush + 0.9, hushAge)) * s.hushDepth
            : 0;
        U.hush.value = hush;
        const qAge = t - s.queenAt;
        const closing = TIMING.queenOpen + TIMING.queenHold;
        let open = 0;
        let glow = 0;
        if (qAge >= 0 && qAge < QUEEN_LIFE) {
            open = smooth(0, TIMING.queenOpen, qAge) * (1 - smooth(closing, QUEEN_LIFE, qAge));
            // A blaze as she opens that settles while she holds, then goes with her.
            glow = smooth(0, 0.5, qAge) * (1 - smooth(TIMING.queenOpen, closing, qAge) * 0.7)
                * (1 - smooth(closing, QUEEN_LIFE, qAge));
        }
        // z is where her turning is measured from (her first opening this life, kept through a
        // reopen); w the second whorl, eased in over an opening rather than switched on.
        const perfect = s.queenPerfect ? smooth(0, TIMING.queenOpen, t - s.perfectAt) : 0;
        U.queen.value.set(open, glow, s.queenSpinAt, perfect);
        const flood = this.flood.valueAt(t);
        U.flood.value = flood;
        U.moonCover.value = clamp01(hush * 0.9 + U.cloud.value * 0.05);
        // The moon answers a back-to-back; in a fever it yields a little to the house's own
        // lights (the swarm, the moss, the lanterns, the singing glass), so the night stays dark
        // between them.
        const call = this.moonCall.valueAt(t);
        U.moonLight.value = (1 - hush * 0.8) * (1 + flood * 0.6) * (1 - 0.12 * fever + 0.22 * call);

        // The fireflies' light in the garden: the swarm's mean flash (in step it pulses with the
        // swarm's own flash, so the garden brightens as they do), warmer as play heats.
        U.fireflyGlow.value = (s.swarm * (0.35 + s.sync * beat * 1.4) + flood * 1.5) * (1 - hush)
            * (1 + 0.25 * warm + 0.3 * fever);
        // The swarm itself burns brighter as play heats (the flood is its own blaze).
        U.swarmGain.value = 1 + (0.2 * warm + 0.25 * hot + 0.4 * fever) * (1 - 0.6 * Math.min(1, flood));

        // The lanterns burn up with a chain and a clear, and with the heat of play (blazing in a
        // fever), and flicker; every event's kick lifts them a moment.
        s.lanternKick *= Math.exp(-0.7 * dt);
        U.lanternGain.value = this.light.lanterns
            * (1 + s.sync * 0.35 + s.lanternKick * 0.5 + 0.12 * warm + 0.18 * hot + 0.3 * fever + 0.1 * punch)
            * (1 - hush * 0.85);
        for (let i = 0; i < this.litLanterns.length; i += 1) {
            const l = this.litLanterns[i];
            const flicker = 1 + Math.sin(t * (7.1 + l.seed * 3) + l.seed * 40) * 0.04
                + Math.sin(t * 13.3 + l.seed * 9) * 0.025;
            this.lanternRowsV[i].w = flicker;
        }

        // The turns of the air (T-spins) add: the angle runs on from what the finished turns
        // left, and the air is held as long as any is turning.
        for (let i = 0; i < this.turns.length; i += 1) {
            const turn = this.turns[i];
            if (turn.amp > 0 && t - turn.at >= TIMING.turn) this.foldTurn(turn);
        }
        let angle = s.turnBase;
        let turning = 0;
        for (let i = 0; i < this.turns.length; i += 1) {
            const turn = this.turns[i];
            if (turn.amp <= 0) continue;
            const k = smooth(0, TIMING.turn, Math.max(0, t - turn.at));
            angle += s.turnSign * TURN_ANGLE * turn.amp * k;
            turning += turn.amp * Math.sin(Math.PI * k);
        }
        turning = Math.min(1, turning);
        U.turn.value.set(angle, turning, 0, -9);
        // The gusts, and the fronds stirring in a rising air as play heats.
        s.gust *= Math.exp(-0.9 * dt);
        U.gust.value = clamp01(s.gust + turning * 0.6 + flood * 0.3 + calm * (0.1 * hot + 0.22 * fever));
        // The dew: the curtain falling, and the next one when it has landed.
        if (t >= s.dewNextAt) {
            s.dewAt = s.dewNextAt;
            s.dewGain = s.dewNextGain;
            s.dewShown = s.dewNextGain;
            s.dewNextAt = NEVER;
        }
        s.dewShown += (s.dewGain - s.dewShown) * approach(5, dt);
        U.dew.value.set(s.dewAt, s.dewShown, 0, 0);

        // The glass sings in a fever: on every beat of the swarm's flash a front of the canal's
        // glow rolls down the vault from far down the house, so the glass, the fireflies and the
        // moss flash as one (hot play starts it, faintly).
        const beatIndex = Math.floor(t / FLASH.beat);
        if (beatIndex !== s.beat) {
            const sing = 0.8 * hot + 1.5 * fever;
            if (s.beat >= 0 && sing > 0.1) {
                // Every other beat the front carries the fireflies' own gold-green.
                const { glow: canal, firefly } = this.light;
                const k = beatIndex % 2 === 0 ? 0 : 0.5;
                const tint = this._tint;
                tint[0] = lerp(canal[0], firefly[0], k);
                tint[1] = lerp(canal[1], firefly[1], k);
                tint[2] = lerp(canal[2], firefly[2], k);
                this.addWave(-44, ARC.length, beatIndex * FLASH.beat, sing, tint, TIMING.paneWave * 0.8);
            }
            s.beat = beatIndex;
        }

        // Rings run their course (a hard drop's ring can be born before an earlier soft one's, so
        // every row is checked, not only the first).
        let kept = 0;
        for (let i = 0; i < this.ringCount; i += 1) {
            if (t - this.ringRowsV[i * 2].z > TIMING.ringLife) continue;
            if (kept !== i) {
                this.ringRowsV[kept * 2].copy(this.ringRowsV[i * 2]);
                this.ringRowsV[kept * 2 + 1].copy(this.ringRowsV[i * 2 + 1]);
            }
            kept += 1;
        }
        this.ringCount = kept;
        U.ringCount.value = this.ringCount;
        // Waves across the glazing (those that have run their course leave the table).
        let w = 0;
        const reach = 90;
        for (let i = 0; i < this.waves.length; i += 1) {
            const v = this.waves[i];
            const age = t - v.at;
            if (age > reach / v.speed) continue;
            this.waves[w] = v;
            this.waveRowsV[w * 2].set(v.along, v.s, v.at, v.strength);
            this.waveRowsV[w * 2 + 1].set(v.rgb[0], v.rgb[1], v.rgb[2], v.speed);
            w += 1;
        }
        this.waves.length = w;
        U.paneWaveCount.value = w;

        this.parts.blooms?.update?.(this);
        this.updateBloomLights(camera);
        this.updateGlows(camera);
        const { updating } = this;
        for (let i = 0; i < updating.length; i += 1) updating[i].update(this);
    }

    /** The open blooms the garden is lit by: the brightest and nearest, in the shaders' rows. */
    updateBloomLights(camera) {
        const list = this.parts.blooms?.lights?.(this.clock) || [];
        const eye = camera ? camera.position : { x: EYE.x, y: EYE.y, z: EYE.z };
        const cap = Math.min(this.tier.lights, this.bloomRowsV.length / 2);
        // The Queen of the Night, while she is open, holds the first row whatever the blooms do
        // (12 m off, she would lose a contest of nearness to the beds' blooms and her light
        // would drop out of the garden and the mist mid-blaze); then the brightest and nearest
        // blooms (a reused list: nothing is allocated per frame here).
        const scored = this._scored;
        scored.length = 0;
        let queen = null;
        for (let i = 0; i < list.length; i += 1) {
            const l = list[i];
            if (l.queen) {
                queen = l;
                continue;
            }
            l.score = l.strength / (1 + Math.hypot(l.x - eye.x, l.z - eye.z) * 0.15);
            scored.push(l);
        }
        scored.sort(byScore);
        if (queen) scored.unshift(queen);
        const n = Math.min(cap, scored.length);
        for (let i = 0; i < n; i += 1) {
            const l = scored[i];
            this.bloomRowsV[i * 2].set(l.x, l.y, l.z, l.strength);
            this.bloomRowsV[i * 2 + 1].set(l.rgb[0], l.rgb[1], l.rgb[2], l.radius ?? 1.6);
        }
        this.U.bloomLightCount.value = n;
        if (queen) this.U.queenLight.value.set(queen.x, queen.y, queen.z, queen.radius);
        else this.U.queenLight.value.w = 0;
    }

    /** The small lights: seeds in flight, the cleared rows' fireflies, rising pollen. */
    updateGlows() {
        const { glows } = this.parts;
        const turn = this.U.turn.value;
        const t = this.clock;
        const night = this.light;
        const dim = 1 - this.U.hush.value * 0.9;
        glows.begin();
        // Seeds of light, with their trails.
        for (let i = this.seeds.length - 1; i >= 0; i -= 1) {
            const sd = this.seeds[i];
            if (t > sd.t1 + 0.05) {
                this.seeds.splice(i, 1);
                continue;
            }
            if (t < sd.t0) continue;
            const span = sd.t1 - sd.t0;
            for (let j = 0; j < SEED_POINTS; j += 1) {
                const back = (j / SEED_POINTS) * SEED_TRAIL;
                const s = clamp01((t - sd.t0 - back) / span);
                if (t - back < sd.t0) break;
                arcPoint(sd.from, sd.ctrl, sd.to, s * s * (3 - 2 * s), this._seedP);
                const fade = (1 - j / SEED_POINTS) ** 1.6;
                const hot = j === 0 ? 2.6 : 1;
                const k = 3.2 * fade * hot;
                glows.push(
                    this._seedP.x,
                    this._seedP.y,
                    this._seedP.z,
                    j === 0 ? 0.13 : 0.07 * fade + 0.02,
                    sd.rgb[0] * k,
                    sd.rgb[1] * k,
                    sd.rgb[2] * k,
                    0,
                );
            }
        }
        // The cleared rows' fireflies: out along their arcs, then glowing where they settle.
        const ff = night.firefly;
        for (let i = this.fliers.length - 1; i >= 0; i -= 1) {
            const f = this.fliers[i];
            const age = t - f.t0;
            const life = f.t1 - f.t0 + STREAM_LINGER;
            if (age > life || t - f.fadeAt > FADE_OUT) {
                this.fliers.splice(i, 1);
                continue;
            }
            if (age < 0) continue;
            const s = clamp01(age / (f.t1 - f.t0));
            arcPoint(f.from, f.ctrl, f.to, 1 - (1 - s) * (1 - s), this._seedP);
            const blink = 0.55 + 0.45 * Math.sin(t * (5 + f.seed * 4) + f.seed * 30);
            const k = 2.4 * blink * (1 - smooth(life - 1.2, life, age)) * dim * f.gain * fadeLeft(f.fadeAt, t);
            // A T-spin's turn of the air carries them as it carries the swarm.
            const q = turnOfTheAirAt(
                this._seedP.x,
                this._seedP.y + Math.sin(age * 2 + f.seed * 9) * 0.05 * s,
                this._seedP.z,
                turn,
                this._turned,
            );
            glows.push(
                q.x,
                q.y,
                q.z,
                0.05,
                ff[0] * k,
                ff[1] * k,
                ff[2] * k,
                0,
            );
        }
        // Pollen rising from closing blooms toward the glass, drifting, glittering in the beams.
        const rise = TIMING.pollenRise;
        for (let i = this.pollen.length - 1; i >= 0; i -= 1) {
            const p = this.pollen[i];
            const age = t - p.t0;
            if (age > rise || t - p.fadeAt > FADE_OUT) {
                this.pollen.splice(i, 1);
                continue;
            }
            if (age < 0) continue;
            const s = age / rise;
            const a = p.seed * 40 + age * (0.6 + p.seed);
            const r = 0.15 + s * 0.9;
            const k = (smooth(0, 0.3, age) * (1 - smooth(0.6, 1, s))) * 2.2 * dim * fadeLeft(p.fadeAt, t);
            const tint = 0.65;
            const q = turnOfTheAirAt(
                p.x + Math.cos(a) * r,
                p.y + 0.2 + s * s * 5.5 + s * 1.5,
                p.z + Math.sin(a) * r,
                turn,
                this._turned,
            );
            glows.push(
                q.x,
                q.y,
                q.z,
                0.03,
                lerp(p.rgb[0], 1, tint) * k,
                lerp(p.rgb[1], 0.95, tint) * k,
                lerp(p.rgb[2], 0.7, tint) * k,
                2,
            );
        }
        glows.end();
    }

    /** What the post stack should know this frame (the same object every frame). */
    getPostState() {
        const s = this.state;
        const L = this.light;
        const o = this._post;
        const hush = this.U.hush.value;
        const flood = this.U.flood.value;
        const { level, fever, punch } = this.heat;
        const hot = smooth(0.4, 0.85, level);
        const call = this.moonCall.valueAt(this.clock);
        // An iris: it closes a little as play heats and the light it adds rises, so the colours
        // stay saturated and the night stays dark between the lights.
        o.exposure = (L.exposure * (1 - hush * 0.25))
            / (1 + 0.05 * level + 0.08 * fever + 0.05 * call + 0.15 * Math.min(1, flood) * level);
        o.flash = this.flash.valueAt(this.clock) + flood * 0.25 + punch * 0.04;
        o.bloomBoost = s.sync * 0.25 + flood * 0.6 + this.U.queen.value.y * 0.4 + 0.06 * level + 0.1 * fever;
        o.moonX = this.moonScreen.x;
        o.moonY = this.moonScreen.y;
        o.moonVisible = this.moonScreen.visible;
        // The march already reads U.moonLight; this is the look's own strength: the beams stand
        // out a little in the mist as play heats, and blaze when the moon answers a back-to-back.
        o.shafts = 1 + 0.05 * hot + 0.1 * fever + 0.45 * call;
        o.hush = hush;
        o.flood = this.U.flood.value;
        o.gradeShadow[0] = L.gradeShadow[0];
        o.gradeShadow[1] = L.gradeShadow[1];
        o.gradeShadow[2] = L.gradeShadow[2];
        o.gradeLight[0] = L.gradeLight[0];
        o.gradeLight[1] = L.gradeLight[1];
        o.gradeLight[2] = L.gradeLight[2];
        return o;
    }

    getState() {
        const s = this.state;
        return {
            quality: this.quality,
            capture: this.capture,
            time: this.time,
            clock: this.clock,
            combo: s.combo,
            level: s.level,
            night: this.light.name,
            nightNext: this.light.next,
            nightMix: this.light.mix,
            nightPlace: this.nightPlace(),
            nights: NIGHTS.length,
            sync: s.sync,
            moss: s.moss,
            swarm: s.swarm,
            hush: this.U.hush.value,
            queen: this.U.queen.value.x,
            flood: this.U.flood.value,
            rings: this.ringCount,
            waves: this.U.paneWaveCount.value,
            seeds: this.seeds.length,
            fliers: this.fliers.length,
            pollen: this.pollen.length,
            open: this.parts.blooms?.count?.() ?? 0,
            locks: s.locks,
            clears: s.clears,
            blooms: s.blooms,
            released: s.released,
            queens: s.queens,
            surge: {
                level: this.heat.level, fever: this.heat.fever, stage: this.heat.stage,
            },
            turn: this.U.turn.value.y,
            layoutLive: !!this.layout,
            moon: { ...this.moonScreen },
            counts: {
                glows: this.parts.glows?.count ?? 0,
                bloomLights: this.U.bloomLightCount.value,
                lanterns: this.U.lanternCount.value,
            },
        };
    }

    get combo() {
        return this.state.combo;
    }

    dispose() {
        Object.values(this.parts).forEach((part) => part.dispose());
        this.parts = {};
        this.updating = [];
        this.group.removeFromParent();
        this.noise?.dispose();
        this.noise = null;
        this.camera = null;
    }
}
