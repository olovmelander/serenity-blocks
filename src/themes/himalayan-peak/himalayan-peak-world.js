/**
 * Himalayan Peak — the world.
 *
 * Owns the baked amphitheatre, the shared uniforms, every scene part, the camera rig and the
 * choreography. Shared by the theme (himalayan-peak-theme.js) and the playground effect
 * (src/playground/effects/himalayan-peak.effect.js), so what is iterated there ships.
 *
 * Dawn on a high pass. The hero peak stands far left with its east face turned to the light;
 * the sun is still under the headwall on the right; a sea of cloud fills the basin between;
 * lines of prayer flags cross the sky from a chorten and a cairn. The board gives its colours
 * to the wind, and the mountain answers with light:
 *
 *   lock     the piece leaves the card as a handful of paper horses in its own colour, thrown
 *            into the wind; a gust runs out along the nearest flag line from where it left, and
 *            the flags it passes take the piece's colour and hold it; a ring of lifted powder
 *            runs over the snow from under the board. A hard drop throws more and hits harder.
 *   clear    the cleared rows leave the card as blades of light and a storm of papers in all
 *            five colours; every flag lets go of the surplus of what it holds and keeps the
 *            rest, so a chain's lines go on filling with the colours played; the sun lifts for
 *            a moment, and a wave of light runs down the mountain, one front a line. A cascade's
 *            every wave runs deeper and hotter than the one before.
 *   combo    the chain raises the sun. Its light comes down the hero's face step by step, the
 *            headwall's shadow draws back across the cloud sea, the shafts open, the crests
 *            smoke harder — and three or four in a row bring the sun itself over the col.
 *            When a long chain ends the lines let everything they hold go to the wind.
 *   four     the mountain holds its breath (as deeply as play is cold), then the sun stands
 *            clear of the wall: the whole amphitheatre is lit at once, the lines let most of
 *            what they hold go, the air fills with papers and diamond dust and an avalanche
 *            goes down the hero's face (a second beside it if the first is still coming down).
 *   crown    a board cleared whole: the ice in the air draws its ring and two mock suns round
 *            the sun, the lines let go of everything, and the spire and the pole send prayers.
 *   b2b      the second difficult clear in a row: the ring flickers up round the sun, the
 *            wave runs down in sunfire and the spire and the pole answer in gold.
 *
 * Under all of it the heat of play (src/themes/shared/gameplay-surge.js) builds: a quick hand
 * raises the wind and the banners off the crests, the lines burn brighter and reach farther,
 * the sun is lifted a little more, the iris closes so the colours stay deep; and in a fever the
 * ring and the mock suns stand round the sun, diamond dust fires all through the air, the sun
 * climbs past where any chain alone would take it. When the hands rest it all breathes back.
 *
 * Everything is a function of the world clock and event timestamps (nothing is created at event
 * time), so seek(t) plus a fixed-step replay reproduces any frame.
 *
 * Two spaces: the amphitheatre hangs under `root`, which upright screens draw narrower about
 * the view axis; what one could walk up to (the pass, the shrine, the flags, the papers) hangs
 * under `near`, which is never narrowed.
 */

import * as THREE from 'three/webgpu';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import {
    AVALANCHE_SLOTS,
    BLESS_MAX,
    DEG,
    EYE,
    FLAG_TURN,
    GALE_EASE,
    GALE_REST,
    HOURS,
    HOUR_KEYS,
    HUSH_HOLD,
    LUNG_TA,
    REST_RIG,
    RING_FADE,
    SUNFIRE,
    SUN_AZIMUTH,
    SUN_ELEVATION,
    SURGE_COOL,
    WIND,
    approach,
    bakeNoise,
    clamp01,
    createFieldTextures,
    createNoiseTexture,
    createPeakUniforms,
    flagPace,
    fovForAspect,
    hourAt,
    pieceColor,
    powerForCombo,
    shadowWeights,
    smooth,
    squeezeForAspect,
    sunDirection,
    sunElevationFor,
} from './himalayan-peak-tsl.js';
import {
    deriveField, deriveFieldInSteps, loadMassif, planMassif,
} from './himalayan-peak-assets.js';
import { sampleField } from './himalayan-peak-field.js';
import {
    BOOTS, anchors, flagLines, linePoint,
} from './himalayan-peak-layout.js';
import { tierFor } from './himalayan-peak-quality.js';
import { SUN_RADIUS, createSky } from './himalayan-peak-sky.js';
import { createMassif } from './himalayan-peak-terrain.js';
import { createCloudSea } from './himalayan-peak-clouds.js';
import { createPassSnow, createShrine } from './himalayan-peak-pass.js';
import { createCords, createFlags } from './himalayan-peak-flags.js';
import { createDust, createPapers, createRowBeams } from './himalayan-peak-fx.js';
import { createAvalanche, createSpindrift } from './himalayan-peak-snow.js';
import { createEagle, loadEagle } from './himalayan-peak-eagle.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './himalayan-peak-composition.js';

export { REST_RIG, fovForAspect };

const PARTS = [
    'sky', 'massif', 'clouds', 'pass', 'shrine', 'cords', 'flags', 'spindrift', 'avalanche', 'papers', 'beams', 'dust',
    'eagle',
];

/** Seconds a clear's lift of the sun takes to settle back to 1/e. */
export const SWELL_FADE = 2.1;
/** The sun breathes this much on its own at rest (radians), over about a minute. */
const IDLE_BREATH = 0.5 * DEG;
/** Metres from the eye at which the papers leave the card's edge. */
export const PAPER_DEPTH = 5.2;
/** The papers pool the handfuls below are sized for; smaller pools throw proportionally fewer. */
const PAPER_POOL = 720;
/**
 * Per second, how fast the mountain's charge closes on the chain's (rising; falling). A chain
 * raises the sun over seconds: the first clears warm the wall, the light comes over it a few
 * clears in, not on the third lock.
 */
const POWER_RISE = 0.6;
const POWER_FALL = 0.7;
/** The share of the heat of play (0..1) that adds to the chain's charge on the sun. */
const PLAY_CHARGE = 0.25;
/** How much higher than any chain alone the sun climbs in a fever (radians). */
const FEVER_RISE = 3.5 * DEG;
/** The deepest a quad's hush holds the light (breath) from cold; a fever only inhales. */
const HUSH_BREATH = 0.12;
/** What a broken chain dims the frame by, from cold (none at all once play runs hot). */
const BREAK_DIP = 0.12;
/** A chain at least this long lets everything the lines hold go when it ends. */
const LONG_CHAIN = 3;

/**
 * Add a new amount `b` to a lingering one `a` without ever lowering it: the larger stands and
 * a part of the smaller adds to it, under a cap.
 */
const gather = (a, b, cap, share = 0.3) => Math.min(cap, Math.max(a, b) + share * Math.min(a, b));

export class HimalayanPeakWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {THREE.WebGPURenderer} [params.renderer]
     * @param {boolean} [params.capture=false]  deterministic captures: no wall-clock anywhere
     * @param {number} [params.seed]
     * @param {object} [params.massif]  heights to use instead of the baked asset (tests)
     * @param {boolean} [params.eagle=true]  fetch the eagle (it joins the scene when it arrives)
     */
    constructor({
        scene, quality = 'High', renderer = null, capture = false, seed, massif = null, eagle = true,
    } = {}) {
        this.wantsEagle = eagle !== false;
        this.eagle = null;
        this.eagleReady = Promise.resolve(false);
        /** The parts a capture asked to see alone (null = all). */
        this.shown = null;
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.renderer = renderer;
        this.capture = capture;
        this.seed = seed;
        this.massif = massif;
        this.field = null;
        this.root = new THREE.Group();
        this.root.name = 'HimalayanPeak';
        this.near = new THREE.Group();
        this.near.name = 'HimalayanPeakNear';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.flags = null;
        this.cords = null;
        this.papers = null;
        this.beams = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.squeeze = 1;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        /** The sun on screen (fractions, y down): where the post's shafts come from. */
        this.heart = { x: 0.86, y: 0.5 };
        /** tan(elevation) of the ground's skyline from the eye, toward the sun. */
        this.skyline = Math.tan(6.4 * DEG);
        this.anchors = null;
        this.lines = [];
        /** Points along the lines as the rest camera sees them: where a gust can start. */
        this.lineSamples = [];
        this._camera = null;
        this._look = new THREE.Vector3();
        this._ray = new THREE.Vector3();
        this._rest = new THREE.PerspectiveCamera(50, 16 / 9, REST_RIG.near, REST_RIG.far);
        this._sun = [0, 0, 0];
        this._tint = new THREE.Vector3();
        this._weights = [0, 0, 0, 0];
        this._point = { x: 0.5, y: 0.5 };
        this._from = [0, 0, 0];
        this._hour = {};
        HOUR_KEYS.forEach((key) => {
            this._hour[key] = [...HOURS[0].cold[key]];
        });
        this._hourStars = HOURS[0].cold.stars;
        this._hourAt = hourAt(1, 0);
        /** A held elevation (captures and tuning): overrides the chain. */
        this.heldElevation = null;
        this._post = {
            heart: this.heart,
            flash: 0,
            kick: 0,
            shafts: 0.2,
            bloomBoost: 0,
            exposure: 1,
            glare: 0,
            glareColor: [1, 0.8, 0.6],
            saturation: 0,
        };
        this.resetState(0);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.combo = 0;
        this.power = 0;
        this.surge = 0;
        this.swell = 0;
        this.storm = 0;
        this.level = 1;
        this.hourIndex = 0;
        this.flash = 0;
        this.kick = 0;
        this.dip = 0;
        this.breath = 1;
        this.spark = 0;
        this.halo = 0;
        this.hushUntil = -1;
        /** How deep the hush under way holds the light (1 from cold; shallower in hot play). */
        this.hushDepth = 1;
        this.elevation = SUN_ELEVATION.rest;
        // Every momentary light ACCUMULATES (src/themes/shared/swell.js): a new event adds to
        // what is still lit and never restarts it, so a single after a quad cannot cut its
        // light, and a quick hand rides on a floor instead of flickering.
        /** The camera's kick and the post's flash. */
        this.kickSwell = new Swell({ release: 0.16, ceiling: 1.2, knee: 0.7 });
        this.flashSwell = new Swell({ release: 0.25, ceiling: 0.5, knee: 0.3 });
        /** A clear's lift of the shafts, the bloom and the iris. */
        this.liftSwell = new Swell({ release: 0.7, ceiling: 1.1, knee: 0.75 });
        /** The ring of ice-light round the sun (four lines, a back-to-back, a crown). */
        this.haloSwell = new Swell({
            attack: 0.12, release: 2.6, ceiling: 1.3, knee: 1,
        });
        /** The heat of play: how long and how hard the hands have been quick. */
        this.play = new GameplaySurge();
        /** The surge as of the last frame (events read it). */
        this.heatOfPlay = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        /** The avalanches under way: when each started down, how hard, and how hard it grows to. */
        this.slides = Array.from({ length: AVALANCHE_SLOTS }, () => ({ birth: -100, strength: 0, target: 0 }));
        this.pendingSwell = { time: Infinity, amount: 0 };
        this.pendingSurge = null;
        this.counts = {
            locks: 0, clears: 0, quads: 0, papers: 0, blessed: 0,
        };
        // The wind is a function of the world clock until gameplay bends it.
        this.windRun = time * WIND.x * (this.reducedMotion ? 0.3 : 1);
        this.gale = GALE_REST;
        this.flutter = (time * flagPace(GALE_REST) * (this.reducedMotion ? 0.3 : 1)) % FLAG_TURN;
        this.flags?.reset();
        this.papers?.reset();
        this.beams?.reset();
        if (this.u) {
            for (let i = 0; i < this.u.waveA.length; i++) this.u.waveA[i].value.set(-100, 1, 0, 3300);
            for (let i = 0; i < this.u.ringA.length; i++) this.u.ringA[i].value.set(0, 0, -100, 0);
            for (let i = 0; i < this.u.gustA.length; i++) this.u.gustA[i].value.set(0, 0, -100, 0);
            this.u.avalanche.value.set(-100, 0, -100, 0);
            this.u.spark.value.set(1, 1, 1, 0);
        }
    }

    /**
     * Read the baked amphitheatre (or generate its stand-in) and derive what the materials need.
     * Never rejects. Must have resolved before build().
     * @returns {Promise<{ source: 'asset' | 'plan' }>}
     */
    async load() {
        if (!this.massif) this.massif = await loadMassif();
        const { massif } = this;
        if (this.disposed) return { source: massif.source };
        const field = await deriveFieldInSteps(massif, this.tier.stride);
        if (!this.disposed) this.field = field;
        return { source: massif.source };
    }

    build() {
        if (!this.field) {
            // build() without load(): the plan stands in.
            this.massif = this.massif || planMassif();
            this.field = deriveField(this.massif);
        }
        const { field, tier } = this;
        const noise = createNoiseTexture(bakeNoise());
        const maps = createFieldTextures(field);
        this.textures.push(noise, maps.shade, maps.horizon, maps.volume, maps.ground);
        const u = createPeakUniforms({ noise, ...maps });
        this.u = u;

        // The ground's skyline from the eye along the sun's bearing: when the disc shows.
        let top = -1;
        for (let r = 300; r < 16000; r += field.cell * 0.5) {
            const x = EYE.x + Math.sin(SUN_AZIMUTH) * r;
            const z = EYE.z - Math.cos(SUN_AZIMUTH) * r;
            top = Math.max(top, (sampleField(field.heights, field.size, x, z) - EYE.y) / r);
        }
        this.skyline = top;
        this.anchors = anchors(field);

        // ── The amphitheatre ──
        this.addPart('massif', createMassif(u, field, { stride: tier.stride, air: tier.air }));
        this.addPart('sky', createSky(u, { cirrus: tier.cirrus }), { space: 'free' });
        this.addPart('clouds', createCloudSea(u, { cloud: tier.cloud, billows: tier.billows, air: tier.air }));
        this.addPart('spindrift', createSpindrift(u, field, tier.spindrift));
        this.addPart('avalanche', createAvalanche(u, field, tier.powder));

        // ── The pass ──
        this.addPart('pass', createPassSnow(u, field, { glints: tier.glints }), { space: 'near' });
        this.addPart('shrine', createShrine(u, field), { space: 'near' });
        this.cords = createCords(u);
        this.addPart('cords', this.cords, { space: 'near' });
        this.flags = createFlags(u, { flags: tier.flags });
        this.addPart('flags', this.flags, { space: 'near' });

        // ── Gameplay effects (pools, always drawn) ──
        this.papers = createPapers(u, tier.papers);
        this.addPart('papers', this.papers, { space: 'near' });
        this.beams = createRowBeams(u);
        this.addPart('beams', this.beams, { space: 'near' });
        if (tier.dust > 0) this.addPart('dust', createDust(u, tier.dust), { space: 'near' });

        this.applyHour(1, 0);
        this.compose();
        this.scene.add(this.root);
        this.scene.add(this.near);
        // The eagle comes when it comes: nothing waits for it (a capture may: `eagleReady`).
        this.eagleReady = !this.wantsEagle ? Promise.resolve(false) : loadEagle().then((gltf) => {
            if (!gltf || this.disposed || !this.u) return false;
            this.eagle = createEagle(this.u, gltf);
            // Its place is squeezed with the world on upright screens, its shape is not.
            this.eagle.space = 'free';
            this.parts.eagle = this.eagle;
            if (this.shown) this.eagle.mesh.visible = this.shown.has('eagle');
            this.scene.add(this.eagle.mesh);
            this.eagle.update(this.time, this.eagleAir());
            return true;
        });
        return this;
    }

    /**
     * `space`: 'far' parts hang under the squeezed root, 'near' ones under the pass's group, and
     * 'free' ones on the scene itself (the dome follows the camera).
     */
    addPart(name, part, { space = 'far' } = {}) {
        this.parts[name] = part;
        part.space = space;
        if (space === 'near') this.near.add(part.mesh);
        else if (space === 'free') this.scene.add(part.mesh);
        else this.root.add(part.mesh);
        this.disposables.push(part);
    }

    /** What the eagle flies in: the eased gale, reduced motion, and the world's squeeze. */
    eagleAir() {
        const air = this._eagleAir || (this._eagleAir = {});
        air.gale = this.gale;
        air.reduced = this.reducedMotion;
        air.squeeze = this.squeeze;
        return air;
    }

    /** Draw only the named parts (captures, bisecting a look). */
    showOnlyParts(names) {
        this.shown = new Set(names);
        Object.keys(this.parts).forEach((name) => {
            this.parts[name].mesh.visible = this.shown.has(name);
        });
    }

    setViewport(bufferWidth, bufferHeight, aspect) {
        if (this.u && bufferWidth > 0 && bufferHeight > 0) this.u.viewport.value.set(bufferWidth, bufferHeight);
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) {
            this.aspect = aspect;
            this.compose();
        }
        if (!this.layoutLive) this.layout = fallbackLayout(this.aspect * 1000, 1000);
    }

    /**
     * The live board / card / HUD rects (screen fractions), or null when no board is on screen:
     * events then aim at where the solo board would be.
     */
    setLayout(rects, aspect) {
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) {
            this.aspect = aspect;
            this.compose();
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
        this.applyHour(1, 0);
    }

    /**
     * A new run (or the end of one): the chain, the level, the flags and everything in flight
     * are dropped, but nothing jumps — the light is left to sink back under the wall on its own,
     * the first hour's colours ease back in, and the wind keeps blowing.
     */
    resetSession() {
        const {
            time, windRun, gale, flutter, power, surge, swell, elevation, breath, storm, halo, spark,
            kick, flash, kickSwell, flashSwell, liftSwell, haloSwell, play, heatOfPlay,
        } = this;
        this.resetState(time);
        // (The heat of play and every light still lit run down on their own.)
        Object.assign(this, {
            windRun,
            gale,
            flutter,
            power,
            surge,
            swell,
            elevation,
            breath,
            storm,
            halo,
            spark,
            kick,
            flash,
            kickSwell,
            flashSwell,
            liftSwell,
            haloSwell,
            play,
            heatOfPlay,
        });
    }

    /** Hold the sun at an elevation (radians), or null to give it back to the chain. */
    holdSun(elevation) {
        this.heldElevation = Number.isFinite(elevation) ? elevation : null;
    }

    /** Called once the camera that will render the world is known. */
    bindCamera(camera) {
        this._camera = camera;
    }

    /** The rest camera for the current aspect (what the composition is measured in). */
    restCamera() {
        const cam = this._rest;
        cam.fov = fovForAspect(this.aspect);
        cam.aspect = this.aspect;
        cam.near = REST_RIG.near;
        cam.far = REST_RIG.far;
        cam.updateProjectionMatrix();
        cam.position.set(EYE.x, EYE.y, EYE.z);
        cam.up.set(0, 1, 0);
        cam.lookAt(EYE.x, EYE.y + Math.tan(REST_RIG.pitch) * 10, EYE.z - 10);
        cam.updateMatrixWorld();
        return cam;
    }

    /**
     * Fit the world to the aspect: upright screens draw the amphitheatre narrower about the
     * view axis, and the flag lines are strung for what the frame shows.
     */
    compose() {
        this.squeeze = squeezeForAspect(this.aspect);
        this.root.scale.set(this.squeeze, 1, 1);
        this.root.updateMatrix();
        this.root.updateMatrixWorld(true);
        if (this.u) this.u.squeeze.value = this.squeeze;
        if (!this.anchors || !this.flags) return;
        this.lines = flagLines(this.anchors, this.aspect);
        this.cords.string(this.lines);
        this.flags.string(this.lines);
        // Where along each line a gust can start, as the rest camera sees it.
        const cam = this.restCamera();
        const p = [0, 0, 0];
        this.lineSamples = [];
        this.lines.forEach((line, id) => {
            const length = Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1], line.b[2] - line.a[2]);
            for (let k = 0; k <= 16; k++) {
                const s = 0.04 + (k / 16) * 0.92;
                linePoint(line, s, p);
                this._ray.set(p[0], p[1], p[2]).project(cam);
                if (this._ray.z > 1) continue;
                this.lineSamples.push({
                    line: id, along: s * length, sx: this._ray.x * 0.5 + 0.5, sy: 0.5 - this._ray.y * 0.5,
                });
            }
        });
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const t = sim.time;
        // (The theme flushes the frame's events between this and update(): they are this frame's.)
        this.time = t;
        const calm = this.reducedMotion ? 0 : 1;
        const fov = fovForAspect(this.aspect) - this.kick * 0.7 * calm;
        if (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        // A slow drift, as of someone standing in the wind, plus the pointer leaning the view.
        const swayX = (Math.sin(t * 0.11) * 0.22 + Math.sin(t * 0.063 + 1.3) * 0.16) * calm;
        const swayY = (Math.sin(t * 0.17 + 0.7) * 0.03 + Math.sin(t * 0.079) * 0.025) * calm;
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        camera.position.set(EYE.x + swayX + px * 0.45, EYE.y + swayY - py * 0.14 - this.kick * 0.03 * calm, EYE.z);
        const yaw = (Math.sin(t * 0.083 + 2.1) * 0.006 - px * 0.02) * calm;
        const pitch = REST_RIG.pitch + (Math.sin(t * 0.097) * 0.004 - py * 0.012) * calm;
        this._look.set(
            camera.position.x + Math.sin(yaw) * 10,
            camera.position.y + Math.tan(pitch) * 10,
            camera.position.z - 10,
        );
        camera.up.set(Math.sin(t * 0.07) * 0.003 * calm, 1, 0);
        camera.lookAt(this._look);
        // The shared breath (shared/camera-breath.js) on top of the drift above: an eye-level
        // view out across the range, so it only turns. Off under reduced motion.
        applyCameraBreath(camera, t, { scale: this.reducedMotion ? 0 : 1 });
        camera.updateMatrixWorld();
        this._camera = camera;
        if (this.u) this.u.pxScale.value = this.u.viewport.value.y / (2 * Math.tan((fov * DEG) / 2));
        this.projectSun(camera);
    }

    /** Where the sun stands on screen: the post's shafts come from there. */
    projectSun(camera) {
        if (!this.u) return;
        const d = this.u.sunDir.value;
        this._ray.set(d.x * this.squeeze, d.y, d.z).normalize().multiplyScalar(1000).add(camera.position);
        this._ray.project(camera);
        this.heart.x = Math.max(-0.5, Math.min(1.5, this._ray.x * 0.5 + 0.5));
        this.heart.y = Math.max(-0.5, Math.min(1.5, 0.5 - this._ray.y * 0.5));
    }

    /** The point `depth` metres along the ray through a screen point (fractions, y down). */
    screenToWorld(sx, sy, depth, out = this._from) {
        const camera = this._camera || this.restCamera();
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        out[0] = camera.position.x + this._ray.x * depth;
        out[1] = camera.position.y + this._ray.y * depth;
        out[2] = camera.position.z + this._ray.z * depth;
        return out;
    }

    /** Where the ray through a screen point meets the pass's snow, at most `far` metres ahead. */
    screenToSnow(sx, sy, far = 13) {
        const camera = this._camera || this.restCamera();
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        const drop = camera.position.y - (BOOTS - 0.2);
        let t = this._ray.y < -1e-3 ? drop / -this._ray.y : far;
        const flat = Math.hypot(this._ray.x, this._ray.z) || 1;
        if (!(t > 0) || t * flat > far) t = far / flat;
        return { x: camera.position.x + this._ray.x * t, z: camera.position.z + this._ray.z * t };
    }

    // ── Gameplay ────────────────────────────────────────────────────────────────

    /** The point on a flag line nearest a screen point, on one side of the card (−1 / +1). */
    nearestLinePoint(sx, sy, side, skipLine = -1) {
        const card = cardUnion(this.layout) || { x0: 0.4, x1: 0.6 };
        const centre = (card.x0 + card.x1) * 0.5;
        let best = null;
        let bestD = Infinity;
        for (let i = 0; i < this.lineSamples.length; i++) {
            const s = this.lineSamples[i];
            if (s.line === skipLine) continue;
            if (s.sx < -0.05 || s.sx > 1.05 || s.sy < -0.1 || s.sy > 1.05) continue;
            // Lines behind the card do not count, nor ones on the far side of it.
            if (s.sx > card.x0 && s.sx < card.x1) continue;
            if ((s.sx - centre) * side < 0) continue;
            const d = Math.hypot((s.sx - sx) * this.aspect, s.sy - sy);
            if (d < bestD) {
                bestD = d;
                best = s;
            }
        }
        return best;
    }

    /**
     * Send a gust along `line` (−1 = every line) from `along` metres down it. It takes the slot
     * whose gust has least left in it (one still running out along a long line keeps going).
     */
    gust(line, along, time, strength) {
        const { u } = this;
        let slot = 0;
        let least = Infinity;
        for (let i = 0; i < u.gustA.length; i++) {
            const A = u.gustA[i].value;
            const left = A.w * Math.exp(-Math.max(0, this.time - A.z) / 2.5);
            if (left < least) {
                least = left;
                slot = i;
            }
        }
        u.gustA[slot].value.set(line, along, time, strength);
    }

    /** The powder ring slot with least light left in it. */
    ringSlot() {
        const { ringA } = this.u;
        let slot = 0;
        let least = Infinity;
        for (let i = 0; i < ringA.length; i++) {
            const A = ringA[i].value;
            const left = A.w * Math.exp(-Math.max(0, this.time - A.z) * RING_FADE);
            if (left < least) {
                least = left;
                slot = i;
            }
        }
        return slot;
    }

    /** The wave slot whose light set off longest ago (it is furthest down the face, or gone). */
    waveSlot() {
        const { waveA } = this.u;
        let slot = 0;
        for (let i = 1; i < waveA.length; i++) if (waveA[i].value.x < waveA[slot].value.x) slot = i;
        return slot;
    }

    /**
     * An avalanche of `strength` starting down at `birth`. A slide that set off moments ago takes
     * the new snow with it (it grows); otherwise the new one starts beside whatever is still
     * coming down, in the slot whose slide set off longest ago.
     */
    slide(birth, strength) {
        let young = -1;
        let oldest = 0;
        for (let i = 0; i < this.slides.length; i++) {
            const s = this.slides[i];
            const since = birth - s.birth;
            const fresh = s.target > 0 && since > -0.6 && since < 2.4;
            if (fresh && (young < 0 || s.birth > this.slides[young].birth)) young = i;
            if (s.birth < this.slides[oldest].birth) oldest = i;
        }
        if (young >= 0) {
            const s = this.slides[young];
            s.target = gather(s.target, strength, 1.5, 0.35);
            return;
        }
        const s = this.slides[oldest];
        s.birth = birth;
        s.strength = strength;
        s.target = strength;
    }

    /** How hot play runs, for the event at hand: the level of the last frame (0..1). */
    heatNow() {
        return this.heatOfPlay.level;
    }

    /** What one flag may hold: more the longer the chain and the hotter play runs. */
    blessCeiling() {
        const fill = Math.max(this.heatOfPlay.level, clamp01((this.combo - 1) / 8));
        return BLESS_MAX * (1 + 0.3 * fill);
    }

    /**
     * Let the lines go at `time` (every flag a moment after its neighbour, out from the centre
     * of the view), holding on to `keep` of what each holds, and throw what they let go to the
     * wind as paper horses in the flags' own colours. `rich` throws more of them.
     */
    releaseLines(time, keep = 0, rich = false) {
        if (!this.flags || !this.papers) return 0;
        const centre = this.screenToWorld(0.5, 0.5, PAPER_DEPTH + 4, [0, 0, 0]);
        const freed = this.flags.release(time, centre, 0.012, keep);
        const each = this.handful(rich ? 5 : 3);
        for (let i = 0; i < freed.length && i < 48; i++) {
            const f = freed[i];
            // What a flag keeps back it does not throw: a surplus goes as a smaller handful.
            const n = keep > 0 ? Math.max(1, Math.round(each * Math.min(1, f.amount / 0.6))) : each;
            this.counts.papers += this.papers.emit({
                from: [f.x, f.y - 0.25, f.z],
                toward: [0.6, 0.7, -0.4],
                n,
                rgb: f.rgb,
                time: f.time,
                speed: [1.5, 5],
                cone: 0.6,
                life: [2.4, 4.2],
                size: 0.08,
                side: f.x < EYE.x ? -1 : 1,
                glow: 1.3,
            });
        }
        return freed.length;
    }

    /** Prayers from the chorten's spire and the cairn's pole: `n` papers each, every colour. */
    sendPrayers(time, n, { speed = [2.5, 8], glow = 1, stagger = 0.4 } = {}) {
        if (!this.papers || !this.anchors) return;
        [[this.anchors.spire, -1], [this.anchors.pole, 1]].forEach(([at, side]) => {
            this.counts.papers += this.papers.emit({
                from: at,
                toward: [side * 0.2, 1, -0.3],
                n: this.handful(n),
                rgb: null,
                time,
                speed,
                cone: 0.7,
                life: [3, 5.5],
                size: 0.09,
                side,
                glow,
                stagger,
            });
        });
    }

    /** Light the chorten's spire in `rgb`, mixed with what it already shows by how much each is. */
    lightSpire(rgb, amount) {
        const s = this.u.spark.value;
        const k = amount / Math.max(1e-4, this.spark + amount);
        s.set(s.x + (rgb[0] - s.x) * k, s.y + (rgb[1] - s.y) * k, s.z + (rgb[2] - s.z) * k, s.w);
        this.spark = Math.max(this.spark, amount);
    }

    /** How many papers a handful of `n` is at this tier. */
    handful(n) {
        return Math.max(1, Math.round((n * this.tier.papers) / PAPER_POOL));
    }

    /**
     * A piece locked. `u` = its column as a fraction of the board width, `rows` = the visible
     * rows it covers, `color` = the piece's colour; `screen` (fractions) replaces the board point.
     */
    onLock({
        u = 0.5, rows = null, hardDrop = false, color = null, player = 0, screen = null,
    } = {}) {
        const { u: uniforms } = this;
        if (!uniforms || !this.papers) return;
        const rgb = pieceColor(color);
        let fx = 0.5;
        let fy = 0.97;
        let wx = 0.5;
        let wy = 0.6;
        let side = u < 0.5 ? -1 : 1;
        if (Math.abs(u - 0.5) < 0.03) side = this.counts.locks % 2 ? 1 : -1;
        if (screen) {
            fx = screen.x;
            fy = Math.max(screen.y, 0.9);
            wx = screen.x;
            wy = screen.y;
            side = screen.x < 0.5 ? -1 : 1;
        } else {
            const board = boardFor(this.layout, player);
            const card = cardUnion(this.layout);
            if (board) {
                const row = Array.isArray(rows) && rows.length ? rows[Math.floor(rows.length / 2)] : 19;
                boardPoint(board, u, row, this._point);
                fx = this._point.x;
                fy = Math.max(board.y1 + 0.04, 0.92);
                // The papers leave the card's edge on the piece's side, at the piece's height.
                const edges = card || board;
                wx = side < 0 ? edges.x0 : edges.x1;
                wy = this._point.y;
            }
        }
        const heat = this.heatNow();
        // ── The ring: the piece lands in the snow under the foot of the board ──
        const strike = this.screenToSnow(fx, fy);
        const slot = this.ringSlot();
        uniforms.ringA[slot].value.set(strike.x, strike.z, this.time, hardDrop ? 1.5 : 1);
        uniforms.ringC[slot].value.set(rgb[0] * 2.2, rgb[1] * 2.2, rgb[2] * 2.2, hardDrop ? 1 : 0.75);

        // ── The handful: the piece's colour thrown into the wind ──
        const from = this.screenToWorld(wx, wy, PAPER_DEPTH);
        this.counts.papers += this.papers.emit({
            from,
            toward: [side * 0.9, 0.55, -0.35],
            n: this.handful(hardDrop ? 44 : 22),
            rgb,
            time: this.time,
            speed: hardDrop ? [3.5, 10] : [2.2, 6.5],
            cone: hardDrop ? 0.62 : 0.45,
            size: 0.105,
            side,
            glow: hardDrop ? 1.5 : 1.1,
            stagger: 0.05,
        });

        // ── The gust: out along the nearest line, and the flags it passes take the colour ──
        // (The hotter play runs, the farther along the line a lock's colour reaches and the
        // more of it the flags take: a quick hand fills the lines.)
        const start = this.nearestLinePoint(wx, wy, side);
        if (start && this.flags) {
            this.gust(start.line, start.along, this.time, hardDrop ? 1.25 : 0.75);
            this.counts.blessed += this.flags.bless(
                start.line,
                start.along,
                rgb,
                this.time,
                (hardDrop ? 1.3 : 0.85) * (1 + 0.4 * heat),
                (hardDrop ? 4.4 : 3) * (1 + 0.7 * heat),
                this.blessCeiling(),
            );
            // Once play runs hot the colour reaches the next line over as well: in a fever
            // every line across the sky fills with the colours played.
            const reach = clamp01((heat - 0.3) / 0.5);
            const next = reach > 0 ? this.nearestLinePoint(wx, wy, side, start.line) : null;
            if (next) {
                this.counts.blessed += this.flags.bless(
                    next.line,
                    next.along,
                    rgb,
                    this.time + 0.08,
                    (hardDrop ? 1.1 : 0.7) * reach,
                    (hardDrop ? 4.4 : 3) * (1 + 0.7 * heat),
                    this.blessCeiling(),
                );
            }
        }
        // The spire takes the piece's colour, mixed into what it still shows.
        this.lightSpire(rgb, hardDrop ? 1 : 0.6);
        this.kickSwell.hit(hardDrop ? 0.5 : 0.1, this.time);
        this.flashSwell.hit(hardDrop ? 0.08 : 0.015, this.time);
        this.storm = Math.max(this.storm, hardDrop ? 0.4 : 0.14);
        this.play.lock({ hardDrop }, this.time);
        this.counts.locks += 1;
    }

    /**
     * Lines cleared. `lines` 1..4; `tspin`, `perfect`, `b2b`; `combo` = the chain's length;
     * `cascade` = which wave of its lock this is (1 the first; each later one runs deeper).
     */
    onClear({
        rows = null, lines = 1, tspin = false, perfect = false, b2b = false, combo = 1, cascade = 1, player = 0,
        screen = null,
    } = {}) {
        const { u } = this;
        if (!u || !this.papers) return;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        // A cascade's waves: each later one runs deeper, hotter and wider than the one before.
        const depth = Math.max(1, Math.min(10, Math.round(Number(cascade) || 1)));
        const deeper = depth - 1;
        const chain = Math.max(1, Math.round(Number(combo) || 1));
        const heat = this.heatNow();
        const birth = quad ? this.time + HUSH_HOLD : this.time;
        const p = this._hour;
        // The wave runs down in the hour's own light; four lines and a back-to-back in sunfire,
        // and a cascade's waves burn toward it.
        let rgb = quad || b2b ? [...SUNFIRE] : [0, 1, 2].map((c) => p.sun[c] * 0.6 + p.glow[c] * 0.6);
        const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
        rgb = rgb.map((c) => (c / peak) * 0.92 + 0.08);
        const burn = Math.min(1, deeper * 0.3);
        rgb = rgb.map((c, k) => c + (SUNFIRE[k] - c) * burn);
        const strength = Math.min(1.5, 0.55 + 0.16 * n + (quad ? 0.3 : 0)) * (1 + 0.14 * deeper);
        const slot = this.waveSlot();
        u.waveA[slot].value.set(birth, perfect ? 4 : Math.min(4, n + deeper), strength, 3300);
        u.waveC[slot].value.set(rgb[0], rgb[1], rgb[2]);
        this.liftSwell.hit(0.3 + 0.12 * n + 0.08 * deeper, birth);
        // (A clear still waiting behind a hush is not forgotten when another arrives.)
        if (this.pendingSwell.time < Infinity) {
            this.swell = gather(this.swell, this.pendingSwell.amount, SUN_ELEVATION.surge);
        }
        if (this.pendingSurge) {
            this.surge = gather(this.surge, this.pendingSurge.amount, 1.4);
            this.pendingSurge = null;
        }
        this.pendingSwell = { time: birth, amount: SUN_ELEVATION.clear[n] + deeper * 0.9 * DEG };
        const kick = 0.2 + 0.1 * n + 0.06 * deeper;
        this.kickSwell.hit(kick, birth + 0.1);
        this.flashSwell.hit(kick * 0.4, birth + 0.1);
        this.storm = Math.max(this.storm, Math.min(1.4, 0.4 + 0.18 * n + (quad ? 0.4 : 0) + 0.1 * deeper));

        // ── The cleared rows leave the card: blades of light, and papers in all five colours ──
        const board = boardFor(this.layout, player);
        const card = cardUnion(this.layout);
        const list = Array.isArray(rows) && rows.length
            ? rows.slice(0, 4)
            : Array.from({ length: n }, (_, i) => 19 - i);
        if (board && card && !screen) {
            const ys = list.map((row) => boardPoint(board, 0.5, row, this._point).y);
            if (this.layoutLive) {
                this.beams.fire(ys, card.x0, card.x1, rgb, this.time, Math.min(1.4, 0.7 + 0.18 * n + 0.1 * deeper));
            }
            ys.forEach((y, k) => {
                [-1, 1].forEach((side) => {
                    const from = this.screenToWorld(side < 0 ? card.x0 : card.x1, y, PAPER_DEPTH);
                    this.counts.papers += this.papers.emit({
                        from,
                        toward: [side, 0.5, -0.3],
                        n: this.handful((quad ? 34 : 22) * (1 + 0.25 * deeper)),
                        rgb: null,
                        time: birth + k * 0.03,
                        speed: [3.5, (quad ? 13 : 9.5) + deeper],
                        cone: 0.5,
                        life: [3, 5.2],
                        size: 0.09,
                        side,
                        glow: 0.7 + 0.15 * deeper,
                        stagger: 0.12,
                    });
                });
            });
            if (quad) {
                // Four lines: the card's shoulders throw a fountain as well.
                [-1, 1].forEach((side) => {
                    const from = this.screenToWorld(side < 0 ? card.x0 : card.x1, card.y0 + 0.02, PAPER_DEPTH);
                    this.counts.papers += this.papers.emit({
                        from,
                        toward: [side * 0.35, 1, -0.4],
                        n: this.handful(70),
                        rgb: null,
                        time: birth + 0.05,
                        speed: [5, 15],
                        cone: 0.42,
                        life: [3.6, 6],
                        size: 0.095,
                        side,
                        glow: 1.1,
                        stagger: 0.3,
                    });
                });
            }
        }

        // ── Every line snaps (harder with every wave of a cascade), and the flags let go ──
        this.gust(-1, 0, birth, Math.min(1.9, 0.8 + 0.2 * n + 0.15 * deeper));
        if (deeper === 0) {
            // What they let go of: everything on a perfect clear; most of it on four lines;
            // otherwise only the surplus, the more of it kept the longer the chain, so a
            // chain's lines go on filling with the colours played. (A cascade's later waves
            // are the same lock: the lines hold.)
            let keep = Math.min(0.82, 0.5 + 0.055 * (chain - 1));
            if (quad) keep = 0.3;
            if (perfect) keep = 0;
            this.releaseLines(birth, keep, quad);
        }

        if (quad) {
            // The mountain holds its breath, then the sun stands clear of the wall. From cold it
            // holds it fully; the hotter play already runs, the less: a quad in a fever inhales.
            this.hushUntil = this.time + HUSH_HOLD;
            this.hushDepth = 1 - 0.85 * heat;
            this.pendingSurge = { time: birth, amount: perfect ? 1.3 : 1 };
            this.slide(birth + 0.35, perfect ? 1.2 : 1);
            this.haloSwell.hit(perfect ? 1 : 0.55, birth + 0.2);
            this.counts.quads += 1;
        } else if (n === 3) {
            this.slide(birth + 0.25, 0.55);
        }
        if (b2b) {
            // The second difficult clear in a row: the ring flickers up round the sun, and the
            // spire and the pole answer in gold.
            this.haloSwell.hit(0.42, birth + 0.15);
            this.lightSpire(LUNG_TA[4], 1);
            this.sendPrayers(birth + 0.1, 18, { speed: [3, 9], glow: 1.4, stagger: 0.25 });
            this.gust(-1, 0, birth + 0.3, 0.9);
        }
        if (tspin) {
            // The wind turns on itself: a second snap a moment later, the crests throw more,
            // and a wheel of papers spins up round the card before the wind takes it.
            this.gust(-1, 0, birth + 0.22, 1.2);
            this.storm = Math.max(this.storm, 1.1);
            this.wheel(birth, card, screen, 14, 7);
        }
        if (deeper === 0) {
            this.play.clear({
                lines: n, combo: chain, tspin, perfect, b2b,
            }, birth);
        } else {
            // (One more wave of a lock already counted: its own worth, and its lines'.)
            this.play.wave(birth);
        }
        this.counts.clears += 1;
    }

    /** A wheel of `spokes` handfuls of `each` papers spinning up round the card. */
    wheel(birth, card, screen, spokes, each) {
        if (!card || screen) return;
        const cx = (card.x0 + card.x1) * 0.5;
        const cy = (card.y0 + card.y1) * 0.5;
        const centre = this.screenToWorld(cx, cy, PAPER_DEPTH, [0, 0, 0]);
        for (let k = 0; k < spokes; k++) {
            const a = (k / spokes) * Math.PI * 2;
            // Round the card's rim, each thrown along the rim: a wheel.
            const sx = cx + Math.cos(a) * (card.x1 - card.x0) * 0.62;
            const sy = cy + Math.sin(a) * (card.y1 - card.y0) * 0.56;
            const from = this.screenToWorld(sx, sy, PAPER_DEPTH);
            const out = [from[0] - centre[0], from[1] - centre[1], from[2] - centre[2]];
            this.counts.papers += this.papers.emit({
                from,
                toward: [out[1] + out[0] * 0.25, -out[0] + out[1] * 0.25, -0.2],
                n: this.handful(each),
                rgb: null,
                time: birth + k * 0.018,
                speed: [5, 9],
                cone: 0.16,
                life: [2.6, 4.4],
                size: 0.095,
                side: Math.cos(a) < 0 ? -1 : 1,
                glow: 1.2,
                stagger: 0.08,
            });
        }
    }

    /**
     * A board cleared whole, settled after its clear (physics sends it in a frame of its own):
     * the crown on what is still playing, never a second clear and never a second hush. The ice
     * in the air draws its whole ring and the mock suns round the sun, the lines let go of
     * everything they hold, the spire and the pole send prayers in every colour, the light runs
     * down the face once more in sunfire, and the slide still coming down grows.
     */
    onCrown() {
        const { u } = this;
        if (!u || !this.papers) return;
        const t = this.time;
        this.haloSwell.hit(1, t + 0.1);
        this.releaseLines(t, 0, true);
        this.sendPrayers(t, 46, { speed: [3, 10], glow: 1.5, stagger: 0.5 });
        this.lightSpire(LUNG_TA[4], 1);
        const slot = this.waveSlot();
        u.waveA[slot].value.set(t, 4, 1.6, 3300);
        u.waveC[slot].value.set(SUNFIRE[0], SUNFIRE[1], SUNFIRE[2]);
        this.surge = Math.min(1.4, this.surge + 0.3);
        this.slide(t + 0.2, 0.8);
        this.gust(-1, 0, t, 1.5);
        this.storm = Math.max(this.storm, 1.2);
        this.kickSwell.hit(0.35, t);
        this.flashSwell.hit(0.14, t);
        this.liftSwell.hit(0.5, t);
        this.play.crown(t);
    }

    /** A T-spin that cleared nothing: the wind turns on itself, a little. */
    onSpin({ player = 0 } = {}) {
        if (!this.u || !this.papers) return;
        const t = this.time;
        const card = player === 0 ? cardUnion(this.layout) : null;
        this.gust(-1, 0, t + 0.05, 0.7);
        this.storm = Math.max(this.storm, 0.5);
        this.wheel(t, card, null, 8, 4);
        this.kickSwell.hit(0.15, t);
        this.play.spin(t);
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        if (n === 0 && this.combo >= 2) {
            // The chain broke: the mountain lets its breath go. From cold the light sinks a
            // little; once play runs hot it does not dim at all.
            this.dip = Math.max(this.dip, BREAK_DIP * (1 - this.heatNow()));
            // A long chain's lines let go of everything they gathered, once the gust of the lock
            // that broke it has landed: a sky full of the colours played.
            if (this.combo >= LONG_CHAIN) this.releaseLines(this.time + 0.3, 0, true);
        }
        this.combo = n;
    }

    /** A new level: the hours turn a whole step (time turns them slowly in between). */
    levelUp(level, { silent = false } = {}) {
        this.level = Math.max(1, Math.round(Number(level) || 1));
        this.hourIndex = (this.level - 1) % HOURS.length;
        if (silent) {
            this.applyHour(1, this.heat());
            return;
        }
        this.storm = Math.max(this.storm, 0.9);
        this.flashSwell.hit(0.12, this.time);
        this.play.levelUp(this.time);
        if (!this.u || !this.papers || !this.anchors) return;
        // New prayers from the spire and the pole, and every line snaps.
        this.gust(-1, 0, this.time, 1.1);
        this.sendPrayers(this.time, 40);
        this.lightSpire(LUNG_TA[4], 1);
    }

    /** The run is over: the light goes back under the wall. */
    onGameOver() {
        this.combo = 0;
        this.dip = Math.max(this.dip, 0.4);
    }

    /** How far the mountain is from waiting (0) to lit (1), for the hour's colours. */
    heat() {
        return clamp01((this.elevation - SUN_ELEVATION.rest) / (SUN_ELEVATION.full - SUN_ELEVATION.rest));
    }

    /**
     * Ease the live colours toward where the light stands among the hours now (the level's
     * hour, carried on by the clock), each hour mixed by `heat` (k = 1 snaps).
     */
    applyHour(k, heat) {
        const at = hourAt(this.level, this.time, this._hourAt);
        const a = HOURS[at.from];
        const b = HOURS[at.to];
        const p = this._hour;
        const w = smooth(0, 1, heat);
        for (let i = 0; i < HOUR_KEYS.length; i++) {
            const key = HOUR_KEYS[i];
            for (let c = 0; c < 3; c++) {
                const from = a.cold[key][c] + (a.warm[key][c] - a.cold[key][c]) * w;
                const to = b.cold[key][c] + (b.warm[key][c] - b.cold[key][c]) * w;
                p[key][c] += (from + (to - from) * at.mix - p[key][c]) * k;
            }
        }
        const from = a.cold.stars + (a.warm.stars - a.cold.stars) * w;
        const to = b.cold.stars + (b.warm.stars - b.cold.stars) * w;
        this._hourStars += (from + (to - from) * at.mix - this._hourStars) * k;
    }

    // ── Frame ───────────────────────────────────────────────────────────────────

    update(sim, camera = this._camera) {
        const { u } = this;
        if (!u) return;
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const t = this.time;
        const motion = this.reducedMotion ? 0.3 : 1;

        // ── The heat of play: what the world wears (copied: the sample object is reused) ──
        const play = this.play.sample(t);
        const pace = this.heatOfPlay;
        pace.punch = play.punch;
        pace.level = play.level;
        pace.fever = play.fever;
        pace.stage = play.stage;
        const { level, fever, punch } = pace;

        // ── The charge ──
        const target = powerForCombo(this.combo);
        this.power += (target - this.power) * approach(target > this.power ? POWER_RISE : POWER_FALL, dt);
        this.surge *= Math.exp(-dt / SURGE_COOL);
        this.swell *= Math.exp(-dt / SWELL_FADE);
        this.storm *= Math.exp(-dt / 1.9);
        this.dip *= Math.exp(-dt / 0.4);
        this.spark *= Math.exp(-dt / 0.5);
        this.kick = this.kickSwell.valueAt(t);
        this.flash = this.flashSwell.valueAt(t);
        this.halo = this.haloSwell.valueAt(t);
        const lift = this.liftSwell.valueAt(t);
        if (t >= this.pendingSwell.time) {
            this.swell = gather(this.swell, this.pendingSwell.amount, SUN_ELEVATION.surge);
            this.pendingSwell.time = Infinity;
        }
        if (this.pendingSurge && t >= this.pendingSurge.time) {
            this.surge = gather(this.surge, this.pendingSurge.amount, 1.4);
            this.pendingSurge = null;
        }
        // The avalanches: one that took more snow grows into it over a moment.
        for (let i = 0; i < this.slides.length; i++) {
            const s = this.slides[i];
            s.strength += (s.target - s.strength) * (dt === 0 ? 1 : approach(3, dt));
        }
        const first = this.slides[0];
        const second = this.slides[1];
        u.avalanche.value.set(first.birth, first.strength, second.birth, second.strength);
        const hush = t < this.hushUntil ? this.hushDepth : 0;
        const breathTarget = hush > 0 ? 1 - (1 - HUSH_BREATH) * hush : 1 - this.dip;
        this.breath += (breathTarget - this.breath) * approach(hush > 0 ? 40 : 12, dt);
        if (dt === 0) this.breath = breathTarget;

        // ── The sun ──
        // The chain's charge raises it, the heat of play lifts it a little more (so a broken
        // chain lets it sag rather than set), and a fever carries it past where any chain would.
        const charge = clamp01(this.power + level * PLAY_CHARGE);
        const idle = Math.sin(t * 0.097) * IDLE_BREATH * (1 - charge) * (this.reducedMotion ? 0 : 1);
        const wanted = this.heldElevation
            ?? Math.min(SUN_ELEVATION.max, sunElevationFor(charge, this.surge, this.swell) + fever * FEVER_RISE + idle);
        this.elevation += (wanted - this.elevation) * approach(wanted > this.elevation ? 6 : 2.2, dt);
        if (dt === 0 && this.heldElevation !== null) this.elevation = wanted;
        const sun = sunDirection(this.elevation, this._sun);
        u.sunDir.value.set(sun[0], sun[1], sun[2]);
        const tan = Math.tan(this.elevation);
        u.sunTan.value = tan;
        const w = shadowWeights(tan, this._weights);
        u.shadowW.value.set(w[0], w[1], w[2], w[3]);
        const heat = this.heat();
        this.applyHour(dt === 0 ? 1 : approach(1.6, dt), heat);
        // How much of the disc the eye sees over the wall: what lights the pass.
        const seen = clamp01((this.elevation - Math.atan(this.skyline)) / (2 * SUN_RADIUS) + 0.5);

        // ── The wind ──
        // An event raises the storm at a stroke; the air answers over a few frames, so nothing
        // that hangs in it (flags, cords, plumes, papers) changes place in one. A quick hand
        // raises it under everything: the banners off the crests lengthen and thicken.
        const asked = GALE_REST + this.power * 0.5 + this.storm * 0.6 + this.surge * 0.4 + level * 0.3 + fever * 0.35;
        this.gale += (asked - this.gale) * approach(GALE_EASE, dt);
        const { gale } = this;
        this.windRun += dt * WIND.x * motion * (0.6 + gale * 1.4);
        // The flags' ripple runs on its own phase: the wind changes its pace, never its place.
        this.flutter = (this.flutter + dt * motion * flagPace(gale)) % FLAG_TURN;

        // ── Uniforms ──
        u.time.value = t;
        u.power.value = this.power;
        // (The diamond dust reads it: the hotter play, the more of the air fires.)
        u.surge.value = this.surge + level * 0.25 + fever * 0.75;
        u.breath.value = this.breath;
        u.windRun.value = this.windRun;
        u.gale.value = gale;
        u.flutter.value = this.flutter;
        u.nearSun.value = seen;
        u.spark.value.w = this.spark;
        u.prayer.value = clamp01(level * 0.6 + fever * 0.55);
        // (The ring needs a sun that has cleared the wall to hang on; a fever holds it up.)
        u.halo.value = Math.max(this.halo, fever * 0.62) * seen;
        const p = this._hour;
        const fire = clamp01(this.surge * 0.5);
        const warm = (key, node, gain = 1) => {
            const c = p[key];
            node.value.set(
                (c[0] + (SUNFIRE[0] * 4.6 - c[0]) * fire) * gain,
                (c[1] + (SUNFIRE[1] * 4.6 - c[1]) * fire) * gain,
                (c[2] + (SUNFIRE[2] * 4.6 - c[2]) * fire) * gain,
            );
        };
        warm('sun', u.sunCol);
        // Alpenglow: the hotter play runs, the deeper the hour's colours burn: the light warms
        // toward rose gold, the shadows go cobalt, the sky overhead deepens toward the dark blue
        // of altitude and the haze at its foot thins. (Nothing at rest or under casual play.)
        // (A quad's overdrive keeps it burning while the sun stands high after the chain.)
        const g = clamp01(fever * 0.85 + Math.max(0, level - 0.45) * 0.4 + this.surge * 0.3);
        u.sunCol.value.multiply(this._tint.set(1 + 0.06 * g, 1 - 0.1 * g, 1 - 0.3 * g));
        u.glow.value.set(p.glow[0], p.glow[1] * (1 - 0.12 * g), p.glow[2] * (1 - 0.25 * g));
        u.zenith.value.set(p.zenith[0] * (1 - 0.5 * g), p.zenith[1] * (1 - 0.4 * g), p.zenith[2] * (1 - 0.15 * g));
        const h = p.horizon;
        u.horizon.value.set(h[0] * (1 - 0.15 * g), h[1] * (1 - 0.28 * g), h[2] * (1 - 0.18 * g));
        u.shade.value.set(p.shade[0] * (1 - 0.35 * g), p.shade[1] * (1 - 0.15 * g), p.shade[2] * (1 + 0.2 * g));
        u.cloudCol.value.set(p.cloud[0], p.cloud[1] * (1 - 0.14 * g), p.cloud[2] * (1 - 0.06 * g));
        u.stars.value = this._hourStars;

        this.eagle?.update(t, this.eagleAir());
        const sky = this.parts.sky?.mesh;
        if (sky && camera) {
            sky.position.copy(camera.position);
            sky.updateMatrix();
            sky.updateMatrixWorld(true);
        }
        if (camera) this.projectSun(camera);

        // ── Post ──
        const post = this._post;
        // Every event's punch rides on a floor under a quick hand (the post scales the flash
        // for Reduce flashing; the kick widens the lens's fringe).
        post.flash = this.flash + punch * 0.04;
        post.kick = this.kick + punch * 0.22 * motion;
        const shafts = 0.1 + heat * 0.12 + lift * 0.12 + this.surge * 0.16;
        post.shafts = shafts + (0.05 - shafts) * hush;
        post.bloomBoost = this.surge * 0.12 + lift * 0.1 + fever * 0.05;
        // The lens's veil thins as play heats: the light stays in the colours, not in a haze.
        post.glare = seen * (0.5 + 0.5 * heat) * this.breath * (1 - 0.35 * level);
        post.glareColor[0] = u.sunCol.value.x * 0.25;
        post.glareColor[1] = u.sunCol.value.y * 0.25;
        post.glareColor[2] = u.sunCol.value.z * 0.25;
        // The iris closes as the sun comes over the wall, so the lit snow keeps its colour, and
        // further as play heats, so a fever burns deep rather than pale.
        post.exposure = (1 - 0.2 * level - 0.1 * fever)
            / (1 + seen * 0.5 + this.surge * 0.35 + lift * 0.25 + heat * 0.25);
        post.saturation = level * 0.1 + fever * 0.12;
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
            // The heat of play (src/themes/shared/gameplay-surge.js) as of the last frame.
            play: {
                level: this.heatOfPlay.level, fever: this.heatOfPlay.fever, stage: this.heatOfPlay.stage,
            },
            surge: this.surge,
            swell: this.swell,
            storm: this.storm,
            gale: this.gale,
            flutter: this.flutter,
            breath: this.breath,
            elevation: this.elevation / DEG,
            sunClears: Math.atan(this.skyline) / DEG,
            level: this.level,
            hour: HOURS[this.hourIndex].name,
            // Where the clock has carried the light from there: the nearer hour, and the place.
            hourNow: HOURS[this._hourAt.mix < 0.5 ? this._hourAt.from : this._hourAt.to].name,
            hourTurn: this._hourAt.turn,
            counts: { ...this.counts },
            source: this.field?.source ?? null,
            massifCells: this.parts.massif?.cells ?? 0,
            massifVertices: this.parts.massif?.vertices ?? 0,
            flags: this.flags?.live ?? 0,
            held: this.flags ? this.flags.totalHeld(this.time) : 0,
            lines: this.lines.length,
            gustStarts: this.lineSamples.length,
            papers: this.papers?.count ?? 0,
            spindrift: this.parts.spindrift?.count ?? 0,
            eagle: Boolean(this.eagle),
            squeeze: this.squeeze,
            layoutLive: this.layoutLive,
            heart: { ...this.heart },
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.scene?.remove(this.root);
        this.scene?.remove(this.near);
        this.disposables.forEach((part) => {
            if (part.space === 'free') this.scene?.remove(part.mesh);
            part.geometry?.dispose?.();
            part.material?.dispose?.();
        });
        if (this.eagle) this.scene?.remove(this.eagle.mesh);
        this.eagle?.dispose();
        this.eagle = null;
        this.textures.forEach((t) => t.dispose());
        this.disposables = [];
        this.textures = [];
        this.parts = {};
        this.flags = null;
        this.cords = null;
        this.papers = null;
        this.beams = null;
        this.field = null;
        this.massif = null;
        this.anchors = null;
        this.u = null;
        this._camera = null;
    }
}

export { PARTS as HIMALAYAN_PEAK_PARTS };
