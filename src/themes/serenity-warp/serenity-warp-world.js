/**
 * Serenity Warp — the world.
 *
 * Owns the shared uniforms, every scene part, the camera rig and the choreography. Shared by the
 * theme (serenity-warp-theme.js) and the playground effect
 * (src/playground/effects/serenity-warp.effect.js), so what is iterated there ships.
 *
 * A wormhole hangs far ahead, left of the board (above it on a phone), and space runs into it:
 * the gas winds round it in two arms and flows in, and through its throat another sky shows, in
 * the colours the drift is heading for. Pieces of glass in the shapes of the game drift on the
 * current and spiral into it. The board feeds it:
 *
 *   lock     the piece lifts off the board in glass, in its own shape, orientation and colour,
 *            white hot; it comes out at the card's edge with a flare and a ripple through
 *            space, cools to stained glass and joins the current. A hard drop hits harder.
 *   clear    the throat breathes out: one ring of light per line leaves its rim and crosses
 *            the sky, and every piece flares as a ring passes through it; the cleared rows
 *            send streams of light from the card into the throat; and one piece per line, the
 *            nearest the gate, falls in — drawn out into a streak of its colour, a flash on
 *            the rim as it goes.
 *   combo    each step of a chain winds the warp up: the current runs faster, the arms wind
 *            tighter and flow in quicker, the near stars draw out into trails, the dust
 *            streams, the glass glows from within, and a ring in the nebula's own colour
 *            leaves the rim.
 *   four     the warp holds its breath, then the throat opens round us: we fall through,
 *            rings of its light rushing past, and come out under the sky we saw in it.
 *   T-spin   the vortex twists round the gate and springs back; the glass tumbles.
 *   level    the sky moves one palette along its line of six, and a slow ring of the new
 *            colour leaves the rim.
 *   time     by itself, with no level change, the sky drifts along the same line: one palette
 *            every PALETTE_STEP seconds, there and back. The two simply add.
 *
 * Nothing is created at event time: events write numbers into preallocated slots and a small
 * queue of timed moments, so seek(t) plus a fixed-step replay reproduces any frame. What is
 * integrated (how far the gas has flowed, how far each piece has come) is integrated because
 * the speeds change; the clock is never multiplied by a rate that moves.
 */

import * as THREE from 'three/webgpu';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';
import {
    AMBIENT_FADE,
    BIRTH_COOL,
    BIRTH_DEPTH,
    BIRTH_FLIGHT,
    BIRTH_SIZE,
    CELL,
    DEG,
    DIVE_LOCK,
    FALL_AT,
    FALL_NATURAL,
    FALL_PULLED,
    GATE,
    HUSH_HOLD,
    JOURNEY,
    JUMP_AFTERGLOW,
    JUMP_TUNNEL,
    JUMP_TUNNEL_PERFECT,
    LAUNCH_BOOST,
    LAUNCH_EASE,
    PALETTE_KEYS,
    PALETTE_HOME,
    PIECE_SLOTS,
    RIPPLE_LIFE,
    RIPPLE_SLOTS,
    SHAPES,
    SHAPE_KEYS,
    SKY_PALETTES,
    THERE_AHEAD,
    WARPLIGHT,
    WAVE_SLOTS,
    EVENT_ROWS,
    approach,
    bakeFbm,
    bakeGasNoise,
    cellsFromMatrix,
    clamp01,
    createFbmTexture,
    createGasTexture,
    createWarpUniforms,
    currentFor,
    gateAnchors,
    jumpPhase,
    jumpRadius,
    mulberry32,
    packCells,
    paletteAt,
    paletteName,
    palettePhase,
    palettePlace,
    pathAt,
    pieceColor,
    placeToWorld,
    quatAxis,
    quatMul,
    smooth,
    supportsFloatTargets,
    warpForCombo,
    waveAngle,
    waveLight,
    worldToPlace,
} from './serenity-warp-tsl.js';
import { tierFor } from './serenity-warp-quality.js';
import { GAS_SEED, GAS_SIZE } from './serenity-warp-bake.js';
import { createSky } from './serenity-warp-sky.js';
import { createGlass, matchShape } from './serenity-warp-glass.js';
import { MOTE_DEPTH, STAR_DEPTH, createStreakField } from './serenity-warp-stars.js';
import { createFlares, createStreams } from './serenity-warp-fx.js';
import {
    BOARD_GRID, boardFor, boardPoint, cardUnion, fallbackLayout,
} from './serenity-warp-composition.js';
import { SERENITY_WARP_TETROMINOS } from './serenity-warp-tetrominos.js';

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
    const v = (2 * Math.atan(Math.tan((gateAnchors(a).hFov * DEG) / 2) / a)) / DEG;
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, v));
}

/** How fast the gas flows in (log-angle units a second) and the vortex turns (radians a second) at rest. */
export const INFLOW_REST = 0.045;
export const SPIN_REST = 0.018;
/** Warp units a second we drift toward the gate at rest (the near stars and the dust show it). */
export const DRIFT_REST = 0.7;
/** How much faster the current runs when the field is crowded (many pieces in flight). */
const CROWD_GAIN = 3.2;
/** The vortex's twist: how hard it pulls back and how fast it settles. */
const TWIST_STIFFNESS = 20;
const TWIST_DAMPING = 4.2;
/** Seconds the thrust of a clear takes to fade to 1/e. */
const BOOST_COOL = 1.6;
/** The most the warp winds up in a second (it lets go at its own pace). */
const WARP_RISE = 0.24;
/**
 * A jump already running is never restarted: another four lines inside the throat stretch the
 * tunnel (at least this share of a new one is still ahead, never past JUMP_LONGEST in all), and
 * the perfect clear that settles after its quad crowns it with CROWN_STRETCH seconds more.
 */
const JUMP_STRETCH = 0.6;
const JUMP_LONGEST = 6;
const CROWN_STRETCH = 0.5;
/** Seconds the memory of the run's falls through the throat takes to fade to 1/e. */
const JUMP_MEMORY = 25;
/** Seconds a clear's pull waits for a piece that has left the card before it tries again, and how often. */
const PULL_RETRY = 0.25;
const PULL_TRIES = 4;
/** The fever's heartbeat on the photon ring (beats a second at the fever's edge and at its height). */
const BEAT_SLOW = 1.1;
const BEAT_FAST = 1.9;

const PARTS = ['sky', 'glass', 'stars', 'motes', 'streams', 'flares'];
const KEYS = PALETTE_KEYS;

/** The theme's own piece colours, for the pieces that drift by themselves. */
const AMBIENT_COLORS = SHAPE_KEYS.map((k) => SERENITY_WARP_TETROMINOS.colors?.[k] || '#35e6ef');

function emptyPiece() {
    return {
        live: false,
        lock: false,
        shape: 2,
        turns: 0,
        codes: [0, 0, 0, 0],
        extent: 1,
        rgb: [1, 1, 1],
        seed: 0,
        birth: -1e6,
        flight: 0,
        from: [0, 0, 0],
        fromScale: 0,
        start: {
            theta0: 0.2, phi0: 0, depth0: 10, spin: 1,
        },
        s: 0,
        scale: CELL,
        hot: 0,
        q0: [0, 0, 0, 1],
        axis: [0, 1, 0],
        rate: 0.1,
        tumble: 0,
        fallStart: Infinity,
        fallLength: FALL_NATURAL,
        fallFrom: { theta: 0, phi: 0, depth: 10 },
        charge: 0,
        place: [0, 0, 0],
        seen: { theta: 0, phi: 0, depth: 10 },
    };
}

export class SerenityWarpWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {THREE.WebGPURenderer} [params.renderer]
     * @param {boolean} [params.capture=false]  deterministic captures: no wall-clock anywhere
     * @param {number} [params.seed]
     * @param {boolean} [params.floatTarget]  paint the environment into a half-float target
     *                                        (default: ask the renderer)
     */
    constructor({
        scene, quality = 'High', renderer = null, capture = false, seed = 0x5e7e, floatTarget,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.renderer = renderer;
        this.capture = capture;
        this.seed = seed;
        this.floatTarget = floatTarget ?? supportsFloatTargets(renderer);
        this.root = new THREE.Group();
        this.root.name = 'SerenityWarp';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.sky = null;
        this.glass = null;
        this.stars = null;
        this.motes = null;
        this.streams = null;
        this.flares = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        /** The gate on screen (fractions, y down). */
        this.heart = { x: 0.22, y: 0.42 };
        this.anchors = gateAnchors(this.aspect);
        this._camera = null;
        this._rest = new THREE.PerspectiveCamera(50, 16 / 9, REST_RIG.near, REST_RIG.far);
        this._f = new THREE.Vector3(0, 0, -1);
        this._r = new THREE.Vector3(1, 0, 0);
        this._up = new THREE.Vector3(0, 1, 0);
        this._ray = new THREE.Vector3();
        this._v = new THREE.Vector3();
        this._basis = new THREE.Matrix4();
        this._point = { x: 0.5, y: 0.5 };
        this._from = [0, 0, 0];
        this._place = { theta: 0, phi: 0, depth: 0 };
        this._q = [0, 0, 0, 1];
        this._qa = [0, 0, 0, 1];
        this._tanH = 1;
        this._tanV = 0.56;
        this._palette = {};
        this._there = {};
        this._ahead = {};
        KEYS.forEach((key) => {
            this._palette[key] = [...SKY_PALETTES[PALETTE_HOME][key]];
            this._there[key] = [...SKY_PALETTES[PALETTE_HOME + 1][key]];
        });
        this._post = {
            heart: this.heart,
            flash: 0,
            flashTint: [1, 1, 1],
            kick: 0,
            rays: 0.2,
            blur: 0,
            bloomBoost: 0,
            bloomEase: 0,
            exposure: 1,
            jump: 0,
            warp: 0,
        };
        this.pieces = Array.from({ length: PIECE_SLOTS }, emptyPiece);
        this.waveSlots = Array.from({ length: WAVE_SLOTS }, () => ({
            birth: -1e6, rgb: [1, 1, 1], strength: 0, slow: 1,
        }));
        this.rippleSlots = Array.from({ length: RIPPLE_SLOTS }, () => ({
            birth: -1e6, dir: [0, 0, -1], rgb: [1, 1, 1], strength: 0,
        }));
        this._write = {
            shape: 0, place: [0, 0, 0], scale: 0, turn: [0, 0, 0, 1], rgb: [1, 1, 1], charge: 0, hot: 0, fall: 0, seed: 0,
        };
        /**
         * How hot play runs (src/themes/shared/gameplay-surge.js), fed by every lock, clear, crown
         * and level and read once a frame on the world's clock. Warm, the gate takes notice: its
         * ring brightens and the gas pours in quicker. Hot, the arms wind past any chain's reach,
         * the stars draw out and the glass glows from within. In a fever the gate opens: the
         * throat dilates, its ring beats in the nebula's third colour, the vortex pours in at
         * full tilt and the glass burns on its way in. Four lines then take us through.
         */
        this.pace = new GameplaySurge();
        /** The surge as of the last frame (the camera, which runs before the frame, reads it). */
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        this._rim = [1, 1, 1];
        this.resetState(0);
    }

    /** How many pieces this tier holds, and how many drift there with no play. */
    get capacity() {
        return Math.min(PIECE_SLOTS, this.tier.pieces);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.combo = 0;
        this.warp = 0;
        this.boost = 0;
        this.surge = 0;
        this.level = 1;
        /** The level's place on the palettes' line (level − 1), eased when a level changes. */
        this.levelPlace = 0;
        this.flash = 0;
        this.flashTint = [1, 1, 1];
        this.kick = 0;
        this.breath = 1;
        this.twist = 0;
        this.twistVelocity = 0;
        this.tumbleBoost = 0;
        this.rimFlash = 0;
        this.rimTint = [1, 1, 1];
        this.hushUntil = -1;
        /** How deep the hush before four lines goes (1 from cold; a quad mid-fever only inhales). */
        this.hushDepth = 1;
        this.jumpStart = -100;
        this.jumpLength = JUMP_TUNNEL;
        /** A jump still closing when the next one opened: it finishes beside it. */
        this.prevJumpStart = -100;
        this.prevJumpLength = JUMP_TUNNEL;
        /** How many times the jump running now was deepened (a quad inside it, its crown). */
        this.jumpDepth = 0;
        this.jumpClock = 0;
        this.jumps = 0;
        /** The run's falls through the throat, remembered for a while: the gate stands wider after. */
        this.jumpMemory = 0;
        /** Difficult clears in a row (back-to-back), and the fever's heartbeat on the ring. */
        this.b2bRun = 0;
        this.beat = 0;
        this.pace?.reset();
        if (this.heat) {
            this.heat.punch = 0;
            this.heat.level = 0;
            this.heat.fever = 0;
            this.heat.stage = 0;
        }
        /** 1 while the sky seen through the throat has become our own (a jump), easing back to 0. */
        this.thereMix = 0;
        this.waveCursor = 0;
        this.rippleCursor = 0;
        this.spawnClock = 0;
        this.spawned = 0;
        this.current = 1;
        /** Timed moments still ahead: a jump, an arrival, a pull. */
        this.queue = [];
        this.counts = {
            locks: 0, clears: 0, quads: 0, crowns: 0, spins: 0, b2b: 0, falls: 0, spawned: 0,
        };
        // How far the gas has flowed and turned is a function of the clock until gameplay bends it.
        const motion = this.reducedMotion ? 0.5 : 1;
        this.inflow = time * INFLOW_REST * motion;
        this.spin = time * SPIN_REST * motion;
        this.drift = time * DRIFT_REST * motion;
        this.moteRun = time * (DRIFT_REST * 0.6 + 0.35) * motion;
        this.speed = DRIFT_REST * motion;
        this.waveSlots?.forEach((slot) => {
            slot.birth = -1e6;
            slot.strength = 0;
        });
        this.rippleSlots?.forEach((slot) => {
            slot.birth = -1e6;
            slot.strength = 0;
        });
        this.pieces?.forEach((piece) => {
            piece.live = false;
        });
        this.streams?.reset();
        this.flares?.reset();
        if (this.u) {
            this.u.hereShift.value.set(0, 0, 0);
            this.u.thereShift.value.set(0.37, 0.61, 0.23);
        }
        // The field is never empty: the drifting pieces are already on their way.
        if (this.u) this.prefill(time);
    }

    build() {
        const { tier } = this;
        const gas = createGasTexture(bakeGasNoise(GAS_SEED, GAS_SIZE), GAS_SIZE);
        const fbm = createFbmTexture(bakeFbm());
        const placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
        placeholder.needsUpdate = true;
        this.textures.push(gas, fbm, placeholder);
        const u = createWarpUniforms({
            gas, fbm, env: placeholder, floatTarget: this.floatTarget,
        });
        this.u = u;

        this.sky = createSky(u, tier);
        this.addPart('sky', this.sky);
        this.glass = createGlass(u, { count: this.capacity, bevel: tier.bevel });
        this.addPart('glass', this.glass);
        this.stars = createStreakField(u, { count: tier.stars, kind: 'stars', seed: this.seed + 11 });
        this.addPart('stars', this.stars);
        this.motes = createStreakField(u, { count: tier.motes, kind: 'motes', seed: this.seed + 23 });
        this.addPart('motes', this.motes);
        this.streams = createStreams(u);
        this.addPart('streams', this.streams);
        this.flares = createFlares(u);
        this.addPart('flares', this.flares);

        this.compose();
        this.resetState(this.time);
        this.applyPalette(1);
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
        if (this.u && bufferWidth > 0 && bufferHeight > 0) this.u.viewport.value.set(bufferWidth, bufferHeight);
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

    /** A new run: back to rest (the gas keeps flowing, the sky keeps its place on the clock). */
    resetSession() {
        const {
            time, inflow, spin, drift, moteRun, levelPlace,
        } = this;
        const here = this.u ? this.u.hereShift.value.clone() : null;
        const there = this.u ? this.u.thereShift.value.clone() : null;
        const kept = this.pieces.map((p) => ({ ...p }));
        this.resetState(time);
        // The sky eases back to the first level's place; it does not jump. The glass in flight
        // stays in flight.
        Object.assign(this, {
            inflow, spin, drift, moteRun, levelPlace,
        });
        if (here) this.u.hereShift.value.copy(here);
        if (there) this.u.thereShift.value.copy(there);
        for (let i = 0; i < this.pieces.length; i++) Object.assign(this.pieces[i], kept[i]);
    }

    /** Kept so the theme and the playground bind every world alike. */
    bindCamera(camera) {
        this._camera = camera;
    }

    updatePixelAngle() {
        if (!this.u) return;
        const height = Math.max(1, this.u.viewport.value.y);
        this.u.pixelAngle.value = (2 * Math.tan((fovForAspect(this.aspect) * DEG) / 2)) / height;
    }

    // ── The gate's place in the frame ───────────────────────────────────────────

    /**
     * Stand a camera so the gate (the far end of −Z) hangs at the anchor for this aspect: it
     * looks aside by exactly what puts the gate there, with no roll.
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

    /** Where the composition wants the gate for this aspect. */
    compose() {
        this.anchors = gateAnchors(this.aspect);
        this.heart.x = this.anchors.x;
        this.heart.y = this.anchors.y;
    }

    /**
     * The throat's angular radius right now (radians): its rest radius, opened wider by the heat
     * of play and by the run's recent falls through it (`gateWiden`, set each frame), and the jump.
     */
    gateRadiusAt(t) {
        return jumpRadius(t - this.jumpStart, this.anchors.radius * (this.gateWiden || 1), this.jumpLength);
    }

    /** How far into a jump we are (0..1): the one running, or the one still closing beside it. */
    jumpPhaseAt(t) {
        return Math.max(
            jumpPhase(t - this.jumpStart, this.jumpLength),
            jumpPhase(t - this.prevJumpStart, this.prevJumpLength),
        );
    }

    /** True while the jump running now has not arrived yet (its tunnel is open round us). */
    inTunnel(t) {
        const since = t - this.jumpStart;
        return since >= 0 && since < this.jumpLength;
    }

    /** A jump waiting in the queue (its quad's hush is still being held), or null. */
    queuedJump() {
        const q = this.queue;
        for (let i = 0; i < q.length; i++) if (q[i].kind === 'jump') return q[i];
        return null;
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const t = sim.time;
        // The staged gameplay is flushed between this and update(): it must carry this frame's time.
        this.time = t;
        const calm = this.reducedMotion ? 0 : 1;
        const phase = this.jumpPhaseAt(t);
        const share = Math.min(1, this.warp / 0.9);
        // The heat of play leans us toward the gate: a fever widens the lens as it pulls, and
        // every event's punch nudges it on a floor that holds under rapid play.
        const { punch, fever } = this.heat;
        const fov = Math.min(
            REST_RIG.maxFov + 8,
            fovForAspect(this.aspect) + (share * 4 + phase * 7 + this.kick * 1.2 + fever * 2.2 + punch * 0.5) * calm,
        );
        if (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        // A slow sway, as of something adrift, plus the pointer leaning the view: the glass
        // slides against the sky.
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        camera.position.set(
            (Math.sin(t * 0.043) * 0.08 + Math.sin(t * 0.019 + 1.3) * 0.05 + px * 0.12) * calm,
            (Math.sin(t * 0.037 + 0.7) * 0.06 + Math.sin(t * 0.015) * 0.04 - py * 0.08) * calm,
            this.kick * 0.04 * calm,
        );
        const yaw = (Math.sin(t * 0.029 + 2.1) * 0.008 - px * 0.02) * calm;
        const pitch = (Math.sin(t * 0.025) * 0.006 + py * 0.014) * calm;
        const roll = (Math.sin(t * 0.017) * 0.01 + this.twist * 0.08) * calm;
        this.aim(camera, fov, yaw, pitch, roll);
        // The shared breath (shared/camera-breath.js) on top of the sway above: off under reduced motion.
        applyCameraBreath(camera, t, { scale: calm });
        camera.updateMatrixWorld();
        this._camera = camera;
    }

    /** The world point `depth` along the view ray through a screen point (fractions, y down). */
    screenToWorld(sx, sy, depth, out = this._from) {
        const camera = this._camera || this.restCamera();
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        out[0] = camera.position.x + this._ray.x * depth;
        out[1] = camera.position.y + this._ray.y * depth;
        out[2] = camera.position.z + this._ray.z * depth;
        return out;
    }

    /** Where a world point is on screen (fractions, y down), or null behind the lens. */
    worldToScreen(p, out = this._point) {
        const camera = this._camera || this.restCamera();
        this._v.set(p[0], p[1], p[2]).project(camera);
        if (this._v.z > 1) return null;
        out.x = this._v.x * 0.5 + 0.5;
        out.y = 0.5 - this._v.y * 0.5;
        return out;
    }

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
     * Where the line from (px, py) to the gate leaves `card` (screen fractions). A point that is
     * not inside the card, or a gate that is, leaves from the point itself.
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

    // ── Timed moments ───────────────────────────────────────────────────────────

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
            if (kind === 'wave') this.wave(time, data);
            else if (kind === 'pull') this.pull(time, data);
            else if (kind === 'kick') this.kick = Math.max(this.kick, data);
            else if (kind === 'boost') this.boost = Math.min(2, this.boost + data * Math.exp(-(t - time) / BOOST_COOL));
            else if (kind === 'jump') this.enterThroat(time, data);
            else if (kind === 'arrive') this.arrive(time, data);
        }
    }

    /** Light the frame for a moment in a colour (the strongest of what is live wins the tint). */
    tintFlash(amount, rgb = WARPLIGHT) {
        if (amount >= this.flash) {
            this.flashTint[0] = rgb[0];
            this.flashTint[1] = rgb[1];
            this.flashTint[2] = rgb[2];
        }
        this.flash = Math.max(this.flash, amount);
    }

    /**
     * A ring of light leaves the throat's rim. It takes a spent slot, else the one with the least
     * light left: a burst of rings never cuts one off in the middle of the sky.
     */
    wave(time, { rgb, strength, slow = 1 }) {
        let pick = 0;
        let least = Infinity;
        for (let i = 0; i < WAVE_SLOTS; i++) {
            const s = this.waveSlots[i];
            const age = time - s.birth;
            // One not yet out holds all its light.
            const left = age < 0 ? s.strength : waveLight(age / s.slow) * s.strength;
            if (left < least) {
                least = left;
                pick = i;
            }
        }
        const slot = this.waveSlots[pick];
        this.waveCursor += 1;
        slot.birth = time;
        slot.rgb = rgb;
        slot.strength = strength;
        slot.slow = slow;
    }

    /** A ring in space round a direction (a newborn piece): a spent slot, else the faintest. */
    ripple(time, dir, rgb, strength) {
        let pick = 0;
        let least = Infinity;
        for (let i = 0; i < RIPPLE_SLOTS; i++) {
            const s = this.rippleSlots[i];
            const age = time - s.birth;
            let left = s.strength;
            if (age > RIPPLE_LIFE) left = 0;
            else if (age > 0) left *= Math.exp(-age / 0.45);
            if (left < least) {
                least = left;
                pick = i;
            }
        }
        const slot = this.rippleSlots[pick];
        this.rippleCursor += 1;
        slot.birth = time;
        slot.dir = [dir[0], dir[1], dir[2]];
        slot.rgb = rgb;
        slot.strength = strength;
    }

    // ── The glass ───────────────────────────────────────────────────────────────

    /**
     * A slot for a new piece: an empty one, else the one furthest into its fall, else the one
     * nearest the throat (a drifting piece before a lock's). The piece it takes goes in early, with
     * its flash on the rim: under rapid locks the glass is swallowed, it never blinks out.
     */
    freeSlot() {
        const cap = this.capacity;
        let best = -1;
        let score = -Infinity;
        for (let i = 0; i < cap; i++) {
            const p = this.pieces[i];
            if (!p.live) return i;
            const falling = p.fallStart < Infinity ? 10 + (this.time - p.fallStart) / p.fallLength : 0;
            const s = falling || p.s + (p.lock ? 0 : 0.25);
            if (s > score) {
                score = s;
                best = i;
            }
        }
        if (best >= 0) this.finishFall(this.pieces[best], this.time);
        return best;
    }

    /** Pieces in flight (not falling), and all live ones. */
    liveCount() {
        let live = 0;
        for (let i = 0; i < this.capacity; i++) if (this.pieces[i].live) live += 1;
        return live;
    }

    /**
     * Where an ambient piece starts for a turn φ round the gate: just past the frame's edge that
     * way (so it drifts in), at `depth`. Returns θ (radians).
     */
    edgeAngle(phi, depth, extent) {
        const camera = this.restCamera();
        const p = this._from;
        const v = this._v;
        for (let deg = 4; deg <= 86; deg += 1.5) {
            placeToWorld(deg * DEG, phi, depth, p);
            v.set(p[0], p[1], p[2]).project(camera);
            // Past the edge by the piece's own half-size (in NDC, roughly).
            const margin = ((extent * CELL) / depth / this._tanV) * 1.1;
            if (Math.abs(v.x) > 1 + margin / this.aspect || Math.abs(v.y) > 1 + margin || v.z > 1) return deg * DEG;
        }
        return 86 * DEG;
    }

    /** A drifting piece: a shape and colour of the game, adrift from the edge of the frame. */
    spawnAmbient(slot, time, progress = 0) {
        const piece = this.pieces[slot];
        const rand = mulberry32(this.seed + (this.spawned + 1) * 7919);
        this.spawned += 1;
        const key = SHAPE_KEYS[Math.floor(rand() * SHAPE_KEYS.length) % SHAPE_KEYS.length];
        const cells = cellsFromMatrix(SHAPES[key]);
        packCells(cells, piece.codes);
        piece.shape = SHAPE_KEYS.indexOf(key);
        piece.turns = 0;
        piece.extent = key === 'I' ? 2 : 1.5;
        piece.rgb = pieceColor(AMBIENT_COLORS[SHAPE_KEYS.indexOf(key)]);
        piece.seed = rand() * 7;
        piece.lock = false;
        // Not straight across the card: the right side's arc behind it is left to locks.
        const phi = rand() * Math.PI * 2;
        const depth = 5.5 + rand() * 9;
        piece.start = {
            theta0: this.edgeAngle(phi, depth, piece.extent), phi0: phi, depth0: depth, spin: rand() < 0.5 ? -1 : 1,
        };
        piece.s = progress;
        piece.scale = CELL * (0.85 + rand() * 0.45);
        piece.birth = time - progress * JOURNEY;
        piece.flight = 0;
        piece.hot = 0;
        piece.charge = 0;
        const ax = [rand() - 0.5, rand() - 0.5, rand() - 0.5];
        const n = Math.hypot(ax[0], ax[1], ax[2]) || 1;
        piece.axis = [ax[0] / n, ax[1] / n, ax[2] / n];
        quatAxis(piece.axis[0], piece.axis[1], piece.axis[2], rand() * Math.PI * 2, piece.q0);
        piece.rate = 0.08 + rand() * 0.16;
        piece.tumble = piece.rate * progress * JOURNEY;
        piece.fallStart = Infinity;
        piece.live = true;
        this.counts.spawned += 1;
    }

    /** The field as it stands at `time` with no play: the drifting pieces spread along their runs. */
    prefill(time) {
        const want = Math.min(this.capacity, this.tier.ambient);
        for (let i = 0; i < want; i++) {
            // Spread evenly along the run, turned by the clock, so a seek shows a settled field.
            const along = ((i + 0.5) / want + time / JOURNEY) % 1;
            this.spawnAmbient(i, time, 0.06 + along * 0.86);
        }
    }

    /**
     * A piece locked. `u` = its column as a fraction of the board width, `rows` = the visible
     * rows it covers, `color` = its colour, `cells` = its cells in the orientation it locked in;
     * `screen` (fractions) replaces the board point.
     */
    onLock({
        u = 0.5, rows = null, hardDrop = false, color = null, cells = null, player = 0, screen = null,
    } = {}) {
        if (!this.u || !this.glass) return;
        const t = this.time;
        const rgb = pieceColor(color);
        let px = 0.5;
        let py = 0.6;
        let boardCell = 0.035;
        let ex;
        let ey;
        if (screen && Number.isFinite(screen.x) && Number.isFinite(screen.y)) {
            px = screen.x;
            py = screen.y;
            ex = px;
            ey = py;
        } else {
            const board = boardFor(this.layout, player);
            if (board) {
                const row = Array.isArray(rows) && rows.length ? rows[Math.floor(rows.length / 2)] : 19;
                boardPoint(board, u, row, this._point);
                px = this._point.x;
                py = this._point.y;
                boardCell = (board.y1 - board.y0) / BOARD_GRID.rows;
            }
            // It comes out of its own card's edge, on the way to the gate.
            this.cardExit(px, py, this.cardFor(board), this._point);
            ex = this._point.x;
            ey = this._point.y;
        }
        // The shape it locked as, and how many quarter turns from its spawn orientation.
        const matched = (cells && cells.length >= 8 ? matchShape(Array.from(cells)) : null) || { shape: 2, turns: 0 };
        const own = cellsFromMatrix(SHAPES[SHAPE_KEYS[matched.shape]]);
        let extent = 0;
        for (let i = 0; i < 8; i += 2) extent = Math.max(extent, Math.abs(own[i]) + 0.5, Math.abs(own[i + 1]) + 0.5);
        // As large as the board's own cells, and a little more, whatever the layout.
        const fit = boardCell * 2 * this._tanV * BIRTH_DEPTH * BIRTH_SIZE;
        const scale = Math.max(CELL * 0.55, Math.min(CELL, fit)) * (hardDrop ? 1.08 : 1);
        // Clear of the card: on toward the gate by the piece's own half-size and a little more.
        const frameCell = (scale / BIRTH_DEPTH) / (2 * this._tanV);
        const dx = (this.heart.x - ex) * this.aspect;
        const dy = this.heart.y - ey;
        const away = Math.hypot(dx, dy) || 1;
        const clear = Math.min(away * 0.55, frameCell * (extent + 0.6) * 1.15);
        const bx = ex + ((dx / away) * clear) / this.aspect;
        const by = ey + (dy / away) * clear;

        const slot = this.freeSlot();
        if (slot < 0) return;
        const piece = this.pieces[slot];
        packCells(own, piece.codes);
        piece.shape = matched.shape;
        piece.turns = matched.turns;
        piece.extent = extent;
        piece.rgb = rgb;
        piece.seed = (this.counts.locks * 0.618) % 7;
        piece.lock = true;
        // Where it settles, in the gate's frame.
        const at = this.screenToWorld(bx, by, BIRTH_DEPTH, [0, 0, 0]);
        worldToPlace(at[0], at[1], at[2], this._place);
        piece.start = {
            theta0: this._place.theta,
            phi0: this._place.phi,
            depth0: this._place.depth,
            spin: this.counts.locks % 2 ? -1 : 1,
            // It dives toward the gate at once: a run of hard drops does not pile up by the card.
            dive: DIVE_LOCK,
        };
        // Where it lifts off: the piece itself on the board, at the board's own cell size.
        const liftDepth = BIRTH_DEPTH * 0.8;
        piece.from = this.screenToWorld(px, py, liftDepth, [0, 0, 0]);
        piece.fromScale = boardCell * 2 * this._tanV * liftDepth;
        piece.flight = this.reducedMotion ? 0.15 : BIRTH_FLIGHT * (hardDrop ? 0.65 : 1);
        piece.birth = t;
        piece.s = 0;
        piece.scale = scale;
        piece.hot = hardDrop ? 1.15 : 1;
        piece.charge = 0;
        // Facing us, in the orientation it locked in (its quarter turns about its own face).
        const cam = this._camera;
        const face = cam ? [cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w] : [0, 0, 0, 1];
        quatMul(face, quatAxis(0, 0, 1, matched.turns * (Math.PI / 2), this._qa), piece.q0);
        const rand = mulberry32(this.seed + this.counts.locks * 104729 + 3);
        const ax = [rand() - 0.5, rand() - 0.5, (rand() - 0.5) * 0.4];
        const n = Math.hypot(ax[0], ax[1], ax[2]) || 1;
        piece.axis = [ax[0] / n, ax[1] / n, ax[2] / n];
        piece.rate = 0.1 + rand() * 0.14;
        piece.tumble = 0;
        piece.fallStart = Infinity;
        piece.live = true;

        // Light where it comes out: a flare in its colour, and a ring through space round it.
        const lens = this._camera || this.restCamera();
        const out = this._ray.set(bx * 2 - 1, 1 - by * 2, 0.5).unproject(lens).sub(lens.position).normalize();
        this.flares?.fire(ex, ey, rgb, t + piece.flight * 0.55, hardDrop ? 0.13 : 0.085, hardDrop ? 2.4 : 1.4);
        this.ripple(t + piece.flight * 0.6, [out.x, out.y, out.z], rgb, hardDrop ? 1.2 : 0.7);
        if (hardDrop) this.schedule(t, 'kick', 0.5);
        this.tintFlash(hardDrop ? 0.06 : 0.025, rgb);
        this.boost = Math.min(2, this.boost + (hardDrop ? 0.08 : 0.04));
        this.pace.lock({ hardDrop }, t);
        this.counts.locks += 1;
    }

    /** Pull the piece furthest along (not already falling) into the throat. Returns it, or null. */
    pullNext(time, length = FALL_PULLED) {
        let best = null;
        for (let i = 0; i < this.capacity; i++) {
            const p = this.pieces[i];
            if (!p.live || p.fallStart < Infinity) continue;
            // A piece still leaving the card is not taken.
            if (p.lock && time - p.birth < p.flight + 0.4) continue;
            if (!best || p.s > best.s) best = p;
        }
        if (best) this.startFall(best, time, length);
        return best;
    }

    /**
     * A clear's piece falls in. When every piece is still leaving the card (rapid clears right after
     * locks) it waits a moment and tries again rather than dropping the fall.
     */
    pull(time, { length, tries = 0 }) {
        if (!this.pullNext(time, length) && tries < PULL_TRIES) {
            this.schedule(time + PULL_RETRY, 'pull', { length, tries: tries + 1 });
        }
    }

    startFall(piece, time, length) {
        if (piece.fallStart < Infinity) return;
        this.placeOf(piece, time, piece.fallFrom);
        piece.fallStart = time;
        piece.fallLength = length;
    }

    /** A piece is gone into the throat: the rim flares in its colour. */
    finishFall(piece, time, quiet = false) {
        piece.live = false;
        piece.fallStart = Infinity;
        this.counts.falls += 1;
        if (quiet) return;
        // The strongest flash on the rim keeps its colour (a back-to-back's, a crowned arrival's).
        if (this.rimFlash <= 0.9) this.rimTint = [piece.rgb[0], piece.rgb[1], piece.rgb[2]];
        this.rimFlash = Math.max(this.rimFlash, 0.9);
        this.flares?.fire(this.heart.x, this.heart.y, piece.rgb, time, 0.05, 0.9);
    }

    /**
     * Lines cleared. `lines` 1..4; `cascade` = which wave of a cascade this is (each wave past the
     * first builds on the last); `combo` = the chain it belongs to; `tspin`, `b2b`, `perfect`;
     * `rows` = the visible rows that went.
     */
    onClear({
        rows = null, lines = 1, cascade = 1, combo = 1, tspin = false, b2b = false, perfect = false, player = 0,
        screen = null,
    } = {}) {
        if (!this.u) return;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const depth = Math.max(0, Math.min(6, Math.round(Number(cascade) || 1) - 1));
        const quad = n >= 4 || perfect;
        const t = this.time;
        const { level, fever } = this.heat;
        // Four lines inside a jump still running (or one whose hush is still held) feed that jump:
        // never a second hush, never a restart.
        const feeding = quad && (this.inTunnel(t) || this.queuedJump() !== null);
        const hush = quad && !feeding;
        const at = hush ? t + HUSH_HOLD : t;
        // The light of the clear: the gate's own, with the nebula's glow in it. The hotter play runs
        // the more of the nebula's own colour its rings carry (in a fever, its third colour too):
        // saturation, not a paler haze.
        const g = this._palette.gate;
        const { glow, accent } = this._palette;
        const gp = Math.max(glow[0], glow[1], glow[2], 1e-4);
        const ap = Math.max(accent[0], accent[1], accent[2], 1e-4);
        const sat = Math.min(0.6, level * 0.45 + fever * 0.2);
        const rgb = [0, 1, 2].map((c) => {
            const pale = WARPLIGHT[c] * 0.35 + g[c] * 0.3 + (glow[c] / gp) * 0.35;
            const own = (glow[c] / gp) * (1 - fever * 0.5) + (accent[c] / ap) * fever * 0.5;
            return pale + (own - pale) * sat;
        });

        // ── A ring per line leaves the rim; the nearest pieces fall in ──
        // A cascade's waves build on the last: brighter rings, closer together, and more of the
        // glass drains into the throat, faster each wave.
        const build = 1 + 0.2 * depth;
        const strength = Math.min(1.7, (0.75 + 0.12 * n) * build);
        const rings = Math.min(5, (perfect ? 4 : n) + (depth > 0 ? 1 : 0));
        const spacing = 0.12 / (1 + 0.2 * depth);
        for (let i = 0; i < rings; i++) {
            this.schedule(at + i * spacing, 'wave', { rgb: [...rgb], strength, slow: 1 });
        }
        const pulls = quad ? 0 : n + Math.min(depth, 3);
        const fallFor = FALL_PULLED / (1 + 0.18 * depth);
        for (let i = 0; i < pulls; i++) this.schedule(at + i * 0.1, 'pull', { length: fallFor });
        this.schedule(at, 'boost', (0.35 + 0.18 * n) * (1 + 0.35 * depth));
        this.schedule(at + 0.04, 'kick', 0.22 + 0.1 * n + 0.06 * depth);
        this.tintFlash(0.08 + 0.04 * n + 0.02 * depth, rgb);
        // Each wave of a cascade counts as one more clear of its lines (the director resolves
        // them a frame apart), never as the whole depth again.
        this.pace.clear({
            lines: n, cascade: depth > 0 ? 2 : 1, combo, tspin, b2b, perfect,
        }, at);

        // ── The cleared rows send streams of light into the throat ──
        const board = boardFor(this.layout, player);
        const ownCard = this.cardFor(board);
        if (board && ownCard && this.streams && !screen) {
            const list = Array.isArray(rows) && rows.length ? rows : Array.from({ length: n }, (_, i) => 19 - i);
            const points = [];
            for (let i = 0; i < list.length && i < 4; i++) {
                boardPoint(board, 0.5, list[i], this._point);
                this.cardExit(this._point.x, this._point.y, ownCard, this._point);
                points.push({ x: this._point.x, y: this._point.y });
            }
            this.streams.fire(points, rgb, t, Math.min(1.5, (0.75 + 0.18 * n) * (1 + 0.15 * depth)));
        }

        if (quad) {
            const tunnel = perfect ? JUMP_TUNNEL_PERFECT : JUMP_TUNNEL;
            if (hush) {
                // The warp holds its breath; then the throat opens round us. From cold it holds it
                // fully; mid-fever it only inhales (and under Reduce flashing it never dims the frame).
                this.hushUntil = t + HUSH_HOLD;
                this.hushDepth = (1 - 0.8 * level) * flashScale();
            }
            this.schedule(at, 'jump', { length: this.reducedMotion ? 1.1 : tunnel, perfect });
            this.counts.quads += 1;
        }
        if (depth > 0) {
            // The vortex winds round the gate a little further with every wave: the twists stack.
            this.twistVelocity += 0.18 * Math.min(depth, 4);
            this.tumbleBoost = Math.max(this.tumbleBoost, 0.5 + 0.2 * depth);
        }
        if (tspin) {
            // The vortex twists round the gate and springs back; the glass tumbles.
            this.twistVelocity += 0.9;
            this.tumbleBoost = Math.max(this.tumbleBoost, 1.6);
            this.kick = Math.max(this.kick, 0.3);
        }
        if (b2b) this.backToBack(at);
        else if (depth === 0) this.b2bRun = 0;
        this.counts.clears += 1;
    }

    /** The nebula's third colour, as a light (peak-normalised, lifted a little toward white). */
    accentLight(lift = 0.15) {
        const a = this._palette.accent;
        const peak = Math.max(a[0], a[1], a[2], 1e-4);
        return [0, 1, 2].map((c) => (a[c] / peak) * (1 - lift) + lift);
    }

    /**
     * Back-to-back: the throat rings twice. Rings leave the rim together in the nebula's third
     * colour and part as they cross (each one slower than the last), and the photon ring flares in
     * that colour. Every difficult clear in a row rings once more and burns the ring hotter.
     */
    backToBack(at) {
        this.b2bRun += 1;
        const run = Math.min(4, this.b2bRun);
        const tint = this.accentLight();
        const rings = 1 + Math.min(run, 2);
        for (let i = 0; i < rings; i++) {
            this.schedule(at + 0.05, 'wave', {
                rgb: tint.slice(), strength: Math.min(1.6, 0.8 + 0.15 * run), slow: 1 + 0.24 * i,
            });
        }
        this.rimTint = tint;
        this.rimFlash = Math.min(1.4, Math.max(this.rimFlash, 0.75 + 0.15 * run));
        this.boost = Math.min(2, this.boost + 0.12 * run);
        this.tintFlash(0.05 + 0.02 * run, tint);
        this.counts.b2b += 1;
    }

    /** A T-spin that cleared nothing: a small twist of the vortex, the glass turning over, one faint ring. */
    onSpin() {
        if (!this.u) return;
        const t = this.time;
        this.twistVelocity += 0.45;
        this.tumbleBoost = Math.max(this.tumbleBoost, 0.9);
        this.kick = Math.max(this.kick, 0.15);
        this.wave(t, { rgb: this.accentLight(0.3), strength: 0.5, slow: 1 });
        this.pace.spin(t);
        this.counts.spins += 1;
    }

    /**
     * A perfect clear that settled after its clear (physics sends it ~360 ms after the last wave,
     * in a frame of its own): the crown on the jump that clear began, never a clear of its own.
     * Inside the throat the tunnel runs on a little longer and rushes faster, lit gold by the gate,
     * and we arrive crowned. With no jump running (a perfect clear of fewer than four lines) the
     * throat opens round us now, without a hush.
     */
    onPerfect() {
        if (!this.u) return;
        const t = this.time;
        this.pace.crown(t);
        const queued = this.queuedJump();
        if (queued) {
            queued.data.perfect = true;
            queued.data.crown = true;
            if (!this.reducedMotion) queued.data.length = Math.max(queued.data.length, JUMP_TUNNEL + CROWN_STRETCH);
        } else if (this.inTunnel(t)) {
            this.enterThroat(t, { length: 0, perfect: true, crown: true });
        } else {
            const length = this.reducedMotion ? 1.1 : JUMP_TUNNEL_PERFECT;
            this.schedule(t, 'jump', { length, perfect: true, crown: true });
        }
        this.counts.crowns += 1;
    }

    /**
     * The throat opens round us; the field goes in ahead of us. A jump already running is fed,
     * never restarted: four more lines (or the crown) stretch its tunnel, rush it faster, and we
     * still arrive once. A jump still closing when a new one opens finishes beside it.
     */
    enterThroat(time, { length, perfect = false, crown = false }) {
        if (this.inTunnel(time)) {
            const since = time - this.jumpStart;
            const want = crown ? this.jumpLength + CROWN_STRETCH : since + length * JUMP_STRETCH;
            this.jumpLength = Math.min(JUMP_LONGEST, Math.max(this.jumpLength, want));
            this.jumpDepth += 1;
            this.retimeArrival(this.jumpStart + this.jumpLength, perfect);
            this.tintFlash(0.3, crown ? this._palette.gate : WARPLIGHT);
            this.kick = Math.max(this.kick, 0.6);
            // More of the glass follows us in.
            const live = this.liveCount();
            for (let i = 0; i < Math.ceil(live / 4); i++) this.pullNext(time + i * 0.05, 0.6);
            return;
        }
        this.prevJumpStart = this.jumpStart;
        this.prevJumpLength = this.jumpLength;
        this.jumpStart = time;
        this.jumpLength = length;
        this.jumpDepth = crown ? 1 : 0;
        this.tintFlash(0.5);
        this.kick = Math.max(this.kick, 0.9);
        // The older half of the glass goes in first.
        const live = this.liveCount();
        for (let i = 0; i < Math.ceil(live / 2); i++) this.pullNext(time + i * 0.05, 0.6);
        this.schedule(time + length, 'arrive', { perfect });
    }

    /** The running jump arrives at `time` instead (once, however often it was fed). */
    retimeArrival(time, perfect) {
        const q = this.queue;
        let crowned = perfect;
        for (let i = q.length - 1; i >= 0; i--) {
            if (q[i].kind !== 'arrive') continue;
            crowned = crowned || q[i].data?.perfect === true;
            q.splice(i, 1);
        }
        this.schedule(time, 'arrive', { perfect: crowned });
    }

    /**
     * We come out under the sky we saw in the throat; a new one shows in it. The run remembers its
     * falls for a while (the gate stands a little wider after each), and a crowned arrival sends
     * two more rings after the first, in the gate's light and the nebula's third colour.
     */
    arrive(time, { perfect }) {
        this.jumps += 1;
        this.jumpMemory = Math.min(3, this.jumpMemory + 1);
        const rand = mulberry32(this.seed + this.jumps * 7919);
        if (this.u) {
            this.u.hereShift.value.copy(this.u.thereShift.value);
            this.u.thereShift.value.set(rand() * 7, rand() * 7, rand() * 7);
        }
        this.thereMix = 1;
        this.surge = Math.max(this.surge, perfect ? 1.3 : 1);
        // The light we come out into: the gate's, with the new sky's own glow in it (a paler flash
        // laid a grey veil over the whole frame while the iris was closed for the afterglow).
        const { gate, glow } = this._palette;
        const gp = Math.max(glow[0], glow[1], glow[2], 1e-4);
        this.tintFlash(0.5, [0, 1, 2].map((c) => gate[c] * 0.5 + (glow[c] / gp) * 0.5));
        this.kick = Math.max(this.kick, 0.6);
        this.wave(time, { rgb: [...WARPLIGHT], strength: 1.6 + 0.1 * this.jumpMemory, slow: 0.7 });
        if (perfect) {
            this.schedule(time + 0.16, 'wave', { rgb: [gate[0], gate[1], gate[2]], strength: 1.35, slow: 0.85 });
            this.schedule(time + 0.32, 'wave', { rgb: this.accentLight(), strength: 1.15, slow: 1 });
            this.rimTint = [gate[0], gate[1], gate[2]];
            this.rimFlash = Math.max(this.rimFlash, 1.2);
        }
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        if (n === 0 && this.combo >= 4 && this.u) {
            // A long chain lets go: one slow, wide ring in the nebula's glow, the warp easing out behind it.
            const p = this._palette.glow;
            const peak = Math.max(p[0], p[1], p[2], 1e-4);
            this.wave(this.time, {
                rgb: p.map((c) => (c / peak) * 0.75 + 0.25),
                strength: Math.min(1.1, 0.4 + 0.06 * this.combo),
                slow: 1.5,
            });
        }
        // Another step of the chain: a ring in the nebula's own glow leaves the rim.
        if (n >= 2 && n > this.combo) {
            this.boost = Math.min(2, this.boost + 0.18);
            this.tintFlash(0.05);
            const p = this._palette.glow;
            const peak = Math.max(p[0], p[1], p[2], 1e-4);
            this.wave(this.time, {
                rgb: p.map((c) => (c / peak) * 0.8 + 0.2), strength: Math.min(1.2, 0.45 + 0.08 * n), slow: 1,
            });
        }
        this.combo = n;
    }

    /**
     * A new level: the sky moves one palette along (it also drifts there by itself, a step every
     * PALETTE_STEP seconds), and a slow ring of the new colour leaves the rim.
     */
    levelUp(level, { silent = false } = {}) {
        this.level = Math.max(1, Math.round(Number(level) || 1));
        if (silent) this.applyPalette(1);
        else if (this.u) {
            const tint = paletteAt(palettePlace(this.level - 1, this.time), this._ahead).glow;
            const peak = Math.max(tint[0], tint[1], tint[2], 1e-4);
            this.wave(this.time, { rgb: tint.map((c) => (c / peak) * 0.85 + 0.15), strength: 1.4, slow: 0.55 });
            this.tintFlash(0.12, tint.map((c) => (c / peak) * 0.85 + 0.15));
            this.pace.levelUp(this.time);
        }
    }

    /**
     * The live palettes: the level's place on the line, eased toward level − 1 (k = 1 snaps),
     * plus the clock's own drift; the throat shows the one THERE_AHEAD further along (blended
     * toward ours while a jump makes it ours). The PLACE is eased, never the colours.
     */
    applyPalette(k) {
        const target = this.level - 1;
        this.levelPlace += (target - this.levelPlace) * Math.min(1, k);
        if (Math.abs(target - this.levelPlace) < 1e-3) this.levelPlace = target;
        const place = palettePlace(this.levelPlace, this.time);
        paletteAt(place, this._palette);
        paletteAt(place + THERE_AHEAD, this._there);
        if (this.thereMix > 0) {
            for (let i = 0; i < KEYS.length; i++) {
                const a = this._there[KEYS[i]];
                const b = this._palette[KEYS[i]];
                for (let c = 0; c < 3; c++) a[c] += (b[c] - a[c]) * this.thereMix;
            }
        }
    }

    // ── Where each piece is ─────────────────────────────────────────────────────

    /** A piece's place in the gate's frame right now (not counting a fall). */
    pathPlace(piece, out) {
        pathAt(piece.start, piece.s, out);
        return out;
    }

    /** A piece's place right now, its fall included. Fills `out` ({ theta, phi, depth }). */
    placeOf(piece, t, out) {
        if (piece.fallStart < Infinity && t >= piece.fallStart) {
            const f = clamp01((t - piece.fallStart) / piece.fallLength);
            const e = f * f * (3 - 2 * f);
            const from = piece.fallFrom;
            out.theta = from.theta * (1 - e) ** 1.4;
            out.phi = from.phi + piece.start.spin * e * 1.4;
            out.depth = from.depth + (GATE.distance * 0.985 - from.depth) * e * e;
            return out;
        }
        return this.pathPlace(piece, out);
    }

    /** Advance every piece by dt (the current's speed is integrated: it changes). */
    stepPieces(dt, t) {
        const cap = this.capacity;
        const run = (this.current * dt) / JOURNEY;
        for (let i = 0; i < cap; i++) {
            const p = this.pieces[i];
            if (!p.live) continue;
            const age = t - p.birth;
            if (p.fallStart < Infinity) {
                if (t - p.fallStart >= p.fallLength) this.finishFall(p, t);
                continue;
            }
            if (p.lock && age < p.flight) continue;
            // A lock's piece is launched: it clears the card's edge quickly, then drifts.
            const launch = p.lock ? 1 + LAUNCH_BOOST * Math.exp(-(age - p.flight) / LAUNCH_EASE) : 1;
            p.s += run * launch;
            const ramp = p.lock ? smooth(0.6, 3.2, age - p.flight) : 1;
            p.tumble += dt * (p.rate * ramp + this.tumbleBoost * 0.9 + (this.tumbleHeat || 0));
            if (p.s >= FALL_AT) this.startFall(p, t, FALL_NATURAL);
        }
        // Keep room for the next lock: when the field is full the piece furthest along goes in.
        // The quicker the hand, the earlier and the faster, so a run of locks never has to take a
        // piece in mid-flight.
        let live = 0;
        let falling = 0;
        for (let i = 0; i < cap; i++) {
            if (this.pieces[i].live) live += 1;
            if (this.pieces[i].live && this.pieces[i].fallStart < Infinity) falling += 1;
        }
        const pace = this.heat.level;
        if (live - falling > cap - 3 - Math.round(pace * 3)) this.pullNext(t, pace > 0.35 ? FALL_PULLED : FALL_NATURAL);
        // The drifting pieces come back, one at a time, while the field is thin.
        this.spawnClock -= dt;
        if (live < Math.min(cap, this.tier.ambient) && this.spawnClock <= 0) {
            for (let i = 0; i < cap; i++) {
                if (!this.pieces[i].live) {
                    this.spawnAmbient(i, t, 0);
                    break;
                }
            }
            this.spawnClock = 1.6;
        }
        this.liveNow = live;
        this.fallingNow = falling;
    }

    /** Write every piece for this frame. */
    writePieces(t) {
        const { glass } = this;
        if (!glass) return;
        const w = this._write;
        const place = this._place;
        const cap = this.capacity;
        // A chain charges the glass; a hot hand and a fever set it glowing from within on its way in.
        const charge = Math.min(1, this.warp / 0.9) * 0.7 + this.surge * 0.3
            + smooth(0.45, 0.85, this.heat.level) * 0.2 + this.heat.fever * 0.35;
        glass.begin();
        for (let i = 0; i < cap; i++) {
            const p = this.pieces[i];
            if (!p.live) continue;
            const age = t - p.birth;
            let { scale } = p;
            let fall = 0;
            if (p.lock && age < p.flight) {
                // Lifting off the board: from the piece's own place and size to its place outside.
                const k = clamp01(age / Math.max(p.flight, 1e-3));
                const e = 1 - (1 - k) ** 3;
                this.pathPlace(p, place);
                const to = placeToWorld(place.theta, place.phi, place.depth, this._from);
                w.place[0] = p.from[0] + (to[0] - p.from[0]) * e;
                w.place[1] = p.from[1] + (to[1] - p.from[1]) * e;
                w.place[2] = p.from[2] + (to[2] - p.from[2]) * e;
                scale = p.fromScale + (p.scale - p.fromScale) * e;
                worldToPlace(w.place[0], w.place[1], w.place[2], p.seen);
            } else {
                this.placeOf(p, t, place);
                placeToWorld(place.theta, place.phi, place.depth, w.place);
                p.seen.theta = place.theta;
                p.seen.phi = place.phi;
                p.seen.depth = place.depth;
                if (p.fallStart < Infinity && t >= p.fallStart) {
                    fall = clamp01((t - p.fallStart) / p.fallLength);
                    scale *= 1 - fall * fall * fall * 0.85;
                }
            }
            // Ambient pieces come in from the edge: nothing to fade, but a new one starts small.
            if (!p.lock) scale *= smooth(0, AMBIENT_FADE, age) * 0.4 + 0.6;
            // Each wave flares the glass it passes through.
            let flare = 0;
            for (let k = 0; k < WAVE_SLOTS; k++) {
                const wv = this.waveSlots[k];
                const wage = t - wv.birth;
                const light = waveLight(wage / wv.slow) * wv.strength;
                if (light <= 0.01) continue;
                const angle = waveAngle(wage / wv.slow, this.u.gateRadius.value);
                const x = (p.seen.theta - angle) / 0.06;
                flare += light * Math.exp(-x * x);
            }
            p.charge = Math.min(2.5, charge + flare * 1.4);
            quatAxis(p.axis[0], p.axis[1], p.axis[2], p.tumble, this._qa);
            quatMul(this._qa, p.q0, w.turn);
            w.shape = p.shape;
            w.scale = scale;
            w.rgb = p.rgb;
            w.charge = p.charge;
            w.hot = p.lock ? Math.min(1.2, p.hot * Math.exp(-Math.max(0, age - p.flight * 0.5) / BIRTH_COOL)) : 0;
            w.fall = fall;
            w.seed = p.seed;
            glass.write(w);
            p.place[0] = w.place[0];
            p.place[1] = w.place[1];
            p.place[2] = w.place[2];
        }
        glass.commit();
    }

    /** Write the waves and ripples as they stand at this moment. */
    writeEvents(t) {
        const { u } = this;
        const rows = u.tables.events;
        const alpha = u.gateRadius.value;
        let live = 0;
        for (let i = 0; i < WAVE_SLOTS; i++) {
            const slot = this.waveSlots[i];
            const age = (t - slot.birth) / slot.slow;
            const light = waveLight(age) * slot.strength;
            if (light <= 0.004) continue;
            const r = EVENT_ROWS.waves + live * 2;
            rows[r].set(waveAngle(age, alpha), 0.007 + age * 0.014, light * 1.1, 0);
            rows[r + 1].set(slot.rgb[0], slot.rgb[1], slot.rgb[2], 0);
            live += 1;
        }
        u.waveCount.value = live;
        this.wavesLive = live;
        let ripples = 0;
        for (let i = 0; i < RIPPLE_SLOTS; i++) {
            const slot = this.rippleSlots[i];
            const age = t - slot.birth;
            if (age < 0 || age > RIPPLE_LIFE || slot.strength <= 0) continue;
            const light = slot.strength * Math.exp(-age / 0.45) * smooth(0, 0.05, age) * (1 - smooth(RIPPLE_LIFE - 0.3, RIPPLE_LIFE, age));
            const r = EVENT_ROWS.ripples + ripples * 2;
            rows[r].set(slot.dir[0], slot.dir[1], slot.dir[2], 0.015 + age * 0.17);
            rows[r + 1].set(slot.rgb[0], slot.rgb[1], slot.rgb[2], light * 0.9);
            ripples += 1;
        }
        u.rippleCount.value = ripples;
        this.ripplesLive = ripples;
    }

    // ── Frame ───────────────────────────────────────────────────────────────────

    update(sim, camera = this._camera) {
        const { u } = this;
        if (!u) return;
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const t = this.time;
        const calm = this.reducedMotion;
        // Reduce flashing (ADR-0021): what lights the whole frame at once keeps only this much.
        const fs = flashScale();

        this.boost *= Math.exp(-dt / BOOST_COOL);
        this.surge *= Math.exp(-dt / JUMP_AFTERGLOW);
        this.jumpMemory *= Math.exp(-dt / JUMP_MEMORY);
        this.flash *= Math.exp(-dt / 0.22);
        this.kick *= Math.exp(-dt / 0.16);
        this.rimFlash *= Math.exp(-dt / 0.35);
        this.tumbleBoost *= Math.exp(-dt / 0.9);
        this.drain(t);

        // ── How hot play runs ──
        const heat = this.pace.sample(t);
        this.heat.punch = heat.punch;
        this.heat.level = heat.level;
        this.heat.fever = heat.fever;
        this.heat.stage = heat.stage;
        const { punch, level, fever } = heat;
        // Casual play wears the world as it is; warm, the gate takes notice; hot, it is alive with
        // the player; and what a long hot run adds past any chain's reach (less of it reduced).
        const warm = smooth(0.18, 0.55, level);
        const hot = smooth(0.45, 0.85, level);
        const over = (hot * 0.5 + fever * 0.5) * (calm ? 0.3 : 1);

        // ── How hard the warp pulls ──
        // The hush before four lines, as deep as play is cold (0 = none).
        const hush = t < this.hushUntil ? this.hushDepth : 0;
        const phase = this.jumpPhaseAt(t);
        const warpTarget = Math.min(
            0.98,
            warpForCombo(this.combo) + Math.min(0.2, this.boost * 0.12) + this.surge * 0.06 + warm * 0.08 + hot * 0.1,
        ) * (calm ? 0.3 : 1);
        // It winds up over the chain, not in its first three clears: each step's thrust (`boost`)
        // is felt at once, the wind itself climbs at most WARP_RISE a second.
        const wind = (warpTarget - this.warp) * approach(warpTarget > this.warp ? 2.6 : 0.7, dt);
        this.warp += Math.min(wind, WARP_RISE * dt);
        if (dt === 0 && this.queue.length === 0 && this.boost === 0) this.warp = warpTarget;
        // The field crowded with glass runs in faster, so the gate keeps up with the board.
        const cap = this.capacity;
        const crowd = clamp01(((this.liveNow || 0) - this.tier.ambient) / Math.max(1, cap - this.tier.ambient));
        const flow = currentFor(this.warp) * (1 + crowd * CROWD_GAIN) * (1 + over * 0.6)
            + this.boost * 1.5 + phase * 10;
        this.current = (calm ? 0.5 : 1) * flow * (1 - 0.85 * hush);
        const motion = calm ? 0.5 : 1;
        // A long hot run pours the gas in and turns the vortex past what any chain alone does.
        this.inflow += dt * INFLOW_REST * motion * (1 + this.warp * 7 + this.boost * 2 + phase * 14 + over * 6);
        this.spin += dt * SPIN_REST * motion * (1 + this.warp * 4 + phase * 6 + over * 3);
        this.speed = DRIFT_REST * motion * (1 + this.warp * 12 + this.boost * 3 + phase * 40 + over * 6)
            * (1 - 0.8 * hush);
        this.drift += this.speed * dt;
        this.moteRun += dt * (this.speed * 0.6 + 0.35 * this.current);
        // The tunnel rushes faster each time a jump is fed (four lines inside it, its crown).
        this.jumpClock = (this.jumpClock + dt * (1 + 0.45 * Math.min(3, this.jumpDepth) + 0.3 * fever)) % 64;
        if (phase === 0 && t - this.jumpStart > this.jumpLength) this.thereMix *= Math.exp(-dt / 2.5);
        else if (phase > 0) this.thereMix = Math.max(this.thereMix, smooth(0.35, 0.95, (t - this.jumpStart) / this.jumpLength));
        // The glass turns over in a fever, as if the current had grown rough.
        this.tumbleHeat = fever * 0.3 * motion;
        // The gate opens: the throat dilates as play heats, and stands a little wider for a while
        // after each fall through it.
        this.gateWiden = 1 + hot * 0.08 + fever * 0.2 + Math.min(3, this.jumpMemory) * 0.04;
        // The fever's heartbeat on the photon ring (integrated: it quickens with the fever).
        this.beat = (this.beat + dt * (BEAT_SLOW + (BEAT_FAST - BEAT_SLOW) * fever)) % 1;

        const breathTarget = 1 - 0.88 * hush;
        this.breath += (breathTarget - this.breath) * approach(hush > 0 ? 40 : 12, dt);
        if (dt === 0) this.breath = breathTarget;
        this.applyPalette(approach(1.1, dt));

        // The vortex's twist (semi-implicit, in small steps so a long frame cannot blow it up).
        let left = Math.min(dt, 0.1);
        while (left > 1e-5) {
            const h = Math.min(left, 1 / 120);
            this.twistVelocity += (-TWIST_STIFFNESS * this.twist - TWIST_DAMPING * this.twistVelocity) * h;
            this.twist += this.twistVelocity * h;
            left -= h;
        }

        this.stepPieces(dt, t);

        // ── Uniforms ──
        u.time.value = t;
        u.warp.value = this.warp;
        u.inflow.value = this.inflow % 4096;
        u.spin.value = this.spin % (Math.PI * 2 * 64);
        u.twist.value = this.twist * (calm ? 0.25 : 1);
        u.starTravel.value = this.drift % STAR_DEPTH;
        u.moteTravel.value = this.moteRun % MOTE_DEPTH;
        u.speed.value = this.speed;
        // At rest a star is a point; a chain draws it out, and a long hot run draws it out further.
        const drawn = Math.min(1, this.warp / 0.9);
        if (this.stars) this.stars.uniforms.shutter.value = 0.015 + drawn * 0.4 + phase * 0.3 + over * 0.12;
        if (this.motes) this.motes.uniforms.shutter.value = 0.04 + drawn * 0.3 + phase * 0.2 + over * 0.1;
        u.breath.value = this.breath;
        u.jump.value = phase;
        u.jumpClock.value = this.jumpClock;
        u.gateRadius.value = this.gateRadiusAt(t);
        // In a fever the photon ring beats in the nebula's third colour, a heartbeat that quickens
        // with it (held steady under Reduce flashing). The strongest flash on the rim leads its colour.
        const pulse = 0.5 - 0.5 * Math.cos(this.beat * Math.PI * 2);
        const beat = fever * (0.3 + 0.45 * pulse * pulse * fs);
        const rim = this.rimFlash;
        const weight = rim + beat;
        const { accent } = this._palette;
        const ap = Math.max(accent[0], accent[1], accent[2], 1e-4);
        for (let c = 0; c < 3; c++) {
            const own = (accent[c] / ap) * 0.8 + 0.2;
            this._rim[c] = weight > 1e-4 ? (this.rimTint[c] * rim + own * beat) / weight : this.rimTint[c];
        }
        // The surge after a jump lasts seconds: a gate held twice as bright that long greyed the sky.
        // The heat of play brightens it a little at a time (the iris below closes to keep the
        // colours), and every event's punch pulses it on a floor that rapid play holds up.
        u.gateGain.value = 1 + this.warp * 0.8 + this.surge * 0.6 + (this.flash * 1.5 + punch * 0.2) * fs
            + rim * 0.4 + beat * 0.2 + warm * 0.08 + hot * 0.1 + fever * 0.12;
        u.rimFlash.value = Math.min(1, Math.max(rim, beat));
        u.rimTint.value.set(this._rim[0], this._rim[1], this._rim[2]);
        const p = this._palette;
        const q = this._there;
        u.glow.value.set(p.glow[0], p.glow[1], p.glow[2]);
        u.deep.value.set(p.deep[0], p.deep[1], p.deep[2]);
        u.accent.value.set(p.accent[0], p.accent[1], p.accent[2]);
        u.dust.value.set(p.dust[0], p.dust[1], p.dust[2]);
        u.gateCol.value.set(p.gate[0], p.gate[1], p.gate[2]);
        u.skyCol.value.set(p.sky[0], p.sky[1], p.sky[2]);
        u.starTint.value.set(p.star[0], p.star[1], p.star[2]);
        u.thereGlow.value.set(q.glow[0], q.glow[1], q.glow[2]);
        u.thereDeep.value.set(q.deep[0], q.deep[1], q.deep[2]);
        u.thereAccent.value.set(q.accent[0], q.accent[1], q.accent[2]);
        u.thereGate.value.set(q.gate[0], q.gate[1], q.gate[2]);
        this.writeEvents(t);

        // What follows the camera: its own frame for the sky, and the gate's direction and place on screen.
        if (camera) {
            const e = camera.matrixWorld.elements;
            u.camPos.value.copy(camera.position);
            u.camRight.value.set(e[0], e[1], e[2]);
            u.camUp.value.set(e[4], e[5], e[6]);
            u.camFwd.value.set(-e[8], -e[9], -e[10]);
            const tanV = Math.tan((camera.fov * DEG) / 2);
            const tanH = tanV * (camera.aspect || this.aspect);
            u.tanHalf.value.set(tanH, tanV);
            const g = this._v.set(-camera.position.x, -camera.position.y, -GATE.distance - camera.position.z).normalize();
            u.gateDir.value.copy(g);
            // Axes across the gate: x as near the world's x as it can be, y = x × gate.
            const gx = u.gateX.value.set(1 - g.x * g.x, -g.x * g.y, -g.x * g.z).normalize();
            u.gateY.value.copy(gx).cross(g).normalize();
            const sx = g.dot(this._r.set(e[0], e[1], e[2]));
            const sy = g.dot(this._up.set(e[4], e[5], e[6]));
            const sz = g.dot(this._f.set(-e[8], -e[9], -e[10]));
            if (sz > 1e-4) {
                this.heart.x = Math.max(-0.5, Math.min(1.5, 0.5 + (sx / sz / tanH) * 0.5));
                this.heart.y = Math.max(-0.5, Math.min(1.5, 0.5 - (sy / sz / tanV) * 0.5));
            }
            u.gateUv.value.set(this.heart.x, this.heart.y);
        }
        this.writePieces(t);

        // ── Post ──
        const share = clamp01(this.warp / 0.9);
        const post = this._post;
        post.flash = this.flash;
        post.flashTint = this.flashTint;
        post.kick = this.kick;
        // The gate's rays reach further the hotter play runs; the hush draws them in (as deep as it is).
        const rays = Math.min(0.9, 0.22 + share * 0.14 + this.surge * 0.2 + this.flash * 0.3 * fs + this.rimFlash * 0.1
            + hot * 0.05 + fever * 0.08);
        post.rays = rays + (0.04 - rays) * hush;
        // In a jump the tunnel's own streaks carry the speed: the zoom blur only softens them. A
        // fever pulls the frame toward the gate a little.
        post.blur = calm ? 0 : Math.min(1, share * 0.4 + phase * 0.45 + this.kick * 0.1 + hush * 0.35 + fever * 0.12);
        post.bloomBoost = this.surge * 0.1 + this.flash * 0.3 * fs;
        // The bloom gives way as the fever burns: its wide glow would lay a veil over the gate.
        post.bloomEase = Math.min(0.6, share * 0.38 + this.surge * 0.4 + fever * 0.15);
        post.jump = phase;
        post.warp = this.warp;
        // The iris closes as the gate burns brighter with play, so the colours stay saturated and
        // the deep sky stays deep.
        post.exposure = 1 / (1 + this.warp * 0.15 + this.surge * 0.4 + this.flash * 0.25 * fs + phase * 0.3
            + warm * 0.04 + fever * 0.14);
        u.iris.value = (1 / post.exposure) ** 0.8;

        // Paint the sky in every direction for the glass.
        if (this.sky && sim.draw !== false && this.glass?.mesh.visible) this.sky.render(this.renderer);
    }

    /** What the post stack reads each frame (a reused object). */
    getPostState() {
        return this._post;
    }

    getState() {
        const place = palettePlace(this.levelPlace, this.time);
        let falling = 0;
        let live = 0;
        let locks = 0;
        for (let i = 0; i < this.capacity; i++) {
            const p = this.pieces[i];
            if (!p.live) continue;
            live += 1;
            if (p.fallStart < Infinity) falling += 1;
            if (p.lock) locks += 1;
        }
        return {
            quality: this.quality,
            time: this.time,
            combo: this.combo,
            warp: this.warp,
            current: this.current,
            boost: this.boost,
            surge: this.surge,
            breath: this.breath,
            twist: this.twist,
            jump: this.jumpPhaseAt(this.time),
            jumpLength: this.jumpLength,
            jumpDepth: this.jumpDepth,
            jumps: this.jumps,
            jumpMemory: this.jumpMemory,
            hushDepth: this.hushDepth,
            heat: { ...this.heat },
            b2bRun: this.b2bRun,
            gateRadius: this.u ? this.u.gateRadius.value : this.anchors.radius,
            level: this.level,
            palette: paletteName(place),
            paletteMix: palettePhase(place).mix,
            there: paletteName(place + THERE_AHEAD),
            counts: { ...this.counts },
            pieces: live,
            falling,
            lockPieces: locks,
            capacity: this.capacity,
            waves: this.wavesLive || 0,
            ripples: this.ripplesLive || 0,
            queued: this.queue.length,
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
        this.sky = null;
        this.glass = null;
        this.stars = null;
        this.motes = null;
        this.streams = null;
        this.flares = null;
        this.u = null;
        this._camera = null;
    }
}

export { PARTS as SERENITY_WARP_PARTS };
