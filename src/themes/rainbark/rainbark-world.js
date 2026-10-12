/**
 * Rainbark — the world.
 *
 * Owns the shared uniforms, every scene part, the camera rig and the choreography. Shared by the
 * theme (rainbark-theme.js) and the playground effect (src/playground/effects/rainbark.effect.js),
 * so what is iterated there ships.
 *
 * We hang in the middle storey of a forest of painted giants, looking level into blue air: the
 * Elder's wall of bark cropped on the left, two slim Sisters set deep on the right, the grove
 * receding diagonally behind the card, the canopy's lace far above and a floor of luminous mist
 * below. The board feeds it:
 *
 *   lock     the Peel: a strip of bark peels off a lane trunk at the piece's rows, and under it
 *            is fresh bark of the piece's own colour (every piece is one age of the bark). A
 *            hard drop is the Knock: the strip tears off whole and a gloss pulse runs up.
 *   clear    the Shed: a girdle splits at each cleared row on both near trunks, its sheet drops
 *            into the mist, and the ring under it blazes First Skin, then ripens into the row's
 *            own colours.
 *   four     the Great Moult: every trunk in view sheds its skin and stands in First Skin, then
 *            ripens back in flames of colour.
 *   combo    each link opens a gap in the canopy: one counted pool of sunlight per link.
 *   release  the Set: the gaps close and a curtain of curls falls, sized by the chain's peak.
 *   B2B      the Sunshower: rain in the light and wet, glistening bark while the chain lives.
 *   T-spin   the Unwinding: a helical strip unwinds like an apple peel; amber beads well up.
 *   perfect  the Floor: the mist drains and the forest floor shows for the first time.
 *   level    the Climb: the walkway rises a storey (12 m) and the giants slide down past us.
 *   over     Mistfall: the mist rises past the camera; a new run brings the morning back.
 *
 * The parts are built from a registry (PART_BUILDERS); a part not built yet is simply absent.
 * Nothing is created at event time: events write numbers into preallocated state, so seek(t)
 * plus a fixed-step replay reproduces any frame. What moves at a changing rate is integrated
 * (the group clocks); everything else is closed form in the clock.
 */

import * as THREE from 'three/webgpu';
import {
    DEG,
    MISTFALL,
    PALETTE_ROWS,
    SUN_AZIMUTH,
    SUN_DRIFT,
    TAU,
    TIDE_PERIOD,
    ZONES,
    ZONE_COLOR_KEYS,
    clamp01,
    climbHeight,
    createRainbarkUniforms,
    hexToLinear,
    lerp,
    pieceCode,
    smooth,
    smoother,
    sunDirection,
    tideAt,
    zoneIndex,
} from './rainbark-tsl.js';
import { tierFor } from './rainbark-quality.js';
import { createSky } from './rainbark-sky.js';
import { fallbackLayout } from './rainbark-composition.js';

/** The rest camera. */
export const REST_RIG = Object.freeze({
    near: 0.3,
    far: 3000,
    minFov: 30,
    maxFov: 78,
});

/** Every part of the picture, in draw order of build (the URL reference lists the same names). */
export const RAINBARK_PARTS = Object.freeze(['sky', 'trunks', 'mist', 'curls', 'fx', 'life']);

/** Builders of the parts that exist so far; the rest arrive with the grove. */
const PART_BUILDERS = Object.freeze({
    sky: (world) => createSky(world.u, world.tier),
});

/** Portrait → landscape, and landscape → ultrawide, as 0..1 weights of the aspect. */
function aspectWeights(aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    return { k: smooth(0.62, 1.5, a), w: smooth(1.78, 2.4, a) };
}

/** Vertical field of view (degrees) for an aspect: 64° upright … 50° at 16:9 … 44° at 21:9. */
export function fovForAspect(aspect) {
    const { k, w } = aspectWeights(aspect);
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, 64 - 14 * k - 6 * w));
}

/** How far the view is pitched up (degrees): 9° upright, 6° at 16:9, 5° at 21:9. */
export function pitchForAspect(aspect) {
    const { k, w } = aspectWeights(aspect);
    return 9 - 3 * k - 1 * w;
}

/** The camera's breath (metres, Lissajous at 0.05 / 0.037 Hz) and the mouse's reach. */
const BREATH_X = 0.15;
const BREATH_Y = 0.1;
const BREATH_FX = 0.05;
const BREATH_FY = 0.037;
const PARALLAX = 0.25;
/** The Climb: it waits this long after the latest clear, then rises over CLIMB_TIME. */
const CLIMB_DELAY = 1.2;
const CLIMB_TIME = 3.5;
/** Under reduced motion the camera never moves: the zone crossfades instead, over this long. */
const CLIMB_FADE = 1.2;
/** Mistfall rises over this long; the morning drains it over MORNING_TIME. */
const MISTFALL_TIME = 4;
const MORNING_TIME = 3;
/** A new run's descent waits under the rising mist for this long. */
const MISTFALL_COVER = 2.5;
/** The grove's age drift (§3.4): bias at a session's start, per minute, and its cap. */
const AGE_BIAS_START = 0.3;
const AGE_BIAS_RATE = 0.05;
const AGE_BIAS_CAP = 1.2;
/** Group clocks wrap here (float precision in the bark's age maths). */
const CLOCK_WRAP = 65536;

function emptyCounts() {
    return {
        locks: 0,
        hardDrops: 0,
        clears: 0,
        lines: 0,
        quads: 0,
        tspins: 0,
        perfects: 0,
        chainSteps: 0,
        releases: 0,
        b2bSteps: 0,
        levelUps: 0,
        gameOvers: 0,
        mornings: 0,
    };
}

export class RainbarkWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {boolean} [params.capture=false]  deterministic captures: no wall-clock anywhere
     * @param {number} [params.seed]
     */
    constructor({
        scene, quality = 'High', capture = false, seed = 0x7a1b,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture;
        this.seed = seed;
        this.root = new THREE.Group();
        this.root.name = 'Rainbark';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        this._camera = null;
        this._rest = new THREE.PerspectiveCamera(fovForAspect(this.aspect), this.aspect, REST_RIG.near, REST_RIG.far);
        this._rgb = [0, 0, 0];
        this._rgbB = [0, 0, 0];
        this._sun = [0, 0, 0];
        this._zoneMix = { a: 0, b: 0, mix: 0 };
        /** Each zone's colours (and the Mistfall look's) as linear rgb, converted once. */
        this._zoneRgb = ZONES.map((zone) => this.linearColors(zone.colors));
        this._mistRgb = this.linearColors(MISTFALL.colors);
        this._post = {
            exposure: 1,
            iris: 1,
            sat: 1,
            bloomBoost: 0,
            gradeShadow: [0, 0, 0],
            gradeLight: [1, 1, 1],
        };
        this.lastLock = {
            at: -1e6, player: 0, u: 0.5, rowTop: 19, rowBottom: 19, code: 7, color: null, hardDrop: false, distance: 0,
        };
        this.lastClear = {
            at: -1e6, player: 0, lines: 0, combo: 0, cascade: 1, tspin: false, perfect: false, b2b: false,
        };
        this.lastClear.rows = [];
        this.lastClear.rowCodes = [];
        this.resetState(0);
    }

    linearColors(colors) {
        const out = {};
        ZONE_COLOR_KEYS.forEach((key) => { out[key] = hexToLinear(colors[key]); });
        return out;
    }

    /** Everything the choreography remembers, as it stands at `time` on level one. */
    resetState(time) {
        this.time = time;
        this.level = 1;
        this.camY = climbHeight(1);
        /** The rise in flight (or a jump waiting under the mist), else null. */
        this.climb = null;
        this.zone = zoneIndex(1);
        /** Mistfall: from, to, the moment it began and how long it takes. */
        this.mistfall = {
            from: 0, to: 0, start: -1e6, length: MISTFALL_TIME,
        };
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.sheds = 0;
        this.sessionAge = 0;
        this.lastLock.at = -1e6;
        this.lastClear.at = -1e6;
        this.lastRelease = { at: -1e6, peak: 0 };
        /** The four group clocks (Elder, Sisters, R1/R2, far): integrated, a chain quickens them. */
        this.clocks = [time % CLOCK_WRAP, time % CLOCK_WRAP, time % CLOCK_WRAP, time % CLOCK_WRAP];
        this.counts = emptyCounts();
    }

    build() {
        this.u = createRainbarkUniforms();
        RAINBARK_PARTS.forEach((name) => {
            const make = PART_BUILDERS[name];
            if (make) this.addPart(name, make(this));
        });
        this.resetState(this.time);
        this.scene.add(this.root);
        return this;
    }

    addPart(name, part) {
        this.parts[name] = part;
        this.root.add(part.mesh);
        this.disposables.push(part);
    }

    /** Draw only the named parts (captures, bisecting a look). Unknown names are ignored. */
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
        this.updatePixelAngle();
    }

    /**
     * The live board / card / HUD rects (screen fractions), or null when no board is on screen:
     * events then aim at where the solo board would be.
     */
    setLayout(rects, aspect) {
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) {
            this.aspect = aspect;
            this.updatePixelAngle();
        }
        this.layoutLive = Boolean(rects);
        this.layout = rects || fallbackLayout(this.aspect * 1000, 1000);
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Jump the clock (captures): drops every event in flight and stands on level one. */
    seek(time) {
        this.resetState(Math.max(0, Number(time) || 0));
    }

    /**
     * A new run: no chain, no rain, no sheds, the grove's age drift starts over, and the walkway
     * goes back down to the first storey: under the rising mist if Mistfall is on, else at once.
     */
    resetSession() {
        const t = this.time;
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.sheds = 0;
        this.sessionAge = 0;
        this.lastLock.at = -1e6;
        this.lastClear.at = -1e6;
        this.level = 1;
        const to = climbHeight(1);
        const from = this.heightAt(t);
        const rising = this.mistfall.to > 0;
        if (Math.abs(from - to) > 1e-6 || this.zone !== zoneIndex(1)) {
            this.climb = {
                from,
                to,
                start: rising ? Math.max(t, this.mistfall.start + MISTFALL_COVER) : t,
                length: 0,
                zoneFrom: this.zone,
                zoneTo: zoneIndex(1),
                zoneLength: 0,
            };
        }
    }

    /** Kept so the theme and the playground bind every world alike. */
    bindCamera(camera) {
        this._camera = camera;
    }

    updatePixelAngle() {
        if (!this.u) return;
        const height = Math.max(1, this.u.viewport.value.y);
        this.u.pixelAngle.value = (2 * Math.tan((fovForAspect(this.aspect) * DEG) / 2)) / height;
    }

    // ── The Climb and Mistfall (closed form in the clock) ───────────────────────

    /** The walkway's height at time t (metres). */
    heightAt(t) {
        const c = this.climb;
        if (!c) return this.camY;
        if (t < c.start) return c.from;
        if (!(c.length > 0)) return c.to;
        return lerp(c.from, c.to, smoother((t - c.start) / c.length));
    }

    /** The zone crossfade at time t: { a, b, mix } (indices into ZONES). */
    zoneAt(t, out = this._zoneMix) {
        const c = this.climb;
        if (!c) {
            out.a = this.zone;
            out.b = this.zone;
            out.mix = 0;
            return out;
        }
        out.a = c.zoneFrom;
        out.b = c.zoneTo;
        if (t < c.start) out.mix = 0;
        else if (!(c.zoneLength > 0)) out.mix = 1;
        else out.mix = smoother((t - c.start) / c.zoneLength);
        return out;
    }

    /** How far Mistfall has risen at time t (0 clear … 1 the mist above the camera). */
    mistfallAt(t) {
        const m = this.mistfall;
        return lerp(m.from, m.to, smooth(0, 1, (t - m.start) / m.length));
    }

    /** Settle a finished climb into the rest state (its end is where heightAt already is). */
    settleClimb(t) {
        const c = this.climb;
        if (!c || t < c.start + Math.max(c.length, c.zoneLength)) return;
        this.camY = c.to;
        this.zone = c.zoneTo;
        this.climb = null;
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    /** Stand a camera on the rig: (x, camY + breath, 0), looking down −z, pitched up, no roll. */
    pose(camera, t, pointerX = 0, calm = 1) {
        const fov = fovForAspect(this.aspect);
        if (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        const breathX = Math.sin(TAU * BREATH_FX * t) * BREATH_X;
        const breathY = Math.sin(TAU * BREATH_FY * t + 1.1) * BREATH_Y;
        const px = Math.max(-1, Math.min(1, Number(pointerX) || 0)) * PARALLAX;
        camera.position.set((breathX + px) * calm, this.heightAt(t) + breathY * calm, 0);
        camera.rotation.set(pitchForAspect(this.aspect) * DEG, 0, 0);
        camera.updateMatrixWorld();
    }

    updateCamera(camera, sim) {
        // The staged gameplay is flushed between this and update(): it must carry this frame's time.
        this.time = sim.time;
        this.pose(camera, sim.time, sim.pointerX, this.reducedMotion ? 0 : 1);
        this._camera = camera;
    }

    /** The rest camera for the current aspect and level (what the composition is measured in). */
    restCamera() {
        const cam = this._rest;
        cam.aspect = this.aspect;
        cam.updateProjectionMatrix();
        this.pose(cam, this.time, 0, 0);
        return cam;
    }

    // ── Events (numbers only: the parts that show them read these) ──────────────

    /** A piece locked: the Peel (a hard drop is the Knock). The context is reused: copy it. */
    onLock(context = {}) {
        if (!this.u) return;
        const t = this.time;
        const L = this.lastLock;
        const rows = Array.isArray(context.rows) && context.rows.length ? context.rows : null;
        L.at = t;
        L.player = Number(context.player) || 0;
        L.u = Number.isFinite(context.u) ? clamp01(context.u) : 0.5;
        L.rowTop = rows ? Math.min(...rows) : 19;
        L.rowBottom = rows ? Math.max(...rows) : 19;
        L.code = pieceCode(context.shape);
        L.color = typeof context.color === 'string' ? context.color : null;
        L.hardDrop = context.hardDrop === true;
        L.distance = Number.isFinite(context.distance) ? Math.max(0, context.distance) : 0;
        this.counts.locks += 1;
        if (L.hardDrop) this.counts.hardDrops += 1;
        // The lock's curl joins the session's sheds (the Floor's carpet counts them).
        this.sheds += 1;
        // The next run's first lock brings the morning back.
        if (this.mistfall.to > 0) this.morning(t);
    }

    /** Lines cleared: the Shed (four: the Great Moult; perfect: the Floor). Copy what is kept. */
    onClear(context = {}) {
        if (!this.u) return;
        const t = this.time;
        const C = this.lastClear;
        const lines = Math.max(1, Math.min(4, Math.round(Number(context.lines) || 1)));
        C.at = t;
        C.player = Number(context.player) || 0;
        C.lines = lines;
        C.combo = Math.max(0, Math.round(Number(context.combo) || 0));
        C.cascade = Math.max(1, Math.round(Number(context.cascade) || 1));
        C.tspin = context.tspin === true;
        C.perfect = context.perfect === true;
        C.b2b = context.b2b === true;
        C.rows = Array.isArray(context.rows) ? context.rows.slice(0, 4).map((r) => Number(r) || 0) : [];
        // Each cleared row's ten bark codes, flat and in step with `rows` (row k, column c at k·10 + c).
        const codes = context.rowCodes;
        C.rowCodes = Array.isArray(codes) || ArrayBuffer.isView(codes)
            ? Array.from(codes).slice(0, 40).map((code) => Math.max(0, Math.min(7, Math.round(Number(code) || 0))))
            : [];
        this.counts.clears += 1;
        this.counts.lines += lines;
        if (lines >= 4) this.counts.quads += 1;
        if (C.tspin) this.counts.tspins += 1;
        if (C.perfect) this.counts.perfects += 1;
        // Two sheet strips drop off each of the two near trunks per cleared row.
        this.sheds += lines * 4;
    }

    /** The true combo changed (0 = the chain broke): a gap per link; a broken chain is the Set. */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        if (n >= 2 && n > this.combo) this.counts.chainSteps += 1;
        if (n === 0 && this.peak >= 2) {
            this.counts.releases += 1;
            this.lastRelease = { at: this.time, peak: this.peak };
        }
        this.peak = n === 0 ? 0 : Math.max(this.peak, n);
        this.combo = n;
    }

    /** The live back-to-back level (0 = the chain broke … 3): the Sunshower. */
    onB2B(level) {
        const n = Math.max(0, Math.min(3, Math.round(Number(level) || 0)));
        if (n > this.b2b) this.counts.b2bSteps += 1;
        this.b2b = n;
    }

    /** The run ended: Mistfall. The mist rises past the camera. */
    onGameOver() {
        const t = this.time;
        this.mistfall = {
            from: this.mistfallAt(t), to: 1, start: t, length: MISTFALL_TIME,
        };
        this.counts.gameOvers += 1;
    }

    /** A mode started: a waiting descent happens now, and the morning drains the mist. */
    onSessionStart() {
        const t = this.time;
        if (this.climb && this.climb.start > t && this.climb.length === 0) this.climb.start = t;
        this.sessionAge = 0;
        if (this.mistfall.to > 0) this.morning(t);
    }

    /** Morning returns: the mist drains back to the zone's tide. */
    morning(t) {
        this.mistfall = {
            from: this.mistfallAt(t), to: 0, start: t, length: MORNING_TIME,
        };
        this.counts.mornings += 1;
    }

    /**
     * A new level: the Climb. It waits until CLIMB_DELAY after the latest clear (the shed reads
     * first, at a still camera), then rises a storey and crossfades into the new zone. Silent
     * (a rebuild mid-run) jumps straight to the right height. Under reduced motion the camera
     * jumps and the zone crossfades; a wrap down (level 13) jumps for now.
     */
    levelUp(level, { silent = false } = {}) {
        const lv = Math.max(1, Math.round(Number(level) || 1));
        const t = this.time;
        this.level = lv;
        const to = climbHeight(lv);
        const zoneTo = zoneIndex(lv);
        if (silent || !this.u) {
            this.climb = null;
            this.camY = to;
            this.zone = zoneTo;
            return;
        }
        this.counts.levelUps += 1;
        const from = this.heightAt(t);
        const now = this.zoneAt(t);
        const zoneFrom = now.mix < 0.5 ? now.a : now.b;
        const still = this.reducedMotion || to < from;
        this.climb = {
            from,
            to,
            start: Math.max(t, this.lastClear.at + CLIMB_DELAY),
            length: still ? 0 : CLIMB_TIME,
            zoneFrom,
            zoneTo,
            zoneLength: this.reducedMotion ? CLIMB_FADE : CLIMB_TIME,
        };
    }

    /** Prime the session state a capture asks for: minutes since it began, curls shed so far. */
    primeSession({ minutes, sheds } = {}) {
        if (Number.isFinite(minutes)) this.sessionAge = Math.max(0, minutes) * 60;
        if (Number.isFinite(sheds)) this.sheds = Math.max(0, Math.round(sheds));
    }

    /** The grove's age bias for the session so far (§3.4). */
    ageBias() {
        return Math.min(AGE_BIAS_CAP, AGE_BIAS_START + (AGE_BIAS_RATE * this.sessionAge) / 60);
    }

    // ── Frame ───────────────────────────────────────────────────────────────────

    update(sim, camera = this._camera) {
        const { u } = this;
        if (!u) return;
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const t = this.time;
        this.sessionAge += dt;
        for (let g = 0; g < 4; g++) this.clocks[g] = (this.clocks[g] + dt) % CLOCK_WRAP;

        // ── Where the walkway is, which zone, and how high the mist stands ──
        const camY = this.heightAt(t);
        const zm = this.zoneAt(t);
        const za = ZONES[zm.a];
        const zb = ZONES[zm.b];
        const k = zm.mix;
        const fall = this.mistfallAt(t);
        const tideBase = lerp(tideAt(t, za), tideAt(t, zb), k);
        const tide = lerp(tideBase, camY + MISTFALL.tideLift, fall);
        this.settleClimb(t);

        // ── Uniforms ──
        u.time.value = t;
        u.camY.value = camY;
        u.tide.value = tide;
        u.sigmaA.value = lerp(za.sigmaA, zb.sigmaA, k);
        u.scaleHeight.value = lerp(za.scaleHeight, zb.scaleHeight, k);
        u.sigmaM.value = lerp(za.sigmaM, zb.sigmaM, k);
        const drift = SUN_DRIFT * -Math.cos((TAU * t) / TIDE_PERIOD);
        const sun = sunDirection(lerp(za.sunElevation, zb.sunElevation, k), SUN_AZIMUTH + drift, this._sun);
        u.sunDir.value.set(sun[0], sun[1], sun[2]);
        this.writePalette(zm, fall);

        // What follows the camera: its own frame for the backdrop.
        if (camera) {
            const e = camera.matrixWorld.elements;
            u.camPos.value.set(e[12], e[13], e[14]);
            u.camRight.value.set(e[0], e[1], e[2]);
            u.camUp.value.set(e[4], e[5], e[6]);
            u.camFwd.value.set(-e[8], -e[9], -e[10]);
            const tanV = Math.tan((camera.fov * DEG) / 2);
            u.tanHalf.value.set(tanV * (camera.aspect || this.aspect), tanV);
        }

        // ── Post ──
        const post = this._post;
        post.exposure = lerp(lerp(za.exposure, zb.exposure, k), MISTFALL.exposure, fall);
        post.iris = 1;
        post.sat = lerp(lerp(za.sat, zb.sat, k), MISTFALL.sat, fall);
        post.bloomBoost = 0;
        u.iris.value = 1 / post.iris;
    }

    /** The zone colours, crossfaded over the Climb and laid under the Mistfall look. */
    writePalette(zm, fall) {
        const table = this.u.tables.palette;
        const A = this._zoneRgb[zm.a];
        const B = this._zoneRgb[zm.b];
        const M = this._mistRgb;
        const c = this._rgb;
        for (let i = 0; i < ZONE_COLOR_KEYS.length; i++) {
            const key = ZONE_COLOR_KEYS[i];
            for (let ch = 0; ch < 3; ch++) c[ch] = lerp(lerp(A[key][ch], B[key][ch], zm.mix), M[key][ch], fall);
            table[PALETTE_ROWS[key]].set(c[0], c[1], c[2], 1);
            if (key === 'gradeShadow') this._post.gradeShadow.splice(0, 3, c[0], c[1], c[2]);
            else if (key === 'gradeLight') this._post.gradeLight.splice(0, 3, c[0], c[1], c[2]);
        }
    }

    /** What the post stack reads each frame (a reused object). */
    getPostState() {
        return this._post;
    }

    getState() {
        const t = this.time;
        const zm = this.zoneAt(t);
        const zone = zm.mix < 0.5 ? zm.a : zm.b;
        return {
            quality: this.quality,
            time: t,
            level: this.level,
            zone: ZONES[zone].name,
            zoneMix: zm.mix,
            camY: this.heightAt(t),
            climbing: Boolean(this.climb),
            tide: this.u ? this.u.tide.value : null,
            mistfall: this.mistfallAt(t),
            combo: this.combo,
            peak: this.peak,
            b2b: this.b2b,
            sheds: this.sheds,
            ageBias: this.ageBias(),
            fov: fovForAspect(this.aspect),
            pitch: pitchForAspect(this.aspect),
            counts: { ...this.counts },
            parts: Object.keys(this.parts),
            layoutLive: this.layoutLive,
            reducedMotion: this.reducedMotion,
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
        this.textures.forEach((t) => t.dispose());
        this.disposables = [];
        this.textures = [];
        this.parts = {};
        this.u = null;
        this._camera = null;
    }
}
