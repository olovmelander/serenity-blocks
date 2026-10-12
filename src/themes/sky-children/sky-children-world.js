/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sky Children — Irisfall: the world.
 *
 * The eye stands on a travertine overlook at the edge of the high country with the sun low BEHIND
 * it. Ahead, the other half of the sky; left of the card the Spring Isle's white terraces and the
 * Mother Fall pouring into the Deep; right of the HUD the Twin Isle and its broken aqueduct; far off
 * the Far Gate and an archipelago in haze; below everything the Deep, bottomless, with the isles'
 * shadows converging on the antisolar point. Everything is built here and shared with the playground
 * effect (src/playground/effects/sky-children.effect.js), so what is iterated there ships.
 *
 * Parts (showOnlyParts names): sky, sea, cumulus, isles, falls, spray, pools, gliders, fx.
 *
 * What the board does to it:
 *   lock        a light-copy of the piece melts into a thread of light-water that a pool HOLDS
 *   hard drop   a straight jet, a double crown, the pool brims; the eye dips
 *   clear       each cleared row pours off both sides of the card; one surge down every fall per
 *               line; the oldest held colours RIDE DOWN the white falls as coloured ribbons
 *               (3 per line, all on four); two lines run the broken span and bank the flock; three
 *               raise a tower of spray with a bow standing in it
 *   combo       the children paint the bow, one stroke per link, until from this height it closes
 *               into a full circle; the secondary follows; the bows breathe, then sing
 *   four lines  the hush (the falls thin, the spray hangs, the children stop dead), then the glory
 *               opens at the tip of our own shadow, one ring per line, and the great pour
 *   perfect     the same, eight rings, and the Far Gate's spillway runs for the only time
 *   T-spin      the falls are wrung, two children rise in a double helix, the colours turn
 *   B2B         the pools stay brimming; the long-wing keeps station on the bow
 *   level up    the bell tolls the hour: every pool rings, a flight of children sails out, and the
 *               light turns one place round the wheel
 * and the clock turns the same wheel by itself (HOUR_SECONDS per hour), in every mode.
 */
import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import {
    DEG, approach, bakeOpticsLut, bakePuff, bakeSeaField, bakeSkyNoise, bakeStoneNoise, clamp, clamp01, fallPoint, hexToLinear,
    pieceLight, smooth,
} from './sky-children-core.js';
import { tierFor } from './sky-children-quality.js';
import {
    REST_RIG, fovForAspect, frameFor, nominalLayout, project, unproject,
} from './sky-children-frame.js';
import { COLOUR_ROWS, HourWheel, hourAt } from './sky-children-hours.js';
import {
    createFieldTexture, createLight, createLutTexture, createNoiseTexture, createSpriteTexture, tune,
} from './sky-children-tsl.js';
import { createSky } from './sky-children-sky.js';
import { createSea } from './sky-children-sea.js';
import { createCumulus } from './sky-children-cumulus.js';
import { PLAN, placePlan } from './sky-children-plan.js';
import { createIsles, entryToWorld, outletAt } from './sky-children-isles.js';
import { createPools } from './sky-children-water.js';
import { GliderFlock } from './sky-children-flock.js';
import { createGliders } from './sky-children-gliders.js';
import {
    FALL_KIND, FALL_SLOTS, PACKET_SLOTS, clearFall, createFallTable, createFalls, createPacketTable, writeFall,
} from './sky-children-falls.js';
import { GLOW, createGlows, createSpray } from './sky-children-fx.js';
import { EventEffects, LOCK, SPARKS } from './sky-children-events.js';
import { FlashGovernor } from './sky-children-flash.js';
import { boardFor } from './sky-children-composition.js';

export { REST_RIG, fovForAspect };

/** The parts a capture can show alone. */
export const SKY_CHILDREN_PARTS = Object.freeze(['sky', 'sea', 'cumulus', 'isles', 'falls', 'spray', 'pools', 'gliders', 'fx']);

/** The scalar rows the shaders read (HOUR_SCALARS names → uniforms). */
const SCALAR_UNIFORMS = Object.freeze([
    'keyGain', 'twilight', 'polar', 'stars', 'milky', 'bowGain', 'bowSat', 'fogbow', 'hearth', 'gliderGlow',
    'cloud', 'spray', 'shadowDepth', 'albedoSat',
]);

/** Strokes the chain paints (7 primary + 5 secondary) and the cap of the dial. */
export const STROKES = 12;
export const DIAL_MAX = 13;
/** Casters (isle shadows across the Deep). */
export const CASTERS = 8;

/** Seconds a stroke takes to paint; withdrawal spacing on a break; the B2B grace. */
const STROKE_SECONDS = 1.0;
const UNWIND_SECONDS = 0.35;
const B2B_GRACE = 4;
/** How far in front of the eye the lock's copy and the clear's sheets are drawn (metres). */
const NEAR_DEPTH = 42;
/** Pools released per line (FINAL §2.2). */
const RELEASE_PER_LINE = 3;
/** The hush before the four-line set piece (seconds) and the perfect clear's. */
const HUSH = 0.33;
const HUSH_PERFECT = 0.4;
/** The glory: when each ring opens (seconds after the hush ends), how long it holds. */
const GLORY_HOLD = 7.6;
/** The falls' fall slots: static first. */
const SLOT = Object.freeze({
    mother: 0, span: 1, horse: 2, hair: 5, spill: 9, spillway: 11,
});

/** A hard drop's jet time (its light lands this long after the lock). */
const LOCK_JET = LOCK.jet;

/** Where on the Spring Isle's lowest lip the Mother Fall leaves (radians, + toward the leg). */
const MOTHER_BEARING = 0.62;

/** How the eye breathes at rest (degrees, seconds) and the bob (metres, seconds). */
const BREATH = Object.freeze({
    yaw: 0.15, yawPeriod: 47, pitch: 0.1, pitchPeriod: 61, bob: 0.4, bobPeriod: 9,
});
/** Pointer parallax (degrees per unit of pointer). */
const PARALLAX = Object.freeze({ yaw: 0.8, pitch: 0.4 });

/** Each piece's cells in its spawn orientation (centred, y up) for locks that carry no cells. */
const SPAWN_CELLS = Object.freeze({
    I: [-1.5, 0, -0.5, 0, 0.5, 0, 1.5, 0],
    O: [-0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5],
    T: [-1, -0.5, 0, -0.5, 1, -0.5, 0, 0.5],
    S: [0, 0.5, 1, 0.5, -1, -0.5, 0, -0.5],
    Z: [-1, 0.5, 0, 0.5, 0, -0.5, 1, -0.5],
    J: [-1, 0.5, -1, -0.5, 0, -0.5, 1, -0.5],
    L: [1, 0.5, -1, -0.5, 0, -0.5, 1, -0.5],
});

/** A clear's accent for its k-th line: two lines take the warm second, three alternate. */
function lineAccent(lines, k, accentA, accentB) {
    if (lines === 3) return k % 2 ? accentB : accentA;
    return lines === 2 ? accentB : accentA;
}

const frac = (x) => x - Math.floor(x);
const hash = (n) => frac(Math.sin(n * 127.1 + 311.7) * 43758.5453);

function createUniforms() {
    const rows = uniformArray(COLOUR_ROWS.map(() => new THREE.Vector4(0, 0, 0, 1)), 'vec4');
    const U = {
        rows,
        light: createLight(rows),
        time: uniform(0),
        key: uniform(new THREE.Vector3(0, 0.25, 0.97).normalize()),
        A: uniform(new THREE.Vector3(0, -0.25, -0.97).normalize()),
        bowDown: uniform(new THREE.Vector3(0, -1, 0)),
        bowRight: uniform(new THREE.Vector3(1, 0, 0)),
        /** R1, R2, Rfog (radians), dial (0..13, eased). */
        bow: uniform(new THREE.Vector4(42 * DEG, 51 * DEG, 39 * DEG, 0)),
        /** The storm wall: centre bearing, half width, base elevation, the core's height (rad). */
        shower: uniform(new THREE.Vector4(-0.3, 0.26, 0.17, 0.2)),
        showerAmt: uniform(0.85),
        /**
         * The sky's calm zones, seen through the frame's own camera: its rows (screen units of the
         * frame's height, y down, centred) and two boxes (centre, half size): the cards' union and
         * the HUD. A negative half size is no box.
         */
        calmView: uniform(new THREE.Matrix3()),
        calmA: uniform(new THREE.Vector4(0, 0, -1, -1)),
        calmB: uniform(new THREE.Vector4(0, 0, -1, -1)),
        /** The sky's own numbers from the hour: the anticrepuscular rays' depth, the cirrus' cover. */
        rays: uniform(0),
        cirrus: uniform(0),
        /** 12 × (phi0, phi1, progress, fade) then 12 × (r, g, b, thread). */
        strokes: uniformArray(Array.from({ length: STROKES * 2 }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4'),
        /** Glory: strength, reveal radius (deg), opposition boost, the opposition glow at rest. */
        glory: uniform(new THREE.Vector4(0, 0, 0, 1)),
        /** 12 × (pos.xyz, radius) (rgb, strength): held pools lighting the stone. */
        lamps: uniformArray(Array.from({ length: 24 }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4'),
        /** 8 × (a.xyz, radius) (b.xyz, weight). */
        casters: uniformArray(Array.from({ length: CASTERS * 2 }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4'),
        falls: createFallTable(),
        packets: createPacketTable(),
        /** x packets alive, y, z, w unused. */
        counts: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** x the falls' rate, y their width (the hush thins them, the pour swells them). */
        flow: uniform(new THREE.Vector2(1, 1)),
        /** The bell's toll through every pool: x time it rang, y strength. */
        toll: uniform(new THREE.Vector2(-1e4, 0)),
        /** The T-spin's wring: x water clock it began, y its strength. */
        wring: uniform(new THREE.Vector2(-1e4, 0)),
        /** Radians per buffer pixel (things that must stay a few pixels across). */
        pixelAngle: uniform(0.001),
        drift: uniform(new THREE.Vector2(0, 0)),
        mistClock: uniform(0),
        waterClock: uniform(0),
        sprayClock: uniform(0),
        starTurn: uniform(0),
    };
    SCALAR_UNIFORMS.forEach((name) => { U[name] = uniform(0); });
    return U;
}

export class SkyChildrenWorld {
    /**
     * @param {object} p
     * @param {THREE.Scene} p.scene
     * @param {string} [p.quality='High']
     * @param {boolean} [p.capture=false]  deterministic capture (the eye does not breathe)
     * @param {number} [p.seed=33]
     * @param {number|null} [p.hour]       pin the wheel at a place (playground)
     * @param {object|null} [p.tune]       TUNE overrides (playground)
     */
    constructor({
        scene, quality = 'High', capture = false, seed = 33, hour = null, tune: overrides = null,
    } = {}) {
        tune(overrides);
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture;
        this.seed = seed;
        this.U = createUniforms();
        this.root = new THREE.Group();
        this.root.name = 'sky-children-world';
        this.parts = {};
        this.textures = [];
        this.built = false;

        this.time = 0;
        this.flightClock = 0;
        this.wheel = new HourWheel();
        if (Number.isFinite(hour)) this.wheel.pin(hour);
        this.hour = hourAt(0, {});

        this.aspect = 16 / 9;
        this.viewport = { width: 1600, height: 900 };
        this.layout = null;
        this.frame = frameFor(this.aspect, null, {});
        this.placement = placePlan(this.frame, {});
        this.reduced = false;
        this.dip = { x: 0, v: 0 };

        // The chain.
        this.combo = 0;
        this.dial = 0;
        this.dialTarget = 0;
        this.links = Array.from({ length: STROKES }, () => [1, 1, 1]);
        this.linkShapes = new Array(STROKES).fill(null);
        this.lastLock = new Map(); // player → { rgb, shape }
        this.b2b = false;
        this.graceUntil = -1e4;
        this.bowFlashUntil = -1e4;
        this.trueBowAt = -1e4;

        // The set pieces.
        /** Every flare asks first (WCAG 2.3.1: at most 3 onsets a second, a luminance allowance). */
        this.flashes = new FlashGovernor();
        this.hush = {
            at: -1e4, length: HUSH, rings: 0, perfect: false,
        };
        this.pourAt = -1e4;
        this.spillwayAt = -1e4;
        this.burstAt = -1e4;
        this.spanAt = -1e4;
        this.oppRest = 1;

        // What the pools hold (index = pool slot).
        this.poolSlots = [];
        this.held = [];
        /** How many packet slots have ever been written since the last seek (the shader's loop). */
        this.packetUsed = 0;
        this.fallCpu = [];

        this.post = {
            flash: 0,
            iris: 1,
            bloomBoost: 0,
            exposure: 1,
            hush: 0,
            gradeShadow: [0.93, 0.98, 1.09],
            gradeLight: [1.05, 1.01, 0.94],
            flare: [0.5, 0.5, 0.2, 0],
            flareTint: [1, 0.95, 0.85],
        };
        this.scratch = {
            a: [0, 0, 0], b: [0, 0, 0], c: [0, 0, 0], rgb: [0, 0, 0], p: { x: 0, y: 0, front: false },
        };
        this.trails = null;
    }

    /** Bake, build every part, add them to the scene. Returns this. */
    build() {
        const { tier, U } = this;
        const noise = createNoiseTexture(bakeSkyNoise(tier.skyNoise, this.seed), tier.skyNoise, 'sky-children-sky-noise');
        const stone = createNoiseTexture(bakeStoneNoise(tier.stoneNoise, this.seed + 1), tier.stoneNoise, 'sky-children-stone-noise');
        const lut = createLutTexture(bakeOpticsLut(tier.lutWidth), tier.lutWidth);
        const puff = createSpriteTexture(bakePuff(128), 128, 'sky-children-puff');
        const seaSize = tier.seaField ?? 256;
        const sea = createFieldTexture(bakeSeaField(seaSize, this.seed + 3), seaSize, 'sky-children-sea-field');
        this.textures.push(noise, stone, lut, puff, sea);
        this.tex = {
            noise, stone, lut, puff, sea,
        };

        this.parts.sky = createSky({ tier, U, tex: this.tex });
        this.root.add(this.parts.sky.mesh);
        this.parts.sea = createSea({ tier, U, tex: this.tex });
        this.root.add(this.parts.sea.mesh);
        this.parts.cumulus = createCumulus({ tier, U, tex: this.tex });
        this.root.add(this.parts.cumulus.mesh);
        this.parts.isles = createIsles({
            plan: PLAN, tier, U, tex: this.tex,
        });
        this.parts.isles.meshes.forEach((m) => this.root.add(m));
        this.parts.pools = createPools({ capacity: tier.pools, U, tex: this.tex });
        this.root.add(this.parts.pools.mesh);
        this.held = Array.from({ length: tier.pools }, () => ({
            at: -1e4, rgb: [1, 1, 1], released: true, releasedAt: -1e4, silent: false,
        }));
        this.flock = new GliderFlock(tier.gliders, this.seed);
        this.parts.gliders = createGliders({ capacity: tier.gliders, U });
        this.root.add(this.parts.gliders.mesh);
        for (let i = 0; i < FALL_SLOTS; i++) clearFall(U.falls, i);
        this.parts.falls = createFalls({ tier, U, tex: this.tex });
        this.root.add(this.parts.falls.mesh);
        this.parts.spray = createSpray({ capacity: tier.spray, U, tex: this.tex });
        this.parts.spray.meshes = [this.parts.spray.mesh];
        this.root.add(this.parts.spray.mesh);
        const glows = createGlows({ capacity: tier.glows, U });
        this.parts.fx = { glows, mesh: glows.mesh, dispose: () => glows.dispose() };
        this.root.add(glows.mesh);
        this.effects = new EventEffects({
            threads: tier.threads, droplets: tier.droplets, crowns: 16, sheets: 48,
        });
        this.trails = Array.from({ length: tier.gliders }, () => ({
            pts: new Float32Array(tier.trailSamples * 3), n: 0, head: 0,
        }));

        this.scene.add(this.root);
        this.applyFrame();
        this.applyHour(0);
        this.built = true;
        return this;
    }

    bindCamera(camera) {
        this.camera = camera;
        camera.near = REST_RIG.near;
        camera.far = REST_RIG.far;
        camera.fov = this.frame.vfov;
        camera.updateProjectionMatrix();
    }

    /** Draw only the named parts (capture flag). */
    showOnlyParts(names) {
        const keep = new Set(names || SKY_CHILDREN_PARTS);
        Object.entries(this.parts).forEach(([name, part]) => {
            const on = keep.has(name);
            (part.meshes || [part.mesh]).forEach((m) => { if (m) m.visible = on; });
        });
    }

    setViewport(width, height, aspect) {
        this.viewport.width = width;
        this.viewport.height = height;
        const a = Number.isFinite(aspect) && aspect > 0 ? aspect : width / Math.max(1, height);
        this.aspect = a;
        this.applyFrame();
    }

    /** The live layout rects (screen fractions) or null (menus, boot): the frame is re-solved. */
    setLayout(rects, aspect) {
        this.layout = rects || null;
        if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
        this.applyFrame();
    }

    setReducedMotion(on) {
        this.reduced = Boolean(on);
        this.flashes.setReducedMotion(this.reduced);
    }

    /** Solve the frame and write everything that follows from it. */
    applyFrame() {
        const f = frameFor(this.aspect, this.layout, this.frame);
        const { U } = this;
        U.A.value.set(f.A[0], f.A[1], f.A[2]);
        U.key.value.set(-f.A[0], -f.A[1], -f.A[2]);
        U.bowDown.value.set(f.basis.down[0], f.basis.down[1], f.basis.down[2]);
        U.bowRight.value.set(f.basis.right[0], f.basis.right[1], f.basis.right[2]);
        U.bow.value.x = f.R1;
        U.bow.value.y = f.R2;
        U.bow.value.z = f.Rfog;
        // In a smile frame A sits just under the card: its glow at rest is halved there.
        this.oppRest = f.plan === 'smile' ? 0.45 : 1;
        U.glory.value.w = this.oppRest;
        // The storm wall stands behind the bow's leg, its dark core between the Mother Fall and the
        // card (the bow and the white falls burn against it), its flank behind the Spring Isle
        // lifted to a lit veil; the world's cumulus tower in front of it is the storm's crown. A
        // smile frame shows little sky: the wall stands narrow beside the isle there, and lighter.
        const smile = f.plan === 'smile';
        const foot = unproject(Math.min(0.9, Math.max(0.05, f.foot.x)), f.horizon, f.cam, [0, 0, -1]);
        U.shower.value.x = Math.atan2(foot[0], -foot[2]) + (smile ? 0 : 3 * DEG);
        U.shower.value.y = smile ? 0.2 : 0.3;
        U.shower.value.z = smile ? 0.05 : 0.06;
        U.shower.value.w = smile ? 0.12 : 0.2;
        this.showerScale = smile ? 0.4 : 1;
        U.showerAmt.value = (this.showerHour ?? 0.85) * this.showerScale;
        this.parts.cumulus?.place(f, U.shower.value.x);
        this.writeCalm(f);
        const rows = U.strokes.array;
        for (let i = 0; i < STROKES; i++) {
            const s = i < 7 ? f.strokes1[i] : f.strokes2[i - 7];
            rows[i].x = s ? s.phi0 : 0;
            rows[i].y = s ? s.phi1 : 0;
        }
        if (this.camera) {
            this.camera.fov = f.vfov;
            this.camera.updateProjectionMatrix();
        }
        U.pixelAngle.value = (f.vfov * DEG) / Math.max(1, this.viewport.height);
        placePlan(f, this.placement);
        if (this.parts.isles) this.parts.isles.place(this.placement);
        if (this.parts.falls) this.writeStaticFalls();
        if (this.parts.pools && this.parts.isles) this.placePools();
        this.flock?.setThermals(this.placement.thermals);
        this.bowInfo = {
            A: f.A, basis: f.basis, R1: f.R1, R2: f.R2, strokes: [...f.strokes1, ...f.strokes2], dial: 0, links: this.links,
        };
    }

    /**
     * Where the Mother Fall leaves the Spring Isle's lowest lip: its right shoulder, toward the
     * bow's leg; in a smile frame its outer (left) shoulder, where the margin can show it.
     */
    motherBearing() {
        return this.frame?.plan === 'smile' ? -MOTHER_BEARING : MOTHER_BEARING;
    }

    /**
     * The sky's calm zones from the live layout (none without one): the frame camera's rows and
     * the boxes of the cards' union and the HUD, in units of the frame's height round its centre.
     */
    writeCalm(f) {
        const { U } = this;
        const { r, u, f: fw } = f.cam.basis;
        const k = 0.5 / f.cam.tanY;
        U.calmView.value.set(
            r[0] * k,
            r[1] * k,
            r[2] * k,
            -u[0] * k,
            -u[1] * k,
            -u[2] * k,
            fw[0],
            fw[1],
            fw[2],
        );
        const cards = this.layout?.cards || [];
        const box = (rect, out) => {
            if (!rect) {
                out.set(0, 0, -1, -1);
                return;
            }
            const a = f.cam.aspect;
            out.set(((rect.x0 + rect.x1) / 2 - 0.5) * a, (rect.y0 + rect.y1) / 2 - 0.5, ((rect.x1 - rect.x0) / 2) * a, (rect.y1 - rect.y0) / 2);
        };
        const union = cards.length ? cards.reduce((acc, c) => ({
            x0: Math.min(acc.x0, c.x0), y0: Math.min(acc.y0, c.y0), x1: Math.max(acc.x1, c.x1), y1: Math.max(acc.y1, c.y1),
        }), {
            x0: 1, y0: 1, x1: 0, y1: 0,
        }) : null;
        box(union, U.calmA.value);
        box(this.layout?.hud || null, U.calmB.value);
    }

    /** Where a world direction lands on screen (fractions, y down), through the solved camera. */
    screenOf(dir, out = { x: 0, y: 0, front: false }) {
        return project(dir, this.frame.cam, out);
    }

    /** The world point `depth` metres out through a frame point. */
    worldAt(x, y, depth, out = [0, 0, 0]) {
        unproject(x, y, this.frame.cam, out);
        out[0] *= depth;
        out[1] *= depth;
        out[2] *= depth;
        return out;
    }

    /** A point in an isle's local space, in the world (as the placement turned and moved it). */
    isleToWorld(name, x, y, z, out = [0, 0, 0]) {
        return entryToWorld(this.placement[name], x, y, z, out);
    }

    /** A local horizontal direction (dx, dz) turned into the world. */
    isleDir(name, dx, dz, out = [0, 0]) {
        const e = this.placement[name];
        const c = Math.cos(e.yaw);
        const sn = Math.sin(e.yaw);
        out[0] = c * dx + sn * dz;
        out[1] = -sn * dx + c * dz;
        return out;
    }

    /**
     * The pools the isles hold, by screen side and height, as many as the tier draws: the basins in
     * the corners first, then the terraces from the lowest (nearest the eye's level) up.
     */
    placePools() {
        const { pools } = this.parts;
        const all = this.parts.isles.pools;
        const scr = { x: 0, y: 0, front: false };
        const layout = this.layout || nominalLayout(this.aspect);
        const rects = [...(layout.cards || []), ...(layout.hud ? [layout.hud] : [])];
        // Where each pool lands on screen, and whether a lock's thread could be seen landing there
        // (on screen, outside every card and the HUD).
        const seen = all.map((q) => {
            const d = Math.hypot(q.world[0], q.world[1], q.world[2]) || 1;
            this.screenOf([q.world[0] / d, q.world[1] / d, q.world[2] / d], scr);
            const on = scr.front && scr.x > 0.01 && scr.x < 0.99 && scr.y > 0.01 && scr.y < 0.99;
            const hidden = rects.some((r) => scr.x > r.x0 - 0.01 && scr.x < r.x1 + 0.01 && scr.y > r.y0 - 0.01 && scr.y < r.y1 + 0.01);
            return {
                q, x: scr.x, y: scr.y, visible: on && !hidden,
            };
        });
        // Visible first; within each, the lowest terraces first; the isles share the slots by
        // their pool counts (round-robin weighted), so a small tier still has pools on both sides.
        const byIsle = new Map();
        seen.forEach((s) => {
            if (!byIsle.has(s.q.isle)) byIsle.set(s.q.isle, []);
            byIsle.get(s.q.isle).push(s);
        });
        byIsle.forEach((list) => list.sort((a, b) => (Number(b.visible) - Number(a.visible)) || (b.q.level - a.q.level)));
        const queues = [...byIsle.values()];
        const total = all.length || 1;
        const order = [];
        const taken = queues.map(() => 0);
        while (order.length < all.length) {
            // The isle furthest behind its share goes next.
            let pick = -1;
            let lag = -Infinity;
            queues.forEach((list, k) => {
                if (taken[k] >= list.length) return;
                const owed = ((order.length + 1) * list.length) / total - taken[k];
                if (owed > lag) { lag = owed; pick = k; }
            });
            if (pick < 0) break;
            order.push(queues[pick][taken[pick]]);
            taken[pick] += 1;
        }
        order.sort((a, b) => Number(b.visible) - Number(a.visible));
        // Where enough pools can be seen (a phone hides half an isle), only those are handed out.
        const visible = order.filter((o) => o.visible).length;
        if (visible >= Math.min(4, order.length)) order.length = visible;
        this.poolSlots.length = 0;
        const n = Math.min(pools.capacity, order.length);
        for (let k = 0; k < n; k++) {
            const { q, x, y } = order[k];
            const e = this.placement[q.isle];
            pools.set(k, q.world, q.radius * (e?.scale ?? 1), k, e?.pitch ?? 0.21);
            this.poolSlots.push({
                slot: k,
                isle: q.isle,
                level: q.level,
                world: q.world,
                x,
                y,
                visible: order[k].visible,
                fall: q.isle === 'spring' ? SLOT.mother : SLOT.span,
            });
        }
    }

    /** The falls that always pour: their lips follow the isles as a layout places them. */
    writeStaticFalls() {
        const { U } = this;
        const { isles } = this.parts;
        if (!isles) return;
        const put = (slot, spec) => {
            writeFall(U.falls, slot, spec);
            this.fallCpu[slot] = {
                lip: spec.lip.slice(),
                dir: spec.dir.slice(),
                v0: spec.v0,
                duration: spec.duration,
                width: spec.width,
                spread: spec.spread ?? 0.6,
                kind: spec.kind,
            };
        };
        // The Mother Fall: off the Spring Isle's lowest lip on its right shoulder, past the root.
        const m = outletAt(isles.outlets.spring, this.motherBearing());
        put(SLOT.mother, {
            lip: this.isleToWorld('spring', m.x, m.y, m.z),
            dir: this.isleDir('spring', m.nx, m.nz),
            v0: 4.6,
            width: 20,
            spread: 2.4,
            duration: 9.5,
            flow: 1,
            kind: FALL_KIND.sheet,
        });
        // The broken span's fall, from the aqueduct's break toward the card.
        const sl = isles.anchors.spanLip;
        put(SLOT.span, {
            lip: this.isleToWorld('twin', sl.x, sl.y, sl.z),
            dir: this.isleDir('twin', -0.8, 0.6),
            v0: 2.2,
            width: 4,
            spread: 0.6,
            duration: 8.5,
            flow: 1,
            kind: FALL_KIND.horsetail,
        });
        // The Twin Isle's horsetails, off its lowest lip.
        [-0.45, 0.05, 0.5].forEach((th, i) => {
            const o = outletAt(isles.outlets.twin, th);
            put(SLOT.horse + i, {
                lip: this.isleToWorld('twin', o.x, o.y, o.z),
                dir: this.isleDir('twin', o.nx, o.nz),
                v0: 1.6,
                width: 1.3 + (i % 2) * 0.7,
                spread: 0.35,
                duration: 7.5,
                flow: 1,
                kind: FALL_KIND.horsetail,
            });
        });
        // Hairlines off the archipelago's nearest isles.
        for (let i = 0; i < 4; i++) {
            const e = this.placement.archipelago?.[i * 3];
            if (i >= this.tier.hairlineFalls || !e) {
                clearFall(U.falls, SLOT.hair + i);
                continue;
            }
            const r = e.scale * 200;
            put(SLOT.hair + i, {
                lip: [e.pos[0] + Math.sin(e.bearing) * r * 0.3, e.pos[1] - e.scale * 20, e.pos[2] + Math.cos(e.bearing) * r * 0.3],
                dir: [-Math.sin(e.bearing), Math.cos(e.bearing)],
                v0: 1,
                width: 3 + e.scale * 12,
                spread: 0.6,
                duration: 9,
                flow: 1,
                kind: FALL_KIND.hairline,
            });
        }
    }

    /**
     * Put the world at a moment: no event has happened yet, except the run's turn of the wheel
     * when a rebuild carries one over (`hours`, a HourWheel snapshot at the same clock).
     * @param {number} time
     * @param {{hours?: object|null}} [options]
     */
    seek(time, { hours = null } = {}) {
        this.time = time;
        this.flightClock = time;
        this.combo = 0;
        this.dial = 0;
        this.dialTarget = 0;
        this.dip.x = 0;
        this.dip.v = 0;
        this.b2b = false;
        this.graceUntil = -1e4;
        this.bowFlashUntil = -1e4;
        this.hush.at = -1e4;
        this.pourAt = -1e4;
        this.spillwayAt = -1e4;
        this.burstAt = -1e4;
        this.spanAt = -1e4;
        if (this.flock) {
            this.flock.longWing = false;
            this.flock.helixAt = -1e4;
            this.flock.launchAt = -1e4;
            this.flock.bankFlash = -1e4;
        }
        this.pourDone = false;
        this.wheel.reset?.(time);
        if (hours) this.wheel.restore?.(hours);
        const { U } = this;
        U.waterClock.value = time;
        U.sprayClock.value = time;
        U.mistClock.value = time;
        U.glory.value.set(0, 0, 0, this.oppRest);
        U.toll.value.set(-1e4, 0);
        U.wring.value.set(-1e4, 0);
        U.counts.value.x = 0;
        this.packetUsed = 0;
        U.packets.array.forEach((row, k) => row.set(k % 2 ? 0 : -1, 0, 0, 0));
        this.effects?.reset();
        this.flashes.reset();
        this.held.forEach((h) => { h.at = -1e4; h.released = true; });
        this.parts.pools?.clearAll();
        if (this.parts.falls) clearFall(U.falls, SLOT.spillway);
        this.trails?.forEach((t) => { t.n = 0; t.head = 0; });
        this.integrate(0);
        this.applyHour(time);
        this.writeStrokes();
    }

    resetSession() {
        this.wheel.newRun?.(this.time);
        this.onCombo(0);
        this.b2b = false;
        if (this.flock) this.flock.longWing = false;
        // Held pools drain softly.
        this.held.forEach((h, i) => {
            if (!h.released) {
                h.released = true;
                h.releasedAt = this.time;
                this.parts.pools?.release(i, this.time);
            }
        });
    }

    onGameOver() {
        this.onCombo(0);
        this.graceUntil = -1e4;
    }

    restCamera() {
        this.dip.x = 0;
        this.dip.v = 0;
    }

    updateCamera(camera, sim) {
        this.time = sim.time;
        const f = this.frame;
        const still = this.reduced || this.capture;
        const t = sim.time;
        const breatheYaw = still ? 0 : Math.sin((t / BREATH.yawPeriod) * 2 * Math.PI) * BREATH.yaw;
        const breathePitch = still ? 0 : Math.sin((t / BREATH.pitchPeriod) * 2 * Math.PI + 1.3) * BREATH.pitch;
        const bob = still ? 0 : Math.sin((t / BREATH.bobPeriod) * 2 * Math.PI) * BREATH.bob;
        const px = this.reduced ? 0 : clamp(sim.pointerX ?? 0, -1, 1);
        const py = this.reduced ? 0 : clamp(sim.pointerY ?? 0, -1, 1);
        // The hard drop's dip: a critically damped spring on the pitch.
        const dt = Math.max(0, sim.delta ?? 0);
        if (dt > 0) {
            const w = 9;
            const a = -w * w * this.dip.x - 2 * w * this.dip.v;
            this.dip.v += a * dt;
            this.dip.x += this.dip.v * dt;
        }
        const yaw = (breatheYaw + px * PARALLAX.yaw) * DEG;
        const pitch = f.pitch + (breathePitch - py * PARALLAX.pitch - this.dip.x) * DEG;
        camera.position.set(0, bob, 0);
        camera.rotation.set(pitch, -yaw, 0, 'YXZ');
        if (Math.abs(camera.fov - f.vfov) > 1e-6) {
            camera.fov = f.vfov;
            camera.updateProjectionMatrix();
        }
        camera.updateMatrixWorld();
    }

    // ── What the pools hold ──

    /** A pool on `side` ('left' | 'right') for a lock at frame height y: unlit near y first. */
    choosePool(side, y, below = false) {
        let best = -1;
        let bestScore = Infinity;
        const cardMid = this.cardMid ?? 0.5;
        for (const p of this.poolSlots) {
            const onSide = side === 'left' ? p.x < cardMid : p.x >= cardMid;
            if (!onSide) continue;
            const h = this.held[p.slot];
            const lit = !h.released && this.time - h.at < 24;
            const age = lit ? this.time - h.at : 1e3;
            // A hard drop's light goes down: pools above the row cost more.
            const up = below && p.y < y ? 0.35 : 0;
            const score = Math.abs(p.y - y) + up + (lit ? 1 - Math.min(1, age / 24) + 0.3 : 0);
            if (score < bestScore) {
                bestScore = score;
                best = p.slot;
            }
        }
        if (best < 0 && this.poolSlots.length) best = this.poolSlots[0].slot;
        return best;
    }

    holdPool(slot, rgb, at, silent) {
        if (slot < 0 || !this.held[slot]) return;
        const h = this.held[slot];
        h.at = at;
        h.rgb[0] = rgb[0]; h.rgb[1] = rgb[1]; h.rgb[2] = rgb[2];
        h.released = false;
        h.silent = silent;
        this.parts.pools.hold(slot, rgb, at, silent);
    }

    /** Let the n oldest held colours go down the falls (Infinity: all of them). */
    releaseOldest(n, at, stagger = 0.4) {
        const live = [];
        this.held.forEach((h, slot) => { if (!h.released && at - h.at < 40) live.push(slot); });
        live.sort((a, b) => this.held[a].at - this.held[b].at);
        const count = Math.min(live.length, n);
        for (let k = 0; k < count; k++) {
            const slot = live[k];
            const h = this.held[slot];
            h.released = true;
            h.releasedAt = at;
            this.parts.pools.release(slot, at);
            const info = this.poolSlots.find((p) => p.slot === slot);
            const fall = info ? info.fall : SLOT.mother;
            // The colour runs down the terraces (0.4 s a hop), then rides the fall at water speed.
            const hops = info ? Math.max(1, (info.level ?? 0) + 1) : 1;
            // Spaced a band apart, so a great pour runs down as stripes of the held colours.
            this.packet(fall, this.U.waterClock.value + hops * stagger * 0.5 + k * 0.38, 0.35, 1.0, h.rgb, 0);
        }
        return count;
    }

    /**
     * A packet on a fall: colour ribbon (kind 0) or surge front (kind 1). It takes a free slot, or
     * one whose packet has run off the foot of its fall; failing that the oldest surge (a white
     * front is missed less than a colour), and only then the oldest ribbon.
     */
    packet(fall, bornWater, width, strength, rgb, kind) {
        const rows = this.U.packets.array;
        const water = this.U.waterClock.value;
        let free = -1;
        let surge = -1;
        let oldest = -1;
        for (let k = 0; k < PACKET_SLOTS; k++) {
            const a = rows[k * 2];
            const run = a.x >= 0 ? this.fallCpu[a.x]?.duration ?? 0 : -Infinity;
            if (water - a.y > run + 3 * a.z) {
                free = k;
                break;
            }
            if (rows[k * 2 + 1].w === 1 && (surge < 0 || a.y < rows[surge * 2].y)) surge = k;
            if (oldest < 0 || a.y < rows[oldest * 2].y) oldest = k;
        }
        let i = free;
        if (i < 0) i = surge >= 0 ? surge : oldest;
        rows[i * 2].set(fall, bornWater, width, strength);
        rows[i * 2 + 1].set(rgb[0], rgb[1], rgb[2], kind);
        this.packetUsed = Math.max(this.packetUsed, i + 1);
        this.U.counts.value.x = this.packetUsed;
    }

    // ── Events ──

    /** The card a board sits in, and its board, for a player. */
    cardOf(player = 0) {
        const board = this.layout ? boardFor(this.layout, player) : null;
        const cards = this.layout?.cards || [];
        let card = null;
        if (board) {
            for (const c of cards) {
                if (board.x0 >= c.x0 - 0.01 && board.x1 <= c.x1 + 0.01) card = c;
            }
        }
        if (!card) card = cards[0] || null;
        if (!card) {
            // No layout yet: the nominal solo card.
            card = {
                x0: 0.41, x1: 0.59, y0: 0.15, y1: 0.85,
            };
        }
        const b = board || {
            x0: card.x0 + (card.x1 - card.x0) * 0.08, x1: card.x1 - (card.x1 - card.x0) * 0.08, y0: card.y0 + (card.y1 - card.y0) * 0.17, y1: card.y1 - 0.02,
        };
        this.cardMid = (card.x0 + card.x1) / 2;
        return { card, board: b };
    }

    /**
     * Where an event came from: its player's card and board, or, for a meditation click (`screen`,
     * no board), the point clicked: a card no wider than the point, every row at its height, and a
     * nominal board's width so a light-copy keeps a cell's size.
     */
    sourceOf(c) {
        if (!c.screen) return this.cardOf(c.player ?? 0);
        const x = clamp(Number(c.screen.x) || 0, 0, 1);
        const y = clamp(Number(c.screen.y) || 0, 0, 1);
        const half = 0.0756;
        this.cardMid = x;
        return {
            card: {
                x0: x, x1: x, y0: y, y1: y,
            },
            board: {
                x0: x - half, x1: x + half, y0: y, y1: y,
            },
        };
    }

    onLock(c) {
        if (!c) return;
        const rgb = pieceLight(c.color || '#ffffff', 0.35, [0, 0, 0]);
        this.lastLock.set(c.player ?? 0, { rgb: rgb.slice(), shape: c.shape ?? null });
        const { card, board } = this.sourceOf(c);
        const rows = c.rows && c.rows.length ? c.rows : [10];
        let rowMid = 0;
        for (let i = 0; i < rows.length; i++) rowMid += rows[i];
        rowMid /= rows.length;
        const y = board.y0 + ((rowMid + 0.5) / 20) * (board.y1 - board.y0);
        // A click picks its side by the half of the screen it was made in.
        const side = (c.screen ? c.screen.x : c.u ?? 0.5) < 0.5 ? 'left' : 'right';
        const slot = this.choosePool(side, y, Boolean(c.hardDrop));
        if (slot < 0) return;
        if (c.silent) {
            this.holdPool(slot, rgb, this.time, true);
            return;
        }
        // The copy: just outside the card's edge, at the rows' height (in the card–HUD gap when the
        // right side's row is in the HUD's band).
        const hud = this.layout?.hud;
        let x = side === 'left' ? card.x0 - 0.025 : card.x1 + 0.025;
        let scale = 0.9;
        if (!c.screen && side === 'right' && hud && y > hud.y0 - 0.02 && y < hud.y1 + 0.02 && hud.x0 > card.x1) {
            x = (card.x1 + hud.x0) / 2;
            scale = 0.6;
        }
        const from = this.worldAt(x, y, NEAR_DEPTH, [0, 0, 0]);
        const pool = this.poolSlots.find((p) => p.slot === slot);
        const to = pool ? pool.world : from;
        const cellFrac = (board.x1 - board.x0) / 10;
        const cellSize = cellFrac * 2 * this.frame.cam.tanX * NEAR_DEPTH * scale;
        const { r: right, u: up } = this.frame.cam.basis;
        const hard = Boolean(c.hardDrop);
        const flight = (this.reduced ? 1.4 : 1) * (0.85 + Math.min(0.25, Math.hypot(to[0], to[2]) / 4000));
        const cells = c.cells || (c.shape && SPAWN_CELLS[c.shape]) || null;
        this.effects.setCamera(this.frame.cam);
        // Beside the HUD the lock's sparks keep off it: up and down in the gap, up above it, down
        // below it.
        let sparks = SPARKS.round;
        if (hud && side === 'right' && x > hud.x0 - 0.03 && x < hud.x1 + 0.03) {
            if (scale < 0.8) sparks = SPARKS.vertical;
            else if (y < hud.y0) sparks = SPARKS.up;
            else if (y > hud.y1) sparks = SPARKS.down;
        }
        // Nothing crosses the HUD: a thread bound past it goes round its nearer corner.
        let via = null;
        if (hud && pool && side === 'right' && pool.x > hud.x0 && x < hud.x1) {
            const above = y < (hud.y0 + hud.y1) / 2;
            const clearY = above ? hud.y0 - 0.05 : hud.y1 + 0.05;
            const inBand = y > hud.y0 - 0.05 && y < hud.y1 + 0.05;
            // From inside the HUD's band: along the card–HUD gap out of it first, then past its corner.
            via = inBand ? [x, clearY, hud.x1 + 0.03, clearY] : [hud.x1 + 0.03, clearY];
        }
        this.effects.lock(this.time, {
            from,
            to,
            right,
            up,
            cells,
            cellSize,
            colour: rgb,
            hardDrop: hard,
            flight,
            pool: slot,
            fromScreen: [x, y],
            toScreen: pool ? [pool.x, pool.y] : [x, y],
            viaScreen: via,
            sparks,
        });
        if (hard && !this.reduced) this.dip.v += 0.6 * 9;
        // A long drop (12 rows or more) bursts the Mother Fall's spray as it lands.
        if (hard && (c.dropRows ?? 0) >= 12) this.burstAt = Math.max(this.burstAt, this.time + LOCK_JET);
    }

    onClear(c) {
        if (!c) return;
        const lines = Math.max(1, Math.min(4, c.lines || 1));
        const t = this.time;
        const h = this.hour;
        const accentA = h.colour.accent;
        const { accentB } = h.colour;
        // The clear carries its own link number (combo(0) arrives a lock late).
        if (c.combo > 0) {
            const last = this.lastLock.get(c.player ?? 0);
            if (last) this.noteLink(c.combo, last.rgb, last.shape);
            this.onCombo(Math.max(this.combo, c.combo));
        }
        if (c.b2b) {
            this.b2b = true;
            if (this.flock) this.flock.longWing = true;
        } else if (c.b2b === false && this.b2b) {
            // A clear that does not continue the back-to-back ends it: the long-wing lands.
            this.b2b = false;
            if (this.flock) this.flock.longWing = false;
        }
        // ── The rows leave the card horizontally, off both sides ──
        const { card, board } = this.sourceOf(c);
        const rows = c.rows && c.rows.length ? c.rows : [19];
        const { r: right } = this.frame.cam.basis;
        const left = [-right[0], -right[1], -right[2]];
        rows.forEach((row, k) => {
            const y = board.y0 + ((row + 0.5) / 20) * (board.y1 - board.y0);
            const accent = lineAccent(lines, k, accentA, accentB);
            const col = [0.6 + accent[0] * 1.4, 0.55 + accent[1] * 1.4, 0.45 + accent[2] * 1.4];
            this.effects.sheet(t + k * 0.04, this.worldAt(card.x0 - 0.012, y, NEAR_DEPTH), left, col, { speed: 26, length: 12, size: 0.85 });
            // Beside the HUD the right-hand pour drops straight down the card–HUD gap.
            const hud = this.layout?.hud;
            const inBand = hud && hud.x0 > card.x1 && y > hud.y0 - 0.03 && y < hud.y1 + 0.03;
            this.effects.sheet(t + k * 0.04, this.worldAt(card.x1 + 0.012, y, NEAR_DEPTH), right, col, {
                speed: inBand ? 5 : 26, length: 12, size: 0.85,
            });
        });
        if (lines >= 4 || c.perfect) {
            this.beginHush(c.perfect === true, lines);
            return;
        }
        // ── One surge down every fall per line ──
        for (let k = 0; k < lines; k++) {
            const accent = lineAccent(lines, k, accentA, accentB);
            // The five standing falls (the far hairlines are too thin to carry a front).
            for (let f = 0; f < SLOT.hair; f++) {
                if (!this.fallCpu[f]) continue;
                this.packet(f, this.U.waterClock.value + 0.15 + k * 0.3, 0.5, 1.2, accent, 1);
            }
        }
        // ── Release: the oldest held colours ride down the falls ──
        const n = RELEASE_PER_LINE * lines;
        const released = this.releaseOldest(this.b2b ? Math.ceil(n / 2) : n, t);
        if (!released) {
            // Nothing held: the Mother Fall and the span still carry the accent, so a clear answers.
            this.packet(SLOT.mother, this.U.waterClock.value + 0.3, 0.4, 1.0, accentA, 0);
            this.packet(SLOT.span, this.U.waterClock.value + 0.3, 0.4, 1.0, accentA, 0);
        }
        if (lines >= 2) {
            this.spanAt = t;
            this.flock?.bank(this.flightClock);
        }
        if (lines >= 3) this.burstAt = t;
        if (c.tspin) this.tspin(c);
        this.flare(0.27, 0.62, 0.22, 0.35 + lines * 0.12, accentA);
    }

    /** A T-spin: the falls are wrung, two children rise, the link colours turn, the bell swings. */
    tspin(c) {
        this.U.wring.value.set(this.U.waterClock.value, this.reduced ? 0.5 : 1);
        const { card, board } = this.sourceOf(c);
        const row = c.rows && c.rows.length ? c.rows[0] : 15;
        const y = board.y0 + ((row + 0.5) / 20) * (board.y1 - board.y0);
        this.flock?.helix(this.worldAt(card.x0 - 0.06, y, 120), this.flightClock);
        this.parts.isles?.swing(0.9);
        // The colours turn: each link's colour rolls one stroke along.
        const n = Math.min(STROKES, Math.max(1, Math.ceil(this.dial)));
        if (n > 1) {
            const last = this.links[n - 1].slice();
            for (let i = n - 1; i > 0; i--) this.links[i] = this.links[i - 1].slice();
            this.links[0] = last;
            this.bowInfo.links = this.links;
        }
    }

    /** The hush, then the glory and the great pour (four lines; a perfect clear is bigger). */
    beginHush(perfect, lines) {
        this.hush.at = this.time;
        this.hush.length = perfect ? HUSH_PERFECT : HUSH;
        this.hush.perfect = perfect;
        this.hush.rings = perfect ? 8 : Math.max(4, lines);
        this.pourAt = this.time + this.hush.length + 1.27;
        if (perfect) this.spillwayAt = this.time + this.hush.length + 1.6;
        this.bowFlashUntil = this.pourAt + 5;
    }

    /** A flare lift at a frame point (fractions), governed: never more than the post can carry. */
    flare(x, y, radius, strength, tint, kind = 'routine') {
        // The governor grants how strong it may be now; a flare it would have to queue, or one past
        // the allowance, is not played (the event's own light still is).
        const wanted = Math.min(1.2, strength);
        const area = Math.min(1, Math.PI * radius * radius);
        const grant = this.flashes.request(kind, wanted, area, 0, this.time);
        if (!(grant.strength > 0) || grant.at > this.time + 1e-3) return;
        const f = this.post.flare;
        const s = Math.min(wanted, grant.strength);
        if (s >= f[3]) {
            f[0] = x; f[1] = y; f[2] = radius; f[3] = s;
            this.post.flareTint[0] = 0.6 + tint[0] * 0.6;
            this.post.flareTint[1] = 0.6 + tint[1] * 0.6;
            this.post.flareTint[2] = 0.6 + tint[2] * 0.6;
        }
        this.post.iris = Math.min(this.post.iris, 1 / (1 + 0.6 * s * 0.5));
    }

    /** The colour of the lock that made link n (1-based). */
    noteLink(n, color, shape = null) {
        if (!(n >= 1 && n <= STROKES)) return;
        const rgb = Array.isArray(color) ? color : pieceLight(color, 0.35, [0, 0, 0]);
        this.links[n - 1] = rgb.slice();
        this.linkShapes[n - 1] = shape;
        if (n === 7) {
            const shapes = new Set(this.linkShapes.slice(0, 7).filter(Boolean));
            if (shapes.size === 7) this.trueBowAt = this.time;
        }
    }

    /** The longest chain on any board (0 = broken). */
    onCombo(n) {
        const combo = Math.max(0, Math.floor(Number(n) || 0));
        if (combo === 0 && this.combo > 0 && this.b2b) this.graceUntil = this.time + B2B_GRACE;
        if (combo === 0) {
            this.b2b = false;
            // The long-wing lands with the back-to-back.
            if (this.flock) this.flock.longWing = false;
        }
        this.combo = combo;
        this.dialTarget = Math.min(DIAL_MAX, combo);
    }

    levelUp(level, { silent = false } = {}) {
        this.wheel.levelUp?.(Math.max(1, Math.round(level)), this.time, { silent });
        if (silent) return;
        this.U.toll.value.set(this.time, 1);
        this.parts.isles?.swing(0.6);
        const crown = this.isleToWorld('spring', 0, PLAN.spring.top + 10, PLAN.spring.radius * 0.3);
        this.flock?.launch(crown, this.flightClock);
    }

    // ── Frame ──

    /** Clocks that change rate (the hush, the pour) are integrated, never time × speed. */
    integrate(dt) {
        const { U } = this;
        const t = this.time;
        const hushAge = t - this.hush.at;
        const hushing = hushAge >= 0 && hushAge < this.hush.length;
        const pourAge = t - this.pourAt;
        const pour = pourAge >= 0 && pourAge < 3 ? 1 + 1.2 * (1 - smooth(0, 3, pourAge)) : 1;
        const waterRate = hushing ? 0.15 : 1;
        const sprayRate = hushing ? 0.05 : 1;
        let flightRate = this.reduced ? 0.6 : 1;
        if (hushing) flightRate = 0.05;
        U.time.value = t;
        U.waterClock.value += dt * waterRate * pour;
        U.sprayClock.value += dt * sprayRate;
        U.mistClock.value += dt;
        this.flightClock += dt * flightRate;
        // The falls' width: thin in the hush, swollen in the pour, wide with the chain.
        const chain = 1 + 0.05 * Math.min(this.dial, 7);
        U.flow.value.y = (hushing ? 0.35 : 1) * (pourAge >= 0 && pourAge < 3 ? 1 + 0.4 * (1 - smooth(0, 3, pourAge)) : 1) * chain;
        U.flow.value.x = waterRate;
        U.drift.value.set(t * 0.0011, t * 0.0004);
        U.starTurn.value = t * 0.004;
        this.post.hush = hushing ? smooth(0, 0.08, hushAge) : Math.max(0, this.post.hush - dt * 6);
    }

    /** The hour's colours and numbers into the uniforms. */
    applyHour(time) {
        const place = this.wheel.placeAt(time);
        const h = hourAt(place, this.hour);
        const { U } = this;
        const rows = U.rows.array;
        COLOUR_ROWS.forEach((name, i) => {
            const c = h.colour[name];
            rows[i].set(c[0], c[1], c[2], 1);
        });
        SCALAR_UNIFORMS.forEach((name) => {
            if (U[name] && h.scalar[name] !== undefined) U[name].value = h.scalar[name];
        });
        this.showerHour = h.scalar.shower ?? 0.85;
        U.showerAmt.value = this.showerHour * (this.showerScale ?? 1);
        // The sky's own numbers.
        U.rays.value = h.scalar.rays ?? 0;
        U.cirrus.value = h.scalar.cirrus ?? 0;
        this.post.exposure = h.scalar.exposure ?? 1;
        this.post.gradeShadow = h.gradeShadow;
        this.post.gradeLight = h.gradeLight;
    }

    /** The dial eases toward the chain; strokes paint and withdraw one by one. */
    stepDial(dt) {
        const target = this.time < this.graceUntil ? Math.max(this.dialTarget, this.dial) : this.dialTarget;
        if (this.dial < target) {
            const backlog = target - this.dial;
            const rate = Math.max(1 / STROKE_SECONDS, backlog / 0.8);
            this.dial = Math.min(target, this.dial + rate * dt);
        } else if (this.dial > target) {
            this.dial = Math.max(target, this.dial - dt / UNWIND_SECONDS);
        }
        // The great pour flashes the whole primary for a while.
        const flash = this.time < this.bowFlashUntil && this.time > this.pourAt ? 1 : 0;
        this.U.bow.value.w = Math.max(this.dial, flash ? 7 : 0);
    }

    writeStrokes() {
        const rows = this.U.strokes.array;
        const flash = this.time < this.bowFlashUntil && this.time > this.pourAt;
        const trueBow = this.time - this.trueBowAt;
        for (let i = 0; i < STROKES; i++) {
            const progress = clamp01(this.dial - i);
            const flashOn = flash && i < 7 ? 1 : 0;
            rows[i].z = Math.max(progress, flashOn);
            rows[i].w = Math.max(progress > 0 ? 1 : 0, flashOn * 1.4);
            const link = this.links[i];
            // A true bow melts its threads into the spectrum.
            const thread = trueBow >= 0 && trueBow < 60 && i < 7 ? 0.35 * (1 - smooth(0, 2, trueBow)) : 0.35;
            rows[STROKES + i].set(link[0], link[1], link[2], thread);
        }
    }

    /** The glory: one ring per line after the hush, holding, then sinking into the mist. */
    stepGlory() {
        const { U } = this;
        const age = this.time - this.hush.at - this.hush.length;
        if (this.hush.at < -1e3 || age < -this.hush.length) {
            U.glory.value.set(0, 0, 0, this.oppRest);
            return;
        }
        const ringGap = this.hush.perfect ? 0.35 : 0.35;
        const firstRing = 0.07;
        let rings = 0;
        for (let k = 0; k < this.hush.rings; k++) if (age >= firstRing + k * ringGap) rings = k + 1;
        const opening = clamp01((age - firstRing - (rings - 1) * ringGap) / 0.5);
        const reveal = rings > 0 ? 1.2 + (rings - 1 + opening) * 1.05 : 0;
        const hold = this.hush.perfect ? GLORY_HOLD + 0.4 : GLORY_HOLD;
        const strength = age < 0 ? 0 : (1 - smooth(hold, hold + 4, age)) * smooth(0, 0.3, age);
        const opposition = age < 0 ? 0 : (1 - smooth(1, 6, age)) * 2;
        U.glory.value.set(strength, reveal, opposition, this.oppRest);
        // The wedges deepen while it holds.
        U.shadowDepth.value = Math.min(0.85, U.shadowDepth.value + 0.35 * strength);
        // The light behind us flares as the hush ends (governed).
        if (age >= 0 && age < 0.05) {
            const A = this.frame.Ascreen;
            this.flare(A.x, A.y, 0.25, 0.9, this.hour.colour.key, 'set');
        }
        // The great pour: every held colour goes down at once.
        if (this.pourAt > -1e3 && this.time >= this.pourAt && !this.pourDone) {
            this.pourDone = true;
            this.releaseOldest(Infinity, this.time, 0.1);
        }
        if (this.time < this.pourAt) this.pourDone = false;
    }

    /** The Far Gate's spillway (perfect clear only): a curtain unrolling from its threshold. */
    stepSpillway() {
        const age = this.time - this.spillwayAt;
        const { U } = this;
        if (age < 0 || age > 16) {
            clearFall(U.falls, SLOT.spillway);
            return;
        }
        const p = PLAN.gate;
        const flow = age < 13 ? 1 : 1 - smooth(13, 16, age);
        writeFall(U.falls, SLOT.spillway, {
            // From the attic's weir: a thread widening into a curtain through the opening.
            lip: this.isleToWorld('gate', this.parts.isles.anchors.weir.x, this.parts.isles.anchors.weir.y, this.parts.isles.anchors.weir.z),
            dir: this.isleDir('gate', 0, 1),
            v0: 9,
            width: p.width * (0.06 + 0.2 * smooth(0, 2, age)),
            spread: 4,
            duration: 14,
            flow,
            kind: FALL_KIND.pour,
            bornAt: U.waterClock.value - age,
        });
    }

    /** Spray at the falls' feet and lips (closed form in the spray clock). */
    emitSpray() {
        const { spray } = this.parts;
        if (!spray) return;
        spray.begin();
        const { U } = this;
        const clock = U.sprayClock.value;
        const cap = spray.capacity;
        const level = (this.hour.scalar.spray ?? 1) * (1 + 0.3 * Math.min(this.dial, 7));
        const burstAge = this.time - this.burstAt;
        const burst = burstAge >= 0 && burstAge < 3.4 ? 1 + 2 * (1 - smooth(0.4, 3.4, burstAge)) * smooth(0, 0.4, burstAge) : 1;
        const p = this.scratch.a;
        // Emitters: the Mother Fall's skirt (most of it), the span, the horsetails.
        const emitters = [
            {
                slot: SLOT.mother, share: 0.62, rest: 0.22, size: 24, rise: 3.2, drift: 2.6, from: 0.5,
            },
            {
                slot: SLOT.span, share: 0.16, rest: 0.08, size: 15, rise: 2, drift: 1.4, from: 0.3,
            },
            {
                slot: SLOT.horse, share: 0.08, rest: 0.05, size: 10, rise: 1.5, drift: 1, from: 0.3,
            },
            {
                slot: SLOT.horse + 1, share: 0.07, rest: 0.05, size: 10, rise: 1.5, drift: 1, from: 0.3,
            },
            {
                slot: SLOT.horse + 2, share: 0.07, rest: 0.05, size: 10, rise: 1.5, drift: 1, from: 0.3,
            },
        ];
        const { r: right } = this.frame.cam.basis;
        let id = 0;
        for (const e of emitters) {
            const fall = this.fallCpu[e.slot];
            if (!fall) continue;
            const n = Math.floor(cap * e.share);
            const boost = e.slot === SLOT.mother ? burst : 1;
            for (let k = 0; k < n; k++, id++) {
                const h0 = hash(id + 0.13);
                const h1 = hash(id * 1.7 + 4.1);
                const h2 = hash(id * 2.3 + 9.7);
                const life = 5 + h1 * 4;
                const phase = frac(clock / life + h0);
                const s = e.from + (1 - e.from) * (0.15 + 0.85 * h2);
                fallPoint(fall, s * fall.duration * (U.flow.value.y > 0 ? 1 : 1), p);
                const age = phase * life;
                const ang = h1 * Math.PI * 2;
                const spread = fall.width * (0.4 + h0) + age * 2.5;
                const x = p[0] + Math.cos(ang) * spread + right[0] * e.drift * age;
                const y = p[1] + e.rise * age * (0.6 + h2) * boost;
                const z = p[2] + Math.sin(ang) * spread * 0.6 + right[2] * e.drift * age;
                const size = e.size * (0.5 + phase * 1.4) * (0.7 + h2 * 0.6) * (boost > 1 ? 1.3 : 1);
                const density = Math.sin(Math.PI * phase) * 0.8 * Math.min(2, level * boost) * (0.5 + 0.5 * h1);
                const bow = e.rest * (burst > 1 && e.slot === SLOT.mother ? 4 : 1);
                spray.push(x, y, z, size, density, h0 * 6.28 + phase * 0.6, h2, bow);
            }
        }
        spray.end();
    }

    /** The newest held pools light the stone round them (the shader reads `tier.lamps` rows). */
    writeLamps() {
        const rows = this.U.lamps.array;
        const n = Math.min(12, this.tier.lamps);
        const live = [];
        this.held.forEach((h, slot) => {
            const age = this.time - h.at;
            if (age < 0 || age > 30) return;
            live.push(slot);
        });
        live.sort((a, b) => this.held[b].at - this.held[a].at);
        for (let i = 0; i < 12; i++) {
            const slot = i < n ? live[i] : undefined;
            if (slot === undefined) {
                rows[i * 2].set(0, -1e5, 0, 1);
                rows[i * 2 + 1].set(0, 0, 0, 0);
                continue;
            }
            const h = this.held[slot];
            const info = this.poolSlots.find((p) => p.slot === slot);
            const age = this.time - h.at;
            const env = smooth(0, 0.3, age) * (age < 18 ? 1 : Math.exp(-(age - 18) / 6))
                * (h.released ? Math.max(0, 1 - (this.time - h.releasedAt) / 0.8) : 1);
            const w = info ? info.world : [0, -1e5, 0];
            rows[i * 2].set(w[0], w[1] - 3, w[2], 9);
            rows[i * 2 + 1].set(h.rgb[0], h.rgb[1], h.rgb[2], env);
        }
    }

    /** The glows: event effects, trails and brush heads, the sleepers in the grotto. */
    emitGlows() {
        const { fx } = this.parts;
        if (!fx) return;
        const g = fx.glows;
        g.begin();
        const push = g.push.bind(g);
        this.effects.emit(this.time, push);
        // The landed locks fill their pools.
        const landed = this.effects.landed(this.time);
        for (const r of landed) {
            if (r.pool >= 0) {
                this.holdPool(r.pool, r.colour, this.time, false);
                this.parts.pools.ring(r.pool, this.time, r.hard ? 1.7 : 1);
                const d = Math.hypot(r.to[0], r.to[1], r.to[2]);
                const size = Math.max(1.2, d * 0.006);
                this.effects.crown(this.time, r.to, r.colour, {
                    count: r.hard ? 24 : 14, size, speed: size * 5, flash: true,
                });
                // The landing flares where it lands (read even with bloom off).
                const p = this.screenOf([r.to[0] / d, r.to[1] / d, r.to[2] / d], this.scratch.p);
                this.flare(p.x, p.y, 0.035, r.hard ? 0.7 : 0.45, r.colour);
            }
        }
        // Each held pool is a jewel: a soft glow of its colour over the water, readable from here.
        for (let i = 0; i < this.poolSlots.length; i++) {
            const info = this.poolSlots[i];
            const h = this.held[info.slot];
            if (!h || h.at < -1e3) continue;
            const age = this.time - h.at;
            if (age < 0) continue;
            const env = smooth(0, h.silent ? 1.5 : 0.25, age) * (age < 18 ? 1 : Math.exp(-(age - 18) / 6))
                * (h.released ? Math.max(0, 1 - (this.time - h.releasedAt) / 0.8) : 1);
            if (env < 0.02) continue;
            const w = info.world;
            const d = Math.hypot(w[0], w[1], w[2]);
            const r = Math.max(4.5, d * 0.012);
            const b = 0.55 * env;
            push(w[0], w[1] + 1, w[2], r, h.rgb[0] * b, h.rgb[1] * b, h.rgb[2] * b, GLOW.soft);
        }
        // The toll: a gold pulse at the bell as the hour turns.
        const tollAge = this.time - this.U.toll.value.x;
        if (tollAge >= 0 && tollAge < 1.4 && this.parts.isles) {
            const a = this.parts.isles.anchors.bell;
            const bw = this.isleToWorld('spring', a.x, a.y - 3, a.z, this.scratch.c);
            const k = (1 - tollAge / 1.4) ** 2;
            const { key } = this.hour.colour;
            push(bw[0], bw[1], bw[2], 9 + tollAge * 12, key[0] * 4 * k, key[1] * 3.6 * k, key[2] * 2.6 * k, GLOW.glow);
        }
        // The children's trails and the brush heads.
        const poses = this.flock?.poses || [];
        for (let i = 0; i < poses.length; i++) {
            const pz = poses[i];
            const tr = this.trails[i];
            if (!tr) continue;
            const m = tr.pts.length / 3;
            if (pz.trail > 0 && pz.scale > 0) {
                tr.pts[tr.head * 3] = pz.pos[0];
                tr.pts[tr.head * 3 + 1] = pz.pos[1];
                tr.pts[tr.head * 3 + 2] = pz.pos[2];
                tr.head = (tr.head + 1) % m;
                tr.n = Math.min(m, tr.n + 1);
                const d = Math.hypot(pz.pos[0], pz.pos[1], pz.pos[2]);
                for (let k = 0; k < tr.n; k++) {
                    const j = (tr.head - 1 - k + m * 2) % m;
                    const f = 1 - k / m;
                    const b = 2.2 * f * pz.trail;
                    push(
                        tr.pts[j * 3],
                        tr.pts[j * 3 + 1],
                        tr.pts[j * 3 + 2],
                        d * 0.0035 * (0.5 + f * 0.6),
                        pz.colour[0] * b,
                        pz.colour[1] * b,
                        pz.colour[2] * b,
                        GLOW.glow,
                    );
                }
                if (pz.mode === 1) {
                    // The brush head: the link's colour, hot.
                    push(pz.pos[0], pz.pos[1], pz.pos[2], d * 0.009, pz.colour[0] * 4, pz.colour[1] * 4, pz.colour[2] * 4, GLOW.glow);
                }
            } else {
                tr.n = 0;
            }
        }
        // The sleepers in the grotto: a breathing warm heap behind the Mother Fall (night, dawn).
        const hearth = this.hour.scalar.hearth ?? 0;
        if (hearth > 0.02 && this.placement.spring) {
            const m = outletAt(this.parts.isles.outlets.spring, this.motherBearing());
            const n = Math.round(this.tier.sleepers * hearth);
            const base = this.isleToWorld('spring', m.x + m.nx * 3, m.y - 12, m.z + m.nz * 3, this.scratch.b);
            const warm = this.hour.colour.hearth;
            for (let k = 0; k < n; k++) {
                const h0 = hash(k + 101);
                const h1 = hash(k * 3.1 + 7);
                const breathe = 0.7 + 0.3 * Math.sin((this.time * (0.25 + h1 * 0.2) + h0) * Math.PI * 2);
                const x = base[0] + (h0 - 0.5) * 14;
                const y = base[1] + h1 * 5 - 2;
                const z = base[2] + (hash(k * 5.7) - 0.5) * 6;
                const b = hearth * breathe * 1.6;
                push(x, y, z, 1.6 + h1 * 1.2, warm[0] * b, warm[1] * b, warm[2] * b, GLOW.glow);
            }
            // The grotto's own warmth: one wide, dim glow round the heap (the night's warm note).
            const w = hearth * (0.55 + 0.1 * Math.sin(this.time * 0.6));
            push(base[0], base[1] + 2, base[2], 22, warm[0] * w, warm[1] * w * 0.85, warm[2] * w * 0.6, GLOW.soft);
        }
        g.end();
    }

    update(sim, camera) {
        const dt = Math.max(0, sim.delta ?? 0);
        this.time = sim.time;
        this.integrate(dt);
        this.applyHour(this.time);
        this.stepDial(dt);
        this.writeStrokes();
        this.stepGlory();
        this.stepSpillway();
        // The broken span runs (two lines): it pours broad for 3 s.
        const spanAge = this.time - this.spanAt;
        if (this.fallCpu[SLOT.span]) {
            const rows = this.U.falls.array;
            rows[SLOT.span * 3 + 2].z = spanAge >= 0 && spanAge < 3.5 ? 1 + 1.2 * (1 - smooth(0.5, 3.5, spanAge)) : 1;
        }
        this.parts.isles?.update(dt, this.time);
        if (this.flock && this.parts.gliders) {
            this.bowInfo.dial = this.dial;
            this.parts.gliders.write(this.flock.sample(this.flightClock, this.bowInfo, this.hour.scalar.aloft ?? 1));
        }
        this.emitSpray();
        this.emitGlows();
        this.writeLamps();
        if (camera) this.parts.sky?.follow(camera);
        // The lens recovers.
        this.post.iris += (1 - this.post.iris) * approach(1.5, dt);
        this.post.flash *= Math.exp(-dt * 4);
        this.post.bloomBoost *= Math.exp(-dt * 2);
        this.post.flare[3] *= Math.exp(-dt * 2.5);
    }

    getPostState() {
        return this.post;
    }

    getState() {
        return {
            quality: this.quality,
            plan: this.frame.plan,
            place: this.wheel.placeAt(this.time),
            hour: this.hour.from,
            combo: this.combo,
            dial: this.dial,
            held: this.held.filter((h) => !h.released).length,
            A: { x: this.frame.Ascreen.x, y: this.frame.Ascreen.y },
            sunElevation: Math.asin(clamp(-this.frame.A[1], -1, 1)) / DEG,
        };
    }

    dispose() {
        Object.values(this.parts).forEach((part) => part.dispose?.());
        this.parts = {};
        this.textures.forEach((t) => t.dispose());
        this.textures = [];
        this.scene?.remove(this.root);
        this.root.clear();
        this.built = false;
    }
}

export { hexToLinear };
