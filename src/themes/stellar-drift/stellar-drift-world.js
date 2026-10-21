/**
 * Stellar Drift — the world.
 *
 * Owns the shared uniforms, every scene part, the camera rig and the choreography. Shared by the
 * theme (stellar-drift-theme.js) and the playground effect
 * (src/playground/effects/stellar-drift.effect.js), so what is iterated there ships.
 *
 * A ringed giant fills the left of the frame, its weather running in bands, its rings sweeping
 * behind the card and throwing their shadow on its cloud tops; two moons stand far off on the
 * other side, one of ice that vents into the dark, one of rust; and the camera drifts in the
 * thin outer haze of the rings, among slow shards of ice. The board plays on it:
 *
 *   lock     a comet of the piece's colour leaves the card and falls into the rings: a white-hot
 *            impact, the ringlet it lands on lit along its orbit, a splash of ice chips and a
 *            density wave that brightens and thins the rings as it runs out, wound into a
 *            spiral by their own turning. A hard drop lands harder.
 *   clear    the rings chime: light runs out through the whole system, one front per line, and
 *            every cleared row is written round the giant as a hairline of light with a
 *            white-hot head; lightning branches under the night side's cloud.
 *   combo    the rings are the chain: every step raises their hum in the chain's colour,
 *            lightning walks the night side and meteors start to fall; at 3 and 5 two arcs of
 *            its light race round the rings, and at 8 a corona of light leaves the giant.
 *   four     a storm of bolides strikes the cloud tops (fireball, shock, embers, a dark scar
 *            the wind shears), the icy moon vents, a corona of light leaves the giant and the
 *            whole ring system rings four times over.
 *   T-spin   a cyclone is spun into the cloud bands, its arms lit, and a two-armed spiral of
 *            light winds round through the rings.
 *   b2b      the rings' outer strand blazes, braided and knotted with light.
 *   perfect  all of it in gold.
 *   level    the hour turns: the picture moves one palette round its wheel of six (the giant's
 *            bands take the new colours one by one, like weather), and the sun moves with it.
 *   time     by itself, with no level change, the picture drifts round the same wheel: one
 *            palette every PALETTE_STEP seconds. The two simply add.
 *
 * Everything is a function of the world clock and event timestamps (nothing is created at event
 * time), so seek(t) plus a fixed-step replay reproduces any frame.
 */

import * as THREE from 'three/webgpu';
import {
    BOLT_SLOTS,
    CHIME_LIVE,
    CHIME_SLOTS,
    CYCLONE_LIFE,
    DEG,
    EVENT_ROWS,
    GIANT,
    JET_LIFE,
    JET_SLOTS,
    METEOR_SLOTS,
    MOTE_FLIGHT,
    PALETTES,
    PALETTE_KEYS,
    RINGS,
    RIPPLE_LIFE,
    RIPPLE_SLOTS,
    SHOCK_LIFE,
    STRAND_LIFE,
    STRIKE_LIFE,
    STRIKE_SLOTS,
    SURGE_LIFE,
    SURGE_SPEED,
    TAU,
    approach,
    chainHeat,
    bakeBandColors,
    bakeBandMeta,
    bakeFbm,
    bakeLattice,
    bakeRingProfile,
    bandPlace,
    clamp01,
    createBandBlurTexture,
    createBandColorTexture,
    createBandMetaTexture,
    createFbmTexture,
    createLatticeTexture,
    createRingTexture,
    createStellarDriftUniforms,
    giantAnchors,
    lerp,
    mulberry32,
    paletteAt,
    paletteName,
    palettePhase,
    palettePlace,
    pieceColor,
    ringOmega,
    ringTau,
    rowLatitude,
    smooth,
    sunDirection,
} from './stellar-drift-tsl.js';
import { tierFor } from './stellar-drift-quality.js';
import { EventPool } from './stellar-drift-pool.js';
import { createSpace } from './stellar-drift-space.js';
import {
    createHeads, createIce, createMeteors, createSparks,
} from './stellar-drift-fx.js';
import {
    BOARD_GRID, PLAYER_SLOTS, boardFor, boardPoint, fallbackLayout,
} from './stellar-drift-composition.js';
import { applyCameraBreath } from '../shared/camera-breath.js';

/** The rest camera: a long lens, so the giant keeps its roundness off-centre. */
export const REST_RIG = Object.freeze({
    /** Horizontal field of view the rig holds; the vertical one follows the aspect, clamped. */
    hFov: 52,
    minFov: 26,
    maxFov: 60,
    near: 0.004,
    far: 90,
});

/** Vertical field of view (degrees) for an aspect ratio. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((REST_RIG.hFov * DEG) / 2) / a)) / DEG;
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, v));
}

/** The giant's own turn, radians per second (one turn in about nineteen minutes). */
export const SPIN_RATE = TAU / 1150;
/** How fast the level's place on the wheel is taken up (1/s). */
const PLACE_RATE = 0.42;
/** Seconds the rings' flare after a clear takes to fade to 1/e. */
const SURGE_FADE = 2.6;
/** Seconds the icy moon's great vent after a four-line clear takes to fade to 1/e. */
const VENT_FADE = 7;
/** The moon's vents at rest. */
const VENT_REST = 0.22;
/** Seconds between two of the giant's own lightning storms' chances, and of its own meteors. */
const BOLT_TICK = 0.31;
const METEOR_PERIOD = 12.5;
/** How long a bolt's light lasts. */
const BOLT_LIFE = 0.62;

const PARTS = ['space', 'boulders', 'shards', 'motes', 'sparks', 'meteors', 'heads'];
const COMBO_MILESTONES = [3, 5, 8];
const MAX_TIMED_MOMENTS = RIPPLE_SLOTS + METEOR_SLOTS;
/** The flourishes (stellar-drift-core.js) and what each milestone of a chain plays. */
const FLOURISH_KINDS = ['cyclone', 'surge', 'crown', 'strand', 'shock'];
const MILESTONE_SURGES = [
    { power: 0.75, tall: 0.25 },
    { power: 1.0, tall: 0.6 },
    { power: 1.4, tall: 1.2 },
];

/** A flourish at rest: born long ago. */
const idleFlourish = () => ({
    birth: -1e6, power: 0, rgb: [1, 1, 1], lon: 0, lat: 0, dir: 1, tall: 0, seed: 0,
});

export class StellarDriftWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {THREE.WebGPURenderer} [params.renderer]
     * @param {boolean} [params.capture=false]  deterministic captures: no wall-clock anywhere
     * @param {number} [params.seed]
     */
    constructor({
        scene, quality = 'High', renderer = null, capture = false, seed = 0x51d7,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.renderer = renderer;
        this.capture = capture;
        this.seed = seed;
        this.root = new THREE.Group();
        this.root.name = 'StellarDrift';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.ice = null;
        this.sparks = null;
        this.meteors = null;
        this.heads = null;
        /** The flourishes in play, one of each (a new one takes the place of the last). */
        this.flourish = {
            cyclone: idleFlourish(), surge: idleFlourish(), strand: idleFlourish(), shock: idleFlourish(),
        };
        /** How many of each kind have been played since the session began. */
        this.flourishes = Object.fromEntries(FLOURISH_KINDS.map((kind) => [kind, 0]));
        this.chains = Array.from({ length: PLAYER_SLOTS }, () => ({ player: null, combo: 0, milestone: 0 }));
        this.ringProfile = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        /** The giant on screen (fractions, y down), and its radius in screen heights. */
        this.heart = { x: 0.2, y: 0.47 };
        this.heartRadius = 0.26;
        this.anchors = giantAnchors(this.aspect);
        /** The camera's distance from the giant's centre (radii). */
        this.distance = 5;
        this._camera = null;
        this._rest = new THREE.PerspectiveCamera(30, 16 / 9, REST_RIG.near, REST_RIG.far);
        this._home = new THREE.Vector3(0, 1, 5);
        this._right = new THREE.Vector3(1, 0, 0);
        this._up = new THREE.Vector3(0, 1, 0);
        this._fwd = new THREE.Vector3(0, 0, -1);
        this._a = new THREE.Vector3();
        this._b = new THREE.Vector3();
        this._c = new THREE.Vector3();
        this._ray = new THREE.Vector3();
        this._m = new THREE.Matrix4();
        this._n = new THREE.Matrix4();
        this._q = new THREE.Quaternion();
        this._lean = new THREE.Quaternion();
        this._euler = new THREE.Euler();
        this._point = { x: 0.5, y: 0.5 };
        this._site = {
            x: 1.8, z: 0, r: 1.8, seen: true,
        };
        this._sun = [0, 0, 1];
        this._palette = {};
        this._shine = [0, 0, 0];
        this._accent = [0.4, 0.9, 1.0];
        this._accentTarget = [0.4, 0.9, 1.0];
        this._lastColor = [0.4, 0.9, 1.0];
        this._post = {
            heart: this.heart,
            heartRadius: 0.26,
            flash: 0,
            kick: 0,
            bloomBoost: 0,
            exposure: 1,
        };
        this.ripples = new EventPool(RIPPLE_SLOTS, RIPPLE_LIFE, () => ({
            x: 0, z: 0, strength: 0, rgb: [1, 1, 1], omega: 0,
        }));
        this.chimes = new EventPool(CHIME_SLOTS, CHIME_LIVE, () => ({
            strength: 0, fronts: 1, arms: 0, rgb: [1, 1, 1],
        }));
        this.jets = new EventPool(JET_SLOTS, JET_LIFE, () => ({
            lat: 0, strength: 0, lon: 0, rgb: [1, 1, 1],
        }));
        this.strikes = new EventPool(STRIKE_SLOTS, STRIKE_LIFE, () => ({
            lon: 0, lat: 0, strength: 0, bearing: 0, rgb: [1, 1, 1],
        }));
        this.bolts = new EventPool(BOLT_SLOTS, BOLT_LIFE, () => ({
            lon: 0, lat: 0, strength: 0, size: 0.05, seed: 0,
        }));
        this.resetState(0);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.combo = 0;
        this.level = 1;
        /** The level's place on the wheel (level − 1), eased when a level changes. */
        this.levelPlace = 0;
        this.place = palettePlace(0, time);
        this.surge = 0;
        this.crown = 0;
        this.hum = 0;
        this.vent = 0;
        this.flash = 0;
        this.kick = 0;
        this._post.flash = 0;
        this._post.kick = 0;
        this._post.bloomBoost = 0;
        /** Timed moments still ahead: a mote's landing, a meteor's strike. */
        this.queue = [];
        this.counts = {
            locks: 0,
            clears: 0,
            quads: 0,
            tspins: 0,
            perfects: 0,
            b2b: 0,
            milestones: 0,
            cascades: 0,
            meteors: 0,
            bolts: 0,
        };
        // The slow clocks are functions of the world clock until gameplay bends them.
        const motion = this.reducedMotion ? 0.3 : 1;
        this.spin = time * SPIN_RATE * motion;
        this.flow = (time / GIANT.flowCycle) * motion;
        this.flutter = time * 0.6 * motion;
        this.boltTick = Math.floor(time / BOLT_TICK);
        this.meteorTick = Math.floor(time / METEOR_PERIOD);
        this.ripples?.reset();
        this.chimes?.reset();
        this.jets?.reset();
        this.strikes?.reset();
        this.bolts?.reset();
        this.sparks?.reset();
        this.meteors?.reset();
        this.retireFlourishes();
        this.chains.forEach((chain) => {
            chain.player = null;
            chain.combo = 0;
            chain.milestone = 0;
        });
        for (let c = 0; c < 3; c++) {
            const base = [0.4, 0.9, 1.0][c];
            this._lastColor[c] = base;
            this._accentTarget[c] = base;
            this._accent[c] = base;
        }
    }

    build() {
        const { tier } = this;
        const lattice = createLatticeTexture(bakeLattice(this.seed + 11));
        const fbm = createFbmTexture(bakeFbm(this.seed + 23, tier.fbmSize, tier.fbmOctaves), tier.fbmSize);
        this.ringProfile = bakeRingProfile(tier.ringSize, this.seed + 37);
        const rings = createRingTexture(this.ringProfile);
        const meta = bakeBandMeta(512, this.seed + 41);
        const colors = bakeBandColors(meta, PALETTES);
        const bandMeta = createBandMetaTexture(meta);
        const bands = createBandColorTexture(colors);
        const bandsFar = createBandBlurTexture(colors);
        this.textures.push(lattice, fbm, rings, bandMeta, bands, bandsFar);
        this.noiseTexture = fbm;
        const u = createStellarDriftUniforms({
            lattice, fbm, rings, bandMeta, bands, bandsFar,
        }, { fbmSize: tier.fbmSize, ringSize: tier.ringSize, bandSize: meta.size });
        this.u = u;

        this.addPart('space', createSpace(u, tier));
        this.ice = createIce(u, tier.ice, this.seed + 53);
        this.addPart('boulders', this.ice.boulders);
        this.addPart('shards', this.ice.shards);
        this.addPart('motes', this.ice.motes);
        this.sparks = createSparks(u, tier.sparks);
        this.addPart('sparks', this.sparks);
        this.meteors = createMeteors(u);
        this.addPart('meteors', this.meteors);
        this.heads = createHeads(u, this.meteors);
        this.addPart('heads', this.heads);

        this.resetState(this.time);
        this.compose();
        this.applyPalette();
        this.scene.add(this.root);
        return this;
    }

    addPart(name, part) {
        this.parts[name] = part;
        this.root.add(part.mesh);
        this.disposables.push(part);
    }

    /** Draw only the named parts (captures, bisecting a look). `ice` names all three classes. */
    showOnlyParts(names) {
        const keep = new Set(names);
        if (keep.has('ice')) ['boulders', 'shards', 'motes'].forEach((name) => keep.add(name));
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
        const entering = reduced === true && !this.reducedMotion;
        this.reducedMotion = reduced === true;
        if (this.reducedMotion) {
            this.flash = 0;
            this.kick = 0;
            this._post.flash = 0;
            this._post.kick = 0;
        }
        if (entering) {
            // These pools retain their launch speed. Retire them when the preference changes.
            this.meteors?.reset();
            this.sparks?.reset();
            this.retireFlourishes();
            this.bolts.reset();
            this.queue.length = 0;
        }
    }

    /** Jump the clock (captures): drops every event in flight. */
    seek(time) {
        this.resetState(Math.max(0, time));
        this.applyPalette();
    }

    /** A new run: the giant at rest again (it keeps turning, and the hour keeps its place). */
    resetSession() {
        const {
            time, spin, flow, flutter, levelPlace, boltTick, meteorTick,
        } = this;
        this.resetState(time);
        // The wheel eases back to the first level's place; it does not jump.
        Object.assign(this, {
            spin, flow, flutter, levelPlace, boltTick, meteorTick,
        });
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

    // ── The giant's place in the frame ──────────────────────────────────────────

    /** The rest camera for the current aspect (what the composition is measured in). */
    restCamera() {
        const cam = this._rest;
        cam.fov = fovForAspect(this.aspect);
        cam.aspect = this.aspect;
        cam.near = REST_RIG.near;
        cam.far = REST_RIG.far;
        cam.updateProjectionMatrix();
        cam.position.copy(this._home);
        cam.quaternion.copy(this._q);
        cam.updateMatrixWorld();
        return cam;
    }

    /**
     * Stand the camera where the composition wants the giant for this aspect: at the distance
     * that gives it its size, at its height over the ring plane, turned so the giant's centre
     * falls on its anchor and its axis leans as asked. Then hang the moons.
     */
    compose() {
        const { u } = this;
        const a = giantAnchors(this.aspect);
        this.anchors = a;
        const tanV = Math.tan((fovForAspect(this.aspect) * DEG) / 2);
        const tanH = tanV * this.aspect;
        this.distance = 1 / Math.sin(Math.atan(a.radius * 2 * tanV));
        this._home.set(0, Math.sin(a.elevation), Math.cos(a.elevation)).multiplyScalar(this.distance);

        // The way to the giant in the world, and the world's "up" as the frame should see it there.
        const toGiant = this._a.copy(this._home).normalize().negate();
        const upW = this._b.set(0, 1, 0).addScaledVector(toGiant, -toGiant.y).normalize()
            .applyAxisAngle(toGiant, a.roll);
        const sideW = this._c.copy(toGiant).cross(upW).normalize();
        this._m.makeBasis(toGiant, upW, sideW);
        // The same three in the camera's own frame, for the pixel the giant is asked to stand on.
        const dc = new THREE.Vector3((a.x * 2 - 1) * tanH, (1 - a.y * 2) * tanV, -1).normalize();
        const upC = new THREE.Vector3(0, 1, 0).addScaledVector(dc, -dc.y).normalize();
        const sideC = new THREE.Vector3().copy(dc).cross(upC).normalize();
        this._n.makeBasis(dc, upC, sideC).transpose();
        this._m.multiply(this._n);
        this._q.setFromRotationMatrix(this._m);
        this._right.set(1, 0, 0).applyQuaternion(this._q);
        this._up.set(0, 1, 0).applyQuaternion(this._q);
        this._fwd.set(0, 0, -1).applyQuaternion(this._q);
        this.heart.x = a.x;
        this.heart.y = a.y;
        this.heartRadius = a.radius;
        if (!u) return;

        u.skyRight.value.copy(this._right);
        u.skyUp.value.copy(this._up);
        u.skyFwd.value.copy(this._fwd);
        u.skyScale.value = 1 / (2 * tanV);
        // The nebula's bank runs from the far side of the card (where the moons are) down
        // toward the giant; on an upright phone from below the card up to the giant.
        const m0 = a.moons[0];
        const half = this.aspect * 0.5;
        if (this.aspect >= 0.95) {
            u.skyBank.value.set((m0.x - 0.5) * this.aspect - 0.05, 0.5 - m0.y - 0.16, -half * 0.42, -0.34);
        } else {
            u.skyBank.value.set(half * 0.5, -0.36, -half * 0.4, 0.3);
        }
        const cam = this.restCamera();
        const moons = [u.moonA, u.moonB];
        for (let i = 0; i < 2; i++) {
            const m = a.moons[i];
            const dist = this.distance * (0.95 + m.depth);
            this._ray.set(m.x * 2 - 1, 1 - m.y * 2, 0.5).unproject(cam).sub(this._home).normalize();
            const along = this._ray.dot(this._fwd);
            const radius = (dist * along) * m.radius * 2 * tanV;
            moons[i].value.set(
                this._home.x + this._ray.x * dist,
                this._home.y + this._ray.y * dist,
                this._home.z + this._ray.z * dist,
                radius,
            );
        }
        // The icy moon vents away from the sun's side of the frame, a little toward the camera.
        u.plumeDir.value.copy(this._up).multiplyScalar(-0.86).addScaledVector(this._right, 0.34)
            .addScaledVector(this._fwd, -0.36)
            .normalize();
        this.ice?.setFrame(this._home, this._right, this._up, this._fwd, this.distance, tanV, this.aspect);
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const t = sim.time;
        // The staged gameplay is flushed between this and update(): it must carry this frame's time.
        this.time = t;
        const calm = this.reducedMotion ? 0 : 1;
        const fov = fovForAspect(this.aspect) - this.kick * 0.35 * calm;
        if (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        // Adrift: the view breathes by a fraction of a degree, and the pointer leans it, so the
        // near ice slides across the giant and the giant against the sky.
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        const swayX = (Math.sin(t * 0.057) * 0.012 + Math.sin(t * 0.026 + 1.3) * 0.008) * calm;
        const swayY = (Math.sin(t * 0.041 + 0.7) * 0.009 + Math.sin(t * 0.018) * 0.006) * calm;
        camera.position.copy(this._home)
            .addScaledVector(this._right, swayX + px * 0.05)
            .addScaledVector(this._up, swayY - py * 0.03);
        const yaw = (Math.sin(t * 0.034 + 2.1) * 0.004 - px * 0.011) * calm;
        const pitch = (Math.sin(t * 0.027) * 0.003 + py * 0.007) * calm;
        this._lean.setFromEuler(this._euler.set(pitch, yaw, Math.sin(t * 0.021) * 0.004 * calm, 'YXZ'));
        camera.quaternion.copy(this._q).multiply(this._lean);
        // The shared breath (shared/camera-breath.js) on top of the lean above, turning the
        // view only (the rig is turned, not aimed at the giant): off under reduced motion.
        applyCameraBreath(camera, t, { scale: this.reducedMotion ? 0 : 1 });
        camera.updateMatrixWorld();
        this._camera = camera;
    }

    /** The view ray through a screen point (fractions, y down), from the live camera. */
    screenRay(sx, sy, out = this._ray) {
        const camera = this._camera || this.restCamera();
        return out.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position).normalize();
    }

    /** True when the giant stands between the camera and a point `t` along a ray. */
    hidden(origin, ray, t) {
        const b = origin.dot(ray);
        const disc = b * b - (origin.lengthSq() - 1);
        if (disc <= 0 || -b <= 0) return false;
        return -b - Math.sqrt(disc) < t;
    }

    // ── Gameplay ────────────────────────────────────────────────────────────────

    /**
     * Where in the rings a lock lands. The rings straight behind a piece are behind the card, so
     * the board is laid over the arc of the rings that shows, the near one that sweeps in front
     * of the giant: the piece's column (`u`, 0..1) chooses the bearing along that arc, left to
     * right as on the board, and its row how far out from the giant, the floor outermost (which
     * is lowest on screen).
     */
    pickRingSite(u, row, salt = 0, out = this._site) {
        const origin = (this._camera || this.restCamera()).position;
        const rand = mulberry32(0x9e37 + (this.counts.locks + 1) * 2654435761 + salt * 977);
        // The bearing of the camera from the giant is the arc's nearest point; the card hides
        // the arc further round to the right than to the left.
        const bearing = Math.atan2(origin.x, origin.z) + lerp(-0.7, 0.6, clamp01(u)) + (rand() - 0.5) * 0.06;
        const depth = clamp01(row / (BOARD_GRID.rows - 1));
        let r = lerp(RINGS.bInner + 0.07, RINGS.aOuter - 0.04, depth);
        // Keep it on ice that can carry the light: step off a gap or the division.
        for (let i = 0; i < 5 && ringTau(this.ringProfile, r) < 0.35; i++) r += (rand() - 0.35) * 0.08;
        r = Math.max(RINGS.bInner + 0.04, Math.min(RINGS.aOuter - 0.03, r));
        out.x = Math.sin(bearing) * r;
        out.z = Math.cos(bearing) * r;
        out.r = r;
        return out;
    }

    /** The board row/column of an event as a screen point (fractions, y down). */
    eventPoint(c, row) {
        if (c.screen) {
            this._point.x = c.screen.x;
            this._point.y = c.screen.y;
            return this._point;
        }
        const board = boardFor(this.layout, c.player) || fallbackLayout(this.aspect * 1000, 1000).boards[0];
        return boardPoint(board, c.u ?? 0.5, row, this._point);
    }

    /** The longitude (sky frame) of the giant's limb on the card's side: where a jet starts. */
    jetStart() {
        const camera = this._camera || this.restCamera();
        const toCam = this._a.copy(camera.position).normalize();
        const p = this._b.copy(this._right).multiplyScalar(0.92).addScaledVector(toCam, 0.39);
        return Math.atan2(p.z, p.x);
    }

    schedule(time, kind, data = null) {
        // A replaced visual cannot leave unbounded delayed work behind during a burst.
        if (this.queue.length >= MAX_TIMED_MOMENTS) this.queue.shift();
        this.queue.push({ time, kind, data });
    }

    /** Fire the moments the clock has reached. */
    drain(t) {
        const { queue } = this;
        for (let i = queue.length - 1; i >= 0; i--) {
            if (queue[i].time > t) continue;
            const [{ time, kind, data }] = queue.splice(i, 1);
            if (kind === 'splash') this.sparks?.burst(data.x, 0, data.z, data.rgb, data.amount, time, this.counts.locks);
            else if (kind === 'strike') this.strikeAt(data, time);
        }
    }

    /** A lock: `c` = { player, rows, u, hardDrop, color, screen }. */
    onLock(c) {
        if (!this.u) return;
        const t = this.time;
        const rows = c.rows?.length ? c.rows : [BOARD_GRID.rows - 1];
        let mean = 0;
        for (let i = 0; i < rows.length; i++) mean += rows[i];
        mean /= rows.length;
        const from = this.eventPoint(c, mean);
        const fx = from.x;
        const fy = from.y;
        const rgb = pieceColor(c.color);
        this._lastColor[0] = rgb[0];
        this._lastColor[1] = rgb[1];
        this._lastColor[2] = rgb[2];
        const hard = c.hardDrop === true;
        const site = this.pickRingSite(c.screen ? fx : (c.u ?? 0.5), c.screen ? fy * (BOARD_GRID.rows - 1) : mean, 0);
        const land = t + MOTE_FLIGHT;
        const ripple = this.ripples.take(land);
        ripple.x = site.x;
        ripple.z = site.z;
        ripple.strength = (hard ? 1.7 : 1.0) * (this.reducedMotion ? 0.4 : 1);
        ripple.omega = ringOmega(site.r);
        ripple.rgb[0] = rgb[0];
        ripple.rgb[1] = rgb[1];
        ripple.rgb[2] = rgb[2];
        // The mote that carries it from the card to the rings.
        const camera = this._camera || this.restCamera();
        const ray = this.screenRay(fx, fy);
        const reach = Math.hypot(site.x - camera.position.x, camera.position.y, site.z - camera.position.z);
        this._a.copy(camera.position).addScaledVector(ray, reach * 0.5);
        if (!this.reducedMotion) {
            this.meteors?.launch({
                from: this._a,
                to: this._b.set(site.x, 0, site.z),
                birth: t,
                flight: MOTE_FLIGHT,
                rgb,
                size: hard ? 1.5 : 1.0,
                mote: true,
            });
        }
        this.schedule(land, 'splash', {
            x: site.x, z: site.z, rgb, amount: (hard ? 1.0 : 0.5) * (this.reducedMotion ? 0.2 : 1),
        });
        if (hard && !this.reducedMotion) this.kick = Math.min(1, this.kick + 0.3);
        this.counts.locks += 1;
    }

    /** A bounded ring front; future births provide echoes without timers or new geometry. */
    ringChime(time, strength, fronts, arms, rgb) {
        const chime = this.chimes.take(time);
        chime.strength = strength * (this.reducedMotion ? 0.45 : 1);
        chime.fronts = fronts;
        chime.arms = arms;
        chime.rgb = [...rgb];
    }

    // ── Flourishes ──────────────────────────────────────────────────────────────

    /** Drop every flourish in play (a new run, a seek, reduced motion switched on). */
    retireFlourishes() {
        if (!this.flourish) return;
        Object.keys(this.flourish).forEach((key) => Object.assign(this.flourish[key], idleFlourish()));
        FLOURISH_KINDS.forEach((kind) => { this.flourishes[kind] = 0; });
        this.crownBoost = 0;
    }

    /** Start the flourish `key` (cyclone, surge, strand, shock), counted under `kind`. */
    flourishAt(key, kind, time, power, rgb, extra = {}) {
        const f = this.flourish[key];
        Object.assign(f, idleFlourish(), extra);
        f.birth = time;
        f.power = power * (this.reducedMotion ? 0.4 : 1);
        f.rgb = [...rgb];
        this.flourishes[kind] += 1;
        return f;
    }

    /** A chain's surge round the rings, from the bearing that faces the camera. */
    surgeAt(time, kind, power, tall, rgb) {
        const camera = this._camera || this.restCamera();
        this.flourishAt('surge', kind, time, power, rgb, {
            lon: Math.atan2(camera.position.z, camera.position.x),
            tall: tall * (this.reducedMotion ? 0.3 : 1),
        });
    }

    /** A T-spin's cyclone, wound into the cloud somewhere on the day side the camera sees. */
    cycloneAt(time, power, rgb, seed) {
        const rand = mulberry32(0xc1c1 + seed * 7919);
        const camera = this._camera || this.restCamera();
        const sun = this.u.sunDir.value;
        const toCam = this._a.copy(camera.position).normalize();
        let lon = Math.atan2(toCam.z, toCam.x);
        let lat = 0.3;
        for (let i = 0; i < 16; i++) {
            lat = lerp(-0.12, 0.72, rand());
            lon = Math.atan2(toCam.z, toCam.x) + (rand() - 0.62) * 1.5;
            const c = Math.cos(lat);
            const p = this._b.set(c * Math.cos(lon), Math.sin(lat), c * Math.sin(lon));
            if (p.dot(sun) > 0.3 && p.dot(toCam) > 0.6) break;
        }
        // Stored in the giant's own frame, so the storm rides round with the cloud.
        this.flourishAt('cyclone', 'cyclone', time, power, rgb, {
            lon: lon + this.spin, lat, dir: rand() < 0.5 ? -1 : 1,
        });
    }

    /** A shell of light thrown off the giant. */
    shockAt(time, power, rgb) {
        this.flourishAt('shock', 'shock', time, power, rgb);
    }

    /** Celebrate a threshold once per player's chain, even across multiple cascade waves. */
    comboMilestone(player, combo, time, rgb) {
        const id = Number.isFinite(player) ? player : 0;
        const chain = this.chains.find((entry) => entry.player === id)
            || this.chains.find((entry) => entry.player === null);
        if (!chain) return;
        chain.player = id;
        if (combo < chain.combo) chain.milestone = 0;
        chain.combo = combo;
        let tier = 0;
        for (let i = 0; i < COMBO_MILESTONES.length; i++) {
            if (combo >= COMBO_MILESTONES[i]) tier = i + 1;
        }
        if (tier <= chain.milestone) return;
        chain.milestone = tier;
        const { power, tall } = MILESTONE_SURGES[tier - 1];
        // The highest milestone crowns the chain: the inner oval blazes and a shell of light
        // leaves the giant in the chain's colour.
        const crown = tier === COMBO_MILESTONES.length;
        this.surgeAt(time + 0.08, crown ? 'crown' : 'surge', power, tall, rgb);
        if (crown) {
            this.crownBoost = this.reducedMotion ? 0.3 : 1;
            this.shockAt(time + 0.12, 0.6, rgb);
        }
        this.counts.milestones += 1;
    }

    /** A clear: `c` = { player, rows, lines, combo, cascade, tspin, perfect, b2b, color, screen }. */
    onClear(c) {
        if (!this.u) return;
        const t = this.time;
        const lines = Math.max(0, Math.min(4, Math.trunc(Number(c.lines ?? 1) || 0)));
        const tspin = c.tspin === true;
        const perfect = c.perfect === true;
        if (lines === 0 && !tspin && !perfect) return;
        const quad = lines >= 4;
        const combo = Math.max(0, Math.trunc(Number(c.combo) || 0));
        const cascade = Math.max(1, Math.min(4, Math.trunc(Number(c.cascade) || 1)));
        const calm = this.reducedMotion;
        const rgb = c.color ? pieceColor(c.color) : [...this._lastColor];
        const pale = rgb.map((v) => lerp(v, 1, 0.35));
        const seed = this.seed + this.counts.clears * 977 + this.counts.tspins * 131;

        // A clear sends fronts across the rings; a spin winds a spiral through them and a
        // cyclone into the cloud (a zero-line spin too, more gently).
        if (lines > 0) this.ringChime(t, 0.7 + lines * 0.2 + (quad ? 0.25 : 0), lines, 0, pale);
        if (tspin) {
            this.ringChime(t + 0.05, lines > 0 ? 1.1 : 0.7, 1, 2, rgb);
            this.cycloneAt(t, lines > 0 ? 1.0 : 0.7, rgb, seed + 11);
            this.counts.tspins += 1;
        }

        // Every cleared row is written round the giant on its own latitude.
        const rows = c.rows?.length ? c.rows.slice(0, lines) : [];
        if (lines > 0 && rows.length === 0) rows.push(BOARD_GRID.rows - 1);
        const start = this.jetStart();
        for (let i = 0; i < rows.length; i++) {
            const jet = this.jets.take(t + i * 0.07);
            jet.lat = rowLatitude(rows[i]);
            jet.strength = (0.8 + lines * 0.15) * (calm ? 0.4 : 1);
            jet.lon = start;
            jet.rgb = [...rgb];
        }
        // Lightning answers under the cloud, and the rings flare.
        const bolts = calm ? Math.min(1, lines) : lines * 2 + (quad ? 4 : 0);
        for (let i = 0; i < bolts; i++) this.throwBolt(t + i * 0.09, seed + i, rows[i % rows.length]);
        this.surge = Math.min(1.4, this.surge + (0.3 + lines * 0.14 + (quad ? 0.4 : 0)) * (calm ? 0.4 : 1));
        for (let i = 0; i < 3; i++) this._accentTarget[i] = rgb[i];

        // Cascades echo in time. They never raise the true consecutive-clear combo tier.
        const echoes = lines > 0 ? Math.min(calm ? 1 : 2, cascade - 1) : 0;
        for (let i = 0; i < echoes; i++) {
            this.ringChime(t + 0.24 + i * 0.24, 0.55 + i * 0.12, 1, 0, rgb);
        }
        if (echoes > 0) this.counts.cascades += 1;
        if (lines > 0) this.comboMilestone(c.player, combo, t, rgb);

        // A difficult clear sets the rings' outer strand ablaze, a beat after the clear itself.
        if (c.b2b && lines > 0) {
            this.flourishAt('strand', 'strand', t + 0.3, 1.0, pale, { seed: (seed % 1000) * 0.37 });
            this.counts.b2b += 1;
        }
        // A perfect clear is the giant's whole answer in gold: light racing round the rings, a corona
        // of light thrown off, the strand ablaze. It is not counted as a four-line clear.
        if (perfect) {
            const gold = [lerp(rgb[0], 1, 0.65), lerp(rgb[1], 0.9, 0.65), lerp(rgb[2], 0.55, 0.65)];
            this.surgeAt(t + 0.1, 'crown', 1.4, 1.2, gold);
            this.crownBoost = calm ? 0.3 : 1;
            this.shockAt(t + 0.05, 1.25, gold);
            this.flourishAt('strand', 'strand', t + 0.35, 1.2, gold, { seed: (seed % 1000) * 0.53 });
            this.vent = Math.max(this.vent, calm ? 0.2 : 0.7);
            this.counts.perfects += 1;
        } else if (quad) {
            // Four lines throw a shell of light off the giant in the piece's colour.
            this.shockAt(t + 0.05, 0.7, pale);
        }

        // Varying approach bearings keep the meteor rewards from looking like the same salvo.
        const chainFall = lines > 0 ? Math.max(0, Math.min(3, Math.floor((combo - 1) / 2))) : 0;
        const fall = calm ? 0
            : Math.min(8, (quad ? 7 : Math.max(0, lines - 2) + chainFall) + echoes + (perfect ? 2 : 0));
        for (let i = 0; i < fall; i++) {
            this.throwMeteor(t + 0.12 + i * (quad ? 0.13 : 0.2), seed + i, rgb, quad ? 1.2 : 0.8);
        }
        if (quad) {
            this.vent = calm ? 0.3 : 1;
            this.counts.quads += 1;
        }
        if (!calm) {
            this.flash = Math.min(1, this.flash + 0.16 + lines * 0.07 + (quad || perfect ? 0.18 : 0));
            this.kick = Math.min(1, this.kick + 0.08 + lines * 0.08);
        }
        if (lines > 0) this.counts.clears += 1;
    }

    /** The chain the board is holding (0 = it broke). Only clears trigger milestone bursts. */
    onCombo(combo) {
        this.combo = Math.max(0, combo | 0);
        if (this.combo === 0) {
            this.chains.forEach((chain) => {
                chain.combo = 0;
                chain.milestone = 0;
            });
        }
    }

    /** A point on the giant's visible night side: (longitude in the sky frame, latitude). */
    nightSite(rand, row = -1, out = this._point) {
        const camera = this._camera || this.restCamera();
        const sun = this.u.sunDir.value;
        const toCam = this._a.copy(camera.position).normalize();
        let lon = 0;
        let lat = 0;
        for (let i = 0; i < 12; i++) {
            lat = row >= 0 && i < 6 ? rowLatitude(row) + (rand() - 0.5) * 0.1 : (rand() - 0.42) * 1.7;
            lon = Math.atan2(toCam.z, toCam.x) + (rand() - 0.5) * 2.6;
            const c = Math.cos(lat);
            const p = this._b.set(c * Math.cos(lon), Math.sin(lat), c * Math.sin(lon));
            if (p.dot(sun) < -0.06 && p.dot(toCam) > 0.22) break;
        }
        out.x = lon;
        out.y = lat;
        return out;
    }

    /** A flash of lightning under the night side's cloud. */
    throwBolt(time, salt, row = -1) {
        const rand = mulberry32(0xb017 + salt * 7919);
        const site = this.nightSite(rand, row);
        const bolt = this.bolts.take(time);
        // Stored in the giant's own frame, so the storm rides round with the cloud.
        bolt.lon = site.x + this.spin;
        bolt.lat = site.y;
        bolt.strength = (0.35 + rand() * 0.55) * (this.reducedMotion ? 0.2 : 1);
        bolt.size = 0.012 + rand() * 0.02;
        bolt.seed = rand();
        this.counts.bolts += 1;
    }

    /** A meteor: it crosses the sky and burns into the cloud tops. */
    throwMeteor(time, salt, rgb, strength = 0.8) {
        if (!this.meteors) return;
        const rand = mulberry32(this.seed + 0x3e7e + salt * 104729);
        const camera = this._camera || this.restCamera();
        const toCam = this._a.copy(camera.position).normalize();
        // Where it strikes: anywhere on the face the camera sees.
        const lat = (rand() - 0.28) * 1.3;
        const lon = Math.atan2(toCam.z, toCam.x) + (rand() - 0.5) * 2.0;
        const c = Math.cos(lat);
        const to = this._b.set(c * Math.cos(lon), Math.sin(lat), c * Math.sin(lon));
        // Fan in from either upper quarter or steeply overhead, chosen by the event seed.
        const bearing = lerp(0.22, Math.PI - 0.22, rand());
        const reach = 1.5 + rand() * 1.1;
        const from = this._c.copy(to).multiplyScalar(1.02)
            .addScaledVector(this._right, Math.cos(bearing) * reach)
            .addScaledVector(this._up, Math.sin(bearing) * reach)
            .addScaledVector(toCam, 0.3 + rand() * 0.8);
        const flight = 0.5 + rand() * 0.3;
        // Which way it crosses the cloud where it strikes (east and north there): its ejecta are
        // thrown downrange.
        const way = this._ray.copy(to).sub(from);
        const east = way.x * -Math.sin(lon) + way.z * Math.cos(lon);
        const north = -way.x * Math.sin(lat) * Math.cos(lon) + way.y * c - way.z * Math.sin(lat) * Math.sin(lon);
        this.meteors.launch({
            from, to, birth: time, flight, rgb, size: strength, mote: false,
        });
        this.schedule(time + flight, 'strike', {
            lon, lat, rgb: [...rgb], strength, bearing: Math.atan2(north, east),
        });
        this.counts.meteors += 1;
    }

    strikeAt(data, time) {
        const strike = this.strikes.take(time);
        strike.lon = data.lon + this.spin;
        strike.lat = data.lat;
        strike.strength = data.strength;
        strike.bearing = data.bearing;
        strike.rgb = data.rgb;
        if (!this.reducedMotion) this.flash = Math.min(1, this.flash + 0.05);
    }

    /** A new level: the hour turns one palette on. `silent` = a rebuilt scene taking it up. */
    levelUp(level, { silent = false } = {}) {
        const next = Math.max(1, Math.round(Number(level) || 1));
        const rose = next > this.level;
        this.level = next;
        if (silent) {
            this.levelPlace = next - 1;
            this.applyPalette();
            return;
        }
        if (!rose) return;
        // The new hour is rung in: one clear front through the rings in the star's own colour.
        const chime = this.chimes.take(this.time);
        chime.strength = this.reducedMotion ? 0.45 : 1.2;
        chime.fronts = 2;
        chime.arms = 0;
        chime.rgb = [1.0, 0.94, 0.82];
        // ...and a soft shell of the star's own light leaves the giant.
        this.shockAt(this.time, 0.55, [1.0, 0.92, 0.78]);
        this.surge = Math.min(1.4, this.surge + (this.reducedMotion ? 0.2 : 0.5));
        if (!this.reducedMotion) this.flash = Math.min(1, this.flash + 0.3);
    }

    /** Set every palette colour, the bands' place and the sun for where the wheel stands. */
    applyPalette() {
        const { u } = this;
        if (!u) return;
        this.place = palettePlace(this.levelPlace, this.time);
        const pal = paletteAt(this.place, this._palette);
        for (let i = 0; i < PALETTE_KEYS.length; i++) {
            const key = PALETTE_KEYS[i];
            u[key].value.set(pal[key][0], pal[key][1], pal[key][2]);
        }
        const { index, next, mix } = palettePhase(this.place);
        for (let c = 0; c < 3; c++) {
            this._shine[c] = lerp(PALETTES[index].zoneB[c], PALETTES[next].zoneB[c], mix) * pal.sun[c];
        }
        u.shine.value.set(this._shine[0], this._shine[1], this._shine[2]);
        u.bandPlace.value = bandPlace(this.place);
        sunDirection(this.place, this._sun);
        u.sunDir.value.set(this._sun[0], this._sun[1], this._sun[2]);
    }

    /** The giant's own weather: lightning now and then, and a meteor every so often. */
    ambient(t) {
        const tick = Math.floor(t / BOLT_TICK);
        if (tick !== this.boltTick) {
            // One tick per frame at most: a long pause must not release a salvo.
            this.boltTick = tick;
            const rand = mulberry32(0x5f3 + tick * 2654435761);
            const chance = 0.2 + chainHeat(this.combo) * 0.55;
            if (rand() < chance) this.throwBolt(t, 0x4000 + tick);
        }
        const beat = Math.floor(t / METEOR_PERIOD);
        if (beat !== this.meteorTick) {
            this.meteorTick = beat;
            if (!this.reducedMotion) this.throwMeteor(t + 0.4, 0x8000 + beat, [0.86, 0.94, 1.0], 0.55);
        }
    }

    update(sim, camera = this._camera) {
        const { u } = this;
        if (!u || this.disposed) return;
        const t = sim.time;
        const dt = Math.max(0, Math.min(0.1, sim.delta || 0));
        this.time = t;
        if (camera) this._camera = camera;
        const motion = this.reducedMotion ? 0.3 : 1;

        this.ambient(t);
        this.drain(t);

        // The slow clocks.
        const heat = chainHeat(this.combo);
        this.spin += dt * SPIN_RATE * motion;
        this.flow += (dt / GIANT.flowCycle) * motion;
        this.flutter += dt * (0.6 + heat * 1.6 + this.surge * 1.4) * motion;

        // The hour: the level's place is eased, the clock's is not.
        const target = this.level - 1;
        this.levelPlace += (target - this.levelPlace) * approach(PLACE_RATE, dt);
        if (Math.abs(target - this.levelPlace) < 1e-4) this.levelPlace = target;
        this.applyPalette();

        // The chain.
        // The inner oval: lit by a long chain, and blazing for a while after a crown.
        this.crownBoost *= Math.exp(-dt / 2.4);
        this.crown += (Math.max(smooth(3.5, 8, this.combo), this.crownBoost) - this.crown) * approach(1.2, dt);
        this.hum += (heat - this.hum) * approach(1.4, dt);
        this.surge *= Math.exp(-dt / SURGE_FADE);
        this.vent *= Math.exp(-dt / VENT_FADE);
        this.flash *= Math.exp(-dt * 3.2);
        this.kick *= Math.exp(-dt * 4.5);
        for (let c = 0; c < 3; c++) this._accent[c] += (this._accentTarget[c] - this._accent[c]) * approach(2.2, dt);

        u.time.value = t;
        u.spin.value = this.spin % TAU;
        u.flow.value = this.flow;
        // The chain's glow: the rings hum, their spokes stand out, more so under a crown.
        u.ringGlow.value.set(
            this.hum + this.surge * 0.35 + this.crown * 0.25,
            0.5 + this.hum * 0.6 + this.crown * 0.4,
            this.flutter,
            this.crown,
        );
        u.accent.value.set(this._accent[0], this._accent[1], this._accent[2]);
        u.plume.value = VENT_REST * (0.8 + 0.2 * Math.sin(t * 0.23)) + this.vent * 0.9 + this.surge * 0.12;

        // The event table: live rows compacted to the front of each block.
        const rows = u.events.array;
        const nRipples = this.ripples.flush(t, (e, i) => {
            rows[EVENT_ROWS.ripple + i * 2].set(e.x, e.z, e.birth, e.strength);
            rows[EVENT_ROWS.ripple + i * 2 + 1].set(e.rgb[0], e.rgb[1], e.rgb[2], e.omega);
        });
        const nChimes = this.chimes.flush(t, (e, i) => {
            rows[EVENT_ROWS.chime + i * 2].set(e.birth, e.strength, e.fronts, e.arms);
            rows[EVENT_ROWS.chime + i * 2 + 1].set(e.rgb[0], e.rgb[1], e.rgb[2], 0);
        });
        const nJets = this.jets.flush(t, (e, i) => {
            rows[EVENT_ROWS.jet + i * 2].set(e.lat, e.birth, e.strength, e.lon);
            rows[EVENT_ROWS.jet + i * 2 + 1].set(e.rgb[0], e.rgb[1], e.rgb[2], 0);
        });
        const nStrikes = this.strikes.flush(t, (e, i) => {
            rows[EVENT_ROWS.strike + i * 2].set(e.lon, e.lat, e.birth, e.strength);
            rows[EVENT_ROWS.strike + i * 2 + 1].set(e.rgb[0], e.rgb[1], e.rgb[2], e.bearing);
        });
        const nBolts = this.bolts.flush(t, (e, i) => {
            // A bolt stutters: a hard first stroke, then two fainter returns.
            const age = t - e.birth;
            let now = 0;
            if (age >= 0) {
                now = Math.exp(-age / 0.07)
                    + 0.6 * Math.exp(-(((age - 0.17 - e.seed * 0.06) / 0.035) ** 2))
                    + 0.35 * Math.exp(-(((age - 0.36 - e.seed * 0.1) / 0.05) ** 2));
            }
            rows[EVENT_ROWS.bolt + i * 2].set(e.lon, e.lat, e.birth, now * e.strength * 2.6);
            rows[EVENT_ROWS.bolt + i * 2 + 1].set(e.size, e.seed, 0, 0);
        });
        u.counts.value.set(nRipples, nChimes, nJets, nStrikes);
        u.bolts.value = nBolts;
        this.writeFlourishes(t);

        // The camera, as the full-screen pass traces it.
        const cam = this._camera;
        if (cam) {
            u.camPos.value.copy(cam.position);
            const e = cam.matrixWorld.elements;
            u.camRight.value.set(e[0], e[1], e[2]);
            u.camUp.value.set(e[4], e[5], e[6]);
            u.camFwd.value.set(-e[8], -e[9], -e[10]);
            const tanV = Math.tan((cam.fov * DEG) / 2);
            u.tanHalf.value.set(tanV * cam.aspect, tanV);
        }

        this.ice?.update(t, dt, motion);
        this.sparks?.update(t);
        this.meteors?.update(t);
        this.heads?.update(t);

        // What the post needs: where the giant is on screen now.
        if (cam) {
            this._a.set(0, 0, 0).project(cam);
            this.heart.x = this._a.x * 0.5 + 0.5;
            this.heart.y = 0.5 - this._a.y * 0.5;
        }
        const post = this._post;
        post.heartRadius = this.heartRadius;
        post.flash = this.reducedMotion ? 0 : this.flash;
        post.kick = this.reducedMotion ? 0 : this.kick;
        post.bloomBoost = clamp01(this.surge * 0.5 + this.hum * 0.3);
    }

    /** The flourishes in play, as the full-screen pass reads them. */
    writeFlourishes(t) {
        const { u, flourish } = this;
        const {
            cyclone, surge, strand, shock,
        } = flourish;
        u.cyclone.value.set(cyclone.lon, cyclone.lat, cyclone.birth, cyclone.power);
        u.cycloneTint.value.set(cyclone.rgb[0], cyclone.rgb[1], cyclone.rgb[2], cyclone.dir);
        // The surge is laid out here: how far round it has run, and how strong it still is.
        const age = t - surge.birth;
        if (age >= 0 && age < SURGE_LIFE) {
            const env = smooth(0, 0.15, age) * Math.exp(-age * 0.7);
            const tall = surge.tall * smooth(0, 0.4, age) * (1 - smooth(SURGE_LIFE * 0.45, SURGE_LIFE, age));
            u.surge.value.set(surge.lon, age * SURGE_SPEED, env * surge.power, tall);
            u.surgeTint.value.set(surge.rgb[0], surge.rgb[1], surge.rgb[2]);
        } else {
            u.surge.value.set(0, 0, 0, 0);
        }
        u.strand.value.set(strand.birth, strand.power, strand.seed, 0);
        u.strandTint.value.set(strand.rgb[0], strand.rgb[1], strand.rgb[2]);
        u.shock.value.set(shock.birth, shock.power, 0, 0);
        u.shockTint.value.set(shock.rgb[0], shock.rgb[1], shock.rgb[2]);
    }

    /** What is in play of each flourish at `time`, and how many of each have been played. */
    flourishState(time = this.time) {
        const lives = {
            cyclone: CYCLONE_LIFE, surge: SURGE_LIFE, strand: STRAND_LIFE, shock: SHOCK_LIFE,
        };
        const active = Object.keys(lives).filter((key) => {
            const age = time - this.flourish[key].birth;
            return age >= 0 && age < lives[key];
        });
        return { active, played: { ...this.flourishes } };
    }

    getPostState() {
        return this._post;
    }

    getState() {
        const phase = palettePhase(this.place);
        return {
            time: this.time,
            quality: this.quality,
            level: this.level,
            combo: this.combo,
            palette: paletteName(this.place),
            paletteNext: PALETTES[phase.next].name,
            paletteMix: Number(phase.mix.toFixed(3)),
            place: Number(this.place.toFixed(3)),
            glow: Number((this.hum + this.surge * 0.35 + this.crown * 0.25).toFixed(3)),
            heart: { x: Number(this.heart.x.toFixed(4)), y: Number(this.heart.y.toFixed(4)) },
            heartRadius: this.heartRadius,
            distance: Number(this.distance.toFixed(3)),
            sun: this._sun.map((v) => Number(v.toFixed(3))),
            live: this.u ? {
                ripples: this.u.counts.value.x,
                chimes: this.u.counts.value.y,
                jets: this.u.counts.value.z,
                strikes: this.u.counts.value.w,
                bolts: this.u.bolts.value,
            } : null,
            counts: { ...this.counts },
            flourishes: this.flourishState(this.time),
            queued: this.queue.length,
            parts: Object.keys(this.parts).filter((name) => this.parts[name].mesh.visible),
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.root.removeFromParent();
        this.disposables.forEach((part) => {
            part.geometry?.dispose();
            part.material?.dispose();
            part.dispose?.();
        });
        this.textures.forEach((tex) => tex.dispose());
        this.disposables.length = 0;
        this.textures.length = 0;
        this.parts = {};
        this.root.clear();
        this.u = null;
    }
}

export { PARTS as STELLAR_DRIFT_PARTS };
