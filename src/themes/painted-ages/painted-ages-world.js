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
 *   twist      a dust devil of pigment spins up on the valley floor: a funnel in the piece's
 *               colour that stands, drifts and lifts away (painted-ages-devils.js)
 *   b2b         veins of gold cut across the beds, a flare of light racing out along them
 *   perfect     an age in a breath: the whole day wheels round once (the sun arcs over, night
 *               falls, the stars turn, dawn breaks), the clouds take the land's own strata,
 *               every bed lights, and as the light returns a double bow stands over the valley
 *   level up    the day steps an hour forward (it also turns with the clock alone); new ages
 *               are laid down: every stripe on every hill slides up its slope, a pale marker
 *               bed climbs the land, and the lamps flare in turn up the stair to the pavilion
 *   game over   dusk falls, the lamps light one by one up the stair, and sky lanterns rise
 *               from the pavilion; morning returns with the next run
 *
 * Beside the hours turns the WEATHER (painted-ages-weather.js): a wheel of airs (fair, towers,
 * pools of light, a far shower, crystal air, a sea of mist, a wind of dust), and small
 * happenings by the clock (a meteor, lightning far inside a bank, a dust devil of the wind's own).
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
    clamp, hexToLinear, mulberry32, rigFor, smooth, smoother, strataG,
} from './painted-ages-core.js';
import {
    HOURS, HOUR_COUNT, HourWheel, blendLight, copyLight, createLight, lightAt,
} from './painted-ages-hours.js';
import { tierFor } from './painted-ages-quality.js';
import {
    DUST_TINT, airAt, airDrift, airPlace, createAir, happeningAt, swellOver, virgaBearing,
} from './painted-ages-weather.js';
import { breathe, loadBadlands, planBadlands } from './painted-ages-assets.js';
import {
    createColumnTexture, createFieldTexture, createFlowTexture, createLatticeTexture, createNoiseTexture,
    createRecordTexture, createUniforms,
} from './painted-ages-tsl.js';
import { fillFieldTextureRows } from './painted-ages-field-data.js';
import {
    bilinear, fieldCoords, fieldInset, groundHeight,
} from './painted-ages-field.js';
import { PAVILION, RIVER_LENGTH } from './painted-ages-plan.js';
import { DevilTable, createDevils } from './painted-ages-devils.js';
import { createPropsSteps } from './painted-ages-props.js';
import { createCumulus } from './painted-ages-cumulus.js';
import { createPoplars } from './painted-ages-life.js';
import { createVultures } from './painted-ages-vultures.js';
import { EventTables, MOTE_KIND, Motes } from './painted-ages-fx.js';
import { createFanGeometry, createLandMaterial, fanPositionSteps } from './painted-ages-land.js';
import { createShadowPass } from './painted-ages-shadow.js';
import { createSky } from './painted-ages-sky.js';
import { cardUnion, fallbackLayout } from './painted-ages-composition.js';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { drainSteps } from '../shared/build-steps.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';

export const PAINTED_AGES_PARTS = Object.freeze(['land', 'sky', 'props', 'cumulus', 'poplars', 'devils', 'vultures', 'motes']);
export const REST_RIG = Object.freeze({ near: RIG.near, far: RIG.far });
export const fovForAspect = (aspect) => rigFor(aspect).fov;

const COUNTERS = ['locks', 'hardDrops', 'clears', 'lines', 'quads', 'twists', 'perfects', 'chainSteps', 'releases', 'b2bSteps', 'levelUps', 'gameOvers', 'mornings'];
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
    'veinAt', 'spinAt', 'spinsDone', 'spinCounted', 'bowDueAt', 'lampRunAt', 'shiftFrom', 'shiftTo', 'shiftAt', 'stormFlickerAt', 'lanternsAt',
]);
/** A perfect clear's age: the day wheels round once in this long (s). */
export const SPIN_SECONDS = 7.5;
/** How far the sky turns about the pole while it does (radians). */
const SPIN_TURN = 1.05;
/** A level's new ages: the column slides this far (metres of geological height) over this long. */
export const LEVEL_SHIFT = 16;
const SHIFT_SECONDS = 4.2;
/** The column slides up to this far and back (it is not endless). */
const SHIFT_RANGE = 400;
/** A level-up's flare runs the stair's lamps in this long (s), and is gone by LAMP_RUN_LIFE. */
const LAMP_RUN = 2.4;
const LAMP_RUN_LIFE = 3.8;
/** Sky lanterns at a run's end (most; a lean pool sends fewer), and their warm light. */
const LANTERNS = 34;
const LANTERN_LIGHT = [1.55, 0.62, 0.16];

/** A walk there and back over 0..range (the column's slide: up, then down again). */
function thereAndBack(x, range) {
    const p = ((x % (2 * range)) + 2 * range) % (2 * range);
    return p <= range ? p : 2 * range - p;
}
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
/** The moon: its bearing (radians right of the view axis) and its light on the land at full. */
const MOON_AZ = 27.5 * DEG;
const MOON_LIGHT = [0.1, 0.125, 0.2];
/** The pale dust of a devil the wind raises by itself (linear). */
const GUST_DUST = [0.74, 0.58, 0.44];

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

/** Rows of a field's texture data prepared per step (a 1024-post field: four steps). */
const FIELD_ROWS_PER_STEP = 256;

/** Everything heavy a world needs once the fields are read: the mesh and the field textures. */
function* prepareSteps(quality, fields) {
    const tier = tierFor(quality);
    const positions = yield* fanPositionSteps(fields, tier.fanCols, tier.fanRows);
    const textures = {};
    for (const name of FIELD_ORDER) {
        // A band of rows a step, so no step holds a frame (a whole field was one 58-66 ms task).
        const field = FIELDS[name];
        const { heights, sky } = fields[name];
        const data = new Uint16Array(field.size * field.size * 4);
        for (let j = 0; j < field.size; j += FIELD_ROWS_PER_STEP) {
            fillFieldTextureRows(data, heights, sky, field, j, Math.min(field.size, j + FIELD_ROWS_PER_STEP));
            yield name;
        }
        textures[name] = data;
    }
    return {
        quality, fields, positions, textures, source: fields.source,
    };
}

/**
 * The prepared land read from the baked assets, kept for the session per quality: its fields,
 * mesh positions and texture data are only read once built, and reading, decoding and preparing
 * them again cost a revisit ~85 ms. (A land drawn from the plan, when an asset could not be read,
 * is not kept: the next visit tries the assets again.)
 */
const keptPrepared = new Map();

/** Read the baked land and prepare it, yielding to the page between slices (abortable). */
async function prepareData(quality, { signal } = {}) {
    if (keptPrepared.has(quality)) return keptPrepared.get(quality);
    const fields = await loadBadlands({ signal });
    const steps = prepareSteps(quality, fields);
    for (;;) {
        const next = steps.next();
        if (next.done) {
            if (next.value.source === 'asset') keptPrepared.set(quality, next.value);
            return next.value;
        }
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
        this.overrides = {
            hour: null, recordTop: null, air: null, happenings: true, happen: null,
        };
        /** The air of the hour (painted-ages-weather.js), and the slot whose happening last began. */
        this.air = createAir();
        this._happening = {};
        this._tint = [0, 0, 0];
        this.random = mulberry32(seed ^ 0x51ab);
        this.tables = new EventTables(this.u);
        this.devils = new DevilTable(this.u);
        this._site = {
            x: 0, y: 0, z: 0, distance: 0,
        };
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
        // The deck's drift carries what the weather's winds have added up to now (a seek lands
        // on the sky a live run would have reached).
        this.windDrift = airDrift(time);
        this.nod = 0;
        this.zoom = 0;
        this.warmth = 0;
        this.veinAt = -1e6;
        this.spinAt = -1e6;
        this.spinsDone = 0;
        this.spinCounted = null;
        this.spinning = false;
        this.bowDueAt = Infinity;
        this.lampRunAt = -1e6;
        this.shiftFrom = 0;
        this.shiftTo = 0;
        this.shiftAt = -1e6;
        this.stormFlickerAt = -1e6;
        this.stormFlickerSeed = 0;
        this.lanternsAt = -1e6;
        this._gustSlot = -1;
        this.devils.reset();
        this.tables.reset();
        this.motes?.clear();
        this.surge.reset();
        this.heat = this.surge.sample(time);
        this.flash.reset();
        this.sheenKick.reset();
    }

    build() {
        drainSteps(this.buildSteps());
        return this;
    }

    /**
     * The build as steps, a few parts to a step (the theme breathes between them:
     * shared/build-steps.js), the same work in the same order. Built in one task it held a first
     * visit's switch ~72 ms (the props ~32, the noise bake ~14; 2026-10-31). The textures are the
     * world's (and disposed with it) once all of them are made; until then none has reached the GPU.
     */
    * buildSteps() {
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
        const column = createColumnTexture(this.beds);
        const record = createRecordTexture(this.record);
        yield 'column';
        const noise = createNoiseTexture();
        yield 'noise';
        this.textures = {
            fields: fieldTex,
            flow: flowTex,
            column,
            record,
            noise,
            lattice: createLatticeTexture(),
        };
        this.shadowPass = createShadowPass(this.u, fieldTex, tier);
        this.textures.shadow = this.shadowPass.textures;
        // The poplars come first: the land reads their shadow map.
        const poplars = createPoplars(this.u, this.textures, tier, this.fields);
        this.textures.poplarShade = poplars.shade;
        yield 'poplars';

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
        yield 'land';
        this.addPart('props', yield* createPropsSteps(this.u, this.textures, tier, this.fields));
        yield 'props';
        this.addPart('poplars', poplars);
        this.addPart('sky', createSky(this.u, this.textures, tier));
        this.addPart('cumulus', createCumulus(this.u, this.textures, tier, tier.banks));
        this.addPart('devils', createDevils(this.u, this.textures));
        this.addPart('vultures', createVultures(this.u, this.textures, tier, this.fields));
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
            // (A bed on the near hill fills a wide stretch of the screen: lit as hard as a far
            // one, quick drops laid a white glare over it. Its light is held back by nearness.)
            power: (hard ? 6.0 + drop * 2 : 4.6) * (1 + 0.35 * pace) * clamp(p.distance / 520, 0.5, 1),
            half: hard ? 5.0 : 4.0,
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
            // The veins of gold flare, higher the longer the run (they settle back to the run's
            // own glow), and the flare's front runs out along them from the eye.
            this.sheenKick.hit(0.45 + 0.12 * Math.min(4, this.b2b + 1), t);
            this.veinAt = t;
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
        if (context.twist) this.onTwist(context);
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

    /**
     * Level ground at a middle distance on the side of board column `u01`: where a dust devil
     * can stand and be seen whole (the valley floors beside the card, never the near slopes).
     */
    devilSite(u01) {
        const p = this.sitePoint(u01, 10);
        const out = this._site;
        const ground = (px, pz) => groundHeight(this.fields, px, pz);
        // Level ground first (a valley floor); failing that, any gentle shoulder of a hill.
        for (const steepest of [0.16, 0.5]) {
            for (let k = 0; k < 13; k++) {
                const sy = 0.53 + k * 0.024;
                for (const dx of [0, -0.045, 0.045, -0.09, 0.09]) {
                    const hit = this.landAt(clamp(p.x + dx, 0.05, 0.93), sy, out);
                    if (!hit || hit.distance < 430 || hit.distance > 1700) continue;
                    const { x, z } = hit;
                    const slope = Math.max(Math.abs(ground(x + 6, z) - ground(x - 6, z)), Math.abs(ground(x, z + 6) - ground(x, z - 6))) / 12;
                    if (slope < steepest) return hit;
                }
            }
        }
        return this.landSite(u01, 18.5);
    }

    /**
     * Spin up a dust devil (`share` 1: a twist; less: a twist that cleared nothing, or the
     * weather's own): the funnel, and a few grains flung round its foot.
     */
    raiseDevil(u01, rgb, share = 1) {
        const p = this.devilSite(u01);
        if (!p) return false;
        const r = this.random;
        const height = clamp(p.distance * 0.2, 60, 260) * (0.55 + 0.45 * share);
        this.devils.spawn({
            x: p.x,
            y: p.y - 1,
            z: p.z,
            time: this.time,
            rgb,
            height,
            strength: 0.62 + 0.38 * share,
            driftX: 3 + r() * 3.5,
            driftZ: (r() - 0.5) * 2.4,
            seed: r(),
        });
        if (!this.motes) return true;
        const scale = height / 110;
        // Never more than a small share of the pigment ring: the devil leaves the puffs be.
        const count = Math.min(Math.round(64 * share), Math.floor(this.motes.pigmentSlots * 0.08 * share));
        this.motes.now = this.time;
        for (let i = 0; i < count; i++) {
            const tint = 0.3 + r() * 0.5;
            this.motes.spawn({
                x: p.x,
                y: p.y + r() * 2,
                z: p.z,
                vx: 0,
                vy: (5 + r() * 9) * scale,
                vz: 0,
                born: this.time + 0.6 + r() * 3.2,
                life: 3 + r() * 2.5,
                rgb: [(rgb[0] * (1 - tint) + DUST[0] * tint) * 0.6, (rgb[1] * (1 - tint) + DUST[1] * tint) * 0.6, (rgb[2] * (1 - tint) + DUST[2] * tint) * 0.6],
                size: (0.7 + r() * 0.9) * scale,
                kind: MOTE_KIND.devil,
                seed: r(),
                swirl: (2.5 + r() * 5) * scale,
            });
        }
        return true;
    }

    onTwist(context = {}, share = 1) {
        this.counts.twists++;
        // On the valley floor at a middle distance, on the side the T locked on.
        const rgb = this.pigment(context.color || PIECE_COLORS[1]).slice();
        this.raiseDevil(context.u ?? (this.random() < 0.5 ? 0.2 : 0.8), rgb, share);
    }

    /**
     * The crown: an age in a breath. The whole day wheels round once (the sun arcs over and
     * sets, the stars turn, dawn breaks: update() reads `spinAt`), the clouds take the land's
     * strata, seven bands climb every bed, and as the light returns a double bow stands over
     * the valley. Layered on whatever is still playing: a painted sky or a bow already up
     * carries on from where it stands, and a day already wheeling is not begun again.
     * `counted`: the clear that carried it already told the surge.
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
        const wheeling = this.time - this.spinAt < SPIN_SECONDS;
        if (this.reducedMotion) {
            // No sweep of the light under reduced motion: the bow rises at once.
            this.raiseBow(1, 1);
        } else if (!wheeling) {
            this.spinAt = this.time;
            this.bowDueAt = this.time + SPIN_SECONDS - 1.4;
        }
        this.flash.hit(0.3 * this.flashRoom(this.time), this.time);
        if (!counted) this.surge.crown(this.time);
    }

    /** A twist that cleared nothing: a small dust devil on the valley floor. */
    onSpin(context = {}) {
        if (this.disposed) return;
        this.onTwist(context || {}, 0.35);
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
        // Deep in a chain the storm answers each step: lightning far inside a bank.
        if (n > this.combo && n >= 4) {
            this.stormFlickerAt = this.time;
            this.stormFlickerSeed = (n * 0.381966) % 1;
        }
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
        if (up) {
            // New ages are laid down: the column slides on under the land (eased; at once when
            // silent), from wherever the last slide stands.
            this.shiftFrom = this.shiftSteps(time);
            this.shiftTo = Math.max(this.shiftTo, this.shiftFrom) + (n - this.level);
            this.shiftAt = silent || this.reducedMotion ? -1e6 : time;
        }
        this.level = n;
        if (up && !silent) {
            this.counts.levelUps++;
            // The lamps flare in turn up the stair to the pavilion.
            this.lampRunAt = time;
            // A pale marker bed of light climbs the land.
            this.tables.addWave({
                g0: -460, climb: 150, time, power: 1.5, rgb: [1.25, 1.05, 0.72], half: 1.8, life: 5.4,
            });
            this.record.deposit(null, { time, tuff: true });
            this.deposited(1, time);
            this.surge.levelUp(time);
        }
    }

    /** How many levels' ages the column has slid by `time` (eased through a level-up's slide). */
    shiftSteps(time) {
        return this.shiftFrom + (this.shiftTo - this.shiftFrom) * smoother((time - this.shiftAt) / SHIFT_SECONDS);
    }

    /**
     * Sky lanterns leave the pavilion's terrace one after another and drift up over the valley
     * on the evening air (a run's end). Written once: they move in closed form (the motes).
     */
    releaseLanterns(time) {
        if (!this.motes || !this.fields) return;
        const r = this.random;
        const ground = groundHeight(this.fields, PAVILION.x, PAVILION.z, true);
        const count = Math.min(LANTERNS, Math.floor(this.motes.pigmentSlots * 0.06));
        this.motes.now = time;
        for (let i = 0; i < count; i++) {
            const a = r() * TAU;
            const d = 2 + r() * 9;
            this.motes.spawn({
                x: PAVILION.x + Math.cos(a) * d,
                y: ground + 2.5 + r() * 4,
                z: PAVILION.z + Math.sin(a) * d,
                vx: 1.1 + r() * 1.7,
                vy: 1.7 + r() * 1.5,
                vz: (r() - 0.5) * 1.3,
                born: time + 1.8 + i * 0.4 + r() * 0.3,
                life: 27 + r() * 10,
                rgb: LANTERN_LIGHT,
                size: 1.7 + r() * 0.9,
                kind: MOTE_KIND.lantern,
                seed: r(),
                swirl: 0.5,
                rise: 0,
            });
        }
    }

    onGameOver() {
        this.counts.gameOvers++;
        this.duskFrom = this.dusk;
        this.duskTarget = 1;
        this.duskAt = this.time;
        if (this.time - this.lanternsAt > 20) {
            this.lanternsAt = this.time;
            this.releaseLanterns(this.time);
        }
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
        this.parts.poplars?.shade?.invalidate();
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
        // A perfect clear's age: the day wheels round once (a whole turn of the wheel is the
        // same hour again, so nothing is left to undo), swept evenly through the hours' rests.
        if (time >= this.bowDueAt) {
            this.bowDueAt = Infinity;
            this.raiseBow(1, 1);
        }
        const spinAge = time - this.spinAt;
        const spinning = spinAge >= 0 && spinAge < SPIN_SECONDS;
        // (A finished turn is counted once, so the stars stay where the sweep left them.)
        if (this.spinAt > -1e5 && spinAge >= SPIN_SECONDS && this.spinCounted !== this.spinAt) {
            this.spinCounted = this.spinAt;
            this.spinsDone += 1;
        }
        const turn = spinning ? smoother(spinAge / SPIN_SECONDS) : 0;
        const sweep = spinning ? smooth(0, 0.7, spinAge) * (1 - smooth(SPIN_SECONDS - 0.7, SPIN_SECONDS, spinAge)) : 0;
        this.spinning = spinning;
        // The light of the hour.
        const place = this.overrides.hour !== null ? this.overrides.hour : this.wheel.place(time);
        lightAt(place + HOUR_COUNT * turn, this._hourLight, sweep);
        // The sky turns about the pole: slowly by the clock, and in one sweep with the age.
        u.starTurn.value = (time * 0.0016 + SPIN_TURN * (this.spinsDone + turn)) % TAU;
        // The ages laid down: a level's slide, and one more with every new day of the clock.
        const days = place / HOUR_COUNT;
        const dawn = Math.max(0, Math.floor(days) - 1 + smooth(0, 0.012, days - Math.floor(days)));
        u.strataShift.value = thereAndBack((this.shiftSteps(time) + (this.overrides.hour !== null ? 0 : dawn)) * LEVEL_SHIFT, SHIFT_RANGE);
        // A level-up's flare runs the lamps up the stair.
        const lampAge = time - this.lampRunAt;
        u.lampRun.value.set(lampAge >= 0 && lampAge < LAMP_RUN_LIFE ? (lampAge / LAMP_RUN) * 1.15 - 0.05 : -1, lampAge >= 0 && lampAge < LAMP_RUN_LIFE ? 1 - smooth(LAMP_RUN_LIFE - 1, LAMP_RUN_LIFE, lampAge) : 0, 1);
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
        // The air of the hour: the weather's wheel turns beside the light's.
        const A = airAt(this.overrides.air !== null ? this.overrides.air : airPlace(time), this.air);
        const day = L.sunUp * (1 - this.dusk);
        // A warm wind's dust tints the haze and takes the valley layer for itself (by day).
        const dusty = A.dust * day;
        this.dustTint(u.haze.value, 0.5 * dusty);
        this.dustTint(u.mist.value, 0.85 * dusty);
        u.hazeDensity.value = L.hazeDensity * A.haze;
        // The weather's mist joins the hour's own rather than piling on it (a sea of mist at
        // first light would otherwise bury the whole valley and the far range with it).
        u.mistDensity.value = Math.max(L.mistDensity, 0.5 * L.mistDensity + A.mist * (1 - 0.35 * A.dust * (1 - day)));
        u.mistHeight.value = 38 * A.mistRise;
        u.cloudDepth.value = A.shade;
        u.towerGrow.value = Math.min(1, A.towers + 0.3 * this.showerPower);
        u.boil.value = time;
        u.cirrus.value = A.cirrus * (1 - 0.6 * this.showerPower);
        u.stars.value = L.stars;
        // The moon rises as the dark deepens, and lays a soft silver light on the land.
        const moonUp = smooth(0.22, 0.75, L.stars);
        const moonEl = (3.5 + 7 * moonUp) * DEG;
        u.moonDir.value.set(Math.sin(MOON_AZ) * Math.cos(moonEl), Math.sin(moonEl), -Math.cos(MOON_AZ) * Math.cos(moonEl));
        u.moonUp.value = moonUp;
        u.moon.value.set(MOON_LIGHT[0] * moonUp, MOON_LIGHT[1] * moonUp, MOON_LIGHT[2] * moonUp);
        u.lamps.value = Math.max(1 - smooth(-2, 10, L.el), this.dusk);
        u.dusk.value = this.dusk;
        u.time.value = time;
        // The deck drifts with the wind: the clock times a constant, plus what play adds (a quick
        // hand raises a breeze, a fever a gale: the clouds' shadows race across the land).
        this.windDrift += dt * ((A.wind - 1) + (1.4 * warmth + 2.4 * fever) * (this.reducedMotion ? 0.3 : 1));
        const drift = time + this.windDrift;
        u.wind.value.set(drift * 9.5, drift * -3.2);
        u.windSpeed.value = (A.wind + 1.4 * warmth + 2.4 * fever) * (this.reducedMotion ? 0.4 : 1);
        // The deck's finer field takes another heading: the two slide through each other.
        u.wind2.value.set(drift * 5.2, drift * 6.3);

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
        u.cloudCover.value = Math.min(0.92, A.cover + 0.45 * this.showerPower + 0.08 * fever);
        // The weather's far shower: curtains on one side, and by day a shard of rainbow in them.
        const virgaAz = virgaBearing(A.place);
        u.virga.value.set(virgaAz, A.virga * (1 - 0.7 * this.showerPower), Math.sign(virgaAz) * 0.2);
        const shard = 0.5 * smooth(0.35, 0.9, A.virga) * day * (1 - this.showerPower);
        // The bow (its age counts from when it first showed: a bow carried on never re-fades).
        // A chain's bow or a perfect clear's stands whole and takes over from the shard.
        this.bowSecondShown += (this.bowSecond - this.bowSecondShown) * approach(0.9, dt);
        const bow = this.bowStrength * this.bowLive(time - this.bowAt);
        u.bow.value.set(Math.max(bow, shard), this.bowSecondShown, shard > 0.01 ? Math.max(1.5, time - this.bowSince) : time - this.bowSince);
        u.bowLeg.value = shard > 0.01 ? Math.sign(virgaAz) * clamp(1 - bow / shard, 0, 1) : 0;
        this.happen(time, L, A, day);
        // Perfect clear: the painted sky; a fever lets the clouds catch some of the land's colours.
        this.perfectPaint = this.paintAt(time);
        u.paint.value = Math.max(this.perfectPaint, 0.22 * fever);
        // Back-to-back: the rock glints (a b2b clear flares it); a fever sets the mica glittering.
        this.sheenLevel += (this.b2b / 4 - this.sheenLevel) * approach(1.5, dt);
        const veinFlare = this.sheenKick.valueAt(time);
        u.sheen.value = Math.min(1.6, this.sheenLevel + veinFlare + 0.25 * fever);
        u.veins.value.set(veinFlare, Math.min(60000, (time - this.veinAt) * 950));
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

    /** Lean a uniform's colour toward the dust the wind carries, keeping its brightness. */
    dustTint(v, k) {
        if (!(k > 0)) return;
        const lum = (v.x * 0.2126 + v.y * 0.7152 + v.z * 0.0722) * 1.12;
        v.set(v.x + (DUST_TINT[0] * lum - v.x) * k, v.y + (DUST_TINT[1] * lum - v.y) * k, v.z + (DUST_TINT[2] * lum - v.z) * k);
    }

    /**
     * The clock's small happenings (painted-ages-weather.js `happeningAt`): a meteor while the
     * stars are out, a flicker of lightning inside a far bank in the dim hours or under a
     * storm. Pure functions of the time; `overrides.happen` (a capture) plays one from the
     * world's own start.
     */
    happen(time, L, A, day) {
        const { u } = this;
        const h = happeningAt(time, this._happening);
        const forced = this.overrides.happen;
        if (forced) {
            h.kind = forced;
            h.age = time - (this.overrides.happenAt ?? 0);
        }
        const on = this.overrides.happenings !== false || Boolean(forced);
        const meteor = on && h.kind === 'meteor' ? swellOver(h.age, 0.07, 1.25) * smooth(0.4, 0.8, L.stars) : 0;
        u.meteor.value.set(h.side * (0.3 + 0.22 * h.seed), 0.2 + 0.07 * ((h.seed * 7.3) % 1), Math.max(0, h.age), meteor);
        // One stroke and its echo; a single soft swell when flashing is reduced.
        const scale = flashScale();
        const stroke = (age) => swellOver(age, 0.06, 0.6) + (scale < 1 ? 0 : 0.7 * swellOver(age - 0.42, 0.05, 0.5));
        let flicker = 0;
        let { seed } = h;
        if (on && h.kind === 'flicker') {
            const dim = Math.max(smooth(0.95, 1.5, L.exposure), this.showerPower);
            flicker = stroke(h.age) * dim * smooth(0.45, 0.8, u.towerGrow.value) * scale;
        }
        // A deep chain's storm answers its steps (onCombo).
        const storm = stroke(time - this.stormFlickerAt) * scale;
        if (storm > flicker) {
            flicker = storm;
            seed = this.stormFlickerSeed;
        }
        u.flicker.value.set(Math.floor(seed * 4) % 4, flicker, seed);
        // The wind's own dust devil: pale, by day, when none stands already (one a slot).
        if (on && h.kind === 'gust' && h.slot !== this._gustSlot && h.age >= 0 && h.age < 1.2) {
            this._gustSlot = h.slot;
            if (day > 0.5 && !this.reducedMotion && this.devils.standing(time) === 0) {
                this.raiseDevil(h.side < 0 ? 0.12 + 0.2 * h.seed : 0.68 + 0.2 * h.seed, GUST_DUST, 0.5 + 0.3 * A.dust);
            }
        }
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

    /** GPU work that must precede the frame: the land's and the trees' shadows, when the sun has moved. */
    prerender(renderer) {
        if (this.disposed || !this.shadowPass) return;
        // While an age wheels by, the sun crosses the sky in seconds: the land's shadows follow
        // in coarser steps (about a degree) instead of re-marching a field every frame.
        this.shadowPass.render(renderer, this.u.sunDir.value, { threshold: this.spinning ? 0.018 : 0.0018 });
        this.parts.poplars?.prerender?.(renderer, this.u.sunDir.value);
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
            air: {
                place: this.air.place, from: this.air.from, to: this.air.to, mix: this.air.mix, name: this.air.name,
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
