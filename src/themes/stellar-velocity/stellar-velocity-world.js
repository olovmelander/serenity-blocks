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
 *            in a stretch of the canyon we have not seen, the sun standing bright in it.
 *   T-spin   the canyon rolls: cloud, stars and hoops wind round the course and spring back.
 *   level    the nebula moves one palette along its line of six, and a slow front of the new
 *            colour comes down the canyon.
 *   time     by itself, with no level change, the nebula drifts along the same line: one
 *            palette every PALETTE_STEP seconds, there and back. The two simply add.
 *
 * Nothing is created at event time: events write numbers into preallocated slots and a small
 * queue of timed moments, so seek(t) plus a fixed-step replay reproduces any frame. The one
 * thing that is integrated is how far we have come (the speed changes, so the clock cannot be
 * multiplied by it).
 */

import * as THREE from 'three/webgpu';
import {
    BOLT_FLIGHT,
    CANYON,
    CRUISE,
    DEG,
    DRIVEFIRE,
    FRONT_END,
    FRONT_SLOTS,
    FRONT_SPEED,
    GEAR_CHAIN,
    GEAR_JUMP,
    HOOP_LIFE,
    HOOP_LIGHTS,
    HOOP_SLOTS,
    HOOP_STAGGER,
    HUSH_HOLD,
    JUMP_AFTERGLOW,
    JUMP_TUNNEL,
    JUMP_TUNNEL_PERFECT,
    NEBULA_PALETTES,
    PALETTE_HOME,
    PALETTE_KEYS,
    WARP_JUMP,
    approach,
    bakeCanyonNoise,
    bakeFbm,
    clamp01,
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
const HOOP_CAST = 2.6;

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
            exposure: 1,
            jump: 0,
            warp: 0,
        };
        this.hoopSlots = Array.from({ length: HOOP_SLOTS }, () => ({
            birth: -1e6, fired: Infinity, reserved: -1e6, rgb: [1, 1, 1], seed: 0, strength: 0,
        }));
        this.frontSlots = Array.from({ length: FRONT_SLOTS }, () => ({
            birth: -1e6, speed: 1, rgb: [1, 1, 1], strength: 0, width: 1,
        }));
        this._lit = [];
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
        this.jumpStart = -100;
        this.jumpLength = JUMP_TUNNEL;
        this.jumpClock = 0;
        this.jumps = 0;
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
        });
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
        const phase = jumpPhase(t - this.jumpStart, this.jumpLength);
        // The lens opens as we gather speed, and wide in a jump.
        const share = Math.min(1.15, (this.gear - 1) / (GEAR_CHAIN - 1));
        const fov = Math.min(
            REST_RIG.maxFov + 8,
            fovForAspect(this.aspect) + (share * 5 + phase * 8 + this.kick * 1.4) * calm,
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
            this.kick * 0.03 * calm,
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
            } else if (kind === 'jump') this.enterTunnel(time, data);
            else if (kind === 'arrive') this.arrive(time, data);
        }
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
            const held = slot.fired < Infinity ? 0 : hoopHeld(time - slot.birth) * slot.strength;
            // Among the empty ones, the nearest first: the course fills from the camera outward.
            const score = held > 0.004 ? held + 1 : i * 1e-3;
            if (score < least) {
                least = score;
                best = i;
            }
        }
        if (best >= 0) return best;
        // Every slot is spoken for: take the one whose bolt lands last.
        let last = 0;
        for (let i = 1; i < HOOP_SLOTS; i++) {
            if (this.hoopSlots[i].reserved > this.hoopSlots[last].reserved) last = i;
        }
        return last;
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
        this.tintFlash(strength > 0.9 ? 0.07 : 0.03, rgb);
    }

    /** A front of light leaves the sun's end of the canyon. */
    front(time, {
        speed, rgb, strength, width,
    }) {
        const slot = this.frontSlots[this.frontCursor % FRONT_SLOTS];
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

    /** The tunnel opens. */
    enterTunnel(time, { length, perfect }) {
        this.jumpStart = time;
        this.jumpLength = length;
        this.tintFlash(0.55);
        this.kick = Math.max(this.kick, 1);
        this.schedule(time + length, 'arrive', { perfect });
    }

    /** We drop out, somewhere else: the cloud's whole field is shifted while nothing can be seen of it. */
    arrive(time, { perfect }) {
        this.jumps += 1;
        const rand = mulberry32(this.seed + this.jumps * 7919);
        if (this.u) this.u.shift.value.set((rand() - 0.5) * 9, (rand() - 0.5) * 9, rand() * TRAVEL_WRAP);
        this.surge = Math.max(this.surge, perfect ? 1.3 : 1);
        this.tintFlash(0.8);
        this.kick = Math.max(this.kick, 0.7);
        this.front(time, {
            speed: FRONT_SPEED.clear * 0.6, rgb: [...DRIVEFIRE], strength: 1.5, width: 2.6,
        });
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
        this.counts.bolts += 1;
        this.counts.locks += 1;
    }

    /**
     * Lines cleared. `lines` 1..4; `tspin`, `perfect`; `rows` = the visible rows that went.
     */
    onClear({
        rows = null, lines = 1, tspin = false, perfect = false, player = 0, screen = null,
    } = {}) {
        const { u } = this;
        if (!u || !this.bolts) return;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        const t = this.time;
        const birth = quad ? t + HUSH_HOLD : t;

        // ── We go through every hoop we have laid, the nearest first ──
        const mixRgb = [0, 0, 0];
        let weight = 0;
        let fired = 0;
        for (let i = 0; i < HOOP_SLOTS; i++) {
            const hoop = this.hoopSlots[i];
            if (hoop.fired < Infinity) continue;
            const held = hoopHeld(t - hoop.birth) * hoop.strength;
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
        const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
        rgb = rgb.map((c) => (c / peak) * 0.96 + 0.04);

        // ── A front of light per line comes down the canyon after them ──
        const fronts = perfect ? 4 : n;
        const after = birth + fired * HOOP_STAGGER * 0.5;
        for (let i = 0; i < fronts; i++) {
            this.schedule(after + i * 0.13, 'front', {
                speed: FRONT_SPEED.clear, rgb: [...rgb], strength: 0.42 + 0.06 * n, width: 0.85,
            });
        }
        this.schedule(birth, 'boost', 0.42 + 0.2 * n + Math.min(0.55, weight * 0.07));
        this.schedule(birth + 0.05, 'kick', 0.25 + 0.1 * n);
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

        if (quad) {
            // The drive holds its breath; then it jumps.
            this.hushUntil = t + HUSH_HOLD;
            const tunnel = perfect ? JUMP_TUNNEL_PERFECT : JUMP_TUNNEL;
            this.schedule(birth, 'jump', { length: this.reducedMotion ? 1.1 : tunnel, perfect });
            this.counts.quads += 1;
        }
        if (tspin) {
            // The canyon rolls round the course and springs back.
            this.twistVelocity += 0.5;
            this.kick = Math.max(this.kick, 0.35);
        }
        this.counts.clears += 1;
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
                light = hoopHeld(age) * hoop.strength;
                // It springs open.
                radius *= 1 - Math.exp(-age * 7) * Math.cos(age * 10);
                if (hoop.fired <= t) {
                    const since = t - hoop.fired;
                    const run = since / hoopRun(depth);
                    depth = hoopFiredDepth(depth, since);
                    // It flares as it comes, and is gone once it is behind us.
                    light = Math.max(light, 0.45 * hoop.strength) * (1 + 0.9 * Math.min(1, run) ** 2);
                    if (depth < -1.2) {
                        hoop.birth = -1e6;
                        hoop.fired = Infinity;
                        hoop.strength = 0;
                        light = 0;
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
        for (let k = 0; k < count; k++) {
            const a = rows[lit[k] * 2];
            const c = rows[lit[k] * 2 + 1];
            cast[k * 2].set(a.x, a.y, a.z * HOOP_CAST, 0);
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

        // ── How fast, and how the sky shows it ──
        const hush = t < this.hushUntil ? 1 : 0;
        const phase = jumpPhase(t - this.jumpStart, this.jumpLength);
        const gearTarget = gearForCombo(this.combo) + this.boost * BOOST_GEAR;
        this.gear += (gearTarget - this.gear) * approach(gearTarget > this.gear ? 3 : 0.6, dt);
        if (dt === 0 && this.queue.length === 0 && this.boost === 0) this.gear = gearTarget;
        const gear = calm ? 1 + (this.gear - 1) * 0.12 : this.gear + phase * GEAR_JUMP;
        this.speed = CRUISE * gear * (calm ? 0.5 : 1);
        this.distance += this.speed * dt;
        const spool = Math.max(hush, phase) * WARP_JUMP;
        const warpTarget = Math.min(
            WARP_JUMP,
            Math.max(warpForCombo(this.combo) + Math.min(0.22, this.boost * 0.16) + this.surge * 0.08, spool),
        ) * (calm ? 0.3 : 1);
        let rate = 0.8;
        if (hush) rate = 10;
        else if (warpTarget > this.warp) rate = 3.2;
        else if (phase > 0) rate = 2.5;
        this.warp += (warpTarget - this.warp) * approach(rate, dt);
        if (dt === 0 && this.queue.length === 0 && this.boost === 0) this.warp = warpTarget;
        this.jumpClock = (this.jumpClock + dt) % 64;

        const breathTarget = hush ? 0.1 : 1 - this.dip;
        this.breath += (breathTarget - this.breath) * approach(hush ? 40 : 14, dt);
        if (dt === 0) this.breath = breathTarget;
        this.applyPalette(approach(1.1, dt));

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
        u.sunGain.value = 1 + this.warp * 1.4 + this.surge * 1.6 + this.flash * 1.2;
        const p = this._palette;
        u.glow.value.set(p.glow[0], p.glow[1], p.glow[2]);
        u.deep.value.set(p.deep[0], p.deep[1], p.deep[2]);
        u.accent.value.set(p.accent[0], p.accent[1], p.accent[2]);
        u.dust.value.set(p.dust[0], p.dust[1], p.dust[2]);
        u.sunCol.value.set(p.sun[0], p.sun[1], p.sun[2]);
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
        const share = clamp01((this.gear - 1) / (GEAR_CHAIN - 1));
        const post = this._post;
        post.flash = this.flash;
        post.flashTint = this.flashTint;
        post.kick = this.kick;
        post.rays = hush ? 0.03 : Math.min(0.9, 0.16 + this.warp * 0.45 + this.surge * 0.4 + this.flash * 0.3);
        post.blur = calm ? 0 : Math.min(1, share * 0.55 + phase * 0.9 + this.kick * 0.12 + hush * 0.5);
        post.bloomBoost = this.surge * 0.2 + this.flash * 0.3;
        post.jump = phase;
        post.warp = this.warp;
        // The iris closes as the sky piles up ahead, so the starbow keeps its colours.
        post.exposure = 1 / (1 + this.warp * 0.2 + this.surge * 0.5 + this.flash * 0.25 + phase * 0.35);
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
            jump: jumpPhase(this.time - this.jumpStart, this.jumpLength),
            jumps: this.jumps,
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
