/**
 * Galaxy — the world.
 *
 * Owns the plan, the shared uniforms, every scene part, the camera rig and the choreography.
 * Shared by the theme (galaxy-theme.js) and the playground effect
 * (src/playground/effects/galaxy.effect.js), so what is iterated there ships.
 *
 * A grand spiral hangs behind the board, leaning back, its nucleus burning to the left of the
 * card and its arms sweeping behind it. The board plays it:
 *
 *   lock     a seed of the piece's colour leaves the card at the piece's own height and falls
 *            into the galaxy, to a star nursery level with that row. The nursery ignites in
 *            that colour, a ring runs out through the gas round it, and it keeps some of the
 *            light. A hard drop sends three seeds and hits harder.
 *   clear    the cleared rows leave the card as blades of light, and a wave leaves the nucleus
 *            and runs out through the disc, one front per line: it lifts and flares every sun it
 *            passes, and every nursery it reaches lets go of what it holds — a nova in the colour
 *            it was keeping. The more of the galaxy the player has lit, the more a clear sets off.
 *   combo    the nucleus charges: a ring stands round it in the disc for every step of the
 *            chain, the jets push further out along the axis and every step sends a knot of
 *            light up them, the pattern turns faster and the old suns stream through the arms.
 *   four     the galaxy holds its breath — every light sinks for a fifth of a second and the
 *            arms wind tighter — then the nucleus erupts: both jets fire to their full reach
 *            behind a bright head, every nursery goes nova as the wave passes, a prismatic ring
 *            crosses the sky, space itself ripples out from the nucleus, and it spits stars.
 *   T-spin   the arms wind up and spring back.
 *
 * Everything is a function of the world clock and event timestamps (nothing is created at event
 * time), so seek(t) plus a fixed-step replay reproduces any frame.
 */

import * as THREE from 'three/webgpu';
import {
    CLEAR_SLOTS,
    DEG,
    GALAXY,
    GALAXY_PALETTES,
    HUSH_HOLD,
    LOCK_SLOTS,
    MAX_RINGS,
    PALETTE_KEYS,
    SEED_FLIGHT,
    STARFIRE,
    approach,
    bakeNoise,
    clamp01,
    createGalaxyUniforms,
    createNoiseTexture,
    galaxyAnchors,
    mulberry32,
    pieceColor,
    powerForCombo,
    smooth,
} from './galaxy-tsl.js';
import { buildPlan, nurseryPosition } from './galaxy-plan.js';
import { tierFor } from './galaxy-quality.js';
import { createGiants, createMeteors, createSky } from './galaxy-sky.js';
import { createDisc } from './galaxy-disc.js';
import { createStars } from './galaxy-stars.js';
import { createNurseries } from './galaxy-nurseries.js';
import { createJet, createNucleus } from './galaxy-nucleus.js';
import { createRowBeams, createSeeds, createSparks } from './galaxy-fx.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './galaxy-composition.js';

/** The rest camera: a long lens, far enough back that the disc keeps its shape. */
export const REST_RIG = Object.freeze({
    /** Horizontal field of view the rig holds; the vertical one follows the aspect, clamped. */
    hFov: 48,
    minFov: 23,
    maxFov: 58,
    near: 1,
    far: 20000,
});

/** Vertical field of view (degrees) for an aspect ratio. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((REST_RIG.hFov * DEG) / 2) / a)) / DEG;
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, v));
}

/** The pattern's own turn, radians per second at rest (one turn in about nine minutes). */
export const SPIN_RATE = 0.0115;
/** Seconds the overdrive after a four-line clear takes to cool to 1/e. */
export const SURGE_COOL = 3.4;
/** Seconds the sky's answer to a clear takes to fade to 1/e. */
export const STORM_COOL = 1.7;
/** Seconds a ripple / a clear wave stays in the disc (the shaders skip their loops after). */
const RIPPLE_LIVE = 4.5;
const WAVE_LIVE = 7;
/** Seconds between the sky's own shooting stars. */
export const METEOR_BEAT = 17;
/** How far along the view ray (as a fraction of the galaxy's distance) a seed leaves the card. */
const SEED_DEPTH = 0.4;
/** The arms' spring: how hard it pulls back, how fast it settles, how far a unit winds them. */
const TWIST_STIFFNESS = 30;
const TWIST_DAMPING = 5.2;
const TWIST_REACH = 0.5;
/** The space ripple a four-line clear sends through the picture: screen heights per second. */
const RIPPLE_SPEED = 0.85;
/** A combo step's pulse up the jets waits this long after any other burst (seconds). */
const COMBO_PULSE_GAP = 0.3;
/** Seconds between two looks for the nurseries that stand clear of the card (the pattern turns). */
const TARGET_REFRESH = 2;

const PARTS = [
    'sky', 'giants', 'jetFar', 'disc', 'stars', 'nurseries', 'jetNear', 'nucleus', 'meteors', 'sparks', 'seeds',
    'beams',
];

export class GalaxyWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {THREE.WebGPURenderer} [params.renderer]
     * @param {boolean} [params.capture=false]  deterministic captures: no wall-clock anywhere
     * @param {number} [params.seed]
     */
    constructor({
        scene, quality = 'High', renderer = null, capture = false, seed,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.renderer = renderer;
        this.capture = capture;
        this.plan = buildPlan(seed, { stars: this.tier.stars });
        this.root = new THREE.Group();
        this.root.name = 'Galaxy';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.nurseries = null;
        this.sparks = null;
        this.seeds = null;
        this.beams = null;
        this.meteors = null;
        this.nucleus = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        /** The nucleus on screen (fractions, y down): where the post's rays and ripple come from. */
        this.heart = { x: 0.28, y: 0.45 };
        this.targets = { left: [], right: [] };
        this.targetsAt = -Infinity;
        /** The galaxy's pose at rest for this aspect. */
        this.anchors = galaxyAnchors(this.aspect);
        this.distance = 280;
        this._camera = null;
        this._rest = new THREE.PerspectiveCamera(30, 16 / 9, REST_RIG.near, REST_RIG.far);
        this._frame = new THREE.Matrix4();
        this._inverse = new THREE.Matrix4();
        this._basis = new THREE.Matrix4();
        this._spin = new THREE.Matrix4();
        this._centre = new THREE.Vector3(0, 0, -280);
        this._axis = new THREE.Vector3(0, 1, 0);
        this._e1 = new THREE.Vector3(1, 0, 0);
        this._e2 = new THREE.Vector3(0, 0, 1);
        this._f = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._up = new THREE.Vector3();
        this._tip = new THREE.Vector3();
        this._ray = new THREE.Vector3();
        this._vec = new THREE.Vector3();
        this._look = new THREE.Vector3();
        this._point = { x: 0.5, y: 0.5 };
        this._from = [0, 0, 0];
        this._to = [0, 0, 0];
        this._local = [0, 0, 0];
        this._pointer = { x: 0, y: 0 };
        this._near = [];
        this._s1 = [0, 0, 0];
        this._s2 = [0, 0, 0];
        this._s3 = [0, 0, 0];
        this._palette = {};
        PALETTE_KEYS.forEach((key) => {
            this._palette[key] = [...GALAXY_PALETTES[0][key]];
        });
        this._post = {
            heart: this.heart,
            flash: 0,
            kick: 0,
            rays: 0.1,
            bloomBoost: 0,
            exposure: 1,
            ripple: { radius: 0, strength: 0 },
        };
        this.resetState(0);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.combo = 0;
        this.power = 0;
        this.surge = 0;
        this.storm = 0;
        this.level = 1;
        this.paletteIndex = 0;
        this.flash = 0;
        this.kick = 0;
        this.dip = 0;
        this.breath = 1;
        this.rings = 0;
        this.twist = 0;
        this.twistVelocity = 0;
        this.jetReach = 0.1;
        this.jetGain = 0.07;
        this.hushUntil = -1;
        this.lockCursor = 0;
        this.waveCursor = 0;
        this.lastClear = { time: -100, lines: 0 };
        this.pendingKick = { time: Infinity, amount: 0 };
        this.pendingSurge = { time: Infinity, amount: 0, storm: 0 };
        this.waveRgb = [...STARFIRE];
        this.spaceRipple = { birth: -100, strength: 0 };
        this.counts = {
            locks: 0, clears: 0, quads: 0, seeds: 0, novas: 0,
        };
        // The slow clocks are functions of the world clock until gameplay bends them.
        const motion = this.reducedMotion ? 0.3 : 1;
        this.spin = time * SPIN_RATE * motion;
        this.flow = time * motion;
        this.meteorBeat = Math.floor(time / METEOR_BEAT);
        this.targetsAt = -Infinity;
        this.nurseries?.reset();
        this.sparks?.reset();
        this.seeds?.reset();
        this.beams?.reset();
        this.meteors?.reset();
        if (this.u) {
            for (let i = 0; i < LOCK_SLOTS; i++) this.u.lockA[i].value.set(0, 0, -100, 0);
            for (let i = 0; i < CLEAR_SLOTS; i++) this.u.waveA[i].value.set(-100, 1, 0, 0);
            this.u.shock.value.set(-100, 0);
            this.u.jets.value.set(this.jetReach, this.jetGain, -100, 0);
            this.u.winding.value = GALAXY.winding;
        }
    }

    build() {
        const noise = createNoiseTexture(bakeNoise());
        this.textures.push(noise);
        const u = createGalaxyUniforms({ noise });
        this.u = u;
        const { tier, plan } = this;

        this.addPart('sky', createSky(u, {
            layers: tier.skyLayers, nebula: tier.skyNebula, deepField: tier.deepField,
        }));
        this.addPart('giants', createGiants(u, plan.giants, tier.giants));
        this.addPart('jetFar', createJet(u, -1));
        this.addPart('disc', createDisc(u, { march: tier.march, detail: tier.detail }));
        this.addPart('stars', createStars(u, plan.stars, tier.stars));
        this.nurseries = createNurseries(u, plan.nurseries, tier.nurseries);
        this.addPart('nurseries', this.nurseries);
        this.addPart('jetNear', createJet(u, 1));
        this.nucleus = createNucleus(u);
        this.addPart('nucleus', this.nucleus);
        this.meteors = createMeteors(u, tier.meteors);
        this.addPart('meteors', this.meteors);

        // ── Gameplay effects (pools, always drawn) ──
        this.sparks = createSparks(u, tier.sparks);
        this.addPart('sparks', this.sparks);
        this.seeds = createSeeds(u);
        this.addPart('seeds', this.seeds);
        this.beams = createRowBeams(u);
        this.addPart('beams', this.beams);

        this.applyPalette(1);
        this.compose();
        this.pose();
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
        this.targetsAt = -Infinity;
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
        this.targetsAt = -Infinity;
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Jump the clock (captures): drops every event in flight. */
    seek(time) {
        this.resetState(Math.max(0, time));
        this.applyPalette(1);
        this.pose();
    }

    /** A new run: the galaxy back at rest (it keeps turning). */
    resetSession() {
        const {
            time, spin, flow, meteorBeat,
        } = this;
        this.resetState(time);
        Object.assign(this, { spin, flow, meteorBeat });
        this.applyPalette(1);
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

    // ── The galaxy's place and pose ─────────────────────────────────────────────

    /** The rest camera for the current aspect (what the composition is measured in). */
    restCamera() {
        const cam = this._rest;
        cam.fov = fovForAspect(this.aspect);
        cam.aspect = this.aspect;
        cam.near = REST_RIG.near;
        cam.far = REST_RIG.far;
        cam.updateProjectionMatrix();
        cam.position.set(0, 0, 0);
        cam.up.set(0, 1, 0);
        cam.lookAt(0, 0, -10);
        cam.updateMatrixWorld();
        return cam;
    }

    /** Hang the galaxy and its companion where the composition wants them for this aspect. */
    compose() {
        const { u } = this;
        this.anchors = galaxyAnchors(this.aspect);
        const a = this.anchors;
        const tanV = Math.tan((fovForAspect(this.aspect) * DEG) / 2);
        this.distance = GALAXY.radius / (a.radius * 2 * tanV);
        const cam = this.restCamera();
        this._centre.set(a.x * 2 - 1, 1 - a.y * 2, 0.5).unproject(cam).normalize().multiplyScalar(this.distance);
        if (!u) return;
        u.centre.value.copy(this._centre);
        u.companionDir.value.set(a.companion.x * 2 - 1, 1 - a.companion.y * 2, 0.5).unproject(cam).normalize();
        u.companion.value.x = Math.atan(a.companion.radius * 2 * tanV);
    }

    /**
     * Stand the galaxy's frame for this moment: it leans back from the line of sight by its
     * inclination, its long axis rising to the right, and it breathes — the lean and the tilt
     * drift a few degrees, and the pointer leans it further. Its own turn is the pattern's.
     */
    pose() {
        const { u } = this;
        if (!u) return;
        const t = this.time;
        const calm = this.reducedMotion ? 0 : 1;
        const a = this.anchors;
        const inclination = a.inclination
            + (Math.sin(t * 0.047) * 3.2 + Math.sin(t * 0.021 + 1.9) * 1.6 - this._pointer.y * 4.5) * DEG * calm;
        const lean = a.lean + (Math.sin(t * 0.031 + 1.3) * 2.6 + this._pointer.x * 3.5) * DEG * calm;
        // The line of sight back to the camera, and the sky's own right and up round it.
        const f = this._f.copy(this._centre).normalize().negate();
        const right = this._right.set(0, 1, 0).cross(f).normalize();
        const up = this._up.copy(f).cross(right).normalize();
        const tip = this._tip.copy(up).multiplyScalar(Math.cos(lean)).addScaledVector(right, -Math.sin(lean));
        const axis = this._axis.copy(f).multiplyScalar(Math.cos(inclination))
            .addScaledVector(tip, Math.sin(inclination))
            .normalize();
        const major = this._e1.copy(right).multiplyScalar(Math.cos(lean)).addScaledVector(up, Math.sin(lean))
            .normalize();
        const minor = this._e2.copy(major).cross(axis).normalize();
        this._basis.makeBasis(major, axis, minor);
        this._spin.makeRotationY(this.spin);
        this._frame.copy(this._basis).multiply(this._spin).setPosition(this._centre);
        this._inverse.copy(this._frame).invert();
        u.frame.value.copy(this._frame);
        u.axis.value.copy(axis);
        const disc = this.parts.disc?.mesh;
        if (disc) {
            disc.matrix.copy(this._frame);
            disc.matrixWorld.copy(this._frame);
        }
    }

    /** A nursery's place in the world right now. */
    nurseryWorld(index, out = this._to) {
        const site = this.plan.nurseries[index];
        nurseryPosition(site, this.u ? this.u.winding.value : GALAXY.winding, this._local);
        this._vec.set(this._local[0], this._local[1], this._local[2]).applyMatrix4(this._frame);
        out[0] = this._vec.x;
        out[1] = this._vec.y;
        out[2] = this._vec.z;
        return out;
    }

    /**
     * Which nurseries a seed can be sent to: the ones the rest camera sees clear of the card and
     * the HUD, split by the side of the card they are on, each with where it is on screen.
     */
    findTargets() {
        const left = [];
        const right = [];
        if (this.nurseries) {
            const cam = this.restCamera();
            const card = cardUnion(this.layout) || {
                x0: 0.4, x1: 0.6, y0: 0.1, y1: 0.9,
            };
            const { hud } = this.layout;
            const centre = (card.x0 + card.x1) * 0.5;
            const inside = (r, sx, sy, pad) => r
                && sx > r.x0 - pad && sx < r.x1 + pad && sy > r.y0 - pad && sy < r.y1 + pad;
            for (let i = 0; i < this.nurseries.count; i++) {
                this.nurseryWorld(i);
                this._vec.project(cam);
                if (this._vec.z > 1 || Math.abs(this._vec.x) > 0.94 || Math.abs(this._vec.y) > 0.92) continue;
                const sx = this._vec.x * 0.5 + 0.5;
                const sy = 0.5 - this._vec.y * 0.5;
                if (inside(card, sx, sy, 0.012) || inside(hud, sx, sy, 0.008)) continue;
                (sx < centre ? left : right).push({ index: i, sx, sy });
            }
        }
        this.targets = { left, right };
        this.targetsAt = this.time;
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const t = sim.time;
        const calm = this.reducedMotion ? 0 : 1;
        const fov = fovForAspect(this.aspect) - this.kick * 0.45 * calm;
        if (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        // A slow drift, as of something adrift itself, plus the pointer leaning the view: the
        // galaxy slides against the deep sky behind it.
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        this._pointer.x = px;
        this._pointer.y = py;
        const d = this.distance;
        const swayX = (Math.sin(t * 0.061) * 0.013 + Math.sin(t * 0.027 + 1.3) * 0.008) * d * calm;
        const swayY = (Math.sin(t * 0.043 + 0.7) * 0.007 + Math.sin(t * 0.019) * 0.005) * d * calm;
        camera.position.set(swayX + px * 0.03 * d, swayY - py * 0.018 * d, this.kick * 0.012 * d * calm);
        const yaw = (Math.sin(t * 0.037 + 2.1) * 0.006 - px * 0.012) * calm;
        const pitch = (Math.sin(t * 0.029) * 0.004 - py * 0.008) * calm;
        this._look.set(
            camera.position.x + Math.sin(yaw) * 10,
            camera.position.y + Math.tan(pitch) * 10,
            camera.position.z - 10,
        );
        camera.up.set(Math.sin(t * 0.023) * 0.012 * calm, 1, 0);
        camera.lookAt(this._look);
        camera.updateMatrixWorld();
        this._camera = camera;
    }

    /** The world point `depth` along the ray through a screen point (fractions, y down). */
    screenToWorld(sx, sy, depth, out = this._from) {
        const camera = this._camera;
        if (!camera) {
            out[0] = 0;
            out[1] = 0;
            out[2] = -depth;
            return out;
        }
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        out[0] = camera.position.x + this._ray.x * depth;
        out[1] = camera.position.y + this._ray.y * depth;
        out[2] = camera.position.z + this._ray.z * depth;
        return out;
    }

    // ── Gameplay ────────────────────────────────────────────────────────────────

    /**
     * Pick the nursery a lock on `side` (−1 left, +1 right) lights: any of those level with
     * where the seed leaves the card (`sy`, a screen fraction), so a piece lights the part of
     * the galaxy beside the row it locked on, near the card or far across it.
     */
    pickTarget(side, sy, salt = 0) {
        if (this.time - this.targetsAt > TARGET_REFRESH) this.findTargets();
        let list = side < 0 ? this.targets.left : this.targets.right;
        if (!list.length) list = side < 0 ? this.targets.right : this.targets.left;
        if (!list.length) return -1;
        // Widen the band until a few are in it.
        const level = Number.isFinite(sy) ? sy : 0.5;
        const near = this._near;
        let band = 0.1;
        do {
            near.length = 0;
            for (let i = 0; i < list.length; i++) {
                if (Math.abs(list[i].sy - level) < band) near.push(list[i]);
            }
            band *= 1.8;
        } while (near.length < Math.min(4, list.length) && band < 4);
        const rand = mulberry32(0x1f3d + (this.counts.locks + 1) * 2654435761 + salt * 97)();
        return near[Math.min(near.length - 1, Math.floor(rand * near.length))].index;
    }

    /** Send a ring out through the gas from a point of the galaxy's frame. */
    ring(x, z, time, strength, rgb, reach = 1) {
        const slot = this.lockCursor % LOCK_SLOTS;
        this.lockCursor += 1;
        this.u.lockA[slot].value.set(x, z, time, strength);
        this.u.lockC[slot].value.set(rgb[0] * 1.5, rgb[1] * 1.5, rgb[2] * 1.5, reach);
    }

    /** Send one seed from a world point into nursery `index`. Returns its landing time. */
    sendSeed(index, from, rgb, amount) {
        const site = this.plan.nurseries[index];
        if (!site || !this.seeds) return this.time;
        const to = this.nurseryWorld(index);
        const dist = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
        const flight = this.reducedMotion ? 0.12 : SEED_FLIGHT * (0.8 + Math.min(1.1, dist / (this.distance * 1.1)));
        const land = this.time + flight;
        // The arc bows out of the disc's plane, toward the camera's side of it.
        const bow = dist * 0.16;
        this.seeds.launch({
            from,
            site,
            rgb,
            time: this.time,
            flight,
            bow: [this._axis.x * bow, this._axis.y * bow, this._axis.z * bow],
            size: 0.75 + amount * 0.3,
        });
        // What the landing sets off (the ring through the gas, the sparks) waits for the landing:
        // see answer().
        this.nurseries.strike(index, rgb, land, amount);
        this.counts.seeds += 1;
        return land;
    }

    /**
     * What the nurseries did this frame, answered where each one is NOW: a seed landed (a ring
     * through the gas round it, a few sparks) or a wave set one off (a nova's debris).
     */
    answer(applied) {
        const share = this.sparks.count / 640;
        const e1 = this._e1.toArray(this._s1);
        const e2 = this._e2.toArray(this._s2);
        const axis = this._axis.toArray(this._s3);
        for (let i = 0; i < applied.length; i++) {
            const event = applied[i];
            const to = this.nurseryWorld(event.index);
            if (event.kind === 0) {
                const { amount, rgb } = event;
                this.ring(this._local[0], this._local[2], event.time, 0.5 + amount * 0.5, rgb, 0.55 + amount * 0.35);
                this.sparks.emit({
                    x: to[0],
                    y: to[1],
                    z: to[2],
                    n: Math.round((7 + 12 * amount) * share),
                    rgb,
                    time: event.time,
                    e1,
                    e2,
                    axis,
                    out: [4, 12 + amount * 8],
                    life: [0.5, 1.1],
                    size: 0.2,
                });
            } else {
                this.sparks.emit({
                    x: to[0],
                    y: to[1],
                    z: to[2],
                    n: event.sparks || Math.round(6 * share),
                    // What it was holding, if it held enough to have a colour of its own; else its wave's.
                    rgb: event.held > 0.4 ? this.nurseries.tintOf(event.index) : (event.rgb || this.waveRgb),
                    time: event.time,
                    e1,
                    e2,
                    axis,
                    out: [6, 18 + event.amount * 9],
                    life: [0.7, 1.7],
                    size: 0.2 + event.amount * 0.04,
                });
                this.counts.novas += 1;
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
        if (!this.u || !this.nurseries) return;
        const rgb = pieceColor(color);
        const point = screen && Number.isFinite(screen.x) && Number.isFinite(screen.y) ? screen : null;
        let wx = 0.5;
        let wy = 0.6;
        let side = u < 0.5 ? -1 : 1;
        if (Math.abs(u - 0.5) < 0.03) side = this.counts.locks % 2 ? 1 : -1;
        if (point) side = point.x < 0.5 ? -1 : 1;
        // Nothing to light on that side of the card: the seed leaves by the other edge.
        if (this.time - this.targetsAt > TARGET_REFRESH) this.findTargets();
        if (!(side < 0 ? this.targets.left : this.targets.right).length) side = -side;
        if (point) {
            wx = point.x;
            wy = point.y;
        } else {
            const board = boardFor(this.layout, player);
            const card = cardUnion(this.layout);
            if (board) {
                const row = Array.isArray(rows) && rows.length ? rows[Math.floor(rows.length / 2)] : 19;
                boardPoint(board, u, row, this._point);
                // The seed leaves the card's edge on that side, at the piece's height.
                const edges = card || board;
                wx = side < 0 ? edges.x0 : edges.x1;
                wy = this._point.y;
            }
        }
        const from = [...this.screenToWorld(wx, wy, this.distance * SEED_DEPTH)];
        const target = this.pickTarget(side, wy);
        if (target >= 0) {
            this.sendSeed(target, from, rgb, hardDrop ? 1.3 : 0.85);
            if (hardDrop) {
                // Two more into its neighbours.
                for (let k = 1; k <= 2; k++) {
                    const other = this.pickTarget(side, wy, k);
                    if (other >= 0 && other !== target) this.sendSeed(other, from, rgb, 0.6);
                }
            }
        }
        this.kick = Math.max(this.kick, hardDrop ? 0.5 : 0.1);
        this.flash = Math.max(this.flash, hardDrop ? 0.1 : 0.02);
        this.counts.locks += 1;
    }

    /**
     * Lines cleared. `lines` 1..4; `tspin`, `perfect`; `rows` = the visible rows that went.
     */
    onClear({
        rows = null, lines = 1, tspin = false, perfect = false, player = 0, screen = null,
    } = {}) {
        const { u } = this;
        if (!u || !this.nurseries) return;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        const p = this._palette;
        // One line answers in the rim's light, two in the inner arms', three in the jets'.
        let rgb;
        if (quad) rgb = [...STARFIRE];
        else if (n === 1) rgb = [...p.armOuter];
        else if (n === 2) rgb = [...p.armInner];
        else rgb = [0, 1, 2].map((c) => p.jet[c] * 0.7 + p.nursery[c] * 0.5 + 0.15);
        const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
        rgb = rgb.map((c) => (c / peak) * 0.9 + 0.1);
        const strength = Math.min(1.5, 0.6 + 0.15 * n + (quad ? 0.25 : 0));
        const birth = quad ? this.time + HUSH_HOLD : this.time;

        // ── The wave leaves the nucleus ──
        const slot = this.waveCursor % CLEAR_SLOTS;
        this.waveCursor += 1;
        u.waveA[slot].value.set(birth, perfect ? 4 : n, strength, quad ? 1 : 0);
        u.waveC[slot].value.set(rgb[0] * 1.25, rgb[1] * 1.25, rgb[2] * 1.25);
        this.lastClear = { time: birth, lines: n };

        // ── Every nursery lets go of what it holds as the wave passes it (see answer()) ──
        // Each nova's share of the debris pool: every nursery answers four lines, the lit ones a
        // lesser clear.
        const expected = quad ? this.nurseries.count : Math.max(1, this.nurseries.litCount(this.time));
        const each = Math.max(3, Math.min(
            Math.round((20 * this.sparks.count) / 640),
            Math.floor((this.sparks.count * 0.8) / expected),
        ));
        this.nurseries.release(birth, { floor: quad ? 0.3 : 0, rgb, sparks: each });
        this.waveRgb = rgb;
        const lit = Math.min(1, this.nurseries.totalHeld(this.time) / 12);
        const storm = Math.min(1.4, 0.3 + 0.14 * n + lit * 0.4 + (quad ? 0.4 : 0));
        // On four lines the sky answers with the eruption, not with the hush before it.
        if (!quad) this.storm = Math.max(this.storm, storm);
        this.pendingKick = { time: birth + 0.1, amount: 0.22 + 0.1 * n };

        // ── The cleared rows leave the card as blades of light ──
        const board = boardFor(this.layout, player);
        const card = cardUnion(this.layout);
        if (board && card && this.layoutLive && !screen) {
            const list = Array.isArray(rows) && rows.length ? rows : Array.from({ length: n }, (_, i) => 19 - i);
            const ys = [];
            for (let i = 0; i < list.length && i < 4; i++) ys.push(boardPoint(board, 0.5, list[i], this._point).y);
            this.beams.fire(ys, card.x0, card.x1, rgb, this.time, Math.min(1.4, 0.7 + 0.18 * n));
        }

        if (quad) {
            // The galaxy holds its breath and winds up; then the nucleus erupts.
            this.hushUntil = this.time + HUSH_HOLD;
            this.pendingSurge = { time: birth, amount: perfect ? 1.3 : 1, storm };
            this.twistVelocity += 2.2;
            u.jets.value.z = birth;
            u.jets.value.w = perfect ? 1.3 : 1;
            u.shock.value.set(birth, this.reducedMotion ? 0.5 : 1);
            this.spaceRipple = { birth, strength: this.reducedMotion ? 0.25 : 1 };
            this.meteors?.emit({
                n: Math.round(this.meteors.count * 0.75),
                time: birth + 0.12,
                rgb: [1.0, 0.92, 0.8],
                stagger: 1.4,
                size: 2.6,
                radiant: u.nucleusDir.value.toArray(),
            });
            this.counts.quads += 1;
        } else if (n === 3) {
            u.jets.value.z = this.time;
            u.jets.value.w = 0.5;
            this.surge = Math.max(this.surge, 0.3);
            this.meteors?.emit({
                n: 3, time: birth + 0.2, rgb: p.nucleus, stagger: 0.6,
            });
        }
        if (tspin) {
            // The arms wind up and spring back; a small ring leaves the nucleus across the sky.
            this.twistVelocity += 3.0;
            if (!quad) {
                u.shock.value.set(this.time, 0.42);
                this.spaceRipple = { birth: this.time, strength: this.reducedMotion ? 0.1 : 0.4 };
            }
            this.storm = Math.max(this.storm, 0.85);
        }
        this.counts.clears += 1;
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        // The chain broke: the galaxy lets its breath go.
        if (n === 0 && this.combo >= 2) this.dip = Math.max(this.dip, 0.28);
        // Another step of the chain: a knot of light runs up both jets — unless a bigger burst
        // (three lines, an eruption) is already on its way.
        if (n >= 2 && n > this.combo && this.u && this.time - this.u.jets.value.z > COMBO_PULSE_GAP) {
            this.u.jets.value.z = this.time;
            this.u.jets.value.w = Math.min(0.9, 0.25 + 0.08 * n);
            this.flash = Math.max(this.flash, 0.05);
        }
        this.combo = n;
    }

    /** A new level: the galaxy changes its colours. */
    levelUp(level, { silent = false } = {}) {
        this.level = Math.max(1, Math.round(Number(level) || 1));
        this.paletteIndex = (this.level - 1) % GALAXY_PALETTES.length;
        if (silent) this.applyPalette(1);
        else {
            this.storm = Math.max(this.storm, 0.75);
            this.flash = Math.max(this.flash, 0.14);
            this.u?.shock.value.set(this.time, 0.36);
            this.meteors?.emit({
                n: 2, time: this.time + 0.3, rgb: GALAXY_PALETTES[this.paletteIndex].nucleus, stagger: 0.8,
            });
        }
    }

    /** Ease the live palette toward the level's (k = 1 snaps). */
    applyPalette(k) {
        const target = GALAXY_PALETTES[this.paletteIndex];
        const p = this._palette;
        for (let i = 0; i < PALETTE_KEYS.length; i++) {
            const key = PALETTE_KEYS[i];
            for (let c = 0; c < 3; c++) p[key][c] += (target[key][c] - p[key][c]) * k;
        }
    }

    // ── Frame ───────────────────────────────────────────────────────────────────

    update(sim, camera = this._camera) {
        const { u } = this;
        if (!u) return;
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const t = this.time;
        const motion = this.reducedMotion ? 0.3 : 1;

        // ── The charge ──
        const target = powerForCombo(this.combo);
        this.power += (target - this.power) * approach(target > this.power ? 2.4 : 0.8, dt);
        this.surge *= Math.exp(-dt / SURGE_COOL);
        this.storm *= Math.exp(-dt / STORM_COOL);
        this.flash *= Math.exp(-dt / 0.25);
        this.kick *= Math.exp(-dt / 0.16);
        this.dip *= Math.exp(-dt / 0.35);
        if (t >= this.pendingSurge.time) {
            // As if it had begun at its own moment, whatever frame noticed it.
            const lateness = t - this.pendingSurge.time;
            this.surge = Math.max(this.surge, this.pendingSurge.amount * Math.exp(-lateness / SURGE_COOL));
            this.storm = Math.max(this.storm, this.pendingSurge.storm * Math.exp(-lateness / STORM_COOL));
            this.pendingSurge.time = Infinity;
        }
        if (t >= this.pendingKick.time) {
            this.kick = Math.max(this.kick, this.pendingKick.amount);
            this.flash = Math.max(this.flash, this.pendingKick.amount * 0.5);
            this.pendingKick.time = Infinity;
        }
        const hush = t < this.hushUntil ? 1 : 0;
        const breathTarget = hush ? 0.12 : 1 - this.dip;
        this.breath += (breathTarget - this.breath) * approach(hush ? 40 : 14, dt);
        if (dt === 0) this.breath = breathTarget;

        // One ring for every step of the chain past the first.
        const ringTarget = Math.max(0, Math.min(MAX_RINGS, this.combo - 1));
        this.rings += (ringTarget - this.rings) * approach(ringTarget > this.rings ? 5 : 1.4, dt);
        this.applyPalette(approach(0.8, dt));

        // The arms' spring (semi-implicit, in small steps so a long frame cannot blow it up).
        let left = Math.min(dt, 0.1);
        while (left > 1e-5) {
            const h = Math.min(left, 1 / 120);
            this.twistVelocity += (-TWIST_STIFFNESS * this.twist - TWIST_DAMPING * this.twistVelocity) * h;
            this.twist += this.twistVelocity * h;
            left -= h;
        }
        u.winding.value = GALAXY.winding + this.twist * TWIST_REACH * (this.reducedMotion ? 0.25 : 1);

        // The jets: every step of the chain pushes them out; an eruption fires them whole.
        const reachTarget = Math.min(1, 0.1 + 0.6 * this.power ** 1.3 + this.surge * 0.95);
        const gainTarget = 0.07 + this.power * 0.85 + this.surge * 1.1;
        this.jetReach += (reachTarget - this.jetReach) * approach(reachTarget > this.jetReach ? 7 : 1.1, dt);
        this.jetGain += (gainTarget - this.jetGain) * approach(gainTarget > this.jetGain ? 9 : 1.4, dt);

        // ── The slow clocks ──
        const hurry = this.reducedMotion ? 0 : 1;
        this.spin += dt * SPIN_RATE * motion * (1 + (this.power * 3 + this.surge * 7) * hurry);
        this.flow += dt * motion * (1 + (this.power * 4 + this.surge * 9 + this.storm * 2) * hurry);

        // A shooting star now and then, on the sky's own clock.
        const beat = Math.floor(t / METEOR_BEAT);
        if (beat !== this.meteorBeat) {
            this.meteorBeat = beat;
            if (dt > 0 && this.meteors) {
                this.meteors.emit({
                    n: 1, time: t + 0.2 + (beat % 3) * 0.9, rgb: this._palette.nucleus, size: 2.0,
                });
            }
        }

        this.pose();
        if (this.nurseries) {
            const applied = this.nurseries.update(t);
            if (applied.length) this.answer(applied);
        }

        // ── Uniforms ──
        let ripplesLive = 0;
        for (let i = 0; i < LOCK_SLOTS; i++) {
            if (t - u.lockA[i].value.z < RIPPLE_LIVE) ripplesLive = 1;
        }
        let wavesLive = 0;
        for (let i = 0; i < CLEAR_SLOTS; i++) {
            if (t - u.waveA[i].value.x < WAVE_LIVE) wavesLive = 1;
        }
        u.ripplesLive.value = ripplesLive;
        u.wavesLive.value = wavesLive;
        u.time.value = t;
        u.power.value = this.power;
        u.surge.value = this.surge;
        u.breath.value = this.breath;
        u.rings.value = this.rings;
        u.flow.value = this.flow;
        u.skyPulse.value = Math.min(1.2, this.storm * 0.7 + this.surge * 0.5);
        u.jets.value.x = this.jetReach;
        u.jets.value.y = this.jetGain;
        u.companion.value.y = t * 0.02;
        u.companion.value.z = 0.7;
        const p = this._palette;
        const heat = clamp01(this.surge * 0.5);
        const warm = (key, node, gain = 1) => {
            const c = p[key];
            node.value.set(
                (c[0] + (STARFIRE[0] - c[0]) * heat) * gain,
                (c[1] + (STARFIRE[1] - c[1]) * heat) * gain,
                (c[2] + (STARFIRE[2] - c[2]) * heat) * gain,
            );
        };
        const lift = 1 + this.power * 0.25 + this.storm * 0.12;
        warm('core', u.core, lift);
        warm('nucleus', u.nucleus);
        u.armInner.value.set(p.armInner[0] * lift, p.armInner[1] * lift, p.armInner[2] * lift);
        u.armOuter.value.set(p.armOuter[0] * lift, p.armOuter[1] * lift, p.armOuter[2] * lift);
        u.nursery.value.set(p.nursery[0], p.nursery[1], p.nursery[2]);
        u.dust.value.set(p.dust[0], p.dust[1], p.dust[2]);
        u.jet.value.set(p.jet[0], p.jet[1], p.jet[2]);
        u.nebulaA.value.set(p.nebulaA[0], p.nebulaA[1], p.nebulaA[2]);
        u.nebulaB.value.set(p.nebulaB[0], p.nebulaB[1], p.nebulaB[2]);
        u.voidCol.value.set(p.void[0], p.void[1], p.void[2]);
        if (this.nucleus) {
            this.nucleus.uniforms.glare.value.set(
                0.5 + this.power * 1.0 + this.surge * 1.3 + this.flash * 1.5,
                this.power * this.power * 0.4 + this.surge * 0.8 + this.flash * 0.6,
            );
        }

        // What follows the camera: the dome, the camera in the galaxy's frame, the nucleus on screen.
        if (camera) {
            const sky = this.parts.sky?.mesh;
            if (sky) {
                sky.position.copy(camera.position);
                sky.updateMatrix();
                sky.updateMatrixWorld(true);
            }
            u.camLocal.value.copy(camera.position).applyMatrix4(this._inverse);
            u.nucleusDir.value.copy(this._centre).sub(camera.position).normalize();
            this._ray.copy(this._centre).project(camera);
            this.heart.x = Math.max(-0.5, Math.min(1.5, this._ray.x * 0.5 + 0.5));
            this.heart.y = Math.max(-0.5, Math.min(1.5, 0.5 - this._ray.y * 0.5));
        }

        // ── Post ──
        const sinceClear = t - this.lastClear.time;
        const swell = sinceClear >= 0 ? Math.exp(-sinceClear / 0.7) * (0.3 + 0.12 * this.lastClear.lines) : 0;
        const post = this._post;
        post.flash = this.flash;
        post.kick = this.kick;
        post.rays = hush ? 0.02 : 0.04 + this.power * 0.14 + this.surge * 0.25 + swell * 0.1;
        post.bloomBoost = this.surge * 0.12 + swell * 0.1;
        // The iris closes as the galaxy flares, so its colours survive the surge.
        post.exposure = 1 / (1 + this.surge * 1.3 + swell * 0.5 + this.power * 0.25 + this.storm * 0.15);
        const rippleAge = t - this.spaceRipple.birth;
        post.ripple.radius = Math.max(0, rippleAge) * RIPPLE_SPEED;
        post.ripple.strength = rippleAge >= 0
            ? this.spaceRipple.strength * Math.exp(-rippleAge / 0.85) * smooth(0, 0.12, rippleAge)
            : 0;
    }

    /** What the post stack reads each frame (a reused object). */
    getPostState() {
        return this._post;
    }

    getState() {
        return {
            quality: this.quality,
            time: this.time,
            combo: this.combo,
            power: this.power,
            surge: this.surge,
            storm: this.storm,
            breath: this.breath,
            rings: this.rings,
            twist: this.twist,
            jetReach: this.jetReach,
            level: this.level,
            palette: GALAXY_PALETTES[this.paletteIndex].name,
            counts: { ...this.counts },
            held: this.nurseries ? this.nurseries.totalHeld(this.time) : 0,
            stars: this.parts.stars ? this.parts.stars.count : 0,
            nurseries: this.nurseries ? this.nurseries.count : 0,
            targets: { left: this.targets.left.length, right: this.targets.right.length },
            sparks: this.sparks ? this.sparks.count : 0,
            march: this.tier.march,
            layoutLive: this.layoutLive,
            heart: { ...this.heart },
            distance: this.distance,
            spin: this.spin,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.scene?.remove(this.root);
        this.disposables.forEach((part) => {
            part.geometry?.dispose?.();
            part.material?.dispose?.();
        });
        this.textures.forEach((t) => t.dispose());
        this.disposables = [];
        this.textures = [];
        this.parts = {};
        this.nurseries = null;
        this.sparks = null;
        this.seeds = null;
        this.beams = null;
        this.meteors = null;
        this.nucleus = null;
        this.u = null;
        this._camera = null;
    }
}

export { PARTS as GALAXY_PARTS };
