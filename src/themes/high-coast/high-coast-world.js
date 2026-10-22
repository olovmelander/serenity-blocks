/**
 * High Coast — one shared world (the theme and the playground mount the same one).
 *
 * The coast seen from a granite summit: the baked land and sea floor (three nested fields) under
 * the hour's light, the sea, the sky with its cumulus, the pine forests, the old pine and the
 * trail sign, the fishing hamlet, the sailing fleet, and everything gameplay does to them:
 *
 *   lock        a gust (a cat's paw) runs out across the water from beside the card, and a boat on
 *               that side sets a spinnaker in the piece's colour (a hard drop: a wider, faster gust
 *               and a splash); a sail already flying fills again and turns toward the new colour
 *   clear       the land rises: the sea draws back from every shore, wet rock and skerries come up
 *               out of it, seawater runs off the risen rock, and the bare band dries in the sun
 *   cascade     each wave lifts further than the last, the wet rock gleams brighter, the sea bursts
 *               off more shores
 *   chain       the rise compounds (each link lifts more, up toward the coast's ceiling); when the
 *               chain breaks, a swell runs in from the open sea and the sea returns
 *   four lines  the great rebound: a big lift at once, the risen rock flaring gold, spray off every
 *               shore in the colours of the rows it cleared
 *   T-spin      the fleet comes about, every sail swinging through the light together (a T-spin that
 *               clears nothing too)
 *   b2b         the lighthouse lights and sweeps while the run lasts; each back-to-back clear its
 *               long flash, the rock flaring in it
 *   perfect     the crown: the wind dies, the sea lies glass-calm with the risen coast mirrored and
 *               the lighthouse burning, until the breeze line returns from the horizon
 *   level up    the day steps an hour forward (it also turns with the clock alone)
 *   game over   dusk falls and the sea returns; morning comes back with the next run
 *
 * Every answer ACCUMULATES (shared/swell.js): a second event adds to what is still lit and never
 * restarts it. And the coast builds with the pace of play (shared/gameplay-surge.js): warm, the
 * wind freshens and the air begins to clear; hot, the gusts run long in the pieces' colours, the
 * whole fleet sets its sails and the gulls come in over the bay; in a fever the sky catches fire
 * (the deck gathers and burns rose and copper over a deepening blue), the air stands crystal clear
 * to the horizon and the wet risen rock gleams gold in its pools. When the hands rest the coast
 * breathes back to its hour within seconds. Reduced motion calms the spray, the gusts, the gulls,
 * the fleet's swing and the surge's wind as well as the camera.
 *
 * Lifecycle: `await HighCoastWorld.prepare(quality, { signal })` reads the baked fields and builds
 * the land's mesh in slices; `new HighCoastWorld({ ..., prepared }).build()` makes the scene
 * objects; each frame `updateCamera` → `update` → `prerender(renderer)` → the post renders.
 */
import * as THREE from 'three/webgpu';
import { applyCameraBreath } from '../shared/camera-breath.js';
import {
    DEG, EYE, FIELDS, FIELD_ORDER, PIECE_COLORS, RIG, TAU, TIMING, UPLIFT, approach, clamp, hexToLinear, liftAfter,
    frameYaw, mulberry32, relaxLift, rigFor, smooth, upliftStep,
} from './high-coast-core.js';
import {
    HOURS, HourWheel, blendLight, copyLight, createLight, lightAt,
} from './high-coast-hours.js';
import { tierFor } from './high-coast-quality.js';
import { breathe, loadCoast, planCoast } from './high-coast-assets.js';
import {
    GUSTS, createCoverTexture, createFieldTexture, createLatticeTexture, createNoiseTexture, createUniforms,
    fieldTextureData,
} from './high-coast-tsl.js';
import { groundHeight } from './high-coast-field.js';
import { createFanGeometry, createLandMaterial, fanPositionSteps } from './high-coast-land.js';
import { createSea } from './high-coast-sea.js';
import { createShadowPass } from './high-coast-shadow.js';
import { createSky } from './high-coast-sky.js';
import { createCumulus } from './high-coast-cumulus.js';
import { createForest } from './high-coast-forest.js';
import { createProps } from './high-coast-props.js';
import { createHamlet } from './high-coast-hamlet.js';
import { createFleet } from './high-coast-fleet.js';
import { MOTE_KIND, Motes } from './high-coast-motes.js';
import { createLife } from './high-coast-life.js';
import { cardUnion, fallbackLayout } from './high-coast-composition.js';
import { drainSteps } from '../shared/build-steps.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';

export const HIGH_COAST_PARTS = Object.freeze(['land', 'sea', 'sky', 'cumulus', 'forest', 'props', 'hamlet', 'fleet', 'life', 'motes']);
export const REST_RIG = Object.freeze({ near: RIG.near, far: RIG.far });
export const fovForAspect = (aspect) => rigFor(aspect).fov;

const COUNTERS = [
    'locks', 'hardDrops', 'clears', 'lines', 'quads', 'tspins', 'spins', 'perfects', 'chainSteps', 'releases',
    'b2bSteps', 'waves', 'levelUps', 'gameOvers', 'mornings',
];
const emptyCounts = () => Object.fromEntries(COUNTERS.map((k) => [k, 0]));
/** Session scalars a rebuild in place carries over. */
const SNAPSHOT = Object.freeze([
    'time', 'level', 'combo', 'peak', 'b2b', 'liftAsk', 'liftShown', 'wetLine', 'releaseAt',
    'swellAt', 'perfectAt', 'calmFrontFrom', 'calmFrontAt', 'duskFrom', 'duskTarget', 'duskAt', 'beaconLevel',
    'beaconShown', 'lastLockAt', 'levelUpAt', 'gustCursor', 'breezeShown', 'windDrift',
]);
/** Accumulating envelopes a rebuild in place carries over (each a Swell: exportState/importState). */
const SWELLS = Object.freeze(['drainSwell', 'reboundSwell', 'flashSwell', 'seaSwell', 'signal']);

/**
 * Event reactions under reduced motion: spray, gusts, the gulls' startle, the fleet's swing and
 * the wind the surge raises move this much (the camera's drift and breath stop altogether).
 */
const CALM_MOTION = 0.4;
/** The calm of a perfect clear rises over this long (seconds). */
const CALM_RISE = 1.4;
/** The inverse of smooth(0, 1, x) on [0, 1]: where a smoothstep reads `v`. */
const unsmooth = (v) => 0.5 - Math.sin(Math.asin(1 - 2 * clamp(v, 0, 1)) / 3);

/** Everything heavy a world needs once the fields are read: the mesh and the field textures. */
function* prepareSteps(quality, fields) {
    const tier = tierFor(quality);
    const positions = yield* fanPositionSteps(fields, tier.fanCols, tier.fanRows);
    const textures = {};
    for (const name of FIELD_ORDER) {
        textures[name] = fieldTextureData(fields[name].heights, fields[name].sky, FIELDS[name]);
        yield name;
    }
    return {
        quality, fields, positions, textures, source: fields.source,
    };
}

/** Read the baked coast and prepare it, yielding to the page between slices (abortable). */
async function prepareData(quality, { signal } = {}) {
    const fields = await loadCoast({ signal });
    const steps = prepareSteps(quality, fields);
    for (;;) {
        const next = steps.next();
        if (next.done) return next.value;
        // eslint-disable-next-line no-await-in-loop
        await breathe();
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    }
}

/** The same from the plan, synchronously (unit tests; no network). */
function prepareDataSync(quality, fields = planCoast()) {
    const steps = prepareSteps(quality, fields);
    for (;;) {
        const next = steps.next();
        if (next.done) return next.value;
    }
}

const PIECE_LINEAR = PIECE_COLORS.map((c) => hexToLinear(c));

/**
 * An event's water sites (waterSite: up to 28 marches over the land each) run a few per frame:
 * a big clear asked for up to 72 at once and held its frame 30–60 ms (play-feel probe at 120 fps,
 * 2026-10-15). A frame serves queued sites until its marches have read the land SITE_WORK times
 * (under a millisecond; at least one site a frame). The work is counted, not timed, so a seek
 * replays the same spray and mist. A site still queued SITE_STALE seconds after its event is
 * dropped: its mist would rise too late.
 */
const SITE_WORK = 4000;
const SITE_STALE = 1;

export class HighCoastWorld {
    /** Read the baked coast and build the mesh data, yielding to the page between slices. */
    static prepare(quality = 'High', { signal } = {}) {
        return prepareData(quality, { signal });
    }

    /** The same, synchronously, from the plan or given fields (unit tests; no network). */
    static prepareSync(quality = 'High', fields = undefined) {
        return prepareDataSync(quality, fields);
    }

    constructor({
        scene, quality = 'High', capture = false, seed = 0x40ea, prepared = null, samples = 0,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture;
        this.seed = seed;
        this.prepared = prepared;
        /** The scene pass's MSAA samples (shared/scene-antialias.js): above 1, the pine's needles use coverage. */
        this.samples = samples;
        this.root = new THREE.Group();
        this.root.name = 'High Coast';
        this.parts = {};
        this.partList = [];
        this.u = createUniforms();
        this.wheel = new HourWheel();
        this.light = createLight();
        this._hourLight = createLight();
        this._duskLight = lightAt(2);
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1920, 1080);
        this.layoutLive = false;
        this.reducedMotion = false;
        this.disposed = false;
        this._camera = null;
        this._sunScreen = new THREE.Vector3();
        this._sunWorld = new THREE.Vector3();
        this._ray = new THREE.Vector3();
        this._hit = {
            x: 0, y: 0, z: 0, distance: 0, water: false,
        };
        this._rgb = [0, 0, 0];
        this._post = {
            exposure: 1,
            bloomBoost: 0,
            sun: {
                x: 0.8, y: 0.2, onScreen: 0, strength: 0,
            },
            shaftColour: [1, 0.8, 0.6],
            flash: 0,
            flashColour: [1, 0.9, 0.75],
            saturation: 1.08,
        };
        this.overrides = { hour: null };
        this.random = mulberry32(seed ^ 0x51ab);
        // Every reaction that used to restart a single slot ACCUMULATES (shared/swell.js): a second
        // event adds to what is still lit and never cuts it.
        /** The sea running off newly risen rock: each clear feeds the run-off still streaming. */
        this.drainSwell = new Swell({
            attack: 0.12, release: 1.8, ceiling: 1, knee: 0.75,
        });
        /** The great rebound's gold flare on the wet rock: a second quad feeds the flare still burning. */
        this.reboundSwell = new Swell({
            attack: 0.15, release: 1.6, ceiling: 1.6, knee: 1,
        });
        /** The post's flash (a quad, the crown): small, in the hour's glow. */
        this.flashSwell = new Swell({ release: 0.45, ceiling: 0.3, knee: 0.2 });
        /** A released chain's swell from the open sea: a second release feeds the one running in. */
        this.seaSwell = new Swell({
            attack: 0.9, release: 5, ceiling: 1.2, knee: 0.9,
        });
        /** The lighthouse's long flash: a level-up, a back-to-back clear, the crown. */
        this.signal = new Swell({
            attack: 0.25, release: 0.5, ceiling: 1.3, knee: 1,
        });
        /**
         * How hot play runs (shared/gameplay-surge.js): the air clears, the wind freshens, the risen
         * rock gleams gold, the fleet flies every colour and the gulls come in over the bay.
         */
        this.surge = new GameplaySurge();
        /** The surge as of the last frame (events and the parts read it). */
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        /** Site jobs that waited past SITE_STALE: their share rises with the next ones served. */
        this.siteCarry = { mist: 0, spray: 0 };
        this.resetState(0);
    }

    resetState(time) {
        this.time = time;
        this.level = 1;
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.counts = emptyCounts();
        this.wheel.reset();
        this.liftAsk = 0;
        this.liftShown = 0;
        this.wetLine = 0;
        this.releaseAt = -1e6;
        this.swellAt = -1e6;
        this.perfectAt = -1e6;
        this.calmFrontFrom = 0;
        this.calmFrontAt = -1e6;
        this.breezeShown = 1;
        this.windDrift = 0;
        for (const key of SWELLS) this[key].reset();
        this.surge.reset();
        this.heat.punch = 0;
        this.heat.level = 0;
        this.heat.fever = 0;
        this.heat.stage = 0;
        this.signalShown = 0;
        this.siteCarry.mist = 0;
        this.siteCarry.spray = 0;
        this.duskFrom = 0;
        this.duskTarget = 0;
        this.duskAt = -1e6;
        this.dusk = 0;
        this.beaconLevel = 0;
        this.beaconShown = 0;
        this.lastLockAt = -1e6;
        this.levelUpAt = -1e6;
        this.gustCursor = 0;
        for (const row of this.u.tables.gusts) row.set(0, 0, -1e6, 0);
        this.siteQueue = [];
        this.marchWork = 0;
        // A seek replays from scratch: the same draws, the same spray, the gulls back on their rounds.
        this.random = mulberry32(this.seed ^ 0x51ab);
        this.parts?.fleet?.reset?.();
        this.parts?.motes?.reset?.();
        this.parts?.life?.reset?.();
    }

    build() {
        drainSteps(this.buildSteps());
        return this;
    }

    /**
     * The build as steps, a part to a step: run at once by build(), or with a breath between steps
     * while the theme comes in (shared/build-steps.js), so no single task holds the page for the
     * whole build (the pine and the props alone were 0.18 s). The same parts in the same order.
     */
    * buildSteps() {
        if (this.root.parent) return;
        const prepared = this.prepared || HighCoastWorld.prepareSync(this.quality);
        this.prepared = null;
        this.source = prepared.source;
        const { tier } = this;
        const fieldTex = {};
        const coverTex = {};
        for (const name of FIELD_ORDER) {
            fieldTex[name] = createFieldTexture(prepared.textures[name], FIELDS[name]);
            coverTex[name] = createCoverTexture(prepared.fields[name].flow, FIELDS[name]);
        }
        this.fields = prepared.fields;
        this.textures = {
            fields: fieldTex,
            cover: coverTex,
            noise: createNoiseTexture(),
            lattice: createLatticeTexture(),
        };
        this.shadowPass = createShadowPass(this.u, fieldTex, tier);
        this.textures.shadow = this.shadowPass.textures;

        const geometry = createFanGeometry(prepared.positions, tier.fanCols, tier.fanRows);
        const material = createLandMaterial(this.u, this.textures, tier);
        const land = new THREE.Mesh(geometry, material);
        land.name = 'HighCoastLand';
        land.frustumCulled = false;
        land.renderOrder = 0;
        this.addPart('land', {
            mesh: land,
            dispose() {
                geometry.dispose();
                material.dispose();
            },
        });
        yield 'land';
        this.addPart('sea', createSea(this.u, this.textures, tier));
        yield 'sea';
        this.addPart('forest', createForest(this.u, this.textures, tier, this.fields));
        yield 'forest';
        this.addPart('props', createProps(this.u, this.textures, tier, this.fields, { coverage: this.samples > 1 }));
        yield 'props';
        this.addPart('hamlet', createHamlet(this.u, this.textures, tier, this.fields));
        yield 'hamlet';
        this.addPart('fleet', createFleet(this.u, this.textures, tier));
        yield 'fleet';
        this.addPart('life', createLife(this.u, this.textures, tier, this.parts.hamlet.lantern));
        yield 'life';
        this.motes = new Motes(this.u, tier.motes);
        this.addPart('motes', {
            mesh: this.motes.mesh,
            reset: () => this.motes.clear(),
            dispose: () => this.motes.dispose(),
        });
        this.addPart('sky', createSky(this.u, this.textures, tier));
        yield 'sky';
        this.addPart('cumulus', createCumulus(this.u, this.textures, tier, tier.banks));
        this.scene.add(this.root);
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

    /** The rest pose plus a slow breath of the lens and the pointer's parallax. */
    pose(camera, time, pointerX = 0, pointerY = 0) {
        const rig = rigFor(this.aspect);
        camera.aspect = this.aspect;
        camera.fov = rig.fov;
        camera.near = RIG.near;
        camera.far = RIG.far;
        camera.position.set(EYE.x, EYE.y, EYE.z);
        const move = this.reducedMotion ? 0 : 1;
        const yaw = frameYaw(rig, this.aspect) + move * (Math.sin((TAU * time) / 83) * 0.3 + clamp(pointerX, -1, 1) * 0.7);
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
        // The shared breath (shared/camera-breath.js) on top of pose()'s drift (not in pose(),
        // which is also the rest framing): a view out to sea, so it only turns. Off under
        // reduced motion.
        if (applyCameraBreath(camera, this.time, { scale: this.reducedMotion ? 0 : 1 })) camera.updateMatrixWorld();
        // The summit heaves with the land: every event nods the view down a touch (the surge's
        // punch, so rapid locks ride on a floor instead of jittering). Off under reduced motion.
        const heave = this.reducedMotion ? 0 : this.heat.punch * 0.3;
        if (heave > 1e-4) {
            camera.rotateX(-heave * DEG);
            camera.updateMatrixWorld();
        }
        this._camera = camera;
    }

    // ── Where on the water an event happens ───────────────────────────────────────

    /**
     * The first surface under a screen point (fractions, y down): land or water, by marching the
     * camera's ray against the land and the sea's level. Ground nearer than `near` metres (the
     * summit the eye stands on) is passed through.
     */
    surfaceAt(sx, sy, out = this._hit, near = 0.5) {
        const camera = this._camera;
        if (!camera || !this.fields) return null;
        camera.updateMatrixWorld();
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        const o = camera.position;
        const d = this._ray;
        if (d.y > -0.002) return null;
        const sea = -this.liftShown;
        let prev = near;
        for (let t = near; t < 12000; t += Math.max(1.5, t * 0.012)) {
            const x = o.x + d.x * t;
            const z = o.z + d.z * t;
            const y = o.y + d.y * t;
            const ground = groundHeight(this.fields, x, z);
            this.marchWork++;
            if (y < Math.max(ground, sea)) {
                this.marchWork += 13;
                let a = prev;
                let b = t;
                for (let k = 0; k < 12; k++) {
                    const m = (a + b) / 2;
                    const gm = groundHeight(this.fields, o.x + d.x * m, o.z + d.z * m);
                    if (o.y + d.y * m < Math.max(gm, sea)) b = m;
                    else a = m;
                }
                out.x = o.x + d.x * b;
                out.z = o.z + d.z * b;
                const g = groundHeight(this.fields, out.x, out.z);
                out.water = g < sea - 0.3;
                out.y = Math.max(g, sea);
                out.distance = b;
                return out;
            }
            prev = t;
        }
        return null;
    }

    /**
     * The screen point an event at board column `u` and row `row` starts from: the visible water
     * on that side of the card (column 0 far left … column 1 far right), the floor rows nearest.
     */
    sitePoint(u = 0.5, row = 14) {
        const card = cardUnion(this.layout) || {
            x0: 0.41, x1: 0.59, y0: 0.08, y1: 0.93,
        };
        const f = clamp(row, 0, 19) / 19;
        if (this.aspect < 0.75) {
            const top = Math.min(0.94, card.y1 + 0.02);
            return { x: 0.08 + clamp(u, 0, 1) * 0.84, y: top + (0.985 - top) * (0.3 + 0.7 * f) };
        }
        const { hud } = this.layout;
        let lo;
        let hi;
        let k;
        if (u < 0.5) {
            lo = 0.2;
            hi = card.x0 - 0.03;
            k = u / 0.5;
        } else {
            lo = card.x1 + 0.03;
            hi = 0.95;
            if (hud && hud.x0 > card.x1 && hud.x1 < hi) {
                if (0.95 - hud.x1 > hud.x0 - lo) lo = hud.x1 + 0.02;
                else hi = hud.x0 - 0.02;
            }
            k = (u - 0.5) / 0.5;
        }
        return { x: lo + (hi - lo) * clamp(k, 0, 1), y: 0.5 + 0.3 * f };
    }

    /**
     * A water point for an event: the visible water nearest the site on the screen, searching up
     * toward the horizon and down toward the foot of the frame in turn (near rock hides water).
     */
    waterSite(u, row) {
        const p = this.sitePoint(u, row);
        for (let k = 0; k < 28; k++) {
            const step = Math.ceil(k / 2) * 0.022 * (k % 2 ? -1 : 1);
            const sy = Math.min(0.97, Math.max(0.32, p.y + step));
            const hit = this.surfaceAt(p.x, sy);
            if (hit?.water) return hit;
        }
        return null;
    }

    /**
     * Serve the queued water sites (drainMist, reboundSpray) until this frame's marches have read
     * the land SITE_WORK times: the rebound's spray first, then the mist, oldest first.
     */
    serveSites() {
        const queue = this.siteQueue;
        if (!queue.length) return;
        const until = this.marchWork + SITE_WORK;
        const carry = this.siteCarry;
        let served = 0;
        while (served < queue.length) {
            const job = queue[served++];
            if (this.time - job.at > SITE_STALE) {
                // Too late to rise where it was asked: its share joins the next breath or burst served
                // (rapid clears thicken the mist instead of losing it).
                if (job.k >= 0) carry.spray = Math.min(80, carry.spray + job.n);
                else carry.mist = Math.min(24, carry.mist + 1);
                continue;
            }
            if (job.k >= 0) {
                const extra = Math.min(carry.spray, job.n);
                carry.spray -= extra;
                this.sprayFrom(job.at, job.k, job.n + extra, job.palette);
            } else {
                const extra = Math.min(carry.mist, 3);
                carry.mist -= extra;
                this.mistFrom(job.at, 1 + extra);
            }
            if (this.marchWork >= until) break;
        }
        queue.splice(0, served);
    }

    pigment(color, out = this._rgb) {
        hexToLinear(typeof color === 'string' ? color : PIECE_COLORS[0], out);
        return out;
    }

    /**
     * Send a gust (cat's paw) across the water from a point, along a heading. `hold` (0..1) is how
     * much of the piece's colour its glitter keeps as it runs (hot play: the bay sparkles in the
     * colours played instead of turning sun-white).
     */
    gust(p, heading, {
        power = 1, speed = 22, width = 40, rgb = [1, 1, 1], hold = 0,
    } = {}) {
        const slot = this.gustCursor % GUSTS;
        this.gustCursor = (this.gustCursor + 1) % (GUSTS * 1000);
        const len = Math.hypot(heading[0], heading[1]) || 1;
        const scale = clamp(p.distance / 700, 0.6, 4);
        this.u.tables.gusts[slot * 3].set(p.x, p.z, this.time, power);
        this.u.tables.gusts[slot * 3 + 1].set(heading[0] / len, heading[1] / len, speed * scale, width * scale);
        this.u.tables.gusts[slot * 3 + 2].set(rgb[0], rgb[1], rgb[2], clamp(hold, 0, 1));
    }

    // ── Gameplay ──────────────────────────────────────────────────────────────────

    /** Reactions that move (spray, gusts, the gulls, the fleet's swing) scale by this. */
    get motion() { return this.reducedMotion ? CALM_MOTION : 1; }

    onLock(context = {}) {
        if (this.disposed) return;
        this.counts.locks++;
        const hard = Boolean(context.hardDrop);
        if (hard) this.counts.hardDrops++;
        this.lastLockAt = this.time;
        if (this.duskTarget > 0) this.onSessionStart();
        this.surge.lock(context, this.time);
        const { level, stage } = this.heat;
        const { motion } = this;
        const rows = Array.isArray(context.rows) && context.rows.length ? context.rows : [14];
        const row = rows.reduce((a, b) => a + b, 0) / rows.length;
        const u = context.u ?? 0.5;
        const p = this.waterSite(u, row);
        const rgb = this.pigment(context.color);
        // A boat on that side sets a spinnaker in the piece's colour (or one already flying fills
        // again and turns toward it, never doused to be set again)…
        const { fleet } = this.parts;
        const target = fleet?.setSpinnaker?.(u < 0.5 ? -1 : 1, rgb, this.time, hard) || null;
        // …and once play runs hot, a boat whose sail is down anywhere in the bay sets one too: a long
        // chain fills the whole fleet with the colours played.
        if (stage >= 2) fleet?.setSpare?.(rgb, this.time);
        if (!p) return;
        // A gust runs out to it across the water: stronger, wider and longer in the piece's colour
        // the hotter play runs (a hard-drop flurry turns the bay to coloured spray).
        let heading;
        if (target) heading = [target.x - p.x, target.z - p.z];
        else heading = [(u < 0.5 ? -0.6 : 0.6), -0.8];
        const drop = clamp((context.distance || 0) / 18, 0, 1);
        this.gust(p, heading, {
            power: (hard ? 1.3 + drop * 0.4 : 0.9) * (1 + 0.6 * level),
            speed: (hard ? 36 : 24) * (0.6 + 0.4 * motion) * (1 + 0.25 * level),
            width: (hard ? 70 : 46) * (1 + 0.4 * level),
            rgb,
            hold: clamp(level * 1.4 - 0.15, 0, 0.85),
        });
        if (hard) {
            const count = Math.round(70 * (1 + level) * (0.5 + 0.5 * motion));
            this.splash(p, rgb, (1 + drop) * (0.55 + 0.45 * motion), count);
        }
    }

    onClear(context = {}) {
        if (this.disposed) return;
        if (context.perfect && !(Array.isArray(context.rows) && context.rows.length > 0)) {
            // Physics settles a perfect clear ~360 ms after the clear's last wave, on its own (the
            // director hands it on as a clear with no rows): the crown on what is still playing,
            // never a new clear.
            this.onPerfect();
            return;
        }
        const lines = clamp(Math.round(context.lines || 1), 1, 4);
        this.counts.clears++;
        this.counts.lines += lines;
        const chain = Math.max(1, Math.round(context.combo || 1));
        // A cascade's waves (360 ms apart) each go deeper than the last.
        const deeper = clamp(Math.round(context.cascade || 1), 1, 12) - 1;
        // The land rises: the sea draws back (each wave of a cascade a little further).
        const step = upliftStep(lines, chain) * (1 + 0.15 * Math.min(deeper, 6));
        this.liftAsk = liftAfter(this.liftAsk, step);
        // The run-off streams thicken with every clear still draining instead of starting over.
        this.drainSwell.hit(clamp(0.45 + step / 10, 0.45, 1) * (1 + 0.2 * Math.min(deeper, 4)), this.time);
        this.drainMist(step);
        this.surge.clear(context, this.time);
        const palette = deeper > 0 || lines === 4 ? this.paletteOf(context.rowCodes) : null;
        if (deeper > 0) this.onWave(deeper, palette);
        if (lines === 4) this.onQuad(context.b2b === true, palette);
        if (context.b2b) this.onBackToBack();
        if (context.tspin) this.onTSpin(context);
        // A perfect clear that landed with its rows: the clear above, and its crown.
        if (context.perfect) this.onPerfect({ onClear: true });
        if (context.combo > this.combo) this.onCombo(context.combo);
    }

    /**
     * A cascade's wave past the first: the wet rock gleams brighter each wave and the sea bursts off
     * more shores, harder, with every wave.
     */
    onWave(deeper, palette = null) {
        this.counts.waves++;
        this.reboundSwell.hit(0.16 * Math.min(deeper, 5), this.time);
        if (!this.motes) return;
        const n = Math.round((12 + 5 * Math.min(deeper, 5)) * (0.5 + 0.5 * this.motion));
        const sites = Math.min(4, 1 + deeper);
        for (let k = 0; k < sites; k++) {
            this.siteQueue.unshift({
                at: this.time, k: k + deeper, n, palette,
            });
        }
    }

    /**
     * The linear colours of the pieces in a clear's rows (garbage and unknown cells left out), or
     * null: the spray a big clear throws up carries them.
     */
    paletteOf(rowCodes) {
        if (!Array.isArray(rowCodes) || !rowCodes.length) return null;
        const seen = new Set();
        for (const code of rowCodes) if (code >= 0 && code < 7) seen.add(code);
        return seen.size ? [...seen].map((code) => PIECE_LINEAR[code]) : null;
    }

    /**
     * Four lines: the great rebound, the risen rock flaring gold, spray off every shore. A second
     * quad feeds the flare still burning; a back-to-back one flares higher.
     */
    onQuad(b2b = false, palette = null) {
        this.counts.quads++;
        this.reboundSwell.hit(b2b ? 1.35 : 1, this.time);
        // The frame-wide flash is for a quad out of the blue: in hot play the payoff's light is
        // the rock's flare, the spray and the burning sky, and the frame keeps its darks.
        this.flashSwell.hit(0.26 * Math.max(0, 1 - 1.1 * this.heat.level), this.time);
        this.reboundSpray(palette);
        this.parts.life?.startle?.(this.time, this.motion);
    }

    /**
     * A back-to-back clear: the lighthouse answers with its long flash (onB2B lights it and sets it
     * sweeping while the run lasts) and the wet rock flares in its light.
     */
    onBackToBack() {
        this.signal.hit(1, this.time);
        this.reboundSwell.hit(0.35, this.time);
    }

    onTSpin() {
        this.counts.tspins++;
        this.parts.fleet?.tack?.(this.time, this.motion);
    }

    /** A T-spin that cleared nothing: the fleet still comes about. */
    onSpin() {
        if (this.disposed) return;
        this.counts.spins++;
        this.surge.spin(this.time);
        this.parts.fleet?.tack?.(this.time, this.motion);
    }

    /**
     * The perfect clear: the wind dies and the sea lies glass-calm with the whole risen coast in it,
     * the lighthouse burns and sweeps while it holds, the rock flares gold once and the gulls lift.
     * A second one while the glass still holds keeps it: the calm carries on from where it stands.
     */
    onPerfect({ onClear = false } = {}) {
        this.counts.perfects++;
        const t = this.time;
        const calm = this.calmAt(t);
        if (calm >= 0.999) {
            // Holding, or the breeze line already coming back: the glass spreads out again from
            // where the line stands, and holds anew.
            this.calmFrontFrom = this.calmFrontLine(t);
            this.calmFrontAt = t;
            this.perfectAt = t - CALM_RISE;
        } else if (calm > 0 && t - this.perfectAt < CALM_RISE) {
            this.perfectAt = t - CALM_RISE * unsmooth(calm);
        } else {
            this.perfectAt = t;
        }
        if (!onClear) this.surge.crown(t);
        this.signal.hit(1, t);
        this.reboundSwell.hit(0.9, t);
        this.flashSwell.hit(0.12 * Math.max(0, 1 - 1.1 * this.heat.level), t);
        this.parts.life?.startle?.(t, 0.7 * this.motion);
    }

    /** The perfect clear's calm at `t` (0 wind … 1 glass). */
    calmAt(t) {
        const pAge = t - this.perfectAt;
        return smooth(0, CALM_RISE, pAge) * (pAge < TIMING.calmHold + TIMING.calmReturn ? 1 : 0);
    }

    /** Where the returning breeze line stands at `t` (metres from the eye; the glass lies inside it). */
    calmFrontLine(t) {
        const back = smooth(TIMING.calmHold, TIMING.calmHold + TIMING.calmReturn, t - this.perfectAt);
        const line = 60000 * (1 - back) ** 3;
        // After a second perfect clear the glass spreads back out from where the line stood.
        return this.calmFrontFrom + (line - this.calmFrontFrom) * smooth(0, 1.6, t - this.calmFrontAt);
    }

    onCombo(value) {
        const n = clamp(Math.round(value) || 0, 0, 1000);
        if (n === this.combo) return;
        if (n > this.combo && n >= 2) this.counts.chainSteps++;
        if (n === 0 && this.peak >= 3) {
            this.counts.releases++;
            // The chain breaks: a swell runs in from the open sea and the sea returns. One already
            // running in takes the new one's power, and its front carries on.
            this.releaseAt = this.time;
            if (!(this.seaSwell.valueAt(this.time) > 0.05)) this.swellAt = this.time;
            this.seaSwell.hit(clamp(0.45 + (this.peak - 3) * 0.12, 0.45, 1), this.time);
        }
        this.combo = n;
        this.peak = n === 0 ? 0 : Math.max(this.peak, n);
    }

    onB2B(value) {
        const n = clamp(Math.round(value) || 0, 0, 4);
        if (n > this.b2b) this.counts.b2bSteps++;
        this.b2b = n;
        this.beaconLevel = n;
    }

    levelUp(level, { silent = false, time = this.time } = {}) {
        const n = Math.max(1, Math.round(Number(level) || 1));
        if (n === this.level) return;
        const up = n > this.level;
        this.wheel.levelUp(n, time, silent || this.reducedMotion);
        this.level = n;
        if (up && !silent) {
            this.counts.levelUps++;
            this.levelUpAt = time;
            // The lighthouse signals once (a long flash), day or night.
            this.signal.hit(1, time + 0.35);
            this.surge.levelUp(time);
        }
    }

    onGameOver() {
        this.counts.gameOvers++;
        this.duskFrom = this.dusk;
        this.duskTarget = 1;
        this.duskAt = this.time;
        this.releaseAt = this.time;
        this.beaconLevel = 0;
    }

    onSessionStart() {
        if (this.duskTarget > 0) this.counts.mornings++;
        this.duskFrom = this.dusk;
        this.duskTarget = 0;
        this.duskAt = this.time;
    }

    resetSession() {
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.beaconLevel = 0;
        // The next run starts at level 1; the day keeps the hour it has reached.
        this.level = 1;
        this.wheel.newRun();
    }

    seek(time) {
        this.resetState(Math.max(0, Number(time) || 0));
        this.shadowPass?.invalidate();
    }

    /** A hard drop's splash: spray thrown up where its gust starts, sparkling in the sun. */
    splash(p, rgb, power = 1, count = 70) {
        if (!this.motes) return;
        const r = this.random;
        const scale = clamp(p.distance / 500, 0.8, 4);
        for (let i = 0; i < count; i++) {
            const a = r() * TAU;
            const s = (3 + r() * 7) * scale;
            const tint = r() * 0.5;
            this.motes.spawn({
                x: p.x,
                y: p.y + 0.3,
                z: p.z,
                vx: Math.cos(a) * s,
                vy: (9 + r() * 14) * scale * power,
                vz: Math.sin(a) * s,
                born: this.time + r() * 0.08,
                life: 1.4 + r() * 1.0,
                size: (1.6 + r() * 2.2) * scale,
                rgb: [0.9 + rgb[0] * tint, 0.92 + rgb[1] * tint, 0.95 + rgb[2] * tint],
                kind: MOTE_KIND.spray,
                seed: r(),
                gravity: -9.8 * scale,
            });
        }
    }

    /** The sea running off the risen rock: breaths of mist off the shores beside the card. */
    drainMist(step) {
        if (!this.motes) return;
        const count = Math.round(8 + step * 3);
        for (let i = 0; i < count; i++) this.siteQueue.push({ at: this.time, k: -1 });
    }

    /**
     * Breaths of the drain's mist (asked at `at`; `count` of them, the late ones' share included),
     * off the water a site finds now. Hot play burns the mist gold in the low sun.
     */
    mistFrom(at, count = 1) {
        const r = this.random;
        const p = this.waterSite(r(), 6 + r() * 13);
        if (p) {
            const scale = clamp(p.distance / 500, 0.8, 4);
            const warm = clamp(this.heat.level * 0.8 + this.heat.fever * 0.4, 0, 1);
            const rgb = [0.9 + 0.1 * warm, 0.92 - 0.14 * warm, 0.95 - 0.4 * warm];
            for (let i = 0; i < count; i++) {
                this.motes.spawn({
                    x: p.x + (r() - 0.5) * 30 * (1 + i * 0.6),
                    y: p.y + 1,
                    z: p.z + (r() - 0.5) * 30 * (1 + i * 0.6),
                    vx: 0.6,
                    vy: 2.2 * scale,
                    vz: -0.3,
                    born: Math.max(this.time, at + r() * 0.8),
                    life: 3.5 + r() * 2,
                    size: (5 + r() * 6) * scale,
                    rgb,
                    kind: MOTE_KIND.mist,
                    seed: r(),
                    drift: 0.8,
                    gravity: 0,
                });
            }
        }
    }

    /**
     * The great rebound: spray bursts off the shores on both sides of the card, glints on the rock,
     * tinted with the pieces of the rows it cleared (the hotter play runs, the deeper the colour).
     */
    reboundSpray(palette = null) {
        if (!this.motes) return;
        const jobs = [];
        const n = Math.round(26 * (0.5 + 0.5 * this.motion));
        for (let k = 0; k < 10; k++) {
            jobs.push({
                at: this.time, k, n, palette,
            });
        }
        this.siteQueue.unshift(...jobs);
    }

    /** Spray off one shore (site `k`, asked at `at`): `count` droplets, tinted from `palette`. */
    sprayFrom(at, k, count = 26, palette = null) {
        const r = this.random;
        const p = this.waterSite(k % 2 ? 0.1 + r() * 0.35 : 0.6 + r() * 0.35, 8 + r() * 11);
        if (p) {
            const scale = clamp(p.distance / 600, 0.7, 3.5);
            const motion = 0.55 + 0.45 * this.motion;
            const tint = palette ? 0.35 + 0.45 * this.heat.level : 0;
            for (let i = 0; i < count; i++) {
                const c = palette ? palette[i % palette.length] : null;
                const a = r() * TAU;
                const s = (3 + r() * 7) * scale;
                this.motes.spawn({
                    x: p.x + (r() - 0.5) * 20 * scale,
                    y: p.y + 0.3,
                    z: p.z + (r() - 0.5) * 20 * scale,
                    vx: Math.cos(a) * s * motion,
                    vy: (9 + r() * 13) * scale * motion,
                    vz: Math.sin(a) * s * motion,
                    born: Math.max(this.time, at + 0.15 + (k % 10) * 0.06 + r() * 0.2),
                    life: 1.6 + r() * 1.2,
                    size: (1.4 + r() * 1.8) * scale,
                    rgb: c ? [
                        1 + (c[0] * 1.5 - 1) * tint, 0.96 + (c[1] * 1.5 - 0.96) * tint, 0.9 + (c[2] * 1.5 - 0.9) * tint,
                    ] : [1, 0.96, 0.9],
                    kind: MOTE_KIND.spray,
                    seed: r(),
                    gravity: -9.8 * scale,
                });
            }
        }
    }

    // ── Frame ─────────────────────────────────────────────────────────────────────

    update(sim, camera = this._camera) {
        if (this.disposed) return;
        this.time = Number.isFinite(sim.time) ? sim.time : this.time;
        const { time, u } = this;
        const dt = Math.max(0, Math.min(0.25, sim.delta || 0));
        // How hot play runs: sampled once a frame on the world's clock.
        const surge = this.surge.sample(time);
        const { heat } = this;
        heat.punch = surge.punch;
        heat.level = surge.level;
        heat.fever = surge.fever;
        heat.stage = surge.stage;
        const { level, fever } = heat;
        const { motion } = this;
        // Dusk at game over, morning after.
        this.dusk = this.duskFrom + (this.duskTarget - this.duskFrom)
            * smooth(0, this.duskTarget ? TIMING.dusk : TIMING.dawn, time - this.duskAt);
        // The light of the hour.
        const place = this.overrides.hour !== null ? this.overrides.hour : this.wheel.place(time);
        lightAt(place, this._hourLight);
        const L = this.dusk > 0.001 ? blendLight(this._hourLight, this._duskLight, this.dusk * 0.85, this.light) : copyLight(this._hourLight, this.light);
        u.sunDir.value.set(L.dir[0], L.dir[1], L.dir[2]);
        u.sunUp.value = L.sunUp;
        u.day.value = L.day;
        u.sun.value.set(L.sun[0], L.sun[1], L.sun[2]);
        u.fill.value.set(L.fill[0], L.fill[1], L.fill[2]);
        u.bounce.value.set(L.bounce[0], L.bounce[1], L.bounce[2]);
        // The sky catches fire as play heats: overhead it deepens, and the cloud deck and the
        // cumulus burn rose and copper in the low sun (less so with the sun high), so the payoff's
        // colour is carried by the sky itself and mirrored in the sea, not poured over the frame.
        const lowSun = 1 - smooth(12, 35, L.el);
        const fire = Math.min(1, level * 0.35 + fever * 0.75) * (0.45 + 0.55 * lowSun);
        const deep = 1 - fire * 0.32;
        const Z = L.zenith;
        u.zenith.value.set(Z[0] * deep * (1 - fire * 0.12), Z[1] * deep * (1 - fire * 0.08), Z[2] * deep);
        u.horizon.value.set(L.horizon[0], L.horizon[1], L.horizon[2]);
        u.glow.value.set(L.glow[0], L.glow[1], L.glow[2]);
        u.haze.value.set(L.haze[0], L.haze[1], L.haze[2]);
        u.mist.value.set(L.mist[0], L.mist[1], L.mist[2]);
        const C = L.cloudLit;
        const S = L.cloudShade;
        u.cloudLit.value.set(C[0] * (1 + fire * 0.4), C[1] * (1 - fire * 0.1), C[2] * (1 - fire * 0.35));
        u.cloudShade.value.set(S[0] * (1 + fire * 0.6), S[1] * (1 - fire * 0.12), S[2] * (1 + fire * 0.05));
        u.water.value.set(L.water[0], L.water[1], L.water[2]);
        // The air clears as play heats: the haze and the sea fog thin until, in a fever, the
        // archipelago stands sharp to the horizon with its own darks (the air's light, not more
        // light, is what goes).
        const clearAir = Math.min(0.62, level * 0.32 + fever * 0.38);
        u.hazeDensity.value = L.hazeDensity * (1 - clearAir);
        u.mistDensity.value = L.mistDensity * (1 - clearAir * 1.2);
        u.stars.value = L.stars;
        u.lamps.value = Math.max(L.lamps, this.dusk);
        u.dusk.value = this.dusk;
        u.time.value = time;
        // The deck drifts with a constant wind, faster while play runs hot (the extra drift is
        // integrated: a closed form of the clock alone at rest).
        this.windDrift += dt * 7.5 * motion * (level * 0.8 + fever * 0.9);
        u.wind.value.set(time * 7.5 + this.windDrift, time * -2.6 - this.windDrift * 0.35);
        // …and the deck gathers to burn: more of it, so more of the fire, and its shadows sweep the
        // land and the water (darks moving under the gold).
        u.cloudCover.value = 0.2 + 0.16 * fire;

        // ── The rising land ──
        const releasing = time - this.releaseAt < TIMING.swell || this.duskTarget > 0;
        this.liftAsk = relaxLift(this.liftAsk, dt, releasing ? UPLIFT.release : UPLIFT.relax);
        this.liftShown += (this.liftAsk - this.liftShown) * approach(1 / UPLIFT.ease, dt);
        const sea = -this.liftShown;
        // Rock the sea gives up stays wet, drying from the top down; rock it takes back is wet at once.
        if (sea > this.wetLine) this.wetLine = sea;
        else this.wetLine += (sea - this.wetLine) * approach(1 / TIMING.dry, dt);
        u.sea.value = sea;
        u.wetLine.value = this.wetLine;
        if (this.motes) this.serveSites();
        u.drain.value = this.drainSwell.valueAt(time);
        // The rebound's gold on the wet rock (quads, cascade waves, back-to-back, the crown).
        u.rebound.value = this.reboundSwell.valueAt(time);
        // A released chain's swell: it runs in from the horizon toward the eye.
        const sAge = time - this.swellAt;
        u.swell.value.set(this.seaSwell.valueAt(time), Math.max(0, 7000 - sAge * 900), sAge);
        // A perfect clear: glass, then the breeze line comes back from the horizon.
        const calm = this.calmAt(time);
        u.calm.value = calm;
        u.calmFront.value = this.calmFrontLine(time);
        // The chain freshens the wind (the fleet heels, the water sparkles), and so does the heat
        // of play; eased, so a broken chain lets the wind drop instead of cutting it.
        const breezeAsk = 1 + 0.08 * Math.min(this.combo, 6) + motion * (level * 0.3 + fever * 0.22);
        this.breezeShown += (breezeAsk - this.breezeShown) * approach(1 / 1.2, dt);
        u.breeze.value = this.breezeShown;
        // Back-to-back: the lighthouse; it also burns and sweeps while a perfect clear's glass holds.
        this.beaconShown += (Math.max(this.beaconLevel / 3, calm * 0.9) - this.beaconShown) * approach(1.2, dt);
        u.beacon.value.set(clamp(this.beaconShown, 0, 1), L.lamps);
        this.signalShown = this.signal.valueAt(time);
        // The heat the materials read: (level, fever, the sails' glow, the gold on the wet rock).
        u.heat.value.set(level, fever, level * 0.3 + fever * 0.85, level * 0.5 + fever * 1.1);

        if (camera) {
            camera.updateMatrixWorld();
            u.eye.value.copy(camera.position);
            u.camRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
            u.camUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
            u.camFwd.value.setFromMatrixColumn(camera.matrixWorld, 2).negate();
            u.tanHalfFov.value = Math.tan(camera.fov * DEG * 0.5);
            u.pixelAngle.value = (2 * u.tanHalfFov.value) / Math.max(1, this.viewportHeight || 1080);
        }
        this.updatePost(camera);
        this.motes?.update();
        for (const part of this.partList) part.update?.(time, dt, this);
    }

    updatePost(camera) {
        const post = this._post;
        const L = this.light;
        const { level, fever } = this.heat;
        // An iris: it closes a little as play heats, so the colours the surge brings stay saturated
        // and the clearing air's darks stay dark.
        post.exposure = L.exposure * (1 - level * 0.06 - fever * 0.05);
        post.shaftColour = L.glow;
        post.saturation = 1.16 + level * 0.08 + fever * 0.07;
        // The rebound's light is carried by the wet rock itself; the frame's bloom swells only a
        // little with it (a frame-wide surge: Reduce flashing scales it), and less in a fever.
        post.bloomBoost = Math.min(0.6, this.u.rebound.value * 0.24 * (1 - fever * 0.4) * flashScale()
            + this.u.calm.value * 0.12);
        post.flash = this.flashSwell.valueAt(this.time);
        post.flashColour = L.glow;
        post.sun.strength = 0;
        if (camera) {
            this._sunWorld.set(EYE.x + L.dir[0] * 1000, EYE.y + L.dir[1] * 1000, EYE.z + L.dir[2] * 1000);
            this._sunScreen.copy(this._sunWorld).project(camera);
            const inFront = this._sunScreen.z < 1;
            post.sun.x = this._sunScreen.x * 0.5 + 0.5;
            post.sun.y = 0.5 - this._sunScreen.y * 0.5;
            const margin = Math.max(Math.abs(post.sun.x - 0.5), Math.abs(post.sun.y - 0.5));
            post.sun.onScreen = inFront ? 1 - smooth(0.5, 0.9, margin) : 0;
            post.sun.strength = post.sun.onScreen * L.sunUp * smooth(-1, 5, L.el) * (1 - smooth(14, 32, L.el));
        }
    }

    /** GPU work that must precede the frame: the land's shadow, when the sun has moved. */
    prerender(renderer) {
        if (this.disposed || !this.shadowPass) return;
        this.shadowPass.render(renderer, this.u.sunDir.value);
    }

    getPostState() { return this._post; }

    getState() {
        return {
            quality: this.quality,
            source: this.source ?? null,
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
            },
            counts: { ...this.counts },
            combo: this.combo,
            peak: this.peak,
            b2b: this.b2b,
            lift: this.liftShown,
            liftAsk: this.liftAsk,
            sea: this.u.sea.value,
            wetLine: this.wetLine,
            drain: this.u.drain.value,
            swell: this.u.swell.value.x,
            calm: this.u.calm.value,
            beacon: this.u.beacon.value.x,
            rebound: this.u.rebound.value,
            breeze: this.u.breeze.value,
            heat: { ...this.heat },
            dusk: this.dusk,
            fleet: this.parts.fleet?.getState?.() ?? null,
            reducedMotion: this.reducedMotion,
            sceneChildren: this.root.children.length,
            parts: Object.keys(this.parts),
        };
    }

    exportSessionState() {
        const scalars = {};
        for (const key of SNAPSHOT) scalars[key] = this[key];
        return {
            scalars,
            swells: Object.fromEntries(SWELLS.map((key) => [key, this[key].exportState()])),
            surge: this.surge.exportState(),
            wheel: this.wheel.exportState(),
            counts: { ...this.counts },
            gusts: this.u.tables.gusts.map((v) => v.toArray()),
            fleet: this.parts.fleet?.exportState?.() ?? null,
            life: this.parts.life?.exportState?.() ?? null,
        };
    }

    importSessionState(state) {
        if (!state?.scalars) return;
        for (const key of SNAPSHOT) if (state.scalars[key] !== undefined) this[key] = state.scalars[key];
        if (state.swells) for (const key of SWELLS) if (state.swells[key]) this[key].importState(state.swells[key]);
        if (state.surge) this.surge.importState(state.surge);
        this.wheel.importState(state.wheel);
        this.counts = { ...emptyCounts(), ...state.counts };
        if (Array.isArray(state.gusts)) state.gusts.forEach((row, k) => this.u.tables.gusts[k]?.fromArray(row));
        if (state.fleet) this.parts.fleet?.importState?.(state.fleet);
        if (state.life) this.parts.life?.importState?.(state.life);
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.root.removeFromParent();
        for (const part of this.partList) part.dispose();
        this.shadowPass?.dispose();
        if (this.textures) {
            for (const name of FIELD_ORDER) {
                this.textures.fields[name].dispose();
                this.textures.cover[name].dispose();
            }
            this.textures.noise.dispose();
            this.textures.lattice.dispose();
        }
        this.root.clear();
        this.partList.length = 0;
    }
}

export { PIECE_LINEAR };
