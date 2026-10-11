/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Moonlit Greenhouse — the night garden under glass: the world.
 *
 * The eye stands on a little landing at the head of a lily canal that runs down the middle of a
 * Victorian palm house and looks along it. The full moon stands beyond the glass to the left of
 * the card (above it on an upright phone); its light falls through the iron and glass of the
 * pointed vault, so the lattice of the glazing lies across the floor, the leaves and the water,
 * and every beam in the mist (drawn by the post stack) carries it. Everything is built here and
 * shared with the playground effect (src/playground/effects/moonlit-greenhouse.effect.js), so
 * what is iterated there ships.
 *
 * Parts (showOnlyParts names): see MOONLIT_GREENHOUSE_PARTS.
 *
 * Every part is built from ONE context, { tier, U, noise, plan, seed }, and may be handed the
 * world each frame (part.update(world)); parts read the uniforms in U and never write them. The
 * world owns every value.
 *
 * What the board does to it:
 *   lock        a seed of light in the piece's colour leaves the card's edge at the piece's
 *               height and arcs into the garden beside the card (lower pieces nearer, columns
 *               further from the middle further out); where it lands a night flower opens in
 *               that colour, in the beds, or a water lily on the canal with a ring running out.
 *   hard drop   the house shudders: a curtain of dew shakes loose from the glass and falls
 *               glittering through the beams; the bloom opens larger and the ring is stronger.
 *   clear       the garden exhales: each cleared row releases a ribbon of fireflies from the
 *               card's edges into the garden; a wave of moonlight runs across the glazing pane by
 *               pane, one front a line; the oldest blooms give up their pollen, which rises
 *               through the beams to the glass, and close.
 *   combo       the fireflies fall into step (their own rhythms, then rolling waves down the
 *               house, then one flash); the swarm thickens; bioluminescent moss climbs the iron
 *               columns a step a link; the lanterns burn up. The chain breaking lets it all go.
 *   T-spin      a turn of the air: the fireflies, the moths, the motes and the pollen wheel
 *               round the canal and the fronds sway.
 *   four lines  the house holds its breath: a cloud crosses the moon, every light sinks, the
 *               fireflies go dark. Then the Queen of the Night opens behind the card, her long
 *               white petals reaching out round it; moonlight floods every pane and every
 *               firefly flashes at once. A perfect clear opens a second whorl and rings the moon.
 *   level up    the night moves one step along the wheel of six (moonlit-greenhouse-core.js
 *               NIGHTS); the clock alone drifts it there too, and the moon drifts with the clock.
 */
import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import {
    ARC, DEG, EYE, FLOOR, GLAZING, HOUSE, MOON_RADIUS, NIGHTS, NIGHT_COLOURS, NIGHT_SECONDS, TIMING, approach, clamp,
    clamp01, groundAt, houseExit, lerp, moonDrift, mossForCombo, mulberry32, nightAt, pieceLight, skyDirection, smooth,
    swarmForCombo, syncForCombo,
} from './moonlit-greenhouse-core.js';
import { tierFor } from './moonlit-greenhouse-quality.js';
import { palmCrownCentre, planGarden } from './moonlit-greenhouse-plan.js';
import {
    REST_RIG, aimLanding, aimLeave, boardFor, boardPoint, cardFor, fallbackLayout, fovForAspect, frameFor,
} from './moonlit-greenhouse-composition.js';
import { createGardenNoise, createNight, tune } from './moonlit-greenhouse-tsl.js';
import { createGlass } from './moonlit-greenhouse-glass.js';
import { createIron } from './moonlit-greenhouse-iron.js';
import { createFloor } from './moonlit-greenhouse-floor.js';
import { createLanterns } from './moonlit-greenhouse-lanterns.js';
import {
    createFerns, createLeaves, createPalms, createVines,
} from './moonlit-greenhouse-flora.js';
import { createPads, createReeds, createWater } from './moonlit-greenhouse-pond.js';
import {
    createDew, createFireflies, createMoths, createMotes,
} from './moonlit-greenhouse-air.js';
import { createBlooms, createQueen } from './moonlit-greenhouse-blooms.js';
import { createGlows } from './moonlit-greenhouse-glows.js';

export { REST_RIG, fovForAspect };

/** The parts a capture can show alone. */
export const MOONLIT_GREENHOUSE_PARTS = Object.freeze([
    'glass', 'iron', 'floor', 'lanterns', 'palms', 'ferns', 'leaves', 'vines', 'water', 'pads', 'reeds',
    'fireflies', 'moths', 'motes', 'dew', 'blooms', 'queen', 'glows',
]);

/** How long a level's step along the wheel of nights takes to arrive (seconds). */
const NIGHT_TURN = 7;
/** Seconds of trail a seed of light leaves behind it, and the points it is drawn with. */
const SEED_TRAIL = 0.16;
const SEED_POINTS = 12;
/** A cleared row's fireflies: how many a row (each side), and how long they glow once out. */
const STREAM_FLIERS = 9;
const STREAM_LINGER = 2.4;
/** Pollen a released bloom gives up. */
const POLLEN_MOTES = 7;

const tmpRay = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpP = new THREE.Vector3();

/** A point on a quadratic arc from a to c over the control b, at s in 0..1. */
function arcPoint(a, b, c, s, out) {
    const t = 1 - s;
    out.x = t * t * a.x + 2 * t * s * b.x + s * s * c.x;
    out.y = t * t * a.y + 2 * t * s * b.y + s * s * c.y;
    out.z = t * t * a.z + 2 * t * s * b.z + s * s * c.z;
    return out;
}

export class MoonlitGreenhouseWorld {
    /**
     * @param {object} p
     * @param {THREE.Scene} p.scene
     * @param {string} [p.quality='High']
     * @param {boolean} [p.capture=false]   built for a deterministic capture (reported in getState)
     * @param {number} [p.seed]
     * @param {number} [p.night]   hold the night at this place on the wheel, whatever the level
     *                             and the clock say (0 silver moon, 1 lavender, … 2.5 half-way)
     * @param {object} [p.tune]    overrides for TUNE (the playground's P.<name>=)
     * @param {object} [p.renderer]  unused (kept for the adapter's contract)
     */
    constructor({
        scene, quality = 'High', capture = false, seed = 1861, night = null, tune: overrides = null,
    }) {
        tune(overrides);
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture === true;
        this.seed = seed;
        this.rand = mulberry32(seed);
        this.group = new THREE.Group();
        this.group.name = 'moonlit-greenhouse-world';
        this.parts = {};
        this.camera = null;
        this.aspect = 16 / 9;
        this.viewport = { w: 1920, h: 1080 };
        this.layout = null;
        this.reducedMotion = false;
        /** The frame's time (the camera breathes on it) and the world's own clock. */
        this.time = 0;
        this.clock = 0;
        this.frame = frameFor(this.aspect, null);
        this.night = {
            from: 0, to: 0, at: -100, pin: Number.isFinite(night) ? night : null,
        };
        this.light = nightAt(0);
        this.nightRows = NIGHT_COLOURS.map(() => new THREE.Vector4(0, 0, 0, 0));
        this.lanternRowsV = Array.from({ length: 8 }, () => new THREE.Vector4(0, -100, 0, 0));
        this.bloomRowsV = Array.from({ length: 16 }, () => new THREE.Vector4(0, -100, 0, 0));
        this.ringRowsV = Array.from({ length: this.tier.rings * 2 }, () => new THREE.Vector4(0, 0, -100, 0));
        this.waveRowsV = Array.from({ length: 12 }, () => new THREE.Vector4(0, 0, -100, 0));
        this.crownRowsV = Array.from({ length: this.tier.crowns * 2 }, () => new THREE.Vector4(0, -100, 0, 1));
        this.U = {
            time: uniform(0),
            night: createNight(uniformArray(this.nightRows, 'vec4')),
            moon: uniform(new THREE.Vector3(-0.4, 0.36, -0.84).normalize()),
            moonNdc: uniform(new THREE.Vector2(-0.5, 0.6)),
            moonNdcRadius: uniform(0.06),
            moonRight: uniform(new THREE.Vector3(1, 0, 0)),
            moonUp: uniform(new THREE.Vector3(0, 1, 0)),
            moonSize: uniform(Math.sin(MOON_RADIUS * DEG)),
            /** The bay (index along the house, side −1/+1) the eye sees the moon through: its blind is up. */
            moonBay: uniform(new THREE.Vector2(-1000, -1)),
            aspect: uniform(16 / 9),
            moonCover: uniform(0),
            moonLight: uniform(1),
            stars: uniform(1),
            cloud: uniform(0.35),
            cloudDrift: uniform(new THREE.Vector2(0, 0)),
            lanternRows: uniformArray(this.lanternRowsV, 'vec4'),
            lanternCount: uniform(0),
            lanternGain: uniform(1),
            bloomLights: uniformArray(this.bloomRowsV, 'vec4'),
            bloomLightCount: uniform(0),
            crowns: uniformArray(this.crownRowsV, 'vec4'),
            crownCount: uniform(0),
            sync: uniform(0),
            swarm: uniform(0.42),
            fireflyGlow: uniform(0),
            moss: uniform(0),
            mossGlow: uniform(0),
            gust: uniform(0),
            turn: uniform(new THREE.Vector4(0, 0, 0, -8)),
            rings: uniformArray(this.ringRowsV, 'vec4'),
            ringCount: uniform(0),
            paneWaves: uniformArray(this.waveRowsV, 'vec4'),
            paneWaveCount: uniform(0),
            flood: uniform(0),
            queen: uniform(new THREE.Vector4(0, 0, -100, 0)),
            dew: uniform(new THREE.Vector4(-100, 0, 0, 0)),
            pixelAngle: uniform(0.0008),
            eye: uniform(new THREE.Vector3(EYE.x, EYE.y, EYE.z)),
            hush: uniform(0),
        };
        this.ringCount = 0;
        this.waves = [];
        /** Seeds of light in flight: { from, ctrl, to, t0, t1, rgb, hard, onWater, bloom }. */
        this.seeds = [];
        /** Fireflies released by cleared rows: { from, ctrl, to, t0, t1, rgb, seed }. */
        this.fliers = [];
        /** Pollen rising from released blooms: { x, y, z, t0, rgb, seed }. */
        this.pollen = [];
        this.state = {
            combo: 0,
            level: 1,
            sync: 0,
            moss: 0,
            swarm: swarmForCombo(0),
            lanternKick: 0,
            gust: 0,
            flash: 0,
            kick: 0,
            hushAt: -100,
            queenAt: -100,
            queenPerfect: false,
            turnAt: -100,
            turnSign: 1,
            dewAt: -100,
            dewStrength: 0,
            locks: 0,
            clears: 0,
            blooms: 0,
            released: 0,
            queens: 0,
            pitch: null,
        };
        this.moonScreen = { x: 0.24, y: 0.2, visible: 1 };
        this._point = { x: 0.5, y: 0.5 };
        this._landing = { x: 0.5, y: 0.9 };
        this._leave = { x: 0.5, y: 0.5 };
        this._jitter = [0, 0];
        this._released = [];
        this._seedP = { x: 0, y: 0, z: 0 };
        this._exit = {
            t: 0, along: 0, s: 0, wall: false, side: -1,
        };
        this._dir = { x: 0, y: 0, z: -1 };
        this._post = {
            exposure: 1,
            flash: 0,
            bloomBoost: 0,
            moonX: 0.24,
            moonY: 0.2,
            moonVisible: 1,
            shafts: 1,
            hush: 0,
            flood: 0,
            gradeShadow: [0, 0, 0],
            gradeLight: [1, 1, 1],
        };
        const fov = fovForAspect(this.aspect);
        this.restLens = new THREE.PerspectiveCamera(fov, this.aspect, REST_RIG.near, REST_RIG.far);
        this.applyNight();
    }

    build() {
        const { tier, U } = this;
        this.noise = createGardenNoise(tier.noise);
        this.plan = planGarden(tier, this.seed);
        const ctx = {
            tier, U, noise: this.noise, plan: this.plan, seed: this.seed,
        };
        this.ctx = ctx;
        const make = {
            glass: createGlass,
            iron: createIron,
            floor: createFloor,
            lanterns: createLanterns,
            palms: createPalms,
            ferns: createFerns,
            leaves: createLeaves,
            vines: createVines,
            water: createWater,
            pads: createPads,
            reeds: createReeds,
            fireflies: createFireflies,
            moths: createMoths,
            motes: createMotes,
            dew: createDew,
            blooms: createBlooms,
            queen: createQueen,
        };
        Object.keys(make).forEach((name) => {
            this.parts[name] = make[name](ctx);
        });
        this.parts.glows = createGlows({ capacity: tier.glows, U });
        Object.values(this.parts).forEach((part) => this.group.add(part.mesh));
        this.scene.add(this.group);
        // The lanterns' lights: the nearest to the eye, as many as the tier adds up.
        const most = Math.min(tier.lights, this.lanternRowsV.length);
        const lit = [...this.plan.lanterns].sort((a, b) => b.z - a.z).slice(0, most);
        this.litLanterns = lit;
        lit.forEach((l, i) => this.lanternRowsV[i].set(l.x, l.y - 0.18, l.z, 1));
        U.lanternCount.value = lit.length;
        this.crownCentres = this.plan.palms.map((palm) => palmCrownCentre(palm));
        this._crownMoon = new THREE.Vector3(0, -1, 0);
        this.pickCrowns();
        return this;
    }

    bindCamera(camera) {
        this.camera = camera;
        camera.near = REST_RIG.near;
        camera.far = REST_RIG.far;
        camera.fov = fovForAspect(this.aspect);
        camera.updateProjectionMatrix();
        this.updateCamera(camera, {
            time: this.time, delta: 0, pointerX: 0, pointerY: 0,
        });
    }

    /** Drawing-buffer size (pixels) and the CSS aspect. */
    setViewport(bufferWidth, bufferHeight, aspect) {
        this.viewport.w = Math.max(1, bufferWidth);
        this.viewport.h = Math.max(1, bufferHeight);
        if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
        const fov = fovForAspect(this.aspect);
        this.U.pixelAngle.value = (2 * Math.tan((fov * DEG) / 2)) / this.viewport.h;
        this.U.aspect.value = this.aspect;
        if (this.camera) {
            this.camera.fov = fov;
            this.camera.aspect = this.aspect;
            this.camera.updateProjectionMatrix();
        }
        frameFor(this.aspect, this.layout, this.frame);
    }

    /** The live gameplay rects (screen fractions), or null when no board is on screen. */
    setLayout(rects, aspect) {
        this.layout = rects || null;
        if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
        frameFor(this.aspect, this.layout, this.frame);
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Draw only the named parts (captures). */
    showOnlyParts(names) {
        const wanted = new Set(names);
        Object.keys(this.parts).forEach((name) => {
            this.parts[name].mesh.visible = wanted.has(name);
        });
    }

    // ── time ────────────────────────────────────────────────────────────────────

    /** Put the world at `time` with nothing in flight, on the night the clock alone gives. */
    seek(time) {
        this.time = Math.max(0, time);
        this.clock = this.time;
        this.rand = mulberry32(this.seed);
        this.resetSession();
        this.night.from = 0;
        this.night.to = 0;
        this.night.at = -100;
        this.state.pitch = null;
        this.applyNight();
    }

    /**
     * A new run: no bloom, no chain, nothing in the air. The clock runs on, and with it the
     * night's drift; what the last run's levels added eases back off.
     */
    resetSession() {
        const s = this.state;
        const { night } = this;
        night.from = this.levelPlace();
        night.to = 0;
        night.at = this.clock;
        s.combo = 0;
        s.level = 1;
        s.lanternKick = 0;
        s.gust = 0;
        s.flash = 0;
        s.kick = 0;
        s.hushAt = -100;
        s.queenAt = -100;
        s.queenPerfect = false;
        s.turnAt = -100;
        s.dewAt = -100;
        s.dewStrength = 0;
        s.locks = 0;
        s.clears = 0;
        s.blooms = 0;
        s.released = 0;
        s.queens = 0;
        this.ringCount = 0;
        this.waves.length = 0;
        this.seeds.length = 0;
        this.fliers.length = 0;
        this.pollen.length = 0;
        this.parts.blooms?.reset?.();
    }

    // ── camera ──────────────────────────────────────────────────────────────────

    /** The rest pose: the eye on the landing, the lens lifted by the frame's pitch. */
    restCamera(camera = this.restLens) {
        camera.position.set(EYE.x, EYE.y, EYE.z);
        camera.up.set(0, 1, 0);
        const pitch = this.frame.pitch * DEG;
        camera.lookAt(EYE.x, EYE.y + Math.sin(pitch), EYE.z - Math.cos(pitch));
        camera.updateMatrixWorld();
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
        return camera;
    }

    updateCamera(camera, sim) {
        const s = this.state;
        const target = this.frame.pitch;
        if (s.pitch === null) s.pitch = target;
        else s.pitch += (target - s.pitch) * approach(1.2, sim.delta);
        const t = sim.time;
        const still = this.reducedMotion ? 0 : 1;
        // Standing, breathing: a slow sway of a few centimetres and a hair of turn.
        const breathe = still * Math.sin(t * 0.42) * 0.5;
        const sway = still * (Math.sin(t * 0.17) * 0.6 + Math.sin(t * 0.11 + 1.3) * 0.4);
        const px = still * (sim.pointerX || 0);
        const py = still * (sim.pointerY || 0);
        // A hard drop shudders the house: a small jolt of the lens that dies in a few tenths.
        s.kick *= Math.exp(-9 * Math.max(0, sim.delta));
        const jolt = still * s.kick * Math.sin(t * 41) * 0.28;
        const yaw = (sway * 0.35 + px * 1.4) * DEG;
        const pitch = (s.pitch + breathe * 0.12 - py * 0.8 + jolt) * DEG;
        camera.position.set(EYE.x + px * 0.16 + sway * 0.03, EYE.y + breathe * 0.015, EYE.z);
        camera.up.set(Math.sin(sway * 0.003), 1, 0).normalize();
        tmpRay.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
        camera.lookAt(camera.position.x + tmpRay.x, camera.position.y + tmpRay.y, camera.position.z + tmpRay.z);
        camera.updateMatrixWorld();
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    }

    /** A screen point (fractions, y down) → the world ray through it (unit). */
    screenRay(x, y, out = tmpRay, camera = this.camera) {
        return out.set(x * 2 - 1, 1 - y * 2, 0.5).unproject(camera).sub(camera.position).normalize();
    }

    /**
     * Where a screen point's ray meets the garden: the water in the canal, the path or a bed's
     * soil (the first it reaches), clamped to the house. Returns { x, y, z, kind }.
     */
    castGround(x, y, out = {}) {
        const { camera } = this;
        const ray = this.screenRay(x, y, tmpV);
        const p = camera.position;
        // March the ray down to the surfaces (each is flat; a few steps find which is hit first).
        let hit = null;
        if (ray.y < -1e-3) {
            for (const level of [FLOOR.bed.soil, 0, FLOOR.canal.water]) {
                const t = (level - p.y) / ray.y;
                if (t <= 0) continue;
                const hx = p.x + ray.x * t;
                const hz = p.z + ray.z * t;
                const g = groundAt(hx, hz);
                if (Math.abs(g.y - level) < 1e-3) {
                    hit = {
                        x: hx, y: level, z: hz, kind: g.kind,
                    };
                    break;
                }
            }
        }
        if (!hit) {
            const t = 18;
            const hx = p.x + ray.x * t;
            const hz = p.z + ray.z * t;
            const g = groundAt(hx, hz);
            hit = {
                x: hx, y: g.y, z: hz, kind: g.kind,
            };
        }
        hit.x = clamp(hit.x, -(HOUSE.halfSpan - 0.6), HOUSE.halfSpan - 0.6);
        hit.z = clamp(hit.z, -44, FLOOR.canal.head - 0.3);
        const g = groundAt(hit.x, hit.z);
        // Nothing grows on the path: a bloom meant for it opens at the bed's edge beside it.
        if (g.kind === 'path') {
            hit.x = Math.sign(hit.x || 1) * (FLOOR.bed.inner + 0.3);
            hit.kind = 'bed';
            hit.y = FLOOR.bed.soil;
        } else {
            hit.kind = g.kind;
            hit.y = g.y;
        }
        // On the water, keep clear of the coping.
        if (hit.kind === 'water') hit.x = clamp(hit.x, -(FLOOR.canal.half - 0.35), FLOOR.canal.half - 0.35);
        Object.assign(out, hit);
        return out;
    }

    /** The layout events aim at: the live one, else the stylesheet's solo layout for this shape. */
    aimLayout() {
        return this.layout || fallbackLayout(this.aspect * 1000, 1000);
    }

    // ── tables ──────────────────────────────────────────────────────────────────

    /** A ring on the canal at (x, z), born at `at` (it may be in the future). */
    addRing(x, z, at, strength, rgb, light) {
        const cap = this.ringRowsV.length / 2;
        if (this.ringCount >= cap) {
            for (let i = 2; i < this.ringCount * 2; i += 1) this.ringRowsV[i - 2].copy(this.ringRowsV[i]);
            this.ringCount -= 1;
        }
        const k = this.ringCount * 2;
        this.ringRowsV[k].set(x, z, at, strength);
        this.ringRowsV[k + 1].set(rgb[0], rgb[1], rgb[2], light);
        this.ringCount += 1;
    }

    /** A wave of moonlight across the glazing from (along, s) on the vault, born at `at`. */
    addWave(along, s, at, strength, rgb, speed = TIMING.paneWave) {
        if (this.waves.length >= this.waveRowsV.length / 2) this.waves.shift();
        this.waves.push({
            along, s, at, strength, rgb: [rgb[0], rgb[1], rgb[2]], speed,
        });
    }

    // ── events ──────────────────────────────────────────────────────────────────

    /** A piece locked: { player, rows, u, hardDrop, color, screen }. */
    onLock(c) {
        if (!this.camera) return;
        const s = this.state;
        s.locks += 1;
        const hard = c.hardDrop === true;
        const rgb = pieceLight(c.color, [1, 0.84, 0.52]);
        let landX = 0.25;
        let landY = 0.85;
        let leaveX = 0.42;
        let leaveY = 0.6;
        if (c.screen) {
            landX = c.screen.x;
            landY = Math.max(c.screen.y, 0.56);
            leaveX = c.screen.x;
            leaveY = c.screen.y;
        } else {
            const layout = this.aimLayout();
            const board = boardFor(layout, c.player || 0);
            if (board) {
                const rows = c.rows?.length ? c.rows : [19];
                const row = rows[Math.floor(rows.length / 2)];
                const u = clamp01(c.u ?? 0.5);
                boardPoint(board, u, row, this._point);
                const card = cardFor(layout, board) || board;
                this._jitter[0] = this.rand() * 2 - 1;
                this._jitter[1] = this.rand() * 2 - 1;
                aimLanding(layout, card, this._point, u, row, this._jitter, this._landing);
                aimLeave(card, this._point, this._landing, this._leave);
                landX = this._landing.x;
                landY = this._landing.y;
                leaveX = this._leave.x;
                leaveY = this._leave.y;
            }
        }
        const to = this.castGround(landX, landY, {});
        const ray = this.screenRay(leaveX, leaveY, tmpV);
        const p = this.camera.position;
        const from = { x: p.x + ray.x * 3.2, y: p.y + ray.y * 3.2, z: p.z + ray.z * 3.2 };
        const ctrl = {
            x: lerp(from.x, to.x, 0.5), y: Math.max(from.y, to.y) + 1.4 + this.rand() * 0.8, z: lerp(from.z, to.z, 0.5),
        };
        const t0 = this.clock;
        const t1 = t0 + TIMING.seedFlight * (hard ? 0.7 : 1);
        const onWater = to.kind === 'water';
        const bloom = this.parts.blooms?.add?.({
            x: to.x,
            y: to.y,
            z: to.z,
            rgb,
            at: t1,
            hard,
            onWater,
            seed: this.rand(),
        });
        if (bloom) s.blooms += 1;
        this.seeds.push({
            from, ctrl, to: { x: to.x, y: to.y + 0.25, z: to.z }, t0, t1, rgb: [rgb[0], rgb[1], rgb[2]], hard,
        });
        if (onWater) this.addRing(to.x, to.z, t1, hard ? 1.6 : 1, rgb, hard ? 1.4 : 1);
        if (hard) {
            s.dewAt = this.clock;
            s.dewStrength = 1;
            s.flash = Math.max(s.flash, 0.05);
            s.gust = Math.min(1, s.gust + 0.25);
            s.kick = 1;
        }
    }

    /** Lines cleared: { player, rows, lines, combo, cascade, tspin, perfect, b2b, screen }. */
    onClear(c) {
        if (!this.camera) return;
        const s = this.state;
        s.clears += 1;
        const lines = Math.max(1, Math.min(4, Math.round(Number(c.lines)) || 1));
        const big = lines >= 4 || c.perfect === true;
        const layout = this.aimLayout();
        const board = boardFor(layout, c.player || 0);
        const card = board ? cardFor(layout, board) || board : null;
        const rows = c.rows?.length ? c.rows : [19];
        const night = this.light;
        // Each cleared row releases a ribbon of fireflies from both edges of the card.
        if (card && board) {
            const p = this.camera.position;
            for (let r = 0; r < Math.min(4, rows.length); r += 1) {
                boardPoint(board, 0.5, rows[r], this._point);
                for (const side of [-1, 1]) {
                    const ex = side < 0 ? card.x0 : card.x1;
                    const ray = this.screenRay(ex, this._point.y, tmpV);
                    const from = { x: p.x + ray.x * 3.4, y: p.y + ray.y * 3.4, z: p.z + ray.z * 3.4 };
                    for (let k = 0; k < STREAM_FLIERS; k += 1) {
                        const to = {
                            x: side * lerp(3.2, 6.2, this.rand()),
                            y: lerp(0.8, 4.2, this.rand()),
                            z: lerp(-2, -26, this.rand() ** 1.4),
                        };
                        const ctrl = {
                            x: lerp(from.x, to.x, 0.35) + side * 0.8,
                            y: Math.max(from.y, to.y) + lerp(0.2, 1.6, this.rand()),
                            z: lerp(from.z, to.z, 0.6),
                        };
                        const t0 = this.clock + r * 0.07 + k * 0.035;
                        this.fliers.push({
                            from,
                            ctrl,
                            to,
                            t0,
                            t1: t0 + TIMING.streamFlight * lerp(0.75, 1.25, this.rand()),
                            seed: this.rand(),
                        });
                    }
                }
            }
            const most = this.tier.glows * 0.45;
            if (this.fliers.length > most) this.fliers.splice(0, this.fliers.length - most);
        }
        // A wave of moonlight runs across the glazing, one front a line, from the ridge above the
        // card toward the eye.
        for (let i = 0; i < lines; i += 1) {
            const at = this.clock + i * 0.24 + (big ? TIMING.hush : 0);
            const tint = i % 2 === 0 ? night.moonlight : night.glow;
            this.addWave(-30, ARC.length, at, (big ? 1.4 : 0.8) + lines * 0.15, tint);
        }
        // The oldest blooms give up their pollen and close: one a line, more in a chain, all of
        // them for four lines.
        const chain = Math.min(3, Math.floor(Math.max(0, (c.combo ?? s.combo) - 1) / 2));
        const count = big ? Infinity : lines + chain;
        const released = this._released;
        released.length = 0;
        this.parts.blooms?.release?.(count, this.clock + (big ? TIMING.hush + 0.3 : 0.1), released);
        s.released += released.length;
        for (let i = 0; i < released.length; i += 1) {
            const b = released[i];
            for (let k = 0; k < POLLEN_MOTES; k += 1) {
                this.pollen.push({
                    x: b.x, y: b.y, z: b.z, t0: b.at + k * 0.05, rgb: b.rgb, seed: this.rand(),
                });
            }
        }
        const pollenMost = Math.floor(this.tier.glows * 0.3);
        if (this.pollen.length > pollenMost) this.pollen.splice(0, this.pollen.length - pollenMost);
        s.lanternKick = Math.min(1.5, s.lanternKick + 0.25 + lines * 0.1);
        s.flash = Math.max(s.flash, 0.04 + lines * 0.03);
        if (c.tspin) {
            s.turnAt = this.clock;
            s.turnSign = this.rand() < 0.5 ? -1 : 1;
            s.gust = Math.min(1.2, s.gust + 0.6);
        }
        if (big) {
            s.hushAt = this.clock;
            s.queenAt = this.clock + TIMING.hush;
            s.queenPerfect = c.perfect === true;
            s.queens += 1;
        }
    }

    /** The longest chain any board is holding (0 = it broke). */
    onCombo(combo) {
        this.state.combo = Math.max(0, combo | 0);
    }

    /** A new level: the night moves one step along the wheel (`silent`: it simply is that level). */
    levelUp(level, { silent = false } = {}) {
        const s = this.state;
        const { night } = this;
        s.level = Math.max(1, level | 0);
        night.from = silent ? s.level - 1 : this.levelPlace();
        night.to = s.level - 1;
        night.at = silent ? -100 : this.clock;
        this.applyNight();
        // The new night announces itself: a slow wave of its own glow runs across the glazing from
        // the ridge above the card.
        if (!silent) {
            const next = nightAt(night.to + this.clock / NIGHT_SECONDS, {});
            this.addWave(-24, ARC.length, this.clock + 0.4, 1.4, next.glow, TIMING.paneWave * 0.55);
        }
    }

    // ── the night ───────────────────────────────────────────────────────────────

    /** The place the level holds on the wheel right now (eased while it turns). */
    levelPlace() {
        const { night } = this;
        const k = smooth(0, NIGHT_TURN, this.clock - night.at);
        return lerp(night.from, night.to, k);
    }

    /** Where the house stands on the wheel: the level's place plus what the clock has drifted. */
    nightPlace() {
        return this.night.pin ?? this.levelPlace() + this.clock / NIGHT_SECONDS;
    }

    /** Hand the night's colours to the shaders. */
    applyNight() {
        const { U } = this;
        const light = nightAt(this.nightPlace(), this.light);
        for (let i = 0; i < NIGHT_COLOURS.length; i += 1) {
            const colour = light[NIGHT_COLOURS[i]];
            this.nightRows[i].set(colour[0], colour[1], colour[2], 0);
        }
        U.stars.value = light.stars;
        U.cloud.value = light.cloud;
    }

    /** Point the moon where the frame wants it (through the rest lens) plus the clock's drift. */
    placeMoon(camera) {
        const { U } = this;
        const rest = this.restLens;
        rest.aspect = this.aspect;
        rest.fov = fovForAspect(this.aspect);
        rest.updateProjectionMatrix();
        this.restCamera(rest);
        const dir = this.screenRay(this.frame.moonX, this.frame.moonY, tmpP, rest);
        let az = Math.atan2(dir.x, -dir.z) / DEG;
        const el = Math.asin(clamp(dir.y, -1, 1)) / DEG;
        // The moon is seen between two ribs, never behind one: its line of sight is moved to cross
        // the vault in the middle of the nearest bay (one Newton step on its azimuth). The clock's
        // drift then moves it less than half a bay either way.
        const exit = houseExit(rest.position, skyDirection(az, el, this._dir), this._exit);
        if (!exit.wall) {
            const at = exit.along;
            const nudged = houseExit(rest.position, skyDirection(az + 0.5, el, this._dir), this._exit).along;
            const perDegree = (nudged - at) / 0.5;
            const bay = GLAZING.ribEvery;
            const middle = Math.round((at - bay / 2) / bay) * bay + bay / 2;
            if (Math.abs(perDegree) > 1e-3) az += clamp((middle - at) / perDegree, -6, 6);
        }
        const drift = moonDrift(this.clock);
        const a = (az + drift.az) * DEG;
        const e = (el + drift.el) * DEG;
        U.moon.value.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
        // The disc's frame on the sky (the water's mirror draws it about the moon's direction).
        const m = U.moon.value;
        U.moonRight.value.set(-m.z, 0, m.x).normalize();
        if (m.z > 0) U.moonRight.value.negate();
        U.moonUp.value.crossVectors(U.moonRight.value, m).normalize();
        if (U.moonUp.value.y < 0) U.moonUp.value.negate();
        // The bay the eye sees it through keeps its blind up: the moon is never behind the laths.
        const seen = houseExit(rest.position, m, this._exit);
        U.moonBay.value.set(seen.wall ? -1000 : Math.floor(seen.along / GLAZING.ribEvery), seen.side);
        // Where it stands in the live lens (the glass draws the disc in the image plane).
        if (camera) {
            tmpV.copy(m).multiplyScalar(100).add(camera.position).project(camera);
            U.moonNdc.value.set(tmpV.x, tmpV.y);
            U.moonNdcRadius.value = Math.tan(MOON_RADIUS * DEG) / Math.tan((camera.fov * DEG) / 2);
            const ahead = tmpRay.set(0, 0, -1).transformDirection(camera.matrixWorld).dot(m);
            this.moonScreen.x = tmpV.x * 0.5 + 0.5;
            this.moonScreen.y = 0.5 - tmpV.y * 0.5;
            this.moonScreen.visible = ahead > 0.2 ? 1 : 0;
        }
    }

    /**
     * The palm crowns whose fronds shadow what the eye sees: those whose shadow falls inside the
     * house in front of the eye (with the moon on the left, the left palms), nearest first.
     * Picked again whenever the moon has moved.
     */
    pickCrowns() {
        const m = this.U.moon.value;
        if (!this.plan || this._crownMoon.angleTo(m) < 0.008) return;
        this._crownMoon.copy(m);
        const scored = [];
        this.plan.palms.forEach((palm, i) => {
            const c = this.crownCentres[i];
            const k = c.y / Math.max(m.y, 0.05);
            const sx = c.x - m.x * k;
            const sz = c.z - m.z * k;
            // Its shadow on the floor must fall inside the house and in front of the eye; the beams
            // just under it show wherever it stands.
            const inside = Math.abs(sx) < HOUSE.halfSpan && sz < EYE.z && sz > -46;
            const near = Math.abs(sx) < HOUSE.halfSpan + 3 && sz < EYE.z + 6;
            if (!inside && !near) return;
            scored.push({ palm, c, score: (inside ? 0 : 40) + Math.abs(sz + 12) });
        });
        scored.sort((a, b) => a.score - b.score);
        const n = Math.min(this.tier.crowns, scored.length);
        for (let i = 0; i < n; i += 1) {
            const { palm, c } = scored[i];
            this.crownRowsV[i * 2].set(c.x, c.y, c.z, palm.crown);
            this.crownRowsV[i * 2 + 1].set(palm.fronds, palm.twist, palm.seed, 0);
        }
        this.U.crownCount.value = n;
    }

    // ── frame ───────────────────────────────────────────────────────────────────

    update(sim, camera) {
        if (!this.parts.glass) return;
        const dt = Math.max(0, sim.delta);
        this.time = sim.time;
        const { U } = this;
        const s = this.state;
        this.clock += dt;
        const t = this.clock;
        U.time.value = t;
        this.applyNight();
        this.placeMoon(camera);
        this.pickCrowns();
        U.cloudDrift.value.set(t * 0.0021, -t * 0.0009);

        // The chain: the fireflies fall into step, the swarm thickens, the moss climbs.
        const { combo } = s;
        const sync = syncForCombo(combo);
        s.sync += (sync - s.sync) * approach(sync > s.sync ? 1.1 : 0.45, dt);
        const moss = mossForCombo(combo);
        s.moss += (moss - s.moss) * approach(moss > s.moss ? 1.6 : 0.3, dt);
        const swarm = swarmForCombo(combo);
        s.swarm += (swarm - s.swarm) * approach(0.8, dt);
        U.sync.value = s.sync;
        U.moss.value = s.moss;
        U.mossGlow.value = clamp01(s.moss / 1.2);
        U.swarm.value = s.swarm;

        // The hush and the Queen of the Night.
        const hushAge = t - s.hushAt;
        const hush = hushAge >= 0 && hushAge < TIMING.hush + 1.2
            ? smooth(0, 0.12, hushAge) * (1 - smooth(TIMING.hush, TIMING.hush + 0.9, hushAge))
            : 0;
        U.hush.value = hush;
        const qAge = t - s.queenAt;
        const qLife = TIMING.queenOpen + TIMING.queenHold + TIMING.queenClose;
        let open = 0;
        let glow = 0;
        if (qAge >= 0 && qAge < qLife) {
            open = smooth(0, TIMING.queenOpen, qAge) * (1 - smooth(TIMING.queenOpen + TIMING.queenHold, qLife, qAge));
            glow = smooth(0, 0.5, qAge) * (1 - smooth(TIMING.queenOpen, qLife, qAge) * 0.85);
        }
        U.queen.value.set(open, glow, s.queenAt, s.queenPerfect ? 1 : 0);
        const flood = qAge >= 0 && qAge < 3.5 ? smooth(0, 0.35, qAge) * (1 - smooth(0.6, 3.5, qAge)) : 0;
        U.flood.value = flood;
        U.moonCover.value = clamp01(hush * 0.9 + this.light.cloud * 0.05);
        U.moonLight.value = (1 - hush * 0.8) * (1 + flood * 0.6);

        // The fireflies' light in the garden: the swarm's mean flash (in step it pulses).
        const beat = Math.sin(((t / 1.9) % 1) * Math.PI) ** 8;
        U.fireflyGlow.value = (s.swarm * (0.35 + s.sync * beat * 1.4) + flood * 1.5) * (1 - hush);

        // The lanterns burn up with a chain and a clear, and flicker.
        s.lanternKick *= Math.exp(-0.7 * dt);
        U.lanternGain.value = this.light.lanterns * (1 + s.sync * 0.35 + s.lanternKick * 0.5) * (1 - hush * 0.85);
        for (let i = 0; i < this.litLanterns.length; i += 1) {
            const l = this.litLanterns[i];
            const flicker = 1 + Math.sin(t * (7.1 + l.seed * 3) + l.seed * 40) * 0.04
                + Math.sin(t * 13.3 + l.seed * 9) * 0.025;
            this.lanternRowsV[i].w = flicker;
        }

        // The turn of the air (T-spin), the gusts, the dew.
        const turnAge = t - s.turnAt;
        const turning = turnAge >= 0 && turnAge < TIMING.turn ? Math.sin(Math.PI * smooth(0, TIMING.turn, turnAge)) : 0;
        U.turn.value.set(s.turnSign * Math.PI * 1.2 * smooth(0, TIMING.turn, Math.max(0, turnAge)), turning, 0, -9);
        s.gust *= Math.exp(-0.9 * dt);
        U.gust.value = clamp01(s.gust + turning * 0.6 + flood * 0.3);
        U.dew.value.set(s.dewAt, s.dewStrength, 0, 0);

        // Rings run their course.
        while (this.ringCount > 0 && t - this.ringRowsV[0].z > TIMING.ringLife) {
            for (let i = 2; i < this.ringCount * 2; i += 1) this.ringRowsV[i - 2].copy(this.ringRowsV[i]);
            this.ringCount -= 1;
        }
        U.ringCount.value = this.ringCount;
        // Waves across the glazing.
        let w = 0;
        const reach = 90;
        for (let i = 0; i < this.waves.length; i += 1) {
            const v = this.waves[i];
            const age = t - v.at;
            if (age > reach / v.speed) continue;
            this.waveRowsV[w * 2].set(v.along, v.s, v.at, v.strength);
            this.waveRowsV[w * 2 + 1].set(v.rgb[0], v.rgb[1], v.rgb[2], v.speed);
            w += 1;
        }
        while (this.waves.length && t - this.waves[0].at > reach / this.waves[0].speed) this.waves.shift();
        U.paneWaveCount.value = w;

        s.flash *= Math.exp(-4 * dt);
        this.parts.blooms?.update?.(this);
        this.updateBloomLights(camera);
        this.updateGlows(camera);
        Object.keys(this.parts).forEach((name) => {
            if (name !== 'blooms' && name !== 'glows') this.parts[name].update?.(this);
        });
    }

    /** The open blooms the garden is lit by: the brightest and nearest, in the shaders' rows. */
    updateBloomLights(camera) {
        const list = this.parts.blooms?.lights?.(this.clock) || [];
        const eye = camera ? camera.position : { x: EYE.x, y: EYE.y, z: EYE.z };
        const cap = Math.min(this.tier.lights, this.bloomRowsV.length / 2);
        const scored = list.map((l) => ({ l, score: l.strength / (1 + Math.hypot(l.x - eye.x, l.z - eye.z) * 0.15) }));
        scored.sort((a, b) => b.score - a.score);
        const n = Math.min(cap, scored.length);
        for (let i = 0; i < n; i += 1) {
            const { l } = scored[i];
            this.bloomRowsV[i * 2].set(l.x, l.y, l.z, l.strength);
            this.bloomRowsV[i * 2 + 1].set(l.rgb[0], l.rgb[1], l.rgb[2], l.radius ?? 1.6);
        }
        this.U.bloomLightCount.value = n;
    }

    /** The small lights: seeds in flight, the cleared rows' fireflies, rising pollen, lantern halos. */
    updateGlows() {
        const { glows } = this.parts;
        const t = this.clock;
        const night = this.light;
        const dim = 1 - this.U.hush.value * 0.9;
        glows.begin();
        // Seeds of light, with their trails.
        for (let i = this.seeds.length - 1; i >= 0; i -= 1) {
            const sd = this.seeds[i];
            if (t > sd.t1 + 0.05) {
                this.seeds.splice(i, 1);
                continue;
            }
            if (t < sd.t0) continue;
            const span = sd.t1 - sd.t0;
            for (let j = 0; j < SEED_POINTS; j += 1) {
                const back = (j / SEED_POINTS) * SEED_TRAIL;
                const s = clamp01((t - sd.t0 - back) / span);
                if (t - back < sd.t0) break;
                arcPoint(sd.from, sd.ctrl, sd.to, s * s * (3 - 2 * s), this._seedP);
                const fade = (1 - j / SEED_POINTS) ** 1.6;
                const hot = j === 0 ? 2.6 : 1;
                const k = 3.2 * fade * hot;
                glows.push(
                    this._seedP.x,
                    this._seedP.y,
                    this._seedP.z,
                    j === 0 ? 0.13 : 0.07 * fade + 0.02,
                    sd.rgb[0] * k,
                    sd.rgb[1] * k,
                    sd.rgb[2] * k,
                    0,
                );
            }
        }
        // The cleared rows' fireflies: out along their arcs, then glowing where they settle.
        const ff = night.firefly;
        for (let i = this.fliers.length - 1; i >= 0; i -= 1) {
            const f = this.fliers[i];
            const age = t - f.t0;
            const life = f.t1 - f.t0 + STREAM_LINGER;
            if (age > life) {
                this.fliers.splice(i, 1);
                continue;
            }
            if (age < 0) continue;
            const s = clamp01(age / (f.t1 - f.t0));
            arcPoint(f.from, f.ctrl, f.to, 1 - (1 - s) * (1 - s), this._seedP);
            const blink = 0.55 + 0.45 * Math.sin(t * (5 + f.seed * 4) + f.seed * 30);
            const k = 2.4 * blink * (1 - smooth(life - 1.2, life, age)) * dim;
            glows.push(
                this._seedP.x,
                this._seedP.y + Math.sin(age * 2 + f.seed * 9) * 0.05 * s,
                this._seedP.z,
                0.05,
                ff[0] * k,
                ff[1] * k,
                ff[2] * k,
                0,
            );
        }
        // Pollen rising from closing blooms toward the glass, drifting, glittering in the beams.
        const rise = TIMING.pollenRise;
        for (let i = this.pollen.length - 1; i >= 0; i -= 1) {
            const p = this.pollen[i];
            const age = t - p.t0;
            if (age > rise) {
                this.pollen.splice(i, 1);
                continue;
            }
            if (age < 0) continue;
            const s = age / rise;
            const a = p.seed * 40 + age * (0.6 + p.seed);
            const r = 0.15 + s * 0.9;
            const k = (smooth(0, 0.3, age) * (1 - smooth(0.6, 1, s))) * 2.2 * dim;
            const tint = 0.65;
            glows.push(
                p.x + Math.cos(a) * r,
                p.y + 0.2 + s * s * 5.5 + s * 1.5,
                p.z + Math.sin(a) * r,
                0.03,
                lerp(p.rgb[0], 1, tint) * k,
                lerp(p.rgb[1], 0.95, tint) * k,
                lerp(p.rgb[2], 0.7, tint) * k,
                2,
            );
        }
        glows.end();
    }

    /** What the post stack should know this frame (the same object every frame). */
    getPostState() {
        const s = this.state;
        const L = this.light;
        const o = this._post;
        const hush = this.U.hush.value;
        o.exposure = L.exposure * (1 - hush * 0.25);
        o.flash = s.flash + this.U.flood.value * 0.25;
        o.bloomBoost = s.sync * 0.25 + this.U.flood.value * 0.6 + this.U.queen.value.y * 0.4;
        o.moonX = this.moonScreen.x;
        o.moonY = this.moonScreen.y;
        o.moonVisible = this.moonScreen.visible;
        o.shafts = this.U.moonLight.value;
        o.hush = hush;
        o.flood = this.U.flood.value;
        o.gradeShadow[0] = L.gradeShadow[0];
        o.gradeShadow[1] = L.gradeShadow[1];
        o.gradeShadow[2] = L.gradeShadow[2];
        o.gradeLight[0] = L.gradeLight[0];
        o.gradeLight[1] = L.gradeLight[1];
        o.gradeLight[2] = L.gradeLight[2];
        return o;
    }

    getState() {
        const s = this.state;
        return {
            quality: this.quality,
            capture: this.capture,
            time: this.time,
            clock: this.clock,
            combo: s.combo,
            level: s.level,
            night: this.light.name,
            nightNext: this.light.next,
            nightMix: this.light.mix,
            nightPlace: this.nightPlace(),
            nights: NIGHTS.length,
            sync: s.sync,
            moss: s.moss,
            swarm: s.swarm,
            hush: this.U.hush.value,
            queen: this.U.queen.value.x,
            flood: this.U.flood.value,
            rings: this.ringCount,
            waves: this.U.paneWaveCount.value,
            seeds: this.seeds.length,
            fliers: this.fliers.length,
            pollen: this.pollen.length,
            open: this.parts.blooms?.count?.() ?? 0,
            locks: s.locks,
            clears: s.clears,
            blooms: s.blooms,
            released: s.released,
            queens: s.queens,
            layoutLive: !!this.layout,
            moon: { ...this.moonScreen },
            counts: {
                glows: this.parts.glows?.count ?? 0,
                bloomLights: this.U.bloomLightCount.value,
                lanterns: this.U.lanternCount.value,
            },
        };
    }

    get combo() {
        return this.state.combo;
    }

    dispose() {
        Object.values(this.parts).forEach((part) => part.dispose());
        this.parts = {};
        this.group.removeFromParent();
        this.noise?.dispose();
        this.noise = null;
        this.camera = null;
    }
}
