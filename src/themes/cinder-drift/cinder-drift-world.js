/**
 * Cinder Drift — the world.
 *
 * Owns the plan, the shared uniforms, every scene part, the camera rig and the choreography.
 * Shared by the theme (cinder-drift-theme.js) and the playground effect
 * (src/playground/effects/cinder-drift.effect.js), so what is iterated there ships.
 *
 * A magma chamber of columnar basalt, and a lake of lava under a drifting crust. The crust is
 * always trying to close; the board keeps breaking it open:
 *
 *   lock     the piece's heat drops into the lake beside the card: a crown of lava leaps where
 *            it strikes, a ring runs out through the crust and the plates part as it passes,
 *            sparks in the piece's colour spray from the card at the piece's own height, and
 *            the pool it melted stays, drifting away with the plates as it skins over. A hard
 *            drop strikes harder and shakes the chamber.
 *   clear    the cleared rows leave the card as tongues of fire, a wave runs out through the
 *            lake and up the cliffs, one front per line, and a fissure opens across the lake:
 *            two fountains for one line, four for two, six for three.
 *   combo    the chamber's pressure rises: the crust thins, lava climbs in the seams between
 *            the columns, the fall swells, the cinders storm upward, and every step of the
 *            chain cracks another fissure in the cliffs that pours a stream into the lake.
 *   four     the chamber holds its breath — every light sinks for a quarter of a second — then
 *            the whole fissure stands up as a curtain of fire, bombs of lava arc across the
 *            chamber and melt the crust where they land, and the lake stands open and white.
 *
 * It BUILDS (src/themes/shared/gameplay-surge.js): every envelope an event lights adds to what is
 * still lit, so a single after a quad never cuts its light and a cascade's waves land on top of
 * one another, deeper and whiter each; and the chamber remembers how hot play runs. Warm, the
 * lava climbs the seams between the columns and the fall runs harder; hot, a hem of flame stands
 * along the fissure between clears, the cliffs crack and pour, fire drips from the roof; in a
 * fever the whole fissure burns, every pipe in the roof rains fire, the seams are lava to the
 * knees and the lake's heart runs white. A quad mid-fever only inhales; a back-to-back answers
 * in the rock (the seams flood, a shock rings through the columns); a perfect clear crowns the
 * clear still playing (the crust lifts, the cliffs all pour). When the hands rest it breathes
 * back to calm.
 *
 * Everything is a function of the world clock and event timestamps (nothing is created at event
 * time), so seek(t) plus a fixed-step replay reproduces any frame.
 */

import * as THREE from 'three/webgpu';
import {
    BOMB_SLOTS,
    CINDER_PALETTES,
    CLEAR_AFTERGLOW,
    CLEAR_SLOTS,
    CLEAR_TRAVEL,
    CURTAIN_LIFE,
    DEG,
    DRIFT_DIR,
    DRIFT_SPEED,
    FOUNTAIN_LIFE,
    FOUNTAIN_SLOTS,
    GRAVITY,
    HEAT_SIZE,
    HUSH_HOLD,
    NOISE_SIZE,
    PALETTE_KEYS,
    PLATE_SIZE,
    RING_FADE,
    RING_SLOTS,
    STREAM_SLOTS,
    WHITE_HEAT,
    approach,
    bakeNoise,
    bakePlates,
    clamp01,
    clearPassTime,
    createChamberUniforms,
    createFieldTexture,
    createScalarTexture,
    fissuresForCombo,
    lerp,
    mulberry32,
    pieceColor,
    powerForCombo,
    rigForAspect,
    smooth,
    uploadHeat,
} from './cinder-drift-tsl.js';
import { HeatField } from './cinder-drift-heat.js';
import { applyCameraBreath } from '../shared/camera-breath.js';
import {
    GameplaySurge, SURGE_WEIGHTS, Swell, softCeiling,
} from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';
import {
    buildPlan, PLAN_SEED, planFromData, SHORE_SIZE,
} from './cinder-drift-layout.js';
import { tierFor } from './cinder-drift-quality.js';
import { createLake } from './cinder-drift-lake.js';
import { createColumns, createShell } from './cinder-drift-rock.js';
import { createFalls, createFissure } from './cinder-drift-falls.js';
import {
    createEmbers, createPlume, createShaft, createSmoke,
} from './cinder-drift-air.js';
import {
    createBombs, createFlashes, createRowJets, createSpatter,
} from './cinder-drift-fx.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './cinder-drift-composition.js';
import { drainSteps } from '../shared/build-steps.js';
import { takeBakedPlan } from './cinder-drift-bakes.js';

/** The rest camera: standing on a ledge over the lake, looking down the chamber. */
export const REST_RIG = Object.freeze({
    height: 3.2,
    /** Horizontal field of view the rig holds; the vertical one follows the aspect, clamped. */
    hFov: 80,
    minFov: 44,
    maxFov: 74,
    near: 0.25,
    far: 900,
});

/** Vertical field of view (degrees) for an aspect ratio. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((REST_RIG.hFov * DEG) / 2) / a)) / DEG;
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, v));
}

/** Seconds the overdrive after a four-line clear takes to cool to 1/e. */
export const SURGE_COOL = 3.4;
/** Seconds a ring / a clear wave stays in the chamber (the shaders skip their loops after). */
const RING_LIVE = 4.5;
const CLEAR_LIVE = 9;
/** Fountains a clear of n lines stands along the fissure. */
export const FOUNTAINS_FOR_LINES = Object.freeze([0, 2, 4, 6, FOUNTAIN_SLOTS]);
/** Seconds between the chamber's own beats: the fall's spray, a stream's foot, a bubble. */
const SPRAY_BEAT = 0.25;
const STREAM_BEAT = 0.5;
const BUBBLE_BEAT = 1.9;
const DRIP_BEAT = 0.2;
/** The spatter pool size the emission counts below are written for. */
const SPATTER_REFERENCE = 4096;

const PARTS = [
    'columns', 'lake', 'shell', 'fissure', 'falls', 'smoke', 'plume', 'shaft', 'embers', 'spatter', 'bombs', 'flashes',
    'jets',
];

export class CinderDriftWorld {
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
        // A first visit's worker baked the plan (cinder-drift-bakes.js): taken once, readers made here.
        const baked = takeBakedPlan(seed ?? PLAN_SEED, this.tier.detail);
        this.plan = baked ? planFromData(baked) : buildPlan({ seed, detail: this.tier.detail });
        this.heat = new HeatField();
        /** Where lava can drip from: the ends of the pipes that hang over the chamber in view. */
        this.tips = [];
        for (let i = 0; i < this.plan.columns.length; i++) {
            const c = this.plan.columns[i];
            if (c.hang && c.dist < 150 && c.z < -18) this.tips.push([c.x, c.y1, c.z]);
        }
        this.heatUploaded = -1;
        this.root = new THREE.Group();
        this.root.name = 'CinderDrift';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.heatTex = null;
        this.falls = null;
        this.spatter = null;
        this.bombs = null;
        this.flashes = null;
        this.jets = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        /** The great fall on screen (fractions, y down): where the post's shafts come from. */
        this.heart = { x: 0.2, y: 0.4 };
        /** The lake's far edge on screen (fraction, y down): the heat haze rises from below it. */
        this.horizon = 0.56;
        this._camera = null;
        this._look = new THREE.Vector3();
        this._ray = new THREE.Vector3();
        this._right = new THREE.Vector3(1, 0, 0);
        this._point = { x: 0.5, y: 0.5 };
        this._strike = { x: 0, z: -9 };
        this._from = [0, 0, 0];
        this._palette = {};
        PALETTE_KEYS.forEach((key) => {
            this._palette[key] = [...CINDER_PALETTES[0][key]];
        });
        this._post = {
            heart: this.heart, flash: 0, kick: 0, shafts: 0.25, bloomBoost: 0, exposure: 1, haze: 1, horizon: 0.56,
        };
        /**
         * Every envelope an event lights ADDS to what is still lit (shared/swell.js): a weak hit
         * after a strong one never cuts the light, and rapid hits ride up to a plateau.
         *   surge     the overdrive after a four-line clear (a second quad adds to the first)
         *   flash, kick, shake   the post's lift, the lens's punch, the chamber's shaking
         *   dip       the breath the chamber lets go when a chain breaks (a sag, not a drop)
         *   quadCurtain, curtain   the fountains' light: a curtain of fire, a smaller clear's
         *   swell     the shafts' and the iris's answer to a clear
         *   whirl     how far T-spins have turned the crust (they add up, one way per turn)
         *   carry     the afterglow of clear waves whose slots newer waves took
         *   b2b       a back-to-back streak: the rock's answer
         *   crown     a perfect clear's crown
         */
        this.swells = {
            surge: new Swell({ release: SURGE_COOL, ceiling: 1.6, knee: 1.05 }),
            flash: new Swell({ release: 0.25, ceiling: 0.6, knee: 0.35 }),
            kick: new Swell({ release: 0.16, ceiling: 1.2, knee: 0.8 }),
            shake: new Swell({ release: 0.3, ceiling: 1.2, knee: 0.75 }),
            dip: new Swell({
                attack: 0.12, release: 0.6, ceiling: 0.4, knee: 0.3,
            }),
            quadCurtain: new Swell({ release: CURTAIN_LIFE * 0.75 }),
            curtain: new Swell({ release: FOUNTAIN_LIFE }),
            swell: new Swell({ release: 0.7, ceiling: 1, knee: 0.6 }),
            whirl: new Swell({
                attack: 0.18, release: 1.7, ceiling: 3.6, knee: 2.4,
            }),
            carry: new Swell({ release: CLEAR_AFTERGLOW, ceiling: 2, knee: 1.4 }),
            b2b: new Swell({ release: 6, ceiling: 1.4, knee: 1 }),
            crown: new Swell({
                attack: 0.15, release: 3, ceiling: 1.3, knee: 1,
            }),
        };
        /** How hot play runs (shared/gameplay-surge.js), and its reading as of the last frame. */
        this.gameplay = new GameplaySurge();
        this.play = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        this.resetState(0);
    }

    /** The overdrive after a four-line clear (0 at rest; a quad 1, more on a perfect or a second quad). */
    get surge() {
        return this.swells.surge.valueAt(this.time);
    }

    /** The post's lift. */
    get flash() {
        return this.swells.flash.valueAt(this.time);
    }

    /** The lens's punch (fov, fringe). */
    get kick() {
        return this.swells.kick.valueAt(this.time);
    }

    /** The chamber's shaking: the strikes', plus the fever's low tremor. */
    get shake() {
        return this.swells.shake.valueAt(this.time) + this.tremor;
    }

    /** How far the chamber has let its breath go after a chain broke. */
    get dip() {
        return this.swells.dip.valueAt(this.time);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.combo = 0;
        this.power = 0;
        this.storm = 0;
        this.level = 1;
        this.paletteIndex = 0;
        this.tremor = 0;
        this.breath = 1;
        this.fissures = 0;
        this.fissuresOpen = 0;
        this.fallGain = 1;
        this.curtain = 0;
        this.rise = 0;
        this.rain = 0.1;
        this.hushUntil = -1;
        this.hushDepth = 1;
        /** The way T-spins turn the crust: kept while it turns, changed for a fresh turn. */
        this.whirlSign = -1;
        this.b2bStreak = 0;
        /** The clear slot the newest wave took. */
        this.clearSlot = 0;
        Object.values(this.swells).forEach((swell) => swell.reset());
        this.gameplay.reset();
        Object.assign(this.play, {
            punch: 0, level: 0, fever: 0, stage: 0,
        });
        /** Pools still to be melted into the lake's memory: bombs landing, fountains standing. */
        this.pending = [];
        this.counts = {
            locks: 0, clears: 0, quads: 0, fountains: 0, bombs: 0, crowns: 0, tspins: 0, b2b: 0,
        };
        // The slow clocks are functions of the world clock until gameplay bends them.
        const motion = this.reducedMotion ? 0.35 : 1;
        this.drift = time * DRIFT_SPEED * motion;
        this.flow = time;
        this.lift = time * motion;
        this.sprayBeat = Math.floor(time / SPRAY_BEAT);
        this.streamBeat = Math.floor(time / STREAM_BEAT);
        this.bubbleBeat = Math.floor(time / BUBBLE_BEAT);
        this.dripBeat = Math.floor(time / DRIP_BEAT);
        this.heat.reset(time);
        this.falls?.reset();
        this.spatter?.reset();
        if (this.spatter) this.spatter.clock = time;
        this.bombs?.reset();
        this.flashes?.reset();
        this.jets?.reset();
        if (this.u) {
            for (let i = 0; i < RING_SLOTS; i++) this.u.ringA[i].value.set(0, 0, -100, 0);
            for (let i = 0; i < CLEAR_SLOTS; i++) {
                this.u.clearA[i].value.set(-100, 1, 0, 0);
                this.u.clearC[i].value.set(1, 1, 1);
            }
            this.u.shock.value.set(-100, 0);
            this.u.whirl.value.set(0, 0, -100, 0);
            this.u.rise.value = 0;
            this.u.clearCarry.value = 0;
        }
    }

    build() {
        drainSteps(this.buildSteps());
        return this;
    }

    /**
     * The build as steps, a part to a step: run at once by build(), or with a breath between steps
     * while the theme comes in (shared/build-steps.js), so no single task holds the page for the
     * whole build. The same parts in the same order.
     */
    * buildSteps() {
        const noise = createFieldTexture(bakeNoise(), NOISE_SIZE, 'cinder-drift-noise');
        const plates = createFieldTexture(bakePlates(), PLATE_SIZE, 'cinder-drift-plates');
        const shore = createScalarTexture(this.plan.shore, SHORE_SIZE, 'cinder-drift-shore');
        this.heatTex = createScalarTexture(this.heat.data, HEAT_SIZE, 'cinder-drift-heat', true);
        this.textures.push(noise, plates, shore, this.heatTex);
        const u = createChamberUniforms({
            noise, plates, shore, heat: this.heatTex,
        });
        this.u = u;
        const { tier, plan } = this;
        u.fallPos.value.set(...plan.fallLight);
        u.fallFoot.value.set(...plan.fall.foot);
        for (let i = 0; i < STREAM_SLOTS; i++) {
            const s = plan.streams[i];
            if (s) u.fissureAt[i].value.set(s.lip[0], s.lip[1], s.lip[2], 1);
        }

        // Solids, nearest first; then the air, back to front by kind.
        this.addPart('columns', createColumns(u, plan));
        yield 'columns';
        this.addPart('lake', createLake(u, { fine: tier.lakeFine, glint: tier.lakeGlint }));
        yield 'lake';
        this.addPart('shell', createShell(u, plan));
        yield 'shell';
        this.addPart('fissure', createFissure(u));
        yield 'fissure';
        this.falls = createFalls(u, plan);
        this.addPart('falls', this.falls);
        yield 'falls';
        if (tier.smoke > 0) {
            this.addPart('smoke', createSmoke(u, tier.smoke));
            yield 'smoke';
        }
        if (tier.plume > 0) {
            this.addPart('plume', createPlume(u, tier.plume, plan));
            yield 'plume';
        }
        if (tier.shaft) {
            this.addPart('shaft', createShaft(u));
            yield 'shaft';
        }
        if (tier.embers > 0) {
            this.addPart('embers', createEmbers(u, tier.embers, plan));
            yield 'embers';
        }

        // ── Gameplay effects (pools, always drawn) ──
        this.spatter = createSpatter(u, tier.spatter);
        this.addPart('spatter', this.spatter);
        yield 'spatter';
        this.bombs = createBombs(u);
        this.addPart('bombs', this.bombs);
        yield 'bombs';
        this.flashes = createFlashes(u);
        this.addPart('flashes', this.flashes);
        yield 'flashes';
        this.jets = createRowJets(u);
        this.addPart('jets', this.jets);
        yield 'jets';

        this.applyPalette(1);
        this.scene.add(this.root);
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
        if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
        if (!this.layoutLive) this.layout = fallbackLayout(this.aspect * 1000, 1000);
    }

    /**
     * The live board / card / HUD rects (screen fractions), or null when no board is on screen:
     * events then aim at where the solo board would be.
     */
    setLayout(rects, aspect) {
        if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
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

    /** A new run: the chamber back at rest (the crust keeps drifting). */
    resetSession() {
        const {
            time, drift, flow, lift, sprayBeat, streamBeat, bubbleBeat, dripBeat,
        } = this;
        this.resetState(time);
        Object.assign(this, {
            drift, flow, lift, sprayBeat, streamBeat, bubbleBeat, dripBeat,
        });
        this.applyPalette(1);
    }

    /** Called once the camera that will render the world is known. */
    bindCamera(camera) {
        this._camera = camera;
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        if (this.disposed) return;
        const t = sim.time;
        this.time = t;
        const calm = this.reducedMotion ? 0 : 1;
        const rig = rigForAspect(this.aspect);
        const fov = fovForAspect(this.aspect) - this.kick * 0.9 * calm;
        if (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        // A slow drift, as of someone standing in the heat, plus the pointer leaning the view,
        // plus the chamber shaking when it is struck hard.
        const swayX = (Math.sin(t * 0.11) * 0.5 + Math.sin(t * 0.063 + 1.3) * 0.34) * calm;
        const swayY = (Math.sin(t * 0.17 + 0.7) * 0.07 + Math.sin(t * 0.079) * 0.05) * calm;
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        const tremor = this.shake * calm;
        const shakeX = (Math.sin(t * 71.3) + Math.sin(t * 43.1 + 1.7)) * 0.045 * tremor;
        const shakeY = (Math.sin(t * 63.7 + 0.4) + Math.sin(t * 37.9)) * 0.04 * tremor;
        camera.position.set(
            swayX + px * 0.8 + shakeX,
            REST_RIG.height + swayY - py * 0.3 - this.kick * 0.07 * calm + shakeY,
            0,
        );
        const yaw = rig.yaw + (Math.sin(t * 0.083 + 2.1) * 0.012 - px * 0.03) * calm;
        const pitch = rig.pitch + (Math.sin(t * 0.097) * 0.006 - py * 0.018) * calm + shakeY * 0.02;
        this._look.set(
            camera.position.x - Math.sin(yaw) * 10,
            camera.position.y + Math.tan(pitch) * 10,
            -Math.cos(yaw) * 10,
        );
        camera.up.set(Math.sin(t * 0.061) * 0.004 * calm + shakeX * 0.05, 1, 0);
        camera.lookAt(this._look);
        // The shared breath (shared/camera-breath.js) on top of the drift above, turning the
        // view only (an eye-level look out over the lake): off under reduced motion.
        applyCameraBreath(camera, t, { scale: this.reducedMotion ? 0 : 1 });
        camera.updateMatrixWorld();
        this._camera = camera;
        this._right.setFromMatrixColumn(camera.matrixWorld, 0);
        // The fall on screen (the shafts come from it) and the lake's far edge (the haze's top).
        const light = this.plan.fallLight;
        this._ray.set(light[0], light[1] + 6, light[2]).project(camera);
        this.heart.x = Math.max(-0.5, Math.min(1.5, this._ray.x * 0.5 + 0.5));
        this.heart.y = Math.max(-0.5, Math.min(1.5, 0.5 - this._ray.y * 0.5));
        this._ray.set(camera.position.x, 0, camera.position.z - 210).project(camera);
        this.horizon = clamp01(0.5 - this._ray.y * 0.5);
    }

    /**
     * Where a ray through a screen point (fractions, y down) meets the lake. Points above the
     * lake's far edge (or absurdly far) land `far` metres ahead instead.
     */
    screenToLake(sx, sy, out = this._strike, far = 12) {
        const camera = this._camera;
        if (!camera) {
            out.x = 0;
            out.z = -far;
            return out;
        }
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position);
        const t = this._ray.y < -1e-4 ? -camera.position.y / this._ray.y : Infinity;
        const dist = Math.hypot(this._ray.x, this._ray.z) * t;
        if (!Number.isFinite(dist) || dist > 60) {
            const flat = Math.hypot(this._ray.x, this._ray.z) || 1;
            out.x = camera.position.x + (this._ray.x / flat) * far;
            out.z = camera.position.z + (this._ray.z / flat) * far;
            return out;
        }
        out.x = camera.position.x + this._ray.x * t;
        out.z = camera.position.z + this._ray.z * t;
        return out;
    }

    /** The world point `depth` metres along the ray through a screen point. */
    screenToWorld(sx, sy, depth, out = this._from) {
        const camera = this._camera;
        if (!camera) {
            out[0] = 0;
            out[1] = REST_RIG.height;
            out[2] = -depth;
            return out;
        }
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        out[0] = camera.position.x + this._ray.x * depth;
        out[1] = camera.position.y + this._ray.y * depth;
        out[2] = camera.position.z + this._ray.z * depth;
        return out;
    }

    // ── The lake ────────────────────────────────────────────────────────────────

    /**
     * Send a ring out through the crust from (x, z) at `time`; `reach` is a fraction of RING_REACH.
     * It takes the slot with the least ring left in it (a spent one, else the faintest, the
     * oldest of equals): a volley of bomb rings never cuts off a lock's ring still running.
     */
    ring(x, z, time, strength, rgb, reach = 1) {
        if (!this.u) return;
        let slot = 0;
        let least = Infinity;
        for (let i = 0; i < RING_SLOTS; i++) {
            const A = this.u.ringA[i].value;
            const age = this.time - A.z;
            const left = A.w <= 0 || age > RING_LIVE ? -1 : A.w * Math.exp(-Math.max(0, age) * RING_FADE);
            if (left < least || (left === least && A.z < this.u.ringA[slot].value.z)) {
                least = left;
                slot = i;
            }
        }
        this.u.ringA[slot].value.set(x, z, time, strength);
        this.u.ringC[slot].value.set(rgb[0], rgb[1], rgb[2], reach);
    }

    /** Melt a pool into the lake's memory at world (x, z), now. */
    melt(x, z, radius, amount) {
        this.heat.stamp(x - DRIFT_DIR[0] * this.drift, z - DRIFT_DIR[1] * this.drift, radius, amount, this.time);
    }

    /**
     * Melt a pool when the clock reaches `time` (a fountain standing up, a bomb landing).
     * `land`: 0 = the pool only; 1 = a bomb comes down there; 2 = and sends a ring out.
     */
    meltAt(time, x, z, radius, amount, land = 0) {
        if (time <= this.time) this.arrive(x, z, radius, amount, land);
        else if (this.pending.length < 160) {
            this.pending.push({
                time, x, z, radius, amount, land,
            });
        } else this.melt(x, z, radius, amount); // (a full queue melts it early, never drops it)
    }

    /** A staged pool's moment has come. (Rings, flashes and drops are taken now, not when staged:
     *  a four-line clear must not spend the pools a lock in the same frame is using.) */
    arrive(x, z, radius, amount, land) {
        this.melt(x, z, radius, amount);
        if (!land || !this.spatter) return;
        if (land === 2) this.ring(x, z, this.time, 0.95, WHITE_HEAT, 0.5);
        this.spatter.emit({
            x, y: 0.15, z, n: this.drops(70), time: this.time, out: [1, 6], up: [2.5, 8.5], life: [0.9, 2.2], size: 0.045,
        });
        this.flashes.fire({
            x, y: 0.8, z, time: this.time, rgb: [1, 0.62, 0.3], size: 3, gain: 4.5,
        });
    }

    /** The heat the lake remembers at world (x, z), now. */
    heatAt(x, z) {
        return this.heat.sample(x - DRIFT_DIR[0] * this.drift, z - DRIFT_DIR[1] * this.drift, this.time);
    }

    /** Spatter counts are written for the High pool: scale them to this tier's. */
    drops(n) {
        return this.spatter ? Math.max(1, Math.round((n * this.spatter.count) / SPATTER_REFERENCE)) : 0;
    }

    // ── Gameplay ────────────────────────────────────────────────────────────────

    /**
     * Where a lock strikes the lake (screen fractions) and which side of the card it is on.
     * Landscape: beside the card, further out the further the piece is from the middle, nearer
     * the viewer the lower the piece lies. Upright: below the card, under the piece's own column.
     */
    lockPoint(u, rows, player, out = this._point) {
        const board = boardFor(this.layout, player);
        const card = cardUnion(this.layout) || board;
        let side = u < 0.5 ? -1 : 1;
        if (Math.abs(u - 0.5) < 0.03) side = this.counts.locks % 2 ? 1 : -1;
        const row = Array.isArray(rows) && rows.length ? rows[Math.floor(rows.length / 2)] : 19;
        const high = clamp01((19 - row) / 19);
        if (!board || !card) {
            out.x = 0.5 + side * 0.2;
            out.y = 0.9;
        } else if (this.aspect < 0.9) {
            out.x = boardPoint(board, u, row, out).x;
            out.y = Math.min(0.985, card.y1 + 0.03 + high * 0.07);
        } else {
            const gap = 0.035 + Math.abs(u - 0.5) * 0.22;
            out.x = Math.max(0.02, Math.min(0.98, side < 0 ? card.x0 - gap : card.x1 + gap));
            out.y = lerp(0.87, 0.71, high);
        }
        out.side = side;
        return out;
    }

    /**
     * A piece locked. `u` = its column as a fraction of the board width, `rows` = the visible
     * rows it covers, `color` = the piece's colour; `screen` (fractions) replaces the board point.
     */
    onLock({
        u = 0.5, rows = null, hardDrop = false, color = null, player = 0, screen = null,
    } = {}) {
        const { u: uniforms } = this;
        if (!uniforms || !this.spatter) return;
        const rgb = pieceColor(color);
        const at = this.lockPoint(u, rows, player);
        let { side } = at;
        let fx = at.x;
        let fy = at.y;
        if (screen) {
            fx = screen.x;
            fy = Math.max(screen.y, this.horizon + 0.06);
            side = screen.x < 0.5 ? -1 : 1;
        }
        fy = Math.max(fy, this.horizon + 0.05);
        const strike = this.screenToLake(fx, fy);
        const { x, z } = strike;
        const hard = hardDrop ? 1 : 0;
        // A strike close under the viewer (an upright screen has nowhere else to put it) is
        // drawn smaller: it must not fill the frame.
        const eye = this._camera?.position;
        const near = Math.max(0.42, Math.min(1, (eye ? Math.hypot(x - eye.x, z - eye.z) : 12) / 12));
        // The quicker the hand, the harder each piece strikes: a bigger crown, a further ring.
        const pace = 1 + this.play.level * 0.45 + this.play.fever * 0.25;

        // ── The lake takes the piece's heat ──
        const glowRgb = rgb.map((c, i) => c * 0.2 + [1, 0.4, 0.09][i] * 0.8);
        const ringStrength = (hard ? 1.3 : 0.85) * (0.5 + 0.5 * near) * Math.sqrt(pace);
        this.ring(x, z, this.time, ringStrength, glowRgb, hard ? 1 : 0.72);
        this.melt(x, z, (hard ? 2.3 : 1.7) * (0.55 + 0.45 * near), hard ? 1.6 : 1.25);
        // The strike: a burst of light, a jet of lava thrown straight up, and a crown of drops
        // with a breath of the piece's colour in it.
        const tint = rgb.map((c) => 0.82 + c * 0.18);
        this.flashes.fire({
            x,
            y: 0.7,
            z,
            time: this.time,
            rgb: tint.map((c, i) => c * [1, 0.62, 0.3][i]),
            size: (hard ? 2.6 : 1.7) * near,
            gain: (hard ? 5 : 3.2) * (0.35 + 0.65 * near),
        });
        this.falls.jet({
            x,
            z,
            time: this.time,
            life: hard ? 0.5 : 0.36,
            height: (hard ? 2.9 : 1.7) * near * pace,
            width: (hard ? 0.6 : 0.42) * near,
        });
        this.spatter.emit({
            x,
            y: 0.15,
            z,
            n: this.drops((hard ? 150 : 64) * pace),
            rgb: tint,
            time: this.time,
            out: [0.6 * near, (hard ? 5.8 : 3.4) * near],
            up: [2.6 * near, (hard ? 10.5 : 6.8) * near],
            life: [0.9, 2.1],
            size: (hard ? 0.03 : 0.024) * (0.5 + 0.5 * near),
            heat: 1.7,
        });

        // ── Sparks leave the card at the piece's own height ──
        const board = boardFor(this.layout, player);
        const card = cardUnion(this.layout) || board;
        if (card && !screen) {
            const row = Array.isArray(rows) && rows.length ? rows[Math.floor(rows.length / 2)] : 19;
            const wy = board ? boardPoint(board, u, row, this._point).y : 0.6;
            const from = this.screenToWorld(side < 0 ? card.x0 : card.x1, wy, 6.5);
            this.spatter.emit({
                x: from[0],
                y: from[1],
                z: from[2],
                n: this.drops(hard ? 80 : 34),
                rgb,
                time: this.time,
                out: [1.2, hard ? 6.5 : 4.2],
                up: [-0.6, 2.6],
                life: [0.45, 1.25],
                size: 0.011,
                heat: 1.5,
                gravity: -1.5,
                drag: 2.3,
                aim: [this._right.x * side, this._right.z * side],
            });
        }
        // (Each strike adds to the punch still in the lens: rapid drops ride on a floor.)
        const S = this.swells;
        S.kick.hit(hard ? 0.5 : 0.1, this.time);
        S.flash.hit(hard ? 0.08 : 0.02, this.time);
        if (hard) S.shake.hit(0.45, this.time);
        this.gameplay.lock({ hardDrop: hard === 1 }, this.time);
        this.counts.locks += 1;
    }

    /**
     * How deep a four-line clear's hush goes: all the way from cold, the shallower the hotter play
     * already runs and the more overdrive is still burning (a quad mid-fever only inhales: it
     * never blacks the chamber out), held back under Reduce flashing (a frame-wide sink and
     * re-light is a flash, ADR-0021).
     */
    hushDepthNow() {
        const level = this.gameplay.level.valueAt(this.time);
        const cold = clamp01(1 - level * 1.15 - this.gameplay.fever * 0.4 - Math.min(1, this.surge) * 0.3);
        return Math.max(0.12, cold) * flashScale();
    }

    /**
     * The clear slot a new wave takes: an empty one, else the one with the least light left (its
     * fronts long gone by, its afterglow faint). What that one still held is carried on as a glow
     * that fades as it would have, so the chamber's light never drops when a wave is replaced.
     */
    takeClearSlot(time) {
        const { clearA } = this.u;
        let slot = 0;
        let least = Infinity;
        for (let i = 0; i < CLEAR_SLOTS; i++) {
            const A = clearA[i].value;
            const age = time - A.x;
            const left = A.z <= 0 || age > CLEAR_LIVE
                ? -1
                : A.z * Math.exp(-Math.max(0, age - CLEAR_TRAVEL) / CLEAR_AFTERGLOW);
            if (left < least) {
                least = left;
                slot = i;
            }
        }
        if (least > 0) {
            const A = clearA[slot].value;
            // (Its afterglow as it stands part-way out: younger far away, older at the heart.)
            const age = Math.max(0, time - A.x - CLEAR_TRAVEL * 0.4);
            this.swells.carry.hit(A.z * Math.exp(-age / CLEAR_AFTERGLOW), time);
        }
        this.clearSlot = slot;
        return slot;
    }

    /**
     * A shock through the rock from the wave's heart, born at `birth`. A shock still running
     * stronger than the new one keeps its front and takes the new one's strength into it; a
     * stronger new one starts its own front with what the old one still had.
     */
    shockAt(birth, amount) {
        if (!this.u) return;
        const s = this.u.shock.value;
        const gone = Math.max(0, birth - s.x);
        const left = s.y * Math.exp(-gone / 1.1);
        if (left >= amount) s.y = Math.min(1.8, (left + amount * 0.5) * Math.exp(gone / 1.1));
        else s.set(birth, Math.min(1.8, amount + left * 0.5));
    }

    /** Turn the crust round (x, z): a fresh turn may go either way; one still turning keeps its way. */
    twist(x, z, amount) {
        const { whirl } = this.swells;
        if (whirl.valueAt(this.time) < 0.05) this.whirlSign = -this.whirlSign;
        this.u.whirl.value.set(x, z, this.time, this.u.whirl.value.w);
        whirl.hit(amount, this.time);
    }

    /**
     * Lines cleared. `lines` 1..4; `tspin`, `perfect`, `b2b`; `cascade` = which wave of one lock's
     * clear this is (each wave lands deeper and whiter on the last); `combo` = the chain it is a
     * step of (the fountains walk out along the fissure with it). (The chamber's pressure follows
     * the true combo through onCombo.)
     */
    onClear({
        rows = null, lines = 1, tspin = false, perfect = false, player = 0, screen = null,
        cascade = 1, combo = 1, b2b = false,
    } = {}) {
        const { u: uniforms } = this;
        if (!uniforms || !this.spatter) return;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        // How deep in a cascade this wave is (0 = its first), and the chain's step.
        const depth = Math.max(0, Math.min(6, Math.round(Number(cascade) || 1) - 1));
        const chain = Math.max(1, Math.round(Number(combo) || 1));
        const S = this.swells;
        const { level } = this.play;
        const p = this._palette;
        // One line answers in the lava's body, two toward its heart, three in its heart; four
        // lean to the white of the forge (not all the way: the lake must keep its colour). A
        // cascade's later waves, and a back-to-back, burn whiter still.
        let rgb;
        if (quad) rgb = [0, 1, 2].map((c) => lerp(p.hot[c], WHITE_HEAT[c], 0.4));
        else {
            const k = (n - 1) / 2;
            rgb = [0, 1, 2].map((c) => lerp(p.mid[c], p.hot[c], k));
        }
        const whiten = Math.min(0.55, depth * 0.1 + (b2b ? 0.3 : 0));
        if (whiten > 0) rgb = rgb.map((c, i) => lerp(c, WHITE_HEAT[i], whiten));
        const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
        rgb = rgb.map((c) => c / peak);
        const deeper = 1 + 0.22 * depth;
        const strength = Math.min(2.2, (0.6 + 0.15 * n + (quad ? 0.25 : 0)) * deeper * (b2b ? 1.15 : 1));
        const birth = quad ? this.time + HUSH_HOLD : this.time;
        // (Read before this clear's own heat joins: a quad's hush depends on how hot play WAS.)
        const hushDepth = quad ? this.hushDepthNow() : 0;
        this.gameplay.clear({
            lines: n, cascade, combo: chain, tspin, perfect, b2b,
        }, birth);

        // ── The wave leaves the foot of the board ──
        const board = boardFor(this.layout, player);
        const card = cardUnion(this.layout);
        const heart = screen
            ? this.screenToLake(screen.x, Math.max(screen.y, this.horizon + 0.08))
            : this.screenToLake(board ? (board.x0 + board.x1) * 0.5 : 0.5, 0.93);
        const hx = heart.x;
        const hz = heart.z;
        uniforms.heart.value.set(hx, hz);
        const slot = this.takeClearSlot(birth);
        uniforms.clearA[slot].value.set(birth, perfect ? 4 : n, strength, quad ? 1 : 0);
        uniforms.clearC[slot].value.set(rgb[0], rgb[1], rgb[2]);
        S.swell.hit((0.3 + 0.12 * n) * (1 + 0.15 * depth), birth);
        // The lake's heart under the board: each clear melts it wider, and the hotter play runs
        // the more of it stays open between clears (the lake remembers: it runs white in a fever).
        const pool = (0.5 + 0.12 * n + 0.1 * depth) * (1 + level * 0.4);
        this.melt(hx, hz, 2.4 + 0.5 * n + 0.8 * depth + level * 1.5, pool);

        // ── The cleared rows leave the card as tongues of fire ──
        if (board && card && this.layoutLive && !screen) {
            const list = Array.isArray(rows) && rows.length ? rows : Array.from({ length: n }, (_, i) => 19 - i);
            const ys = [];
            for (let i = 0; i < list.length && i < 4; i++) ys.push(boardPoint(board, 0.5, list[i], this._point).y);
            const jet = Math.min(1.5, 0.8 + 0.18 * n) * (1 + 0.12 * depth);
            this.jets.fire(ys, card.x0, card.x1, this.time, jet, 0.9 + 0.09 * n + 0.05 * depth);
            for (let i = 0; i < ys.length; i++) {
                for (let side = -1; side <= 1; side += 2) {
                    const from = this.screenToWorld(side < 0 ? card.x0 : card.x1, ys[i], 6.5);
                    this.spatter.emit({
                        x: from[0],
                        y: from[1],
                        z: from[2],
                        n: this.drops(46),
                        rgb,
                        time: this.time,
                        stagger: 0.12,
                        out: [3, 12],
                        up: [-1.2, 3.4],
                        life: [0.5, 1.3],
                        size: 0.013,
                        heat: 1.6,
                        gravity: 3.2,
                        drag: 1.5,
                        aim: [this._right.x * side, this._right.z * side],
                    });
                }
            }
        }

        // ── A fissure opens across the lake ──
        // A chain walks its fountains out along the fissure from the card, a pair a step, until
        // the whole line has burned; a cascade's later waves stand more, and taller.
        const rand = mulberry32(0x7f15 + this.counts.clears * 2654435761);
        const more = 2 * Math.min(depth, 3);
        const stand = perfect ? FOUNTAIN_SLOTS : Math.min(FOUNTAIN_SLOTS, FOUNTAINS_FOR_LINES[n] + more);
        const walk = quad ? 0 : (2 * (chain - 1)) % FOUNTAIN_SLOTS;
        const taller = (1 + 0.1 * depth) * (1 + 0.2 * level);
        for (let k = 0; k < stand; k++) {
            const f = this.plan.fountains[(walk + k) % FOUNTAIN_SLOTS];
            const at = birth + clearPassTime(Math.hypot(f.x - hx, f.z - hz)) + rand() * 0.12;
            const life = quad ? CURTAIN_LIFE * (0.7 + rand() * 0.5) : FOUNTAIN_LIFE * (0.75 + 0.14 * n + rand() * 0.3);
            // (A curtain is never a row of equals: a few stand far taller than their neighbours.)
            const height = (quad ? 9 + rand() ** 1.6 * 19 : 4.5 + 2.2 * n + rand() * 2.5) * taller;
            this.falls.fountain({
                x: f.x, z: f.z, time: at, life, height: height * 0.72, width: quad ? 2.0 + rand() * 1.0 : 0.9 + 0.16 * n,
            });
            const top = Math.sqrt(2 * GRAVITY * height);
            this.spatter.emit({
                x: f.x,
                y: 0.3,
                z: f.z,
                n: Math.round(this.tier.fountain * (quad ? 0.62 : 0.3 + 0.1 * n) * (1 + 0.12 * depth)),
                time: at,
                stagger: life * 0.86,
                out: [0.5, 2.2 + height * 0.16],
                up: [top * 0.5, top * 1.06],
                life: [1.3, 2.9],
                size: quad ? 0.075 : 0.055,
                heat: 1.75,
                spread: 0.8,
            });
            // (Of a curtain's twelve fountains every other one flashes: the rest of the slots
            // belong to whatever else is happening.)
            if (!quad || k % 2 === 0) {
                this.flashes.fire({
                    x: f.x, y: 1.2, z: f.z, time: at, rgb: [1, 0.6, 0.26], size: quad ? 2.2 : 2.0, gain: quad ? 2.2 : 2.8,
                });
            }
            this.meltAt(at, f.x, f.z, quad ? 4.6 : 2.6 + 0.4 * n, quad ? 2 : 1.1);
            this.counts.fountains += 1;
        }
        // The fountains light the chamber for as long as they stand (and a chain's add up).
        if (quad) S.quadCurtain.hit(1, birth);
        else S.curtain.hit((0.18 + 0.14 * n) * (1 + 0.25 * depth), birth);
        this.storm = Math.max(this.storm, Math.min(1.4, 0.32 + 0.16 * n + (quad ? 0.4 : 0) + 0.08 * depth));
        // A beat after the wave leaves, the lens takes the punch (added to what it still holds).
        const punch = 0.24 + 0.1 * n + 0.05 * depth;
        S.kick.hit(punch, birth + 0.1);
        S.flash.hit(punch * 0.5, birth + 0.1);
        if (quad) S.shake.hit(1, birth + 0.1);

        if (quad) {
            // The chamber holds its breath (as deep as play is cold), then everything goes up.
            this.hushUntil = this.time + HUSH_HOLD;
            this.hushDepth = hushDepth;
            S.surge.hit(perfect ? 1.3 : 1, this.time);
            this.shockAt(birth, this.reducedMotion ? 0.5 : 1);
            const bombs = Math.min(BOMB_SLOTS, this.tier.bombs);
            for (let b = 0; b < bombs; b++) {
                const f = this.plan.fountains[b % FOUNTAIN_SLOTS];
                // Out across the lake, clear of the card and of the rock.
                const side = b % 2 ? 1 : -1;
                let tx = side * 10;
                let tz = -30;
                for (let tries = 0; tries < 8; tries++) {
                    const rx = side * (8 + rand() * 40);
                    const rz = -12 - rand() * 100;
                    if (this.plan.depthAt(rx, rz) < -2.5) {
                        tx = rx;
                        tz = rz;
                        break;
                    }
                }
                const flight = 2.5 + rand() * 1.5;
                const from = [f.x, 2.5, f.z];
                const leave = birth + clearPassTime(Math.hypot(f.x - hx, f.z - hz)) + 0.25 + rand() * 1.7;
                const velocity = [(tx - from[0]) / flight, (0.5 * GRAVITY * flight * flight - from[1]) / flight, (tz - from[2]) / flight];
                this.bombs.launch({
                    from, velocity, time: leave, flight,
                });
                // Where it comes down the crust breaks; every other one sends a ring out.
                this.meltAt(leave + flight, tx, tz, 3.4, 1.6, b % 2 ? 1 : 2);
                this.counts.bombs += 1;
            }
            S.shake.hit(0.2, this.time);
            this.counts.quads += 1;
            if (perfect) this.crown(birth, player, { wave: false });
        }
        if (tspin) {
            // The crust turns round the foot of the board (a second spin adds to the turn).
            this.twist(hx, hz - 9, 1.8 * (1 + 0.15 * depth));
            this.storm = Math.max(this.storm, 0.85);
        }
        if (b2b) {
            // Back-to-back: the rock answers. The seams between the columns flood with lava and
            // a shock rings out through them, higher and harder with every step of the streak.
            this.b2bStreak += 1;
            const step = Math.min(this.b2bStreak, 4);
            S.b2b.hit(0.35 + 0.15 * step, birth);
            this.shockAt(birth, (this.reducedMotion ? 0.5 : 1) * (0.5 + 0.12 * step));
            this.counts.b2b += 1;
        } else if (n < 4 && !tspin) this.b2bStreak = 0;
        this.counts.clears += 1;
    }

    /**
     * A perfect clear's crown, at `at`, on the clear still playing: the crust lifts (rafts break
     * open across the lake and skin back over for the next quarter minute), the cliffs all pour
     * at once, fire rains from the whole roof, a white wave runs out, and the rock rings.
     */
    crown(at, player = 0, { wave = true } = {}) {
        const { u: uniforms } = this;
        const S = this.swells;
        S.crown.hit(1, at);
        S.swell.hit(0.6, at);
        S.flash.hit(0.22, at);
        S.kick.hit(0.35, at);
        this.storm = Math.max(this.storm, 1.1);
        this.shockAt(at, this.reducedMotion ? 0.5 : 0.9);
        // The crust lifts: rafts break open across the middle of the lake, and skin back over.
        const spots = 9;
        for (let i = 0; i < spots; i++) {
            const sx = 0.06 + (i / (spots - 1)) * 0.88;
            const sy = [0.8, 0.7, 0.64][i % 3];
            const spot = this.screenToLake(sx, Math.max(sy, this.horizon + 0.04), this._strike, 60);
            this.meltAt(at + 0.05 * i, spot.x, spot.z, 5 + (i % 3) * 2.5, 0.45);
        }
        // A white wave from the heart (a perfect clear's own, four fronts), unless its quad's is it.
        if (!wave) {
            this.counts.crowns += 1;
            return;
        }
        const board = boardFor(this.layout, player);
        const heart = this.screenToLake(board ? (board.x0 + board.x1) * 0.5 : 0.5, 0.93);
        uniforms.heart.value.set(heart.x, heart.z);
        const slot = this.takeClearSlot(at);
        const w = WHITE_HEAT;
        uniforms.clearA[slot].value.set(at, 4, 1.25, 1);
        uniforms.clearC[slot].value.set(w[0], w[1], w[2]);
        this.counts.crowns += 1;
    }

    /**
     * A PERFECT_CLEAR that came after its clear's frame (physics sends it ~360 ms after the last
     * wave): the crown on the clear still playing, never a second hush or a second volley.
     */
    onPerfectCrown({ player = 0 } = {}) {
        if (!this.u || !this.spatter) return;
        const W = SURGE_WEIGHTS;
        this.gameplay.punch.hit(W.punch.perfect, this.time);
        this.gameplay.level.hit(W.heat.perfect, this.time);
        this.crown(this.time, player);
    }

    /** A T-spin that cleared nothing: the crust turns a little round the foot of the board. */
    onTSpinMini({ player = 0 } = {}) {
        if (!this.u || !this.spatter) return;
        const board = boardFor(this.layout, player);
        const heart = this.screenToLake(board ? (board.x0 + board.x1) * 0.5 : 0.5, 0.93);
        this.twist(heart.x, heart.z - 9, 0.9);
        this.ring(heart.x, heart.z - 9, this.time, 0.75, this._palette.spark, 0.6);
        this.storm = Math.max(this.storm, 0.45);
        const W = SURGE_WEIGHTS;
        this.gameplay.punch.hit(W.punch.tspin * 0.5, this.time);
        this.gameplay.level.hit(W.heat.tspin * 0.5, this.time);
        this.counts.tspins += 1;
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        // The chain broke: the chamber lets its breath go, a slow sag, deeper the longer the chain.
        if (n === 0 && this.combo >= 2) this.swells.dip.hit(0.14 + 0.014 * Math.min(this.combo, 10), this.time);
        this.combo = n;
    }

    /** A new level: the chamber burns a different fire. */
    levelUp(level, { silent = false } = {}) {
        this.level = Math.max(1, Math.round(Number(level) || 1));
        this.paletteIndex = (this.level - 1) % CINDER_PALETTES.length;
        if (silent) this.applyPalette(1);
        else {
            this.storm = Math.max(this.storm, 0.75);
            this.swells.flash.hit(0.14, this.time);
            this.shockAt(this.time, 0.4);
            this.gameplay.levelUp(this.time);
        }
    }

    /** Ease the live palette toward the level's (k = 1 snaps). */
    applyPalette(k) {
        const target = CINDER_PALETTES[this.paletteIndex];
        const p = this._palette;
        for (let i = 0; i < PALETTE_KEYS.length; i++) {
            const key = PALETTE_KEYS[i];
            for (let c = 0; c < 3; c++) p[key][c] = k >= 1 ? target[key][c] : p[key][c] + (target[key][c] - p[key][c]) * k;
        }
    }

    // ── Frame ───────────────────────────────────────────────────────────────────

    /** The chamber's own life: the fall's spray, the feet of the open streams, a bubble now and then. */
    beats(t, live) {
        const spray = Math.floor(t / SPRAY_BEAT);
        if (spray !== this.sprayBeat) {
            this.sprayBeat = spray;
            if (live) {
                const { foot } = this.plan.fall;
                this.spatter.emit({
                    x: foot[0],
                    y: 0.4,
                    z: foot[2],
                    n: this.drops(14 * this.fallGain),
                    time: t,
                    out: [0.8, 4.6],
                    up: [2.5, 8.5],
                    life: [1.0, 2.2],
                    size: 0.07,
                    spread: 3.2,
                    stagger: SPRAY_BEAT,
                });
            }
        }
        const stream = Math.floor(t / STREAM_BEAT);
        if (stream !== this.streamBeat) {
            this.streamBeat = stream;
            if (live) {
                for (let i = 0; i < STREAM_SLOTS; i++) {
                    if (this.fissures - i < 0.6) break;
                    const s = this.plan.streams[i];
                    this.melt(s.foot[0], s.foot[2], 2.1, 0.42);
                    this.spatter.emit({
                        x: s.foot[0],
                        y: 0.3,
                        z: s.foot[2],
                        n: this.drops(9),
                        time: t,
                        out: [0.5, 2.6],
                        up: [1.5, 5],
                        life: [0.8, 1.7],
                        size: 0.05,
                        spread: 1,
                        stagger: STREAM_BEAT,
                    });
                }
            }
        }
        const bubble = Math.floor(t / BUBBLE_BEAT);
        if (bubble !== this.bubbleBeat) {
            this.bubbleBeat = bubble;
            if (live) {
                const rand = mulberry32(0xb0b + bubble * 7919);
                const x = (rand() - 0.5) * 44;
                const z = -7 - rand() * 34;
                if (this.plan.depthAt(x, z) < -2) {
                    this.melt(x, z, 1.2 + rand() * 0.8, 0.6);
                    this.spatter.emit({
                        x, y: 0.1, z, n: this.drops(16), time: t, out: [0.3, 1.8], up: [1.2, 3.8], life: [0.7, 1.5], size: 0.024,
                    });
                }
            }
        }
        const drip = Math.floor(t / DRIP_BEAT);
        if (drip !== this.dripBeat) {
            this.dripBeat = drip;
            if (live && this.tips.length) {
                // A drop now and then at rest; under pressure, a rain of fire.
                const rand = mulberry32(0xd41b + drip * 2654435761);
                const rate = this.rain * (this.spatter.count / SPATTER_REFERENCE);
                const n = Math.floor(rate) + (rand() < rate % 1 ? 1 : 0);
                for (let k = 0; k < n; k++) {
                    const tip = this.tips[Math.floor(rand() * this.tips.length)];
                    this.spatter.emit({
                        x: tip[0],
                        y: tip[1] - 0.2,
                        z: tip[2],
                        n: 1,
                        time: t + rand() * DRIP_BEAT,
                        out: [0, 0.25],
                        up: [-1.5, 0],
                        life: [2.8, 3.6],
                        size: 0.06,
                        heat: 1.55,
                        drag: 0.04,
                    });
                }
            }
        }
    }

    update(sim, camera = this._camera) {
        const { u } = this;
        if (!u) return;
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const t = this.time;
        const motion = this.reducedMotion ? 0.35 : 1;
        if (camera) this._camera = camera;
        if (this.spatter) this.spatter.clock = t;
        const S = this.swells;

        // ── How hot play runs ──
        // calm (as at rest), warm (the chamber takes notice), hot (it is alive with the player),
        // fever (the whole fissure burns and the roof rains fire).
        const play = this.gameplay.sample(t);
        Object.assign(this.play, play);
        const { level, fever } = play;
        const warm = smooth(0.15, 0.55, level);
        const hot = smooth(0.4, 0.85, level);
        const { surge } = this;
        const crown = S.crown.valueAt(t);
        const b2b = S.b2b.valueAt(t);
        // A low tremor through the rock in a fever (the camera reads it, scaled by its calm).
        this.tremor = fever * 0.1 + crown * 0.12;

        // ── The pressure ──
        const target = powerForCombo(this.combo);
        this.power += (target - this.power) * approach(target > this.power ? 2.4 : 0.6, dt);
        this.storm *= Math.exp(-dt / 1.7);
        // The hush before a quad: as deep as play was cold (hushDepthNow), never a blackout mid-fever.
        const hushing = t < this.hushUntil;
        const hush = hushing ? this.hushDepth : 0;
        const breathTarget = hushing ? 1 - 0.85 * hush : 1 - this.dip;
        this.breath += (breathTarget - this.breath) * approach(hushing ? 40 : 14, dt);
        if (dt === 0) this.breath = breathTarget;
        this.applyPalette(approach(0.8, dt));

        // Every step of the chain past the first cracks another fissure in the cliffs; hot play
        // cracks a couple on its own, a fever all but all, a back-to-back more with every step of
        // its streak, a perfect clear every one.
        const fissureTarget = Math.min(STREAM_SLOTS, Math.max(
            fissuresForCombo(this.combo),
            hot * 2 + fever * 3 + b2b * 3,
            crown * STREAM_SLOTS,
        ));
        this.fissures += (fissureTarget - this.fissures) * approach(fissureTarget > this.fissures ? 3.2 : 0.6, dt);
        const open = Math.min(STREAM_SLOTS, Math.floor(this.fissures + 0.5));
        if (open > this.fissuresOpen && dt > 0) {
            for (let i = this.fissuresOpen; i < open; i++) {
                const s = this.plan.streams[i];
                this.spatter.emit({
                    x: s.lip[0],
                    y: s.lip[1],
                    z: s.lip[2],
                    n: this.drops(80),
                    time: t,
                    out: [1, 5.5],
                    up: [-1, 4.5],
                    life: [0.9, 2.0],
                    size: 0.05,
                    aim: [-s.side, 0],
                });
                this.flashes.fire({
                    x: s.lip[0], y: s.lip[1], z: s.lip[2], time: t, rgb: [1, 0.55, 0.22], size: 3.2, gain: 3.6,
                });
            }
            S.flash.hit(0.05, t);
        }
        this.fissuresOpen = open;
        // The fall runs harder with the pressure, the overdrive, the heat of play and the rock's answers.
        const gainTarget = 1 + this.power * 0.55 + surge * 0.8 + warm * 0.12 + fever * 0.25 + b2b * 0.4 + crown * 0.3;
        this.fallGain += (gainTarget - this.fallGain) * approach(1.6, dt);
        if (dt === 0) this.fallGain = gainTarget;
        // The fountains' light, plus the hem of flame that stands along the fissure once play runs
        // hot (a wall of it in a fever); the clears' own add up under a quick hand.
        // (A quick hand's clears stand a hem, never a quad's wall: that is the quad's to stand.)
        // (A quad's wall of fire stands in place of the hem and the smaller clears' light, not
        // on top of them: they are the floor it rises from and falls back to.)
        const hem = hot * 0.08 + fever * 0.2 + crown * 0.1;
        const floor = softCeiling(S.curtain.valueAt(t), 0.35, 0.55) + hem;
        const wall = S.quadCurtain.valueAt(t);
        this.curtain = softCeiling(Math.max(wall, floor) + 0.25 * Math.min(wall, floor), 0.9, 1.15);
        // Lava climbs the seams between the columns with the heat of play and a back-to-back.
        this.rise = warm * 0.8 + hot * 0.9 + fever * 2.2 + b2b * 3 + crown * 1.5;

        // ── The slow clocks ──
        const stir = warm * 0.35 + hot * 0.35 + fever * 0.8;
        this.drift += dt * DRIFT_SPEED * motion * (1 + this.power * 1.5 + surge * 2.2 + this.storm * 0.8 + stir);
        this.flow += dt * (1 + this.power * 1.4 + surge * 2 + this.storm + stir);
        this.lift += dt * motion * (1 + this.power * 3.4 + surge * 5 + this.storm * 2.2 + stir * 2.5);
        // Fire drips from the pipes in the roof: a drop now and then at rest, a rain of it under
        // pressure, in a fever and on a perfect clear.
        this.rain = 0.1 + this.power * this.power * 7 + surge * 9 + hot * 2.5 + fever * 9 + crown * 10;

        // ── The chamber's own life, and the pools whose moment has come ──
        if (this.spatter) this.beats(t, dt > 0);
        if (this.pending.length) {
            for (let i = this.pending.length - 1; i >= 0; i--) {
                const m = this.pending[i];
                if (m.time <= t) {
                    this.arrive(m.x, m.z, m.radius, m.amount, m.land);
                    this.pending.splice(i, 1);
                }
            }
        }
        if (this.heat.version !== this.heatUploaded) {
            uploadHeat(this.heatTex, this.heat);
            this.heatUploaded = this.heat.version;
        }

        // ── Uniforms ──
        let ringsLive = 0;
        for (let i = 0; i < RING_SLOTS; i++) {
            const age = t - u.ringA[i].value.z;
            if (age > -6 && age < RING_LIVE) ringsLive = 1;
        }
        const carry = S.carry.valueAt(t);
        let clearLive = carry > 0 ? 1 : 0;
        for (let i = 0; i < CLEAR_SLOTS; i++) {
            const age = t - u.clearA[i].value.x;
            if (age > -1 && age < CLEAR_LIVE) clearLive = 1;
        }
        u.ringsLive.value = ringsLive;
        u.clearLive.value = clearLive;
        u.clearCarry.value = carry;
        u.time.value = t;
        u.power.value = this.power;
        u.surge.value = surge;
        u.breath.value = this.breath;
        u.drift.value = this.drift;
        u.flow.value = this.flow;
        u.lift.value = this.lift;
        u.heatRef.value = this.heat.ref;
        u.fissures.value = this.fissures;
        u.fallGain.value = this.fallGain;
        u.curtain.value = this.curtain * (1 - hush);
        u.rise.value = this.rise;
        const turn = S.whirl.valueAt(t);
        u.whirl.value.w = turn > 0 ? this.whirlSign * turn : 0;
        // The overdrive burns every fire toward white; so does a fever, and a crown.
        const p = this._palette;
        const white = clamp01(surge * 0.22 + crown * 0.1);
        u.hot.value.set(lerp(p.hot[0], WHITE_HEAT[0], white), lerp(p.hot[1], WHITE_HEAT[1], white), lerp(p.hot[2], WHITE_HEAT[2], white));
        u.mid.value.set(p.mid[0], p.mid[1], p.mid[2]);
        u.deep.value.set(p.deep[0], p.deep[1], p.deep[2]);
        u.haze.value.set(p.haze[0], p.haze[1], p.haze[2]);
        u.rock.value.set(p.rock[0], p.rock[1], p.rock[2]);
        u.cool.value.set(p.cool[0], p.cool[1], p.cool[2]);
        u.spark.value.set(p.spark[0], p.spark[1], p.spark[2]);

        // ── Post ──
        const swell = S.swell.valueAt(t);
        const post = this._post;
        post.flash = this.flash;
        // (Under rapid play the lens's punch rides on the surge's floor.)
        post.kick = this.kick + play.punch * 0.2;
        const ablaze = Math.min(1, this.curtain * 0.9 + surge * 0.5 + this.power * 0.5);
        const shafts = (0.16 + this.power * 0.1 + swell * 0.12 + hot * 0.06 + fever * 0.08) * (1 - 0.55 * ablaze);
        post.shafts = lerp(shafts, 0.04, hush);
        post.bloomBoost = swell * 0.1 - ablaze * 0.65 + fever * 0.06;
        // The iris closes as the chamber flares, so its colours survive the surge (the build is
        // in the fire itself: the seams, the streams, the rain, the hem, never a brighter haze).
        post.exposure = 1 / (1 + surge * 0.6 + this.curtain * 0.6 + swell * 0.25 + this.power * 0.12
            + this.storm * 0.1 + crown * 0.2);
        post.haze = 1 + this.power * 0.5 + surge * 0.8 + this.storm * 0.3 + warm * 0.2 + fever * 0.4;
        post.horizon = this.horizon;
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
            fissures: this.fissures,
            fallGain: this.fallGain,
            curtain: this.curtain,
            rise: this.rise,
            play: { ...this.play },
            drift: this.drift,
            level: this.level,
            palette: CINDER_PALETTES[this.paletteIndex].name,
            counts: { ...this.counts },
            heat: this.heat.total(this.time),
            pending: this.pending.length,
            columns: this.plan.columns.length,
            standing: this.plan.counts.standing,
            hanging: this.plan.counts.hanging,
            embers: this.parts.embers ? this.parts.embers.count : 0,
            smoke: this.parts.smoke ? this.parts.smoke.count : 0,
            spatter: this.spatter ? this.spatter.count : 0,
            tips: this.tips.length,
            layoutLive: this.layoutLive,
            heart: { ...this.heart },
            horizon: this.horizon,
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
        this.heatTex = null;
        this.falls = null;
        this.spatter = null;
        this.bombs = null;
        this.flashes = null;
        this.jets = null;
        this.u = null;
        this._camera = null;
        this.pending = [];
        this.tips = [];
    }
}

export { PARTS as CINDER_DRIFT_PARTS };
