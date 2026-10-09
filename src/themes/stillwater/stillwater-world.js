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
    approachForCombo,
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
    planBoulders, planCaps, planEyes, planFerns, planLilies, planReeds, planSaplings, planTrunks, shoreDistance,
} from './stillwater-plan.js';
import { createSky } from './stillwater-sky.js';
import { createWater } from './stillwater-water.js';
import { createBoulders, createGround } from './stillwater-land.js';
import { createBoughs, createTrunks, planBoughs } from './stillwater-trees.js';
import {
    createCaps, createFerns, createLilies, createPads, createReeds, createSaplings,
} from './stillwater-flora.js';
import { createSpirit, createTroll } from './stillwater-figures.js';
import {
    createDrops, createEyes, createFireflies, createMist, createSparks, createWisps,
} from './stillwater-fx.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './stillwater-composition.js';

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

/** Metres a second the troll walks, and the spirit's footfall (metres between rings). */
const TROLL_PACE = 0.6;
const FOOTFALL = 0.62;

const PARTS = [
    'sky', 'water', 'ground', 'boulders', 'trunks', 'boughs', 'fringe', 'saplings', 'ferns', 'reeds', 'pads', 'lilies',
    'caps', 'spirit', 'troll', 'mist', 'eyes', 'fireflies', 'wisps', 'drops', 'sparks',
];

const TROLL_PATH = Math.hypot(TROLL.reach[0] - TROLL.home[0], TROLL.reach[2] - TROLL.home[2]);

export class StillwaterWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {THREE.WebGPURenderer} [params.renderer]
     * @param {boolean} [params.capture=false]  deterministic captures: no wall-clock anywhere
     */
    constructor({
        scene, quality = 'High', renderer = null, capture = false,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.renderer = renderer;
        this.capture = capture;
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
        this.surge = 0;
        this.level = 1;
        /** The level's place on the wheel of hours, turning from one to the next. */
        this.turn = { from: 0, to: 0, time: -100 };
        this.flash = 0;
        this.kick = 0;
        this.dip = 0;
        this.breath = 1;
        this.gust = 0;
        this.lift = 0;
        this.hushUntil = -1;
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
        /** The spirit: how far out over the water she is (0..1), and how far she has walked. */
        this.spiritS = 0;
        this.spiritWalked = 0;
        this.spiritFacing = 1.6;
        /** The troll: how far down to the water he is (0..1), his stride, his bearing. */
        this.trollS = 0;
        this.trollStride = 0;
        this.trollMoving = 0;
        this.trollFacing = -1.3;
        this.trollLook = 0;
        this.lookKick = 0;
        this.lastLanding = null;
        this.shock = { time: -100, strength: 0 };
        this.lastClear = { time: -100, lines: 0 };
        this.pendingHeart = { time: Infinity, amount: 0 };
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
            mirrorScale: tier.mirror, lite: tier.lite, glitter: tier.glitter, columns: tier.columns,
        });
        this.addPart('water', this.water);
        if (this.water.reflectorTarget) this.root.add(this.water.reflectorTarget);
        this.addPart('sky', createSky(u, { lite: tier.lite }));

        // ── The stage: what stands in the scene (mirrored by the water's pass) ──
        this.trunkPlan = planTrunks(tier.trunks);
        this.addPart('ground', createGround(u, { cell: tier.cell }), banks);
        this.addPart('boulders', createBoulders(u, planBoulders(tier.boulders)), banks);
        this.addPart('trunks', createTrunks(u, this.trunkPlan), banks);
        if (tier.boughs > 0) {
            const boughs = planBoughs(this.trunkPlan, tier.boughs);
            const fringe = boughs.filter((b) => b.fringe);
            this.addPart('boughs', createBoughs(u, boughs.filter((b) => !b.fringe)), banks);
            if (fringe.length) this.addPart('fringe', createBoughs(u, fringe, 'StillwaterFringe'), banks);
        }
        if (tier.saplings > 0) this.addPart('saplings', createSaplings(u, planSaplings(tier.saplings)), banks);
        if (tier.ferns > 0) this.addPart('ferns', createFerns(u, planFerns(tier.ferns)), banks);
        if (tier.reeds > 0) this.addPart('reeds', createReeds(u, planReeds(tier.reeds)), banks);
        const lilyPlan = planLilies(tier.lilies);
        this.addPart('pads', createPads(u, lilyPlan), banks);
        this.addPart('lilies', createLilies(u, lilyPlan.filter((p) => p.flower)), banks);
        this.addPart('caps', createCaps(u, planCaps(tier.caps)), banks);
        this.spirit = createSpirit(u);
        this.addPart('spirit', this.spirit, banks);
        this.troll = createTroll(u, { lod: tier.troll });
        this.addPart('troll', this.troll, banks);

        // ── The air of the place, and what gameplay sets in flight (world space) ──
        const air = { hero: true };
        if (tier.mist > 0) this.addPart('mist', createMist(u, tier.mist), air);
        this.addPart('eyes', createEyes(u, planEyes(tier.eyes)), air);
        if (tier.fireflies > 0) this.addPart('fireflies', createFireflies(u, tier.fireflies), air);
        this.addPart('wisps', createWisps(u), air);
        this.drops = createDrops(u);
        this.addPart('drops', this.drops, air);
        this.sparks = createSparks(u, tier.sparks);
        this.addPart('sparks', this.sparks, air);

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
        const loaded = await this.troll.load();
        if (this.disposed) return false;
        if (loaded) {
            this.troll.mesh.traverse((o) => o.layers.set(HERO_LAYER));
            this.placeFigures(0);
        }
        return loaded;
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
        this.squeeze = squeezeFor(this.aspect);
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
        this.pendingHeart.time = Infinity;
        this.gatherAll(this.time, 0.4);
        this.counts = {
            locks: 0, clears: 0, quads: 0, wisps: 0, gathered: 0,
        };
    }

    /** The run ended: the chain breaks, the lights go home. */
    onGameOver() {
        if (this.combo > 0) this.onCombo(0);
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
        const fov = fovForAspect(this.aspect) - this.kick * 0.5 * calm;
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
            EYE.z + this.kick * 0.08 * calm,
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

    /** Start a ring on the water at (x, z) at `time`. */
    ring(x, z, time, strength, rgb, reach = 1) {
        if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(time)) return;
        if (this.rings.length >= RING_SLOTS) this.rings.shift();
        this.rings.push({
            x, z, time, strength, rgb: [rgb[0], rgb[1], rgb[2]], reach,
        });
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
        this.kick = Math.max(this.kick, hardDrop ? 0.45 : 0.08);
        this.flash = Math.max(this.flash, hardDrop ? 0.06 : 0.012);
        this.counts.locks += 1;
    }

    /** One drop of light from a world point to a point of the water; returns when it lands. */
    sendDrop(from, to, rgb, strength, wisp) {
        const flight = this.reducedMotion ? 0.12 : DROP_FLIGHT * (0.8 + Math.min(0.6, Math.hypot(to[0] - from[0], to[2] - from[2]) / 14));
        const lands = this.time + flight;
        this.drops?.launch({
            from, to, rgb, time: this.time, flight, size: 0.2 + strength * 0.14,
        });
        this.ring(to[0], to[2], lands, 0.42 + strength * 0.5, rgb, 0.7 + strength * 0.45);
        // The crown of the splash: the water it throws up has the light in it.
        this.sparks?.emit({
            at: [to[0], 0.02, to[2]],
            n: Math.round((7 + 9 * strength) * this.sparkShare()),
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
        this.sendDrop(from, [...to], rgb, hardDrop ? 1 : 0.45, hardDrop ? 1.3 : 1);
        this.lastLanding = [to[0], to[2]];
        if (hardDrop) {
            // A second falls wide of the first (a ring only), and the air stirs.
            const second = this.pickLanding(side, wy, 1);
            this.sendDrop([...from], [...second], rgb, 0.3, 0);
            this.gust = Math.max(this.gust, 0.22);
        }
    }

    /** Lines cleared. `lines` 1..4; `tspin`, `perfect`. */
    onClear({
        rows = null, lines = 1, perfect = false, tspin = false, player = 0, screen = null,
    } = {}) {
        if (!this.u) return;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        const p = this._palette;
        let rgb;
        if (quad) rgb = [...TARNFIRE];
        else if (n === 1) rgb = [...p.crest];
        else if (n === 2) rgb = [0, 1, 2].map((c) => p.crest[c] * 0.6 + p.spirit[c] * 0.5);
        else rgb = [0, 1, 2].map((c) => p.crest[c] * 0.35 + p.heart[c] * 0.75);
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
        if (this.strokes.length >= STROKE_SLOTS) this.strokes.shift();
        this.strokes.push({
            time: birth,
            fronts: perfect ? 4 : n,
            strength: Math.min(1.5, 0.6 + 0.15 * n + (quad ? 0.3 : 0)),
            gold: quad ? 1 : 0,
            rgb,
        });
        this.lastClear = { time: birth, lines: n };
        this.lookKick = Math.max(this.lookKick, 0.5 + 0.12 * n);

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
                        n: Math.round((9 + (quad ? 5 : 0)) * this.sparkShare()),
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

        if (quad) {
            this.hushUntil = this.time + HUSH_HOLD;
            this.surge = perfect ? 1.3 : 1;
            this.shock = { time: birth, strength: this.reducedMotion ? 0.5 : 1 };
            this.ring(HEART[0] * this.squeeze, HEART[2], birth, 1.5, rgb, 2.8);
            this.pendingHeart = { time: birth, amount: 1 };
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
            if (!quad) this.shock = { time: this.time, strength: 0.4 };
        }
        this.counts.clears += 1;
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
        if (n < this.combo) this.dip = Math.max(this.dip, 0.25);
        else if (n > this.combo) {
            this.stepFlash = 1;
            this.feeds.push({ time: this.time, side: n % 2 ? -1 : 1, amount: 0.12 });
        }
        this.combo = n;
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
        this.gust = Math.max(this.gust, 1);
        this.flash = Math.max(this.flash, 0.1);
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
     * Move the spirit and the troll toward where the chain has them, and stand them there.
     * (Their places are eased from frame to frame: a replay from a seek steps them the same way.)
     */
    placeFigures(dt) {
        const t = this.time;
        const calm = this.reducedMotion ? 0.5 : 1;
        const target = approachForCombo(this.combo);

        // ── The spirit glides out over the water, and back ──
        const before = this.spiritS;
        this.spiritS += (target - this.spiritS) * approach(target > this.spiritS ? 0.95 : 0.6, dt);
        const s = smooth(0, 1, this.spiritS);
        const sx = lerp(SPIRIT.home[0], SPIRIT.reach[0], s);
        const sz = lerp(SPIRIT.home[2], SPIRIT.reach[2], s);
        const sy = lerp(SPIRIT.home[1], SPIRIT.reach[1], smooth(0, 0.2, this.spiritS)) + Math.sin(t * 1.3) * 0.012 * calm;
        const pathLength = Math.hypot(SPIRIT.reach[0] - SPIRIT.home[0], SPIRIT.reach[2] - SPIRIT.home[2]);
        const moved = Math.abs(smooth(0, 1, this.spiritS) - smooth(0, 1, before)) * pathLength;
        // She looks to where the lantern is; her gown and hair trail behind her as she goes.
        const toLantern = Math.atan2(this._lantern[0] / this.squeeze - sx, this._lantern[2] - sz);
        this.spiritFacing += (toLantern - this.spiritFacing) * approach(2, dt);
        if (this.spirit) {
            const speed = dt > 0 ? (moved / dt) * Math.sign(this.spiritS - before || 1) : 0;
            const along = [(SPIRIT.reach[0] - SPIRIT.home[0]) / pathLength, (SPIRIT.reach[2] - SPIRIT.home[2]) / pathLength];
            this.spirit.uTrail.value.set(along[0] * speed, 0, along[1] * speed);
            this.spirit.uFed.value = this.fedL;
            this.spirit.place({
                x: sx, y: sy, z: sz, facing: this.spiritFacing, lean: Math.min(0.12, Math.abs(speed) * 0.05),
            });
            this.spirit.heartWorld(this._heartOf);
        }
        // A ring at every footfall while she is out on the water.
        if (moved > 0 && this.spiritS > 0.12) {
            const walked = this.spiritWalked + moved;
            if (Math.floor(walked / FOOTFALL) !== Math.floor(this.spiritWalked / FOOTFALL)) {
                this.ring(sx * this.squeeze, sz, t, 0.26, this._palette.spirit, 0.36);
            }
            this.spiritWalked = walked;
        }

        // ── The troll walks down to the water's edge, and back ──
        const rate = (TROLL_PACE / TROLL_PATH) * (this.reducedMotion ? 3 : 1);
        const step = Math.max(-rate * dt, Math.min(rate * dt, target - this.trollS));
        this.trollS += step;
        const walking = Math.abs(step) > 1e-6 ? 1 : 0;
        this.trollMoving += (walking - this.trollMoving) * approach(7, dt);
        this.trollStride += (Math.abs(step) * TROLL_PATH) / TROLL.stride;
        const tx = lerp(TROLL.home[0], TROLL.reach[0], this.trollS);
        const tz = lerp(TROLL.home[2], TROLL.reach[2], this.trollS);
        const ty = lerp(TROLL.home[1], TROLL.reach[1], smooth(0, 1, this.trollS));
        // He faces the way he walks; standing, he faces the spirit across the water.
        const down = Math.atan2(TROLL.reach[0] - TROLL.home[0], TROLL.reach[2] - TROLL.home[2]);
        const toSpirit = Math.atan2(sx - tx, sz - tz);
        let bearing = toSpirit;
        if (walking) bearing = step > 0 ? down : down + Math.PI;
        let turn = bearing - this.trollFacing;
        while (turn > Math.PI) turn -= Math.PI * 2;
        while (turn < -Math.PI) turn += Math.PI * 2;
        this.trollFacing += turn * approach(walking ? 5 : 2.2, dt);
        this.trollLook += (this.lookKick * 0.7 - this.trollLook) * approach(4, dt);
        if (this.troll) {
            this.troll.place({
                x: tx,
                y: ty,
                z: tz,
                facing: this.trollFacing,
                stride: this.trollStride,
                moving: this.trollMoving,
                time: t * calm,
                look: this.trollLook,
                lift: clamp01(this.power * 0.6 + this.fedR * 0.5 + this.surge * 0.4),
            });
            this.troll.lanternWorld(this._lantern);
        }
    }

    // ── Frame ───────────────────────────────────────────────────────────────────

    update(sim) {
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
        this.flash *= Math.exp(-dt / 0.25);
        this.kick *= Math.exp(-dt / 0.16);
        this.dip *= Math.exp(-dt / 0.35);
        this.gust *= Math.exp(-dt / 2.4);
        this.lift *= Math.exp(-dt / 5.5);
        this.fedL *= Math.exp(-dt / 1.9);
        this.fedR *= Math.exp(-dt / 1.9);
        this.stepFlash *= Math.exp(-dt / 0.6);
        this.eyesFlash *= Math.exp(-dt / 1.7);
        this.liliesFlash *= Math.exp(-dt / 3.2);
        this.heartFlash *= Math.exp(-dt / 2.4);
        this.lookKick *= Math.exp(-dt / 1.3);
        if (t >= this.pendingHeart.time) {
            this.heartFlash = Math.max(this.heartFlash, this.pendingHeart.amount);
            this.eyesFlash = 1;
            this.liliesFlash = 1;
            this.kick = Math.max(this.kick, 0.5);
            this.flash = Math.max(this.flash, 0.22);
            this.pendingHeart.time = Infinity;
        }
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
        const hush = t < this.hushUntil ? 1 : 0;
        const breathTarget = hush ? 0.2 : 1 - this.dip;
        this.breath += (breathTarget - this.breath) * approach(hush ? 40 : 14, dt);

        // ── What the chain wakes ──
        const eyesTarget = eyesForCombo(this.combo);
        this.eyes += (eyesTarget - this.eyes) * approach(eyesTarget > this.eyes ? 1.6 : 1.1, dt);
        const liliesTarget = clamp01(this.combo / 6);
        this.lilies += (liliesTarget - this.lilies) * approach(liliesTarget > this.lilies ? 1.2 : 0.5, dt);
        // The caps light a step at a time, the left bank's first, from the frame's edge inward.
        const capsLTarget = 0.12 + 0.88 * clamp01(Math.ceil(this.combo / 2) / 4);
        const capsRTarget = 0.12 + 0.88 * clamp01(Math.floor(this.combo / 2) / 4);
        this.capsL += (capsLTarget - this.capsL) * approach(capsLTarget > this.capsL ? 2.2 : 0.9, dt);
        this.capsR += (capsRTarget - this.capsR) * approach(capsRTarget > this.capsR ? 2.2 : 0.9, dt);
        const heartTarget = heartForCombo(this.combo);
        this.heart += (heartTarget - this.heart) * approach(heartTarget > this.heart ? 0.9 : 0.6, dt);

        // The slow clock, and the air's own phase (integrated: its pace follows the wind, gently).
        const wind = 0.25 + this.gust * 0.75 + this.surge * 0.2;
        this.drift += dt * motion * (1 + this.power * 0.8 + this.surge * 1.5);
        this.sway += dt * motion * (0.85 + wind * 0.5);

        this.applyPalette();
        this.placeFigures(dt);

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
        u.power.value = this.power;
        u.surge.value = this.surge;
        u.breath.value = this.breath;
        u.drift.value = this.drift;
        u.sway.value = this.sway;
        u.wind.value = wind;
        u.ruffle.value = hush ? 0.15 : 1;
        u.lift.value = clamp01(this.lift);
        u.shafts.value = 0.3 + this.power * 0.5 + this.surge * 0.5;
        u.eyes.value.set(this.eyes, this.eyesFlash);
        u.lilies.value.set(this.lilies, this.liliesFlash);
        u.caps.value.set(this.capsL, this.capsR);
        u.heartAt.value.set(HEART[0] * this.squeeze, HEART[1], HEART[2], clamp01(this.heart * 0.75 + this.heartFlash));
        const h = this._heartOf;
        u.spiritAt.value.set(h[0], h[1], h[2], 0.6 + this.power * 0.3 + this.fedL * 0.6 + this.stepFlash * 0.25);
        const l = this._lantern;
        u.lanternAt.value.set(l[0], l[1], l[2], 0.5 + this.power * 0.35 + this.fedR * 0.7 + this.stepFlash * 0.2);

        // ── Post ──
        const sinceClear = t - this.lastClear.time;
        const swell = sinceClear >= 0 ? Math.exp(-sinceClear / 0.7) * (0.3 + 0.12 * this.lastClear.lines) : 0;
        const post = this._post;
        post.flash = this.flash;
        post.kick = this.kick;
        post.shafts = hush ? 0.05 : 0.26 + this.power * 0.24 + swell * 0.25 + this.surge * 0.4;
        post.bloomBoost = this.surge * 0.1 + swell * 0.1;
        // The iris closes a little as the night flares, so its colours survive the surge.
        post.exposure = 1 / (1 + this.surge * 0.5 + swell * 0.2 + this.heartFlash * 0.3);
        const ringAge = t - this.shock.time;
        const ringOn = ringAge >= 0 && ringAge < 2.2;
        post.prism.radius = ringOn ? ringAge * 1.25 + 0.02 : 0;
        post.prism.strength = ringOn ? this.shock.strength * Math.exp(-ringAge / 0.75) : 0;
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
