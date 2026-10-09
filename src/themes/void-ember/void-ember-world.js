/**
 * Void Ember — the world.
 *
 * Owns the shared uniforms, every scene part, the camera rig and the choreography. Shared by the
 * theme (void-ember-theme.js) and the playground effect
 * (src/playground/effects/void-ember.effect.js), so what is iterated there ships.
 *
 * A dying star hangs in an empty sky, left of the board: a banked coal, most of its face a dark
 * crust with fire in the cracks. A belt of cinders circles it, almost edge-on, and one dead
 * world stands far off, backlit. Nothing else gives light here. The board blows on the ember:
 *
 *   lock     the piece is fuel. It leaves the card as a comet in its own colour and falls into
 *            the star at its own height: a flash, a ripple that runs out over the photosphere,
 *            sparks, and a loop of plasma that rises where it struck and burns in that colour —
 *            every element its own flame. The star holds the loop for half a minute while the
 *            colour burns off into its own fire. Every lock stokes it a little. A hard drop
 *            throws three and hits harder.
 *   clear    the star lets go. The cleared rows leave the card as blades of light, a shell of
 *            plasma leaves the star toward the board (one front per line) in the colours it was
 *            holding, and every held loop is torn off and flies out as an expanding arc. The
 *            wave crosses the dust, shoves the belt's stones and leaves fire in their cracks.
 *            The more the player has fed the star, the more a clear sets off.
 *   combo    the ember is blown on: each step of a chain heats it — the crust breaks up, the
 *            cells under it go from red through gold to white, the corona reaches further, the
 *            wind streams faster, and everything it lights brightens with it.
 *   four     the star holds its breath — every light sinks for a quarter of a second — then
 *            flares: a full shell crosses the frame, every loop is torn off at once, space
 *            ripples, and the ember stands white-gold for a few seconds.
 *   T-spin   the star spins up: the corona and the wind wind into a pinwheel and spring back.
 *   level    the void moves one palette along its line of five, and a cold ring crosses it.
 *   time     by itself, with no level change, the void drifts along the same line: one palette
 *            every PALETTE_STEP seconds, there and back. The two simply add.
 *
 * Everything is a function of the world clock and event timestamps (nothing is created at event
 * time), so seek(t) plus a fixed-step replay reproduces any frame.
 */

import * as THREE from 'three/webgpu';
import {
    AMBIENT_LOOPS,
    COMET_FLIGHT,
    DEG,
    EMBER,
    HUSH_HOLD,
    IMPACT_SLOTS,
    LOCK_LOOPS,
    LOOP_SLOTS,
    NOVAFIRE,
    PALETTE_HOME,
    PALETTE_KEYS,
    REST_HEAT,
    TAU,
    VOID_PALETTES,
    WAVE_LIVE,
    WAVE_SLOTS,
    approach,
    bakeFbm,
    bakeLattice,
    clamp01,
    createFbmTexture,
    createLatticeTexture,
    createVoidEmberUniforms,
    emberAnchors,
    emberColor,
    heatForCombo,
    mulberry32,
    paletteAt,
    paletteName,
    palettePhase,
    palettePlace,
    pieceColor,
    smooth,
} from './void-ember-tsl.js';
import { tierFor } from './void-ember-quality.js';
import { createCorona, createPhotosphere } from './void-ember-star.js';
import { createLoops, loopSparkShare } from './void-ember-loops.js';
import {
    ROCK_CLASSES, createCinderWorld, createDustRing, createRocks,
} from './void-ember-belt.js';
import { createSky } from './void-ember-sky.js';
import {
    createComets, createEmberWind, createRowBeams, createShells, createSparks,
} from './void-ember-fx.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './void-ember-composition.js';

/** The rest camera: a long lens, so the star keeps its roundness off-centre. */
export const REST_RIG = Object.freeze({
    /** Horizontal field of view the rig holds; the vertical one follows the aspect, clamped. */
    hFov: 50,
    minFov: 24,
    maxFov: 58,
    near: 0.5,
    far: 4000,
});

/** Vertical field of view (degrees) for an aspect ratio. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((REST_RIG.hFov * DEG) / 2) / a)) / DEG;
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, v));
}

/** The star's own turn at rest, radians per second. */
export const SPIN_RATE = TAU / EMBER.spinPeriod;
/** Seconds the overdrive after a four-line clear takes to cool to 1/e. */
export const SURGE_COOL = 3.6;
/** Seconds the stoking a lock gives takes to fade to 1/e, and the most it adds to the heat. */
export const STOKE_COOL = 7;
export const STOKE_MAX = 0.12;
/** The hottest the ember gets: white-gold, in the first seconds after a four-line clear. */
export const HEAT_FLARE = 1.04;
/** The pinwheel's spring: how hard it pulls back and how fast it settles. */
const TWIST_STIFFNESS = 26;
const TWIST_DAMPING = 4.6;
/** The space ripple a four-line clear sends through the picture: screen heights per second. */
const RIPPLE_SPEED = 0.8;
/** How far along the view ray (as a fraction of the star's distance) a comet leaves the card. */
const COMET_DEPTH = 0.62;
/** The cinder world stands this fraction of the star's distance from the camera. */
const WORLD_DEPTH = 0.45;
/** The star's own prominences: seconds between two of one slot's, and its first loop's delay. */
const AMBIENT_PERIOD = 31;
/** Seconds before its slot is raised again that one of them lifts off the star. */
const AMBIENT_LEAVE = 2.4;
const AMBIENT_COLOR = Object.freeze([1.0, 0.27, 0.035]);

const PARTS = [
    'star', 'world', 'boulders', 'stones', 'gravel', 'sky', 'ring', 'corona', 'loops', 'wind', 'sparks', 'comets',
    'shells', 'beams',
];

export class VoidEmberWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {THREE.WebGPURenderer} [params.renderer]
     * @param {boolean} [params.capture=false]  deterministic captures: no wall-clock anywhere
     * @param {number} [params.seed]
     */
    constructor({
        scene, quality = 'High', renderer = null, capture = false, seed = 0x5eed,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.renderer = renderer;
        this.capture = capture;
        this.seed = seed;
        this.root = new THREE.Group();
        this.root.name = 'VoidEmber';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.star = null;
        this.corona = null;
        this.loops = null;
        this.wind = null;
        this.sparks = null;
        this.comets = null;
        this.beams = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        /** The star on screen (fractions, y down), and its radius in screen heights. */
        this.heart = { x: 0.22, y: 0.5 };
        this.heartRadius = 0.29;
        this.anchors = emberAnchors(this.aspect);
        this.distance = 60;
        this._camera = null;
        this._rest = new THREE.PerspectiveCamera(30, 16 / 9, REST_RIG.near, REST_RIG.far);
        this._centre = new THREE.Vector3(-30, 0, -60);
        this._f = new THREE.Vector3(0, 0, 1);
        this._right = new THREE.Vector3(1, 0, 0);
        this._up = new THREE.Vector3(0, 1, 0);
        this._axis = new THREE.Vector3(0, 1, 0);
        this._x = new THREE.Vector3();
        this._z = new THREE.Vector3();
        this._vec = new THREE.Vector3();
        this._ray = new THREE.Vector3();
        this._look = new THREE.Vector3();
        this._basis = new THREE.Matrix4();
        this._spin = new THREE.Matrix4();
        this._frame = new THREE.Matrix4();
        this._scale = new THREE.Vector3();
        this._m3 = new THREE.Matrix3();
        this._point = { x: 0.5, y: 0.5 };
        this._from = [0, 0, 0];
        this._site = [0, 0, 1];
        this._colour = [1, 0.3, 0.05];
        this._light = [1, 0.3, 0.05];
        this._ringPalette = {};
        this._palette = {};
        PALETTE_KEYS.forEach((key) => {
            this._palette[key] = [...VOID_PALETTES[PALETTE_HOME][key]];
        });
        this._post = {
            heart: this.heart,
            heartRadius: 0.29,
            flash: 0,
            kick: 0,
            rays: 0.1,
            streak: 0,
            haze: 0.2,
            bloomBoost: 0,
            exposure: 1,
            ripple: { radius: 0, strength: 0 },
        };
        this.ambientCycle = new Int32Array(AMBIENT_LOOPS);
        this.resetState(0);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.combo = 0;
        this.heat = REST_HEAT;
        this.stoke = 0;
        this.surge = 0;
        this.gust = 0;
        this.level = 1;
        /** The level's place on the palettes' line (level − 1), eased when a level changes. */
        this.levelPlace = 0;
        this.flash = 0;
        this.kick = 0;
        this.dip = 0;
        this.breath = 1;
        this.twist = 0;
        this.twistVelocity = 0;
        this.spinKick = 0;
        this.hushUntil = -1;
        this.impactCursor = 0;
        this.waveCursor = 0;
        this.lastClear = { time: -100, lines: 0 };
        /** Timed moments still ahead: comet landings, kicks, the flare after a hush. */
        this.queue = [];
        this.spaceRipple = { birth: -100, strength: 0 };
        this.counts = {
            locks: 0, clears: 0, quads: 0, comets: 0, eruptions: 0,
        };
        // The slow clocks are functions of the world clock until gameplay bends them.
        const motion = this.reducedMotion ? 0.3 : 1;
        this.spin = time * SPIN_RATE * motion;
        this.boil = time * (0.6 + REST_HEAT * 2.2) * motion;
        this.flow = time * (0.5 + REST_HEAT * 1.6) * motion;
        this.ambientCycle?.fill(-1e6);
        this.loops?.reset();
        this.sparks?.reset();
        this.comets?.reset();
        this.beams?.reset();
        if (this.u) {
            const { impacts, waves } = this.u;
            for (let i = 0; i < impacts.array.length; i++) impacts.array[i].set(0, 0, 0, -100);
            for (let i = 0; i < WAVE_SLOTS; i++) {
                waves.array[i * 3].set(-100, 0, 1, 1);
                waves.array[i * 3 + 1].set(1, 1, 1, 1);
                waves.array[i * 3 + 2].set(1, 0, 0, 0);
            }
            this.u.impactCount.value = 0;
            this.u.wavesLive.value = 0;
        }
    }

    build() {
        const lattice = createLatticeTexture(bakeLattice());
        const fbm = createFbmTexture(bakeFbm());
        this.textures.push(lattice, fbm);
        const u = createVoidEmberUniforms({ lattice, fbm });
        this.u = u;
        const { tier } = this;

        this.star = createPhotosphere(u, { detail: tier.starDetail, segments: tier.segments });
        this.addPart('star', this.star);
        this.addPart('world', createCinderWorld(u));
        ROCK_CLASSES.forEach((cls, i) => {
            this.addPart(cls.name, createRocks(u, cls, tier.rocks[i], this.seed + 101 * (i + 1), { cracks: tier.cracks }));
        });
        this.addPart('sky', createSky(u, { layers: tier.skyLayers, dust: tier.dust }));
        this.addPart('ring', createDustRing(u, { detail: tier.ringDetail }));
        this.corona = createCorona(u, { detail: tier.coronaDetail });
        this.addPart('corona', this.corona);
        this.loops = createLoops(u);
        this.addPart('loops', this.loops);
        this.wind = createEmberWind(u, tier.wind);
        this.addPart('wind', this.wind);

        // ── Gameplay effects (pools, always drawn) ──
        this.sparks = createSparks(u, tier.sparks);
        this.addPart('sparks', this.sparks);
        this.comets = createComets(u);
        this.addPart('comets', this.comets);
        this.addPart('shells', createShells(u));
        this.beams = createRowBeams(u);
        this.addPart('beams', this.beams);

        this.resetState(this.time);
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

    /** Draw only the named parts (captures, bisecting a look). `rocks` names all three classes. */
    showOnlyParts(names) {
        const keep = new Set(names);
        if (keep.has('rocks')) ROCK_CLASSES.forEach((cls) => keep.add(cls.name));
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
        this.pose();
        this.raiseAmbient();
    }

    /** A new run: the ember banked again (it keeps turning). */
    resetSession() {
        const {
            time, spin, boil, flow,
        } = this;
        // The void eases back to the first level's place; it does not jump.
        const { levelPlace } = this;
        this.resetState(time);
        Object.assign(this, {
            spin, boil, flow, levelPlace,
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

    // ── The ember's place and pose ──────────────────────────────────────────────

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

    /** Hang the star and the cinder world where the composition wants them for this aspect. */
    compose() {
        const { u } = this;
        this.anchors = emberAnchors(this.aspect);
        const a = this.anchors;
        const tanV = Math.tan((fovForAspect(this.aspect) * DEG) / 2);
        this.distance = EMBER.radius / (a.radius * 2 * tanV);
        const cam = this.restCamera();
        this._centre.set(a.x * 2 - 1, 1 - a.y * 2, 0.5).unproject(cam).normalize().multiplyScalar(this.distance);
        if (!u) return;
        u.centre.value.copy(this._centre);
        const depth = this.distance * WORLD_DEPTH;
        u.worldCentre.value.set(a.world.x * 2 - 1, 1 - a.world.y * 2, 0.5).unproject(cam).normalize()
            .multiplyScalar(depth);
        u.worldRadius.value = depth * a.world.radius * 2 * tanV;
    }

    /**
     * Stand the star's frame and the belt's for this moment. The star's axis leans toward the
     * camera and to one side, and the star turns about it; the belt lies almost edge-on, its
     * long axis leaning across the frame.
     */
    pose() {
        const { u } = this;
        if (!u) return;
        const a = this.anchors;
        // The line of sight back to the camera, and the sky's own right and up round it.
        const f = this._f.copy(this._centre).normalize().negate();
        const right = this._right.set(0, 1, 0).cross(f).normalize();
        const up = this._up.copy(f).cross(right).normalize();

        // ── The star ──
        const axis = this._axis.copy(up).multiplyScalar(Math.cos(24 * DEG))
            .addScaledVector(f, Math.sin(24 * DEG) * Math.cos(20 * DEG))
            .addScaledVector(right, Math.sin(24 * DEG) * Math.sin(20 * DEG))
            .normalize();
        const x = this._x.copy(axis).cross(f).normalize();
        const z = this._z.copy(x).cross(axis).normalize();
        this._basis.makeBasis(x, axis, z);
        this._spin.makeRotationY(this.spin);
        this._frame.copy(this._basis).multiply(this._spin);
        u.starRot.value.setFromMatrix4(this._frame);
        u.starInv.value.copy(u.starRot.value).transpose();
        u.axis.value.copy(axis);
        const star = this.star?.mesh;
        if (star) {
            this._frame.scale(this._scale.setScalar(EMBER.radius)).setPosition(this._centre);
            star.matrix.copy(this._frame);
            star.matrixWorld.copy(this._frame);
        }
        if (this.corona) {
            const ax = axis.dot(right);
            const ay = axis.dot(up);
            const al = Math.hypot(ax, ay) || 1;
            this.corona.uniforms.axis.value.set(ax / al, ay / al);
        }

        // ── The belt ──
        const lean = a.beltLean;
        const bx = this._x.copy(right).multiplyScalar(Math.cos(lean)).addScaledVector(up, Math.sin(lean)).normalize();
        const tipped = this._z.copy(up).multiplyScalar(Math.cos(lean)).addScaledVector(right, -Math.sin(lean));
        const normal = this._vec.copy(tipped).multiplyScalar(Math.cos(a.beltTilt))
            .addScaledVector(f, Math.sin(a.beltTilt))
            .normalize();
        const bz = this._z.copy(bx).cross(normal).normalize();
        this._basis.makeBasis(bx, normal, bz);
        u.beltRot.value.setFromMatrix4(this._basis);

        // ── The cinder world ──
        const world = this.parts.world?.mesh;
        if (world) {
            this._basis.makeRotationY(this.time * 0.011).scale(this._scale.setScalar(u.worldRadius.value))
                .setPosition(u.worldCentre.value);
            world.matrix.copy(this._basis);
            world.matrixWorld.copy(this._basis);
        }
    }

    /** A point of the star's surface (a unit vector in its own frame) in the world, now. */
    siteWorld(site, lift = 1, out = this._vec) {
        return out.set(site[0], site[1], site[2]).applyMatrix3(this.u.starRot.value)
            .multiplyScalar(EMBER.radius * lift)
            .add(this._centre);
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const t = sim.time;
        // The staged gameplay is flushed between this and update(): it must carry this frame's time.
        this.time = t;
        const calm = this.reducedMotion ? 0 : 1;
        const fov = fovForAspect(this.aspect) - this.kick * 0.4 * calm;
        if (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        // A slow drift, as of something adrift itself, plus the pointer leaning the view: the
        // near stones slide across the star and the star against the void.
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        const d = this.distance;
        const swayX = (Math.sin(t * 0.057) * 0.006 + Math.sin(t * 0.026 + 1.3) * 0.0036) * d * calm;
        const swayY = (Math.sin(t * 0.041 + 0.7) * 0.004 + Math.sin(t * 0.018) * 0.003) * d * calm;
        camera.position.set(swayX + px * 0.013 * d, swayY - py * 0.008 * d, this.kick * 0.01 * d * calm);
        const yaw = (Math.sin(t * 0.034 + 2.1) * 0.005 - px * 0.01) * calm;
        const pitch = (Math.sin(t * 0.027) * 0.0035 - py * 0.007) * calm;
        this._look.set(
            camera.position.x + Math.sin(yaw) * 10,
            camera.position.y + Math.tan(pitch) * 10,
            camera.position.z - 10,
        );
        camera.up.set(Math.sin(t * 0.021) * 0.01 * calm, 1, 0);
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
     * Where on the star a lock at screen point (wx, wy) lands: on the side that faces the card,
     * level with the piece, as a unit vector in the star's own frame. `salt` spreads a hard
     * drop's three.
     */
    pickSite(wx, wy, salt = 0, out = this._site) {
        const rand = mulberry32(0x2b1d + (this.counts.locks + 1) * 2654435761 + salt * 977);
        const a = this.aspect;
        // Screen offsets in screen heights, y up.
        const hx = this.heart.x * a;
        const hy = this.heart.y;
        const card = cardUnion(this.layout) || {
            x0: 0.4, x1: 0.6, y0: 0.1, y1: 0.9,
        };
        let bx = (card.x0 + card.x1) * 0.5 * a - hx;
        let by = -((card.y0 + card.y1) * 0.5 - hy);
        const bl = Math.hypot(bx, by) || 1;
        bx /= bl;
        by /= bl;
        const radius = Math.max(0.02, this.heartRadius);
        // Across the line to the card: the piece's own height (in landscape).
        const across = ((wx * a - hx) * -by + -(wy - hy) * bx) / radius;
        const p = Math.max(-0.8, Math.min(0.8, across * 0.9 + (rand() - 0.5) * 0.22 + salt * 0.27 * (rand() < 0.5 ? -1 : 1)));
        const t = 0.22 + rand() * 0.66;
        let ox = bx * t + -by * p;
        let oy = by * t + bx * p;
        const ol = Math.hypot(ox, oy);
        if (ol > 0.9) {
            ox *= 0.9 / ol;
            oy *= 0.9 / ol;
        }
        const oz = Math.sqrt(Math.max(0.05, 1 - ox * ox - oy * oy));
        this._vec.copy(this._right).multiplyScalar(ox).addScaledVector(this._up, oy).addScaledVector(this._f, oz)
            .normalize()
            .applyMatrix3(this.u.starInv.value);
        out[0] = this._vec.x;
        out[1] = this._vec.y;
        out[2] = this._vec.z;
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
     * Where the line from (px, py) to the star leaves `card` (screen fractions). A point that
     * is not inside the card, or a star that is, leaves from the point itself.
     */
    cardExit(px, py, card, out = this._point) {
        out.x = px;
        out.y = py;
        if (!card || px < card.x0 || px > card.x1 || py < card.y0 || py > card.y1) return out;
        const dx = this.heart.x - px;
        const dy = this.heart.y - py;
        const hx = this.heart.x;
        const hy = this.heart.y;
        if (hx > card.x0 && hx < card.x1 && hy > card.y0 && hy < card.y1) return out;
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

    /** Mark the photosphere: a flash, a ripple and a scar at `site`, born at `time`. */
    strike(site, rgb, time, strength) {
        const { impacts, impactCount } = this.u;
        const slot = this.impactCursor % IMPACT_SLOTS;
        this.impactCursor += 1;
        impacts.array[slot * 2].set(site[0], site[1], site[2], time);
        impacts.array[slot * 2 + 1].set(rgb[0], rgb[1], rgb[2], strength);
        impactCount.value = Math.min(IMPACT_SLOTS, this.impactCursor);
    }

    /**
     * Do something at `time`, which may be a moment ahead: the frame that reaches it fires it,
     * stamped with its own moment. Nothing staged here is drawn before its time, and two events
     * that fall in the same frame both happen.
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
            if (kind === 'land') this.land(time, data);
            else if (kind === 'shed') this.shed(time, data);
            else if (kind === 'kick') {
                this.kick = Math.max(this.kick, data);
                this.flash = Math.max(this.flash, data * 0.4);
            } else if (kind === 'surge') {
                // As if it had begun at its own moment, whatever frame noticed it.
                this.surge = Math.max(this.surge, data * Math.exp(-(t - time) / SURGE_COOL));
            }
        }
    }

    /** One piece of fuel: a comet from `from` onto a new site. Its landing is queued. */
    feed(wx, wy, from, rgb, amount, salt) {
        const site = [...this.pickSite(wx, wy, salt)];
        const to = this.siteWorld(site);
        const dist = Math.hypot(to.x - from[0], to.y - from[1], to.z - from[2]);
        const flight = this.reducedMotion ? 0.12 : COMET_FLIGHT * (0.75 + Math.min(1.2, dist / this.distance));
        const land = this.time + flight;
        // The arc bows toward the camera and a little upward, as if the star drew it in.
        const bow = dist * 0.14;
        this.comets.launch({
            from,
            site,
            rgb,
            time: this.time,
            flight,
            bow: [this._f.x * bow + this._up.x * bow * 0.5, this._f.y * bow + this._up.y * bow * 0.5, this._f.z * bow],
            size: 0.7 + amount * 0.3,
        });
        this.schedule(land, 'land', {
            site, rgb: [rgb[0], rgb[1], rgb[2]], amount, index: this.counts.comets,
        });
        this.counts.comets += 1;
        return land;
    }

    /**
     * A comet lands: a flash, a ripple and a scar on the photosphere, sparks, and a loop that
     * rises where it struck — in whichever slot holds the least light at that moment.
     */
    land(time, {
        site, rgb, amount, index,
    }) {
        this.strike(site, rgb, time, 0.55 + amount * 0.45);
        const slot = this.loops.weakest(0, LOCK_LOOPS, time);
        const rand = mulberry32(0x77f1 + index * 7919);
        this.loops.raise(slot, {
            site,
            azimuth: rand() * TAU,
            span: 0.09 + rand() * 0.09 + amount * 0.03,
            height: 0.13 + rand() ** 1.5 * 0.24 + amount * 0.09,
            rgb,
            time,
            strength: 0.6 + amount * 0.4,
            seed: index,
        });
        const to = this.siteWorld(site);
        this.sparks.emit({
            x: to.x,
            y: to.y,
            z: to.z,
            n: ((9 + 13 * amount) * this.sparks.count) / 700,
            rgb,
            time,
            dir: [
                (to.x - this._centre.x) / EMBER.radius,
                (to.y - this._centre.y) / EMBER.radius,
                (to.z - this._centre.z) / EMBER.radius,
            ],
            spread: 0.75,
            out: [3, 10 + amount * 7],
            life: [0.5, 1.2],
            size: 0.1,
        });
        this.kick = Math.max(this.kick, amount > 1 ? 0.5 : 0.09 * amount);
        this.flash = Math.max(this.flash, amount > 1 ? 0.12 : 0.03);
    }

    /** A torn-off loop sheds its plasma as sparks, from where the star has carried it. */
    shed(time, {
        site, lift, rgb, n, speed, nova = false,
    }) {
        if (nova) {
            // The whole star throws sparks, every way at once.
            this.sparks.emit({
                x: this._centre.x,
                y: this._centre.y,
                z: this._centre.z,
                n,
                rgb,
                time,
                spread: 2,
                out: [14, speed],
                life: [0.9, 2.2],
                size: 0.14,
                scatter: EMBER.radius * 1.9,
                stagger: 0.15,
            });
            return;
        }
        const to = this.siteWorld(site, lift);
        const k = 1 / (EMBER.radius * Math.max(0.2, lift));
        this.sparks.emit({
            x: to.x,
            y: to.y,
            z: to.z,
            n,
            rgb,
            time,
            dir: [(to.x - this._centre.x) * k, (to.y - this._centre.y) * k, (to.z - this._centre.z) * k],
            spread: 0.6,
            out: [5, speed],
            life: [0.7, 1.7],
            size: 0.12,
            scatter: 1.2,
        });
    }

    /**
     * A piece locked. `u` = its column as a fraction of the board width, `rows` = the visible
     * rows it covers, `color` = the piece's colour; `screen` (fractions) replaces the board point.
     */
    onLock({
        u = 0.5, rows = null, hardDrop = false, color = null, player = 0, screen = null,
    } = {}) {
        if (!this.u || !this.loops) return;
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
            // The comet leaves its own card's edge on the way to the star.
            this.cardExit(px, py, this.cardFor(board), this._point);
            px = this._point.x;
            py = this._point.y;
        }
        const from = [...this.screenToWorld(px, py, this.distance * COMET_DEPTH)];
        this.feed(px, py, from, rgb, hardDrop ? 1.3 : 0.8, 0);
        if (hardDrop) {
            this.feed(px, py, from, rgb, 0.6, 1);
            this.feed(px, py, from, rgb, 0.6, 2);
        }
        this.stoke = Math.min(STOKE_MAX, this.stoke + (hardDrop ? 0.045 : 0.025));
        this.counts.locks += 1;
    }

    /**
     * Lines cleared. `lines` 1..4; `tspin`, `perfect`; `rows` = the visible rows that went.
     */
    onClear({
        rows = null, lines = 1, tspin = false, perfect = false, player = 0, screen = null,
    } = {}) {
        const { u } = this;
        if (!u || !this.loops) return;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        const birth = quad ? this.time + HUSH_HOLD : this.time;

        // ── Every held loop is torn off; the wave is tinted by what the star was holding ──
        const mixRgb = [0, 0, 0];
        let weight = 0;
        let torn = 0;
        const last = quad ? LOOP_SLOTS : LOCK_LOOPS;
        const lit = Math.max(1, this.loops.litCount(this.time, 0, last));
        const each = loopSparkShare(this.sparks.count, lit);
        for (let i = 0; i < last; i++) {
            const held = this.loops.held(i, this.time);
            const entry = this.loops.slot(i);
            const at = birth + torn * 0.045;
            if (held > 0.03 && this.loops.erupt(i, at)) {
                for (let c = 0; c < 3; c++) mixRgb[c] += entry.rgb[c] * held;
                weight += held;
                torn += 1;
                this.schedule(at, 'shed', {
                    site: [...entry.site], lift: 1 + entry.height * 0.7, rgb: [...entry.rgb], n: each, speed: 20 + n * 4,
                });
            }
        }
        // The star's own fire, a step hotter than it is, with a breath of what was torn off.
        const own = emberColor(Math.min(0.74, this.heat + 0.1 + 0.04 * n), this._colour);
        let rgb = [...own];
        if (quad) rgb = [...NOVAFIRE];
        else if (weight > 0.05) {
            const k = Math.min(0.34, weight / 5);
            rgb = rgb.map((c, i) => c * (1 - k) + (mixRgb[i] / weight) * k);
        }
        const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
        rgb = rgb.map((c) => (c / peak) * 0.96 + 0.04);
        const strength = Math.min(1.6, 0.55 + 0.16 * n + Math.min(0.35, weight * 0.08) + (quad ? 0.3 : 0));

        // ── The wave leaves the star, toward the board ──
        const slot = this.waveCursor % WAVE_SLOTS;
        this.waveCursor += 1;
        const card = cardUnion(this.layout) || {
            x0: 0.4, x1: 0.6, y0: 0.1, y1: 0.9,
        };
        let dx = ((card.x0 + card.x1) * 0.5 - this.heart.x) * this.aspect;
        let dy = -((card.y0 + card.y1) * 0.5 - this.heart.y);
        const dl = Math.hypot(dx, dy) || 1;
        dx /= dl;
        dy /= dl;
        const cover = quad ? 1 : [0.24, 0.36, 0.56][n - 1];
        u.waves.array[slot * 3].set(birth, strength, perfect ? 4 : n, quad ? 1.5 : 1);
        u.waves.array[slot * 3 + 1].set(rgb[0], rgb[1], rgb[2], cover);
        u.waves.array[slot * 3 + 2].set(dx, dy, 0, 0);
        this.lastClear = { time: birth, lines: n };
        this.schedule(birth + 0.08, 'kick', 0.2 + 0.1 * n);
        this.gust = Math.max(this.gust, 0.35 + 0.15 * n);

        // ── The cleared rows leave the card as blades of light ──
        const board = boardFor(this.layout, player);
        const ownCard = this.cardFor(board);
        if (board && ownCard && this.layoutLive && !screen) {
            const list = Array.isArray(rows) && rows.length ? rows : Array.from({ length: n }, (_, i) => 19 - i);
            const ys = [];
            for (let i = 0; i < list.length && i < 4; i++) ys.push(boardPoint(board, 0.5, list[i], this._point).y);
            this.beams.fire(ys, ownCard.x0, ownCard.x1, rgb, this.time, Math.min(1.4, 0.7 + 0.18 * n));
        }

        if (quad) {
            // The ember holds its breath; then it flares.
            this.hushUntil = this.time + HUSH_HOLD;
            this.schedule(birth, 'surge', perfect ? 1.3 : 1);
            this.ripple(birth, this.reducedMotion ? 0.25 : 1);
            this.twistVelocity += 1.2;
            this.schedule(birth, 'shed', {
                site: [0, 0, 0], lift: 0, rgb: [...NOVAFIRE], n: this.sparks.count * 0.26, speed: 44, nova: true,
            });
            this.counts.quads += 1;
        } else if (n === 3) {
            this.surge = Math.max(this.surge, 0.3);
        }
        if (tspin) {
            // The star spins up and the corona winds into a pinwheel.
            this.twistVelocity += 3.4;
            this.spinKick = Math.max(this.spinKick, 1);
            this.ripple(this.time, this.reducedMotion ? 0.1 : 0.4);
        }
        this.counts.eruptions += torn;
        this.counts.clears += 1;
    }

    /** Send a ripple through the picture — unless a stronger one is already on its way. */
    ripple(birth, strength) {
        const live = this.spaceRipple;
        const liveNow = live.birth > this.time
            ? live.strength
            : live.strength * Math.exp(-(this.time - live.birth) / 0.85);
        if (liveNow > strength) return;
        this.spaceRipple = { birth, strength };
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        // The chain broke: the ember lets its breath go.
        if (n === 0 && this.combo >= 2) this.dip = Math.max(this.dip, 0.25);
        // Another step of the chain: the ember is blown on. A breath of brighter fire washes
        // over its face from the side the board is on, and a gust goes through the wind.
        if (n >= 2 && n > this.combo) {
            this.gust = Math.max(this.gust, Math.min(1, 0.3 + 0.1 * n));
            this.flash = Math.max(this.flash, 0.06);
            if (this.u) {
                const card = cardUnion(this.layout) || {
                    x0: 0.4, x1: 0.6, y0: 0.1, y1: 0.9,
                };
                let bx = ((card.x0 + card.x1) * 0.5 - this.heart.x) * this.aspect;
                let by = -((card.y0 + card.y1) * 0.5 - this.heart.y);
                const bl = Math.hypot(bx, by) || 1;
                bx = (bx / bl) * 0.82;
                by = (by / bl) * 0.82;
                this._vec.copy(this._right).multiplyScalar(bx).addScaledVector(this._up, by)
                    .addScaledVector(this._f, Math.sqrt(1 - bx * bx - by * by))
                    .applyMatrix3(this.u.starInv.value);
                const fire = emberColor(Math.min(1, heatForCombo(n) + 0.25), this._colour);
                this.strike([this._vec.x, this._vec.y, this._vec.z], fire, this.time, Math.min(1.1, 0.5 + 0.08 * n));
            }
        }
        this.combo = n;
    }

    /**
     * A new level: the void moves one palette along (it also drifts there by itself, a step
     * every PALETTE_STEP seconds), and a slow cold ring crosses it.
     */
    levelUp(level, { silent = false } = {}) {
        this.level = Math.max(1, Math.round(Number(level) || 1));
        if (silent) this.applyPalette(1);
        else if (this.u) {
            // The ring comes in the colour the void is on its way to.
            const tint = paletteAt(palettePlace(this.level - 1, this.time), this._ringPalette).dustA;
            const peak = Math.max(tint[0], tint[1], tint[2], 1e-4);
            const slot = this.waveCursor % WAVE_SLOTS;
            this.waveCursor += 1;
            this.u.waves.array[slot * 3].set(this.time, 0.75, 1, 1.8);
            const cold = tint.map((c) => (c / peak) * 0.8 + 0.2);
            this.u.waves.array[slot * 3 + 1].set(cold[0], cold[1], cold[2], 1);
            this.u.waves.array[slot * 3 + 2].set(1, 0, 0, 0);
            this.flash = Math.max(this.flash, 0.12);
            this.gust = Math.max(this.gust, 0.6);
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

    /**
     * The star's own prominences: each of the last AMBIENT_LOOPS slots raises a loop of the
     * star's fire every AMBIENT_PERIOD seconds, somewhere new — a function of the clock, so a
     * seek finds them where they would have been.
     */
    raiseAmbient() {
        if (!this.loops) return;
        const t = this.time;
        for (let k = 0; k < AMBIENT_LOOPS; k++) {
            const period = AMBIENT_PERIOD + k * 3.7;
            const offset = ((k * 0.618) % 1) * period;
            const cycle = Math.floor((t + offset) / period);
            if (cycle === this.ambientCycle[k]) continue;
            this.ambientCycle[k] = cycle;
            const birth = cycle * period - offset;
            const rand = mulberry32(0x9e37 + k * 7919 + cycle * 104729);
            const z = rand() * 2 - 1;
            const a = rand() * TAU;
            const r = Math.sqrt(1 - z * z);
            this.loops.raise(LOCK_LOOPS + k, {
                site: [r * Math.cos(a), z, r * Math.sin(a)],
                azimuth: rand() * TAU,
                span: 0.1 + rand() * 0.13,
                height: 0.16 + rand() ** 2 * 0.42,
                rgb: AMBIENT_COLOR,
                time: birth,
                strength: 0.36 + rand() * 0.26,
                seed: k * 13 + cycle,
            });
            // It lifts off on its own before its slot is used again.
            this.loops.erupt(LOCK_LOOPS + k, birth + period - AMBIENT_LEAVE);
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

        // ── The heat ──
        this.surge *= Math.exp(-dt / SURGE_COOL);
        this.stoke *= Math.exp(-dt / STOKE_COOL);
        this.gust *= Math.exp(-dt / 1.6);
        this.flash *= Math.exp(-dt / 0.25);
        this.kick *= Math.exp(-dt / 0.16);
        this.dip *= Math.exp(-dt / 0.35);
        this.spinKick *= Math.exp(-dt / 2.4);
        this.drain(t);
        const target = Math.min(HEAT_FLARE, heatForCombo(this.combo) + this.stoke + this.surge * 0.42);
        this.heat += (target - this.heat) * approach(target > this.heat ? 2.6 : 0.55, dt);
        const hush = t < this.hushUntil ? 1 : 0;
        const breathTarget = hush ? 0.1 : 1 - this.dip;
        this.breath += (breathTarget - this.breath) * approach(hush ? 40 : 14, dt);
        if (dt === 0) this.breath = breathTarget;
        this.applyPalette(approach(1.1, dt));

        // The pinwheel's spring (semi-implicit, in small steps so a long frame cannot blow it up).
        let left = Math.min(dt, 0.1);
        while (left > 1e-5) {
            const h = Math.min(left, 1 / 120);
            this.twistVelocity += (-TWIST_STIFFNESS * this.twist - TWIST_DAMPING * this.twistVelocity) * h;
            this.twist += this.twistVelocity * h;
            left -= h;
        }

        // ── The slow clocks ──
        const { heat } = this;
        const hurry = this.reducedMotion ? 0 : 1;
        this.spin += dt * SPIN_RATE * motion * (1 + this.spinKick * 9 * hurry);
        this.boil += dt * motion * (0.6 + heat * 2.2 + this.surge * 3 * hurry);
        this.flow += dt * motion * (0.5 + heat * 1.6 + (this.surge * 4 + this.gust * 2) * hurry);

        this.raiseAmbient();
        this.pose();

        // ── Uniforms ──
        let impactsLive = 0;
        for (let i = 0; i < IMPACT_SLOTS; i++) {
            const birth = u.impacts.array[i * 2].w;
            if (i < this.impactCursor && t - birth < 30) impactsLive = i + 1;
        }
        u.impactCount.value = impactsLive;
        u.time.value = t;
        u.boil.value = this.boil;
        u.flow.value = this.flow;
        u.heat.value = heat;
        u.breath.value = this.breath;
        u.twist.value = this.twist * (this.reducedMotion ? 0.25 : 1);
        // What the star casts on the belt, the cinder world and the dust.
        const light = emberColor(heat + 0.1, this._light);
        const cast = 2.4 + 6.5 * Math.max(0, heat) ** 1.4 + this.flash * 4;
        u.starLight.value.set(light[0] * cast, light[1] * cast, light[2] * cast);
        const stain = 2.2 + 1.6 * heat + this.flash * 2;
        u.skyLight.value.set(light[0] * stain, light[1] * stain, light[2] * stain);
        const p = this._palette;
        u.voidCol.value.set(p.void[0], p.void[1], p.void[2]);
        u.dustA.value.set(p.dustA[0], p.dustA[1], p.dustA[2]);
        u.dustB.value.set(p.dustB[0], p.dustB[1], p.dustB[2]);
        u.rock.value.set(p.rock[0], p.rock[1], p.rock[2]);
        u.fill.value.set(p.fill[0], p.fill[1], p.fill[2]);
        u.starTint.value.set(p.star[0], p.star[1], p.star[2]);
        if (this.corona) {
            const cu = this.corona.uniforms;
            cu.reach.value = clamp01(0.14 + (heat - REST_HEAT) * 0.85 + this.surge * 0.45 + this.gust * 0.12);
            cu.gain.value = 0.17 + heat * 0.62 + this.surge * 1.0 + this.flash * 0.6;
        }
        if (this.wind) {
            const wu = this.wind.uniforms;
            wu.emit.value = clamp01(0.14 + (heat - REST_HEAT) * 1.05 + this.gust * 0.4 + this.surge);
            wu.reach.value = 1.15 + heat * 2.1 + this.surge * 3 + this.gust * 0.8;
        }

        // What follows the camera: the dome, the star on screen, the corona's limb.
        if (camera) {
            const sky = this.parts.sky?.mesh;
            if (sky) {
                sky.position.copy(camera.position);
                sky.updateMatrix();
                sky.updateMatrixWorld(true);
            }
            this._vec.copy(this._centre).sub(camera.position);
            const range = Math.max(EMBER.radius * 1.5, this._vec.length());
            u.starDir.value.copy(this._vec).normalize();
            u.starSize.value = EMBER.radius / range;
            if (this.corona) {
                this.corona.uniforms.limb.value = 1 / Math.sqrt(1 - (EMBER.radius / range) ** 2);
            }
            this._ray.copy(this._centre).project(camera);
            this.heart.x = Math.max(-0.5, Math.min(1.5, this._ray.x * 0.5 + 0.5));
            this.heart.y = Math.max(-0.5, Math.min(1.5, 0.5 - this._ray.y * 0.5));
            this.heartRadius = (EMBER.radius / range) / (2 * Math.tan((camera.fov * DEG) / 2));
        }

        // ── Post ──
        const sinceClear = t - this.lastClear.time;
        const swell = sinceClear >= 0 ? Math.exp(-sinceClear / 0.7) * (0.3 + 0.12 * this.lastClear.lines) : 0;
        const warm = Math.max(0, heat - REST_HEAT);
        const post = this._post;
        post.heartRadius = this.heartRadius;
        post.flash = this.flash;
        post.kick = this.kick;
        post.rays = hush ? 0.02 : Math.min(0.26, 0.05 + warm * 0.2 + this.surge * 0.1 + swell * 0.08);
        post.streak = hush ? 0 : Math.min(0.9, warm * warm * 0.45 + this.surge * 0.5 + this.flash * 0.8);
        post.haze = (0.35 + warm * 0.9 + this.surge * 0.6) * (this.reducedMotion ? 0.3 : 1);
        post.bloomBoost = this.surge * 0.12 + swell * 0.1;
        // The iris closes as the ember flares, so its colours survive the heat.
        post.exposure = 1 / (1 + this.surge * 2.3 + swell * 0.5 + warm * 1.3 + this.flash * 0.3);
        u.iris.value = (1 / post.exposure) ** 0.8;
        const rippleAge = t - this.spaceRipple.birth;
        post.ripple.radius = Math.max(0, rippleAge) * RIPPLE_SPEED;
        post.ripple.strength = rippleAge >= 0
            ? this.spaceRipple.strength * Math.exp(-rippleAge / 0.85) * smooth(0, 0.12, rippleAge)
            : 0;
        // Waves that have left the frame cost nothing more.
        let wavesLive = 0;
        for (let i = 0; i < WAVE_SLOTS; i++) {
            if (t - u.waves.array[i * 3].x < WAVE_LIVE) wavesLive = i + 1;
        }
        this.wavesLive = wavesLive;
        u.wavesLive.value = wavesLive > 0 ? 1 : 0;
    }

    /** The fBm texture (the post's heat haze reads it). */
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
            heat: this.heat,
            stoke: this.stoke,
            surge: this.surge,
            gust: this.gust,
            breath: this.breath,
            twist: this.twist,
            level: this.level,
            palette: paletteName(palettePlace(this.levelPlace, this.time)),
            paletteMix: palettePhase(palettePlace(this.levelPlace, this.time)).mix,
            counts: { ...this.counts },
            held: this.loops ? this.loops.totalHeld(this.time, 0, LOCK_LOOPS) : 0,
            loops: this.loops ? this.loops.litCount(this.time) : 0,
            impacts: this.u ? this.u.impactCount.value : 0,
            wavesLive: this.wavesLive || 0,
            rocks: tier.rocks[0] + tier.rocks[1] + tier.rocks[2],
            wind: this.wind ? this.wind.count : 0,
            sparks: this.sparks ? this.sparks.count : 0,
            layoutLive: this.layoutLive,
            heart: { ...this.heart },
            heartRadius: this.heartRadius,
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
            part.extraGeometry?.dispose?.();
            part.material?.dispose?.();
        });
        this.textures.forEach((t) => t.dispose());
        this.disposables = [];
        this.textures = [];
        this.parts = {};
        this.star = null;
        this.corona = null;
        this.loops = null;
        this.wind = null;
        this.sparks = null;
        this.comets = null;
        this.beams = null;
        this.u = null;
        this._camera = null;
    }
}

export { PARTS as VOID_EMBER_PARTS };
