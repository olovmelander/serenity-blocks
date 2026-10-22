/**
 * Stellar Velocity — the world.
 *
 * Owns the shared uniforms, every scene part, the camera rig and the choreography. Shared by the
 * theme (stellar-velocity-theme.js) and the playground effect
 * (src/playground/effects/stellar-velocity.effect.js), so what is iterated there ships.
 *
 * We ride down a canyon of luminous cloud toward one far sun. The sun stands left of the board
 * (above it on a phone): it is the point everything flies out of. The walls are lit from ahead,
 * so their edges are silver and their near sides glow in their own colours. The board is the
 * drive:
 *
 *   lock     the piece leaves its card as a bolt in its own colour and flies down the course.
 *            Where it arrives a hoop of plasma opens in that colour and stands in the canyon as
 *            a ring of light, and a pulse of the same colour comes down the walls toward us.
 *            The course holds the hoop for half a minute. A hard drop hits harder.
 *   clear    the drive fires. The cleared rows leave the card as jets, and we go through every
 *            hoop we have laid: each comes at us ever faster, opens across the whole frame and
 *            is gone, and a front of white light per line comes down the canyon after them.
 *            The more the board has laid, the more a clear sets off.
 *   combo    each step of a chain is a gear. The canyon rushes, the near stars draw out into
 *            trails, and the whole sky bunches toward the sun and splits into the starbow: blue
 *            dead ahead, then white, amber and red out to the sides.
 *   four     the drive holds its breath — every light sinks for a quarter of a second while
 *            the sky is drawn into the sun — and jumps: a tunnel of light, and then we drop out
 *            in a stretch of the canyon we have not seen, the sun standing bright in it. The
 *            hotter play runs the shallower the breath (in a fever it is an inhale), and a four
 *            that lands while a tunnel is still running keeps it running: one jump, never a
 *            second hush, never a restart.
 *   perfect  the crown on the clear still playing: the tunnel stays longer, its mouth flares and
 *            its threads burn gold, and we arrive with fronts of the same gold.
 *   cascade  each wave past the first is an afterburner stage: a harder thrust, fronts that run
 *            faster and bluer, the sky pulled further toward the jump, the sun's corona swelling.
 *   b2b      the sun's spikes flare gold and a gold front comes down; a second one in a row
 *            burns brighter still, and a back-to-back jump arrives in gold.
 *   T-spin   the canyon rolls: cloud, stars and hoops wind round the course and spring back.
 *   level    the nebula moves one palette along its line of six, and a slow front of the new
 *            colour comes down the canyon.
 *   time     by itself, with no level change, the nebula drifts along the same line: one
 *            palette every PALETTE_STEP seconds, there and back. The two simply add.
 *
 * Play itself builds (src/themes/shared/gameplay-surge.js): calm play looks as it always did.
 * Warm, the drive takes notice: we run faster, the sun stands brighter. Hot, the course keeps a
 * wake: every hoop we fly through re-forms at its place, so a chain lines the canyon with rings
 * in its colours. A fever is top gear: the sky bunched hard into the sun past any chain's reach,
 * the lens held wide, the rush drawn long, the sun blazing, and the drive's pulse running down
 * the walls ever faster. When the hands rest, we let off and glide again.
 *
 * Nothing is created at event time: events write numbers into preallocated slots and a small
 * queue of timed moments, so seek(t) plus a fixed-step replay reproduces any frame. The one
 * thing that is integrated is how far we have come (the speed changes, so the clock cannot be
 * multiplied by it).
 */

import * as THREE from 'three/webgpu';
import {
    AFTERBURN,
    B2B_GOLD,
    BOLT_FLIGHT,
    CANYON,
    CROWN_FIRE,
    CRUISE,
    DEG,
    DRIVEFIRE,
    FRONT_END,
    FRONT_SLOTS,
    FRONT_SPEED,
    FRONT_START,
    GEAR_CHAIN,
    GEAR_FEVER,
    GEAR_HEAT,
    GEAR_JUMP,
    HOOP_LIFE,
    HOOP_LIGHTS,
    HOOP_SLOTS,
    HOOP_STAGGER,
    HUSH_HOLD,
    JUMP_AFTERGLOW,
    JUMP_EXIT,
    JUMP_TUNNEL,
    JUMP_TUNNEL_PERFECT,
    NEBULA_PALETTES,
    PALETTE_HOME,
    PALETTE_KEYS,
    WARP_CHAIN,
    WARP_FEVER,
    WARP_JUMP,
    approach,
    bakeCanyonNoise,
    bakeFbm,
    courseAnchors,
    createCanyonTexture,
    createFbmTexture,
    createStellarUniforms,
    frontDepth,
    gearForCombo,
    hoopDepth,
    hoopFiredDepth,
    hoopHeld,
    hoopRadius,
    hoopRun,
    jumpPhase,
    mulberry32,
    paletteAt,
    paletteName,
    palettePhase,
    palettePlace,
    pieceColor,
    smooth,
    supportsFloatTargets,
    wakeShare,
    warpForCombo,
} from './stellar-velocity-tsl.js';
import { tierFor } from './stellar-velocity-quality.js';
import { createCanyon } from './stellar-velocity-nebula.js';
import {
    MOTE_DEPTH, STAR_DEPTH, createStreakField,
} from './stellar-velocity-stars.js';
import { createBolts, createHoops, createRowJets } from './stellar-velocity-fx.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './stellar-velocity-composition.js';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, Swell, softCeiling } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';
import { CANYON_SEED } from './stellar-velocity-bake.js';

/** The rest camera. */
export const REST_RIG = Object.freeze({
    minFov: 30,
    maxFov: 78,
    near: 0.05,
    far: 400,
});

/** Vertical field of view (degrees) for an aspect ratio. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((courseAnchors(a).hFov * DEG) / 2) / a)) / DEG;
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, v));
}

/**
 * Where every read of the cloud comes round whole: the cloud is drawn out along the course, and
 * its slowest read is at half scale.
 */
export const TRAVEL_WRAP = CANYON.tile * CANYON.stretch * 2;
/** Seconds the thrust of a clear takes to fade to 1/e, and the gears one unit of it adds. */
export const BOOST_COOL = 1.5;
export const BOOST_GEAR = 9;
export const BOOST_MAX = 2.2;
/** The canyon's roll: how hard it pulls back and how fast it settles. */
const TWIST_STIFFNESS = 24;
const TWIST_DAMPING = 4.4;
/** How far along the view ray (canyon units) a bolt leaves the card. */
const BOLT_DEPTH = 1.5;
/** How much brighter than its mesh a hoop's light on the cloud is. */
const HOOP_CAST = 3.4;
/** A four that lands in a running tunnel keeps it running at least this share of a tunnel more. */
const JUMP_CHAIN = 0.6;
/** How fast the shown tunnel may open (it opens in about a tenth of a second) and close (per s). */
const JUMP_RISE = 12.5;
const JUMP_FALL = 2;
/** The fever's pulse down the walls: seconds between two, cold and at full fever. */
const PULSE_SLOW = 0.8;
const PULSE_FAST = 0.36;

const PARTS = ['canyon', 'stars', 'motes', 'hoops', 'bolts', 'jets'];

const KEYS = PALETTE_KEYS;

export class StellarVelocityWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {THREE.WebGPURenderer} [params.renderer]
     * @param {boolean} [params.capture=false]  deterministic captures: no wall-clock anywhere
     * @param {number} [params.seed]
     * @param {boolean} [params.floatTarget]  paint the canyon into a half-float target (default:
     *                                        ask the renderer)
     */
    constructor({
        scene, quality = 'High', renderer = null, capture = false, seed = 0x57e1, floatTarget,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.renderer = renderer;
        this.capture = capture;
        this.seed = seed;
        this.floatTarget = floatTarget ?? supportsFloatTargets(renderer);
        this.root = new THREE.Group();
        this.root.name = 'StellarVelocity';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.canyon = null;
        this.stars = null;
        this.motes = null;
        this.bolts = null;
        this.jets = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        /** The sun on screen (fractions, y down). */
        this.heart = { x: 0.23, y: 0.45 };
        this.anchors = courseAnchors(this.aspect);
        this._camera = null;
        this._rest = new THREE.PerspectiveCamera(50, 16 / 9, REST_RIG.near, REST_RIG.far);
        this._f = new THREE.Vector3(0, 0, -1);
        this._r = new THREE.Vector3(1, 0, 0);
        this._up = new THREE.Vector3(0, 1, 0);
        this._ray = new THREE.Vector3();
        this._basis = new THREE.Matrix4();
        this._point = { x: 0.5, y: 0.5 };
        this._from = [0, 0, 0];
        this._tanH = 1;
        this._tanV = 0.56;
        this._ringPalette = {};
        this._palette = {};
        KEYS.forEach((key) => {
            this._palette[key] = [...NEBULA_PALETTES[PALETTE_HOME][key]];
        });
        this._post = {
            heart: this.heart,
            flash: 0,
            flashTint: [1, 1, 1],
            kick: 0,
            rays: 0.12,
            blur: 0,
            bloomBoost: 0,
            glint: 1,
            glintTint: [0.7, 0.85, 1],
            exposure: 1,
            jump: 0,
            warp: 0,
        };
        this.hoopSlots = Array.from({ length: HOOP_SLOTS }, () => ({
            birth: -1e6, fired: Infinity, reserved: -1e6, rgb: [1, 1, 1], seed: 0, strength: 0, wake: false,
        }));
        this.frontSlots = Array.from({ length: FRONT_SLOTS }, () => ({
            birth: -1e6, speed: 1, rgb: [1, 1, 1], strength: 0, width: 1,
        }));
        this._lit = [];
        /**
         * How hot play runs (src/themes/shared/gameplay-surge.js), fed by every lock, clear and
         * level on the world's own clock: it drives the gear past a chain's, the fever's warp,
         * the sun, the wake and the pulse.
         */
        this.pace = new GameplaySurge();
        /** The pace as of the last frame (a copy: the sample object is reused). */
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        /**
         * A cascade's afterburner, a back-to-back's gold and a perfect clear's crown: each hit adds
         * to what is still lit, so a deeper wave burns on the last and a second back-to-back
         * brighter than the first.
         */
        this.afterburn = new Swell({
            attack: 0.04, release: 1.4, ceiling: 1.6, knee: 1.1,
        });
        this.gild = new Swell({
            attack: 0.06, release: 2.6, ceiling: 1.5, knee: 1,
        });
        this.crown = new Swell({
            attack: 0.08, release: 2.4, ceiling: 1.4, knee: 1,
        });
        this.resetState(0);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.combo = 0;
        this.gear = 1;
        this.warp = 0;
        this.boost = 0;
        this.surge = 0;
        this.level = 1;
        /** The level's place on the palettes' line (level − 1), eased when a level changes. */
        this.levelPlace = 0;
        this.flash = 0;
        this.flashTint = [1, 1, 1];
        this.kick = 0;
        this.dip = 0;
        this.breath = 1;
        this.twist = 0;
        this.twistVelocity = 0;
        this.hushUntil = -1;
        /** How deep the breath is held (1 from cold; shallower the hotter play runs). */
        this.hushDepth = 1;
        this.jumpStart = -100;
        this.jumpLength = JUMP_TUNNEL;
        /** The tunnel as shown: it follows jumpPhase, but never snaps shut or open. */
        this.jumpShown = 0;
        /** A jump about to open (after the hush): when, how long, perfect, back-to-back. */
        this.leapAt = Infinity;
        this.leapLength = JUMP_TUNNEL;
        this.leapPerfect = false;
        this.leapGold = false;
        /** When the running tunnel lets us out, and how we arrive. */
        this.arriveAt = Infinity;
        this.arrivePerfect = false;
        this.arriveGold = false;
        this.jumpClock = 0;
        this.jumps = 0;
        /** The fever's next pulse down the walls. */
        this.pulseAt = -Infinity;
        this.frontCursor = 0;
        this.lastClear = { time: -100, lines: 0 };
        /** Timed moments still ahead: a bolt's landing, a hoop passing us, a jump, an arrival. */
        this.queue = [];
        this.counts = {
            locks: 0, clears: 0, quads: 0, bolts: 0, passes: 0,
        };
        // How far we have come is a function of the clock until gameplay bends it.
        const motion = this.reducedMotion ? 0.5 : 1;
        this.distance = time * CRUISE * motion;
        this.speed = CRUISE * motion;
        this.hoopSlots?.forEach((slot) => {
            slot.birth = -1e6;
            slot.fired = Infinity;
            slot.reserved = -1e6;
            slot.strength = 0;
            slot.wake = false;
        });
        this.pace?.reset();
        this.afterburn?.reset();
        this.gild?.reset();
        this.crown?.reset();
        if (this.heat) {
            this.heat.punch = 0;
            this.heat.level = 0;
            this.heat.fever = 0;
            this.heat.stage = 0;
        }
        this.frontSlots?.forEach((slot) => {
            slot.birth = -1e6;
            slot.strength = 0;
        });
        this.bolts?.reset();
        this.jets?.reset();
        if (this.u) {
            this.u.shift.value.set(0, 0, 0);
            this.writeCourse();
        }
    }

    build() {
        const { tier } = this;
        const baked = bakeCanyonNoise(CANYON_SEED, tier.noise);
        const canyon = createCanyonTexture(baked.near, tier.noise);
        const canyonFar = createCanyonTexture(baked.far, baked.farSize, 'stellar-velocity-canyon-far');
        const fbm = createFbmTexture(bakeFbm());
        const placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
        placeholder.needsUpdate = true;
        this.textures.push(canyon, canyonFar, fbm, placeholder);
        const u = createStellarUniforms({
            canyon, canyonFar, fbm, target: placeholder, floatTarget: this.floatTarget,
        });
        this.u = u;

        this.canyon = createCanyon(u, {
            march: tier.march, detail: tier.detail, taps: tier.taps, lights: tier.lights, skyLayers: tier.skyLayers,
        });
        this.addPart('canyon', this.canyon);
        this.stars = createStreakField(u, { count: tier.stars, kind: 'stars', seed: this.seed + 11 });
        this.addPart('stars', this.stars);
        this.motes = createStreakField(u, { count: tier.motes, kind: 'motes', seed: this.seed + 23 });
        this.addPart('motes', this.motes);

        // ── Gameplay effects (pools, always drawn) ──
        this.addPart('hoops', createHoops(u));
        this.bolts = createBolts(u);
        this.addPart('bolts', this.bolts);
        this.jets = createRowJets(u);
        this.addPart('jets', this.jets);

        this.resetState(this.time);
        this.applyPalette(1);
        this.compose();
        this.scene.add(this.root);
        return this;
    }

    addPart(name, part) {
        this.parts[name] = part;
        this.root.add(part.mesh);
        this.disposables.push(part);
    }

    /** Draw only the named parts (captures, bisecting a look). */
    showOnlyParts(names) {
        const keep = new Set(names);
        Object.keys(this.parts).forEach((name) => {
            this.parts[name].mesh.visible = keep.has(name);
        });
    }

    setViewport(bufferWidth, bufferHeight, aspect) {
        if (this.u && bufferWidth > 0 && bufferHeight > 0) {
            this.u.viewport.value.set(bufferWidth, bufferHeight);
            this.canyon?.resize(bufferWidth, bufferHeight, this.tier.canyonScale);
        }
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) {
            this.aspect = aspect;
            this.compose();
        }
        if (!this.layoutLive) this.layout = fallbackLayout(this.aspect * 1000, 1000);
        this.updatePixelAngle();
    }

    /**
     * The live board / card / HUD rects (screen fractions), or null when no board is on screen:
     * events then aim at where the solo board would be.
     */
    setLayout(rects, aspect) {
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) {
            this.aspect = aspect;
            this.compose();
            this.updatePixelAngle();
        }
        this.layoutLive = Boolean(rects);
        this.layout = rects || fallbackLayout(this.aspect * 1000, 1000);
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Jump the clock (captures): drops every event in flight. */
    seek(time) {
        this.resetState(Math.max(0, time));
        this.applyPalette(1);
    }

    /** A new run: back to a glide (we keep going, and the nebula keeps its place on the clock). */
    resetSession() {
        const { time, distance, levelPlace } = this;
        const shift = this.u ? this.u.shift.value.clone() : null;
        this.resetState(time);
        // The nebula eases back to the first level's place; it does not jump.
        Object.assign(this, { distance, levelPlace });
        if (shift) this.u.shift.value.copy(shift);
    }

    /** Nothing here is layered; kept so the theme and the playground bind every world alike. */
    bindCamera(camera) {
        this._camera = camera;
    }

    updatePixelAngle() {
        if (!this.u) return;
        const height = Math.max(1, this.u.viewport.value.y);
        this.u.pixelAngle.value = (2 * Math.tan((fovForAspect(this.aspect) * DEG) / 2)) / height;
    }

    // ── The course's place in the frame ─────────────────────────────────────────

    /**
     * Stand a camera on the course so that the sun (the far end of −Z) hangs at the anchor for
     * this aspect: it looks aside by exactly what puts the sun there, with no roll.
     */
    aim(camera, fov, yawOff = 0, pitchOff = 0, roll = 0) {
        const a = this.anchors;
        const tanV = Math.tan((fov * DEG) / 2);
        const tanH = tanV * this.aspect;
        const nx = a.x * 2 - 1;
        const ny = 1 - a.y * 2;
        const pitch = Math.atan(-ny * tanV) + pitchOff;
        const yaw = Math.atan(-nx * tanH * Math.cos(pitch)) + yawOff;
        const f = this._f.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
        const r = this._r.set(Math.cos(yaw), 0, Math.sin(yaw));
        const up = this._up.copy(r).cross(f).normalize();
        if (roll) {
            const c = Math.cos(roll);
            const s = Math.sin(roll);
            const rx = r.x * c + up.x * s;
            const ry = r.y * c + up.y * s;
            const rz = r.z * c + up.z * s;
            up.set(up.x * c - r.x * s, up.y * c - r.y * s, up.z * c - r.z * s);
            r.set(rx, ry, rz);
        }
        this._ray.copy(f).negate();
        this._basis.makeBasis(r, up, this._ray);
        camera.quaternion.setFromRotationMatrix(this._basis);
        this._tanH = tanH;
        this._tanV = tanV;
    }

    /** The rest camera for the current aspect (what the composition is measured in). */
    restCamera() {
        const cam = this._rest;
        cam.fov = fovForAspect(this.aspect);
        cam.aspect = this.aspect;
        cam.near = REST_RIG.near;
        cam.far = REST_RIG.far;
        cam.updateProjectionMatrix();
        cam.position.set(0, 0, 0);
        this.aim(cam, cam.fov);
        cam.updateMatrixWorld();
        return cam;
    }

    /** Where the composition wants the sun for this aspect. */
    compose() {
        this.anchors = courseAnchors(this.aspect);
        this.heart.x = this.anchors.x;
        this.heart.y = this.anchors.y;
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const t = sim.time;
        // The staged gameplay is flushed between this and update(): it must carry this frame's time.
        this.time = t;
        const calm = this.reducedMotion ? 0 : 1;
        const phase = this.jumpShown;
        // The lens opens as we gather speed, wider in a fever (it holds there), and wide in a jump.
        const share = this.rushShare();
        const fov = Math.min(
            REST_RIG.maxFov + 8,
            fovForAspect(this.aspect) + (share * 5 + this.heat.fever * 3 + phase * 8 + this.kickShown() * 1.4) * calm,
        );
        if (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        // A slow sway, as of something under way, plus the pointer leaning the view: the near
        // cloud slides against the far, and the far against the stars.
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        camera.position.set(
            (Math.sin(t * 0.047) * 0.07 + Math.sin(t * 0.021 + 1.3) * 0.04 + px * 0.06) * calm,
            (Math.sin(t * 0.039 + 0.7) * 0.05 + Math.sin(t * 0.017) * 0.03 - py * 0.04) * calm,
            this.kickShown() * 0.03 * calm,
        );
        const yaw = (Math.sin(t * 0.031 + 2.1) * 0.01 - px * 0.03) * calm;
        const pitch = (Math.sin(t * 0.027) * 0.007 + py * 0.02) * calm;
        const roll = (Math.sin(t * 0.019) * 0.012 + this.twist * 0.25) * calm;
        this.aim(camera, fov, yaw, pitch, roll);
        // The shared breath (shared/camera-breath.js) on top of the sway above, turning the
        // view only (the rig aims, it frames no subject): off under reduced motion.
        applyCameraBreath(camera, t, { scale: this.reducedMotion ? 0 : 1 });
        camera.updateMatrixWorld();
        this._camera = camera;
    }

    /**
     * How much of its rush the frame shows (0 at a glide): the lens, the zoom's blur. A chain's
     * gears fill it to the knee at once; past it only the heat of play takes it on, so the lens
     * keeps opening through a long chain instead of standing wide from its third clear. A fever
     * holds it open.
     */
    rushShare() {
        const gears = Math.max(0, (this.gear - 1) / (GEAR_CHAIN - 1));
        const { level, fever } = this.heat;
        return softCeiling(gears, 0.6, 0.85 + level * 0.3) + fever * 0.2;
    }

    /** The kick as shown: its own, riding on the punch of play (rapid locks hold a floor). */
    kickShown() {
        return Math.max(this.kick, this.heat.punch * 0.45);
    }

    /**
     * The true world point `depth` along what is SEEN through a screen point (fractions, y
     * down): at speed the sky is bunched forward, so the ray is first taken back to where it
     * truly points.
     */
    screenToWorld(sx, sy, depth, out = this._from) {
        const camera = this._camera;
        if (!camera) {
            out[0] = 0;
            out[1] = 0;
            out[2] = -depth;
            return out;
        }
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        const beta = this.warp * 0.5;
        const seen = Math.max(-1, Math.min(1, -this._ray.z));
        const truth = (seen - beta) / (1 - beta * seen);
        const side = Math.sqrt(Math.max(1e-8, 1 - seen * seen));
        const k = Math.sqrt(Math.max(0, 1 - truth * truth)) / side;
        out[0] = camera.position.x + this._ray.x * k * depth;
        out[1] = camera.position.y + this._ray.y * k * depth;
        out[2] = camera.position.z - truth * depth;
        return out;
    }

    // ── Gameplay ────────────────────────────────────────────────────────────────

    /** The card a board sits in (several boards: each has its own), else every card as one. */
    cardFor(board) {
        const cards = this.layout?.cards;
        if (board && cards?.length > 1) {
            const cx = (board.x0 + board.x1) * 0.5;
            const cy = (board.y0 + board.y1) * 0.5;
            for (let i = 0; i < cards.length; i++) {
                const c = cards[i];
                if (cx >= c.x0 && cx <= c.x1 && cy >= c.y0 && cy <= c.y1) return c;
            }
        }
        return cardUnion(this.layout);
    }

    /**
     * Where the line from (px, py) to the sun leaves `card` (screen fractions). A point that is
     * not inside the card, or a sun that is, leaves from the point itself.
     */
    cardExit(px, py, card, out = this._point) {
        out.x = px;
        out.y = py;
        if (!card || px < card.x0 || px > card.x1 || py < card.y0 || py > card.y1) return out;
        const hx = this.heart.x;
        const hy = this.heart.y;
        if (hx > card.x0 && hx < card.x1 && hy > card.y0 && hy < card.y1) return out;
        const dx = hx - px;
        const dy = hy - py;
        let best = 1;
        if (dx > 1e-6) best = Math.min(best, (card.x1 - px) / dx);
        if (dx < -1e-6) best = Math.min(best, (card.x0 - px) / dx);
        if (dy > 1e-6) best = Math.min(best, (card.y1 - py) / dy);
        if (dy < -1e-6) best = Math.min(best, (card.y0 - py) / dy);
        const k = Math.max(0, Math.min(1, best));
        out.x = px + dx * k;
        out.y = py + dy * k;
        return out;
    }

    /**
     * Do something at `time`, which may be a moment ahead: the frame that reaches it fires it,
     * stamped with its own moment. Two events that fall in the same frame both happen.
     */
    schedule(time, kind, data = null) {
        const q = this.queue;
        let i = q.length;
        while (i > 0 && q[i - 1].time > time) i -= 1;
        q.splice(i, 0, { time, kind, data });
    }

    /** Fire everything the clock has reached. */
    drain(t) {
        const q = this.queue;
        while (q.length && q[0].time <= t) {
            const { time, kind, data } = q.shift();
            if (kind === 'open') this.open(time, data);
            else if (kind === 'front') this.front(time, data);
            else if (kind === 'pass') this.pass(time, data);
            else if (kind === 'kick') this.kick = Math.max(this.kick, data);
            else if (kind === 'boost') {
                // As if it had begun at its own moment, whatever frame noticed it.
                this.boost = Math.min(BOOST_MAX, this.boost + data * Math.exp(-(t - time) / BOOST_COOL));
            }
        }
        // The jump: one tunnel at a time, its opening and its end kept here (a four in a running
        // tunnel moves its end, so they cannot wait in the queue).
        if (this.leapAt <= t) this.enterTunnel(this.leapAt);
        if (this.arriveAt <= t) this.arrive(this.arriveAt);
    }

    /** Light the frame for a moment in a colour (the strongest of what is live wins the tint). */
    tintFlash(amount, rgb = DRIVEFIRE) {
        if (amount >= this.flash) {
            this.flashTint[0] = rgb[0];
            this.flashTint[1] = rgb[1];
            this.flashTint[2] = rgb[2];
        }
        this.flash = Math.max(this.flash, amount);
    }

    /**
     * The slot a new hoop takes: an empty one, else the one holding the least light. Never one
     * a bolt is already on its way to, or one that is being fired.
     */
    weakestHoop(time) {
        let best = -1;
        let least = Infinity;
        for (let i = 0; i < HOOP_SLOTS; i++) {
            const slot = this.hoopSlots[i];
            if (slot.reserved > time) continue;
            if (slot.fired < Infinity && time - slot.fired < 2) continue;
            const held = slot.fired < Infinity ? 0 : hoopHeld(time - slot.birth, slot.wake) * slot.strength;
            // Among the empty ones, the nearest first: the course fills from the camera outward.
            const score = held > 0.004 ? held + 1 : i * 1e-3;
            if (score < least) {
                least = score;
                best = i;
            }
        }
        if (best >= 0) return best;
        // Every slot is spoken for (a fast chain has them all in flight): take one no bolt is on
        // its way to, the one that left its place first (it is behind us soonest); failing that,
        // the one whose bolt lands first, so a hoop that has just opened is never taken.
        let pick = -1;
        for (let i = 0; i < HOOP_SLOTS; i++) {
            const slot = this.hoopSlots[i];
            if (slot.reserved > time) continue;
            if (pick < 0 || slot.fired < this.hoopSlots[pick].fired) pick = i;
        }
        if (pick >= 0) return pick;
        let first = 0;
        for (let i = 1; i < HOOP_SLOTS; i++) {
            if (this.hoopSlots[i].reserved < this.hoopSlots[first].reserved) first = i;
        }
        return first;
    }

    /** A bolt lands: its hoop opens on the course. */
    open(time, {
        slot, rgb, strength, seed,
    }) {
        const hoop = this.hoopSlots[slot];
        hoop.birth = time;
        hoop.fired = Infinity;
        hoop.rgb = rgb;
        hoop.strength = strength;
        hoop.seed = seed;
        hoop.wake = false;
        this.tintFlash(strength > 0.9 ? 0.07 : 0.03, rgb);
    }

    /**
     * The front slot a new one takes: a finished one, else the one with the least light still to
     * bring down the canyon (strength × the share of its run ahead). Never simply the oldest: a
     * level's slow front or a four's fronts must not be cut by the lock pulses of rapid play.
     */
    freeFront(time) {
        let best = 0;
        let least = Infinity;
        for (let i = 0; i < FRONT_SLOTS; i++) {
            const slot = this.frontSlots[i];
            const depth = frontDepth(Math.max(0, time - slot.birth), slot.speed);
            if (slot.strength <= 0 || depth < FRONT_END) return i;
            const left = slot.strength * ((depth - FRONT_END) / (FRONT_START - FRONT_END));
            if (left < least) {
                least = left;
                best = i;
            }
        }
        return best;
    }

    /** A front of light leaves the sun's end of the canyon. */
    front(time, {
        speed, rgb, strength, width,
    }) {
        const slot = this.frontSlots[this.freeFront(time)];
        this.frontCursor += 1;
        slot.birth = time;
        slot.speed = speed;
        slot.rgb = rgb;
        slot.strength = strength;
        slot.width = width;
    }

    /** A fired hoop passes the camera: its colour crosses the frame. */
    pass(time, { rgb, strength }) {
        this.tintFlash(0.1 + 0.12 * strength, rgb);
        this.kick = Math.max(this.kick, 0.22);
        this.counts.passes += 1;
    }

    /** Seconds in the tunnel for a four (a perfect clear stays longer; reduced motion: short). */
    tunnelFor(perfect) {
        if (this.reducedMotion) return 1.1;
        return perfect ? JUMP_TUNNEL_PERFECT : JUMP_TUNNEL;
    }

    /** Is a tunnel open at `time`, or still closing behind us? */
    jumpLive(time) {
        const since = time - this.jumpStart;
        return since >= 0 && since < this.jumpLength + JUMP_EXIT;
    }

    /**
     * Four lines (or a perfect clear) at `time`: the jump. Returns when the drive fires (after the
     * hush, or at once when a tunnel is already running). One jump at a time, never restarted:
     *  - in the hush, the tunnel about to open is made long enough for both;
     *  - in a running tunnel (or one closing behind us) it runs on: no second hush, the arrival
     *    moves to its new end;
     *  - from open flight, the drive holds its breath first, as deep as play is cold.
     */
    leap(time, { perfect = false, gold = false } = {}) {
        const length = this.tunnelFor(perfect);
        if (this.leapAt < Infinity) {
            this.leapLength = Math.max(this.leapLength, length);
            this.leapPerfect = this.leapPerfect || perfect;
            this.leapGold = this.leapGold || gold;
            return this.leapAt;
        }
        if (this.jumpLive(time)) {
            this.extendJump(time, length * JUMP_CHAIN, { perfect, gold });
            return time;
        }
        // From cold it holds its breath fully; in a fever it barely pauses for it. Every light
        // sinking at once is a frame-wide flash in reverse: Reduce flashing keeps little of it.
        this.hushDepth = (1 - 0.8 * this.heat.level) * flashScale();
        this.hushUntil = time + HUSH_HOLD;
        this.leapAt = time + HUSH_HOLD;
        this.leapLength = length;
        this.leapPerfect = perfect;
        this.leapGold = gold;
        return this.leapAt;
    }

    /**
     * The running tunnel runs on: at least `more` seconds from `time` (and a perfect clear's whole
     * length from its start). Dropping out of it, we dive straight back in (the shown tunnel opens
     * again from where it stands) and arrive once more at its new end.
     */
    extendJump(time, more, { perfect = false, gold = false } = {}) {
        const since = time - this.jumpStart;
        const length = Math.max(this.jumpLength, perfect ? this.tunnelFor(true) : 0, since + more);
        if (since >= this.jumpLength) {
            // Already out (or on the way): a fresh arrival is owed at the new end.
            this.arrivePerfect = perfect;
            this.arriveGold = gold;
        } else {
            this.arrivePerfect = this.arrivePerfect || perfect;
            this.arriveGold = this.arriveGold || gold;
        }
        this.jumpLength = length;
        this.arriveAt = this.jumpStart + length;
    }

    /** The tunnel opens. */
    enterTunnel(time) {
        this.jumpStart = time;
        this.jumpLength = this.leapLength;
        this.arriveAt = time + this.leapLength;
        this.arrivePerfect = this.leapPerfect;
        this.arriveGold = this.leapGold;
        this.leapAt = Infinity;
        this.tintFlash(0.55);
        this.kick = Math.max(this.kick, 1);
    }

    /** We drop out, somewhere else: the cloud's whole field is shifted while nothing can be seen of it. */
    arrive(time) {
        const perfect = this.arrivePerfect;
        const gold = this.arriveGold;
        this.arriveAt = Infinity;
        this.arrivePerfect = false;
        this.arriveGold = false;
        this.jumps += 1;
        const rand = mulberry32(this.seed + this.jumps * 7919);
        if (this.u) this.u.shift.value.set((rand() - 0.5) * 9, (rand() - 0.5) * 9, rand() * TRAVEL_WRAP);
        let afterglow = 1;
        let tint = DRIVEFIRE;
        if (perfect) {
            afterglow = 1.3;
            tint = CROWN_FIRE;
        } else if (gold) {
            afterglow = 1.15;
            tint = B2B_GOLD;
        }
        this.surge = Math.max(this.surge, afterglow);
        this.tintFlash(0.8, tint);
        this.kick = Math.max(this.kick, 0.7);
        this.front(time, {
            speed: FRONT_SPEED.clear * 0.6, rgb: [...DRIVEFIRE], strength: 1.5, width: 2.6,
        });
        if (perfect) {
            // The crown comes down the new stretch after us: three more fronts of the drive's fire.
            for (let i = 1; i <= 3; i++) {
                this.schedule(time + i * 0.16, 'front', {
                    speed: FRONT_SPEED.clear * (0.7 + 0.1 * i), rgb: [...DRIVEFIRE], strength: 1.2, width: 1.8,
                });
            }
        }
    }

    /**
     * A piece locked. `u` = its column as a fraction of the board width, `rows` = the visible
     * rows it covers, `color` = the piece's colour; `screen` (fractions) replaces the board point.
     */
    onLock({
        u = 0.5, rows = null, hardDrop = false, color = null, player = 0, screen = null,
    } = {}) {
        if (!this.u || !this.bolts) return;
        const rgb = pieceColor(color);
        let px = 0.5;
        let py = 0.6;
        if (screen && Number.isFinite(screen.x) && Number.isFinite(screen.y)) {
            px = screen.x;
            py = screen.y;
        } else {
            const board = boardFor(this.layout, player);
            if (board) {
                const row = Array.isArray(rows) && rows.length ? rows[Math.floor(rows.length / 2)] : 19;
                boardPoint(board, u, row, this._point);
                px = this._point.x;
                py = this._point.y;
            }
            // The bolt leaves its own card's edge on the way to the sun.
            this.cardExit(px, py, this.cardFor(board), this._point);
            px = this._point.x;
            py = this._point.y;
        }
        const t = this.time;
        const slot = this.weakestHoop(t);
        const depth = hoopDepth(slot);
        const flight = this.reducedMotion ? 0.12 : BOLT_FLIGHT * (0.8 + depth / 14);
        const land = t + flight;
        this.hoopSlots[slot].reserved = land;
        const from = [...this.screenToWorld(px, py, BOLT_DEPTH)];
        this.bolts.launch({
            from, to: [0, 0, -depth], rgb, time: t, flight, size: hardDrop ? 1.7 : 1,
        });
        const strength = hardDrop ? 1 : 0.78;
        this.schedule(land, 'open', {
            slot, rgb: [rgb[0], rgb[1], rgb[2]], strength, seed: (this.counts.bolts % 89) + 1,
        });
        // Its light comes down the canyon's walls toward us.
        this.schedule(land, 'front', {
            speed: FRONT_SPEED.lock, rgb: [rgb[0], rgb[1], rgb[2]], strength: hardDrop ? 0.85 : 0.5, width: 1.1,
        });
        if (hardDrop) this.schedule(t, 'kick', 0.5);
        // Every piece is a little thrust.
        this.boost = Math.min(BOOST_MAX, this.boost + (hardDrop ? 0.07 : 0.035));
        this.pace.lock({ hardDrop }, t);
        this.counts.bolts += 1;
        this.counts.locks += 1;
    }

    /**
     * Lines cleared. `lines` 1..4; `tspin`, `perfect`, `b2b`; `cascade` = the wave (1 = the lock's
     * own clear, 2.. its cascade); `combo` = the chain it belongs to; `rows` = the visible rows
     * that went.
     */
    onClear({
        rows = null, lines = 1, tspin = false, perfect = false, b2b = false, cascade = 1, combo = 1,
        player = 0, screen = null,
    } = {}) {
        const { u } = this;
        if (!u || !this.bolts) return;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        const t = this.time;
        // A cascade's waves past the first: afterburner stages, each on the last.
        const stage = Math.max(0, Math.min(9, Math.round(Number(cascade) || 1) - 1));
        const gold = b2b === true;
        // The jump (its hush first, from open flight; none in a tunnel already running). The
        // hush's depth reads the heat of play BEFORE this clear's own.
        const birth = quad ? this.leap(t, { perfect, gold }) : t;
        this.pace.clear({
            lines: n, cascade, combo, tspin, perfect, b2b,
        }, t);

        // ── We go through every hoop we have laid, the nearest first ──
        const mixRgb = [0, 0, 0];
        let weight = 0;
        let fired = 0;
        for (let i = 0; i < HOOP_SLOTS; i++) {
            const hoop = this.hoopSlots[i];
            if (hoop.fired < Infinity) continue;
            const held = hoopHeld(t - hoop.birth, hoop.wake) * hoop.strength;
            if (held < 0.03) continue;
            const depth = hoopDepth(i);
            hoop.fired = birth + fired * HOOP_STAGGER;
            this.schedule(hoop.fired + hoopRun(depth), 'pass', { rgb: [...hoop.rgb], strength: Math.min(1, held * 1.4) });
            for (let c = 0; c < 3; c++) mixRgb[c] += hoop.rgb[c] * held;
            weight += held;
            fired += 1;
        }
        // The drive's own fire, with a breath of what the course was holding.
        let rgb = [...DRIVEFIRE];
        if (weight > 0.05 && !quad) {
            const k = Math.min(0.4, weight / 5);
            rgb = rgb.map((c, i) => c * (1 - k) + (mixRgb[i] / weight) * k);
        }
        // A cascade's deeper waves burn bluer, as of a faster ship.
        if (stage > 0) {
            const k = Math.min(1, 0.3 + stage * 0.22);
            rgb = rgb.map((c, i) => c * (1 - k) + AFTERBURN[i] * k);
        }
        const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
        rgb = rgb.map((c) => (c / peak) * 0.96 + 0.04);

        // ── A front of light per line comes down the canyon after them ──
        // Each wave of a cascade sends them faster, stronger and wider than the last.
        const fronts = perfect ? 4 : n;
        const after = birth + fired * HOOP_STAGGER * 0.5;
        for (let i = 0; i < fronts; i++) {
            this.schedule(after + i * 0.13, 'front', {
                speed: FRONT_SPEED.clear * (1 + 0.14 * stage),
                rgb: [...rgb],
                strength: 0.42 + 0.06 * n + 0.13 * stage,
                width: 0.85 + 0.16 * stage,
            });
        }
        if (stage > 0) this.afterburn.hit(0.32 + 0.12 * stage, birth);
        // Back-to-back: the sun burns gold and its spikes flare (a second in a row adds to the
        // first). Not a gold front: the gas answers a front in its own glow, and gold in teal gas
        // is mud.
        if (gold) this.gild.hit(1, birth);
        this.schedule(birth, 'boost', 0.42 + 0.2 * n + Math.min(0.55, weight * 0.07) + 0.12 * stage);
        this.schedule(birth + 0.05, 'kick', 0.25 + 0.1 * n + 0.08 * stage);
        this.lastClear = { time: birth, lines: n };

        // ── The cleared rows leave the card as jets ──
        const board = boardFor(this.layout, player);
        const ownCard = this.cardFor(board);
        if (board && ownCard && this.jets && !screen) {
            const list = Array.isArray(rows) && rows.length ? rows : Array.from({ length: n }, (_, i) => 19 - i);
            const points = [];
            for (let i = 0; i < list.length && i < 4; i++) {
                boardPoint(board, 0.5, list[i], this._point);
                this.cardExit(this._point.x, this._point.y, ownCard, this._point);
                points.push({ x: this._point.x, y: this._point.y });
            }
            this.jets.fire(points, rgb, t, Math.min(1.4, 0.7 + 0.18 * n));
        }

        if (quad) this.counts.quads += 1;
        if (tspin) {
            // The canyon rolls round the course and springs back.
            this.twistVelocity += 0.5;
            this.kick = Math.max(this.kick, 0.35);
        }
        this.counts.clears += 1;
    }

    /**
     * A perfect clear that settled after its clear (physics sends it ~360 ms after the last
     * wave): the crown on the clear still playing, never a second clear. A running jump (or the
     * one about to open) stays the perfect clear's length, its mouth flares, its threads burn
     * gold, and it arrives with the crown's fronts. With no jump under way, the perfect clear is
     * its own.
     */
    onPerfect() {
        if (!this.u) return;
        const t = this.time;
        this.pace.crown(t);
        this.crown.hit(1, t);
        this.tintFlash(0.3, CROWN_FIRE);
        this.kick = Math.max(this.kick, 0.5);
        const running = this.leapAt < Infinity || this.jumpLive(t);
        const birth = this.leap(t, { perfect: true });
        if (!running) {
            this.counts.quads += 1;
            for (let i = 0; i < 4; i++) {
                this.schedule(birth + i * 0.13, 'front', {
                    speed: FRONT_SPEED.clear, rgb: [...DRIVEFIRE], strength: 0.8, width: 1,
                });
            }
        }
    }

    /** A T-spin that cleared nothing: a little roll of the canyon and a nudge. */
    onSpin() {
        if (!this.u) return;
        this.pace.spin(this.time);
        this.twistVelocity += 0.24;
        this.kick = Math.max(this.kick, 0.18);
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        // The chain broke: we let off.
        if (n === 0 && this.combo >= 2) this.dip = Math.max(this.dip, 0.2);
        // Another step of the chain: a gear. A front in the nebula's own glow comes down.
        if (n >= 2 && n > this.combo) {
            this.boost = Math.min(BOOST_MAX, this.boost + 0.16);
            this.tintFlash(0.05);
            const p = this._palette.glow;
            const peak = Math.max(p[0], p[1], p[2], 1e-4);
            this.front(this.time, {
                speed: FRONT_SPEED.clear, rgb: p.map((c) => (c / peak) * 0.8 + 0.2), strength: Math.min(1, 0.4 + 0.07 * n), width: 1.4,
            });
        }
        this.combo = n;
    }

    /**
     * A new level: the nebula moves one palette along (it also drifts there by itself, a step
     * every PALETTE_STEP seconds), and a slow front of the new colour comes down the canyon.
     */
    levelUp(level, { silent = false } = {}) {
        this.level = Math.max(1, Math.round(Number(level) || 1));
        if (silent) this.applyPalette(1);
        else if (this.u) {
            // The front comes in the colour the nebula is on its way to.
            const tint = paletteAt(palettePlace(this.level - 1, this.time), this._ringPalette).glow;
            const peak = Math.max(tint[0], tint[1], tint[2], 1e-4);
            this.front(this.time, {
                speed: FRONT_SPEED.level, rgb: tint.map((c) => (c / peak) * 0.85 + 0.15), strength: 1.2, width: 3.4,
            });
            this.tintFlash(0.12);
            this.pace.levelUp(this.time);
        }
    }

    /**
     * The live palette: the level's place on the palettes' line, eased toward level − 1 (k = 1
     * snaps), plus the clock's own drift. The PLACE is eased, never the colours, so once a level
     * change has settled the palette is a pure function of the level and the clock.
     */
    applyPalette(k) {
        const target = this.level - 1;
        this.levelPlace += (target - this.levelPlace) * Math.min(1, k);
        if (Math.abs(target - this.levelPlace) < 1e-3) this.levelPlace = target;
        paletteAt(palettePlace(this.levelPlace, this.time), this._palette);
    }

    /** Write the hoops and the fronts as they stand at this moment. */
    writeCourse() {
        const { u } = this;
        const t = this.time;
        const rows = u.tables.hoops;
        const lit = this._lit;
        lit.length = 0;
        for (let i = 0; i < HOOP_SLOTS; i++) {
            const hoop = this.hoopSlots[i];
            const age = t - hoop.birth;
            let light = 0;
            let depth = hoopDepth(i);
            let radius = hoopRadius(i);
            if (age >= 0 && age <= HOOP_LIFE && hoop.strength > 0) {
                light = hoopHeld(age, hoop.wake) * hoop.strength;
                // It springs open.
                radius *= 1 - Math.exp(-age * 7) * Math.cos(age * 10);
                if (hoop.fired <= t) {
                    const since = t - hoop.fired;
                    const run = since / hoopRun(depth);
                    depth = hoopFiredDepth(depth, since);
                    // It flares as it comes, and is gone once it is behind us.
                    light = Math.max(light, 0.45 * hoop.strength) * (1 + 0.9 * Math.min(1, run) ** 2);
                    if (depth < -1.2) {
                        // While play runs hot it leaves a wake: a dimmer ring re-forms at its
                        // place, which the next clear flies through again.
                        const wake = hoop.strength * wakeShare(this.heat.level);
                        hoop.fired = Infinity;
                        light = 0;
                        if (wake > 0.06 && !this.reducedMotion) {
                            hoop.birth = t;
                            hoop.strength = wake;
                            hoop.wake = true;
                            depth = hoopDepth(i);
                            radius = 0;
                        } else {
                            hoop.birth = -1e6;
                            hoop.strength = 0;
                            hoop.wake = false;
                        }
                    }
                }
            }
            const turn = hoop.seed * 2.39996 + t * 0.022 * (i % 2 ? 1 : -1) + this.twist * (1.5 + (i % 3));
            rows[i * 2].set(depth, radius, light, turn);
            rows[i * 2 + 1].set(hoop.rgb[0], hoop.rgb[1], hoop.rgb[2], hoop.seed);
            if (light > 0.02 && depth > -0.6) lit.push(i);
        }
        // The cloud is marched with the nearest lit ones.
        lit.sort((a, b) => rows[a * 2].x - rows[b * 2].x);
        const cast = u.tables.hoopLights;
        const count = Math.min(HOOP_LIGHTS, lit.length);
        // The hotter play runs, the more of the canyon the hoops light.
        const castGain = HOOP_CAST * (1 + 0.5 * this.heat.level);
        for (let k = 0; k < count; k++) {
            const a = rows[lit[k] * 2];
            const c = rows[lit[k] * 2 + 1];
            cast[k * 2].set(a.x, a.y, a.z * castGain, 0);
            cast[k * 2 + 1].set(c.x, c.y, c.z, 0);
        }
        u.hoopLightCount.value = count;

        const { fronts } = u.tables;
        let live = 0;
        for (let i = 0; i < FRONT_SLOTS; i++) {
            const slot = this.frontSlots[i];
            const age = t - slot.birth;
            if (age < 0 || slot.strength <= 0) continue;
            const depth = frontDepth(age, slot.speed);
            if (depth < FRONT_END) continue;
            // It gathers as it leaves the sun and thins as it reaches us.
            const gain = slot.strength * smooth(0, 0.08, age) * (0.45 + 0.55 * smooth(-2, 9, depth));
            fronts[live * 2].set(depth, slot.width, gain, 0);
            fronts[live * 2 + 1].set(slot.rgb[0], slot.rgb[1], slot.rgb[2], 0);
            live += 1;
        }
        u.frontCount.value = live;
        this.frontsLive = live;
        this.hoopsLit = lit.length;
    }

    // ── Frame ───────────────────────────────────────────────────────────────────

    update(sim, camera = this._camera) {
        const { u } = this;
        if (!u) return;
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const t = this.time;
        const calm = this.reducedMotion;

        this.boost *= Math.exp(-dt / BOOST_COOL);
        this.surge *= Math.exp(-dt / JUMP_AFTERGLOW);
        this.flash *= Math.exp(-dt / 0.22);
        this.kick *= Math.exp(-dt / 0.16);
        this.dip *= Math.exp(-dt / 0.35);
        this.drain(t);

        // ── How hot play runs ──
        const sample = this.pace.sample(t);
        const { heat } = this;
        heat.punch = sample.punch;
        heat.level = sample.level;
        heat.fever = sample.fever;
        heat.stage = sample.stage;
        const { level, fever } = heat;
        const afterburn = this.afterburn.valueAt(t);
        const gild = this.gild.valueAt(t);
        const crown = this.crown.valueAt(t);

        // ── How fast, and how the sky shows it ──
        const hushing = t < this.hushUntil;
        const hush = hushing ? this.hushDepth : 0;
        // The tunnel as shown opens in a tenth of a second and closes over its exit, but a jump
        // that runs on never snaps it shut or open: it moves from where it stands.
        const phaseTarget = jumpPhase(t - this.jumpStart, this.jumpLength);
        this.jumpShown = dt > 0
            ? Math.min(this.jumpShown + JUMP_RISE * dt, Math.max(this.jumpShown - JUMP_FALL * dt, phaseTarget))
            : phaseTarget;
        const phase = this.jumpShown;
        // The thrust of a clear is all there in casual play; past its knee it is the heat of play
        // that lets it run on, so a long chain keeps finding gears instead of standing at the top
        // from its third clear. Heat and a fever add their own: the fever is top gear.
        const thrust = softCeiling(this.boost, 0.9, 1.3 + level);
        const gearTarget = gearForCombo(this.combo) + thrust * BOOST_GEAR + level * GEAR_HEAT + fever * GEAR_FEVER;
        this.gear += (gearTarget - this.gear) * approach(gearTarget > this.gear ? 3 : 0.6, dt);
        if (dt === 0 && this.queue.length === 0 && this.boost === 0) this.gear = gearTarget;
        const gear = calm ? 1 + (this.gear - 1) * 0.12 : this.gear + phase * GEAR_JUMP;
        this.speed = CRUISE * gear * (calm ? 0.5 : 1);
        this.distance += this.speed * dt;
        const spool = Math.max(hushing ? 1 : 0, phase) * WARP_JUMP;
        // A chain bunches the sky up to WARP_CHAIN at most; a fever past it, and a cascade's
        // afterburner toward the jump while its waves keep coming; only a jump goes all the way.
        const chain = Math.min(
            WARP_CHAIN,
            warpForCombo(this.combo) + Math.min(0.22, this.boost * 0.16) + this.surge * 0.08,
        );
        const pushed = chain + fever * (WARP_FEVER - WARP_CHAIN) + Math.min(0.3, afterburn * 0.2);
        const warpTarget = Math.min(WARP_JUMP - 0.01, pushed);
        const warpShown = Math.max(warpTarget, spool) * (calm ? 0.3 : 1);
        let rate = 0.8;
        if (hushing) rate = 10;
        else if (warpShown > this.warp) rate = 3.2;
        else if (phase > 0) rate = 2.5;
        this.warp += (warpShown - this.warp) * approach(rate, dt);
        if (dt === 0 && this.queue.length === 0 && this.boost === 0) this.warp = warpShown;
        this.jumpClock = (this.jumpClock + dt) % 64;

        // The hush: from cold every light sinks; in a fever the drive only inhales.
        const breathTarget = hushing ? 1 - 0.9 * hush : 1 - this.dip;
        this.breath += (breathTarget - this.breath) * approach(hushing ? 40 : 14, dt);
        if (dt === 0) this.breath = breathTarget;
        this.applyPalette(approach(1.1, dt));

        // ── The fever's pulse: the drive's beat running down the walls, ever faster ──
        if (fever > 0.15 && phase < 0.5) {
            if (t >= this.pulseAt) {
                if (this.pulseAt > -Infinity) {
                    const p = this._palette.glow;
                    const gPeak = Math.max(p[0], p[1], p[2], 1e-4);
                    const k = 0.35 + 0.4 * fever;
                    this.front(t, {
                        speed: FRONT_SPEED.clear * (1.1 + 0.4 * fever),
                        rgb: [0, 1, 2].map((c) => AFTERBURN[c] * k + (p[c] / gPeak) * (1 - k)),
                        strength: 0.25 + 0.5 * fever,
                        width: 0.9 + 0.5 * fever,
                    });
                }
                this.pulseAt = t + PULSE_SLOW + (PULSE_FAST - PULSE_SLOW) * fever;
            }
        } else this.pulseAt = -Infinity;

        // The roll's spring (semi-implicit, in small steps so a long frame cannot blow it up).
        let left = Math.min(dt, 0.1);
        while (left > 1e-5) {
            const h = Math.min(left, 1 / 120);
            this.twistVelocity += (-TWIST_STIFFNESS * this.twist - TWIST_DAMPING * this.twistVelocity) * h;
            this.twist += this.twistVelocity * h;
            left -= h;
        }

        // ── Uniforms ──
        u.time.value = t;
        u.travel.value = this.distance % TRAVEL_WRAP;
        u.starTravel.value = this.distance % STAR_DEPTH;
        u.moteTravel.value = this.distance % MOTE_DEPTH;
        u.speed.value = this.speed;
        u.warp.value = this.warp;
        u.twist.value = this.twist * (calm ? 0.25 : 1);
        u.breath.value = this.breath;
        u.jump.value = phase;
        u.jumpClock.value = this.jumpClock;
        u.crown.value = crown;
        // The sun stands brighter the hotter play runs and blazes in a fever; a cascade's
        // afterburner swells its corona, a back-to-back and a crown light it gold.
        u.sunGain.value = 1 + this.warp * 1.4 + this.surge * 1.6 + this.flash * 1.2
            + level * 0.2 + fever * 0.55 + afterburn * 0.6 + gild * 0.35 + crown * 0.8;
        const p = this._palette;
        // A back-to-back and a perfect clear's crown turn the sun gold for a while.
        const sunGold = Math.min(0.6, gild * 0.5 + crown * 0.4);
        u.glow.value.set(p.glow[0], p.glow[1], p.glow[2]);
        u.deep.value.set(p.deep[0], p.deep[1], p.deep[2]);
        u.accent.value.set(p.accent[0], p.accent[1], p.accent[2]);
        u.dust.value.set(p.dust[0], p.dust[1], p.dust[2]);
        u.sunCol.value.set(
            p.sun[0] + (B2B_GOLD[0] - p.sun[0]) * sunGold,
            p.sun[1] + (B2B_GOLD[1] - p.sun[1]) * sunGold,
            p.sun[2] + (B2B_GOLD[2] - p.sun[2]) * sunGold,
        );
        u.skyCol.value.set(p.sky[0], p.sky[1], p.sky[2]);
        u.starTint.value.set(p.star[0], p.star[1], p.star[2]);
        this.writeCourse();

        // What follows the camera: its own frame for the canyon's target, and the sun on screen.
        if (camera) {
            const e = camera.matrixWorld.elements;
            u.camPos.value.copy(camera.position);
            u.camRight.value.set(e[0], e[1], e[2]);
            u.camUp.value.set(e[4], e[5], e[6]);
            u.camFwd.value.set(-e[8], -e[9], -e[10]);
            const tanV = Math.tan((camera.fov * DEG) / 2);
            const tanH = tanV * (camera.aspect || this.aspect);
            u.tanHalf.value.set(tanH, tanV);
            // The far end of −Z through this camera.
            const along = e[10];
            if (along > 1e-4) {
                this.heart.x = Math.max(-0.5, Math.min(1.5, 0.5 + (-e[2] / along / tanH) * 0.5));
                this.heart.y = Math.max(-0.5, Math.min(1.5, 0.5 - (-e[6] / along / tanV) * 0.5));
            }
            u.sunUv.value.set(this.heart.x, this.heart.y);
        }

        // ── Post ──
        const share = this.rushShare();
        const kick = this.kickShown();
        const post = this._post;
        post.flash = this.flash;
        post.flashTint = this.flashTint;
        post.kick = kick;
        // The sun's shafts: brighter at speed, with heat, an afterburner and a back-to-back; the
        // hush puts them out as deep as it holds its breath.
        const rays = Math.min(
            0.9,
            0.16 + this.warp * 0.45 + this.surge * 0.4 + this.flash * 0.3 + level * 0.06 + fever * 0.12
                + afterburn * 0.12 + gild * 0.18,
        );
        post.rays = rays + (0.03 - rays) * hush;
        post.blur = calm ? 0 : Math.min(1, share * 0.55 + phase * 0.9 + kick * 0.12 + hush * 0.5);
        post.bloomBoost = this.surge * 0.2 + this.flash * 0.3 + fever * 0.12;
        // The sun's spikes and streak: brighter at speed, in a fever and after a jump, flaring
        // gold on a back-to-back, gone in the tunnel.
        post.glint = (1 - 0.85 * hush) * (1 + this.warp * 0.9 + this.surge * 0.7 + fever * 0.5 + gild * 1.1)
            * (1 - phase * 0.95);
        const g = p.glow;
        const gPeak = Math.max(g[0], g[1], g[2], 1e-4);
        const golden = Math.min(0.75, gild * 0.6);
        for (let c = 0; c < 3; c++) {
            const tint = p.sun[c] * 0.45 + (g[c] / gPeak) * 0.55;
            post.glintTint[c] = tint + (B2B_GOLD[c] - tint) * golden;
        }
        post.jump = phase;
        post.warp = this.warp;
        // The iris closes as the sky piles up ahead and as play heats, so the starbow keeps its
        // colours and the deep sky stays deep.
        post.exposure = 1 / (1 + this.warp * 0.2 + this.surge * 0.5 + this.flash * 0.25 + phase * 0.35
            + level * 0.08 + fever * 0.32);
        u.iris.value = (1 / post.exposure) ** 0.8;

        // Paint the canyon for this frame.
        if (this.canyon && this.canyon.mesh.visible && sim.draw !== false) this.canyon.render(this.renderer);
    }

    /** The fBm texture (the post's grain reads nothing else of the world's). */
    get noiseTexture() {
        return this.u ? this.u.fbmTex : null;
    }

    /** What the post stack reads each frame (a reused object). */
    getPostState() {
        return this._post;
    }

    getState() {
        const { tier } = this;
        return {
            quality: this.quality,
            time: this.time,
            combo: this.combo,
            gear: this.gear,
            speed: this.speed,
            warp: this.warp,
            boost: this.boost,
            surge: this.surge,
            breath: this.breath,
            twist: this.twist,
            jump: this.jumpShown,
            jumps: this.jumps,
            heat: this.heat.level,
            fever: this.heat.fever,
            stage: this.heat.stage,
            distance: this.distance,
            level: this.level,
            palette: paletteName(palettePlace(this.levelPlace, this.time)),
            paletteMix: palettePhase(palettePlace(this.levelPlace, this.time)).mix,
            counts: { ...this.counts },
            hoops: this.hoopsLit || 0,
            fronts: this.frontsLive || 0,
            queued: this.queue.length,
            march: tier.march,
            stars: this.stars ? this.stars.count : 0,
            motes: this.motes ? this.motes.count : 0,
            floatTarget: this.u ? this.u.floatTarget : null,
            layoutLive: this.layoutLive,
            heart: { ...this.heart },
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.scene?.remove(this.root);
        this.disposables.forEach((part) => {
            part.dispose?.();
            part.geometry?.dispose?.();
            part.material?.dispose?.();
        });
        this.textures.forEach((t) => t.dispose());
        this.disposables = [];
        this.textures = [];
        this.parts = {};
        this.canyon = null;
        this.stars = null;
        this.motes = null;
        this.bolts = null;
        this.jets = null;
        this.u = null;
        this._camera = null;
    }
}

export { PARTS as STELLAR_VELOCITY_PARTS };
