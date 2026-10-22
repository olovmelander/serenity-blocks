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
 *   T-spin   the arms wind up and spring back (one that clears nothing still turns them a
 *            little and sends a faint ring across the sky).
 *   cascade  every wave of it runs out hotter than the last: wider fronts, nearer starfire, a
 *            knot up the jets and a shooting star more for each.
 *   b2b      the companion galaxy answers across the sky, brighter for every difficult clear
 *            in a row, and two knots chase the eruption up the jets.
 *   perfect  (settling after its clear) crowns the eruption still playing: the nucleus and the
 *            companion blaze gold, a ring and a shower of stars — never a second held breath.
 *
 * It builds with play (shared/gameplay-surge.js): nothing restarts. Flashes, kicks and the
 * clear's swell are Swells that add to what is still lit; clear waves, gas rings, jet bursts and
 * the sky's rings take the slot with the least light left, so a single never cuts a quad. In the
 * middle of a chain the waves only fan the nurseries (they flare and burn on, brighter), so the
 * arms string up with the run's colours; the chain's end lets them all go in one wide wave from
 * the nucleus, as a four-line clear does. The heat of play is the galaxy's own:
 *   calm     as it is at rest;
 *   warm     the star formation quickens (the nurseries and the knots of the arms glow), the
 *            sky's stars brighten and the nucleus stirs;
 *   hot      the pattern turns and the old suns stream faster, the jets stand out along the
 *            axis, the nucleus throws its lens streak;
 *   fever    the quasar ignites: both jets at full reach, the core burning toward starfire, a
 *            storm of shooting stars radiating from the nucleus, the companion awake, the iris
 *            closing so the colours stay deep. A four-line clear mid-fever only inhales.
 * When the hands rest, all of it breathes back to calm over a few seconds.
 *
 * Everything is a function of the world clock and event timestamps (nothing is created at event
 * time), so seek(t) plus a fixed-step replay reproduces any frame.
 */

import * as THREE from 'three/webgpu';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import {
    CLEAR_SLOTS,
    DEG,
    GALAXY,
    GALAXY_PALETTES,
    HUSH_HOLD,
    JET_BURSTS,
    LOCK_SLOTS,
    MAX_RINGS,
    PALETTE_KEYS,
    RIPPLE_FADE,
    SEED_FLIGHT,
    STARFIRE,
    WAVE_LIVE,
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
import { JET_BURST_TRAVEL, createJet, createNucleus } from './galaxy-nucleus.js';
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
/** Seconds a ripple stays in the disc (the shaders skip their loops after; waves: WAVE_LIVE). */
const RIPPLE_LIVE = 4.5;
/** Seconds a sky ring is worth keeping (its light falls as e^(−2.2·age)). */
const SHOCK_LIVE = 3;
/** A chain's knots queue up the jets no further ahead than this; past it they join the last one. */
const KNOT_QUEUE = 1.2;
/** Shooting stars a second a full fever throws from the nucleus (reduced motion: fewer). */
const STORM_RATE = 6;
const STORM_RATE_CALM = 2;
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
/** A combo step's knot up the jets runs this long behind the burst before it (seconds). */
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
        this._burstA = [0, 0];
        this._burstB = [0, 0];
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
        // ── What accumulates (src/themes/shared/swell.js): every hit adds to what is still lit ──
        /** The post's event flash, and the impact that narrows the lens and widens the fringe. */
        this.flashSwell = new Swell({ release: 0.25, ceiling: 0.6, knee: 0.35 });
        this.kickSwell = new Swell({ release: 0.16, ceiling: 1.2, knee: 0.7 });
        /** The nucleus's rays and the iris after a clear (a quad's waits for its held breath). */
        this.clearSwell = new Swell({ release: 0.7, ceiling: 1.3, knee: 0.85 });
        /** A perfect clear's gold crown, and the companion waking on a back-to-back. */
        this.crownSwell = new Swell({
            attack: 0.08, release: 1.8, ceiling: 1.4, knee: 1,
        });
        this.wakeSwell = new Swell({
            attack: 0.1, release: 1.4, ceiling: 1.6, knee: 1.1,
        });
        /** How hot play runs (src/themes/shared/gameplay-surge.js), and its last reading. */
        this.play = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        this.resetState(0);
    }

    /** The post's event flash right now (every hit adds to what is still lit). */
    get flash() {
        return this.flashSwell.valueAt(this.time);
    }

    /** The impact right now: it narrows the lens and widens the fringe. */
    get kick() {
        return this.kickSwell.valueAt(this.time);
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
        this.dip = 0;
        this.breath = 1;
        this.rings = 0;
        this.twist = 0;
        this.twistVelocity = 0;
        this.jetReach = 0.1;
        this.jetGain = 0.07;
        this.hushUntil = -1;
        /** How deep the held breath before a four-line clear goes: shallower the hotter play runs. */
        this.hushDepth = 1;
        this.pendingSurge = { time: Infinity, amount: 0, storm: 0 };
        this.waveRgb = [...STARFIRE];
        this.spaceRipple = { birth: -100, strength: 0 };
        /** The latest burst sent up the jets (a chain's knots queue behind it). */
        this.lastBurst = -Infinity;
        /** Difficult clears in a row (back-to-back). */
        this.b2bRun = 0;
        /** A wave of this chain fanned the nurseries instead of spending them: its end lets them go. */
        this.chainKept = false;
        /** A fever's shooting stars owed (they come out a whole one at a time). */
        this.meteorDebt = 0;
        this.flashSwell.reset();
        this.kickSwell.reset();
        this.clearSwell.reset();
        this.crownSwell.reset();
        this.wakeSwell.reset();
        this.play.reset();
        Object.assign(this.heat, {
            punch: 0, level: 0, fever: 0, stage: 0,
        });
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
            this.u.shockB.value.set(-100, 0);
            this.u.jets.value.set(this.jetReach, this.jetGain, -100, 0);
            this.u.jetBursts.value.set(-100, 0, -100, 0);
            this.u.companion.value.w = 0;
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
        // The impact, riding on the punch of play: under rapid locks the lens stays leaned in.
        const kick = this.kick + this.heat.punch * 0.25;
        const fov = fovForAspect(this.aspect) - kick * 0.45 * calm;
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
        camera.position.set(swayX + px * 0.03 * d, swayY - py * 0.018 * d, kick * 0.012 * d * calm);
        const yaw = (Math.sin(t * 0.037 + 2.1) * 0.006 - px * 0.012) * calm;
        const pitch = (Math.sin(t * 0.029) * 0.004 - py * 0.008) * calm;
        this._look.set(
            camera.position.x + Math.sin(yaw) * 10,
            camera.position.y + Math.tan(pitch) * 10,
            camera.position.z - 10,
        );
        camera.up.set(Math.sin(t * 0.023) * 0.012 * calm, 1, 0);
        camera.lookAt(this._look);
        // The shared breath (shared/camera-breath.js) on top of the drift above: the galaxy hangs
        // `d` out, so the eye moves and turns back to it while the deep sky slides behind. Off
        // under reduced motion.
        applyCameraBreath(camera, t, { distance: d, scale: this.reducedMotion ? 0 : 1 });
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

    /**
     * Send a ring out through the gas from a point of the galaxy's frame. It takes the slot with
     * the least light left in it at its own moment (the oldest of equals), never a brighter one.
     */
    ring(x, z, time, strength, rgb, reach = 1) {
        let slot = 0;
        let least = Infinity;
        let oldest = Infinity;
        for (let i = 0; i < LOCK_SLOTS; i++) {
            const A = this.u.lockA[i].value;
            const age = time - A.z;
            const left = age > RIPPLE_LIVE ? 0 : A.w * Math.exp(-Math.max(0, age) * RIPPLE_FADE);
            if (left < least - 1e-9 || (left <= least + 1e-9 && A.z < oldest)) {
                slot = i;
                least = left;
                oldest = A.z;
            }
        }
        this.u.lockA[slot].value.set(x, z, time, strength);
        this.u.lockC[slot].value.set(rgb[0] * 1.5, rgb[1] * 1.5, rgb[2] * 1.5, reach);
    }

    /**
     * Send a clear wave out from the nucleus at `birth`: `fronts` lines, `strength`, `heat` (wider
     * fronts), in `rgb`. It takes the slot with the least light left at its birth, so the waves of
     * a cascade or a quick chain run out one behind another instead of erasing each other.
     */
    wave(birth, fronts, strength, heat, rgb) {
        const { u } = this;
        let slot = 0;
        let least = Infinity;
        for (let i = 0; i < CLEAR_SLOTS; i++) {
            const A = u.waveA[i].value;
            const age = birth - A.x;
            let left = 0;
            if (age < 0) left = A.z;
            else if (age < WAVE_LIVE) left = A.z * Math.exp(-age / 1.5);
            if (left < least - 1e-9) {
                slot = i;
                least = left;
            }
        }
        u.waveA[slot].value.set(birth, fronts, strength, heat);
        u.waveC[slot].value.set(rgb[0] * 1.25, rgb[1] * 1.25, rgb[2] * 1.25);
        return slot;
    }

    /** Burst slot `i` of the jets as [birth, strength] (slot 0 is u.jets.zw, 1 and 2 u.jetBursts). */
    burstAt(i, out = this._burstA) {
        const { jets, jetBursts } = this.u;
        if (i === 0) {
            out[0] = jets.value.z;
            out[1] = jets.value.w;
        } else {
            out[0] = i === 1 ? jetBursts.value.x : jetBursts.value.z;
            out[1] = i === 1 ? jetBursts.value.y : jetBursts.value.w;
        }
        return out;
    }

    /**
     * A bright head up both jets at `at`. It takes the burst slot with the least left of its run
     * by then (a head that has run the whole reach is spent), so a triple after a quad, or a
     * chain's knots, never pull an eruption's head back to the nucleus.
     */
    burst(at, strength) {
        const { jets, jetBursts } = this.u;
        const run = JET_BURST_TRAVEL * 1.3;
        let slot = 0;
        let least = Infinity;
        for (let i = 0; i < JET_BURSTS; i++) {
            const [birth, power] = this.burstAt(i);
            const age = at - birth;
            let left = power;
            if (age >= run) left = 0;
            else if (age > 0) left = power * (1 - age / run);
            if (left < least - 1e-9) {
                slot = i;
                least = left;
            }
        }
        if (slot === 0) {
            jets.value.z = at;
            jets.value.w = strength;
        } else if (slot === 1) {
            jetBursts.value.x = at;
            jetBursts.value.y = strength;
        } else {
            jetBursts.value.z = at;
            jetBursts.value.w = strength;
        }
        this.lastBurst = Math.max(this.lastBurst, at);
    }

    /**
     * A knot of light up the jets (a chain's step, a cascade's wave): it runs COMBO_PULSE_GAP behind
     * the burst before it, so knots queue up one behind another; past KNOT_QUEUE of queue it
     * joins the last one instead (brighter), never dropped.
     */
    knot(strength) {
        const at = Math.max(this.time, this.lastBurst + COMBO_PULSE_GAP);
        if (at - this.time <= KNOT_QUEUE) {
            this.burst(at, strength);
            return;
        }
        let latest = 0;
        for (let i = 1; i < JET_BURSTS; i++) if (this.burstAt(i)[0] > this.burstAt(latest, this._burstB)[0]) latest = i;
        const [birth, power] = this.burstAt(latest);
        const merged = Math.min(1.4, power + strength * 0.5);
        if (latest === 0) this.u.jets.value.w = merged;
        else if (latest === 1) this.u.jetBursts.value.y = merged;
        else this.u.jetBursts.value.w = merged;
        this.lastBurst = Math.max(this.lastBurst, birth);
    }

    /**
     * A prismatic ring across the sky from the nucleus at `at`. Two can cross at once: it takes
     * the one with less light left, so a T-spin or a new level never cuts an eruption's.
     */
    shockRing(at, strength) {
        const { shock, shockB } = this.u;
        const left = (s) => {
            const age = at - s.value.x;
            if (age < 0) return s.value.y;
            return age > SHOCK_LIVE ? 0 : s.value.y * Math.exp(-age * 2.2);
        };
        (left(shockB) < left(shock) - 1e-9 ? shockB : shock).value.set(at, strength);
    }

    /**
     * Space ripples out from the nucleus at `at`. One ripple bends the picture at a time: a weaker
     * one never cuts one still stronger than it (it rides inside it instead).
     */
    rippleSpace(at, strength) {
        const r = this.spaceRipple;
        const age = at - r.birth;
        const left = age < 0 ? r.strength : r.strength * Math.exp(-age / 0.85);
        if (strength >= left) this.spaceRipple = { birth: at, strength };
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
        // They add to what is still lit: a flurry of hard drops rides up, never flickers.
        this.kickSwell.hit(hardDrop ? 0.5 : 0.1, this.time);
        this.flashSwell.hit(hardDrop ? 0.1 : 0.02, this.time);
        this.play.lock({ hardDrop }, this.time);
        this.counts.locks += 1;
    }

    /**
     * Lines cleared. `lines` 1..4; `tspin`, `perfect`; `rows` = the visible rows that went;
     * `combo` = the true chain this clear is a step of; `cascade` = which wave of its lock this
     * is (1 = the first); `b2b` = a difficult clear right after another; `crown` = a perfect clear
     * that settled after its clear (it crowns what is playing: see onCrown()).
     */
    onClear({
        rows = null, lines = 1, tspin = false, perfect = false, player = 0, screen = null,
        combo = 1, cascade = 1, b2b = false, crown = false,
    } = {}) {
        const { u } = this;
        if (!u || !this.nurseries) return;
        if (crown) {
            this.onCrown();
            return;
        }
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        const chain = Math.max(1, Math.round(Number(combo) || 1));
        const depth = Math.max(1, Math.min(10, Math.round(Number(cascade) || 1)));
        const deep = depth - 1;
        const p = this._palette;
        // One line answers in the rim's light, two in the inner arms', three in the jets'.
        let rgb;
        if (quad) rgb = [...STARFIRE];
        else if (n === 1) rgb = [...p.armOuter];
        else if (n === 2) rgb = [...p.armInner];
        else rgb = [0, 1, 2].map((c) => p.jet[c] * 0.7 + p.nursery[c] * 0.5 + 0.15);
        // Each wave of a cascade burns nearer starfire than the one before it.
        if (deep > 0 && !quad) {
            const k = Math.min(0.7, 0.2 * deep);
            rgb = rgb.map((c, i) => c + (STARFIRE[i] - c) * k);
        }
        const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
        rgb = rgb.map((c) => (c / peak) * 0.9 + 0.1);
        const strength = Math.min(1.9, (0.6 + 0.15 * n + (quad ? 0.25 : 0)) * (1 + 0.15 * deep));
        const birth = quad ? this.time + HUSH_HOLD : this.time;
        const { fever } = this.heat;

        // ── The wave leaves the nucleus: wider for an eruption, a deeper wave, a fever ──
        this.wave(birth, perfect ? 4 : n, strength, (quad ? 1 : 0) + 0.6 * deep + 0.25 * fever, rgb);
        this.clearSwell.hit(0.3 + 0.12 * n + 0.08 * deep, birth);

        // ── The nurseries answer as the wave passes them (see answer()) ──
        // In the middle of a chain (or a cascade) the wave only fans the lit ones: they flare and
        // burn on, brighter, until the chain's end lets them go. Four lines let everything go.
        const keep = !quad && (chain >= 2 || depth >= 2);
        if (keep) this.chainKept = true;
        if (quad) this.chainKept = false;
        // Each nova's share of the debris pool: every nursery answers four lines, the lit ones a
        // lesser clear.
        const expected = quad ? this.nurseries.count : Math.max(1, this.nurseries.litCount(this.time));
        const each = Math.max(3, Math.min(
            Math.round((20 * this.sparks.count) / 640),
            Math.floor((this.sparks.count * 0.8) / expected),
        ));
        this.nurseries.release(birth, {
            floor: quad ? 0.3 : 0, rgb, sparks: keep ? Math.max(2, Math.round(each * 0.6)) : each, keep,
        });
        this.waveRgb = rgb;
        const lit = Math.min(1, this.nurseries.totalHeld(this.time) / 12);
        const storm = Math.min(1.4, 0.3 + 0.14 * n + lit * 0.4 + (quad ? 0.4 : 0) + 0.1 * deep);
        // On four lines the sky answers with the eruption, not with the hush before it.
        if (!quad) this.storm = Math.max(this.storm, storm);
        // A beat after the wave leaves, the impact: it adds to whatever is still lit.
        const amount = 0.22 + 0.1 * n + 0.05 * deep;
        this.kickSwell.hit(amount, birth + 0.1);
        this.flashSwell.hit(amount * 0.5, birth + 0.1);

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
            // The galaxy holds its breath and winds up; then the nucleus erupts. From cold it
            // holds it fully; the hotter play already runs, the more it only inhales.
            this.hushUntil = this.time + HUSH_HOLD;
            this.hushDepth = 1 - 0.85 * this.heat.level;
            const amountSurge = perfect ? 1.3 : 1;
            const pending = this.pendingSurge;
            if (pending.time === Infinity) this.pendingSurge = { time: birth, amount: amountSurge, storm };
            else {
                // A second eruption inside the first's held breath joins it, never replaces it.
                pending.amount = Math.max(pending.amount, amountSurge);
                pending.storm = Math.max(pending.storm, storm);
            }
            this.twistVelocity += 2.2;
            this.burst(birth, perfect ? 1.3 : 1);
            this.shockRing(birth, this.reducedMotion ? 0.5 : 1);
            this.rippleSpace(birth, this.reducedMotion ? 0.25 : 1);
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
            this.burst(this.time, 0.5);
            this.surge = Math.max(this.surge, 0.3);
            this.meteors?.emit({
                n: 3, time: birth + 0.2, rgb: p.nucleus, stagger: 0.6,
            });
        }
        if (deep > 0 && !quad) {
            // A cascade's later wave builds on the last: a knot up the jets, the overdrive
            // climbing, and a shooting star more from the nucleus for each wave.
            this.knot(Math.min(1, 0.3 + 0.1 * depth));
            this.surge = Math.max(this.surge, Math.min(0.5, 0.12 * deep));
            this.meteors?.emit({
                n: deep,
                time: this.time + 0.15,
                rgb: STARFIRE,
                stagger: 0.5,
                size: 2.2,
                radiant: u.nucleusDir.value.toArray(),
            });
        }
        if (tspin) {
            // The arms wind up and spring back; a small ring leaves the nucleus across the sky.
            this.twistVelocity += 3.0;
            if (!quad) {
                this.shockRing(this.time, 0.42);
                this.rippleSpace(this.time, this.reducedMotion ? 0.1 : 0.4);
            }
            this.storm = Math.max(this.storm, 0.85);
        }
        // Difficult clears in a row: the second answers across the sky.
        this.b2bRun = b2b ? this.b2bRun + 1 : 0;
        if (b2b) this.onBackToBack(birth);

        // The heat of play: a cascade's later waves are heard one by one.
        if (deep > 0) this.play.wave(birth);
        else {
            this.play.clear({
                lines: n, combo: chain, tspin, perfect, b2b,
            }, birth);
        }
        this.counts.clears += 1;
    }

    /**
     * A back-to-back: the companion galaxy answers across the sky (brighter for every difficult
     * clear in the row), and two knots chase the clear's own burst up the jets.
     */
    onBackToBack(at) {
        const run = Math.max(1, this.b2bRun);
        this.wakeSwell.hit(0.7 + 0.25 * Math.min(3, run - 1), at);
        this.burst(at + 0.18, 0.65);
        this.burst(at + 0.36, 0.5);
        this.twistVelocity += 1.2;
        this.storm = Math.max(this.storm, 0.7);
    }

    /**
     * A perfect clear that settled after its clear: the crown on the eruption still playing.
     * No second held breath and no second wave: the nucleus and the companion blaze gold, a ring
     * crosses the sky, the jets fire again and the nucleus throws a shower of gold stars.
     */
    onCrown() {
        const { u } = this;
        if (!u) return;
        const t = this.time;
        this.crownSwell.hit(1, t);
        this.wakeSwell.hit(1, t);
        this.flashSwell.hit(0.18, t);
        this.kickSwell.hit(0.35, t);
        this.shockRing(t, this.reducedMotion ? 0.4 : 0.8);
        this.burst(t, 1.1);
        this.surge = Math.max(this.surge, 1.05);
        this.storm = Math.max(this.storm, 1.0);
        this.twistVelocity += 1.0;
        this.meteors?.emit({
            n: Math.round(this.meteors.count * 0.4),
            time: t + 0.1,
            rgb: [1.0, 0.84, 0.52],
            stagger: 1.0,
            size: 2.4,
            radiant: u.nucleusDir.value.toArray(),
        });
        this.play.crown(t);
    }

    /** A T-spin that cleared nothing: the arms turn a little, a faint ring, a knot up the jets. */
    onSpin() {
        if (!this.u) return;
        this.twistVelocity += 1.4;
        this.shockRing(this.time, this.reducedMotion ? 0.12 : 0.22);
        this.knot(0.3);
        this.storm = Math.max(this.storm, 0.4);
        this.flashSwell.hit(0.04, this.time);
        this.play.spin(this.time);
    }

    /**
     * The chain is over: what its waves fanned in the nurseries goes nova at last, in one wide
     * wave from the nucleus in their own colours — the galaxy exhales the run.
     */
    releaseChain() {
        this.chainKept = false;
        const { u, nurseries } = this;
        if (!u || !nurseries) return;
        const lit = nurseries.litCount(this.time);
        if (lit === 0) return;
        const held = nurseries.totalHeld(this.time);
        const p = this._palette;
        let rgb = [0, 1, 2].map((c) => p.nursery[c] * 0.6 + STARFIRE[c] * 0.4);
        const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
        rgb = rgb.map((c) => (c / peak) * 0.9 + 0.1);
        this.wave(this.time, 2, Math.min(1.7, 0.9 + 0.07 * held), 2 + this.heat.fever, rgb);
        const each = Math.max(3, Math.min(
            Math.round((24 * this.sparks.count) / 640),
            Math.floor((this.sparks.count * 0.8) / lit),
        ));
        nurseries.release(this.time, { floor: 0, rgb, sparks: each });
        this.waveRgb = rgb;
        this.storm = Math.max(this.storm, 0.5 + 0.3 * Math.min(1, held / 12));
        this.surge = Math.max(this.surge, 0.25 + 0.15 * Math.min(1, held / 12));
        this.clearSwell.hit(0.45, this.time);
        this.kickSwell.hit(0.2, this.time + 0.1);
        this.flashSwell.hit(0.06, this.time + 0.1);
        this.knot(0.6);
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        if (n === 0 && this.combo >= 2) {
            // The chain broke: the galaxy lets its breath go (less deeply the hotter play ran),
            // and lets go of what the chain's waves kept burning.
            // A chain that kept its light exhales it as a wave instead of sagging.
            const releasing = this.chainKept;
            this.dip = Math.max(this.dip, (releasing ? 0.1 : 0.28) * (1 - 0.5 * this.heat.level));
            if (releasing) this.releaseChain();
        }
        if (n === 0) this.chainKept = false;
        // Another step of the chain: a knot of light runs up both jets, queued behind any burst
        // already on its way.
        if (n >= 2 && n > this.combo && this.u) {
            this.knot(Math.min(0.9, 0.25 + 0.08 * n));
            this.flashSwell.hit(0.05, this.time);
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
            this.flashSwell.hit(0.14, this.time);
            if (this.u) this.shockRing(this.time, 0.36);
            this.meteors?.emit({
                n: 2, time: this.time + 0.3, rgb: GALAXY_PALETTES[this.paletteIndex].nucleus, stagger: 0.8,
            });
            this.play.levelUp(this.time);
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

        // ── How hot play runs (shared/gameplay-surge.js) ──
        const sample = this.play.sample(t);
        const { heat } = this;
        heat.punch = sample.punch;
        heat.level = sample.level;
        heat.fever = sample.fever;
        heat.stage = sample.stage;
        // The acts: warm (the galaxy takes notice), hot (it is alive with the player), fever.
        const warmK = smooth(0.12, 0.4, heat.level);
        const hotK = smooth(0.4, 0.75, heat.level);
        const { fever } = heat;
        const crown = this.crownSwell.valueAt(t);
        const wake = this.wakeSwell.valueAt(t);
        const { flash } = this;

        // ── The charge ──
        const target = powerForCombo(this.combo);
        this.power += (target - this.power) * approach(target > this.power ? 2.4 : 0.8, dt);
        this.surge *= Math.exp(-dt / SURGE_COOL);
        this.storm *= Math.exp(-dt / STORM_COOL);
        this.dip *= Math.exp(-dt / 0.35);
        if (t >= this.pendingSurge.time) {
            // As if it had begun at its own moment, whatever frame noticed it.
            const lateness = t - this.pendingSurge.time;
            this.surge = Math.max(this.surge, this.pendingSurge.amount * Math.exp(-lateness / SURGE_COOL));
            this.storm = Math.max(this.storm, this.pendingSurge.storm * Math.exp(-lateness / STORM_COOL));
            this.pendingSurge.time = Infinity;
        }
        const hush = t < this.hushUntil ? 1 : 0;
        // The held breath: all the way down from cold, a shallow inhale in a fever.
        const breathTarget = hush ? 1 - 0.88 * this.hushDepth : 1 - this.dip;
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

        // The jets: every step of the chain pushes them out; an eruption fires them whole; hot
        // play stands them out along the axis and a fever holds them at their full reach.
        const reachTarget = Math.min(1, 0.1 + 0.6 * this.power ** 1.3 + this.surge * 0.95 + 0.3 * hotK + 0.5 * fever);
        const gainTarget = 0.07 + this.power * 0.85 + this.surge * 1.1 + 0.3 * hotK + 0.8 * fever + crown * 0.5;
        this.jetReach += (reachTarget - this.jetReach) * approach(reachTarget > this.jetReach ? 7 : 1.1, dt);
        this.jetGain += (gainTarget - this.jetGain) * approach(gainTarget > this.jetGain ? 9 : 1.4, dt);

        // ── The slow clocks: the pattern turns and the old suns stream faster with play ──
        const hurry = this.reducedMotion ? 0 : 1;
        const spinUp = this.power * 3 + this.surge * 7 + 1.2 * hotK + 2.5 * fever + crown * 2;
        const flowUp = this.power * 4 + this.surge * 9 + this.storm * 2 + 0.8 * warmK + 1.5 * hotK + 3 * fever;
        this.spin += dt * SPIN_RATE * motion * (1 + spinUp * hurry);
        this.flow += dt * motion * (1 + flowUp * hurry);

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
        // In a fever the nucleus throws a storm of them, radiating out across the sky (never more
        // than the sky has room for: an eruption's volley keeps its own).
        if (fever > 0.05 && dt > 0 && this.meteors) {
            this.meteorDebt += dt * fever * fever * (this.reducedMotion ? STORM_RATE_CALM : STORM_RATE);
            while (this.meteorDebt >= 1) {
                this.meteorDebt -= 1;
                if (this.meteors.liveAt(t) < this.meteors.count * 0.7) {
                    const tones = [this._palette.jet, this._palette.nursery, STARFIRE];
                    this.meteors.emit({
                        n: 1,
                        time: t,
                        rgb: tones[(this.counts.locks + Math.floor(t * 7)) % 3],
                        size: 2.3,
                        radiant: u.nucleusDir.value.toArray(this._s3),
                    });
                }
            }
        } else this.meteorDebt = 0;

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
        // The sky's stars brighten with play.
        u.skyPulse.value = Math.min(
            1.2,
            this.storm * 0.7 + this.surge * 0.5 + 0.15 * warmK + 0.2 * hotK + 0.3 * fever + crown * 0.4,
        );
        u.jets.value.x = this.jetReach;
        u.jets.value.y = this.jetGain;
        u.companion.value.y = t * 0.02;
        u.companion.value.z = 0.7;
        // The companion wakes on a back-to-back, in a fever and under a perfect clear's crown.
        u.companion.value.w = Math.min(2.5, fever * 0.9 + wake + crown * 0.6);
        const p = this._palette;
        // The core burns toward starfire in the overdrive, in a fever and under the crown.
        const fire = clamp01(this.surge * 0.5 + 0.12 * hotK + 0.22 * fever + crown * 0.45);
        const warm = (key, node, gain = 1) => {
            const c = p[key];
            node.value.set(
                (c[0] + (STARFIRE[0] - c[0]) * fire) * gain,
                (c[1] + (STARFIRE[1] - c[1]) * fire) * gain,
                (c[2] + (STARFIRE[2] - c[2]) * fire) * gain,
            );
        };
        const lift = 1 + this.power * 0.25 + this.storm * 0.12
            + 0.04 * warmK + 0.05 * hotK + 0.06 * fever + crown * 0.15;
        warm('core', u.core, lift);
        warm('nucleus', u.nucleus);
        u.armInner.value.set(p.armInner[0] * lift, p.armInner[1] * lift, p.armInner[2] * lift);
        u.armOuter.value.set(p.armOuter[0] * lift, p.armOuter[1] * lift, p.armOuter[2] * lift);
        // Star formation quickens: the nurseries and the knots of the arms glow with play.
        const forming = 1 + 0.12 * warmK + 0.08 * hotK + 0.1 * fever + crown * 0.4;
        u.nursery.value.set(p.nursery[0] * forming, p.nursery[1] * forming, p.nursery[2] * forming);
        u.dust.value.set(p.dust[0], p.dust[1], p.dust[2]);
        u.jet.value.set(p.jet[0], p.jet[1], p.jet[2]);
        u.nebulaA.value.set(p.nebulaA[0], p.nebulaA[1], p.nebulaA[2]);
        u.nebulaB.value.set(p.nebulaB[0], p.nebulaB[1], p.nebulaB[2]);
        u.voidCol.value.set(p.void[0], p.void[1], p.void[2]);
        if (this.nucleus) {
            // The nucleus charges like a quasar: its flare, and (hot) the lens streak through it.
            this.nucleus.uniforms.glare.value.set(
                0.5 + this.power * 1.0 + this.surge * 1.3 + flash * 1.5
                    + 0.1 * warmK + 0.15 * hotK + 0.3 * fever + crown * 1.0,
                this.power * this.power * 0.4 + this.surge * 0.8 + flash * 0.6
                    + 0.2 * hotK + 0.35 * fever + crown * 0.6,
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
        const swell = this.clearSwell.valueAt(t);
        const post = this._post;
        post.flash = flash;
        post.kick = this.kick + heat.punch * 0.25;
        const rays = 0.04 + this.power * 0.14 + this.surge * 0.25 + swell * 0.1
            + 0.02 * warmK + 0.04 * hotK + 0.08 * fever + crown * 0.12;
        post.rays = hush ? rays + (0.02 - rays) * this.hushDepth : rays;
        post.bloomBoost = this.surge * 0.12 + swell * 0.1 + 0.04 * fever + crown * 0.1;
        // The iris closes as the galaxy flares and as play heats, so its colours survive.
        post.exposure = 1 / (1 + this.surge * 1.3 + swell * 0.5 + this.power * 0.25 + this.storm * 0.15
            + 0.08 * warmK + 0.14 * hotK + 0.2 * fever + crown * 0.35);
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
            /** How hot play runs (0..1), the fever (0..1) and the act (0 calm .. 3 fever). */
            heat: this.heat.level,
            fever: this.heat.fever,
            stage: this.heat.stage,
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
