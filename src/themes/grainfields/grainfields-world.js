/**
 * Grainfields — one shared world (the theme and the playground mount the same one).
 *
 * Grain country under a breaking storm: the barley round the eye, the land (the patchwork, the
 * path, the vale, the fort's knoll, the ridges' forest), Lapporten on the horizon, the
 * shelterbelts' trees, the sky with its deck, the locks' sunbeams and the motes in the air; and
 * everything gameplay does to them (grainfields-reactions.js holds the event language).
 *
 * Lifecycle: `await GrainfieldsWorld.prepare(quality, { signal })` lays the land's mesh and the
 * planted things out in slices; `new GrainfieldsWorld({ ..., prepared }).build()` makes the scene
 * objects; each frame `updateCamera` → `update` → the post renders.
 */
import * as THREE from 'three/webgpu';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { breathe, drainSteps } from '../shared/build-steps.js';
import {
    DECK, DEG, EYE, PIECE_COLORS, PLACES, RIG, TAU, TIMING, clamp, hexToLinear, rigFor, smooth,
} from './grainfields-core.js';
import {
    HOURS, HourWheel, blendLight, copyLight, createLight, lightAt,
} from './grainfields-hours.js';
import { tierFor } from './grainfields-quality.js';
import {
    PATH, PATH_POINTS, flowerWidth, grainSites, groundHeight, pathDistance, treeSites,
} from './grainfields-plan.js';
import { createNoiseTexture, createUniforms, deckThreshold } from './grainfields-tsl.js';
import { createLand, fanSteps } from './grainfields-land.js';
import { createLapporten, gateHeight } from './grainfields-lapporten.js';
import { createSky } from './grainfields-sky.js';
import { createForest } from './grainfields-forest.js';
import { disposeGrainfieldsAssets, loadGrainfieldsAssets } from './grainfields-assets.js';
import { createGrain } from './grainfields-grain.js';
import { createBeams } from './grainfields-beams.js';
import { createMotes } from './grainfields-motes.js';
import { createFort } from './grainfields-fort.js';
import { createGeese } from './grainfields-geese.js';
import { createHerd } from './grainfields-herd.js';

import { GrainfieldsReactions } from './grainfields-reactions.js';
import { fallbackLayout } from './grainfields-composition.js';

export const GRAINFIELDS_PARTS = Object.freeze(['grain', 'land', 'lapporten', 'fort', 'trees', 'herd', 'geese', 'sky', 'beams', 'motes']);
export const REST_RIG = Object.freeze({ near: RIG.near, far: RIG.far });
export const fovForAspect = (aspect) => rigFor(aspect).fov;
export const PIECE_LINEAR = PIECE_COLORS.map((c) => hexToLinear(c));

const COUNTERS = [
    'locks', 'hardDrops', 'clears', 'lines', 'quads', 'tspins', 'perfects', 'chainSteps', 'b2bSteps',
    'levelUps', 'gameOvers', 'mornings',
];
const emptyCounts = () => Object.fromEntries(COUNTERS.map((k) => [k, 0]));
/** Session scalars a rebuild in place carries over. */
const SNAPSHOT = Object.freeze([
    'time', 'level', 'combo', 'peak', 'b2b', 'duskFrom', 'duskTarget', 'duskAt', 'levelUpAt',
]);

/** Where a four-line tear aims: the sun's ray to this height over the gate (metres). */
const GATE_TEAR_HEIGHT = 1800;
/** The deck's drift (metres per second of clock): a constant wind aloft, from the west-south-west. */
const DECK_WIND = Object.freeze([9.5, 3.2]);
/**
 * The shafts before the fells: where each lands (degrees off the bearing to the gate, metres out),
 * how far and how fast it wanders, and its gap's radius (metres) and breathing rate.
 */
const RAY_LANDINGS = Object.freeze([
    Object.freeze({
        bearing: -9, distance: 4200, wander: 5, pace: 0.017, radius: 190, breathe: 0.037,
    }),
    Object.freeze({
        bearing: -2, distance: 6000, wander: 6, pace: 0.013, radius: 230, breathe: 0.029,
    }),
    Object.freeze({
        bearing: 6, distance: 7600, wander: 5, pace: 0.019, radius: 170, breathe: 0.041,
    }),
    Object.freeze({
        bearing: 13, distance: 5000, wander: 4, pace: 0.011, radius: 150, breathe: 0.033,
    }),
]);
/** The gusts in the grain travel along the wind at this speed (metres per second). */
const GUST_SPEED = 7.5;

/** Everything heavy a world needs before its scene objects: the land's mesh data. */
function* prepareSteps(quality) {
    const tier = tierFor(quality);
    const fan = yield* fanSteps(tier.fan.cols, tier.fan.rows);
    const trees = treeSites();
    yield 'trees';
    const { grain } = tier;
    const near = grainSites({
        count: grain.near, near: 2.5, far: grain.nearReach, knee: 7, seed: 0x6a7e,
    });
    yield 'grain-near';
    const far = grainSites({
        count: grain.far, near: grain.nearReach * 0.92, far: grain.farReach, seed: 0x6a7f,
    });
    return {
        quality, fan, trees, grain: { near, far },
    };
}

/**
 * Prepare, yielding to the page between slices (abortable): the land's layout, and the trees'
 * authored assets (loaded meanwhile). `loader`/`textureLoader` override three's (tests).
 */
async function prepareData(quality, { signal, loader, textureLoader } = {}) {
    const aborted = () => signal?.aborted === true;
    // A failed download costs the belts their trees (the land's canopy stands in), not the theme.
    const loading = loadGrainfieldsAssets({ loader, textureLoader, isCurrent: () => !aborted() })
        .catch((error) => {
            console.warn('[Grainfields] The trees could not be loaded; the belts stand as canopy.', error);
            return null;
        });
    const steps = prepareSteps(quality);
    let data;
    for (;;) {
        const next = steps.next();
        if (next.done) {
            data = next.value;
            break;
        }
        // eslint-disable-next-line no-await-in-loop
        await breathe();
        if (aborted()) break;
    }
    const assets = await loading;
    if (aborted()) {
        disposeGrainfieldsAssets(assets);
        throw new DOMException('Aborted', 'AbortError');
    }
    return { ...data, assets };
}

/** The same, synchronously (unit tests, the playground). */
function prepareDataSync(quality) {
    const steps = prepareSteps(quality);
    for (;;) {
        const next = steps.next();
        if (next.done) return next.value;
    }
}

export class GrainfieldsWorld {
    /** Lay the land out, yielding to the page between slices. */
    static prepare(quality = 'High', { signal } = {}) {
        return prepareData(quality, { signal });
    }

    /** The same, synchronously: the land only (`assets` may be added before the build). */
    static prepareSync(quality = 'High', assets = null) {
        return { ...prepareDataSync(quality), assets };
    }

    constructor({
        scene, quality = 'High', capture = false, prepared = null, samples = 0,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture === true;
        this.samples = samples;
        this.prepared = prepared;
        this.root = new THREE.Group();
        this.root.name = 'GrainfieldsWorld';
        this.parts = {};
        this.partList = [];
        this.disposed = false;
        this.reducedMotion = false;
        this.overrides = { hour: null };
        this.aspect = 16 / 9;
        this.viewportHeight = 1080;
        this.layout = fallbackLayout(1920, 1080);
        this.layoutLive = false;
        this._camera = null;
        this._ray = [0, 0, 0];
        this._aimV = new THREE.Vector3();
        this.reactions = new GrainfieldsReactions();
        this.fx = {
            breaking: 0, tear: 0, flare: 0, clearSky: 0, still: 0,
        };

        this.u = createUniforms();
        this.textures = null;
        this.wheel = new HourWheel();
        this._hourLight = createLight();
        this._duskLight = createLight();
        this.light = createLight();
        this._post = {
            exposure: 1, bloomBoost: 0, air: 1, flash: 0, flashColour: [1, 0.9, 0.75], saturation: 1.1,
        };
        this.resetState();
        lightAt(2, this._duskLight);
    }

    resetState() {
        this.time = 0;
        this.level = 1;
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.duskFrom = 0;
        this.duskTarget = 0;
        this.duskAt = -1e6;
        this.dusk = 0;
        this.levelUpAt = -1e6;
        this.breakShown = 0;
        this.counts = emptyCounts();
    }

    // ── Build ─────────────────────────────────────────────────────────────────────

    * buildSteps() {
        const prepared = this.prepared || prepareDataSync(this.quality);
        this.prepared = prepared;
        this.textures = { noise: createNoiseTexture() };
        this.writePath();
        const { u, textures: t, tier } = this;
        this.addPart('grain', createGrain(u, t, prepared.grain, { coverage: this.samples > 0 }));
        yield 'grain';
        this.addPart('land', createLand(u, t, tier, prepared));
        yield 'land';
        this.addPart('lapporten', createLapporten(u, t, tier));
        this.addPart('fort', createFort(u, t));
        yield 'lapporten';
        // The trees need their authored assets; without them the belts stand as the land's canopy.
        if (prepared.assets) {
            this.addPart('trees', createForest(u, t, prepared.assets, prepared.trees, tier, { coverage: this.samples > 0 }));
        }
        yield 'trees';

        // The herd needs its authored horse; without it the field is the barley's alone.
        const herd = createHerd(u, t, tier.herd, prepared.assets?.horse);
        if (herd) this.addPart('herd', herd);
        this.addPart('geese', createGeese(u, t, tier.birds));
        this.addPart('sky', createSky(u, t, tier));
        this.addPart('beams', createBeams(u, t, this.reactions));
        this.addPart('motes', createMotes(u, t, tier.motes));
        this.scene.add(this.root);
        return this;
    }

    build() {
        drainSteps(this.buildSteps());
        return this;
    }

    /** The path's centre line, for the shaders: (x, z, along, flowers' half-width). */
    writePath() {
        const rows = this.u.tables.path;
        let total = 0;
        const lengths = [0];
        for (let i = 1; i < PATH_POINTS.length; i++) {
            const [ax, az] = PATH_POINTS[i - 1];
            const [bx, bz] = PATH_POINTS[i];
            total += Math.hypot(bx - ax, bz - az);
            lengths.push(total);
        }
        PATH_POINTS.forEach(([x, z], i) => {
            const along = lengths[i] / total;
            rows[i].set(x, z, along, PATH.track + flowerWidth(along));
        });
    }

    addPart(name, part) {
        this.parts[name] = part;
        this.partList.push(part);
        const meshes = part.meshes || [part.mesh];
        for (const mesh of meshes) if (mesh) this.root.add(mesh);
    }

    showOnlyParts(names) {
        const keep = new Set(names);
        for (const name of Object.keys(this.parts)) {
            const part = this.parts[name];
            for (const mesh of part.meshes || [part.mesh]) if (mesh) mesh.visible = keep.has(name);
        }
    }

    bindCamera(camera) { this._camera = camera; }

    setReducedMotion(value) { this.reducedMotion = value === true; }

    setCaptureOverrides(overrides) { Object.assign(this.overrides, overrides); }

    /** The post marches the light in the air: the land then leaves the sunlit air to it. */
    setAirMarch(on) { this.u.airMarch.value = on ? 1 : 0; }

    setViewport(width, height, aspect) {
        if (aspect > 0) this.aspect = aspect;
        this.u.aspect.value = this.aspect;
        this.viewportHeight = Math.max(1, height);
        if (!this.layoutLive) this.layout = fallbackLayout(width, height);
    }

    setLayout(rects, aspect) {
        if (aspect > 0) this.aspect = aspect;
        this.layoutLive = Boolean(rects);
        this.layout = rects || fallbackLayout(1920, 1920 / Math.max(0.2, this.aspect));
    }

    // ── Camera ────────────────────────────────────────────────────────────────────

    /** The rest pose plus a slow breath of the lens and the pointer's parallax. */
    pose(camera, time, pointerX = 0, pointerY = 0) {
        const rig = rigFor(this.aspect);
        camera.aspect = this.aspect;
        camera.fov = rig.fov;
        camera.near = RIG.near;
        camera.far = RIG.far;
        camera.position.set(EYE.x, EYE.y, EYE.z);
        const move = this.reducedMotion ? 0 : 1;
        const yaw = rig.yaw + move * (Math.sin((TAU * time) / 83) * 0.3 + clamp(pointerX, -1, 1) * 0.7);
        const pitch = rig.pitch + move * (Math.sin((TAU * time) / 61) * 0.1 - clamp(pointerY, -1, 1) * 0.22);
        camera.rotation.set(pitch * DEG, -yaw * DEG, 0, 'YXZ');
        camera.updateProjectionMatrix();
        if (rig.shift) {
            // A vertical lens shift: the image moves up by `shift` in NDC (the horizon with it).
            camera.projectionMatrix.elements[9] = -rig.shift;
            camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        }
        camera.updateMatrixWorld();
    }

    restCamera(camera) {
        this.pose(camera, 0, 0, 0);
    }

    updateCamera(camera, sim) {
        this.time = Number.isFinite(sim.time) ? sim.time : this.time;
        this.pose(camera, this.time, sim.pointerX || 0, sim.pointerY || 0);
        // The shared breath on top of pose()'s drift (a view out over the land: it only turns).
        if (applyCameraBreath(camera, this.time, { scale: this.reducedMotion ? 0 : 1 })) camera.updateMatrixWorld();
        this._camera = camera;
    }

    // ── Gameplay (the event language: grainfields-reactions.js) ──────────────────

    /**
     * The ground point at `distance` metres along the screen column through (x, y) (screen
     * fractions, y down) as [x, ground y, z]: where an event aimed at that part of the frame lands.
     */
    aim(x, y, distance) {
        const cam = this._camera;
        let bearing;
        if (cam) {
            const v = this._aimV.set(x * 2 - 1, 1 - y * 2, 0.5).unproject(cam).sub(cam.position);
            bearing = Math.atan2(v.x, -v.z);
        } else {
            const rig = rigFor(this.aspect);
            const tanH = Math.tan(rig.fov * DEG * 0.5) * this.aspect;
            bearing = rig.yaw * DEG + Math.atan((x * 2 - 1) * tanH);
        }
        const gx = EYE.x + Math.sin(bearing) * distance;
        const gz = EYE.z - Math.cos(bearing) * distance;
        return [gx, groundHeight(gx, gz), gz];
    }

    deckState() {
        const d = this.u.drift.value;
        const s = this.u.sunDir.value;
        return { drift: [d.x, d.y], sunDir: [s.x, s.y, s.z] };
    }

    onLock(c) {
        this.counts.locks += 1;
        if (c?.hardDrop) this.counts.hardDrops += 1;
        const aim = (x, y, d) => this.aim(x, y, d);
        const gap = this.reactions.lock(c, this.time, { layout: this.layout, aim, deck: this.deckState() });
        if (gap && !this.reducedMotion) {
            // Pigment dust of the piece's colour lifts through the beam.
            this.parts.motes?.burst({
                x: gap.footX,
                y: gap.footY + 0.4,
                z: gap.footZ,
                count: gap.hard ? 48 : 28,
                spread: gap.radius * 0.7,
                up: gap.hard ? 1.6 : 1.1,
                out: 0.3,
                rgb: gap.rgb,
                life: 7,
                size: 0.016,
                time: this.time,
            });
        }
    }

    onClear(c) {
        const lines = Math.max(1, Math.min(4, Math.round(Number(c?.lines) || 1)));
        this.counts.clears += 1;
        this.counts.lines += lines;
        if (lines >= 4) this.counts.quads += 1;
        if (c?.tspin) this.counts.tspins += 1;
        if (c?.perfect) this.counts.perfects += 1;
        const before = this.reactions.trails.length;
        const aim = (x, y, d) => this.aim(x, y, d);
        this.reactions.clear({ ...c, palette: PIECE_LINEAR }, this.time, { layout: this.layout, aim });
        if (lines >= 4) {
            // The tear: where the sun's ray to the gate meets the deck, fixed to the deck as it is now.
            const deck = this.deckState();
            const lift = Math.max(0, DECK.base - GATE_TEAR_HEIGHT) / Math.max(0.035, deck.sunDir[1]);
            this.reactions.tearX = PLACES.gate.x + deck.sunDir[0] * lift + deck.drift[0];
            this.reactions.tearZ = PLACES.gate.z + deck.sunDir[2] * lift + deck.drift[1];
        }
        if (this.reducedMotion) return;
        // A T-spin wheels the herd round, and its whirl lifts a spinning column of chaff.
        if (c?.tspin) this.parts.herd?.wheel(this.time);
        const whirl = this.reactions.pulses[this.reactions.pulses.length - 1];
        if (c?.tspin && whirl?.kind === 1) {
            this.parts.motes?.burst({
                x: whirl.x,
                y: groundHeight(whirl.x, whirl.z) + 0.3,
                z: whirl.z,
                count: 110,
                spread: 4,
                up: 2.4,
                out: 0.15,
                rgb: [1, 0.82, 0.45],
                life: 6,
                size: 0.014,
                time: this.time,
            });
        }
        // Chaff of the rows' colours thrown up where each new lane starts.
        this.reactions.trails.slice(before).forEach((tr) => {
            for (let k = 0; k < 3; k++) {
                this.parts.motes?.burst({
                    x: tr.x + tr.hx * (8 + k * 9),
                    y: groundHeight(tr.x, tr.z) + 0.7,
                    z: tr.z + tr.hz * (8 + k * 9),
                    count: 10 + lines * 4,
                    spread: 3,
                    up: 0.5,
                    out: 0.9,
                    rgb: tr.rgb,
                    life: 5,
                    size: 0.012,
                    time: tr.at + k * 0.25,
                });
            }
        });
    }

    onCombo(n) {
        const next = Math.max(0, Math.round(Number(n) || 0));
        if (next >= 2 && next > this.combo) this.counts.chainSteps += 1;
        // The storm breaking open at a chain of three sets the horses running.
        if (next >= 3 && this.combo < 3 && !this.reducedMotion) this.parts.herd?.run(this.time);
        this.combo = next;
        this.peak = Math.max(this.peak, next);
        this.reactions.setCombo(next, this.time);
    }

    onB2B(level) {
        const next = Math.max(0, Math.round(Number(level) || 0));
        if (next > this.b2b) this.counts.b2bSteps += 1;
        this.b2b = next;
        this.reactions.setB2B(next);
    }

    levelUp(level, { silent = false, time = this.time } = {}) {
        const n = Math.max(1, Math.round(Number(level) || 1));
        if (n > this.level && !silent) {
            this.counts.levelUps += 1;
            this.levelUpAt = time;
            if (!this.reducedMotion) {
                this.reactions.levelUp(time);
                // A skein of geese lifts off the field and flies out through the gate.
                this.u.skein.value = time;
            }
        }
        this.wheel.levelUp(n, time, silent || this.reducedMotion);
        this.level = n;
    }

    onGameOver() {
        this.counts.gameOvers += 1;
        this.duskFrom = this.dusk;
        this.duskTarget = 1;
        this.duskAt = this.time;
    }

    onSessionStart() {
        if (this.duskTarget > 0) {
            this.counts.mornings += 1;
            this.duskFrom = this.dusk;
            this.duskTarget = 0;
            this.duskAt = this.time;
        }
    }

    resetSession() {
        this.reactions.setCombo(0, this.time);
        this.reactions.setB2B(0);
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.level = 1;
        this.wheel.newRun();
    }

    /** Jump the clock (captures): everything in flight is dropped, the light stands where the clock puts it. */
    seek(time) {
        const t = Math.max(0, Number(time) || 0);
        this.resetState();
        this.wheel.reset();
        this.reactions.reset();
        this.parts.motes?.reset();
        this.parts.herd?.reset();
        this.u.skein.value = -1e6;
        this.time = t;
    }

    // ── Frame ─────────────────────────────────────────────────────────────────────

    update(sim, camera = this._camera) {
        if (this.disposed) return;
        this.time = Number.isFinite(sim.time) ? sim.time : this.time;
        const { time, u } = this;
        const dt = Math.max(0, Math.min(0.25, sim.delta || 0));
        // Dusk at game over, morning after.
        this.dusk = this.duskFrom + (this.duskTarget - this.duskFrom)
            * smooth(0, this.duskTarget ? TIMING.dusk : TIMING.dawn, time - this.duskAt);
        // The light of the hour.
        const place = this.overrides.hour !== null ? this.overrides.hour : this.wheel.place(time);
        lightAt(place, this._hourLight);
        const L = this.dusk > 0.001
            ? blendLight(this._hourLight, this._duskLight, this.dusk * 0.85, this.light)
            : copyLight(this._hourLight, this.light);
        u.sunDir.value.set(L.dir[0], L.dir[1], L.dir[2]);
        u.sunUp.value = L.sunUp;
        u.day.value = L.day;
        u.sun.value.set(L.sun[0], L.sun[1], L.sun[2]);
        u.fill.value.set(L.fill[0], L.fill[1], L.fill[2]);
        u.bounce.value.set(L.bounce[0], L.bounce[1], L.bounce[2]);
        u.zenith.value.set(L.zenith[0], L.zenith[1], L.zenith[2]);
        u.horizon.value.set(L.horizon[0], L.horizon[1], L.horizon[2]);
        u.glow.value.set(L.glow[0], L.glow[1], L.glow[2]);
        u.haze.value.set(L.haze[0], L.haze[1], L.haze[2]);
        u.mist.value.set(L.mist[0], L.mist[1], L.mist[2]);
        u.cloudLit.value.set(L.cloudLit[0], L.cloudLit[1], L.cloudLit[2]);
        u.cloudShade.value.set(L.cloudShade[0], L.cloudShade[1], L.cloudShade[2]);
        u.hazeDensity.value = L.hazeDensity;
        u.mistDensity.value = L.mistDensity;
        u.stars.value = L.stars;
        u.dusk.value = this.dusk;
        u.time.value = time;
        // A chain breaks the deck into clouds with clear sky between them (real gaps, so the shafts
        // stand apart), not a thinner veil over everything.
        u.cover.value = clamp(L.cover + this.dusk * 0.25 - 0.5 * this.reactions.breaking(time), 0.05, 0.97);
        u.deckLo.value.set(deckThreshold(u.cover.value), deckThreshold(0.975));
        // The events: gaps, trails, pulses, the storm's break, the tear, the flare, a clear sky.
        const fx = this.reactions.writeUniforms(u, time);
        this.fx = fx;
        this.breakShown = fx.breaking;
        u.windStrength.value = L.wind * (1 + 0.55 * fx.breaking + 0.06 * this.reactions.b2b) * (1 - 0.85 * fx.still);
        // The deck drifts and the gusts run with constant speeds (closed form: the clock times a
        // constant; their strength, not their speed, follows the hour).
        u.drift.value.set(time * DECK_WIND[0], time * DECK_WIND[1]);
        u.gust.value = time * GUST_SPEED;
        // The sun's own gap: held on the eye's line to the sun, so the sun is seen through the deck
        // at the storm break and the fields round the eye stand in its light.
        const sy = Math.max(0.035, L.dir[1]);
        const lift = (DECK.base - EYE.y) / sy;
        // Small: the eye stands in the sun, but the air beyond a kilometre or so toward the sun is in
        // the deck's shade, so the shafts of the other gaps stand out against it.
        const wanderX = 70 * Math.sin(time * 0.023 + 0.4) + 30 * Math.sin(time * 0.061);
        const wanderZ = 60 * Math.sin(time * 0.017 + 1.9) + 25 * Math.sin(time * 0.047 + 0.8);
        u.sunGap.value.set(
            EYE.x + L.dir[0] * lift + wanderX,
            EYE.z + L.dir[2] * lift + wanderZ,
            600 + 90 * Math.sin(time * 0.021),
            1,
        );
        // The storm's core lies out along the sun's bearing while the deck is heavy (the storm break):
        // the fells and the middle distance in its shade, the sun looking through its own gap.
        const flat = Math.hypot(L.dir[0], L.dir[2]) || 1;
        u.stormCore.value.set(
            EYE.x + (L.dir[0] / flat) * 11500,
            EYE.z + (L.dir[2] / flat) * 11500,
            9500,
            smooth(0.58, 0.78, L.cover) * (1 - this.breakShown),
        );
        // Gaps whose shafts stand in the air in front of the fells: each lands on the land at its
        // foot, kilometres out, and wanders across it; seen from the eye its column of lit air rises
        // toward the sun past the mountain's dark face. Strongest while the deck is heavy: the hole
        // is where the sun's ray through the landing point meets the deck.
        const heavy = smooth(0.5, 0.72, L.cover) * (1 - this.dusk);
        RAY_LANDINGS.forEach((landing, k) => {
            const at = this.rayLanding(time, k, this._ray);
            const liftK = Math.max(0, DECK.base - at[1]) / sy;
            const radius = landing.radius * (1 + 0.28 * Math.sin(time * landing.breathe + k * 1.7));
            u.tables.rays[k].set(at[0] + L.dir[0] * liftK, at[2] + L.dir[2] * liftK, radius, heavy);
        });

        if (camera) {
            camera.updateMatrixWorld();
            u.eye.value.copy(camera.position);
            u.camRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
            u.camUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
            u.camFwd.value.setFromMatrixColumn(camera.matrixWorld, 2).negate();
            u.tanHalfFov.value = Math.tan(camera.fov * DEG * 0.5);
            u.pixelAngle.value = (2 * u.tanHalfFov.value) / Math.max(1, this.viewportHeight || 1080);
        }
        this.updatePost(dt);
        for (const part of this.partList) part.update?.(time, dt, this);
    }

    /**
     * Where shaft `k` lands (world x, y, z): on the land in front of the fells (see
     * RAY_LANDINGS), each wandering slowly across the bearings the mountain fills.
     */
    rayLanding(time, k, out) {
        const V = PLACES.gate;
        const R = RAY_LANDINGS[k];
        const toward = Math.atan2(V.x - EYE.x, -(V.z - EYE.z)) / DEG;
        const bearing = toward + R.bearing + R.wander * Math.sin(time * R.pace + k * 2.1);
        const distance = R.distance + 800 * Math.sin(time * 0.011 + k);
        out[0] = EYE.x + Math.sin(bearing * DEG) * distance;
        out[2] = EYE.z - Math.cos(bearing * DEG) * distance;
        out[1] = Math.max(groundHeight(out[0], out[2]), gateHeight(out[0], out[2]));
        return out;
    }

    updatePost() {
        const post = this._post;
        const L = this.light;
        const { fx } = this;
        // A chain's break lifts the light; four lines flare; a perfect clear's sky is the clearest.
        post.exposure = L.exposure * (1 + 0.05 * fx.breaking + 0.08 * fx.flare);
        post.saturation = 1.12 + 0.06 * fx.breaking;
        // A clear sky lights all the air at once: hold the veil back so the gate stays crisp.
        post.air = (1 + 0.1 * fx.breaking + 0.2 * fx.tear) * (1 - 0.6 * fx.clearSky);
        post.bloomBoost = 0.25 * fx.breaking + 0.7 * fx.flare;
        post.flash = 0.45 * fx.flare;
        post.flashColour = L.glow;
    }

    /** GPU work that must precede the frame (none: the deck's shadow is read in the shaders). */
    prerender() {}

    getPostState() { return this._post; }

    getState() {
        return {
            quality: this.quality,
            time: this.time,
            level: this.level,
            hour: {
                place: this.light.place,
                from: this.light.from,
                to: this.light.to,
                mix: this.light.mix,
                az: this.light.az,
                el: this.light.el,
                name: HOURS[this.light.from].name,
                of: this.light.hour,
                day: this.light.day,
                sunUp: this.light.sunUp,
                cover: this.u.cover.value,
            },
            counts: { ...this.counts },
            combo: this.combo,
            peak: this.peak,
            b2b: this.b2b,
            dusk: this.dusk,
            reducedMotion: this.reducedMotion,
            sceneChildren: this.root.children.length,
            parts: Object.keys(this.parts),
        };
    }

    exportSessionState() {
        const scalars = {};
        for (const key of SNAPSHOT) scalars[key] = this[key];
        return { scalars, wheel: this.wheel.exportState(), counts: { ...this.counts } };
    }

    importSessionState(state) {
        if (!state?.scalars) return;
        for (const key of SNAPSHOT) if (state.scalars[key] !== undefined) this[key] = state.scalars[key];
        this.wheel.importState(state.wheel);
        this.counts = { ...emptyCounts(), ...state.counts };
        // The reactions draw the chain and the run: carry them over already eased in.
        this.reactions.setCombo(this.combo, -1e6);
        this.reactions.setB2B(this.b2b);
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.root.removeFromParent();
        for (const part of this.partList) part.dispose();
        this.textures?.noise?.dispose();
        disposeGrainfieldsAssets(this.prepared?.assets);
        this.root.clear();
        this.partList.length = 0;
    }
}

export { pathDistance };
