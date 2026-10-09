/**
 * Winter — the world: fox fires.
 *
 * Owns the shared uniforms, every scene part, the camera rig, the fox's mind and the
 * choreography. Shared by the theme (winter-theme.js) and the playground effect
 * (src/playground/effects/winter.effect.js), so what is iterated there ships.
 *
 * A snowfield at the edge of a frozen lake in the polar twilight: snow-loaded spruces to
 * either side, the moon and its ring of ice-light on the right, the last light along the
 * horizon on the left, fells beyond the far shore, snow falling — and an arctic fox going
 * its round. In the north they say the aurora is the fox's doing: its tail strikes sparks
 * from the snow and they burn in the sky. Here the board is what sets it running:
 *
 *   lock     the piece leaves the card's edge as a handful of sparks in its own colour, which
 *            the sky draws up; where they arrive the fires take that colour and hold it. A
 *            ring of lifted powder runs over the snow from under the board, firing the snow's
 *            sparkle as it passes, and when it reaches the fox its tail flicks and strikes
 *            sparks of the same colour.
 *   clear    the cleared rows leave the card as blades of light and jets of sparks; a gust
 *            crosses the snowfield from under the board, driving the snowfall and the snow
 *            snakes before it; the sky is strummed outward from the board; the fox springs.
 *   combo    the chain is how brightly the fires burn. The fox runs, faster the longer the
 *            chain, its coat and its prints alight and a stream of sparks behind it; sheet
 *            after sheet of aurora wakes; the twilight deepens to night under them; the snow
 *            takes their colour and the air fills with diamond dust.
 *   four     the night holds its breath; then the fox pounces, a ring of powder bursts from
 *            under the board, every tree lets its load go — and a fox of light bounds across
 *            the whole sky.
 *
 * Everything is a function of the world clock and event timestamps (nothing is created at event
 * time), so seek(t) plus a fixed-step replay reproduces any frame.
 */

import * as THREE from 'three/webgpu';
import {
    DEG,
    EYE,
    FOX_FIRE,
    FOX_SCALE,
    GUST_SPEED,
    HOURS,
    HOUR_KEYS,
    HUSH_HOLD,
    REST_RIG,
    SPARK_RISE,
    SPIRIT_RUN,
    SURGE_COOL,
    WIND,
    approach,
    bakeNoise,
    clamp01,
    createNoiseTexture,
    createShadowTexture,
    createWinterUniforms,
    fovForAspect,
    foxRound,
    glowDirection,
    hourAt,
    hourDrift,
    hourName,
    moonDirection,
    nearestTurn,
    pieceColor,
    plantTrees,
    powerForCombo,
    ringArrival,
    smooth,
} from './winter-tsl.js';
import { loadGhosts, planGhosts } from './winter-ghosts.js';
import { SHADOW_RECT, bakeMoonShadows, buildGroundFan } from './winter-field.js';
import { tierFor } from './winter-quality.js';
import { createSky } from './winter-sky.js';
import { createGround } from './winter-ground.js';
import { createTrees } from './winter-trees.js';
import { createDust, createSnowfall } from './winter-snowfall.js';
import { createPrints, createRowBeams, createSparks } from './winter-fx.js';
import { FoxMind } from './winter-fox-mind.js';
import {
    createFox, createSpiritFox, loadFox, spiritPath,
} from './winter-fox.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './winter-composition.js';

export { REST_RIG, fovForAspect };

const PARTS = ['sky', 'ground', 'trees', 'prints', 'snow', 'dust', 'sparks', 'beams', 'fox', 'spirit'];

/** Metres from the eye at which the sparks leave the card's edge. */
export const SPARK_DEPTH = 5.4;
/** The spark pool the handfuls below are sized for; smaller pools throw proportionally fewer. */
const SPARK_POOL = 1000;
/** Seconds a clear's lift of the fires takes to settle back to 1/e. */
export const SWELL_FADE = 2.3;
/** Each sheet of aurora at rest, and what the chain adds to it when it is fully awake. */
const CURTAIN_REST = [0.22, 0.05, 0.12, 0];
const CURTAIN_LIT = [1.15, 1.2, 0.9, 1.2];
/** The charge at which each sheet begins to wake, and is fully awake. */
const CURTAIN_WAKE = [[0, 0.5], [0.08, 0.62], [0.02, 0.8], [0.4, 1]];

export class WinterWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {THREE.WebGPURenderer} [params.renderer]
     * @param {boolean} [params.capture=false]  deterministic captures: no wall-clock anywhere
     * @param {number} [params.seed]
     * @param {object} [params.ghosts]  tree meshes to use instead of the baked asset (tests)
     * @param {boolean} [params.fox=true]  fetch the fox's body (it joins the scene when it arrives)
     */
    constructor({
        scene, quality = 'High', renderer = null, capture = false, seed, ghosts = null, fox = true,
    } = {}) {
        this.wantsFox = fox !== false;
        this.fox = null;
        this.spirit = null;
        this.foxReady = Promise.resolve(false);
        /** The parts a capture asked to see alone (null = all). */
        this.shown = null;
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.renderer = renderer;
        this.capture = capture;
        this.seed = seed;
        this.ghosts = ghosts;
        this.root = new THREE.Group();
        this.root.name = 'Winter';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.sparks = null;
        this.beams = null;
        this.prints = null;
        this.trees = [];
        this.plantedFor = null;
        this._fan = null;
        this._mask = null;
        this._spiritAt = { bearing: 0, elevation: 0, slope: 0 };
        this.shadowDue = false;
        this.shadowCool = 0;
        this.spiritWarm = 0;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        /** The moon on screen (fractions, y down): where the post's glare hangs. */
        this.heart = { x: 0.9, y: 0.14 };
        this.mind = new FoxMind(foxRound(this.aspect), seed);
        this._camera = null;
        this._look = new THREE.Vector3();
        this._ray = new THREE.Vector3();
        this._rest = new THREE.PerspectiveCamera(50, 16 / 9, REST_RIG.near, REST_RIG.far);
        this._point = { x: 0.5, y: 0.5 };
        this._from = [0, 0, 0];
        this._tail = [0, 0, 0];
        this._hour = {};
        HOUR_KEYS.forEach((key) => {
            this._hour[key] = [...HOURS[0].calm[key]];
        });
        this._hourStars = HOURS[0].calm.stars;
        this._curtains = [...CURTAIN_REST];
        /** A held charge (captures and tuning): overrides the chain. */
        this.heldPower = null;
        this._post = {
            heart: this.heart,
            flash: 0,
            kick: 0,
            shafts: 0.1,
            bloomBoost: 0,
            exposure: 1,
            glare: 0.3,
            glareColor: [0.2, 0.22, 0.28],
        };
        this.resetState(0);
    }

    /** Everything the choreography remembers (`fox: false` leaves the fox where and as it is). */
    resetState(time, { fox = true } = {}) {
        this.time = time;
        this.combo = 0;
        this.power = 0;
        this.surge = 0;
        this.swell = 0;
        this.storm = 0;
        this.level = 1;
        /** The levels' share of the hour's turn (in hours, eased); the clock adds its own. */
        this.hourStep = 0;
        /** The charge as the sky's colours follow it. */
        this.heatEase = 0;
        this.flash = 0;
        this.kick = 0;
        this.dip = 0;
        this.breath = 1;
        this.halo = 0;
        this.hushUntil = -1;
        this.ringCursor = 0;
        this.gustCursor = 0;
        this.skyCursor = 0;
        this.spiritAt = -100;
        this.spiritGlow = 0;
        this.tailDebt = 0;
        this.lastClear = { time: -100, lines: 0 };
        this.pendingKick = { time: Infinity, amount: 0 };
        this.pendingSwell = { time: Infinity, amount: 0 };
        this.pendingSurge = null;
        this.pendingPounce = Infinity;
        /** Tail flicks waiting for their ring to reach the fox, and loads waiting for their gust. */
        this.flicks = [];
        this.dumps = [];
        this.counts = {
            locks: 0, clears: 0, quads: 0, sparks: 0, flicks: 0, prints: 0,
        };
        const still = this.reducedMotion ? 0.3 : 1;
        // The wind and the rays are functions of the world clock until gameplay bends them.
        this.windRun = [time * WIND.x * 0.75 * still, time * WIND.z * 0.75 * still];
        this.auroraRun = time * 0.55;
        this._curtains = [...CURTAIN_REST];
        if (fox) this.mind.reset(time);
        this.sparks?.reset();
        this.beams?.reset();
        this.prints?.reset();
        if (this.u) {
            for (let i = 0; i < this.u.ringA.length; i++) this.u.ringA[i].value.set(0, 0, -100, 0);
            for (let i = 0; i < this.u.gustA.length; i++) this.u.gustA[i].value.set(0, 0, -100, 0);
            for (let i = 0; i < this.u.skyA.length; i++) this.u.skyA[i].value.set(0, -100, 0, 0);
            this.u.flare.value.set(-100, 0);
            this.u.spirit.value.set(0, 0.3, 0, 0);
        }
    }

    /**
     * Read the baked snow ghosts (or generate their stand-ins). Never rejects. Must have
     * resolved before build().
     * @returns {Promise<{ source: 'asset' | 'plan' }>}
     */
    async load() {
        if (!this.ghosts) this.ghosts = await loadGhosts();
        const { source } = this.ghosts;
        // The ground's fan and the moon shadows are arithmetic: done here, a step at a time,
        // so no single frame of the theme's start carries all of it.
        const breath = () => new Promise((resolve) => { setTimeout(resolve, 0); });
        await breath();
        if (this.disposed) return { source };
        this.plant();
        this._fan = buildGroundFan(this.tier.ground);
        await breath();
        if (this.disposed) return { source };
        this._mask = this.shadowMask();
        await breath();
        return { source };
    }

    build() {
        if (!this.ghosts) this.ghosts = planGhosts();
        const { tier } = this;
        const noise = createNoiseTexture(bakeNoise());
        if (!this._mask || this.plantedFor !== this.aspect) {
            this.plant();
            this._mask = this.shadowMask();
        }
        const shadow = createShadowTexture(this._mask, Math.max(2, tier.shadows));
        this._mask = null;
        this.textures.push(noise, shadow);
        const u = createWinterUniforms({ noise, shadow });
        u.shadowRect.value.set(SHADOW_RECT.x0, SHADOW_RECT.z0, 1 / SHADOW_RECT.width, 1 / SHADOW_RECT.depth);
        this.u = u;

        this.addPart('ground', createGround(u, {
            ground: tier.ground, glints: tier.glints, mirror: tier.mirror, fan: this._fan,
        }));
        this._fan = null;
        this.treePart = createTrees(u, this.ghosts, this.trees, { ghostLod: tier.ghostLod, glints: tier.glints });
        this.addPart('trees', this.treePart);
        this.addPart('sky', createSky(u, { curtains: tier.curtains }));
        this.prints = createPrints(u, tier.prints);
        this.addPart('prints', this.prints);
        this.addPart('snow', createSnowfall(u, tier.snow));
        if (tier.dust > 0) this.addPart('dust', createDust(u, tier.dust));
        this.sparks = createSparks(u, tier.sparks);
        this.addPart('sparks', this.sparks);
        this.beams = createRowBeams(u);
        this.addPart('beams', this.beams);

        this.applyHour();
        this.compose();
        this.scene.add(this.root);
        // The fox's body comes when it comes: nothing waits for it (a capture may: `foxReady`).
        this.foxReady = !this.wantsFox ? Promise.resolve(false) : loadFox().then((gltf) => {
            if (!gltf || this.disposed || !this.u) return false;
            this.fox = createFox(this.u, gltf, { shells: this.tier.fur });
            this.parts.fox = this.fox;
            this.root.add(this.fox.mesh);
            if (this.tier.spirit) {
                this.spirit = createSpiritFox(this.u, gltf, { shells: this.tier.veils });
                this.parts.spirit = this.spirit;
                this.root.add(this.spirit.mesh);
                // Drawn (dark) for its first frames, so its pipeline is not built on the frame
                // four lines call it up.
                this.spiritWarm = 4;
            }
            if (this.shown) {
                this.fox.mesh.visible = this.shown.has('fox');
                if (this.spirit) this.spirit.shownAlone = this.shown.has('spirit');
            }
            this.fox.update(this.mind.pose, 0);
            return true;
        });
        return this;
    }

    /** Lay the trees out for the frame's shape. */
    plant() {
        const { tier } = this;
        this.trees = plantTrees(this.aspect, { mid: tier.mid, far: tier.far });
        this.plantedFor = this.aspect;
        /** The tops of the framing trees: where a gust shakes a load loose. */
        this.crowns = this.trees.filter((tree) => tree.frame && tree.height > 5).map((tree) => ({
            x: tree.x, y: tree.y + tree.height * 0.78, z: tree.z, height: tree.height,
        }));
    }

    /** What the trees throw on the snow, for the moon as this frame's shape has it. */
    shadowMask() {
        const size = this.tier.shadows;
        if (!(size > 0)) return new Uint8Array(4).fill(255);
        return bakeMoonShadows(this.trees, this.ghosts, moonDirection(this.aspect), size);
    }

    addPart(name, part) {
        this.parts[name] = part;
        this.root.add(part.mesh);
        this.disposables.push(part);
    }

    /** Draw only the named parts (captures, bisecting a look). */
    showOnlyParts(names) {
        this.shown = new Set(names);
        Object.keys(this.parts).forEach((name) => {
            if (name === 'spirit') this.parts[name].shownAlone = this.shown.has(name);
            else this.parts[name].mesh.visible = this.shown.has(name);
        });
    }

    setViewport(bufferWidth, bufferHeight, aspect) {
        if (this.u && bufferWidth > 0 && bufferHeight > 0) this.u.viewport.value.set(bufferWidth, bufferHeight);
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) {
            this.aspect = aspect;
            this.compose();
        } else if (this.u) this.fitGlints();
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
        this.applyHour();
    }

    /**
     * A new run (or the end of one): the chain, the level and everything in flight are dropped,
     * but nothing jumps — the fires are left to sink on their own, the sky turns back to the
     * first level's hour the short way round, the fox wakes where it lay and the snow keeps
     * its prints.
     */
    resetSession() {
        const {
            time, windRun, auroraRun, power, surge, swell, breath, storm, halo, mind, _curtains, hourStep, heatEase,
        } = this;
        const { prints } = this;
        this.prints = null;
        this.resetState(time, { fox: false });
        this.prints = prints;
        Object.assign(this, {
            windRun, auroraRun, power, surge, swell, breath, storm, halo, _curtains, hourStep, heatEase,
        });
        mind.flick = 0;
        mind.dash = 0;
        mind.wake(time);
    }

    /** Hold the fires at a charge (0..1), or null to give them back to the chain. */
    holdPower(power) {
        this.heldPower = Number.isFinite(power) ? clamp01(power) : null;
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

    /** The sparkle's grid is a few pixels to a cell whatever the frame's size. */
    fitGlints() {
        const height = this.u.viewport.value.y;
        const pxScale = height / (2 * Math.tan((fovForAspect(this.aspect) * DEG) / 2));
        this.u.glintGrid.value = Math.max(60, Math.round(pxScale / 6.5));
    }

    /**
     * Fit the world to the aspect: the moon, the glow, the framing trees and the fox's round
     * are laid out in fractions of the frame's half width, so an upright screen keeps them all.
     */
    compose() {
        const moon = moonDirection(this.aspect);
        const glow = glowDirection(this.aspect);
        this.mind.setRound(foxRound(this.aspect));
        if (!this.u) return;
        this.u.moonDir.value.set(moon[0], moon[1], moon[2]);
        this.u.glowDir.value.set(glow[0], glow[1]);
        this.fitGlints();
        // (Between about 10:9 and 2:1 the frame holds its planned 38°: nothing moves.)
        const moved = this.plantedFor === null || Math.abs(moonDirection(this.plantedFor)[0] - moon[0]) > 1e-4;
        if (moved && this.treePart) {
            this.plant();
            this.treePart.plant(this.trees);
            // The shadows are redrawn at once, then not again for a few frames: a window being
            // dragged narrower sends a resize every frame, and each redraw of the mask is tens
            // of milliseconds. What was skipped is drawn once the frame's shape has settled.
            if (this.shadowCool > 0) this.shadowDue = true;
            else this.redrawShadows();
            this.shadowCool = 8;
        }
    }

    /** Draw the trees' moon shadows again for where they now stand. */
    redrawShadows() {
        const shadow = this.u?.shadowTex;
        if (!shadow) return;
        const mask = this.shadowMask();
        if (shadow.image.data.length === mask.length) {
            shadow.image.data.set(mask);
            shadow.needsUpdate = true;
        }
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const t = sim.time;
        // (The theme flushes the frame's events between this and update(): they are this frame's.)
        this.time = t;
        const calm = this.reducedMotion ? 0 : 1;
        const fov = fovForAspect(this.aspect) - this.kick * 0.6 * calm;
        if (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        // A slow drift, as of someone standing in the cold, plus the pointer leaning the view.
        const swayX = (Math.sin(t * 0.11) * 0.16 + Math.sin(t * 0.063 + 1.3) * 0.1) * calm;
        const swayY = (Math.sin(t * 0.17 + 0.7) * 0.025 + Math.sin(t * 0.079) * 0.02) * calm;
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        camera.position.set(EYE.x + swayX + px * 0.3, EYE.y + swayY - py * 0.1 - this.kick * 0.03 * calm, EYE.z);
        const yaw = (Math.sin(t * 0.083 + 2.1) * 0.005 - px * 0.018) * calm;
        const pitch = REST_RIG.pitch + (Math.sin(t * 0.097) * 0.003 - py * 0.011) * calm;
        this._look.set(
            camera.position.x + Math.sin(yaw) * 10,
            camera.position.y + Math.tan(pitch) * 10,
            camera.position.z - 10,
        );
        camera.up.set(Math.sin(t * 0.07) * 0.002 * calm, 1, 0);
        camera.lookAt(this._look);
        camera.updateMatrixWorld();
        this._camera = camera;
        if (this.u) this.u.pxScale.value = this.u.viewport.value.y / (2 * Math.tan((fov * DEG) / 2));
        this.projectMoon(camera);
    }

    /** Where the moon stands on screen: the lens's glare hangs there. */
    projectMoon(camera) {
        if (!this.u) return;
        const d = this.u.moonDir.value;
        this._ray.set(d.x, d.y, d.z).multiplyScalar(1000).add(camera.position);
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

    /** Where the ray through a screen point meets the snow, at most `far` metres ahead. */
    screenToSnow(sx, sy, far = 15) {
        const camera = this._camera || this.restCamera();
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        const drop = camera.position.y - 0.05;
        let t = this._ray.y < -1e-3 ? drop / -this._ray.y : far;
        const flat = Math.hypot(this._ray.x, this._ray.z) || 1;
        if (!(t > 0) || t * flat > far) t = far / flat;
        return { x: camera.position.x + this._ray.x * t, z: camera.position.z + this._ray.z * t };
    }

    // ── Gameplay ────────────────────────────────────────────────────────────────

    /** How many sparks a handful of `n` is at this tier. */
    handful(n) {
        return Math.max(1, Math.round((n * this.tier.sparks) / SPARK_POOL));
    }

    /** Send a ring of powder out over the snow from a point. */
    ring(x, z, time, strength, rgb, reach = 1, gain = 2) {
        const { u } = this;
        const slot = this.ringCursor % u.ringA.length;
        this.ringCursor += 1;
        u.ringA[slot].value.set(x, z, time, strength);
        u.ringC[slot].value.set(rgb[0] * gain, rgb[1] * gain, rgb[2] * gain, reach);
    }

    /** Send a gust across the snowfield from a point. */
    gust(x, z, time, strength) {
        const { u } = this;
        const slot = this.gustCursor % u.gustA.length;
        this.gustCursor += 1;
        u.gustA[slot].value.set(x, z, time, strength);
    }

    /** The fires over a bearing take a colour when the sparks arrive, and hold it. */
    colourSky(from, rgb, arrives, strength) {
        const { u } = this;
        const slot = this.skyCursor % u.skyA.length;
        this.skyCursor += 1;
        u.skyA[slot].value.set(from[0] / Math.max(0.2, -from[2]), arrives, strength, 0);
        // As light in the sky a pale piece would only bleach the fires: its hue is pushed out.
        const grey = rgb[0] * 0.3 + rgb[1] * 0.5 + rgb[2] * 0.2;
        const deep = rgb.map((c) => Math.max(0.02, grey + (c - grey) * 1.7));
        const peak = Math.max(deep[0], deep[1], deep[2]);
        u.skyC[slot].value.set(deep[0] / peak, deep[1] / peak, deep[2] / peak);
    }

    /**
     * A piece locked. `u` = its column as a fraction of the board width, `rows` = the visible
     * rows it covers, `color` = the piece's colour; `screen` (fractions) replaces the board point.
     */
    onLock({
        u = 0.5, rows = null, hardDrop = false, color = null, player = 0, screen = null,
    } = {}) {
        const { u: uniforms } = this;
        if (!uniforms || !this.sparks) return;
        // (A run that began without its start being announced still wakes the fox.)
        this.mind.wake(this.time);
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
                // The sparks leave the card's edge on the piece's side, at the piece's height.
                const edges = card || board;
                wx = side < 0 ? edges.x0 : edges.x1;
                wy = this._point.y;
            }
        }
        // ── The ring: the piece lands in the snow under the foot of the board ──
        const strike = this.screenToSnow(fx, fy);
        this.ring(strike.x, strike.z, this.time, hardDrop ? 1.5 : 1, rgb, hardDrop ? 1.25 : 1);
        this.counts.sparks += this.sparks.emit({
            from: [strike.x, 0.15, strike.z],
            toward: [side * 0.5, 1, 0.1],
            n: this.handful(hardDrop ? 12 : 6),
            rgb,
            time: this.time,
            speed: hardDrop ? [1.6, 4.4] : [1, 2.8],
            cone: 0.8,
            life: [1.3, 2.4],
            size: hardDrop ? 0.3 : 0.22,
            glow: 0.28,
            powder: true,
            jitter: 0.5,
        });

        // ── The handful: the piece's colour struck into sparks, and the sky draws them up ──
        const from = this.screenToWorld(wx, wy, SPARK_DEPTH);
        this.counts.sparks += this.sparks.emit({
            from,
            toward: [side * 0.9, 0.45, -0.3],
            n: this.handful(hardDrop ? 46 : 26),
            rgb,
            time: this.time,
            speed: hardDrop ? [2.2, 7.5] : [1.4, 5],
            cone: hardDrop ? 0.6 : 0.45,
            life: [SPARK_RISE * 0.8, SPARK_RISE * 1.25],
            size: 0.024,
            glow: hardDrop ? 1.5 : 1.1,
            stagger: 0.06,
        });
        // (A flash where it leaves the card, and a dust of finer sparks about the handful.)
        this.counts.sparks += this.sparks.emit({
            from, toward: [0, 1, 0], n: 1, rgb, time: this.time, speed: [0.01, 0.01], cone: 0, life: [0.28, 0.34], size: hardDrop ? 0.5 : 0.34, glow: 0.42, jitter: 0, lift: [0, 0],
        });
        this.counts.sparks += this.sparks.emit({
            from,
            toward: [side * 0.6, 0.7, -0.2],
            n: this.handful(hardDrop ? 30 : 16),
            rgb,
            time: this.time,
            speed: [0.6, hardDrop ? 6 : 3.8],
            cone: 0.9,
            life: [0.7, 1.5],
            size: 0.011,
            glow: 1.5,
            lift: [1, 5],
        });
        this.colourSky(from, rgb, this.time + SPARK_RISE * 0.7, hardDrop ? 1.25 : 0.9);

        // ── The fox: it looks up at where the sparks left, and its tail flicks when the ring reaches it ──
        this.mind.attend(from[0], from[1] + 1.5, from[2], this.time + (hardDrop ? 1.5 : 1.1), hardDrop ? 1 : 0.8);
        const { pose } = this.mind;
        const reach = hardDrop ? 1.25 : 1;
        const arrives = ringArrival(Math.hypot(pose.x - strike.x, pose.z - strike.z), reach);
        if (Number.isFinite(arrives) && this.flicks.length < 8) {
            this.flicks.push({ time: this.time + arrives, rgb, strength: hardDrop ? 1 : 0.7 });
        }
        this.kick = Math.max(this.kick, hardDrop ? 0.5 : 0.1);
        this.flash = Math.max(this.flash, hardDrop ? 0.07 : 0.012);
        this.storm = Math.max(this.storm, hardDrop ? 0.3 : 0.1);
        this.counts.locks += 1;
    }

    /**
     * Lines cleared. `lines` 1..4; `tspin`, `perfect`.
     */
    onClear({
        rows = null, lines = 1, tspin = false, perfect = false, player = 0, screen = null,
    } = {}) {
        const { u } = this;
        if (!u || !this.sparks) return;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        const birth = quad ? this.time + HUSH_HOLD : this.time;
        const p = this._hour;
        // The blades go out in the fires' own light.
        const peak = Math.max(p.fire[0], p.fire[1], p.fire[2], 1e-4);
        const rgb = p.fire.map((c) => (c / peak) * 0.9 + 0.1);
        this.lastClear = { time: birth, lines: n };
        // (A clear still waiting behind a hush is not forgotten when another arrives.)
        if (this.pendingSwell.time < Infinity) this.swell = Math.max(this.swell, this.pendingSwell.amount);
        if (this.pendingSurge) this.surge = Math.max(this.surge, this.pendingSurge.amount);
        this.pendingSwell = { time: birth, amount: 0.3 + 0.17 * n };
        this.pendingKick = { time: birth + 0.1, amount: 0.2 + 0.1 * n };
        this.storm = Math.max(this.storm, Math.min(1.5, 0.45 + 0.2 * n + (quad ? 0.4 : 0)));

        // ── The cleared rows leave the card: blades of light, and jets of sparks ──
        const board = boardFor(this.layout, player);
        const card = cardUnion(this.layout);
        const list = Array.isArray(rows) && rows.length
            ? rows.slice(0, 4)
            : Array.from({ length: n }, (_, i) => 19 - i);
        if (board && card && !screen) {
            const ys = list.map((row) => boardPoint(board, 0.5, row, this._point).y);
            if (this.layoutLive) this.beams.fire(ys, card.x0, card.x1, rgb, this.time, Math.min(1.4, 0.7 + 0.18 * n));
            ys.forEach((y, k) => {
                [-1, 1].forEach((side) => {
                    const from = this.screenToWorld(side < 0 ? card.x0 : card.x1, y, SPARK_DEPTH);
                    this.counts.sparks += this.sparks.emit({
                        from,
                        toward: [side, 0.35, -0.25],
                        n: this.handful(quad ? 30 : 20),
                        rgb: null,
                        time: birth + k * 0.03,
                        speed: [3, quad ? 12 : 8.5],
                        cone: 0.42,
                        life: [SPARK_RISE * 0.8, SPARK_RISE * 1.3],
                        size: 0.024,
                        glow: 1.2,
                        stagger: 0.12,
                    });
                });
            });
        }

        // ── A gust crosses the snowfield from under the board; the sky is strummed ──
        const foot = board ? this.screenToSnow((board.x0 + board.x1) * 0.5, Math.max(board.y1 + 0.04, 0.92)) : this.screenToSnow(0.5, 0.95);
        this.gust(foot.x, foot.z, birth, Math.min(1.6, 0.7 + 0.2 * n + (quad ? 0.3 : 0)));
        u.flare.value.set(birth, Math.min(1.3, 0.5 + 0.2 * n));
        this.mind.startle(Math.min(1.4, 0.5 + 0.25 * n));
        // The gust shakes the trees it reaches: from three lines up their loads come down.
        if (n >= 3 || quad) {
            this.crowns.forEach((crown) => {
                if (this.dumps.length >= 16) return;
                const far = Math.hypot(crown.x - foot.x, crown.z - foot.z);
                this.dumps.push({ time: birth + far / GUST_SPEED, crown, heavy: quad });
            });
        }

        if (quad) {
            // The night holds its breath; then the fox pounces and its like crosses the sky.
            this.hushUntil = this.time + HUSH_HOLD;
            this.pendingSurge = { time: birth, amount: perfect ? 1.3 : 1 };
            this.pendingPounce = birth;
            this.spiritAt = birth + 0.35;
            this.ring(foot.x, foot.z, birth, 1.6, [rgb[0] * 0.7 + 0.3, rgb[1] * 0.7 + 0.3, rgb[2] * 0.7 + 0.3], 1.8, 2.4);
            this.halo = Math.max(this.halo, 0);
            this.counts.quads += 1;
            if (card && !screen) {
                // The card's shoulders throw a fountain as well.
                [-1, 1].forEach((side) => {
                    const from = this.screenToWorld(side < 0 ? card.x0 : card.x1, card.y0 + 0.02, SPARK_DEPTH);
                    this.counts.sparks += this.sparks.emit({
                        from,
                        toward: [side * 0.35, 1, -0.3],
                        n: this.handful(64),
                        rgb: null,
                        time: birth + 0.05,
                        speed: [4, 13],
                        cone: 0.4,
                        life: [SPARK_RISE, SPARK_RISE * 1.5],
                        size: 0.026,
                        glow: 1.5,
                        stagger: 0.3,
                    });
                });
            }
        }
        if (tspin) {
            // The wind turns on itself: a wheel of sparks and powder spins up round the card.
            this.storm = Math.max(this.storm, 1.1);
            if (card && !screen) {
                const cx = (card.x0 + card.x1) * 0.5;
                const cy = (card.y0 + card.y1) * 0.5;
                const centre = this.screenToWorld(cx, cy, SPARK_DEPTH, [0, 0, 0]);
                const spokes = 14;
                for (let k = 0; k < spokes; k++) {
                    const a = (k / spokes) * Math.PI * 2;
                    const sx = cx + Math.cos(a) * (card.x1 - card.x0) * 0.62;
                    const sy = cy + Math.sin(a) * (card.y1 - card.y0) * 0.56;
                    const from = this.screenToWorld(sx, sy, SPARK_DEPTH);
                    const out = [from[0] - centre[0], from[1] - centre[1], from[2] - centre[2]];
                    this.counts.sparks += this.sparks.emit({
                        from,
                        toward: [out[1] + out[0] * 0.25, -out[0] + out[1] * 0.25, -0.2],
                        n: this.handful(7),
                        rgb: null,
                        time: birth + k * 0.018,
                        speed: [4.5, 8.5],
                        cone: 0.16,
                        life: [SPARK_RISE * 0.7, SPARK_RISE * 1.1],
                        size: 0.024,
                        glow: 1.3,
                        stagger: 0.08,
                        lift: [2, 6],
                    });
                }
            }
        }
        this.counts.clears += 1;
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        // The chain broke: the night lets its breath go.
        if (n === 0 && this.combo >= 2) this.dip = Math.max(this.dip, 0.25);
        this.combo = n;
    }

    /**
     * A new level: the hour turns, one step on from wherever the clock has brought it. Aloud the
     * sky eases there (update() turns `hourStep`); `silent` (a restored session, a capture) is
     * there at once.
     */
    levelUp(level, { silent = false } = {}) {
        this.level = Math.max(1, Math.round(Number(level) || 1));
        if (silent) {
            this.hourStep = this.level - 1;
            this.heatEase = this.heat();
            this.applyHour();
            return;
        }
        this.storm = Math.max(this.storm, 0.8);
        this.flash = Math.max(this.flash, 0.1);
        if (!this.u || !this.sparks) return;
        // The sky is strummed, and the fox answers with a shower from its tail and a look at the viewer.
        this.u.flare.value.set(this.time, 1.1);
        this.mind.startle(0.6);
        this.mind.attend(EYE.x, EYE.y, EYE.z, this.time + 2.2, 0.9);
        this.counts.sparks += this.sparks.emit({
            from: this.mind.tail(this._tail),
            toward: [0, 1, 0],
            n: this.handful(46),
            rgb: null,
            time: this.time,
            speed: [1.5, 5.5],
            cone: 0.8,
            life: [SPARK_RISE, SPARK_RISE * 1.4],
            size: 0.026,
            glow: 1.3,
            stagger: 0.4,
        });
    }

    /** The run is over: the fires sink and the fox curls up. */
    onGameOver() {
        this.combo = 0;
        this.dip = Math.max(this.dip, 0.4);
        this.mind.sleep(this.time);
    }

    /** How far the twilight has turned to the fires' night (0..1), for the hour's colours. */
    heat() {
        return clamp01(this.power + this.surge * 0.55);
    }

    /** How many hours into the polar day the sky stands: the levels' steps plus the clock's turn. */
    hourPhase() {
        return this.hourStep + hourDrift(this.time);
    }

    /** Set the live colours to the hour the sky stands at, mixed by the charge it has followed. */
    applyHour() {
        this._hourStars = hourAt(this.hourPhase(), this.heatEase, this._hour);
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
        const target = this.heldPower ?? powerForCombo(this.combo);
        this.power += (target - this.power) * approach(target > this.power ? 2.2 : 0.6, dt);
        if (dt === 0 && this.heldPower !== null) this.power = target;
        this.surge *= Math.exp(-dt / SURGE_COOL);
        this.swell *= Math.exp(-dt / SWELL_FADE);
        this.storm *= Math.exp(-dt / 2.1);
        this.flash *= Math.exp(-dt / 0.25);
        this.kick *= Math.exp(-dt / 0.16);
        this.dip *= Math.exp(-dt / 0.4);
        if (t >= this.pendingKick.time) {
            this.kick = Math.max(this.kick, this.pendingKick.amount);
            this.flash = Math.max(this.flash, this.pendingKick.amount * 0.4);
            this.pendingKick.time = Infinity;
        }
        if (t >= this.pendingSwell.time) {
            this.swell = Math.max(this.swell, this.pendingSwell.amount);
            this.pendingSwell.time = Infinity;
        }
        if (this.pendingSurge && t >= this.pendingSurge.time) {
            this.surge = Math.max(this.surge, this.pendingSurge.amount);
            this.pendingSurge = null;
        }
        if (t >= this.pendingPounce) {
            this.mind.pounce(this.pendingPounce);
            this.pendingPounce = Infinity;
        }
        const hush = t < this.hushUntil ? 1 : 0;
        const breathTarget = hush ? 0.12 : 1 - this.dip;
        this.breath += (breathTarget - this.breath) * approach(hush ? 40 : 12, dt);
        if (dt === 0) this.breath = breathTarget;
        // ── The hour: the clock turns it by itself; a level's step and the charge ease in ──
        const heat = this.heat();
        const turned = nearestTurn(this.hourStep, this.level - 1);
        const follow = dt === 0 ? 1 : approach(1.5, dt);
        this.hourStep += (turned - this.hourStep) * follow;
        this.heatEase += (heat - this.heatEase) * follow;
        this.applyHour();

        // ── The wind, and the rays' run ──
        const gale = 0.2 + this.power * 0.3 + this.storm * 0.55 + this.surge * 0.35;
        const blow = dt * motion * (0.55 + gale * 1.7);
        this.windRun[0] += WIND.x * blow;
        this.windRun[1] += WIND.z * blow;
        this.auroraRun += dt * motion * (0.55 + this.power * 1.5 + this.surge * 2.2 + this.swell * 1.5);

        // ── The sheets wake one after another ──
        const k = dt === 0 ? 1 : approach(2.4, dt);
        for (let i = 0; i < 4; i++) {
            const awake = smooth(CURTAIN_WAKE[i][0], CURTAIN_WAKE[i][1], this.power);
            const wanted = CURTAIN_REST[i] + CURTAIN_LIT[i] * awake + this.surge * 0.7 + this.swell * (0.5 + 0.2 * i);
            this._curtains[i] += (wanted - this._curtains[i]) * k;
        }

        // ── The fox ──
        this.stepFox(dt, t);

        // ── The fox of light ──
        const spiritAge = t - this.spiritAt;
        let spiritGlow = 0;
        if (this.spirit) {
            spiritGlow = this.spirit.update(spiritAge);
            if (this.spiritWarm > 0 && spiritGlow === 0) {
                this.spiritWarm -= 1;
                this.spirit.update(SPIRIT_RUN * 0.5);
            }
            if (this.shown && !this.spirit.shownAlone) this.spirit.mesh.visible = false;
        } else if (spiritAge > 0 && spiritAge < SPIRIT_RUN) {
            const kk = spiritAge / SPIRIT_RUN;
            spiritGlow = smooth(0, 0.07, kk) * (1 - smooth(0.8, 1, kk));
        }
        this.spiritGlow = spiritGlow;
        const spiritBearing = spiritPath(clamp01(spiritAge / SPIRIT_RUN), this._spiritAt).bearing;
        // While its like crosses the sky the fox on the snow watches it go.
        if (spiritGlow > 0.05) {
            const far = 400;
            const c = Math.cos(this._spiritAt.elevation);
            this.mind.attend(
                EYE.x + Math.sin(spiritBearing) * c * far,
                EYE.y + Math.sin(this._spiritAt.elevation) * far,
                EYE.z - Math.cos(spiritBearing) * c * far,
                t + 0.3,
                0.9,
            );
        }
        if (this.shadowCool > 0) {
            this.shadowCool -= 1;
            if (this.shadowCool === 0 && this.shadowDue) {
                this.shadowDue = false;
                this.redrawShadows();
            }
        }

        // ── Loads the gust has reached come down ──
        if (this.dumps.length) {
            for (let i = this.dumps.length - 1; i >= 0; i--) {
                const dump = this.dumps[i];
                if (t < dump.time) continue;
                this.dumps.splice(i, 1);
                this.counts.sparks += this.sparks.emit({
                    from: [dump.crown.x, dump.crown.y, dump.crown.z],
                    toward: [0.5, -0.6, 0.1],
                    n: this.handful(dump.heavy ? 12 : 7),
                    rgb: [0.5, 0.6, 0.75],
                    time: dump.time,
                    speed: [0.4, 2.2],
                    cone: 0.9,
                    life: [2.2, 4],
                    size: dump.crown.height * 0.07,
                    glow: 0.15,
                    powder: true,
                    jitter: dump.crown.height * 0.16,
                    stagger: 0.5,
                });
            }
        }

        // ── Uniforms ──
        u.time.value = t;
        u.power.value = this.power;
        u.surge.value = this.surge;
        u.breath.value = this.breath;
        u.windRun.value.set(this.windRun[0], this.windRun[1]);
        u.gale.value = gale;
        u.auroraRun.value = this.auroraRun;
        u.curtains.value.set(this._curtains[0], this._curtains[1], this._curtains[2], this._curtains[3]);
        u.halo.value = 0.2 + this.power * 0.45 + this.surge * 0.6;
        u.spirit.value.set(Math.tan(spiritBearing), 0.3, spiritGlow, 0);
        const p = this._hour;
        HOUR_KEYS.forEach((key) => {
            const node = key === 'moon' ? u.moonCol : u[key];
            node.value.set(p[key][0], p[key][1], p[key][2]);
        });
        u.stars.value = this._hourStars;

        const sky = this.parts.sky?.mesh;
        if (sky && camera) {
            sky.position.copy(camera.position);
            sky.updateMatrix();
            sky.updateMatrixWorld(true);
        }
        if (camera) this.projectMoon(camera);

        // ── Post ──
        const sinceClear = t - this.lastClear.time;
        const lift = sinceClear >= 0 ? Math.exp(-sinceClear / 0.7) * (0.3 + 0.12 * this.lastClear.lines) : 0;
        const post = this._post;
        post.flash = this.flash;
        post.kick = this.kick;
        post.shafts = hush ? 0.03 : 0.08 + this.surge * 0.1;
        post.bloomBoost = this.surge * 0.14 + lift * 0.1 + spiritGlow * 0.1;
        post.glare = (0.3 + this.power * 0.15) * this.breath;
        post.glareColor[0] = u.moonCol.value.x * 0.2;
        post.glareColor[1] = u.moonCol.value.y * 0.2;
        post.glareColor[2] = u.moonCol.value.z * 0.2;
        // The lens opens as the twilight turns to night, and closes a little on a flash.
        post.exposure = (1 + heat * 0.32) / (1 + this.surge * 0.22 + lift * 0.2);
    }

    /** Step the fox's mind, press its prints, strike its sparks and pose its body. */
    stepFox(dt, t) {
        const { mind, u } = this;
        mind.step(dt, t, { power: this.power, surge: this.surge });
        const { pose } = mind;
        for (let i = 0; i < mind.events.length; i++) {
            const e = mind.events[i];
            if (e.type === 'print') {
                this.prints?.press(e.x, e.y, e.z, e.heading, e.time, mind.glow, 0.14 * FOX_SCALE);
                this.counts.prints += 1;
                // At a run every footfall kicks up a little snow.
                if (e.speed > 2.6) {
                    this.counts.sparks += this.sparks.emit({
                        from: [e.x, e.y + 0.08, e.z],
                        toward: [-Math.sin(e.heading), 0.9, -Math.cos(e.heading)],
                        n: 1,
                        rgb: [0.5, 0.6, 0.75],
                        time: t,
                        speed: [0.5, 1.6],
                        cone: 0.5,
                        life: [0.6, 1.1],
                        size: 0.1 + Math.min(0.1, e.speed * 0.012),
                        glow: 0.12,
                        powder: true,
                        jitter: 0.06,
                    });
                }
            } else if (e.type === 'shake' || (e.type === 'land' && e.soft)) {
                // It shakes itself, or comes down nose first on what it heard: snow flies.
                const shaking = e.type === 'shake';
                this.counts.sparks += this.sparks.emit({
                    from: [pose.x, pose.y + (shaking ? 0.45 : 0.12) * FOX_SCALE, pose.z],
                    toward: [0, 1, 0],
                    n: this.handful(shaking ? 9 : 7),
                    rgb: [0.55, 0.65, 0.8],
                    time: t,
                    speed: shaking ? [0.8, 2.6] : [0.7, 2.4],
                    cone: shaking ? 1 : 0.8,
                    life: [0.7, 1.5],
                    size: shaking ? 0.12 : 0.2,
                    glow: 0.15,
                    powder: true,
                    jitter: shaking ? 0.3 : 0.25,
                    stagger: shaking ? 0.5 : 0.05,
                });
            } else if (e.type === 'dig') {
                // Its forepaws throw the snow out behind it, between its hind legs.
                const sin = Math.sin(pose.heading);
                const cos = Math.cos(pose.heading);
                this.counts.sparks += this.sparks.emit({
                    from: [pose.x + sin * 0.18 * FOX_SCALE, pose.y + 0.07, pose.z + cos * 0.18 * FOX_SCALE],
                    toward: [-sin * 0.8, 0.7, -cos * 0.8],
                    n: 2,
                    rgb: [0.55, 0.65, 0.8],
                    time: t,
                    speed: [1.0, 2.5],
                    cone: 0.45,
                    life: [0.5, 1.0],
                    size: 0.11,
                    glow: 0.12,
                    powder: true,
                    jitter: 0.1,
                });
            } else if (e.type === 'land') {
                // It lands: a burst of powder, and every spark it had in it.
                this.ring(pose.x, pose.z, t, 1.2, FOX_FIRE[0], 0.8, 1.6);
                this.counts.sparks += this.sparks.emit({
                    from: [pose.x, pose.y + 0.2, pose.z],
                    toward: [0, 1, 0],
                    n: this.handful(10),
                    rgb: [0.6, 0.7, 0.85],
                    time: t,
                    speed: [1, 3.6],
                    cone: 0.9,
                    life: [1.2, 2.2],
                    size: 0.3,
                    glow: 0.3,
                    powder: true,
                    jitter: 0.4,
                });
                this.counts.sparks += this.sparks.emit({
                    from: [pose.x, pose.y + 0.4, pose.z],
                    toward: [0, 1, 0],
                    n: this.handful(70),
                    rgb: null,
                    time: t,
                    speed: [2, 8],
                    cone: 0.85,
                    life: [SPARK_RISE, SPARK_RISE * 1.5],
                    size: 0.028,
                    glow: 1.6,
                    stagger: 0.25,
                });
            }
        }
        // Rings that have reached it: the tail flicks and strikes the piece's colour.
        if (this.flicks.length) {
            for (let i = this.flicks.length - 1; i >= 0; i--) {
                const flick = this.flicks[i];
                if (t < flick.time) continue;
                this.flicks.splice(i, 1);
                if (mind.asleep) continue;
                mind.flickTail(flick.strength);
                this.counts.flicks += 1;
                const tail = mind.tail(this._tail);
                this.counts.sparks += this.sparks.emit({
                    from: tail,
                    toward: [-Math.sin(pose.heading) * 0.5, 1, -Math.cos(pose.heading) * 0.5],
                    n: this.handful(flick.strength > 0.9 ? 16 : 10),
                    rgb: flick.rgb,
                    time: flick.time,
                    speed: [0.8, 3.2],
                    cone: 0.6,
                    life: [SPARK_RISE * 0.8, SPARK_RISE * 1.2],
                    size: 0.026,
                    glow: 1.2,
                    stagger: 0.12,
                });
                this.colourSky(tail, flick.rgb, flick.time + SPARK_RISE * 0.7, 0.5);
            }
        }
        // While the fires burn its tail trails a stream of them.
        if (!mind.asleep) {
            this.tailDebt += dt * (mind.glow * 30 + mind.dash * 8) * (this.tier.sparks / SPARK_POOL);
            const due = Math.floor(this.tailDebt);
            if (due > 0) {
                this.tailDebt -= due;
                this.counts.sparks += this.sparks.emit({
                    from: mind.tail(this._tail),
                    toward: [-Math.sin(pose.heading), 0.7, -Math.cos(pose.heading)],
                    n: Math.min(due, 12),
                    rgb: null,
                    time: t,
                    speed: [0.3, 1.8],
                    cone: 0.5,
                    life: [SPARK_RISE * 0.7, SPARK_RISE * 1.2],
                    size: 0.024,
                    glow: 0.9 + mind.glow * 0.5,
                    jitter: 0.1,
                    lift: [3, 8],
                });
            }
        } else this.tailDebt = 0;
        u.foxPos.value.set(pose.x, pose.y + pose.lift + 0.3, pose.z);
        u.foxGlow.value = mind.glow;
        u.foxEyes.value = pose.eyes;
        this.fox?.update(pose);
    }

    /** What the post stack reads each frame (a reused object). */
    getPostState() {
        return this._post;
    }

    getState() {
        const { pose } = this.mind;
        return {
            quality: this.quality,
            time: this.time,
            combo: this.combo,
            power: this.power,
            surge: this.surge,
            swell: this.swell,
            storm: this.storm,
            breath: this.breath,
            level: this.level,
            // (The hour the sky is turning to, and how far round the day it stands now.)
            hour: hourName(nearestTurn(this.hourStep, this.level - 1) + hourDrift(this.time)),
            hourPhase: ((this.hourPhase() % HOURS.length) + HOURS.length) % HOURS.length,
            counts: { ...this.counts },
            source: this.ghosts?.source ?? null,
            trees: this.trees.length,
            treeTriangles: this.treePart?.triangles ?? 0,
            groundVertices: this.parts.ground?.vertices ?? 0,
            curtains: [...this._curtains],
            sparks: this.sparks?.count ?? 0,
            snow: this.parts.snow?.count ?? 0,
            fox: {
                body: Boolean(this.fox), mode: this.mind.mode, clip: pose.clip, x: pose.x, z: pose.z, glow: pose.glow, speed: pose.speed,
            },
            spirit: this.spiritGlow,
            layoutLive: this.layoutLive,
            heart: { ...this.heart },
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
        this.fox?.dispose();
        this.spirit?.dispose();
        this.fox = null;
        this.spirit = null;
        this.textures.forEach((tex) => tex.dispose());
        this.disposables = [];
        this.textures = [];
        this.parts = {};
        this.sparks = null;
        this.beams = null;
        this.prints = null;
        this.treePart = null;
        this.ghosts = null;
        this.u = null;
        this._camera = null;
    }
}

export { PARTS as WINTER_PARTS };
