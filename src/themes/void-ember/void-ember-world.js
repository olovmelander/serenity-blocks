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
 * Fast play BUILDS (src/themes/shared/gameplay-surge.js): every momentary light is a Swell that a
 * new event adds to instead of restarting, and the heat of play is spent on the world's own parts.
 * At an easy pace the ember is as above. A quick hand warms it: the corona reaches further, the
 * wind streams, and the pace itself fans the coal. Hot play keeps a crown of loops on the star
 * through a chain (each clear throws the oldest, the newest stand taller) and wakes the fire in
 * the stones nearest it. A fever is the bellows wide open: the star turns and boils faster, the
 * corona and the wind run to their limits, and every stone of the belt burns in its fractures,
 * until a four or a perfect clear lets the whole crown go and the world breathes back out. A
 * chain climbs from a coal to gold over its whole length, never in its first few clears, and the
 * payoff burns in the loops, the shells and the corona rather than in a white sky.
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
    SCAR_LIFE,
    LOCK_LOOPS,
    LOOP_SLOTS,
    NOVAFIRE,
    PALETTE_HOME,
    PALETTE_KEYS,
    REST_HEAT,
    TAU,
    VOID_PALETTES,
    WAVE_AFTERGLOW,
    WAVE_LIVE,
    WAVE_SLOTS,
    approach,
    bakeFbm,
    bakeLattice,
    clamp01,
    createFbmTexture,
    createLatticeTexture,
    createPlatesTexture,
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
    SHELL_LIFE, createComets, createEmberWind, createRowBeams, createShells, createSparks,
} from './void-ember-fx.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './void-ember-composition.js';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, Swell, softCeiling } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';
import { VOID_EMBER_TETROMINOS } from './void-ember-tetrominos.js';

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
export const SURGE_COOL = 2.2;
/** Seconds the stoking a lock gives takes to fade to 1/e, and the most it adds to the heat. */
export const STOKE_COOL = 7;
export const STOKE_MAX = 0.12;
/**
 * The hottest the ember gets: deep gold, in the first seconds after a four-line clear (any hotter
 * and the star, the biggest light in the frame, reads cream and takes every colour with it).
 */
export const HEAT_FLARE = 0.86;
/** How much of the way from where the ember stands to HEAT_FLARE a four's flare (surge 1) takes it. */
const FLARE_SHARE = 0.9;
/**
 * The most a chain heats the ember per second past its first clear's heat: a long chain climbs
 * from a coal to gold over its whole length instead of in its first few clears.
 */
export const CHAIN_RISE = 0.045;
/** What the pace of play alone (a quick hand, no chain) adds to the heat at its hottest. */
export const PACE_HEAT = 0.28;
/**
 * The heat a chain, the pace and the stoking give the ember together: as they are up to
 * EMBER_KNEE (every casual clear looks as it always did), then easing toward EMBER_TOP, a gold
 * star with the last of its crust, so the four's flare (to HEAT_FLARE) still has somewhere to go.
 */
export const EMBER_KNEE = 0.6;
export const EMBER_TOP = 0.78;
export const emberBase = (heat) => softCeiling(heat, EMBER_KNEE, EMBER_TOP);
/** The most loops a chain keeps on the star between its clears (the crown). */
export const CROWN_MAX = 10;
/**
 * What a four spends of the heat the chain has built: the flare takes the star to HEAT_FLARE and,
 * as it cools, lets it back to a coal that much cooler, which the chain then climbs from again.
 */
const QUAD_SPEND = 0.24;
/**
 * The colours a perfect clear's crown burns in: the pieces' own flames, the coloured ones (the
 * magnesium white of the I would read as a white flash).
 */
const CROWN_FLAMES = ['S', 'T', 'J', 'Z', 'O', 'L'].map((key) => pieceColor(VOID_EMBER_TETROMINOS.colors[key]));
/** Prominences in a perfect clear's crown, round the limb. */
const CROWN_LOOPS = 9;
/** The perfect clear's own ring: the nova's gold, a shade deeper. */
const CROWNFIRE = Object.freeze([1.0, 0.62, 0.18]);
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
        /**
         * Every momentary light is a Swell (src/themes/shared/swell.js): a new hit ADDS to what is
         * still lit, so a lock right after a clear never cuts its flash, and rapid play rides up
         * to a plateau instead of flickering. Read through the getters below at the world clock.
         */
        this.swells = {
            flash: new Swell({ release: 0.25, ceiling: 0.3, knee: 0.18 }),
            kick: new Swell({ release: 0.16, ceiling: 0.8, knee: 0.5 }),
            gust: new Swell({ release: 1.6, ceiling: 1.3, knee: 0.9 }),
            /** The overdrive a four (1) or a perfect clear (1.3) blows the ember into. */
            surge: new Swell({ release: SURGE_COOL, ceiling: 1.6, knee: 1.05 }),
            /** The breath a broken chain lets go. */
            dip: new Swell({
                attack: 0.06, release: 0.35, ceiling: 0.35, knee: 0.25,
            }),
            /** A T-spin's spin-up of the star's turn. */
            spinKick: new Swell({ release: 2.4, ceiling: 1.6, knee: 1 }),
            /** The post's swell after a clear. */
            swell: new Swell({ release: 0.7, ceiling: 0.8, knee: 0.55 }),
            /** A back-to-back's gold ring on the limb (more with each in a row). */
            b2b: new Swell({
                attack: 0.12, release: 5, ceiling: 1.4, knee: 0.9,
            }),
            /** A perfect clear's crown: the corona blazing out, the belt alight. */
            crown: new Swell({
                attack: 0.15, release: 3, ceiling: 1.3, knee: 1,
            }),
        };
        /** How hot play runs, and the reading of it this frame (copied: the surge reuses its own). */
        this.play = new GameplaySurge();
        this.playNow = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        /** Scratch: the loops a clear may tear, oldest first. */
        this._order = new Int32Array(LOOP_SLOTS);
        this.resetState(0);
    }

    /** The light of the events' flashes, now. */
    get flash() {
        return this.swells.flash.valueAt(this.time);
    }

    get kick() {
        return this.swells.kick.valueAt(this.time);
    }

    get gust() {
        return this.swells.gust.valueAt(this.time);
    }

    /** The overdrive after a four-line clear (cools to 1/e in SURGE_COOL). */
    get surge() {
        return this.swells.surge.valueAt(this.time);
    }

    get dip() {
        return this.swells.dip.valueAt(this.time);
    }

    get spinKick() {
        return this.swells.spinKick.valueAt(this.time);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.combo = 0;
        this.heat = REST_HEAT;
        /** The heat the chain has blown the ember up to so far (it climbs at most CHAIN_RISE a second). */
        this.chainHeat = REST_HEAT;
        this.stoke = 0;
        this.level = 1;
        /** The level's place on the palettes' line (level − 1), eased when a level changes. */
        this.levelPlace = 0;
        this.breath = 1;
        this.twist = 0;
        this.twistVelocity = 0;
        this.hushUntil = -1;
        /** How deep the hush before a four goes (1 from cold; shallower the hotter play runs). */
        this.hushDepth = 1;
        this.impactCursor = 0;
        /** Strikes come about this many seconds apart (an average): how long a scar may last. */
        this.strikeGap = 1.5;
        this.lastStrike = -1e6;
        this.waveCursor = 0;
        /** The afterglow carried for waves whose slots were taken (u.waveCarry), as of carryTime. */
        this.carry = 0;
        this.carryTime = time;
        /** Back-to-back clears in a row. */
        this.b2bStreak = 0;
        /** The last clear's wave (a cascade's next wave builds on it). */
        this.lastWave = {
            time: -100, depth: 0, strength: 0, cover: 0,
        };
        Object.keys(this.swells).forEach((key) => this.swells[key].reset());
        this.play.reset();
        this.playNow.punch = 0;
        this.playNow.level = 0;
        this.playNow.fever = 0;
        this.playNow.stage = 0;
        /** Timed moments still ahead: comet landings, kicks, the flare after a hush. */
        this.queue = [];
        this.spaceRipple = { birth: -100, strength: 0 };
        this.counts = {
            locks: 0, clears: 0, quads: 0, comets: 0, eruptions: 0, crowns: 0, spins: 0,
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
            this.u.waveCarry.value = 0;
        }
    }

    build() {
        const lattice = createLatticeTexture(bakeLattice());
        const fbm = createFbmTexture(bakeFbm());
        const plates = createPlatesTexture();
        this.textures.push(lattice, fbm, plates);
        const u = createVoidEmberUniforms({ lattice, fbm, plates });
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
        // Every event's kick rides on the punch of play, and a fever leans the lens in a little.
        const kick = this.kick + this.playNow.punch * 0.15;
        const fov = fovForAspect(this.aspect) - (kick * 0.4 + this.playNow.fever * 0.7) * calm;
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
        camera.position.set(swayX + px * 0.013 * d, swayY - py * 0.008 * d, kick * 0.01 * d * calm);
        const yaw = (Math.sin(t * 0.034 + 2.1) * 0.005 - px * 0.01) * calm;
        const pitch = (Math.sin(t * 0.027) * 0.0035 - py * 0.007) * calm;
        this._look.set(
            camera.position.x + Math.sin(yaw) * 10,
            camera.position.y + Math.tan(pitch) * 10,
            camera.position.z - 10,
        );
        camera.up.set(Math.sin(t * 0.021) * 0.01 * calm, 1, 0);
        camera.lookAt(this._look);
        // The shared breath (shared/camera-breath.js) on top of the drift above, pivoting on the
        // star (the look point is only a direction): off under reduced motion.
        applyCameraBreath(camera, t, {
            distance: camera.position.distanceTo(this._centre),
            scale: this.reducedMotion ? 0 : 1,
        });
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

    /**
     * Mark the photosphere: a flash, a ripple and a scar at `site`, born at `time`. The slots are
     * taken in turn, so a slot is needed again IMPACT_SLOTS strikes later: at the pace strikes are
     * coming, its scar lasts about that long (up to SCAR_LIFE at an easy pace), and the strike that
     * takes the slot finds it already dark instead of putting a burning scar out.
     */
    strike(site, rgb, time, strength) {
        const { impacts, impactCount } = this.u;
        const slot = this.impactCursor % IMPACT_SLOTS;
        this.impactCursor += 1;
        if (this.lastStrike > -1e5) {
            const gap = Math.min(4, Math.max(0, time - this.lastStrike));
            this.strikeGap += (gap - this.strikeGap) * 0.3;
        }
        this.lastStrike = Math.max(this.lastStrike, time);
        const life = Math.min(SCAR_LIFE, Math.max(0.5, (IMPACT_SLOTS * this.strikeGap) / 1.7));
        impacts.array[slot * 3].set(site[0], site[1], site[2], time);
        impacts.array[slot * 3 + 1].set(rgb[0], rgb[1], rgb[2], strength);
        impacts.array[slot * 3 + 2].set(life, 0, 0, 0);
        impactCount.value = Math.min(IMPACT_SLOTS, this.impactCursor);
    }

    /**
     * A wave slot for a wave about to leave: the first spent one, in turn; else the one with the
     * least left to show (never one still waiting to leave). Whatever afterglow it still held joins
     * the carry, so the dust, the stones and the far world it lit do not go dark, and the stones it
     * shoved keep their place and ease back.
     */
    takeWaveSlot() {
        const { waves } = this.u;
        let slot = -1;
        let least = Infinity;
        for (let k = 0; k < WAVE_SLOTS; k++) {
            const i = (this.waveCursor + k) % WAVE_SLOTS;
            const A = waves.array[i * 3];
            const age = this.time - A.x;
            if (!(A.y > 0) || age >= SHELL_LIFE) {
                slot = i;
                break;
            }
            const left = age < 0 ? Infinity : A.y * (1 - age / SHELL_LIFE);
            if (left < least) {
                least = left;
                slot = i;
            }
        }
        if (slot < 0) slot = this.waveCursor % WAVE_SLOTS;
        const A = waves.array[slot * 3];
        if (A.y > 0 && A.x <= this.time) {
            this.carry = this.carryAt(this.time) + A.y * Math.exp(-(this.time - A.x) / WAVE_AFTERGLOW);
            this.carryTime = this.time;
        }
        this.waveCursor = slot + 1;
        return slot;
    }

    /** The afterglow carried for waves that gave up their slots, at `t`. */
    carryAt(t) {
        return this.carry > 0 ? this.carry * Math.exp(-Math.max(0, t - this.carryTime) / WAVE_AFTERGLOW) : 0;
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
                this.swells.kick.hit(data, time);
                this.swells.flash.hit(data * 0.4, time);
            } else if (kind === 'surge') {
                // At its own moment, whatever frame noticed it (a swell reads it as that old).
                this.swells.surge.hit(data, time);
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
        this.swells.kick.hit(amount > 1 ? 0.5 : 0.09 * amount, time);
        this.swells.flash.hit(amount > 1 ? 0.12 : 0.03, time);
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
        this.play.lock({ hardDrop }, this.time);
        this.counts.locks += 1;
    }

    /**
     * Lines cleared. `lines` 1..4; `tspin`, `perfect`, `b2b`; `rows` = the visible rows that went;
     * `combo` = the chain this clear belongs to (1 = its first clear); `cascade` = which wave of
     * its lock's cascade it is (each one builds on the last: stronger, wider, more fronts, hotter).
     */
    onClear({
        rows = null, lines = 1, tspin = false, perfect = false, player = 0, screen = null, combo = 1, cascade = 1,
        b2b = false,
    } = {}) {
        const { u } = this;
        if (!u || !this.loops) return;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        const depth = Math.max(0, Math.min(8, Math.round(Number(cascade) || 1) - 1));
        const chain = Math.max(1, Math.round(Number(combo) || 1));
        const { level, fever } = this.playNow;
        const birth = quad ? this.time + HUSH_HOLD : this.time;
        this.play.clear({
            lines: n, cascade: depth + 1, combo: chain, tspin, perfect, b2b,
        }, this.time);

        // ── What the star lets go of; the wave is tinted by it ──
        // A clear on its own, or a four: everything it holds. Inside a chain it keeps a crown of
        // its newest loops (more of them the longer the chain, up to CROWN_MAX) and throws the
        // oldest, at least two and more for each wave of a cascade: every clear of a chain erupts,
        // and what the star holds grows until a four, a perfect clear or the chain's end.
        const last = quad ? LOOP_SLOTS : LOCK_LOOPS;
        const order = this._order;
        let lit = 0;
        for (let i = 0; i < last; i++) {
            if (this.loops.held(i, this.time) > 0.03) {
                const born = this.loops.slot(i).birth;
                let k = lit;
                while (k > 0 && this.loops.slot(order[k - 1]).birth > born) {
                    order[k] = order[k - 1];
                    k -= 1;
                }
                order[k] = i;
                lit += 1;
            }
        }
        let tear = lit;
        if (!quad && (chain >= 2 || depth > 0)) {
            const keep = Math.min(CROWN_MAX, Math.floor(lit * Math.min(0.75, 0.3 + 0.05 * chain)));
            tear = Math.max(Math.min(lit, 2 + Math.ceil(depth / 2)), lit - keep);
        }
        const mixRgb = [0, 0, 0];
        let weight = 0;
        let torn = 0;
        const each = loopSparkShare(this.sparks.count, Math.max(1, tear));
        for (let j = 0; j < lit && torn < tear; j++) {
            const i = order[j];
            const held = this.loops.held(i, this.time);
            const entry = this.loops.slot(i);
            const at = birth + torn * 0.045;
            if (this.loops.erupt(i, at)) {
                for (let c = 0; c < 3; c++) mixRgb[c] += entry.rgb[c] * held;
                weight += held;
                torn += 1;
                this.schedule(at, 'shed', {
                    site: [...entry.site],
                    lift: 1 + entry.height * 0.7,
                    rgb: [...entry.rgb],
                    n: each,
                    speed: 20 + n * 4 + depth * 3,
                });
            }
        }
        // The star's own fire, a step hotter than it is (a cascade's later waves hotter still),
        // with a breath of what was torn off; a four flares in the nova's colour; a back-to-back
        // burns half in it.
        const own = emberColor(Math.min(0.74 + 0.04 * depth, this.heat + 0.1 + 0.04 * n + 0.05 * depth), this._colour);
        let rgb = [...own];
        if (quad) rgb = [...NOVAFIRE];
        else if (weight > 0.05) {
            const k = Math.min(0.34, weight / 5);
            rgb = rgb.map((c, i) => c * (1 - k) + (mixRgb[i] / weight) * k);
        }
        if (b2b && !quad) rgb = rgb.map((c, i) => c * 0.55 + NOVAFIRE[i] * 0.45);
        const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
        rgb = rgb.map((c) => (c / peak) * 0.96 + 0.04);
        const base = 0.55 + 0.16 * n + Math.min(0.35, weight * 0.08) + (quad ? 0.3 : 0);
        let strength = Math.min(1.9, base * (1 + 0.14 * depth + 0.12 * fever) * (b2b ? 1.15 : 1));
        // A cascade's later wave builds on the one before it, whatever it had left to tear.
        const prev = this.lastWave;
        const builds = depth > 0 && prev.depth === depth - 1 && this.time - prev.time < 1;
        if (builds) strength = Math.max(strength, Math.min(1.9, prev.strength * 1.1));

        // ── The wave leaves the star, toward the board ──
        const slot = this.takeWaveSlot();
        const card = cardUnion(this.layout) || {
            x0: 0.4, x1: 0.6, y0: 0.1, y1: 0.9,
        };
        let dx = ((card.x0 + card.x1) * 0.5 - this.heart.x) * this.aspect;
        let dy = -((card.y0 + card.y1) * 0.5 - this.heart.y);
        const dl = Math.hypot(dx, dy) || 1;
        dx /= dl;
        dy /= dl;
        let cover = quad ? 1 : Math.min(1, [0.24, 0.36, 0.56][n - 1] + 0.1 * depth + 0.08 * fever);
        if (builds) cover = Math.min(1, Math.max(cover, prev.cover + 0.06));
        const fronts = perfect ? 4 : Math.min(4, n + (depth > 1 ? 1 : 0));
        const thick = quad ? 1.5 : 1 + 0.08 * Math.min(4, depth);
        u.waves.array[slot * 3].set(birth, strength, fronts, thick);
        prev.time = this.time;
        prev.depth = depth;
        prev.strength = strength;
        prev.cover = cover;
        u.waves.array[slot * 3 + 1].set(rgb[0], rgb[1], rgb[2], cover);
        u.waves.array[slot * 3 + 2].set(dx, dy, 0, 0);
        this.swells.swell.hit(0.3 + 0.12 * n, birth);
        this.schedule(birth + 0.08, 'kick', 0.2 + 0.1 * n + 0.05 * Math.min(4, depth));
        this.swells.gust.hit(0.35 + 0.15 * n + 0.1 * Math.min(4, depth), this.time);

        // ── The cleared rows leave the card as blades of light ──
        const board = boardFor(this.layout, player);
        const ownCard = this.cardFor(board);
        if (board && ownCard && this.layoutLive && !screen) {
            const list = Array.isArray(rows) && rows.length ? rows : Array.from({ length: n }, (_, i) => 19 - i);
            const ys = [];
            for (let i = 0; i < list.length && i < 4; i++) ys.push(boardPoint(board, 0.5, list[i], this._point).y);
            this.beams.fire(ys, ownCard.x0, ownCard.x1, rgb, this.time, Math.min(1.5, 0.7 + 0.18 * n + 0.08 * depth));
        }

        if (quad) {
            // The ember holds its breath; then it flares. From cold it holds it fully; the hotter
            // play already runs the shallower it is (a four mid-fever is an inhale, not a
            // blackout), and Reduce flashing keeps only a breath of it (ADR-0021).
            this.hushUntil = this.time + HUSH_HOLD;
            this.hushDepth = Math.max(0.12, 1 - 1.15 * level - 0.5 * fever) * flashScale();
            // The four burns what the chain had built: once its flare cools, the coal is cooler.
            this.chainHeat = Math.max(heatForCombo(Math.min(1, chain)), this.chainHeat - QUAD_SPEND);
            this.schedule(birth, 'surge', perfect ? 1.3 : 1);
            this.ripple(birth, this.reducedMotion ? 0.25 : 1);
            this.twistVelocity += 1.2;
            this.schedule(birth, 'shed', {
                site: [0, 0, 0], lift: 0, rgb: [...NOVAFIRE], n: this.sparks.count * 0.26, speed: 44, nova: true,
            });
            this.counts.quads += 1;
        } else if (n === 3) {
            this.swells.surge.hit(0.3, this.time);
        }
        if (tspin) {
            // The star spins up and the corona winds into a pinwheel.
            this.twistVelocity += 3.4;
            this.swells.spinKick.hit(1, this.time);
            this.ripple(this.time, this.reducedMotion ? 0.1 : 0.4);
        }
        if (b2b) {
            // A back-to-back rings the limb in gold, brighter with each one in a row.
            this.b2bStreak += 1;
            this.swells.b2b.hit(0.55 + 0.2 * Math.min(4, this.b2bStreak - 1), this.time);
            this.ripple(birth, this.reducedMotion ? 0.08 : 0.3);
        } else if (!quad && !tspin) this.b2bStreak = 0;
        this.counts.eruptions += torn;
        this.counts.clears += 1;
    }

    /**
     * A perfect clear, settled after the clear that made it (physics sends it ~360 ms after the
     * last wave): the crown on the four still playing, never a second one. No hush and no second
     * flare: the corona blazes out to its full reach and its limb rings in gold, the belt's stones
     * catch fire, a ring of four fronts runs round the whole star, and a crown of sparks leaves it
     * in the pieces' own flames.
     */
    onCrown() {
        const { u } = this;
        if (!u || !this.loops) return;
        const t = this.time;
        this.play.crown(t);
        this.swells.crown.hit(1, t);
        this.swells.surge.hit(0.3, t);
        this.swells.gust.hit(0.8, t);
        this.swells.swell.hit(0.4, t);
        const slot = this.takeWaveSlot();
        u.waves.array[slot * 3].set(t, 1.3, 4, 1.3);
        u.waves.array[slot * 3 + 1].set(CROWNFIRE[0], CROWNFIRE[1], CROWNFIRE[2], 1);
        u.waves.array[slot * 3 + 2].set(1, 0, 0, 0);
        this.ripple(t, this.reducedMotion ? 0.15 : 0.55);
        // Whatever the four left on the star (nothing, usually) goes too.
        let torn = 0;
        const each = loopSparkShare(this.sparks.count, Math.max(1, this.loops.litCount(t)));
        for (let i = 0; i < LOOP_SLOTS; i++) {
            const held = this.loops.held(i, t);
            const entry = this.loops.slot(i);
            const at = t + torn * 0.045;
            if (held > 0.03 && this.loops.erupt(i, at)) {
                torn += 1;
                this.schedule(at, 'shed', {
                    site: [...entry.site], lift: 1 + entry.height * 0.7, rgb: [...entry.rgb], n: each, speed: 30,
                });
            }
        }
        CROWN_FLAMES.forEach((rgb, k) => {
            if (k % 2) return;
            this.schedule(t + k * 0.04, 'shed', {
                site: [0, 0, 0], lift: 0, rgb: [...rgb], n: this.sparks.count * 0.08, speed: 30 + k * 3, nova: true,
            });
        });
        // ...and the star is crowned: a ring of prominences stands round its limb, one in each of
        // the pieces' flames, and holds until the next clear lets it go.
        for (let k = 0; k < CROWN_LOOPS; k++) {
            const a = (k / CROWN_LOOPS) * TAU + 0.35;
            this._vec.copy(this._right).multiplyScalar(Math.cos(a)).addScaledVector(this._up, Math.sin(a))
                .addScaledVector(this._f, 0.22)
                .normalize()
                .applyMatrix3(u.starInv.value);
            this.loops.raise(this.loops.weakest(0, LOCK_LOOPS, t), {
                site: [this._vec.x, this._vec.y, this._vec.z],
                azimuth: a * 1.7,
                span: 0.13 + (k % 3) * 0.025,
                height: 0.26 + (k % 2) * 0.1,
                rgb: CROWN_FLAMES[k % CROWN_FLAMES.length],
                time: t + 0.12 + k * 0.035,
                strength: 1,
                seed: 4001 + k,
            });
        }
        this.schedule(t + 0.06, 'kick', 0.35);
        this.counts.eruptions += torn;
        this.counts.crowns += 1;
    }

    /** A T-spin that cleared nothing: the star still turns a little and the corona winds up. */
    onSpin() {
        if (!this.u) return;
        this.play.spin(this.time);
        this.twistVelocity += 1.6;
        this.swells.spinKick.hit(0.45, this.time);
        this.swells.gust.hit(0.3, this.time);
        this.ripple(this.time, this.reducedMotion ? 0.04 : 0.15);
        this.counts.spins += 1;
    }

    /**
     * Send a ring through the picture. A ring still on its way (or still on screen and bright)
     * takes the new one's energy and runs on, so two clears close together swell one ring instead
     * of restarting it from the star; a faded or far one gives way.
     */
    ripple(birth, strength) {
        const live = this.spaceRipple;
        const age = this.time - live.birth;
        const decay = age > 0 ? Math.exp(-age / 0.85) : 1;
        const liveNow = live.strength * decay;
        if (liveNow > 0.02 && age < 1.1 && liveNow >= strength * 0.3) {
            live.strength = Math.min(1.3, liveNow + strength * 0.35) / decay;
            return;
        }
        this.spaceRipple = { birth, strength };
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        // The chain broke: the ember lets its breath go, and a long one lets go of the crown it
        // kept: every loop it still holds flies.
        if (n === 0 && this.combo >= 2) {
            this.swells.dip.hit(0.25, this.time);
            if (this.combo >= 3) this.letGo();
        }
        // Another step of the chain: the ember is blown on. A breath of brighter fire washes
        // over its face from the side the board is on, a gust goes through the wind, and the fire
        // it blows up stands on the star as loops of its own (so the next clear always has
        // something to throw).
        if (n >= 2 && n > this.combo) {
            this.swells.gust.hit(Math.min(1, 0.3 + 0.1 * n) * 0.6, this.time);
            this.swells.flash.hit(0.06, this.time);
            if (this.u && this.loops) {
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
                const site = [this._vec.x, this._vec.y, this._vec.z];
                const fire = emberColor(Math.min(0.8, heatForCombo(n) + 0.25), this._colour);
                this.strike(site, fire, this.time, Math.min(1.1, 0.5 + 0.08 * n));
                this.raiseFire(n, site, fire);
            }
        }
        this.combo = n;
    }

    /** The fire a chain's step blows up: one loop (two from the sixth step) by the board's side. */
    raiseFire(n, site, fire) {
        const peak = Math.max(fire[0], fire[1], fire[2], 1e-4);
        const rgb = [fire[0] / peak, fire[1] / peak, fire[2] / peak];
        const count = n >= 6 ? 2 : 1;
        for (let k = 0; k < count; k++) {
            const rand = mulberry32(0x3c1d + n * 7919 + k * 131 + this.counts.clears * 31);
            const p = [site[0] + (rand() - 0.5) * 0.5, site[1] + (rand() - 0.5) * 0.5, site[2] + (rand() - 0.5) * 0.5];
            const pl = Math.hypot(p[0], p[1], p[2]) || 1;
            const slot = this.loops.weakest(0, LOCK_LOOPS, this.time);
            this.loops.raise(slot, {
                site: [p[0] / pl, p[1] / pl, p[2] / pl],
                azimuth: rand() * TAU,
                span: 0.1 + rand() * 0.08,
                height: 0.16 + rand() ** 1.5 * 0.22,
                rgb,
                time: this.time,
                strength: 0.75,
                seed: 997 + n * 13 + k,
            });
        }
    }

    /** The chain is over: the star lets go of what it kept, one loop after another. */
    letGo() {
        if (!this.loops || !this.sparks) return;
        const each = loopSparkShare(this.sparks.count, Math.max(1, this.loops.litCount(this.time, 0, LOCK_LOOPS)));
        let torn = 0;
        for (let i = 0; i < LOCK_LOOPS; i++) {
            const held = this.loops.held(i, this.time);
            const entry = this.loops.slot(i);
            const at = this.time + torn * 0.06;
            if (held > 0.03 && this.loops.erupt(i, at)) {
                torn += 1;
                this.schedule(at, 'shed', {
                    site: [...entry.site], lift: 1 + entry.height * 0.7, rgb: [...entry.rgb], n: each, speed: 18,
                });
            }
        }
        this.counts.eruptions += torn;
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
            const slot = this.takeWaveSlot();
            this.u.waves.array[slot * 3].set(this.time, 0.75, 1, 1.8);
            const cold = tint.map((c) => (c / peak) * 0.8 + 0.2);
            this.u.waves.array[slot * 3 + 1].set(cold[0], cold[1], cold[2], 1);
            this.u.waves.array[slot * 3 + 2].set(1, 0, 0, 0);
            this.swells.flash.hit(0.12, this.time);
            this.swells.gust.hit(0.6, this.time);
            this.play.levelUp(this.time);
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
        // Reduce flashing (ADR-0021): every frame-wide flash below is scaled by it.
        const fs = flashScale();

        // ── The heat ──
        this.stoke *= Math.exp(-dt / STOKE_COOL);
        this.drain(t);
        // How hot play runs (src/themes/shared/gameplay-surge.js), read once a frame on this clock.
        const play = this.play.sample(t);
        const now = this.playNow;
        now.punch = play.punch;
        now.level = play.level;
        now.fever = play.fever;
        now.stage = play.stage;
        const { level, fever } = now;
        const { surge, gust } = this;
        const flash = this.flash * fs;
        // A chain blows the ember up toward heatForCombo, but past its first clear's heat no
        // faster than CHAIN_RISE a second: a long chain climbs from a coal to gold over its whole
        // length. A break lets the goal go at once; the ember itself cools slowly (below).
        const goal = heatForCombo(this.combo);
        if (goal > this.chainHeat) {
            const first = heatForCombo(Math.min(1, this.combo));
            this.chainHeat = Math.min(goal, Math.max(this.chainHeat, first) + dt * CHAIN_RISE);
        } else this.chainHeat = goal;
        // A quick hand fans the coal too, chain or not; every lock stokes it; a four's flare takes
        // it most of the way from there to HEAT_FLARE and lets it back as the overdrive cools.
        const pace = REST_HEAT + PACE_HEAT * (0.7 * level + 0.3 * fever);
        const base = Math.min(HEAT_FLARE, emberBase(Math.max(this.chainHeat, pace) + this.stoke));
        const target = base + (HEAT_FLARE - base) * Math.min(1, surge * FLARE_SHARE);
        this.heat += (target - this.heat) * approach(target > this.heat ? 2.6 : 0.55, dt);
        const hush = t < this.hushUntil ? this.hushDepth : 0;
        const breathTarget = hush > 0 ? 1 - 0.9 * hush : 1 - this.dip;
        this.breath += (breathTarget - this.breath) * approach(hush > 0 ? 40 : 14, dt);
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
        // Heat boils the star and streams its wind; hot play turns it, churns it and blows harder.
        const { heat } = this;
        const hurry = this.reducedMotion ? 0 : 1;
        this.spin += dt * SPIN_RATE * motion * (1 + (this.spinKick * 9 + fever * 2) * hurry);
        this.boil += dt * motion * (0.6 + heat * 2.2 + (surge * 3 + level * 0.6 + fever * 1.2) * hurry);
        this.flow += dt * motion * (0.5 + heat * 1.6 + (surge * 4 + gust * 2 + level * 0.8 + fever * 1.6) * hurry);

        this.raiseAmbient();
        this.pose();

        // ── Uniforms ──
        let impactsLive = 0;
        for (let i = 0; i < IMPACT_SLOTS; i++) {
            const birth = u.impacts.array[i * 3].w;
            const life = u.impacts.array[i * 3 + 2].x;
            if (i < this.impactCursor && t - birth < Math.min(30, Math.max(3, life * 5))) impactsLive = i + 1;
        }
        u.impactCount.value = impactsLive;
        u.time.value = t;
        u.boil.value = this.boil;
        u.flow.value = this.flow;
        u.heat.value = heat;
        u.breath.value = this.breath;
        u.twist.value = this.twist * (this.reducedMotion ? 0.25 : 1);
        // The acts of play, spent on the world's own parts (never on the sky as a whole).
        const warmAct = smooth(0.15, 0.55, level);
        const hotAct = smooth(0.4, 0.85, level);
        const crown = this.swells.crown.valueAt(t);
        const b2b = this.swells.b2b.valueAt(t);
        u.loopGrow.value = 0.35 * hotAct + 0.65 * fever + 0.35 * crown;
        u.blaze.value = 0.3 * hotAct + 0.8 * fever + 0.5 * crown;
        // What the star casts on the belt, the cinder world and the dust (never past gold in
        // colour: a white-gold star's light would turn the belt and the dust cream).
        const light = emberColor(Math.min(heat + 0.1, 0.9), this._light);
        const cast = 2.4 + 6.5 * Math.max(0, heat) ** 1.4 + flash * 4;
        u.starLight.value.set(light[0] * cast, light[1] * cast, light[2] * cast);
        const stain = 2.2 + 1.6 * heat + flash * 2;
        u.skyLight.value.set(light[0] * stain, light[1] * stain, light[2] * stain);
        const p = this._palette;
        u.voidCol.value.set(p.void[0], p.void[1], p.void[2]);
        u.dustA.value.set(p.dustA[0], p.dustA[1], p.dustA[2]);
        u.dustB.value.set(p.dustB[0], p.dustB[1], p.dustB[2]);
        u.rock.value.set(p.rock[0], p.rock[1], p.rock[2]);
        u.fill.value.set(p.fill[0], p.fill[1], p.fill[2]);
        u.starTint.value.set(p.star[0], p.star[1], p.star[2]);
        if (this.corona) {
            // The corona reaches out with the heat of play and runs to its limit in a fever; a
            // back-to-back and a perfect clear ring its limb in gold.
            const cu = this.corona.uniforms;
            cu.reach.value = Math.min(0.76 + 0.24 * Math.min(1, crown + surge), 0.14 + (heat - REST_HEAT) * 0.62
                + surge * 0.4 + gust * 0.08 + 0.04 * warmAct + 0.06 * hotAct + 0.14 * fever + 0.3 * crown);
            cu.gain.value = 0.17 + heat * 0.62 + surge * 0.6 + flash * 0.6 + 0.1 * hotAct + 0.25 * fever + 0.35 * crown;
            cu.fringe.value = 1 + 2.2 * b2b + 1.5 * crown + 0.5 * fever;
        }
        if (this.wind) {
            const wu = this.wind.uniforms;
            wu.emit.value = clamp01(0.14 + (heat - REST_HEAT) * 0.75 + gust * 0.22 + surge * 0.8
                + 0.08 * warmAct + 0.12 * hotAct + 0.25 * fever + 0.3 * crown);
            wu.reach.value = 1.15 + heat * 2.1 + surge * 2.4 + gust * 0.5 + 0.4 * level + 0.9 * fever + 0.8 * crown;
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
        const swell = this.swells.swell.valueAt(t);
        const warm = Math.max(0, heat - REST_HEAT);
        const post = this._post;
        post.heartRadius = this.heartRadius;
        post.flash = this.flash;
        post.kick = this.kick + now.punch * 0.15;
        let rays = Math.min(0.26, 0.05 + warm * 0.2 + surge * 0.1 + swell * 0.08);
        let streak = Math.min(0.5, warm * warm * 0.35 + surge * 0.3 + flash * 0.6);
        if (hush > 0) {
            // The hush takes the streamers with it, as deep as it goes.
            rays += (0.02 - rays) * hush;
            streak *= 1 - hush;
        }
        post.rays = rays;
        post.streak = streak;
        post.haze = (0.35 + warm * 0.9 + surge * 0.6 + fever * 0.35) * (this.reducedMotion ? 0.3 : 1);
        post.bloomBoost = surge * 0.12 + swell * 0.1 + fever * 0.05;
        // The iris closes as the ember heats, so its colours survive the heat. It follows the heat
        // the star has reached, not the surge that is driving it there: like an eye, it is a beat
        // behind, so a four-line flare is at its brightest the moment it goes off. Hot play
        // closes it a touch more, so the gold stays gold.
        post.exposure = 1 / (1 + surge * 0.4 + swell * 0.5 + warm * 1.3 + flash * 0.3 + level * 0.3 + fever * 0.4);
        u.iris.value = (1 / post.exposure) ** 0.8;
        const rippleAge = t - this.spaceRipple.birth;
        post.ripple.radius = Math.max(0, rippleAge) * RIPPLE_SPEED;
        post.ripple.strength = rippleAge >= 0
            ? this.spaceRipple.strength * Math.exp(-rippleAge / 0.85) * smooth(0, 0.12, rippleAge)
            : 0;
        // Waves that have left the frame cost nothing more (once their carried glow is gone too).
        let wavesLive = 0;
        for (let i = 0; i < WAVE_SLOTS; i++) {
            if (t - u.waves.array[i * 3].x < WAVE_LIVE) wavesLive = i + 1;
        }
        const carry = this.carryAt(t);
        u.waveCarry.value = carry > 2e-3 ? carry : 0;
        // How much shell light is crossing the frame at once: past one great shell's worth the
        // shells are eased toward the square root of their sum (u.shellGain).
        let crowd = 0;
        for (let i = 0; i < WAVE_SLOTS; i++) {
            const A = u.waves.array[i * 3];
            const age = t - A.x;
            if (age >= 0 && age < SHELL_LIFE) crowd += A.y * Math.exp(-age / 1.25);
        }
        u.shellGain.value = crowd > 1.2 ? Math.sqrt(1.2 / crowd) : 1;
        this.wavesLive = wavesLive;
        u.wavesLive.value = wavesLive > 0 || carry > 2e-3 ? 1 : 0;
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
            chainHeat: this.chainHeat,
            stoke: this.stoke,
            play: { ...this.playNow },
            b2bStreak: this.b2bStreak,
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
