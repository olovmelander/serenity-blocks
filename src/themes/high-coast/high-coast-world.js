/**
 * High Coast — one shared world (the theme and the playground mount the same one).
 *
 * The coast seen from a granite summit: the baked land and sea floor (three nested fields) under
 * the hour's light, the sea, the sky with its cumulus, the pine forests, the old pine and the
 * trail sign, the fishing hamlet, the sailing fleet, and everything gameplay does to them:
 *
 *   lock        a gust (a cat's paw) runs out across the water from beside the card, and a boat on
 *               that side sets a spinnaker in the piece's colour (a hard drop: a wider, faster gust)
 *   clear       the land rises: the sea draws back from every shore, wet rock and skerries come up
 *               out of it, seawater runs off the risen rock, and the bare band dries in the sun
 *   chain       the rise compounds (each link lifts more, up toward the coast's ceiling); when the
 *               chain breaks, a swell runs in from the open sea and the sea returns
 *   four lines  the great rebound: a big lift at once, the risen rock flaring gold, spray
 *   T-spin      the fleet comes about, every sail swinging through the light together
 *   b2b         the lighthouse lights and sweeps while the run lasts
 *   perfect     the wind dies: the sea lies glass-calm, the archipelago mirrored, until the breeze
 *               line returns from the horizon
 *   level up    the day steps an hour forward (it also turns with the clock alone)
 *   game over   dusk falls and the sea returns; morning comes back with the next run
 *
 * Lifecycle: `await HighCoastWorld.prepare(quality, { signal })` reads the baked fields and builds
 * the land's mesh in slices; `new HighCoastWorld({ ..., prepared }).build()` makes the scene
 * objects; each frame `updateCamera` → `update` → `prerender(renderer)` → the post renders.
 */
import * as THREE from 'three/webgpu';
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

export const HIGH_COAST_PARTS = Object.freeze(['land', 'sea', 'sky', 'cumulus', 'forest', 'props', 'hamlet', 'fleet', 'life', 'motes']);
export const REST_RIG = Object.freeze({ near: RIG.near, far: RIG.far });
export const fovForAspect = (aspect) => rigFor(aspect).fov;

const COUNTERS = [
    'locks', 'hardDrops', 'clears', 'lines', 'quads', 'tspins', 'perfects', 'chainSteps', 'releases', 'b2bSteps',
    'levelUps', 'gameOvers', 'mornings',
];
const emptyCounts = () => Object.fromEntries(COUNTERS.map((k) => [k, 0]));
/** Session scalars a rebuild in place carries over. */
const SNAPSHOT = Object.freeze([
    'time', 'level', 'combo', 'peak', 'b2b', 'liftAsk', 'liftShown', 'wetLine', 'drainAt', 'drainPower', 'releaseAt',
    'swellAt', 'swellPower', 'perfectAt', 'quadAt', 'duskFrom', 'duskTarget', 'duskAt', 'beaconLevel', 'beaconShown',
    'lastLockAt', 'levelUpAt', 'gustCursor',
]);

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
        scene, quality = 'High', capture = false, seed = 0x40ea, prepared = null,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture;
        this.seed = seed;
        this.prepared = prepared;
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
        this.drainAt = -1e6;
        this.drainPower = 0;
        this.releaseAt = -1e6;
        this.swellAt = -1e6;
        this.swellPower = 0;
        this.perfectAt = -1e6;
        this.quadAt = -1e6;
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
        // A seek replays from scratch: the same draws, the same spray, the gulls back on their rounds.
        this.random = mulberry32(this.seed ^ 0x51ab);
        this.parts?.fleet?.reset?.();
        this.parts?.motes?.reset?.();
        this.parts?.life?.reset?.();
    }

    build() {
        if (this.root.parent) return this;
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
        this.addPart('sea', createSea(this.u, this.textures, tier));
        this.addPart('forest', createForest(this.u, this.textures, tier, this.fields));
        this.addPart('props', createProps(this.u, this.textures, tier, this.fields));
        this.addPart('hamlet', createHamlet(this.u, this.textures, tier, this.fields));
        this.addPart('fleet', createFleet(this.u, this.textures, tier));
        this.addPart('life', createLife(this.u, this.textures, tier, this.parts.hamlet.lantern));
        this.motes = new Motes(this.u, tier.motes);
        this.addPart('motes', {
            mesh: this.motes.mesh,
            reset: () => this.motes.clear(),
            dispose: () => this.motes.dispose(),
        });
        this.addPart('sky', createSky(this.u, this.textures, tier));
        this.addPart('cumulus', createCumulus(this.u, this.textures, tier, tier.banks));
        this.scene.add(this.root);
        return this;
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
            if (y < Math.max(ground, sea)) {
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

    pigment(color, out = this._rgb) {
        hexToLinear(typeof color === 'string' ? color : PIECE_COLORS[0], out);
        return out;
    }

    /** Send a gust (cat's paw) across the water from a point, along a heading. */
    gust(p, heading, {
        power = 1, speed = 22, width = 40, rgb = [1, 1, 1],
    } = {}) {
        const slot = this.gustCursor % GUSTS;
        this.gustCursor = (this.gustCursor + 1) % (GUSTS * 1000);
        const len = Math.hypot(heading[0], heading[1]) || 1;
        const scale = clamp(p.distance / 700, 0.6, 4);
        this.u.tables.gusts[slot * 3].set(p.x, p.z, this.time, power);
        this.u.tables.gusts[slot * 3 + 1].set(heading[0] / len, heading[1] / len, speed * scale, width * scale);
        this.u.tables.gusts[slot * 3 + 2].set(rgb[0], rgb[1], rgb[2], 0);
    }

    // ── Gameplay ──────────────────────────────────────────────────────────────────

    onLock(context = {}) {
        if (this.disposed) return;
        this.counts.locks++;
        const hard = Boolean(context.hardDrop);
        if (hard) this.counts.hardDrops++;
        this.lastLockAt = this.time;
        if (this.duskTarget > 0) this.onSessionStart();
        const rows = Array.isArray(context.rows) && context.rows.length ? context.rows : [14];
        const row = rows.reduce((a, b) => a + b, 0) / rows.length;
        const u = context.u ?? 0.5;
        const p = this.waterSite(u, row);
        const rgb = this.pigment(context.color);
        // A boat on that side sets a spinnaker in the piece's colour…
        const target = this.parts.fleet?.setSpinnaker?.(u < 0.5 ? -1 : 1, rgb, this.time, hard) || null;
        if (!p) return;
        // …and a gust runs out to it across the water.
        let heading;
        if (target) heading = [target.x - p.x, target.z - p.z];
        else heading = [(u < 0.5 ? -0.6 : 0.6), -0.8];
        const drop = clamp((context.distance || 0) / 18, 0, 1);
        this.gust(p, heading, {
            power: hard ? 1.3 + drop * 0.4 : 0.9, speed: hard ? 36 : 24, width: hard ? 70 : 46, rgb,
        });
        if (hard) this.splash(p, rgb, 1 + drop);
    }

    onClear(context = {}) {
        if (this.disposed) return;
        if (context.perfect) {
            this.onPerfect();
            return;
        }
        const lines = clamp(Math.round(context.lines || 1), 1, 4);
        this.counts.clears++;
        this.counts.lines += lines;
        const chain = Math.max(1, Math.round(context.combo || 1));
        // The land rises: the sea draws back.
        const step = upliftStep(lines, chain);
        this.liftAsk = liftAfter(this.liftAsk, step);
        this.drainAt = this.time;
        this.drainPower = clamp(0.45 + step / 10, 0.45, 1);
        this.drainMist(step);
        if (lines === 4) this.onQuad();
        if (context.tspin) this.onTSpin(context);
        if (context.combo > this.combo) this.onCombo(context.combo);
    }

    /** Four lines: the great rebound, the risen rock flaring gold, spray off every shore. */
    onQuad() {
        this.counts.quads++;
        this.quadAt = this.time;
        this._post.flashKick = 0.8;
        this.reboundSpray();
        this.parts.life?.startle?.(this.time);
    }

    onTSpin() {
        this.counts.tspins++;
        this.parts.fleet?.tack?.(this.time);
    }

    onPerfect() {
        this.counts.perfects++;
        this.perfectAt = this.time;
    }

    onCombo(value) {
        const n = clamp(Math.round(value) || 0, 0, 1000);
        if (n === this.combo) return;
        if (n > this.combo && n >= 2) this.counts.chainSteps++;
        if (n === 0 && this.peak >= 3) {
            this.counts.releases++;
            // The chain breaks: a swell runs in from the open sea and the sea returns.
            this.releaseAt = this.time;
            this.swellAt = this.time;
            this.swellPower = clamp(0.45 + (this.peak - 3) * 0.12, 0.45, 1);
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
    splash(p, rgb, power = 1) {
        if (!this.motes) return;
        const r = this.random;
        const scale = clamp(p.distance / 500, 0.8, 4);
        for (let i = 0; i < 70; i++) {
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
        const r = this.random;
        const count = Math.round(8 + step * 3);
        for (let i = 0; i < count; i++) {
            const p = this.waterSite(r(), 6 + r() * 13);
            if (!p) continue;
            const scale = clamp(p.distance / 500, 0.8, 4);
            this.motes.spawn({
                x: p.x + (r() - 0.5) * 30,
                y: p.y + 1,
                z: p.z + (r() - 0.5) * 30,
                vx: 0.6,
                vy: 2.2 * scale,
                vz: -0.3,
                born: this.time + r() * 0.8,
                life: 3.5 + r() * 2,
                size: (5 + r() * 6) * scale,
                rgb: [0.9, 0.92, 0.95],
                kind: MOTE_KIND.mist,
                seed: r(),
                drift: 0.8,
                gravity: 0,
            });
        }
    }

    /** The great rebound: spray bursts off the shores on both sides of the card, glints on the rock. */
    reboundSpray() {
        if (!this.motes) return;
        const r = this.random;
        for (let k = 0; k < 10; k++) {
            const p = this.waterSite(k % 2 ? 0.1 + r() * 0.35 : 0.6 + r() * 0.35, 8 + r() * 11);
            if (!p) continue;
            const scale = clamp(p.distance / 600, 0.7, 3.5);
            for (let i = 0; i < 26; i++) {
                const a = r() * TAU;
                const s = (3 + r() * 7) * scale;
                this.motes.spawn({
                    x: p.x + (r() - 0.5) * 20 * scale,
                    y: p.y + 0.3,
                    z: p.z + (r() - 0.5) * 20 * scale,
                    vx: Math.cos(a) * s,
                    vy: (9 + r() * 13) * scale,
                    vz: Math.sin(a) * s,
                    born: this.time + 0.15 + k * 0.06 + r() * 0.2,
                    life: 1.6 + r() * 1.2,
                    size: (1.4 + r() * 1.8) * scale,
                    rgb: [1, 0.96, 0.9],
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
        // Dusk at game over, morning after.
        this.dusk = this.duskFrom + (this.duskTarget - this.duskFrom)
            * smooth(0, this.duskTarget ? TIMING.dusk : TIMING.dawn, time - this.duskAt);
        // The light of the hour.
        const place = this.overrides.hour !== null ? this.overrides.hour : this.wheel.place(time);
        lightAt(place, this._hourLight);
        const L = this.dusk > 0.001 ? blendLight(this._hourLight, this._duskLight, this.dusk * 0.85, this.light) : copyLight(this._hourLight, this.light);
        u.sunDir.value.set(L.dir[0], L.dir[1], L.dir[2]);
        u.sunUp.value = L.sunUp;
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
        u.water.value.set(L.water[0], L.water[1], L.water[2]);
        u.hazeDensity.value = L.hazeDensity;
        u.mistDensity.value = L.mistDensity;
        u.stars.value = L.stars;
        u.lamps.value = Math.max(L.lamps, this.dusk);
        u.dusk.value = this.dusk;
        u.time.value = time;
        // The deck drifts with a constant wind (closed form: the clock times a constant).
        u.wind.value.set(time * 7.5, time * -2.6);
        u.cloudCover.value = 0.2;

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
        u.drain.value = this.drainPower * smooth(0, 0.25, time - this.drainAt) * (1 - smooth(TIMING.drain * 0.4, TIMING.drain, time - this.drainAt));
        const qAge = time - this.quadAt;
        u.rebound.value = smooth(0, 0.4, qAge) * (1 - smooth(1.2, 4.5, qAge));
        // A released chain's swell: it runs in from the horizon toward the eye.
        const sAge = time - this.swellAt;
        const swellLive = smooth(0, 1.2, sAge) * (1 - smooth(TIMING.swell - 3, TIMING.swell, sAge));
        u.swell.value.set(this.swellPower * swellLive, Math.max(0, 7000 - sAge * 900), sAge);
        // A perfect clear: glass, then the breeze line comes back from the horizon.
        const pAge = time - this.perfectAt;
        const back = smooth(TIMING.calmHold, TIMING.calmHold + TIMING.calmReturn, pAge);
        u.calm.value = smooth(0, 1.4, pAge) * (pAge < TIMING.calmHold + TIMING.calmReturn ? 1 : 0);
        u.calmFront.value = 60000 * (1 - back) ** 3;
        // The chain freshens the wind a little (the fleet heels; the water sparkles).
        u.breeze.value = 1 + 0.08 * Math.min(this.combo, 6);
        // Back-to-back: the lighthouse.
        this.beaconShown += (this.beaconLevel / 3 - this.beaconShown) * approach(1.2, dt);
        u.beacon.value.set(clamp(this.beaconShown, 0, 1), L.lamps);

        if (camera) {
            camera.updateMatrixWorld();
            u.eye.value.copy(camera.position);
            u.camRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
            u.camUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
            u.camFwd.value.setFromMatrixColumn(camera.matrixWorld, 2).negate();
            u.tanHalfFov.value = Math.tan(camera.fov * DEG * 0.5);
            u.pixelAngle.value = (2 * u.tanHalfFov.value) / Math.max(1, this.viewportHeight || 1080);
        }
        this.updatePost(camera, dt);
        this.motes?.update();
        for (const part of this.partList) part.update?.(time, dt, this);
    }

    updatePost(camera, dt) {
        const post = this._post;
        const L = this.light;
        post.exposure = L.exposure;
        post.shaftColour = L.glow;
        post.saturation = 1.16;
        post.bloomBoost = Math.min(1, this.u.rebound.value * 0.5 + this.u.calm.value * 0.25);
        post.flashKick = Math.max(0, (post.flashKick || 0) - dt * 1.6);
        post.flash = post.flashKick * post.flashKick * 0.4;
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
                place: this.light.place, from: this.light.from, to: this.light.to, mix: this.light.mix, az: this.light.az, el: this.light.el, name: HOURS[this.light.from].name,
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
            wheel: this.wheel.exportState(),
            counts: { ...this.counts },
            gusts: this.u.tables.gusts.map((v) => v.toArray()),
            fleet: this.parts.fleet?.exportState?.() ?? null,
        };
    }

    importSessionState(state) {
        if (!state?.scalars) return;
        for (const key of SNAPSHOT) if (state.scalars[key] !== undefined) this[key] = state.scalars[key];
        this.wheel.importState(state.wheel);
        this.counts = { ...emptyCounts(), ...state.counts };
        if (Array.isArray(state.gusts)) state.gusts.forEach((row, k) => this.u.tables.gusts[k]?.fromArray(row));
        if (state.fleet) this.parts.fleet?.importState?.(state.fleet);
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
