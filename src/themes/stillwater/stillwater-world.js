/**
 * Stillwater — the world.
 *
 * Owns the plan, the shared uniforms, every scene part, the camera rig and the choreography.
 * Shared by the theme (stillwater-theme.js) and the playground effect
 * (src/playground/effects/stillwater.effect.js), so what is iterated there ships.
 *
 * A forest tarn at night, after John Bauer. The viewer sits on the near bank between two great
 * spruces; the moon stands in the mist over the left bank, and the black water holds all of it
 * upside down. On the left bank's point a pale spirit looks down into the tarn; by the great
 * spruce on the right a troll keeps a lantern. The board stands between them:
 *
 *   lock     the piece's light falls from the card into the tarn: a splash, a ring that bends
 *            the mirror, and a will-o'-the-wisp of the piece's colour left standing over the
 *            water where it fell. A hard drop falls harder and throws a second ring.
 *   clear    swells cross the tarn from over its heart, behind the card, to both banks, one
 *            front per line; every wisp they pass is gathered and flies home — to the spirit on the
 *            left, to the troll's lantern on the right — and the one who receives it burns
 *            the brighter for it. The cleared rows leave the card as drifts of sparks.
 *   combo    the two come toward each other: step by step the spirit walks out over the water
 *            (a ring at every footfall) and the troll comes down from his seat to the water's
 *            edge and holds his lantern out. The wood wakes with the chain: glowing caps light
 *            from the frame's edge inward, the lilies open, fireflies rise, eyes open between
 *            the far trunks, and a gold heart begins to glow on the tarn's bed. The board
 *            stands between them, and when the chain breaks they go back.
 *   four     the night holds its breath; then the heart flares gold under the water, a great
 *            ring crosses the tarn and the picture, every lily opens and every eye in the wood.
 *   level    the night turns to its next hour (seven of them on a wheel), and a breath of wind
 *            crosses the tarn.
 *
 * Fast play BUILDS here instead of popping and starting over (src/themes/shared/gameplay-surge.js):
 * every flash, kick, swell and flare is an accumulating envelope, so a weak answer after a strong
 * one only adds to its light, and a GameplaySurge reads how hot play runs. Warm, the wood takes
 * notice: eyes open between the far trunks, the caps and the lilies wake, the lantern and her
 * light brighten and the falling lights burn longer over the water. Hot, it is alive with the
 * player: the spruces stir, the moon's shafts stream between the trunks, fireflies swarm. In a
 * fever the heart of the tarn burns: its gold comes up through the black water in a net of
 * threads across the whole tarn, the mist on the water glows with it, and the two come down to
 * the water's edge to meet over it, chain or none. A perfect clear crowns it: the mist lifts, the
 * stars come out and both look up; then, as the hands rest, the night breathes back to calm.
 *
 * The night also moves on by itself, whatever the level: an hour every 110 s of the world
 * clock, so the colours of mist, water and wood are never quite the same twice.
 *
 * Everything is a function of the world clock and event timestamps (nothing is created at event
 * time), so seek(t) plus a fixed-step replay reproduces any frame.
 */

import * as THREE from 'three/webgpu';
import {
    DEG,
    DROP_FLIGHT,
    EYE,
    HEART,
    HOURS,
    HOUR_SECONDS,
    HUSH_HOLD,
    NOISE_SIZE,
    PALETTE_KEYS,
    PALETTE_SCALARS,
    RING_LIVE,
    RING_SLOTS,
    SPIRIT,
    STROKE_LIVE,
    STROKE_SLOTS,
    SURGE_COOL,
    TARNFIRE,
    TROLL,
    WISP_HOLD,
    WISP_HOME,
    WISP_RISE,
    WISP_SLOTS,
    approach,
    bakeNoise,
    clamp01,
    createNoiseTexture,
    createShoreTexture,
    createStillwaterUniforms,
    eyesForCombo,
    fovForAspect,
    heartForCombo,
    hourNames,
    lerp,
    moonFor,
    mulberry32,
    paletteAt,
    pieceColor,
    powerForCombo,
    skyDirection,
    smooth,
    squeezeFor,
    strokePassTime,
} from './stillwater-tsl.js';
import { tierFor } from './stillwater-quality.js';
import {
    groundHeight, planBoulders, planCaps, planEyes, planFerns, planLilies, planReeds, planSaplings, planTrunks, shoreDistance,
} from './stillwater-plan.js';
import { createSky } from './stillwater-sky.js';
import { createWater } from './stillwater-water.js';
import { createBoulders, createGround } from './stillwater-land.js';
import {
    createBoughs, createCrowns, createTrunks, planBoughs, planCrowns,
} from './stillwater-trees.js';
import {
    createCaps, createFerns, createLilies, createPads, createReeds, createSaplings,
} from './stillwater-flora.js';
import { createSpirit } from './stillwater-spirit.js';
import { createTroll } from './stillwater-troll.js';
import { KNEEL_AT, StillwaterStory, spiritPathPoint } from './stillwater-story.js';
import { arcAt, boatAt, skipAt } from './stillwater-life.js';
import {
    createDrops, createEyes, createFireflies, createHeartOrb, createMist, createSparks, createVeil, createWisps,
} from './stillwater-fx.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './stillwater-composition.js';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, SURGE_WEIGHTS, Swell } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';

/** The rest camera's lens (the theme builds its camera from it). */
export const REST_RIG = Object.freeze({
    hFov: EYE.hFov,
    minFov: EYE.minFov,
    maxFov: EYE.maxFov,
    near: EYE.near,
    far: EYE.far,
});

export { fovForAspect };

/** What stands in the scene is drawn on this camera layer: the mirror pass renders only it. */
export const HERO_LAYER = 1;

/** Seconds a level's turn of the hour takes. */
export const HOUR_TURN = 3.2;

/** Where on her path the spirit kneels on the water when all is calm (0 = her stone). */
/** Seconds between the rings her hem leaves as she drifts over the water. */
const WAKE_EVERY = 0.55;
/** Seconds the little boat of light takes to rise from the water into her hands. */
const BOAT_RISE = 1.2;
/** The ring across the picture: how fast it fades, and how long it is still on screen. */
const SHOCK_FADE = 0.75;
const SHOCK_CROSS = 0.8;

const PARTS = [
    'sky', 'water', 'ground', 'boulders', 'trunks', 'crowns', 'boughs', 'fringe', 'saplings', 'ferns', 'reeds', 'pads',
    'lilies', 'caps', 'spirit', 'troll', 'mist', 'veil', 'eyes', 'fireflies', 'wisps', 'drops', 'sparks', 'orb',
];

/** The troll's path: his seat to the shallows (for reading how far he has come). */
const TROLL_PATH = Math.hypot(TROLL.shallows[0] - TROLL.home[0], TROLL.shallows[2] - TROLL.home[2]);

export class StillwaterWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {THREE.WebGPURenderer} [params.renderer]
     * @param {boolean} [params.capture=false]  deterministic captures: no wall-clock anywhere
     */
    constructor({
        scene, quality = 'High', renderer = null, capture = false, samples = 0,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.renderer = renderer;
        this.capture = capture;
        /** The scene pass's samples; the water's mirror takes the same. */
        this.samples = samples;
        this.noiseField = bakeNoise();
        /** World space: the water, the sky, and everything gameplay throws about. */
        this.root = new THREE.Group();
        this.root.name = 'Stillwater';
        /** Stage space: the banks and all that stands on them, drawn in on a narrow frame. */
        this.stage = new THREE.Group();
        this.stage.name = 'StillwaterStage';
        this.root.add(this.stage);
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.water = null;
        this.spirit = null;
        this.troll = null;
        this.sparks = null;
        this.drops = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.squeeze = 1;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        /** The moon and the tarn's heart on screen (fractions, y down): what the post reads. */
        this.moonScreen = { x: 0.3, y: 0.2 };
        this.heartScreen = { x: 0.5, y: 0.5 };
        this._moon = { azimuth: 0, elevation: 0 };
        this._moonDir = [0, 0, -1];
        this._camera = null;
        this._look = new THREE.Vector3();
        this._ray = new THREE.Vector3();
        this._point = { x: 0.5, y: 0.5 };
        this._from = [0, 0, 0];
        this._at = [0, 0, 0];
        this._heartOf = [SPIRIT.home[0], SPIRIT.home[1] + SPIRIT.height * 0.7, SPIRIT.home[2]];
        this._lantern = [TROLL.home[0] - 0.9, TROLL.home[1] + 2.2, TROLL.home[2] + 1.2];
        this._wisp = [0, 0, 0, 0];
        this._lifeRGB = [1, 1, 1];
        this._lifeP = [0, 0, 0];
        this._lifeV = new THREE.Vector3();
        this._orb = [0, 0, 0, 0];
        this._trollWant = {};
        this._spiritWant = {};
        this._spiritBody = {
            at: [0, 0, 0], face: 1.4, kneel: false, hands: 'rest', look: null, gazeDown: true, wind: 0.25,
        };
        /** Where the two are, in STAGE coordinates (the story's; the world converts both ways). */
        this._figuresAt = {
            spiritHeart: [SPIRIT.home[0], SPIRIT.home[1] + 1.2, SPIRIT.home[2]],
            lantern: [TROLL.home[0], 2.2, TROLL.home[2]],
            troll: [TROLL.home[0], TROLL.home[2]],
        };
        this._lookW = [0, 0, 0];
        this._lookS = [0, 0, 0];
        this.story = new StillwaterStory();
        this._clear = null;
        this._palette = paletteAt(0);
        /** The night moves on by itself (captures of one hour hold it still). */
        this.hourDrift = true;
        this._post = {
            moon: this.moonScreen,
            heart: this.heartScreen,
            flash: 0,
            kick: 0,
            shafts: 0.3,
            bloomBoost: 0,
            exposure: 1,
            prism: { radius: 0, strength: 0 },
            shade: [0.012, 0.03, 0.036],
        };
        this.resetState(0);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.combo = 0;
        this.power = 0;
        /** The overdrive after four lines, as of the last frame (its swell: env.overdrive). */
        this.surge = 0;
        this.level = 1;
        /** The level's place on the wheel of hours, turning from one to the next. */
        this.turn = { from: 0, to: 0, time: -100 };
        // (The envelopes' readings as of the last frame: the swells themselves are in `env`.)
        this.flash = 0;
        this.kick = 0;
        this.crown = 0;
        this.flare = 0;
        this.dip = 0;
        this.breath = 1;
        this.gust = 0;
        this.lift = 0;
        this.hushUntil = -1;
        /** How deep the quad's hush goes: all the way from cold, a breath in a fever. */
        this.hushDepth = 1;
        this.rings = [];
        this.strokes = [];
        /** Wisps over the water: { x, z, h, rgb, birth, seed, side, gain, gatherAt }. */
        this.wisps = [];
        /** Light on its way home: { time, side, amount }. */
        this.feeds = [];
        this.fedL = 0;
        this.fedR = 0;
        this.stepFlash = 0;
        this.eyes = 0;
        this.eyesFlash = 0;
        this.lilies = 0;
        this.liliesFlash = 0;
        this.capsL = 0.12;
        this.capsR = 0.12;
        this.heart = 0;
        this.heartFlash = 0;
        /** How far the heart is up out of the water (the bed lies dark while it is), eased. */
        this.away = 0;
        /** How hot play runs, smoothed into the acts (warm, hot) the world stages. */
        this.warmth = 0;
        this.hotness = 0;
        /** How far out the spirit is on her path (0..1), and the troll on his (0 his seat, 1 the shallows). */
        this.spiritS = 0;
        this.trollS = 0;
        this.lastWake = -10;
        this.streamSlot = -1;
        /**
         * Lights the two's own life sets in motion (stillwater-life.js): a firefly held in her
         * hands or his, one sent across the water, one let go, a little boat of light. Each is
         * the life's own event object (its length may change after it begins).
         */
        this.lifeLights = [];
        /** Glows the life lends them: the lantern trimmed, her song. [{ who, start, length, amount }] */
        this.lifeGlows = [];
        this.boatWake = -10;
        this.story?.reset(time);
        this.resetFigures();
        this.lastLanding = null;
        this.shock = { time: -100, strength: 0 };
        /** Four-line clears waiting for their hush to end. */
        this.answers = [];
        this.resetEnvelopes();
        this.counts = {
            locks: 0, clears: 0, quads: 0, wisps: 0, gathered: 0,
        };
        // The slow clock and the air's own phase are functions of the world clock until gameplay bends them.
        this.drift = time * (this.reducedMotion ? 0.3 : 1);
        this.sway = time * 0.975;
        this.sparks?.reset();
        this.drops?.reset();
        if (this.u) this.u.counts.value.set(0, 0, 0, 0);
    }

    /**
     * Every accumulating envelope, at rest (made once, reset after), and the surge of play. A hit
     * joins whatever is still lit and never restarts it: rapid answers ride up to a plateau.
     */
    resetEnvelopes() {
        if (!this.env) {
            this.env = {
                /** The post's flash and kick. */
                flash: new Swell({ release: 0.25, ceiling: 0.45, knee: 0.3 }),
                kick: new Swell({ release: 0.16, ceiling: 0.9, knee: 0.6 }),
                /** The overdrive four lines give (a second quad adds to the first). */
                overdrive: new Swell({
                    release: SURGE_COOL, ceiling: 1.45, knee: 1.05, headroom: 1.3,
                }),
                /** A clear's swell of light (shafts, bloom, iris). */
                swell: new Swell({ release: 0.7, ceiling: 1, knee: 0.7 }),
                /** Both lights at a step of the chain (a longer chain steps brighter). */
                step: new Swell({ release: 0.6, ceiling: 1.6, knee: 1 }),
                /** The heart's flare under the water, every eye and every lily after four lines. */
                heart: new Swell({ release: 2.4, ceiling: 1.2, knee: 0.9 }),
                eyes: new Swell({ release: 1.7, ceiling: 1, knee: 0.85 }),
                lilies: new Swell({ release: 3.2, ceiling: 1, knee: 0.85 }),
                /** A perfect clear's crown. */
                crown: new Swell({
                    attack: 0.15, release: 2.6, ceiling: 1.3, knee: 1,
                }),
                /** Back to back: the lantern blazes and their lights run out toward each other. */
                flare: new Swell({
                    attack: 0.08, release: 1.6, ceiling: 2, knee: 1.2,
                }),
            };
            this.play = new GameplaySurge();
        } else {
            Object.keys(this.env).forEach((key) => this.env[key].reset());
            this.play.reset();
        }
        this.heat = this.play.sample(this.time);
    }

    /** How much more a falling light gives the hotter play runs (1 at rest). */
    heatGain() {
        return 1 + 0.2 * this.warmth + 0.2 * this.hotness + 0.2 * this.heat.fever;
    }

    build() {
        const noise = createNoiseTexture(this.noiseField, NOISE_SIZE);
        const shore = createShoreTexture();
        this.textures.push(noise, shore);
        const u = createStillwaterUniforms({ noise, shore });
        this.u = u;
        const { tier } = this;
        const banks = { hero: true, stage: true };

        // The mirror pass composites over the mirrored distance by alpha: it must clear to nothing.
        if (this.renderer?.getClearColor) {
            this._clear = {
                color: this.renderer.getClearColor(new THREE.Color()).clone(),
                alpha: this.renderer.getClearAlpha(),
            };
            this.renderer.setClearColor(0x000000, 0);
        }

        this.water = createWater(u, {
            mirrorScale: tier.mirror,
            lite: tier.lite,
            wood: tier.wood,
            glitter: tier.glitter,
            columns: tier.columns,
            samples: this.samples,
        });
        this.addPart('water', this.water);
        if (this.water.reflectorTarget) this.root.add(this.water.reflectorTarget);
        this.addPart('sky', createSky(u, { lite: tier.lite, wood: tier.wood }));

        // ── The stage: what stands in the scene (mirrored by the water's pass) ──
        this.trunkPlan = planTrunks(tier.trunks);
        this.addPart('ground', createGround(u, { cell: tier.cell }), banks);
        this.addPart('boulders', createBoulders(u, planBoulders(tier.boulders)), banks);
        this.addPart('trunks', createTrunks(u, this.trunkPlan), banks);
        this.addPart('crowns', createCrowns(u, planCrowns(this.trunkPlan), { samples: this.samples }), banks);
        if (tier.boughs > 0) {
            const boughs = planBoughs(this.trunkPlan, tier.boughs);
            const fringe = boughs.filter((b) => b.fringe);
            // The giants' living boughs fringe the frame; out in the wood the old trunks' dead
            // branches carry beard lichen.
            const opts = { samples: this.samples };
            this.addPart('boughs', createBoughs(u, boughs.filter((b) => !b.fringe), 'StillwaterBoughs', {
                ...opts, lichen: true,
            }), banks);
            if (fringe.length) this.addPart('fringe', createBoughs(u, fringe, 'StillwaterFringe', opts), banks);
        }
        if (tier.saplings > 0) this.addPart('saplings', createSaplings(u, planSaplings(tier.saplings)), banks);
        if (tier.ferns > 0) this.addPart('ferns', createFerns(u, planFerns(tier.ferns)), banks);
        if (tier.reeds > 0) this.addPart('reeds', createReeds(u, planReeds(tier.reeds)), banks);
        const lilyPlan = planLilies(tier.lilies);
        this.addPart('pads', createPads(u, lilyPlan), banks);
        this.addPart('lilies', createLilies(u, lilyPlan.filter((p) => p.flower)), banks);
        this.addPart('caps', createCaps(u, planCaps(tier.caps)), banks);
        this.spirit = createSpirit(u, { lod: tier.spirit, motes: tier.motes });
        this.addPart('spirit', this.spirit, banks);
        this.troll = createTroll(u, {
            lod: tier.troll,
            // (The troll walks in true metres: the plan's ground is in the stage's own.)
            ground: (x, z) => groundHeight(x / this.squeeze, z),
        });
        this.addPart('troll', this.troll, banks);
        this.resetFigures();

        // ── The air of the place, and what gameplay sets in flight (world space) ──
        const air = { hero: true };
        if (tier.mist > 0) this.addPart('mist', createMist(u, tier.mist), air);
        // (The low mist lies on the water: the mirror does not take it.)
        if (tier.veil > 0) this.addPart('veil', createVeil(u, tier.veil));
        this.addPart('eyes', createEyes(u, planEyes(tier.eyes)), air);
        if (tier.fireflies > 0) this.addPart('fireflies', createFireflies(u, tier.fireflies), air);
        this.addPart('wisps', createWisps(u), air);
        this.drops = createDrops(u);
        this.addPart('drops', this.drops, air);
        this.sparks = createSparks(u, tier.sparks);
        this.addPart('sparks', this.sparks, air);
        this.addPart('orb', createHeartOrb(u), air);

        this.applySqueeze();
        this.applyPalette();
        this.placeFigures(0);
        this.scene.add(this.root);
        return this;
    }

    /**
     * Assets that arrive after the first frame: the troll's sculpt. Resolves true when he is in,
     * false when he could not be had (his lantern stands without him); it does not reject.
     */
    async prepare() {
        if (!this.troll) return false;
        const [loaded] = await Promise.all([this.troll.load(), this.spirit ? this.spirit.load() : false]);
        if (this.disposed) return false;
        this.troll.mesh.traverse((o) => o.layers.set(HERO_LAYER));
        this.spirit?.mesh.traverse((o) => o.layers.set(HERO_LAYER));
        this.resetFigures();
        this.placeFigures(0);
        return loaded;
    }

    /** The two at rest: he on his seat stone, she on hers (the walk frame is the stage in true metres). */
    resetFigures() {
        const s = this.squeeze || 1;
        const face = Math.atan2(SPIRIT.home[0] * s - TROLL.home[0] * s, SPIRIT.home[2] - TROLL.home[2]);
        this.troll?.reset(TROLL.home[0] * s, TROLL.home[2], face, {
            seated: true, seat: [TROLL.seat[0] * s, TROLL.seat[1], TROLL.seat[2]],
        });
        this.spirit?.reset(SPIRIT.home[0] * s, SPIRIT.home[1], SPIRIT.home[2], 1.35);
    }

    /**
     * Add a part. `hero` parts stand in the scene and are mirrored by the water's pass; `stage`
     * parts belong to the banks and are drawn in with them on a narrow frame.
     */
    addPart(name, part, { hero = false, stage = false } = {}) {
        this.parts[name] = part;
        if (hero) part.mesh.traverse((o) => o.layers.set(HERO_LAYER));
        (stage ? this.stage : this.root).add(part.mesh);
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
        }
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) {
            this.aspect = aspect;
            // With no board on screen the events aim at where the solo board would be in THIS frame.
            if (!this.layoutLive) this.layout = fallbackLayout(this.aspect * 1000, 1000);
            this.applySqueeze();
        }
        this.syncPixelAngle();
    }

    /** The frame's width decides how far the stage is drawn in and where the moon stands. */
    applySqueeze() {
        const before = this.squeeze;
        this.squeeze = squeezeFor(this.aspect);
        // The two walk in true metres: a new squeeze moves their ground, so they start again at rest.
        if (before !== this.squeeze) this.resetFigures();
        this.stage.scale.x = this.squeeze;
        this.stage.updateMatrixWorld(true);
        this.spirit?.setSqueeze(this.squeeze);
        this.troll?.setSqueeze(this.squeeze);
        // The giants' boughs fringe a wide frame; drawn in over a tall one they would hang across it.
        this.parts.fringe?.mesh.scale.setScalar(this.squeeze > 0.85 ? 1 : 0);
        moonFor(this.aspect, this._moon);
        skyDirection(this._moon.azimuth, this._moon.elevation, this._moonDir);
        if (!this.u) return;
        this.u.squeeze.value = this.squeeze;
        this.u.moonDir.value.set(this._moonDir[0], this._moonDir[1], this._moonDir[2]);
        this.u.moonAz.value = this._moon.azimuth;
    }

    /** Radians one pixel subtends: the sky function draws its own edges with it. */
    syncPixelAngle() {
        if (!this.u) return;
        const h = Math.max(1, this.u.viewport.value.y);
        this.u.pixelAngle.value = (2 * Math.tan((fovForAspect(this.aspect) * DEG) / 2)) / h;
    }

    /**
     * The live board / card / HUD rects (screen fractions), or null when no board is on screen:
     * events then aim at where the solo board would be.
     */
    setLayout(rects, aspect) {
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) {
            this.aspect = aspect;
            this.applySqueeze();
        }
        this.layoutLive = Boolean(rects);
        this.layout = rects || fallbackLayout(this.aspect * 1000, 1000);
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Let the night move on by itself (the default), or hold it at the level's own hour. */
    setHourDrift(drifting) {
        this.hourDrift = drifting !== false;
    }

    /**
     * The hour of the night now: the level's place on the wheel (turning for a few seconds after
     * a level-up), plus how far the clock has moved it on.
     */
    hourNow() {
        const k = smooth(0, 1, (this.time - this.turn.time) / HOUR_TURN);
        const base = this.turn.from + (this.turn.to - this.turn.from) * k;
        return base + (this.hourDrift ? Math.max(0, this.time) / HOUR_SECONDS : 0);
    }

    /** How near the two have grown (0..1): captures set it; a seek keeps it. */
    setKin(kin) {
        this.story.setKin(kin);
    }

    /** Begin one of their scenes at `time` (captures): whatever they were doing gives way. */
    cueScene(name, time) {
        this.story.life.cue(name, time);
    }

    /** Jump the clock (captures): drops every event in flight. */
    seek(time) {
        const { level } = this;
        this.resetState(Math.max(0, time));
        this.level = level;
        this.turn = { from: level - 1, to: level - 1, time: -100 };
        this.applyPalette();
        this.placeFigures(0);
    }

    /**
     * A new run. The night goes back to rest the way it would by itself: a chain still standing
     * breaks (the two go home), every wisp is let go, and nothing still on its way is counted.
     * What is already on the water runs out; the hour of the night stays.
     */
    resetSession() {
        if (this.combo > 0) this.onCombo(0);
        this.combo = 0;
        this.hushUntil = -1;
        this.answers.length = 0;
        this.story.onEnd(this.time);
        this.gatherAll(this.time, 0.4);
        this.counts = {
            locks: 0, clears: 0, quads: 0, wisps: 0, gathered: 0,
        };
    }

    /** The run ended: the chain breaks, the lights go home. */
    onGameOver() {
        if (this.combo > 0) this.onCombo(0);
        this.story.onEnd(this.time);
        this.gatherAll(this.time, 0.6);
    }

    /** The camera that will render the world: it sees the scene's layer, the mirror only that. */
    bindCamera(camera) {
        this._camera = camera;
        if (!camera) return;
        camera.layers.enable(HERO_LAYER);
        const reflection = this.water?.reflection;
        if (reflection?.reflector?.getVirtualCamera) {
            reflection.reflector.getVirtualCamera(camera).layers.set(HERO_LAYER);
        }
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        if (this.disposed) return;
        const t = sim.time;
        const calm = this.reducedMotion ? 0 : 1;
        // An impact nudges the lens; a fever of play leans the viewer in a little.
        const kick = this.env.kick.valueAt(t);
        const fov = fovForAspect(this.aspect) - (kick * 0.5 + this.heat.fever * 0.4) * calm;
        if (camera.fov !== fov || camera.near !== EYE.near || camera.far !== EYE.far) {
            camera.fov = fov;
            camera.near = EYE.near;
            camera.far = EYE.far;
            camera.updateProjectionMatrix();
        }
        // The viewer sits on the bank and breathes; the pointer leans the view.
        const swayX = (Math.sin(t * 0.13) * 0.07 + Math.sin(t * 0.071 + 1.3) * 0.05) * calm;
        const swayY = (Math.sin(t * 0.21 + 0.7) * 0.018 + Math.sin(t * 0.09) * 0.012) * calm;
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        camera.position.set(
            EYE.x + swayX + px * 0.35,
            EYE.y + swayY - py * 0.12,
            EYE.z + kick * 0.08 * calm,
        );
        const yaw = (Math.sin(t * 0.083 + 2.1) * 0.004 + px * 0.012) * calm;
        const pitch = EYE.pitch + (Math.sin(t * 0.097) * 0.002 - py * 0.008) * calm;
        this._look.set(
            camera.position.x + Math.sin(yaw) * 100,
            camera.position.y + Math.tan(pitch) * 100,
            camera.position.z - Math.cos(yaw) * 100,
        );
        camera.up.set(0, 1, 0);
        camera.lookAt(this._look);
        // The shared breath (shared/camera-breath.js) on top of the sway above, turning the
        // view only (an eye-level look out over the lake): off under reduced motion.
        applyCameraBreath(camera, t, { scale: this.reducedMotion ? 0 : 1 });
        camera.updateMatrixWorld();
        this._camera = camera;
        // The moon and the heart on screen: where the post's shafts and ring come from.
        const m = this._moonDir;
        this._ray.set(camera.position.x + m[0] * 500, camera.position.y + m[1] * 500, camera.position.z + m[2] * 500)
            .project(camera);
        this.moonScreen.x = Math.max(-0.5, Math.min(1.5, this._ray.x * 0.5 + 0.5));
        this.moonScreen.y = Math.max(-0.5, Math.min(1.5, 0.5 - this._ray.y * 0.5));
        this._ray.set(HEART[0] * this.squeeze, 0, HEART[2]).project(camera);
        this.heartScreen.x = Math.max(-0.5, Math.min(1.5, this._ray.x * 0.5 + 0.5));
        this.heartScreen.y = Math.max(-0.5, Math.min(1.5, 0.5 - this._ray.y * 0.5));
    }

    /** The world point `depth` metres along the ray through a screen point (fractions, y down). */
    screenToWorld(sx, sy, depth, out = this._from) {
        const camera = this._camera;
        if (!camera) {
            out[0] = 0;
            out[1] = EYE.y;
            out[2] = EYE.z - depth;
            return out;
        }
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        out[0] = camera.position.x + this._ray.x * depth;
        out[1] = camera.position.y + this._ray.y * depth;
        out[2] = camera.position.z + this._ray.z * depth;
        return out;
    }

    /**
     * Where the ray through a screen point meets the water (world), or null when it never does
     * (it looks above the far shore) or meets it further off than `far`.
     */
    screenToWater(sx, sy, out = [0, 0, 0], far = 60) {
        const camera = this._camera;
        if (!camera) return null;
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        if (this._ray.y > -1e-3) return null;
        const reach = -camera.position.y / this._ray.y;
        if (!(reach > 0) || reach > far) return null;
        out[0] = camera.position.x + this._ray.x * reach;
        out[1] = 0;
        out[2] = camera.position.z + this._ray.z * reach;
        return out;
    }

    /** True where a world point lies on open water (clear of the banks by `margin` metres). */
    onWater(x, z, margin = 0.45) {
        return shoreDistance(x / this.squeeze, z) < -margin;
    }

    /**
     * Where a lock's light falls: a point of open water on the piece's side of the card, nearer
     * the viewer the lower the piece locked. `tries` different points for the same lock.
     */
    pickLanding(side, wy, salt = 0) {
        const rand = mulberry32(0x51ab + (this.counts.locks * 7 + salt + 1) * 2654435761);
        const card = cardUnion(this.layout);
        const hud = this.layout?.hud;
        const left = card ? card.x0 : 0.4;
        const right = Math.max(card ? card.x1 : 0.6, side > 0 && hud ? hud.x1 : 0);
        const top = card ? card.y0 : 0.1;
        const bottom = card ? card.y1 : 0.9;
        const low = clamp01((wy - top) / Math.max(1e-3, bottom - top));
        const out = [0, 0, 0];
        for (let i = 0; i < 9; i++) {
            let sx = side < 0 ? lerp(0.05, left - 0.03, rand()) : lerp(right + 0.03, 0.95, rand());
            let sy = lerp(0.5, 0.86, low) + (rand() - 0.5) * 0.16;
            // A frame with no room beside the card (a tall phone): the strip of water under it.
            if ((side < 0 && left < 0.16) || (side > 0 && right > 0.84)) {
                sx = side < 0 ? lerp(0.08, 0.46, rand()) : lerp(0.54, 0.92, rand());
                sy = lerp(Math.min(0.97, bottom + 0.015), 0.985, rand());
            }
            const hit = this.screenToWater(sx, Math.max(0.47, Math.min(0.985, sy)), out);
            if (hit && this.onWater(hit[0], hit[2])) return hit;
        }
        out[0] = side * 3.1 * this.squeeze;
        out[1] = 0;
        out[2] = -1.5;
        return out;
    }

    // ── Gameplay ────────────────────────────────────────────────────────────────

    /**
     * Start a ring on the water at (x, z) at `time`. A full pool gives up the ring with the least
     * left in it (a spent one first; one still to come counts at full strength), never the oldest
     * blindly: a great ring is not cut short by a footfall's.
     */
    ring(x, z, time, strength, rgb, reach = 1) {
        if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(time)) return;
        if (this.rings.length < RING_SLOTS) {
            this.rings.push({
                x, z, time, strength, rgb: [rgb[0], rgb[1], rgb[2]], reach,
            });
            return;
        }
        let weakest = 0;
        let least = Infinity;
        for (let i = 0; i < this.rings.length; i++) {
            const r = this.rings[i];
            const age = this.time - r.time;
            const left = age > RING_LIVE ? -1 : r.strength * Math.exp(-Math.max(0, age) * 0.38);
            if (left < least) {
                least = left;
                weakest = i;
            }
        }
        const r = this.rings[weakest];
        r.x = x;
        r.z = z;
        r.time = time;
        r.strength = strength;
        r.rgb[0] = rgb[0];
        r.rgb[1] = rgb[1];
        r.rgb[2] = rgb[2];
        r.reach = reach;
    }

    /** Add a clear's swell to the tarn: a full table gives up the one with the least left in it. */
    addStroke(stroke) {
        if (this.strokes.length >= STROKE_SLOTS) {
            let weakest = 0;
            let least = Infinity;
            for (let i = 0; i < this.strokes.length; i++) {
                const k = this.strokes[i];
                const age = this.time - k.time;
                const left = age > STROKE_LIVE ? -1 : k.strength * (1 + k.gold) * Math.exp(-Math.max(0, age) * 0.45);
                if (left < least) {
                    least = left;
                    weakest = i;
                }
            }
            this.strokes.splice(weakest, 1);
        }
        this.strokes.push(stroke);
    }

    /**
     * Send the ring across the picture from the tarn's heart, or, while one is still crossing it
     * (or waiting on a hush to be born), add this one's light to it: it is never pulled back to
     * the middle and started again.
     */
    shockAt(time, strength) {
        const s = this.shock;
        const age = time - s.time;
        if (age < 0) {
            s.strength = Math.min(1.6, s.strength + strength * 0.7);
        } else if (age < SHOCK_CROSS && s.strength * Math.exp(-age / SHOCK_FADE) > 0.02) {
            const now = s.strength * Math.exp(-age / SHOCK_FADE);
            s.strength = Math.min(1.6, now + strength * 0.7) * Math.exp(age / SHOCK_FADE);
        } else {
            s.time = time;
            s.strength = strength;
        }
    }

    /** Leave a wisp standing over the water at (x, z) from `time`. */
    spawnWisp(x, z, time, rgb, gain = 1) {
        // The oldest goes home when there is no room for another.
        if (this.wisps.length >= WISP_SLOTS) {
            const oldest = this.wisps.find((w) => w.gatherAt === Infinity);
            if (oldest) this.gather(oldest, Math.max(this.time, oldest.birth));
            else this.wisps.shift();
        }
        const n = this.counts.wisps;
        this.counts.wisps += 1;
        const seed = (n * 0.61803398875) % 1;
        this.wisps.push({
            x,
            z,
            h: 0.5 + seed * 0.55 + (gain - 1) * 0.3,
            rgb: [rgb[0], rgb[1], rgb[2]],
            birth: time,
            seed,
            side: x < 0 ? -1 : 1,
            gain,
            gatherAt: Infinity,
        });
    }

    /** Send a wisp home at `time`: the spirit takes the left bank's, the lantern the right's. */
    gather(wisp, time) {
        if (wisp.gatherAt !== Infinity) return;
        wisp.gatherAt = time;
        this.feeds.push({ time: time + WISP_HOME, side: wisp.side, amount: 0.22 * wisp.gain });
        // The one it goes to makes ready for it: her hands, his lantern.
        this.story.onArrival(wisp.side, time + WISP_HOME);
        this.counts.gathered += 1;
    }

    /** Let every wisp go home, one after another over `over` seconds. */
    gatherAll(time, over = 0.5) {
        const waiting = this.wisps.filter((w) => w.gatherAt === Infinity);
        waiting.forEach((w, i) => this.gather(w, Math.max(time, w.birth) + (over * i) / Math.max(1, waiting.length)));
    }

    /**
     * Where a wisp is and how brightly it burns at `t`: writes (x, y, z, light) into `out`.
     * A pure function of the clock, so a replay finds it in the same place.
     */
    wispAt(wisp, t, out = this._wisp) {
        const age = t - wisp.birth;
        if (age < 0) {
            out[0] = wisp.x;
            out[1] = 0;
            out[2] = wisp.z;
            out[3] = 0;
            return out;
        }
        const rise = smooth(0, 1, age / WISP_RISE);
        const s = wisp.seed;
        let x = wisp.x + Math.sin(t * 0.31 + s * 9) * 0.3 * rise;
        let y = wisp.h * rise * (1 + 0.1 * Math.sin(t * 0.9 + s * 5)) + 0.05;
        let z = wisp.z + Math.cos(t * 0.27 + s * 7) * 0.25 * rise;
        // It flares as it is born out of the splash, then settles to its own light.
        let light = rise * (1 - smooth(WISP_HOLD - 6, WISP_HOLD, age)) * wisp.gain * (1 + 1.5 * Math.exp(-age / 0.3));
        if (t >= wisp.gatherAt) {
            // Going home: slow to leave, quick to arrive, over a bow.
            const g = clamp01((t - wisp.gatherAt) / WISP_HOME);
            const e = g * g * (3 - 2 * g);
            const home = wisp.side < 0 ? this._heartOf : this._lantern;
            x += (home[0] - x) * e;
            y += (home[1] - y) * e + Math.sin(g * Math.PI) * 0.9;
            z += (home[2] - z) * e;
            light *= (1 + Math.sin(g * Math.PI) * 0.8) * (g < 1 ? 1 : 0);
        }
        out[0] = x;
        out[1] = y;
        out[2] = z;
        out[3] = light;
        return out;
    }

    /**
     * A piece locked. `u` = its column as a fraction of the board width, `rows` = the visible
     * rows it covers, `color` = the piece's colour; `screen` (fractions) replaces the board point.
     */
    onLock({
        u = 0.5, rows = null, hardDrop = false, color = null, player = 0, screen = null,
    } = {}) {
        if (!this.u) return;
        const rgb = pieceColor(color);
        let wx = 0.5;
        let wy = 0.6;
        let side = u < 0.5 ? -1 : 1;
        if (Math.abs(u - 0.5) < 0.03) side = this.counts.locks % 2 ? 1 : -1;
        if (screen) {
            wx = screen.x;
            wy = screen.y;
            side = screen.x < 0.5 ? -1 : 1;
        } else {
            const board = boardFor(this.layout, player);
            const card = cardUnion(this.layout);
            if (board) {
                const middle = Array.isArray(rows) && rows.length ? rows[Math.floor(rows.length / 2)] : 19;
                boardPoint(board, Number.isFinite(u) ? u : 0.5, Number.isFinite(middle) ? middle : 19, this._point);
                // The light leaves the card's edge on the piece's side, at the piece's height.
                const edges = card || board;
                wx = side < 0 ? edges.x0 : edges.x1;
                wy = this._point.y;
            }
        }
        this.lockAt(wx, wy, side, rgb, hardDrop);
        // (Added to whatever is still lit: rapid drops ride on a floor instead of flickering.)
        this.env.kick.hit(hardDrop ? 0.45 : 0.08, this.time);
        this.env.flash.hit(hardDrop ? 0.06 : 0.012, this.time);
        this.play.lock({ hardDrop }, this.time);
        this.counts.locks += 1;
    }

    /**
     * One drop of light from a world point to a point of the water; returns when it lands. `boost`
     * (1 at rest) is how much more the water gives it when play runs hot.
     */
    sendDrop(from, to, rgb, strength, wisp, boost = 1) {
        const flight = this.reducedMotion ? 0.12 : DROP_FLIGHT * (0.8 + Math.min(0.6, Math.hypot(to[0] - from[0], to[2] - from[2]) / 14));
        const lands = this.time + flight;
        this.drops?.launch({
            from, to, rgb, time: this.time, flight, size: 0.2 + strength * 0.14,
        });
        const reach = (0.7 + strength * 0.45) * (0.8 + 0.2 * boost);
        this.ring(to[0], to[2], lands, (0.42 + strength * 0.5) * boost, rgb, reach);
        // The crown of the splash: the water it throws up has the light in it.
        this.sparks?.emit({
            at: [to[0], 0.02, to[2]],
            n: Math.round((7 + 9 * strength) * boost * this.sparkShare()),
            rgb,
            time: lands,
            vel: [0, 1.5 + strength * 1.1, 0],
            spread: 0.9 + strength * 0.5,
            life: [0.45, 0.9],
            size: 0.07,
            splash: true,
        });
        if (wisp) this.spawnWisp(to[0], to[2], lands, rgb, wisp);
        return lands;
    }

    /** How full the spark pool is against the tier it was tuned on (High). */
    sparkShare() {
        return this.sparks ? Math.min(1.6, this.sparks.count / 960) : 0;
    }

    /** What a lock does to the scene. (wx, wy) = where on screen the piece's light leaves the card. */
    lockAt(wx, wy, side, rgb, hardDrop) {
        const from = this.screenToWorld(wx, wy, 6.5, [0, 0, 0]);
        const to = this.pickLanding(side, wy, 0);
        // The hotter play runs, the brighter and longer the lights it leaves over the water.
        const boost = this.heatGain();
        const lands = this.sendDrop(from, [...to], rgb, hardDrop ? 1 : 0.45, (hardDrop ? 1.3 : 1) * boost, boost);
        this.lastLanding = [to[0], to[2]];
        // The one on that side follows the light down (a little before it lands).
        this.story.onLock({
            time: lands - 0.32, side, at: [to[0] / this.squeeze, to[2]], hardDrop,
        });
        if (hardDrop) {
            // A second falls wide of the first (a ring only), and the air stirs.
            const second = this.pickLanding(side, wy, 1);
            this.sendDrop([...from], [...second], rgb, 0.3, 0);
            this.gust = Math.max(this.gust, 0.22);
        }
    }

    /**
     * Lines cleared. `lines` 1..4; `tspin`, `perfect`, `b2b`; `cascade` = the deepest wave of the
     * lock's cascade (each wave arrives as a clear of its own), `combo` the true chain. A `crown`
     * (a perfect clear settled after the lines it crowns) and a T-spin that cleared nothing come
     * with no lines.
     */
    onClear({
        rows = null, lines = 1, perfect = false, tspin = false, b2b = false, crown = false, combo = 1, cascade = 1,
        player = 0, screen = null,
    } = {}) {
        if (!this.u) return;
        if (crown) {
            this.crownClear();
            return;
        }
        if (tspin && Number(lines) === 0) {
            this.turnTarn();
            return;
        }
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        // A cascade's later waves build on the first: more fronts, stronger, burning toward gold.
        const depth = Math.max(1, Math.min(10, Math.round(Number(cascade) || 1)));
        const steps = Math.max(0, Math.min(10, Math.round(Number(combo) || 1) - 1));
        const deep = quad ? 0 : Math.min(1, (depth - 1) * 0.3);
        const p = this._palette;
        let rgb;
        if (quad) rgb = [...TARNFIRE];
        else if (n === 1) rgb = [...p.crest];
        else if (n === 2) rgb = [0, 1, 2].map((c) => p.crest[c] * 0.6 + p.spirit[c] * 0.5);
        else rgb = [0, 1, 2].map((c) => p.crest[c] * 0.35 + p.heart[c] * 0.75);
        if (deep > 0) rgb = rgb.map((c, i) => lerp(c, TARNFIRE[i], deep * 0.7));
        const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
        rgb = rgb.map((c) => (c / peak) * 0.9 + 0.1);
        let birth = quad ? this.time + HUSH_HOLD : this.time;
        // No two strokes share a birth (two boards can clear in one frame).
        for (let i = 0; i < this.strokes.length; i++) {
            if (this.strokes[i].time === birth) {
                birth += 1e-6;
                i = -1;
            }
        }
        this.addStroke({
            time: birth,
            fronts: Math.min(6, (perfect ? 4 : n) + depth - 1),
            strength: Math.min(1.9, (0.6 + 0.15 * n + (quad ? 0.3 : 0)) * (1 + 0.18 * (depth - 1)) + 0.02 * steps),
            gold: quad ? 1 : deep,
            rgb,
        });
        // (The light swells as the answer comes: after the hush for four lines.)
        this.env.swell.hit((0.3 + 0.12 * n) * (1 + 0.15 * (depth - 1)), birth);
        const clear = {
            time: birth, lines: n, cascade: depth, combo, tspin, perfect, b2b,
        };
        // (Four lines are answered as their hush ends: see answerQuad.)
        if (!quad) this.play.clear(clear, birth);
        this.story.onClear({ time: this.time, lines: n, perfect });

        // ── Every wisp the stroke passes is gathered and goes home ──
        for (let i = 0; i < this.wisps.length; i++) {
            const w = this.wisps[i];
            if (w.gatherAt !== Infinity) continue;
            // (A drop still in the air leaves its wisp for the next swell.)
            const pass = birth + strokePassTime(Math.hypot(w.x - HEART[0] * this.squeeze, w.z - HEART[2]));
            if (w.birth > pass) continue;
            this.gather(w, pass);
        }

        // ── The cleared rows leave the card as drifts of sparks, out over the water ──
        const board = boardFor(this.layout, player);
        const card = cardUnion(this.layout);
        if (this.sparks && board && card && !screen) {
            const list = Array.isArray(rows) && rows.length ? rows : Array.from({ length: n }, (_, i) => 19 - i);
            const at = [0, 0, 0];
            for (let i = 0; i < list.length && i < 4; i++) {
                const { y } = boardPoint(board, 0.5, list[i], this._point);
                [-1, 1].forEach((side) => {
                    this.screenToWorld(side < 0 ? card.x0 : card.x1, y, 7, at);
                    this.sparks.emit({
                        at,
                        n: Math.round((9 + (quad ? 5 : 0)) * (1 + 0.25 * (depth - 1)) * this.sparkShare()),
                        rgb,
                        time: this.time + i * 0.04,
                        vel: [side * 3.4, 0.5, -0.4],
                        spread: 0.9,
                        scatter: 0.12,
                        life: [1.0, 2.4],
                        size: 0.085,
                        stagger: 0.25,
                    });
                });
            }
        }

        // From the third wave of a cascade the tarn's heart answers too, wider each time.
        if (depth >= 3 && !quad) {
            this.ring(HEART[0] * this.squeeze, HEART[2], birth, 0.3 + 0.1 * depth, rgb, 1 + 0.25 * depth);
        }
        if (quad) {
            this.hushUntil = this.time + HUSH_HOLD;
            // From cold the night holds its breath; the hotter play runs, the less it needs to
            // (a quad mid-fever draws a breath, it does not put the lights out).
            this.hushDepth = (1 - 0.8 * this.heat.level) * flashScale();
            this.shockAt(birth, this.reducedMotion ? 0.5 : 1);
            this.ring(HEART[0] * this.squeeze, HEART[2], birth, 1.5, rgb, 2.8);
            // The answer waits for the hush to end (a new run lets go of one still held).
            this.answers.push(clear);
            this.counts.quads += 1;
            // Gold rises out of the tarn to either side of the board.
            if (this.sparks) {
                for (let i = 0; i < 8; i++) {
                    const side = i % 2 ? 1 : -1;
                    const at = [side * (2.2 + (i >> 1) * 1.3) * this.squeeze, 0.05, -2 - (i >> 1) * 3.2];
                    if (!this.onWater(at[0], at[2], 0.2)) continue;
                    this.sparks.emit({
                        at,
                        n: Math.round(12 * this.sparkShare()),
                        rgb: TARNFIRE,
                        time: birth + 0.1 + (i >> 1) * 0.12,
                        vel: [0, 1.5, 0],
                        spread: 0.6,
                        scatter: 0.8,
                        life: [1.6, 3.2],
                        size: 0.1,
                        stagger: 0.5,
                    });
                }
            }
        }
        if (perfect) this.lift = 1;
        if (tspin) {
            // A whirl where the piece went in: three rings on one another's heels.
            const at = this.lastLanding || [-3 * this.squeeze, -2];
            for (let i = 0; i < 3; i++) this.ring(at[0], at[1], this.time + i * 0.22, 0.8 - i * 0.15, rgb, 0.9 + i * 0.25);
            this.gust = Math.max(this.gust, 0.6);
            if (!quad) this.shockAt(this.time, this.reducedMotion ? 0.2 : 0.4);
        }
        if (b2b) this.answerB2B();
        this.counts.clears += 1;
    }

    /**
     * Four lines answered as their hush ends: the overdrive, the heart's flare under the water,
     * every eye and every lily, the kick and the flash (each added to whatever is still lit).
     */
    answerQuad(clear) {
        const E = this.env;
        const at = clear.time;
        E.overdrive.hit(clear.perfect ? 1.3 : 1, at);
        E.heart.hit(1, at);
        E.eyes.hit(1, at);
        E.lilies.hit(1, at);
        E.kick.hit(0.5, at);
        E.flash.hit(0.22, at);
        this.play.clear(clear, at);
    }

    /**
     * A perfect clear settled on the four lines still playing (it comes ~360 ms after them): no
     * second hush and no second stroke. The gold still crossing the tarn burns the brighter, the
     * ring across the picture takes more light, the heart rising comes up brighter, the mist lifts
     * and the stars come out, and both look up.
     */
    crownClear() {
        const at = this.time;
        const E = this.env;
        this.lift = 1;
        E.crown.hit(1, at);
        E.overdrive.hit(0.35, at);
        E.heart.hit(0.5, at);
        E.eyes.hit(0.5, at);
        E.lilies.hit(0.5, at);
        E.flash.hit(0.12, at);
        E.kick.hit(0.2, at);
        this.shockAt(at, this.reducedMotion ? 0.3 : 0.6);
        let gold = null;
        for (let i = 0; i < this.strokes.length; i++) {
            const k = this.strokes[i];
            if (k.gold >= 1 && at - k.time < STROKE_LIVE && (!gold || k.time > gold.time)) gold = k;
        }
        if (gold) {
            gold.strength = Math.min(1.9, gold.strength * 1.25);
            gold.fronts = Math.max(gold.fronts, 4);
        }
        this.story.onCrown(at);
        this.play.punch.hit(SURGE_WEIGHTS.punch.perfect, at);
        this.play.level.hit(SURGE_WEIGHTS.heat.perfect, at);
        // Gold rises out of the whole tarn, the far water first.
        if (this.sparks) {
            for (let i = 0; i < 10; i++) {
                const side = i % 2 ? 1 : -1;
                const spot = [side * (1.4 + (i >> 1) * 1.1) * this.squeeze, 0.05, -1.5 - (i >> 1) * 2.8];
                if (!this.onWater(spot[0], spot[2], 0.2)) continue;
                this.sparks.emit({
                    at: spot,
                    n: Math.round(10 * this.sparkShare()),
                    rgb: TARNFIRE,
                    time: at + 0.05 + (4 - (i >> 1)) * 0.1,
                    vel: [0, 1.9, 0],
                    spread: 0.5,
                    scatter: 0.9,
                    life: [1.8, 3.4],
                    size: 0.1,
                    stagger: 0.6,
                });
            }
        }
    }

    /** A T-spin that cleared nothing: a small whirl where the piece went in, a breath of wind. */
    turnTarn() {
        const at = this.time;
        const spot = this.lastLanding || [-3 * this.squeeze, -2];
        const rgb = this._palette.crest;
        for (let i = 0; i < 2; i++) this.ring(spot[0], spot[1], at + i * 0.22, 0.5 - i * 0.12, rgb, 0.8 + i * 0.2);
        this.gust = Math.max(this.gust, 0.35);
        this.env.eyes.hit(0.25, at);
        this.play.punch.hit(SURGE_WEIGHTS.punch.tspin * 0.5, at);
        this.play.level.hit(SURGE_WEIGHTS.heat.tspin * 0.45, at);
    }

    /**
     * Back to back, a second difficult clear: the troll lifts his lantern and it blazes, her light
     * answers, their eyes meet and their lights run out over the water toward each other. A second
     * in a row blazes the brighter and runs the further.
     */
    answerB2B() {
        const at = this.time;
        this.env.flare.hit(1, at + 0.1);
        this.env.flash.hit(0.05, at);
        this.story.onB2B(at);
    }

    /**
     * The true combo changed. A higher number draws the two a step nearer; a lower one means
     * the chain broke (0), or broke and a new one has already begun: either way they turn back.
     */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        if (!this.u) {
            this.combo = n;
            return;
        }
        // A chain that breaks in a hot run dims the night less: what it built eases out.
        if (n < this.combo) this.dip = Math.max(this.dip, 0.25 * (1 - 0.7 * this.heat.level));
        else if (n > this.combo) {
            // Each step lights both of them, a longer chain the brighter (added to what is lit).
            this.env.step.hit(0.55 + 0.05 * Math.min(n, 10), this.time);
            this.feeds.push({ time: this.time, side: n % 2 ? -1 : 1, amount: 0.12 });
        }
        this.combo = n;
        this.story.onCombo(n, this.time);
    }

    /** A new level: the night turns to its next hour, and a breath of wind crosses the tarn. */
    levelUp(level, { silent = false } = {}) {
        const n = Number(level);
        const next = Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1;
        const count = HOURS.length;
        // The short way round the wheel (a new run turns back to its first hour, not through them all).
        const k = smooth(0, 1, (this.time - this.turn.time) / HOUR_TURN);
        const from = this.turn.from + (this.turn.to - this.turn.from) * k;
        let to = next - 1;
        while (to - from > count / 2) to -= count;
        while (from - to > count / 2) to += count;
        this.level = next;
        if (silent) {
            this.turn = { from: to, to, time: -100 };
            this.applyPalette();
            return;
        }
        this.turn = { from, to, time: this.time };
        this.story.onLevel(this.time);
        this.gust = Math.max(this.gust, 1);
        this.env.flash.hit(0.1, this.time);
        this.play.levelUp(this.time);
        // The wind shakes the dew out of the boughs: it falls through the moonlight.
        if (this.sparks && this._camera) {
            const at = [0, 0, 0];
            const pale = this._palette.glow;
            for (let i = 0; i < 6; i++) {
                const sx = i % 2 ? 0.72 + (i >> 1) * 0.1 : 0.08 + (i >> 1) * 0.1;
                this.screenToWorld(sx, 0.06, 9 + i * 1.5, at);
                this.sparks.emit({
                    at,
                    n: Math.round(8 * this.sparkShare()),
                    rgb: pale,
                    time: this.time + i * 0.18,
                    vel: [0.6, -0.4, 0],
                    spread: 0.5,
                    scatter: 1.4,
                    life: [2.2, 4.2],
                    size: 0.06,
                    stagger: 1.2,
                });
            }
        }
    }

    /** Write the hour's palette into the shared uniforms. */
    applyPalette() {
        paletteAt(this.hourNow(), this._palette);
        const { u } = this;
        if (!u) return;
        const p = this._palette;
        for (let i = 0; i < PALETTE_KEYS.length; i++) {
            const key = PALETTE_KEYS[i];
            u[key].value.set(p[key][0], p[key][1], p[key][2]);
        }
        for (let i = 0; i < PALETTE_SCALARS.length; i++) {
            const key = PALETTE_SCALARS[i];
            u[key].value = p[key];
        }
    }

    // ── The two figures ─────────────────────────────────────────────────────────

    /**
     * The story moves them (stillwater-story.js says what each means to do; their bodies carry it
     * out). Their bodies are stepped from frame to frame: a replay from a seek steps them the same way.
     */
    placeFigures(dt) {
        const t = this.time;
        const sq = this.squeeze;
        const at = this._figuresAt;
        const trollRoot = this.troll?.body?.root;
        // (The story thinks in the stage's coordinates; the figures walk in true metres.)
        if (trollRoot) {
            at.troll[0] = trollRoot.x / sq;
            at.troll[1] = trollRoot.z;
        }
        at.spiritHeart[0] = this._heartOf[0] / sq;
        at.spiritHeart[1] = this._heartOf[1];
        at.spiritHeart[2] = this._heartOf[2];
        at.lantern[0] = this._lantern[0] / sq;
        at.lantern[1] = this._lantern[1];
        at.lantern[2] = this._lantern[2];
        // (What each is doing with their body, for the scenes of their life.)
        const tb = this.troll?.body;
        at.trollMode = tb ? tb.mode : 'seated';
        at.trollSpeed = tb ? tb.speed : 0;
        const sr = this.spirit?.rootWalk();
        if (sr) {
            at.spirit = at.spirit || [0, 0, 0];
            at.spirit[0] = sr.x / sq;
            at.spirit[1] = sr.y;
            at.spirit[2] = sr.z;
        }
        at.spiritMode = this.spirit?.body?.mode || 'standing';
        this.story.update(t, dt, at);
        const events = this.story.life.drain();
        if (events) events.forEach((e) => this.lifeEvent(e));
        const toWorld = (p, out) => {
            if (!p) return null;
            out[0] = p[0] * sq;
            out[1] = p[1];
            out[2] = p[2];
            return out;
        };

        // ── The troll ──
        if (this.troll) {
            const want = this.story.trollWant(t, this._trollWant);
            // (The story's places are the stage's: he walks in true metres.)
            want.at[0] *= sq;
            want.look = toWorld(want.look, this._lookW);
            // He faces her across the water, reckoned where he really stands (unless what he is
            // doing turns him some other way).
            if (trollRoot && !want.faceFixed) {
                want.face = Math.atan2(this._heartOf[0] - (want.at[0]), this._heartOf[2] - want.at[1]);
            }
            // (His cloak takes the wind a hot run raises in the wood.)
            const stir = this.reducedMotion ? 0.3 : 1;
            want.wind = this.gust * 1.5 + this.surge * 0.5 + (0.3 * this.hotness + 0.35 * this.heat.fever) * stir;
            want.startle = !this.reducedMotion;
            const steps = this.troll.update(dt, want, t);
            for (let i = 0; i < steps.length; i++) {
                const e = steps[i];
                // A step or the staff in the water leaves a ring (a knock on it, a ring to cross to her).
                if (e.y < 0) {
                    const staff = e.type === 'staff';
                    const knock = staff && e.strength >= 1;
                    let strength = 0.32 * e.strength;
                    let reach = 0.55;
                    if (staff) {
                        strength = knock ? 0.6 : 0.16;
                        reach = knock ? 1.5 : 0.3;
                    }
                    this.ring(e.x, e.z, t, strength, this._palette.lantern, reach);
                }
            }
            this.troll.lanternWorld(this._lantern);
            if (trollRoot) {
                const dx = trollRoot.x / sq - TROLL.home[0];
                const dz = trollRoot.z - TROLL.home[2];
                this.trollS = clamp01(Math.hypot(dx, dz) / TROLL_PATH);
            }
        }

        // ── The spirit ──
        if (this.spirit) {
            const want = this.story.spiritWant(t, this._spiritWant);
            let s = 0;
            if (want.kneel) s = KNEEL_AT;
            else if (want.out > 0.02) s = 0.24 + 0.76 * want.out;
            const point = want.at || spiritPathPoint(s, this._from);
            const b = this._spiritBody;
            b.at[0] = point[0] * sq;
            b.at[1] = point[1];
            b.at[2] = point[2];
            // She faces out over the water toward him; at rest a little more toward the tarn's heart;
            // where she drifts, the way she goes; going home, toward her stone (looking back at him
            // over her shoulder). What she merely glances at turns her head, not all of her.
            const root = this.spirit.rootWalk();
            const toLantern = Math.atan2(this._lantern[0] - root.x, this._lantern[2] - root.z);
            const toHeart = Math.atan2(HEART[0] * sq - root.x, HEART[2] - root.z);
            const rest = toHeart + (toLantern - toHeart) * 0.4;
            b.face = want.faceMode === 'lantern' ? toLantern : rest;
            const away = (x, z) => {
                const dx = x - root.x;
                const dz = z - root.z;
                return Math.hypot(dx, dz) > 0.4 ? Math.atan2(dx, dz) : null;
            };
            if (want.faceMode === 'home') b.face = away(SPIRIT.home[0] * sq, SPIRIT.home[2]) ?? b.face;
            else if (want.faceMode === 'path') b.face = away(b.at[0], b.at[2]) ?? rest;
            else if (want.faceMode === 'abs' && Number.isFinite(want.face)) b.face = want.face;
            b.kneel = want.kneel;
            b.pace = want.pace;
            b.gesture = want.gesture;
            b.hands = want.hands;
            b.look = toWorld(want.look, this._lookS);
            b.gazeDown = want.gazeDown;
            const stirred = (0.2 * this.hotness + 0.25 * this.heat.fever) * (this.reducedMotion ? 0.3 : 1);
            b.wind = 0.25 + this.gust + this.surge * 0.4 + stirred;
            // Her motes rise thicker with every heart she holds, and as play runs hot.
            const holds = this.story.heartTaken(t) * 1.2 + this.story.heartsHeld(t) * 0.3;
            this.spirit.uFed.value = Math.min(1.5, this.fedL + holds + 0.15 * this.hotness + 0.25 * this.heat.fever
                + 0.3 * this.crown + this.lifeGlow('spirit', t) * 1.4);
            const touches = this.spirit.update(dt, b, t);
            for (let i = 0; i < touches.length; i++) {
                const e = touches[i];
                // Her fingertips in the water (set down to answer him, a ring to cross to him).
                const answer = e.strength > 0.7;
                this.ring(e.x, e.z, t, answer ? 0.6 : 0.18, this._palette.spirit, answer ? 1.5 : 0.4);
            }
            // As she drifts over the water her hem leaves a soft wake.
            const v = this.spirit.body?.velocity;
            if (v && root.y < 0.2 && Math.hypot(v.x, v.z) > 0.12 && t - this.lastWake > WAKE_EVERY) {
                this.lastWake = t;
                this.ring(root.x, root.z, t, 0.14, this._palette.spirit, 0.45);
            }
            this.spirit.heartWorld(this._heartOf);
            const home = spiritPathPoint(1);
            this.spiritS = clamp01(Math.hypot(root.x / sq - SPIRIT.home[0], root.z - SPIRIT.home[2])
                / Math.hypot(home[0] - SPIRIT.home[0], home[2] - SPIRIT.home[2]));
        }
    }

    /**
     * Something the two's own life sets in motion (stillwater-life.js): a stone skipped across the
     * water (its rings), a light held, sent across or let go, a little boat of light, a lantern
     * trimmed, a song. All in the stage's coordinates; the water and the lights take them here.
     */
    lifeEvent(e) {
        const sq = this.squeeze;
        const pal = this._palette;
        if (e.type === 'skip') {
            // A pebble warmed in his lantern, skipped across to her: it touches the water at each
            // skip (a ring with its glow on the crest, a little splash), and sinks.
            const glow = [0, 1, 2].map((c) => 0.55 * pal.lantern[c] + 0.45);
            e.path.forEach((b, i) => {
                const time = e.start + b.t;
                this.ring(b.x * sq, b.z, time, 0.24 + 0.3 * b.strength, glow, 0.6 + 0.5 * b.strength);
                this.sparks?.emit({
                    at: [b.x * sq, 0.02, b.z],
                    n: Math.max(2, Math.round((4 + 7 * b.strength) * this.sparkShare())),
                    rgb: glow,
                    time,
                    vel: [0, 1.0 + b.strength * 1.0, 0],
                    spread: 0.45,
                    life: [0.35, 0.7],
                    size: 0.06,
                    splash: true,
                });
                if (i === e.path.length - 1) this.ring(b.x * sq, b.z, time + 0.35, 0.14, glow, 0.45);
            });
            this.lifeLights.push({
                type: 'stone', start: e.start, from: e.from, path: e.path, length: e.path.at(-1).t + 0.5,
            });
        } else if (e.type === 'held' || e.type === 'gift' || e.type === 'release' || e.type === 'boat') {
            this.lifeLights.push(e);
            if (this.lifeLights.length > 8) this.lifeLights.shift();
            // The one it goes to makes ready for it: his lantern lifted, her hands cupped.
            if (e.type === 'gift') this.story.onArrival(e.to === 'troll' ? 1 : -1, e.start + e.length);
            if (e.type === 'boat') this.story.onArrival(-1, e.start + e.length + BOAT_RISE);
        } else if (e.type === 'tend' || e.type === 'song') {
            const tend = e.type === 'tend';
            this.lifeGlows.push({
                who: tend ? 'troll' : 'spirit', start: e.start, length: e.length, amount: tend ? 0.45 : 0.35,
            });
            if (this.lifeGlows.length > 4) this.lifeGlows.shift();
        } else if (e.type === 'twirl') {
            // Rings about her as she turns on the water.
            const r = this.spirit?.rootWalk();
            if (r && r.y < 0.2) {
                [0.5, 1.5, 2.6].forEach((at, i) => this.ring(r.x, r.z, e.start + at, 0.12 - i * 0.02, pal.spirit, 0.5));
            }
        }
    }

    /** How much the life's glows lend `who` now (0..). */
    lifeGlow(who, t) {
        let sum = 0;
        for (let i = 0; i < this.lifeGlows.length; i++) {
            const g = this.lifeGlows[i];
            if (g.who !== who) continue;
            const k = (t - g.start) / g.length;
            if (k > 0 && k < 1) sum += g.amount * Math.sin(Math.PI * k) ** 0.5;
        }
        return sum;
    }

    /**
     * Where one of the life's lights is now (world) and how brightly it burns; null when it is not
     * lit. Its colour into `rgb`. (Pure of the clock and of where the two are now.)
     */
    lifeLightAt(e, t, out, rgb) {
        const sq = this.squeeze;
        const pal = this._palette;
        const fire = pal.firefly || pal.spirit;
        const spiritHands = () => (this.spirit?.body ? this.spirit.body.handsWalk(this._lifeV) : null);
        const trollHand = () => {
            const b = this.troll?.body;
            return b ? b.toWalk(b.globalPos.handR, this._lifeV) : null;
        };
        const age = t - e.start;
        if (age < 0) return null;
        rgb[0] = fire[0];
        rgb[1] = fire[1];
        rgb[2] = fire[2];
        if (e.type === 'held') {
            if (age > e.length) return null;
            const p = e.who === 'troll' ? trollHand() : spiritHands();
            if (!p) return null;
            const k = Math.min(1, age / 0.35) * Math.min(1, (e.length - age) / 0.2 + 0.001);
            out[0] = p.x;
            out[1] = p.y + (e.who === 'troll' ? 0.08 : 0.04);
            out[2] = p.z + (e.who === 'troll' ? 0.05 : 0.03);
            out[3] = 0.85 * Math.min(1, k);
            return out;
        }
        if (e.type === 'gift') {
            const k = age / e.length;
            if (k > 1) return null;
            // (Where it set out from is kept when it sets out; where it goes is followed.)
            if (!e.from3) {
                const p = e.from === 'spirit' ? spiritHands() : null;
                const l = this._lantern;
                e.from3 = p ? [p.x, p.y, p.z] : [l[0], l[1] + 0.1, l[2]];
            }
            const end = e.to === 'troll' ? this._lantern : this._heartOf;
            const to = [end[0], end[1], end[2]];
            arcAt(e.from3, to, k, 1.3, out);
            out[3] = 1.1 * (1 - Math.max(0, k - 0.9) * 10);
            if (e.to === 'spirit') {
                rgb[0] = (fire[0] + pal.lantern[0]) * 0.5;
                rgb[1] = (fire[1] + pal.lantern[1]) * 0.5;
                rgb[2] = (fire[2] + pal.lantern[2]) * 0.5;
            }
            return out;
        }
        if (e.type === 'release') {
            if (age > e.length) return null;
            if (!e.from3) {
                const p = spiritHands();
                e.from3 = p ? [p.x, p.y, p.z] : [this._heartOf[0], this._heartOf[1], this._heartOf[2]];
            }
            const k = age / e.length;
            out[0] = e.from3[0] + Math.sin(age * 2.2) * 0.25 * k + 0.4 * k;
            out[1] = e.from3[1] + age * 0.75;
            out[2] = e.from3[2] + Math.cos(age * 1.7) * 0.2 * k;
            out[3] = 0.9 * (1 - k * k);
            return out;
        }
        if (e.type === 'stone') {
            if (age > e.length) return null;
            const p = skipAt(e.path, e.from, age, out);
            if (!p) return null;
            out[0] *= sq;
            const last = e.path.at(-1).t;
            // (Warm from his lantern; it goes out as it sinks.)
            out[3] = 0.7 * (age > last ? Math.max(0, 1 - (age - last) / 0.4) : 1);
            rgb[0] = pal.lantern[0];
            rgb[1] = pal.lantern[1];
            rgb[2] = pal.lantern[2];
            return out;
        }
        if (e.type === 'boat') {
            const from = [e.from[0] * sq, 0, e.from[2]];
            const to = [e.to[0] * sq, 0, e.to[2]];
            if (age <= e.length) {
                boatAt(from, to, age, e.length, out);
                out[3] = 0.85;
                return out;
            }
            // At the end it rises into her hands, and is hers.
            const k = (age - e.length) / BOAT_RISE;
            if (k > 1) return null;
            const end = boatAt(from, to, e.length, e.length, [0, 0, 0]);
            const p = spiritHands();
            arcAt(end, p ? [p.x, p.y, p.z] : this._heartOf, k, 0.3, out);
            out[3] = 0.85 + 0.4 * Math.sin(Math.PI * k);
            return out;
        }
        return null;
    }

    /** The life's lights: their rings and their arrivals (light given is light received). */
    stepLifeLights(t) {
        for (let i = this.lifeLights.length - 1; i >= 0; i--) {
            const e = this.lifeLights[i];
            const age = t - e.start;
            if (e.type === 'boat' && age > 0 && age < e.length && t - this.boatWake > 0.9) {
                // A soft wake behind the little boat.
                this.boatWake = t;
                const sq = this.squeeze;
                const from = [e.from[0] * sq, 0, e.from[2]];
                const p = boatAt(from, [e.to[0] * sq, 0, e.to[2]], age, e.length, this._lifeP);
                this.ring(p[0], p[2], t, 0.07, this._palette.firefly || this._palette.spirit, 0.3);
            }
            const ends = e.type === 'boat' ? e.length + BOAT_RISE : e.length;
            if (!e.arrived && age >= ends && (e.type === 'gift' || e.type === 'boat')) {
                e.arrived = true;
                if (e.to === 'troll') this.fedR = Math.min(1.4, this.fedR + 0.45);
                else this.fedL = Math.min(1.4, this.fedL + 0.5);
            }
            if (age > ends + 1) this.lifeLights.splice(i, 1);
        }
    }

    /**
     * While a chain holds the two near, their light goes out from each toward the other over the
     * water: motes from her breast and from his lantern, meeting behind the board.
     */
    streamLight(t) {
        if (!this.sparks || this.story.path < 0.4) return;
        // (A fever streams them twice as thick.)
        const slot = Math.floor(t / (0.32 / (1 + this.heat.fever)));
        if (slot === this.streamSlot) return;
        this.streamSlot = slot;
        const h = this._heartOf;
        const l = this._lantern;
        const mid = [(h[0] + l[0]) * 0.5, 0.7, (h[2] + l[2]) * 0.5];
        const n = Math.max(1, Math.round(this.sparkShare()));
        const common = {
            n, time: t, home: mid, life: [2.6, 3.6], size: 0.065, scatter: 0.18,
        };
        this.sparks.emit({ ...common, at: [h[0], h[1] - 0.15, h[2]], rgb: this._palette.spirit });
        this.sparks.emit({ ...common, at: [l[0], l[1], l[2]], rgb: this._palette.lantern });
    }

    // ── Frame ───────────────────────────────────────────────────────────────────

    update(sim) {
        const { u } = this;
        if (!u) return;
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const t = this.time;
        const motion = this.reducedMotion ? 0.3 : 1;

        // ── Four lines answered as their hush ends ──
        for (let i = 0; i < this.answers.length; i++) {
            if (t < this.answers[i].time) continue;
            this.answerQuad(this.answers[i]);
            this.answers.splice(i, 1);
            i -= 1;
        }

        // ── How hot play runs, and every envelope at this moment ──
        const heat = this.play.sample(t);
        this.heat = heat;
        const { level, fever, punch } = heat;
        const warm = smooth(0.12, 0.5, level);
        const hot = smooth(0.4, 0.85, level);
        this.warmth = warm;
        this.hotness = hot;
        const E = this.env;
        this.flash = E.flash.valueAt(t);
        this.kick = E.kick.valueAt(t);
        this.surge = E.overdrive.valueAt(t);
        this.stepFlash = E.step.valueAt(t);
        this.heartFlash = E.heart.valueAt(t);
        this.eyesFlash = E.eyes.valueAt(t);
        this.liliesFlash = E.lilies.valueAt(t);
        this.crown = E.crown.valueAt(t);
        this.flare = E.flare.valueAt(t);

        // ── The charge ──
        const target = powerForCombo(this.combo);
        this.power += (target - this.power) * approach(target > this.power ? 2.4 : 0.8, dt);
        this.dip *= Math.exp(-dt / 0.35);
        this.gust *= Math.exp(-dt / 2.4);
        this.lift *= Math.exp(-dt / 5.5);
        this.fedL *= Math.exp(-dt / 1.9);
        this.fedR *= Math.exp(-dt / 1.9);
        // Light that has come home.
        if (this.feeds.length) {
            for (let i = this.feeds.length - 1; i >= 0; i--) {
                const f = this.feeds[i];
                if (t < f.time) continue;
                if (f.side < 0) this.fedL = Math.min(1.4, this.fedL + f.amount);
                else this.fedR = Math.min(1.4, this.fedR + f.amount);
                this.feeds.splice(i, 1);
            }
        }
        // The quad's hush: as deep as it was asked to be when it began (0 = none).
        const hush = t < this.hushUntil ? this.hushDepth : 0;
        const breathTarget = hush > 0 ? 1 - 0.8 * hush : 1 - this.dip;
        this.breath += (breathTarget - this.breath) * approach(hush > 0 ? 40 : 14, dt);

        // ── What the chain wakes, and what a hot run wakes whatever the chain ──
        const eyesTarget = Math.max(eyesForCombo(this.combo), 0.3 * warm + 0.35 * hot + 0.35 * fever);
        this.eyes += (eyesTarget - this.eyes) * approach(eyesTarget > this.eyes ? 1.6 : 1.1, dt);
        const liliesTarget = Math.max(clamp01(this.combo / 6), 0.3 * warm + 0.4 * hot + 0.3 * fever);
        this.lilies += (liliesTarget - this.lilies) * approach(liliesTarget > this.lilies ? 1.2 : 0.5, dt);
        // The caps light a step at a time, the left bank's first, from the frame's edge inward.
        const capsHeat = 0.12 + 0.4 * warm + 0.25 * hot + 0.23 * fever;
        const capsLTarget = Math.max(0.12 + 0.88 * clamp01(Math.ceil(this.combo / 2) / 4), capsHeat);
        const capsRTarget = Math.max(0.12 + 0.88 * clamp01(Math.floor(this.combo / 2) / 4), capsHeat);
        this.capsL += (capsLTarget - this.capsL) * approach(capsLTarget > this.capsL ? 2.2 : 0.9, dt);
        this.capsR += (capsRTarget - this.capsR) * approach(capsRTarget > this.capsR ? 2.2 : 0.9, dt);
        // The heart on the bed: a chain wakes it, and a fever of play sets it burning.
        const heartTarget = Math.max(heartForCombo(this.combo), 0.25 * hot + 0.6 * fever);
        this.heart += (heartTarget - this.heart) * approach(heartTarget > this.heart ? 0.9 : 0.6, dt);

        // The slow clock, and the air's own phase (integrated: its pace follows the wind, gently).
        // A hot run stirs the spruces and the water; the mist and the fireflies hurry.
        const stir = (0.08 * warm + 0.1 * hot + 0.12 * fever) * motion;
        const wind = 0.25 + this.gust * 0.75 + this.surge * 0.2 + stir;
        this.drift += dt * motion * (1 + this.power * 0.8 + this.surge * 1.5 + 0.3 * level + 0.4 * fever);
        this.sway += dt * motion * (0.85 + wind * 0.5);

        this.applyPalette();
        // A fever of play draws the two out to the water's edge, chain or none.
        this.story.setFervour(smooth(0.35, 0.9, fever));
        this.placeFigures(dt);
        this.stepLifeLights(t);
        this.streamLight(t);

        // ── Event tables: live rows packed at the front ──
        let rings = 0;
        for (let i = 0; i < this.rings.length; i++) {
            const r = this.rings[i];
            const age = t - r.time;
            if (age < -3 || age > RING_LIVE) continue;
            u.ringRows[rings * 2].set(r.x, r.z, r.time, r.strength);
            u.ringRows[rings * 2 + 1].set(r.rgb[0], r.rgb[1], r.rgb[2], r.reach);
            rings += 1;
        }
        let strokes = 0;
        for (let i = 0; i < this.strokes.length; i++) {
            const s = this.strokes[i];
            const age = t - s.time;
            if (age < -3 || age > STROKE_LIVE) continue;
            u.strokeRows[strokes * 2].set(s.time, s.fronts, s.strength, s.gold);
            u.strokeRows[strokes * 2 + 1].set(s.rgb[0], s.rgb[1], s.rgb[2], 0);
            strokes += 1;
        }
        // Wisps: drop the ones that have gone out or come home, then write the rest.
        let live = 0;
        const pool = [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]]; // x, y, z, light, r, g, b sums per side
        for (let i = this.wisps.length - 1; i >= 0; i--) {
            const w = this.wisps[i];
            const done = t - w.birth > WISP_HOLD || t > w.gatherAt + WISP_HOME;
            if (done) this.wisps.splice(i, 1);
        }
        // (The newest first: when one is still on its way home as the next is born, it is the
        // newcomer that must be seen.)
        for (let i = this.wisps.length - 1; i >= 0 && live < WISP_SLOTS; i--) {
            const w = this.wisps[i];
            const at = this.wispAt(w, t);
            if (!(at[3] > 0)) continue;
            u.wispRows[live * 2].set(at[0], at[1], at[2], at[3]);
            u.wispRows[live * 2 + 1].set(w.rgb[0], w.rgb[1], w.rgb[2], w.seed);
            const side = pool[at[0] < 0 ? 0 : 1];
            side[0] += at[0] * at[3];
            side[1] += at[1] * at[3];
            side[2] += at[2] * at[3];
            side[3] += at[3];
            side[4] += w.rgb[0] * at[3];
            side[5] += w.rgb[1] * at[3];
            side[6] += w.rgb[2] * at[3];
            live += 1;
        }
        // The lights of their own life, in the wisps' table after the wisps.
        for (let i = 0; i < this.lifeLights.length && live < WISP_SLOTS; i++) {
            const at = this.lifeLightAt(this.lifeLights[i], t, this._wisp, this._lifeRGB);
            if (!at || !(at[3] > 0)) continue;
            const c = this._lifeRGB;
            u.wispRows[live * 2].set(at[0], at[1], at[2], at[3]);
            u.wispRows[live * 2 + 1].set(c[0], c[1], c[2], (0.37 + i * 0.11) % 1);
            const side = pool[at[0] < 0 ? 0 : 1];
            side[0] += at[0] * at[3];
            side[1] += at[1] * at[3];
            side[2] += at[2] * at[3];
            side[3] += at[3];
            side[4] += c[0] * at[3];
            side[5] += c[1] * at[3];
            side[6] += c[2] * at[3];
            live += 1;
        }
        u.counts.value.set(rings, strokes, live, 0);
        // The wisps' light on the banks, gathered into one lamp per side.
        [[u.poolL, u.poolColL], [u.poolR, u.poolColR]].forEach(([at, colour], i) => {
            const side = pool[i];
            if (side[3] > 1e-3) {
                at.value.set(side[0] / side[3], side[1] / side[3] + 0.3, side[2] / side[3], Math.min(2.2, side[3] * 0.35));
                colour.value.set(side[4] / side[3], side[5] / side[3], side[6] / side[3]);
            } else at.value.w = 0;
        });

        // ── Uniforms ──
        u.time.value = t;
        // (The fireflies wake with the chain and with a hot run.)
        u.power.value = Math.min(1, this.power + 0.3 * warm + 0.25 * hot + 0.3 * fever);
        // (The overdrive of four lines only: the sky's northern lights read it, and the build-up
        // of play is never laid on them.)
        u.surge.value = Math.min(1.45, this.surge);
        u.breath.value = this.breath;
        u.drift.value = this.drift;
        u.sway.value = this.sway;
        u.wind.value = wind;
        u.ruffle.value = 1 - 0.85 * hush;
        u.lift.value = clamp01(this.lift);
        u.shafts.value = 0.3 + this.power * 0.5 + this.surge * 0.5;
        // The tarnfire: how far the heart's gold spreads through the water and the mist on it.
        u.heat.value.set(level, Math.min(1, fever + 0.5 * this.crown));
        u.eyes.value.set(this.eyes, Math.min(1, this.eyesFlash));
        u.lilies.value.set(this.lilies, Math.min(1, this.liliesFlash));
        u.caps.value.set(this.capsL, this.capsR);
        // The heart's flight: while it is up out of the water the bed lies dark, and it lights the night.
        const orb = this.story.heartAt(t, this._orb);
        const awayTarget = orb ? clamp01(orb[1] + 0.6) : 0;
        // (Eased: where one heart's flight ends and the next one's begins the bed comes back softly.)
        this.away += (awayTarget - this.away) * approach(5, dt);
        u.heartAt.value.set(
            HEART[0] * this.squeeze,
            HEART[1],
            HEART[2],
            clamp01(this.heart * 0.75 + this.heartFlash + 0.35 * this.crown) * (1 - this.away * 0.85),
        );
        if (orb) u.orbAt.value.set(orb[0] * this.squeeze, orb[1], orb[2], orb[3]);
        else u.orbAt.value.w = 0;
        const taken = this.story.heartTaken(t);
        const held = this.story.heartsHeld(t);
        // Both lights burn brighter as play runs hot; she with every heart she holds; he blazes
        // for a back-to-back, and she answers.
        const glow = 0.25 * warm + 0.3 * hot + 0.35 * fever;
        const h = this._heartOf;
        u.spiritAt.value.set(h[0], h[1], h[2], 0.6 + this.power * 0.3 + this.fedL * 0.6 + this.stepFlash * 0.25 + taken * 1.6
            + this.story.gaze * 0.15 + held * 0.45 + glow + this.crown * 0.5 + this.flare * 0.5
            + this.lifeGlow('spirit', t));
        const l = this._lantern;
        // (When their eyes meet, both lights warm a little.)
        u.lanternAt.value.set(l[0], l[1], l[2], 0.5 + this.power * 0.35 + this.fedR * 0.7 + this.stepFlash * 0.2
            + this.story.gaze * 0.15 + glow * 1.15 + this.crown * 0.4 + this.flare * 1.1 + this.lifeGlow('troll', t));
        // The path of light that runs between them on the water while the chain holds them near
        // (a back-to-back sends it running out from both for a moment, further for a second one).
        const sr = this.spirit?.rootWalk();
        u.path.value.set(Math.max(this.story.path, Math.min(1, 0.6 * this.flare)), this.story.gaze, taken, 0);
        if (sr) u.pathEnds.value.set(sr.x, sr.z, l[0], l[2]);

        // ── Post ──
        const swell = E.swell.valueAt(t);
        const post = this._post;
        // (The punch of play keeps a floor under rapid locks: the flash rides on it.)
        post.flash = this.flash + punch * 0.03;
        post.kick = Math.min(1, this.kick);
        // The moon's shafts stream between the trunks as play runs hot; the hush draws them in.
        const shafts = 0.26 + this.power * 0.24 + swell * 0.25 + this.surge * 0.4
            + 0.1 * hot + 0.22 * fever + 0.15 * this.crown;
        post.shafts = shafts + (0.05 - shafts) * hush;
        post.bloomBoost = this.surge * 0.1 + swell * 0.1 + 0.04 * level + 0.08 * fever + 0.12 * this.crown;
        // The iris closes a little as the night flares and as play runs hot, so its colours
        // survive the surge (a little: the four lines' answer must not darken the night).
        post.exposure = 1 / (1 + this.surge * 0.25 + swell * 0.15 + this.heartFlash * 0.15 + 0.06 * level + 0.08 * fever
            + 0.08 * this.crown);
        const ringAge = t - this.shock.time;
        const ringOn = ringAge >= 0 && ringAge < 2.2;
        post.prism.radius = ringOn ? ringAge * 1.25 + 0.02 : 0;
        // (A bright band across the whole picture: held back under Reduce flashing.)
        post.prism.strength = ringOn ? this.shock.strength * Math.exp(-ringAge / SHOCK_FADE) * flashScale() : 0;
        const p = this._palette;
        for (let c = 0; c < 3; c++) post.shade[c] = p.deep[c] * 0.6 + p.haze[c] * 0.08;
    }

    /** What the post stack reads each frame (a reused object). */
    getPostState() {
        return this._post;
    }

    getState() {
        const names = hourNames(this.hourNow());
        return {
            quality: this.quality,
            time: this.time,
            combo: this.combo,
            power: this.power,
            surge: this.surge,
            heat: this.heat.level,
            fever: this.heat.fever,
            stage: this.heat.stage,
            breath: this.breath,
            level: this.level,
            hour: this.hourNow(),
            hourFrom: names.from,
            hourTo: names.to,
            hourMix: names.mix,
            squeeze: this.squeeze,
            counts: { ...this.counts },
            rings: this.u ? this.u.counts.value.x : 0,
            strokes: this.u ? this.u.counts.value.y : 0,
            wisps: this.u ? this.u.counts.value.z : 0,
            spirit: this.spiritS,
            troll: this.trollS,
            trollReady: Boolean(this.troll?.ready),
            spiritReady: Boolean(this.spirit?.ready),
            trollMode: this.troll?.body?.mode || null,
            spiritMode: this.spirit?.body?.mode || null,
            bond: this.story.bond,
            path: this.story.path,
            gaze: this.story.gaze,
            kin: this.story.kin,
            busy: this.story.busy,
            // (What each is doing between times and watching: a name, or 'none'.)
            scenes: {
                troll: this.story.life.sceneOf('troll') || 'none', spirit: this.story.life.sceneOf('spirit') || 'none',
            },
            looks: { troll: this.story.lookKey.troll || 'none', spirit: this.story.lookKey.spirit || 'none' },
            eyes: this.eyes,
            heart: this.heart,
            fed: [this.fedL, this.fedR],
            trunks: this.parts.trunks ? this.parts.trunks.count : 0,
            boughs: (this.parts.boughs ? this.parts.boughs.count : 0) + (this.parts.fringe ? this.parts.fringe.count : 0),
            boulders: this.parts.boulders ? this.parts.boulders.count : 0,
            sparks: this.sparks ? this.sparks.count : 0,
            mirror: Boolean(this.water?.reflection),
            layoutLive: this.layoutLive,
            moon: { ...this.moonScreen },
            heartScreen: { ...this.heartScreen },
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
        this.water?.reflection?.dispose?.();
        this.textures.forEach((t) => t.dispose());
        if (this._clear && this.renderer?.setClearColor) {
            this.renderer.setClearColor(this._clear.color, this._clear.alpha);
        }
        this._camera?.layers?.disable?.(HERO_LAYER);
        this.disposables = [];
        this.textures = [];
        this.parts = {};
        this.water = null;
        this.spirit = null;
        this.troll = null;
        this.sparks = null;
        this.drops = null;
        this.u = null;
        this._camera = null;
    }
}

export { PARTS as STILLWATER_PARTS };
