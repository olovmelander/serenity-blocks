/**
 * Painted Ages — one shared world (the theme and the playground mount the same one).
 *
 * The badlands seen from the overlook: the baked land (three nested fields) under the hour's
 * light, the sky with its cloud deck and cumulus banks, the boardwalk and pavilion, poplars along
 * the river, and everything gameplay does to them:
 *
 *   lock        the bed where the piece "landed" (a point of the land beside the card, by column
 *               and row) lights up in the piece's colour and the light races along it across
 *               every hill it crosses; a puff of pigment dust rises (a hard drop: a wider, faster
 *               ribbon, a ring of light along the ground, sparks)
 *   clear       a band of light per cleared row, in that row's colours, climbs the strata through
 *               the whole land; pigment rises from the hills; the rows are laid down as the newest
 *               beds of the record, which crowns the high ground and settles one bed per row
 *   chain       a shower walks in from the horizon: rain veils, the wet land darkening and its
 *               colours deepening; when the chain breaks, a rainbow over the valley (doubled
 *               after a long one), and the rock dries in the sun
 *   four lines  a rainbow tide climbs every bed, and a flash flood of coloured water races down
 *               the river through the valley
 *   T-spin      a dust devil of pigment spins up from the valley floor
 *   b2b         mica glints on the sunlit rock
 *   perfect     the clouds take the mineral colours, every bed lights, a double bow
 *   level up    the day steps an hour forward (it also turns with the clock alone); a pale marker
 *               bed of light climbs the land
 *   game over   dusk falls and the lanterns light; morning returns with the next run
 *
 * Everything gameplay lights ACCUMULATES (src/themes/shared/gameplay-surge.js): a new band joins
 * the ones still climbing (the faintest gives way when the table is full), a second bow or flood
 * or painted sky carries on from what is showing, and the heat of play builds the badlands' own
 * crescendo. Calm play looks as it always did. A quick hand stirs the world (the deck's wind
 * quickens, the sun burns brighter, the ribbons run further); a hot chain brings the storm in
 * dark over a land that starts to glow; and in a fever the painted beds burn in their own
 * pigments under the storm, a tide of colour climbing every hill, the clouds catch the colours,
 * the river runs full with the latest rows' paint and the view leans in. A perfect clear crowns
 * it (the whole sky painted, a double bow), the chain's break releases the bow over a soaked land
 * that dries for TIMING.dry, and when the hands rest the world breathes back to calm.
 *
 * Lifecycle: `await PaintedAgesWorld.prepare(quality, { signal })` reads the baked fields and
 * builds the land's mesh in slices; `new PaintedAgesWorld({ ..., prepared }).build()` makes the
 * scene objects; each frame `updateCamera` → `update` → `prerender(renderer)` → the post renders.
 */
import * as THREE from 'three/webgpu';
import {
    DEG, EYE, FIELDS, FIELD_ORDER, PIECE_COLORS, RECORD_ROWS, RIG, StrataRecord, TAU, TIMING, approach, buildBeds,
    clamp, hexToLinear, mulberry32, rigFor, smooth, strataG,
} from './painted-ages-core.js';
import {
    HOURS, HourWheel, blendLight, copyLight, createLight, lightAt,
} from './painted-ages-hours.js';
import { tierFor } from './painted-ages-quality.js';
import { breathe, loadBadlands, planBadlands } from './painted-ages-assets.js';
import {
    createColumnTexture, createFieldTexture, createFlowTexture, createLatticeTexture, createNoiseTexture,
    createRecordTexture, createUniforms, fieldTextureData,
} from './painted-ages-tsl.js';
import {
    bilinear, fieldCoords, fieldInset, groundHeight,
} from './painted-ages-field.js';
import { RIVER_LENGTH } from './painted-ages-plan.js';
import { createProps } from './painted-ages-props.js';
import { createCumulus } from './painted-ages-cumulus.js';
import { createPoplars } from './painted-ages-life.js';
import { EventTables, MOTE_KIND, Motes } from './painted-ages-fx.js';
import { createFanGeometry, createLandMaterial, fanPositionSteps } from './painted-ages-land.js';
import { createShadowPass } from './painted-ages-shadow.js';
import { createSky } from './painted-ages-sky.js';
import { cardUnion, fallbackLayout } from './painted-ages-composition.js';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';

export const PAINTED_AGES_PARTS = Object.freeze(['land', 'sky', 'props', 'cumulus', 'poplars', 'motes']);
export const REST_RIG = Object.freeze({ near: RIG.near, far: RIG.far });
export const fovForAspect = (aspect) => rigFor(aspect).fov;

const COUNTERS = ['locks', 'hardDrops', 'clears', 'lines', 'quads', 'tspins', 'perfects', 'chainSteps', 'releases', 'b2bSteps', 'levelUps', 'gameOvers', 'mornings'];
const emptyCounts = () => Object.fromEntries(COUNTERS.map((k) => [k, 0]));
/** The newest record beds the land shows (older ones return to the land's own beds). */
export const RECORD_SHOWN = 24;
/** The record's top bed stands at this geological height (the high ground near the eye). */
export const RECORD_TOP = 150;
/** Session scalars a rebuild in place carries over. */
const SNAPSHOT = Object.freeze([
    'time', 'level', 'combo', 'peak', 'b2b', 'wetLevel', 'showerPower', 'showerFront', 'bowAt', 'bowStrength', 'bowSecond',
    'bowSince', 'bowSecondShown', 'perfectAt', 'duskFrom', 'duskTarget', 'duskAt', 'sheenLevel', 'floodAt', 'floodEnd',
    'floodFront', 'depositAt', 'settleFrom', 'freshRows', 'lastLockAt', 'windDrift', 'nod', 'zoom', 'warmth', 'floodHead',
]);
/** A rain streak's life (s): it falls from above the eye to below it. */
const RAIN_LIFE = 6;
/** The bow fades in over this long (s); a painted sky over PAINT_IN. */
const BOW_IN = 2.2;
const PAINT_IN = 1.5;
/** Where the flood's front starts (metres along the river) and how fast it runs (m/s). */
const FLOOD_SOURCE = RIVER_LENGTH - 2900;
const FLOOD_SPEED = 950;
/** The most record beds that glow together while a chain lays them down. */
const FRESH_ROWS = 8;
/** The glint a back-to-back clear's bands carry (linear). */
const MICA = [1.3, 1.15, 0.85];

/** Where smooth(0, 1, x) reaches v (its inverse on [0, 1]): to pick a fade up where it stands. */
function unsmooth(v) {
    const c = clamp(v, 0, 1);
    return 0.5 - Math.sin(Math.asin(1 - 2 * c) / 3);
}

/** A swell's whole state (src/themes/shared/swell.js), for a rebuild in place. */
const swellState = (swell) => ({
    slow: swell.slow,
    fast: swell.fast,
    t0: swell.t0,
    present: swell.present,
    pendingAt: Array.from(swell.pendingAt),
    pendingAmount: Array.from(swell.pendingAmount),
});

function loadSwell(swell, state) {
    if (!state) return;
    swell.slow = state.slow;
    swell.fast = state.fast;
    swell.t0 = state.t0;
    swell.present = state.present;
    if (state.pendingAt?.length === swell.pendingAt.length) swell.pendingAt.set(state.pendingAt);
    if (state.pendingAmount?.length === swell.pendingAmount.length) swell.pendingAmount.set(state.pendingAmount);
}

/** How hot play ran, so a rebuilt world carries the heat on instead of dropping it. */
const SURGE_SCALARS = Object.freeze(['shown', 'shownAt', 'fever', 'feverAt', 'stage']);

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

/** Read the baked land and prepare it, yielding to the page between slices (abortable). */
async function prepareData(quality, { signal } = {}) {
    const fields = await loadBadlands({ signal });
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
function prepareDataSync(quality, fields = planBadlands()) {
    const steps = prepareSteps(quality, fields);
    for (;;) {
        const next = steps.next();
        if (next.done) return next.value;
    }
}

const PIECE_LINEAR = PIECE_COLORS.map((c) => hexToLinear(c));
const DUST = [0.62, 0.46, 0.34];

export class PaintedAgesWorld {
    /** Read the baked land and build the mesh data, yielding to the page between slices. */
    static prepare(quality = 'High', { signal } = {}) {
        return prepareData(quality, { signal });
    }

    /** The same, synchronously, from the plan or given fields (unit tests; no network). */
    static prepareSync(quality = 'High', fields = undefined) {
        return prepareDataSync(quality, fields);
    }

    constructor({
        scene, quality = 'High', capture = false, seed = 0x5ed1, prepared = null,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture;
        this.seed = seed;
        this.prepared = prepared;
        this.root = new THREE.Group();
        this.root.name = 'Painted Ages';
        this.parts = {};
        this.partList = [];
        this.u = createUniforms();
        this.beds = buildBeds();
        this.record = new StrataRecord(seed);
        this.wheel = new HourWheel();
        this.light = createLight();
        this._hourLight = createLight();
        this._duskLight = lightAt(5);
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1920, 1080);
        this.layoutLive = false;
        this.reducedMotion = false;
        this.disposed = false;
        this._camera = null;
        this._sunScreen = new THREE.Vector3();
        this._sunWorld = new THREE.Vector3();
        this._ray = new THREE.Vector3();
        this._hit = { x: 0, y: 0, z: 0 };
        this._rgb = [0, 0, 0];
        this._row = [0, 0, 0];
        this._post = {
            exposure: 1,
            bloomBoost: 0,
            sun: {
                x: 0.5, y: 0.3, onScreen: 0, strength: 0,
            },
            shaftColour: [1, 0.8, 0.6],
            flash: 0,
            flashColour: [1, 0.9, 0.75],
            saturation: 1.06,
        };
        this.overrides = { hour: null, recordTop: null };
        this.random = mulberry32(seed ^ 0x51ab);
        this.tables = new EventTables(this.u);
        /**
         * How hot play runs (src/themes/shared/gameplay-surge.js), sampled once a frame on the
         * world's clock: `heat` is the latest sample (the camera reads the last frame's).
         */
        this.surge = new GameplaySurge();
        this.heat = this.surge.sample(0);
        /** The frame-wide flash of a quad or a perfect clear: every hit adds to what is still lit. */
        this.flash = new Swell({ release: 0.32, ceiling: 0.6, knee: 0.4 });
        /** A back-to-back clear's flare of mica on the rock (on top of the run's held sheen). */
        this.sheenKick = new Swell({
            attack: 0.08, release: 1.6, ceiling: 1.2, knee: 0.8,
        });
        /** The river's four lanes of pigment: the latest cleared rows' colours (a flood carries them). */
        this.floodLanes = new Float64Array(12);
        this.floodHead = 0;
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
        this.wetLevel = 0;
        this.showerPower = 0;
        this.showerFront = 9000;
        this.bowAt = -1e6;
        this.bowSince = -1e6;
        this.bowStrength = 0;
        this.bowSecond = 0;
        this.bowSecondShown = 0;
        this.perfectAt = -1e6;
        this.duskFrom = 0;
        this.duskTarget = 0;
        this.duskAt = -1e6;
        this.dusk = 0;
        this.sheenLevel = 0;
        this.floodAt = -1e6;
        this.floodEnd = -1e6;
        this.floodFront = FLOOD_SOURCE;
        this.riverPower = 0;
        this.depositAt = -1e6;
        this.settleFrom = 0;
        this.freshRows = 1;
        this.lastLockAt = -1e6;
        this.rainCarry = 0;
        this.windDrift = 0;
        this.nod = 0;
        this.zoom = 0;
        this.warmth = 0;
        this.tables.reset();
        this.motes?.clear();
        this.surge.reset();
        this.heat = this.surge.sample(time);
        this.flash.reset();
        this.sheenKick.reset();
    }

    build() {
        if (this.root.parent) return this;
        const prepared = this.prepared || PaintedAgesWorld.prepareSync(this.quality);
        this.prepared = null;
        this.source = prepared.source;
        const { tier } = this;
        const fieldTex = {};
        for (const name of FIELD_ORDER) fieldTex[name] = createFieldTexture(prepared.textures[name], FIELDS[name]);
        const flowTex = {
            near: createFlowTexture(prepared.fields.near.flow, FIELDS.near),
            mid: createFlowTexture(prepared.fields.mid.flow, FIELDS.mid),
        };
        this.fields = prepared.fields;
        this.textures = {
            fields: fieldTex,
            flow: flowTex,
            column: createColumnTexture(this.beds),
            record: createRecordTexture(this.record),
            noise: createNoiseTexture(),
            lattice: createLatticeTexture(),
        };
        this.shadowPass = createShadowPass(this.u, fieldTex, tier);
        this.textures.shadow = this.shadowPass.textures;

        // The land.
        const geometry = createFanGeometry(prepared.positions, tier.fanCols, tier.fanRows);
        const material = createLandMaterial(this.u, this.textures, tier);
        const land = new THREE.Mesh(geometry, material);
        land.name = 'PaintedAgesLand';
        land.frustumCulled = false;
        land.renderOrder = 0;
        this.addPart('land', {
            mesh: land,
            dispose() {
                geometry.dispose();
                material.dispose();
            },
        });
        this.addPart('props', createProps(this.u, this.textures, tier, this.fields));
        this.addPart('poplars', createPoplars(this.u, this.textures, tier, this.fields));
        this.addPart('sky', createSky(this.u, this.textures, tier));
        this.addPart('cumulus', createCumulus(this.u, this.textures, tier, tier.banks));
        this.motes = new Motes(this.u, tier.motes);
        this.addPart('motes', {
            mesh: this.motes.mesh,
            dispose: () => this.motes.dispose(),
        });
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
        const yaw = rig.yaw + move * (Math.sin((TAU * time) / 71) * 0.35 + clamp(pointerX, -1, 1) * 0.8);
        // Play moves the view: each hit nods it toward the land (riding on a floor under a quick
        // hand), and in a fever it leans in over the valley (update() eases both).
        const pitch = rig.pitch
            + move * (Math.sin((TAU * time) / 53) * 0.12 - clamp(pointerY, -1, 1) * 0.25 - this.nod);
        if (move && this.zoom > 0) camera.fov = rig.fov * (1 - 0.045 * this.zoom);
        camera.rotation.set(pitch * DEG, -yaw * DEG, 0, 'YXZ');
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
    }

    updateCamera(camera, sim) {
        this.time = Number.isFinite(sim.time) ? sim.time : this.time;
        this.pose(camera, this.time, sim.pointerX || 0, sim.pointerY || 0);
        // The shared breath (shared/camera-breath.js) on top of the pose, turning the view
        // only (a look out from the summit over the badlands): off under reduced motion. Events
        // aim through the camera before update() runs, so its matrix is refreshed here.
        applyCameraBreath(camera, this.time, { scale: this.reducedMotion ? 0 : 1 });
        camera.updateMatrixWorld();
        this._camera = camera;
    }

    // ── Where on the land an event happens ────────────────────────────────────────

    /**
     * The land under a screen point (fractions, y down), by marching the camera's ray. Ground
     * nearer than `near` metres (the summit the eye stands on) is passed through: an event lands
     * on the land beyond it, never in front of the lens.
     */
    landAt(sx, sy, out = this._hit, near = 80) {
        const camera = this._camera;
        if (!camera || !this.fields) return null;
        camera.updateMatrixWorld();
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        const o = camera.position;
        const d = this._ray;
        let prev = near;
        let inside = true;
        for (let t = near; t < 9000; t += Math.max(1.2, t * 0.012)) {
            const x = o.x + d.x * t;
            const z = o.z + d.z * t;
            const y = o.y + d.y * t;
            const under = y < groundHeight(this.fields, x, z);
            // Still inside the near ground: walk on until the ray comes out of it.
            if (inside) {
                inside = under;
                prev = t;
                continue;
            }
            if (under) {
                let a = prev;
                let b = t;
                for (let k = 0; k < 12; k++) {
                    const m = (a + b) / 2;
                    if (o.y + d.y * m < groundHeight(this.fields, o.x + d.x * m, o.z + d.z * m)) b = m;
                    else a = m;
                }
                out.x = o.x + d.x * b;
                out.z = o.z + d.z * b;
                out.y = groundHeight(this.fields, out.x, out.z);
                out.distance = b;
                return out;
            }
            prev = t;
        }
        return null;
    }

    /**
     * The screen point an event at board column `u` and row `row` lands on: the visible land on
     * that side of the card (column 0 far left … column 1 far right), the floor rows nearest.
     */
    sitePoint(u = 0.5, row = 14) {
        const card = cardUnion(this.layout) || {
            x0: 0.41, x1: 0.59, y0: 0.08, y1: 0.93,
        };
        const f = clamp(row, 0, 19) / 19;
        if (this.aspect < 0.75) {
            // Portrait: the land shows below the card (or, if the card fills it, just under it).
            const top = Math.min(0.94, card.y1 + 0.025);
            return { x: 0.08 + clamp(u, 0, 1) * 0.84, y: top + (0.985 - top) * (0.3 + 0.7 * f) };
        }
        const { hud } = this.layout;
        let lo;
        let hi;
        let k;
        if (u < 0.5) {
            lo = 0.04;
            hi = card.x0 - 0.035;
            k = u / 0.5;
        } else {
            lo = card.x1 + 0.035;
            hi = 0.96;
            if (hud && hud.x0 > card.x1 && hud.x1 < hi) {
                if (0.96 - hud.x1 > hud.x0 - lo) lo = hud.x1 + 0.025;
                else hi = hud.x0 - 0.025;
            }
            k = (u - 0.5) / 0.5;
        }
        return { x: lo + (hi - lo) * clamp(k, 0, 1), y: 0.5 + 0.38 * f };
    }

    /** A land point for an event, trying nearby rows of the screen if the first ray finds none. */
    landSite(u, row) {
        const p = this.sitePoint(u, row);
        // Try the point, then a little above and below it in turn.
        for (let k = 0; k < 9; k++) {
            const step = Math.ceil(k / 2) * 0.045 * (k % 2 ? -1 : 1);
            const hit = this.landAt(p.x, Math.min(0.99, Math.max(0.3, p.y + step)));
            if (hit) return hit;
        }
        return null;
    }

    /** The geological height the land's shader gives a point (its beds follow the land smoothed). */
    gAt(x, y, z) {
        const { mid } = FIELDS;
        const w = clamp(fieldInset(mid, x, z) / 500, 0, 1);
        let ys = y;
        if (w > 0 && this.fields?.mid) {
            const c = fieldCoords(mid, x, z);
            const hMid = bilinear(this.fields.mid.heights, mid.size, c.fx, c.fz);
            ys = y + (hMid - y) * w * w * (3 - 2 * w) * 0.8;
        }
        return strataG(x, ys, z);
    }

    pigment(color, out = this._rgb) {
        hexToLinear(typeof color === 'string' ? color : PIECE_COLORS[0], out);
        return out;
    }

    /**
     * A cleared row's colour: its most common piece's pigment (a mean of ten pigments is mud).
     * Garbage counts for nothing; a row the board never named takes a pigment by its place.
     */
    rowColour(codes, k, out = this._row) {
        const tally = [0, 0, 0, 0, 0, 0, 0];
        let known = 0;
        for (let c = 0; c < 10; c++) {
            const code = codes && codes.length >= (k + 1) * 10 ? Math.round(codes[k * 10 + c]) : -1;
            if (code >= 0 && code < 7) {
                tally[code] += 1;
                known += 1;
            }
        }
        let best = (k * 3 + 1) % 7;
        if (known) for (let i = 0; i < 7; i++) if (tally[i] > tally[best]) best = i;
        const rgb = PIECE_LINEAR[best];
        out[0] = rgb[0];
        out[1] = rgb[1];
        out[2] = rgb[2];
        return out;
    }

    /** A puff of motes at a land point. */
    puff(p, rgb, {
        count = 16, spread = 2, rise = 2.5, size = 1.8, life = 3, kind = MOTE_KIND.dust, delay = 0,
    } = {}) {
        if (!this.motes) return;
        this.motes.now = this.time;
        const r = this.random;
        for (let i = 0; i < count; i++) {
            const a = r() * TAU;
            const s = spread * (0.3 + r() * 0.7);
            const tint = r() * 0.4;
            this.motes.spawn({
                x: p.x + Math.cos(a) * s * 0.4,
                y: p.y + 0.5 + r() * 1.5,
                z: p.z + Math.sin(a) * s * 0.4,
                vx: Math.cos(a) * s,
                vy: rise * (0.5 + r()),
                vz: Math.sin(a) * s,
                born: this.time + delay + r() * 0.15,
                life: life * (0.7 + r() * 0.6),
                rgb: [rgb[0] * (1 - tint) + DUST[0] * tint, rgb[1] * (1 - tint) + DUST[1] * tint, rgb[2] * (1 - tint) + DUST[2] * tint],
                size: size * (0.6 + r() * 0.8),
                kind,
                seed: r(),
                swirl: kind === MOTE_KIND.dust ? 0.8 : 0,
                rise: kind === MOTE_KIND.dust ? 0.25 : -3,
            });
        }
    }

    // ── Gameplay ──────────────────────────────────────────────────────────────────

    onLock(context = {}) {
        if (this.disposed) return;
        this.counts.locks++;
        const hard = Boolean(context.hardDrop);
        if (hard) this.counts.hardDrops++;
        this.lastLockAt = this.time;
        this.surge.lock(context, this.time);
        if (this.duskTarget > 0) this.onSessionStart();
        const rows = Array.isArray(context.rows) && context.rows.length ? context.rows : [14];
        const row = rows.reduce((a, b) => a + b, 0) / rows.length;
        const p = this.landSite(context.u ?? 0.5, row);
        if (!p) return;
        const rgb = this.pigment(context.color);
        const g = this.gAt(p.x, p.y, p.z);
        const drop = clamp((context.distance || 0) / 18, 0, 1);
        // A quick hand's ribbons burn brighter and run further (nothing changes under casual play).
        const pace = this.warmth;
        this.tables.addRibbon({
            x: p.x,
            z: p.z,
            g,
            time: this.time,
            rgb,
            power: (hard ? 6.0 + drop * 2 : 4.4) * (1 + 0.35 * pace),
            half: hard ? 5.0 : 3.6,
            speed: (hard ? 270 : 175) * (1 + 0.25 * pace),
            reach: (hard ? 1500 : 950) * (1 + 0.45 * pace),
            kind: hard ? 1 : 0,
            life: hard ? 3.8 : 3.4,
        });
        // Pigment dust where it landed; spread with the distance (a far point needs larger motes).
        const scale = clamp(p.distance / 250, 0.5, 6);
        this.puff(p, rgb, {
            count: Math.round((hard ? 70 : 40) * (1 + 0.4 * pace)),
            spread: 3 * scale,
            rise: 3 * scale,
            size: 1.5 * scale,
            life: 3.4,
        });
        if (hard) {
            this.puff(p, rgb, {
                count: 22, spread: 9 * scale, rise: 7 * scale, size: 1.1 * scale, life: 1.6, kind: MOTE_KIND.spark,
            });
        }
    }

    onClear(context = {}) {
        if (this.disposed) return;
        const codes = context.rowCodes || [];
        // A perfect clear settles after its clear's last wave, on its own (no rows): it crowns the
        // clear still playing rather than replaying one. One that carries its rows is both.
        if (context.perfect && codes.length < 10) {
            this.onPerfect();
            return;
        }
        const lines = clamp(Math.round(context.lines || 1), 1, 4);
        this.counts.clears++;
        this.counts.lines += lines;
        const t = this.time;
        // The rows go into the record, the newest on top.
        for (let k = 0; k < lines; k++) {
            const rowCodes = codes.length >= (k + 1) * 10 ? codes.slice(k * 10, k * 10 + 10) : null;
            this.record.deposit(rowCodes, { time: t + k * TIMING.rowStagger });
        }
        this.deposited(lines, t);
        // A band of light per row climbs the strata, in that row's colours. A long chain keeps
        // brightening them; each wave of a cascade rises from deeper in the land, brighter, wider
        // and faster than the one before; a back-to-back clear's bands carry a glint of mica.
        const combo = Math.max(1, Math.round(context.combo || 1));
        const depth = clamp(Math.round(context.cascade || 1), 1, 10) - 1;
        const b2b = context.b2b === true;
        const strength = 2.4 + Math.min(4, combo - 1) * 0.3 + Math.min(6, Math.max(0, combo - 5)) * 0.12
            + depth * 0.35 + (b2b ? 0.5 : 0);
        for (let k = 0; k < lines; k++) {
            const rgb = this.rowColour(codes, k).slice();
            this.feedRiver(rgb);
            if (b2b) for (let c = 0; c < 3; c++) rgb[c] += (MICA[c] - rgb[c]) * 0.35;
            this.tables.addWave({
                g0: -130 - k * 11 - depth * 24,
                climb: 120 * (1 + 0.18 * depth),
                time: t + k * TIMING.rowStagger,
                power: strength,
                rgb,
                half: 3.4 * (1 + 0.08 * depth),
                life: 4.2,
            });
        }
        if (b2b) {
            // The mica flares, higher the longer the run (it settles back to the run's own sheen).
            this.sheenKick.hit(0.45 + 0.12 * Math.min(4, this.b2b + 1), t);
        }
        this.surge.clear(context, t);
        // Pigment rises off the hills beside the card.
        const r = this.random;
        for (let s = 0; s < 3 + lines * 2; s++) {
            const p = this.landSite(r(), 4 + r() * 14);
            if (!p) continue;
            const rgb = this.rowColour(codes, s % lines);
            const scale = clamp(p.distance / 250, 0.5, 6);
            this.puff(p, rgb, {
                count: 22, spread: 3.5 * scale, rise: 4 * scale, size: 1.7 * scale, life: 4.4, delay: s * 0.05,
            });
        }
        if (lines === 4) this.onQuad();
        if (context.tspin) this.onTSpin(context);
        if (context.perfect) this.onPerfect({ counted: true });
        if (context.combo > this.combo) this.onCombo(context.combo);
    }

    /**
     * `beds` new beds were laid on the record at `time`. The stack slides down by them from where
     * it stands (a cascade's next row never cuts the last slide short), and the newest beds glow
     * together while the glow lasts (a chain lights the crown bed by bed).
     */
    deposited(beds, time) {
        const age = time - this.depositAt;
        const settle = this.settleFrom * (1 - smooth(0, TIMING.settle, age));
        const fresh = 1 - smooth(0.2, 3.5, age);
        this.settleFrom = Math.min(8, settle + beds);
        this.freshRows = fresh > 0.05 ? Math.min(FRESH_ROWS, this.freshRows + beds) : beds;
        this.depositAt = time;
    }

    /** A cleared row's pigment joins the river's four lanes (what a flood carries down). */
    feedRiver(rgb) {
        const k = this.floodHead * 3;
        this.floodHead = (this.floodHead + 1) % 4;
        this.floodLanes[k] = rgb[0];
        this.floodLanes[k + 1] = rgb[1];
        this.floodLanes[k + 2] = rgb[2];
    }

    /** Four lines: a rainbow tide through every bed and a flash flood down the river. */
    onQuad() {
        this.counts.quads++;
        const t = this.time;
        for (let k = 0; k < 6; k++) {
            this.tables.addWave({
                g0: -480 - k * 14, climb: 190, time: t + 0.15 + k * 0.08, power: 1.3, rgb: PIECE_LINEAR[k].slice(), half: 3.2, life: 4.6,
            });
        }
        // A flood still running runs on, swollen again (its front never snaps back to the source);
        // its four rows' pigments (fed to the river by the clear) ease in down the current.
        if (this.quadFlood(t) > 0.01) {
            this.floodEnd = Math.max(this.floodEnd, t + TIMING.floodDrain);
        } else {
            this.floodAt = t;
            this.floodEnd = t + TIMING.floodDrain;
        }
        this.flash.hit(0.5 * this.flashRoom(t), t);
    }

    /**
     * How much of a frame-wide flash the moment still has room for: all of it from cold, half in
     * a fever (the land is already alight; a full flash would only wash its colours out).
     */
    flashRoom(time) {
        return 1 - 0.5 * this.surge.level.valueAt(time);
    }

    /** Four lines' flash flood: how much of the river it holds at `time`. */
    quadFlood(time) {
        const age = time - this.floodAt;
        if (age < 0) return 0;
        return smooth(0, 0.4, age) * (1 - smooth(this.floodEnd - 5, this.floodEnd, time));
    }

    onTSpin(context = {}, share = 1) {
        this.counts.tspins++;
        // On the valley floor at a middle distance, on the side the T locked on.
        const p = this.landSite(context.u ?? (this.random() < 0.5 ? 0.2 : 0.8), 18.5);
        if (!p || !this.motes) return;
        const rgb = this.pigment(context.color || PIECE_COLORS[1]);
        const r = this.random;
        const scale = clamp(p.distance / 200, 0.8, 5) * (0.6 + 0.4 * share);
        // Never more than a share of the pigment ring, so the devil leaves the puffs around it be.
        const count = Math.min(Math.round(520 * share), Math.floor(this.motes.pigmentSlots * 0.45 * share));
        this.motes.now = this.time;
        for (let i = 0; i < count; i++) {
            const tint = r() * 0.55;
            this.motes.spawn({
                x: p.x,
                y: p.y + r() * 2,
                z: p.z,
                vx: 0,
                vy: (6 + r() * 12) * scale,
                vz: 0,
                born: this.time + r() * 2.4 * (0.5 + 0.5 * share),
                life: (4 + r() * 4) * (0.6 + 0.4 * share),
                rgb: [rgb[0] * (1 - tint) + DUST[0] * tint, rgb[1] * (1 - tint) + DUST[1] * tint, rgb[2] * (1 - tint) + DUST[2] * tint],
                size: (1.6 + r() * 2.4) * scale,
                kind: MOTE_KIND.devil,
                seed: r(),
                swirl: (3 + r() * 7) * scale,
            });
        }
    }

    /**
     * The crown: the clouds take the mineral colours, seven bands climb every bed, a double bow.
     * Layered on whatever is still playing: a painted sky or a bow already up carries on from
     * where it stands. `counted`: the clear that carried it already told the surge.
     */
    onPerfect({ counted = false } = {}) {
        this.counts.perfects++;
        // Picked up where the painted sky stands (in full, its hold starts over).
        this.perfectAt = this.time - PAINT_IN * unsmooth(this.paintAt(this.time));
        for (let k = 0; k < 7; k++) {
            this.tables.addWave({
                g0: -420 - k * 20, climb: 170, time: this.time + k * 0.22, power: 1.6, rgb: PIECE_LINEAR[k].slice(), half: 3.6, life: 5,
            });
        }
        this.raiseBow(1, 1);
        this.flash.hit(0.3 * this.flashRoom(this.time), this.time);
        if (!counted) this.surge.crown(this.time);
    }

    /** A T-spin that cleared nothing: a small dust devil on the valley floor. */
    onSpin(context = {}) {
        if (this.disposed) return;
        this.onTSpin(context || {}, 0.3);
        this.surge.spin(this.time);
    }

    /** The painted sky of a perfect clear at `time` (in over PAINT_IN, held, then let go). */
    paintAt(time) {
        const age = time - this.perfectAt;
        const { perfectHold, perfectFade } = TIMING;
        return smooth(0, PAINT_IN, age) * (1 - smooth(perfectHold, perfectHold + perfectFade, age));
    }

    /** How much of a bow raised `age` seconds ago shows: in over BOW_IN, held, gone by bowLife. */
    bowLive(age) {
        return smooth(0, BOW_IN, age) * (1 - smooth(TIMING.bowLife - 7, TIMING.bowLife, age));
    }

    /**
     * Raise the bow over the valley. There is one bow: raised while one still shows, it carries on
     * from what is on screen (never weaker; its fade-in picked up where it stands; a secondary
     * already lit stays lit), so a chain's break right after a perfect clear's double bow, or a
     * perfect clear during a chain's bow, only ever adds to it.
     */
    raiseBow(strength, second) {
        const shown = this.bowStrength * this.bowLive(this.time - this.bowAt);
        if (shown > 0.005) {
            const target = Math.max(strength, shown);
            this.bowAt = this.time - BOW_IN * unsmooth(shown / target);
            this.bowStrength = target;
            this.bowSecond = Math.max(this.bowSecond, second);
            return;
        }
        this.bowAt = this.time;
        this.bowSince = this.time;
        this.bowStrength = strength;
        this.bowSecond = second;
        this.bowSecondShown = second;
    }

    onCombo(value) {
        const n = clamp(Math.round(value) || 0, 0, 1000);
        if (n === this.combo) return;
        if (n > this.combo && n >= 2) this.counts.chainSteps++;
        if (n === 0 && this.peak >= 4) {
            this.counts.releases++;
            // The shower passes: a rainbow over the valley, doubled after a long chain.
            this.raiseBow(clamp(0.55 + (this.peak - 4) * 0.15, 0.55, 1.1), this.peak >= 7 ? 1 : 0);
        }
        this.combo = n;
        this.peak = n === 0 ? 0 : Math.max(this.peak, n);
    }

    onB2B(value) {
        const n = clamp(Math.round(value) || 0, 0, 4);
        if (n > this.b2b) this.counts.b2bSteps++;
        this.b2b = n;
    }

    levelUp(level, { silent = false, time = this.time } = {}) {
        const n = Math.max(1, Math.round(Number(level) || 1));
        if (n === this.level) return;
        const up = n > this.level;
        this.wheel.levelUp(n, time, silent || this.reducedMotion);
        this.level = n;
        if (up && !silent) {
            this.counts.levelUps++;
            // A pale marker bed of light climbs the land.
            this.tables.addWave({
                g0: -460, climb: 150, time, power: 1.5, rgb: [1.25, 1.05, 0.72], half: 1.8, life: 5.4,
            });
            this.record.deposit(null, { time, tuff: true });
            this.deposited(1, time);
            this.surge.levelUp(time);
        }
    }

    onGameOver() {
        this.counts.gameOvers++;
        this.duskFrom = this.dusk;
        this.duskTarget = 1;
        this.duskAt = this.time;
        this.record.deposit(null, { time: this.time, tuff: true });
        this.deposited(1, this.time);
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
        // The next run starts at level 1; the day keeps the hour it has reached.
        this.level = 1;
        this.wheel.newRun();
    }

    /** Forget the record's whole history (a capture that replays from scratch). */
    clearHistory() {
        this.record.prefill();
    }

    seek(time) {
        this.resetState(Math.max(0, Number(time) || 0));
        this.record.seek(this.time);
        this.shadowPass?.invalidate();
    }

    // ── Frame ─────────────────────────────────────────────────────────────────────

    update(sim, camera = this._camera) {
        if (this.disposed) return;
        this.time = Number.isFinite(sim.time) ? sim.time : this.time;
        const { time, u } = this;
        const dt = Math.max(0, Math.min(0.25, sim.delta || 0));
        // How hot play runs: once a frame, on the world's clock. Under casual play `warmth` and
        // `hot` stay near 0, so the badlands look as they always have.
        const heat = this.surge.sample(time);
        this.heat = heat;
        const { punch, level, fever } = heat;
        const warmth = smooth(0.15, 0.55, level);
        const hot = smooth(0.45, 0.85, level);
        this.warmth = warmth;
        const motion = this.reducedMotion ? 0 : 1;
        // The view: a nod with every hit (eased in over a few frames), a lean in through a fever.
        this.nod += (motion * (0.5 * punch + 0.7 * fever) - this.nod) * approach(14, dt);
        this.zoom += (motion * fever - this.zoom) * approach(1.2, dt);
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
        // A hot chain's storm and a fever's gloom dim the sky and the air (the haze the far hills
        // sit in), so the kindled land burns against the dark; calm play leaves them as they are.
        const gloom = 1 - 0.12 * hot * this.showerPower - 0.3 * fever;
        u.zenith.value.set(L.zenith[0] * gloom, L.zenith[1] * gloom, L.zenith[2] * gloom);
        u.horizon.value.set(L.horizon[0] * gloom, L.horizon[1] * gloom, L.horizon[2] * gloom);
        // The sun's glow warms with a quick hand; in a fever the storm's gloom takes the air
        // round it too, and only the sun itself (the post's shafts) breaks through brighter.
        const burn = (1 + 0.15 * warmth) * (1 - 0.25 * fever);
        u.glow.value.set(L.glow[0] * burn, L.glow[1] * burn, L.glow[2] * burn);
        u.haze.value.set(L.haze[0] * gloom, L.haze[1] * gloom, L.haze[2] * gloom);
        u.mist.value.set(L.mist[0] * gloom, L.mist[1] * gloom, L.mist[2] * gloom);
        u.cloudLit.value.set(L.cloudLit[0], L.cloudLit[1], L.cloudLit[2]);
        // The storm darkens the clouds' undersides; in a fever it gathers darker still over the
        // glowing land.
        const storm = 1 - 0.55 * this.showerPower - 0.18 * fever;
        u.cloudShade.value.set(L.cloudShade[0] * storm, L.cloudShade[1] * storm, L.cloudShade[2] * (storm + 0.08));
        u.snow.value.set(L.snow[0], L.snow[1], L.snow[2]);
        u.hazeDensity.value = L.hazeDensity;
        u.mistDensity.value = L.mistDensity;
        u.stars.value = L.stars;
        u.lamps.value = Math.max(1 - smooth(-2, 10, L.el), this.dusk);
        u.dusk.value = this.dusk;
        u.time.value = time;
        // The deck drifts with the wind: the clock times a constant, plus what play adds (a quick
        // hand raises a breeze, a fever a gale: the clouds' shadows race across the land).
        this.windDrift += dt * (1.4 * warmth + 2.4 * fever) * (this.reducedMotion ? 0.3 : 1);
        const drift = time + this.windDrift;
        u.wind.value.set(drift * 9.5, drift * -3.2);

        // The chain's shower: it walks in from the horizon as the chain grows, and passes when it breaks.
        const asked = this.combo >= 2 ? clamp(0.18 + (this.combo - 2) * 0.17, 0, 1) : 0;
        this.showerPower += (asked - this.showerPower) * approach(asked > this.showerPower ? 1.4 : 0.45, dt);
        if (this.showerPower > 0.02) this.showerFront = Math.min(this.showerFront, 9000 - 8700 * smooth(0, 1, this.showerPower));
        // The rock is wet where the shower has been, and dries in the sun.
        const wetAsk = this.showerPower;
        this.wetLevel += (wetAsk - this.wetLevel) * approach(wetAsk > this.wetLevel ? 1.2 : 1 / TIMING.dry, dt);
        if (this.wetLevel < 0.01 && this.showerPower < 0.01) this.showerFront = 9000;
        if (time - this.lastLockAt > TIMING.idle && this.combo === 0) this.wetLevel *= 1 - approach(0.5, dt);
        u.wet.value = this.wetLevel;
        u.showerFront.value = this.showerFront;
        u.showerPower.value = this.showerPower;
        // The storm closes the sky over the chain.
        u.cloudCover.value = 0.32 + 0.45 * this.showerPower + 0.08 * fever;
        // The bow (its age counts from when it first showed: a bow carried on never re-fades).
        this.bowSecondShown += (this.bowSecond - this.bowSecondShown) * approach(0.9, dt);
        u.bow.value.set(this.bowStrength * this.bowLive(time - this.bowAt), this.bowSecondShown, time - this.bowSince);
        // Perfect clear: the painted sky; a fever lets the clouds catch some of the land's colours.
        this.perfectPaint = this.paintAt(time);
        u.paint.value = Math.max(this.perfectPaint, 0.22 * fever);
        // Back-to-back: the rock glints (a b2b clear flares it); a fever sets the mica glittering.
        this.sheenLevel += (this.b2b / 4 - this.sheenLevel) * approach(1.5, dt);
        u.sheen.value = Math.min(1.6, this.sheenLevel + this.sheenKick.valueAt(time) + 0.25 * fever);
        // The river: four lines' flood, or a fever swelling it with the latest rows' paint. Its
        // front runs down the course while there is water to carry and returns to the source
        // only once the river has drained; its pigments ease toward the latest rows' (a new quad
        // never recolours a running flood at a stroke).
        const river = Math.max(this.quadFlood(time), 0.5 * fever);
        if (river > 0.005 || this.riverPower > 0.005) {
            this.floodFront = Math.min(this.floodFront + FLOOD_SPEED * dt, RIVER_LENGTH + 4000);
        } else {
            this.floodFront = FLOOD_SOURCE;
        }
        this.easeRiver(this.riverPower > 0.005 ? approach(1.2, dt) : 1);
        this.riverPower = river;
        u.flood.value.set(this.floodFront, river);
        // The record: the newest beds crown the high ground; new rows slide the stack down.
        u.recordHead.value = this.record.head;
        u.recordCount.value = Math.min(RECORD_SHOWN, this.record.total);
        u.recordTop.value = this.overrides.recordTop ?? RECORD_TOP;
        u.settle.value = this.settleFrom * (1 - smooth(0, TIMING.settle, time - this.depositAt));
        u.fresh.value = 1 - smooth(0.2, 3.5, time - this.depositAt);
        u.freshRows.value = this.freshRows;
        // The heat of play kindles the painted beds: a faint glow on a hot hand, the showpiece in
        // a fever (a tide of each bed's own pigment climbing the hills).
        u.strataGlow.value = 0.08 * hot + 0.5 * fever;
        if (this._recordVersion !== this.record.version && this.textures) {
            this.textures.record.needsUpdate = true;
            this._recordVersion = this.record.version;
        }
        // Rain at the eye once the shower has walked in.
        if (this.motes && this.showerPower > 0.45 && this.showerFront < 900 && !this.reducedMotion) {
            // The rain keeps to its own share of the pool (painted-ages-motes.js): its rate is
            // capped so each streak lives out its fall before its slot comes round again.
            this.rainCarry += dt * Math.min(260 * this.showerPower, (0.95 * this.motes.rainSlots) / RAIN_LIFE);
            this.motes.now = time;
            const r = this.random;
            while (this.rainCarry >= 1) {
                this.rainCarry -= 1;
                const a = (r() - 0.5) * 1.4;
                const d = 25 + r() ** 0.7 * 220;
                this.motes.spawn({
                    x: EYE.x + Math.sin(a) * d,
                    y: EYE.y + 40 + r() * 30,
                    z: EYE.z - Math.cos(a) * d,
                    vx: 1.5,
                    vy: -11,
                    vz: 0.6,
                    born: time,
                    life: RAIN_LIFE,
                    rgb: [0.7, 0.75, 0.85],
                    size: 0.05 + d * 0.0006,
                    kind: MOTE_KIND.rain,
                    seed: r(),
                });
            }
        }
        this.tables.update(time);
        this.motes?.update();
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
        for (const part of this.partList) part.update?.(time, dt);
    }

    /** Ease the river's pigments toward its four lanes by `k` (1: at once, the river was dry). */
    easeRiver(k) {
        const lanes = this.floodLanes;
        const rows = this.u.tables.floodRows;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let lane = 0; lane < 4; lane++) {
            const row = rows[lane];
            row.x += (lanes[lane * 3] - row.x) * k;
            row.y += (lanes[lane * 3 + 1] - row.y) * k;
            row.z += (lanes[lane * 3 + 2] - row.z) * k;
            r += row.x * 0.25;
            g += row.y * 0.25;
            b += row.z * 0.25;
        }
        this.u.floodColour.value.set(r, g, b);
    }

    updatePost(camera) {
        const post = this._post;
        const L = this.light;
        const { punch, fever } = this.heat;
        const { warmth } = this;
        // The iris closes a little as play heats (the beds glow and the sun burns brighter), so
        // the colours stay deep instead of washing out; the wet rock and the heat saturate them.
        post.exposure = L.exposure * (1 - 0.05 * warmth - 0.1 * fever);
        post.shaftColour = L.glow;
        post.saturation = 1.0 + this.wetLevel * 0.14 + 0.05 * warmth + 0.08 * fever;
        post.bloomBoost = Math.min(1, this.showerPower * 0.2 + this.sheenLevel * 0.3 + (this.perfectPaint || 0) * 0.4
            + 0.04 * warmth + 0.04 * fever);
        // A flash on four lines and on a perfect clear (accumulating: a second never cuts the first).
        post.flash = this.flash.valueAt(this.time);
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
            // The sun breaks through brighter as play heats, and flares with each hit.
            post.sun.strength = post.sun.onScreen * L.sunUp * smooth(-1, 6, L.el) * (1 - smooth(14, 32, L.el))
                * (1 + this.bowStrength * 0.3 * (this.u.bow.value.x > 0 ? 1 : 0))
                * (1 + 0.3 * warmth + 0.7 * fever + 0.5 * punch);
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
            wet: this.wetLevel,
            shower: this.showerPower,
            bow: this.u.bow.value.x,
            dusk: this.dusk,
            ribbons: this.tables.ribbonCount,
            waves: this.tables.waveCount,
            surge: { level: this.heat.level, fever: this.heat.fever, stage: this.heat.stage },
            recordRows: this.record.total,
            recordHead: this.record.head,
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
            flood: {
                colour: this.u.floodColour.value.toArray(),
                rows: this.u.tables.floodRows.map((v) => v.toArray()),
                lanes: Array.from(this.floodLanes),
            },
            heat: {
                punch: swellState(this.surge.punch),
                level: swellState(this.surge.level),
                ...Object.fromEntries(SURGE_SCALARS.map((key) => [key, this.surge[key]])),
                flash: swellState(this.flash),
                sheenKick: swellState(this.sheenKick),
            },
            record: {
                total: this.record.total,
                head: this.record.head,
                data: this.record.data.slice(),
                baseline: this.record.baseline.slice(),
                baselineHead: this.record.baselineHead,
                baselineTotal: this.record.baselineTotal,
                journal: this.record.journal.map((event) => ({ ...event, codes: event.codes?.slice() || null, bytes: event.bytes.slice() })),
            },
        };
    }

    importSessionState(state) {
        if (!state?.record?.data || state.record.data.length !== this.record.data.length) return;
        for (const key of SNAPSHOT) if (state.scalars?.[key] !== undefined) this[key] = state.scalars[key];
        this.wheel.importState(state.wheel);
        this.counts = { ...emptyCounts(), ...state.counts };
        if (state.flood) {
            this.u.floodColour.value.fromArray(state.flood.colour);
            state.flood.rows.forEach((row, k) => {
                if (!this.u.tables.floodRows[k]) return;
                this.u.tables.floodRows[k].fromArray(row);
                for (let c = 0; c < 3; c++) this.floodLanes[k * 3 + c] = row[c];
            });
            if (state.flood.lanes?.length === this.floodLanes.length) this.floodLanes.set(state.flood.lanes);
        }
        if (state.heat) {
            loadSwell(this.surge.punch, state.heat.punch);
            loadSwell(this.surge.level, state.heat.level);
            for (const key of SURGE_SCALARS) if (state.heat[key] !== undefined) this.surge[key] = state.heat[key];
            loadSwell(this.flash, state.heat.flash);
            loadSwell(this.sheenKick, state.heat.sheenKick);
        }
        const r = state.record;
        this.record.data.set(r.data);
        this.record.baseline.set(r.baseline);
        this.record.head = r.head;
        this.record.total = r.total;
        this.record.baselineHead = r.baselineHead;
        this.record.baselineTotal = r.baselineTotal;
        this.record.journal = r.journal;
        this.record.version++;
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.root.removeFromParent();
        for (const part of this.partList) part.dispose();
        this.shadowPass?.dispose();
        if (this.textures) {
            for (const name of FIELD_ORDER) this.textures.fields[name].dispose();
            this.textures.flow.near.dispose();
            this.textures.flow.mid.dispose();
            this.textures.column.dispose();
            this.textures.record.dispose();
            this.textures.noise.dispose();
            this.textures.lattice.dispose();
        }
        this.root.clear();
        this.partList.length = 0;
    }
}

export { RECORD_ROWS, buildBeds };
