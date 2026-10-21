/**
 * Kaleidosonic — the world: the temple, its core, its moods and everything gameplay does to them.
 *
 * Shared by the theme and the playground effect. Nothing is created at event time: events write
 * numbers into preallocated slots, and every phase whose rate gameplay changes (the veins' flow,
 * the core's pulse) is integrated here and handed over wrapped, so `seek(t)` plus a fixed-step
 * replay reproduces any frame.
 *
 * What gameplay does:
 *   lock        strikes a note: a wavefront in the piece's colour rings out from the stone the
 *               piece's column and row point to beside the card, at the piece's own pitch
 *               (wavelength and speed); a hard drop strikes harder and kicks the eye
 *   clear       sounds a harmonic: the core's spherical standing wave lights its nodal shells in
 *               the cleared rows' colour (more lines, more shells), and the temple refolds (the
 *               inversion springs to the next shape in REFOLDS)
 *   chain       deepens the trance: the temple grows finer, the veins brighten and flow faster,
 *               and the lens folds into a kaleidoscope, one mirror at FOLD_AT[k]; a broken chain
 *               lets the mirrors go
 *   four lines  dives one octave of the lattice down the eye's free lane (exactly one period:
 *               the view it lands on is the one it left), the whole temple resonating
 *   T-spin      turns the kaleidoscope: the eye rolls a full turn
 *   back-to-back  a drone: a ring of light round the core, held while the run lives
 *   perfect     every mirror aligns into one still mandala and the floors' pattern flares
 *   level up    the mood wheel steps on (it also turns by itself with the clock)
 *   game over   the light sinks; a new run raises it again
 */
import * as THREE from 'three/webgpu';
import { applyCameraBreath } from '../shared/camera-breath.js';
import {
    DEG, DIVE_LENGTH, EYE, FOLD_AT, HARMONICS, foldLens, MOODS, MOOD_COLOURS, MoodWheel, NOTES, PIECE_COLORS, REFOLDS,
    RIG, STRIKES, STRIKE_ROWS, HARMONIC_ROWS, TAU, TEMPLE, TIMING, approach, clamp, clamp01, createUniforms,
    foldSplit, hexToLinear, lerp, marchTemple, moodMix, mulberry32, pieceCode, rigFor, smooth, smoother, springStep,
    templeDistance, tranceFor,
} from './kaleidosonic-tsl.js';
import { createTemple } from './kaleidosonic-temple.js';
import { tierFor } from './kaleidosonic-quality.js';
import { boardFor, cardUnion, fallbackLayout } from './kaleidosonic-composition.js';

export const KALEIDOSONIC_PARTS = Object.freeze(['temple']);
export const REST_RIG = Object.freeze({ near: RIG.near, far: RIG.far });
export const fovForAspect = (aspect) => rigFor(aspect).fov;

const PIECE_LINEAR = PIECE_COLORS.map((c) => hexToLinear(c));
const WRAP = 3600;
/** A strike never rings out farther from the eye than this (open air beyond it: it hangs there). */
const STRIKE_REACH = 1.15;
/**
 * The breath and the pulse wrap here: a whole number of periods of every multiple the shaders
 * take of them (0.15, 0.25, 0.5, 0.7, 1.5, 1.6, 2), so the wrap never shows as a jump.
 */
export const PHASE_WRAP = TAU * 80;
/** The gem's turn (radians per second): at rest, more in a deep trance, and the share reduced motion keeps. */
export const GEM_TURN = Object.freeze({ rest: 0.07, trance: 0.16, reduced: 0.3 });
/** Flashes (four lines, a perfect clear) come at most this often (seconds). */
const FLASH_GAP = 0.34;
/** The eye's right, across its lane (level). */
const EYE_RIGHT = Object.freeze([-EYE.dir[2], 0, EYE.dir[0]]);

const _v = new THREE.Vector3();

function emptyCounts() {
    return {
        locks: 0, drops: 0, clears: 0, quads: 0, tspins: 0, perfects: 0, levelUps: 0, gameOvers: 0, dives: 0,
    };
}

export class KaleidosonicWorld {
    /** Nothing to bake ahead: the temple is pure arithmetic. Kept for the adapter's contract. */
    static prepare(quality = 'High', { signal } = {}) {
        if (signal?.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));
        return Promise.resolve({ quality });
    }

    static prepareSync(quality = 'High') {
        return { quality };
    }

    constructor({
        scene, quality = 'High', capture = false, seed = 0x5b0e1, prepared = null, scout = true,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        /** Whether the temple marches from the scout pass's start (false: from the eye; an A/B). */
        this.scout = scout !== false;
        this.capture = capture;
        this.seed = seed;
        this.prepared = prepared;
        this.root = new THREE.Group();
        this.root.name = 'Kaleidosonic';
        this.parts = {};
        this.partList = [];
        this.u = createUniforms();
        this.wheel = new MoodWheel();
        this.aspect = 16 / 9;
        this.viewportWidth = 1920;
        this.viewportHeight = 1080;
        this.layout = fallbackLayout(1920, 1080);
        this.layoutLive = false;
        this.reducedMotion = false;
        this.disposed = false;
        this._camera = null;
        this.restCam = new THREE.PerspectiveCamera(RIG.fov, 16 / 9, RIG.near, RIG.far);
        this.heartWorld = new THREE.Vector3(0.4, 1.1, -0.4);
        this.heartScreen = { x: 0.22, y: 0.42 };
        /** The core's bearing from the lens's axis (radians): the kaleidoscope's centre line. */
        this.lensBearing = Math.PI;
        this._rig = rigFor(this.aspect);
        this._rigAspect = this.aspect;
        this._ro = [0, 0, 0];
        this._rd = [0, 0, 0];
        this._oo = [0, 0, 0];
        this._dive = [0, 0, 0];
        this._mood = {
            from: 0, to: 1, mix: 0, place: 0,
        };
        this.moodState = null;
        this._rgb = [0, 0, 0];
        this._folds = [0, 0];
        this._hit = {
            x: 0, y: 0, z: 0, t: 0,
        };
        this._post = {
            exposure: 1,
            bloomBoost: 0,
            fringe: 0,
            flash: 0,
            flashColour: [1, 0.8, 1],
            saturation: 1.1,
        };
        this.overrides = { mood: null };
        this.strikes = Array.from({ length: STRIKES }, () => ({
            birth: -1e6,
            x: 0,
            y: 0,
            z: 0,
            rgb: [0, 0, 0],
            strength: 0,
            wavelength: 0.05,
            speed: 1,
            hard: 0,
        }));
        this.harmonics = Array.from({ length: HARMONICS }, () => ({
            birth: -1e6, mode: 1, strength: 0, rgb: [0, 0, 0],
        }));
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
        this.trance = 0;
        this.folds = [0, 0, 0];
        this.refoldIndex = 0;
        this.sSpring = { x: REFOLDS[0], v: 0 };
        this.breath = 0;
        this.pulse = 0;
        this.resonance = 0;
        this.flash = 0;
        this.flashAt = -1e6;
        this.flare = 0;
        this.mandala = 0;
        this.mandalaAt = -1e6;
        this.sink = 0;
        this.sinkTarget = 0;
        this.drone = 0;
        this.rollAt = -1e6;
        this.diveAt = -1e6;
        this.diveQueue = 0;
        this.diveProgress = 0;
        this.diveTravel = 0;
        this.kick = { x: 0, v: 0 };
        /** The kaleidoscope's slow turn during a deep chain (radians; unwinds when it breaks). */
        this.turn = 0;
        /** The gem's turn about the vertical (radians): its facets' beams sweep the halls. */
        this.gemTurn = 0;
        this.lastEventAt = time;
        this.strikeCursor = 0;
        this.harmonicCursor = 0;
        for (const s of this.strikes) {
            s.birth = -1e6;
            s.strength = 0;
        }
        for (const h of this.harmonics) {
            h.birth = -1e6;
            h.strength = 0;
        }
        this.random = mulberry32(this.seed ^ 0x9e37);
    }

    build() {
        if (this.root.parent) return this;
        this.prepared = null;
        this.addPart('temple', createTemple(this.u, this.tier, { scout: this.scout }));
        this.parts.temple.setViewport(this.viewportWidth, this.viewportHeight);
        this.scene.add(this.root);
        this.placeHeart();
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

    /** Reduced motion: no dive, roll, kick or turn; one in flight stops where it is. */
    setReducedMotion(value) {
        this.reducedMotion = value === true;
        if (!this.reducedMotion) return;
        this.diveAt = -1e6;
        this.diveQueue = 0;
        this.diveProgress = 0;
        this.diveTravel = 0;
        this.rollAt = -1e6;
        this.kick.x = 0;
        this.kick.v = 0;
        this.turn = 0;
    }

    /** The rig for the current aspect (recomputed only when the aspect changes). */
    rig() {
        if (this._rigAspect !== this.aspect) {
            rigFor(this.aspect, this._rig);
            this._rigAspect = this.aspect;
        }
        return this._rig;
    }

    setCaptureOverrides(overrides) { Object.assign(this.overrides, overrides); }

    /**
     * The drawing buffer (pixels: the march's pixel size) and the frame's aspect; `cssWidth` and
     * `cssHeight` (CSS pixels, the stylesheet's own units) place the fallback card before a real
     * one is on screen.
     */
    setViewport(width, height, aspect, cssWidth = width, cssHeight = height) {
        if (aspect > 0) this.aspect = aspect;
        this.viewportWidth = Math.max(1, width);
        this.viewportHeight = Math.max(1, height);
        this.parts.temple?.setViewport(this.viewportWidth, this.viewportHeight);
        this.cssSize = { w: Math.max(1, cssWidth), h: Math.max(1, cssHeight) };
        if (!this.layoutLive) this.layout = fallbackLayout(this.cssSize.w, this.cssSize.h);
        this.placeHeart();
    }

    setLayout(rects, aspect) {
        if (aspect > 0) this.aspect = aspect;
        this.layoutLive = Boolean(rects);
        const css = this.cssSize || { w: 1920, h: 1920 / Math.max(0.2, this.aspect) };
        this.layout = rects || fallbackLayout(css.w, css.h);
        this.placeHeart();
    }

    // ── The eye ───────────────────────────────────────────────────────────────────

    /**
     * The eye's pose: the rest pose, a slow drift of the eye and the lens, the pointer's parallax,
     * a hard drop's kick, and the T-spin's roll. `rest` leaves out everything that moves.
     */
    pose(camera, time, pointerX = 0, pointerY = 0, rest = false) {
        const rig = this.rig();
        const move = rest || this.reducedMotion ? 0 : 1;
        let drift = this.reducedMotion ? 0.3 : 1;
        if (rest) drift = 0;
        camera.aspect = this.aspect;
        let { fov } = rig;
        if (!rest) fov *= 1 + Math.sin(Math.PI * this.diveProgress) * 0.16 * move;
        camera.fov = fov;
        camera.near = RIG.near;
        camera.far = RIG.far;
        const sx = Math.sin((TAU * time) / 47) * 0.035 + Math.sin((TAU * time) / 29) * 0.012;
        const sy = Math.sin((TAU * time) / 37) * 0.02;
        const lateral = drift * sx + move * clamp(pointerX, -1, 1) * 0.04;
        const kick = rest ? 0 : this.kick.x;
        camera.position.set(
            EYE.x + EYE_RIGHT[0] * lateral - EYE.dir[0] * kick,
            EYE.y + drift * sy - move * clamp(pointerY, -1, 1) * 0.025,
            EYE.z + EYE_RIGHT[2] * lateral - EYE.dir[2] * kick,
        );
        const yaw = (rig.yaw + drift * Math.sin((TAU * time) / 71) * 1.6) * DEG;
        const pitch = (rig.pitch + drift * Math.sin((TAU * time) / 53) * 0.9) * DEG;
        const base = Math.atan2(-EYE.dir[0], -EYE.dir[2]);
        let roll = 0;
        if (!rest && !this.reducedMotion) {
            const k = (time - this.rollAt) / TIMING.roll;
            if (k > 0 && k < 1) roll = smoother(k) * TAU;
            // a deep chain turns the kaleidoscope slowly (the crown of jewels wheels round the card)
            roll += this.turn;
        }
        camera.rotation.set(pitch, base - yaw, roll, 'YXZ');
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
    }

    restCamera(camera) {
        this.pose(camera, 0, 0, 0, true);
    }

    updateCamera(camera, sim) {
        this.time = Number.isFinite(sim.time) ? sim.time : this.time;
        this.pose(camera, this.time, sim.pointerX || 0, sim.pointerY || 0);
        // The shared breath (shared/camera-breath.js) on top of the drift: off under reduced motion.
        if (applyCameraBreath(camera, this.time, { scale: this.reducedMotion ? 0 : 1 })) camera.updateMatrixWorld();
        this._camera = camera;
    }

    /**
     * The rest camera's ray through a screen point (fractions, y down), as [o, d]: written into
     * the world's own two arrays unless others are given (the next call overwrites them).
     */
    restRay(sx, sy, o = this._ro, d = this._rd) {
        const cam = this.restCam;
        this.pose(cam, 0, 0, 0, true);
        _v.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(cam).sub(cam.position).normalize();
        o[0] = cam.position.x;
        o[1] = cam.position.y;
        o[2] = cam.position.z;
        d[0] = _v.x;
        d[1] = _v.y;
        d[2] = _v.z;
        return [o, d];
    }

    /** True when more than one board card is on screen (local multiplayer). */
    multiCard() {
        return (this.layout?.cards?.length || 0) > 1;
    }

    /**
     * The core: hung in the open air at the hero anchor (left of the card; above the cards on a
     * tall frame or with several boards side by side), at the depth along that ray where the
     * temple leaves it most room.
     */
    placeHeart() {
        const card = cardUnion(this.layout) || {
            x0: 0.41, x1: 0.59, y0: 0.08, y1: 0.93,
        };
        const tall = this.aspect < 0.75;
        const above = tall || this.multiCard();
        const sx = above ? clamp((card.x0 + card.x1) / 2, 0.3, 0.7) : clamp(card.x0 * 0.72, 0.14, 0.34);
        const sy = above ? clamp(card.y0 * 0.55, 0.06, 0.12) : 0.42;
        // Search round the anchor for the screen point whose ray runs longest through open air
        // before it meets stone; hang the core part-way along it, where it has room on all sides.
        let pickScore = -Infinity;
        let pickX = sx;
        let pickY = sy;
        let free = 3;
        for (let j = -3; j <= 3; j++) {
            for (let i = -3; i <= 3; i++) {
                const x = clamp(sx + i * 0.02, 0.04, 0.96);
                const y = clamp(sy + j * 0.025, 0.04, 0.96);
                const [o, d] = this.restRay(x, y);
                const hit = marchTemple(o, d, {
                    s: TEMPLE.s, folds: TEMPLE.detailRest, near: 0.05, far: 3, out: this._hit,
                });
                const runs = hit ? hit.t : 3;
                const score = Math.min(runs, 1.6) - Math.hypot(i * 0.02, j * 0.025) * 6;
                if (score > pickScore) {
                    pickScore = score;
                    pickX = x;
                    pickY = y;
                    free = runs;
                }
            }
        }
        this.heartScreen.x = pickX;
        this.heartScreen.y = pickY;
        const [o, d] = this.restRay(pickX, pickY);
        let best = Math.min(1.1, free * 0.6);
        let room = -1;
        for (let i = 0; i <= 24; i++) {
            const t = 0.5 + i * 0.05;
            if (t > free - 0.15) break;
            const clear = templeDistance(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t, TEMPLE.s, TEMPLE.detailRest)
                - Math.abs(t - 1.05) * 0.2;
            if (clear > room) {
                room = clear;
                best = t;
            }
        }
        this.heartWorld.set(o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best);
        // Above the cards the core hangs in a narrow strip: a smaller heart keeps its corona off them.
        this.u.heart.value.set(this.heartWorld.x, this.heartWorld.y, this.heartWorld.z, above ? 0.011 : 0.016);
        // The kaleidoscope folds about the core's bearing (the mirror keeps the core's half).
        const tan = Math.tan((this.rig().fov * DEG) / 2);
        const hx = (this.heartScreen.x * 2 - 1) * tan * this.aspect;
        const hy = (1 - this.heartScreen.y * 2) * tan;
        this.lensBearing = Math.atan2(hy, hx);
        this.u.lens.value.set(this.lensBearing, 0, 0, 0);
    }

    /**
     * The screen point a lock at board column `u` and row `row` strikes from: the temple beside
     * the card (column 0 far left … column 1 far right; the floor rows lowest), moved into the
     * kaleidoscope's kept wedge while its mirrors are open, so the strike shows where its image is.
     * On a tall frame, and below each player's own card when several boards stand side by side,
     * it strikes from the strip under the cards.
     */
    sitePoint(u = 0.5, row = 14, player = 0) {
        const card = cardUnion(this.layout) || {
            x0: 0.41, x1: 0.59, y0: 0.08, y1: 0.93,
        };
        const f = clamp(row, 0, 19) / 19;
        let x;
        let y;
        if (this.aspect < 0.75) {
            const top = Math.min(0.94, card.y1 + 0.02);
            x = 0.08 + clamp(u, 0, 1) * 0.84;
            y = top + (0.985 - top) * (0.3 + 0.7 * f);
        } else if (this.multiCard()) {
            const own = this.cardOf(player) || card;
            const top = Math.min(0.94, card.y1 + 0.02);
            x = own.x0 + clamp(u, 0, 1) * (own.x1 - own.x0);
            y = top + (0.985 - top) * (0.3 + 0.7 * f);
        } else {
            const { hud } = this.layout;
            let lo;
            let hi;
            let k;
            // A band beside the card on each side (never the far edge of the frame): the strike
            // must read as the piece's own.
            if (u < 0.5) {
                lo = Math.max(0.05, card.x0 - 0.24);
                hi = card.x0 - 0.035;
                k = u / 0.5;
            } else {
                lo = card.x1 + 0.035;
                hi = Math.min(0.95, card.x1 + 0.24);
                if (hud && hud.x0 > card.x1 && hud.x0 < hi) {
                    // the stats panel stands in the band: strike beyond it
                    lo = hud.x1 + 0.02;
                    hi = Math.min(0.96, hud.x1 + 0.2);
                }
                k = (u - 0.5) / 0.5;
            }
            x = lo + (hi - lo) * clamp(k, 0, 1);
            y = 0.22 + 0.6 * f;
        }
        return this.foldScreen(x, y);
    }

    /** The card holding a player's board (screen fractions), or null when none is on screen. */
    cardOf(player = 0) {
        const board = boardFor(this.layout, player);
        const cards = this.layout?.cards;
        if (!board || !cards?.length) return null;
        const cx = (board.x0 + board.x1) / 2;
        const cy = (board.y0 + board.y1) / 2;
        for (let i = 0; i < cards.length; i++) {
            const c = cards[i];
            if (cx >= c.x0 && cx <= c.x1 && cy >= c.y0 && cy <= c.y1) return c;
        }
        return board;
    }

    /** A screen point folded by the open stages of the kaleidoscope (each once more than half open). */
    foldScreen(x, y) {
        const tan = Math.tan((this.rig().fov * DEG) / 2);
        const tx = (x * 2 - 1) * tan * this.aspect;
        const ty = (1 - y * 2) * tan;
        const [px, py] = foldLens(tx, ty, this.lensBearing, this.folds);
        return { x: (px / (tan * this.aspect) + 1) / 2, y: (1 - py / tan) / 2 };
    }

    /**
     * The stone a screen point looks at (the rest eye's ray, the live temple's shape), or a point in
     * the air at most STRIKE_REACH along the ray where the stone is farther.
     */
    stoneAt(sx, sy, out = this._hit) {
        const [o, d] = this.restRay(sx, sy);
        const dive = this.diveOffset();
        const oo = this._oo;
        oo[0] = o[0] + dive[0];
        oo[1] = o[1] + dive[1];
        oo[2] = o[2] + dive[2];
        const hit = marchTemple(oo, d, {
            s: this.sSpring.x, folds: TEMPLE.detailRest, near: 0.12, far: STRIKE_REACH, out,
        });
        if (!hit) {
            out.x = o[0] + d[0] * STRIKE_REACH;
            out.y = o[1] + d[1] * STRIKE_REACH;
            out.z = o[2] + d[2] * STRIKE_REACH;
            out.t = STRIKE_REACH;
            return out;
        }
        // back into the eye's frame, and a hair off the stone toward the eye
        hit.x = hit.x - dive[0] - d[0] * 0.01;
        hit.y = hit.y - dive[1] - d[1] * 0.01;
        hit.z = hit.z - dive[2] - d[2] * 0.01;
        return hit;
    }

    /** How far the dive has carried the eye (world units, along its lane), into `out`. */
    diveOffset(out = this._dive) {
        const k = this.diveTravel;
        out[0] = EYE.dir[0] * k;
        out[1] = EYE.dir[1] * k;
        out[2] = EYE.dir[2] * k;
        return out;
    }

    pigment(color, out = this._rgb) {
        hexToLinear(typeof color === 'string' ? color : PIECE_COLORS[0], out);
        return out;
    }

    // ── Gameplay ──────────────────────────────────────────────────────────────────

    onLock(context = {}) {
        this.counts.locks += 1;
        this.lastEventAt = this.time;
        if (this.sinkTarget > 0) this.sinkTarget = 0;
        const hard = context.hardDrop === true;
        if (hard) this.counts.drops += 1;
        const rows = Array.isArray(context.rows) && context.rows.length ? context.rows : [14];
        let row = 0;
        for (const r of rows) row += Number(r) || 0;
        row /= rows.length;
        const player = Number.isFinite(context.player) ? context.player : 0;
        const site = this.sitePoint(Number.isFinite(context.u) ? context.u : 0.5, row, player);
        const hit = this.stoneAt(site.x, site.y);
        const code = pieceCode(context.shape);
        const note = NOTES[code] || NOTES[7];
        const slot = this.strikes[this.strikeCursor % STRIKES];
        this.strikeCursor = (this.strikeCursor + 1) % (STRIKES * 1000);
        slot.birth = this.time;
        slot.x = hit.x;
        slot.y = hit.y;
        slot.z = hit.z;
        this.pigment(context.color || PIECE_COLORS[code % 7], slot.rgb);
        slot.strength = hard ? 1.7 : 1;
        slot.wavelength = note.wavelength * (hard ? 1.25 : 1);
        slot.speed = note.speed * (hard ? 1.3 : 1);
        slot.hard = hard ? 1 : 0;
        this.flare = Math.max(this.flare, hard ? 0.5 : 0.25);
        if (hard && !this.reducedMotion) {
            const fell = clamp(Number(context.distance) || 8, 1, 20) / 20;
            this.kick.v -= 0.18 + 0.32 * fell;
        }
    }

    onClear(context = {}) {
        this.counts.clears += 1;
        this.lastEventAt = this.time;
        if (this.sinkTarget > 0) this.sinkTarget = 0;
        const lines = clamp(Math.round(Number(context.lines) || 1), 1, 4);
        const perfect = context.perfect === true;
        // the harmonic takes the colour the cleared rows were mostly made of
        const rgb = this.dominantColour(context.rowCodes, this._rgb);
        const slot = this.harmonics[this.harmonicCursor % HARMONICS];
        this.harmonicCursor = (this.harmonicCursor + 1) % (HARMONICS * 1000);
        slot.birth = this.time;
        slot.mode = lines;
        slot.strength = 0.8 + lines * 0.25;
        slot.rgb[0] = rgb[0];
        slot.rgb[1] = rgb[1];
        slot.rgb[2] = rgb[2];
        // the temple refolds: one step, a chain's later links further
        const chain = Math.max(1, Number(context.combo) || 1);
        this.refoldIndex += chain > 3 ? 2 : 1;
        this.resonance = Math.max(this.resonance, 0.6 + lines * 0.25);
        this.flare = Math.max(this.flare, 0.4 + lines * 0.15);
        // A meditation click (a screen point, no board) sounds its harmonic without flash or dive.
        const calm = Boolean(context.screen);
        if (lines >= 4) this.onQuad({ calm });
        if (context.tspin) this.onTSpin();
        if (perfect) this.onPerfect({ calm });
    }

    /** A flash, at most one per FLASH_GAP (events landing on the same frame share it). */
    flashUp(value) {
        const since = this.time - this.flashAt;
        if (since > 0 && since < FLASH_GAP) return;
        this.flashAt = this.time;
        this.flash = Math.max(this.flash, value);
    }

    /** The most common piece among a clear's cells (garbage and unknown cells left out). */
    dominantColour(rowCodes, out) {
        const tally = [0, 0, 0, 0, 0, 0, 0];
        if (Array.isArray(rowCodes) || ArrayBuffer.isView(rowCodes)) {
            for (let i = 0; i < rowCodes.length; i++) {
                const c = rowCodes[i];
                if (c >= 0 && c < 7) tally[c] += 1;
            }
        }
        let best = -1;
        let count = 0;
        for (let c = 0; c < 7; c++) {
            if (tally[c] > count) {
                count = tally[c];
                best = c;
            }
        }
        const src = best >= 0 ? PIECE_LINEAR[best] : this.moodVein();
        out[0] = src[0];
        out[1] = src[1];
        out[2] = src[2];
        return out;
    }

    moodVein() {
        return MOODS[moodMix(this.moodPlace()).from].neonA;
    }

    onQuad({ calm = false } = {}) {
        this.counts.quads += 1;
        this.resonance = Math.max(this.resonance, 1.3);
        this.flare = Math.max(this.flare, 1.2);
        if (calm) return;
        this.flashUp(0.6);
        if (this.reducedMotion) return;
        if (this.time - this.diveAt >= TIMING.dive) {
            this.diveAt = this.time;
            this.counts.dives += 1;
        } else {
            this.diveQueue = Math.min(2, this.diveQueue + 1);
        }
    }

    onTSpin() {
        this.counts.tspins += 1;
        this.resonance = Math.max(this.resonance, 0.8);
        if (!this.reducedMotion && this.time - this.rollAt >= TIMING.roll) this.rollAt = this.time;
    }

    onPerfect({ calm = false } = {}) {
        this.counts.perfects += 1;
        this.mandalaAt = this.time;
        this.resonance = Math.max(this.resonance, 1.6);
        if (!calm) this.flashUp(0.5);
    }

    onCombo(value) {
        const n = Math.max(0, Math.round(Number(value) || 0));
        this.combo = n;
        this.peak = Math.max(this.peak, n);
        if (n > 0) this.lastEventAt = this.time;
    }

    onB2B(level) {
        this.b2b = clamp(Math.round(Number(level) || 0), 0, 4);
    }

    levelUp(level, { silent = false, time = this.time } = {}) {
        const n = Math.max(1, Math.round(Number(level) || 1));
        if (n > this.level && !silent) this.counts.levelUps += 1;
        this.wheel.levelUp(n, time, silent);
        this.level = n;
        if (!silent) this.flare = Math.max(this.flare, 0.8);
    }

    onGameOver() {
        this.counts.gameOvers += 1;
        this.sinkTarget = 1;
        this.combo = 0;
        this.b2b = 0;
    }

    onSessionStart() {
        this.sinkTarget = 0;
    }

    /** A new run: no chain, strike or harmonic in flight; the moods and the temple's shape stay. */
    resetSession() {
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.level = 1;
        this.wheel.newRun();
        for (const s of this.strikes) s.strength = 0;
        for (const h of this.harmonics) h.strength = 0;
    }

    seek(time) {
        this.resetState(time);
        this.update({ time, delta: 0 }, this._camera);
    }

    moodPlace() {
        if (this.overrides.mood !== null && Number.isFinite(this.overrides.mood)) return this.overrides.mood;
        return this.wheel.place(this.time);
    }

    // ── The frame ─────────────────────────────────────────────────────────────────

    update(sim, camera = this._camera) {
        const time = Number.isFinite(sim.time) ? sim.time : this.time;
        const dt = clamp(Number(sim.delta) || 0, 0, 0.25);
        this.time = time;
        const { u } = this;

        // A long quiet forgets the chain.
        if (this.combo > 0 && time - this.lastEventAt > TIMING.idle) this.combo = 0;

        // the trance and the lens's mirrors
        const want = tranceFor(this.combo);
        this.trance += (want - this.trance) * approach(want > this.trance ? 1.6 : 0.45, dt);
        const mandalaAge = time - this.mandalaAt;
        const holdMandala = mandalaAge >= 0 && mandalaAge < TIMING.mandalaHold;
        for (let k = 0; k < FOLD_AT.length; k++) {
            const open = holdMandala || this.combo >= FOLD_AT[k] ? 1 : 0;
            const rate = open > this.folds[k] ? 1 / TIMING.foldIn : 1 / TIMING.foldOut;
            const step = rate * dt;
            this.folds[k] = open > this.folds[k]
                ? Math.min(open, this.folds[k] + step)
                : Math.max(open, this.folds[k] - step);
        }
        const mandalaWant = holdMandala ? 1 : 0;
        const mandalaRate = mandalaWant > this.mandala ? 3 : 1 / TIMING.mandalaRelease;
        this.mandala += (mandalaWant - this.mandala) * approach(mandalaRate, dt);

        // the refold spring
        const target = REFOLDS[((this.refoldIndex % REFOLDS.length) + REFOLDS.length) % REFOLDS.length];
        springStep(this.sSpring, target, dt, 4.2);
        this.sSpring.x = clamp(this.sSpring.x, TEMPLE.sMin, TEMPLE.sMax);

        // integrated phases (their rates follow gameplay; the clock is never multiplied by a rate)
        // the rings flow outward; as the light sinks (game over) they turn and fall back into the core
        const flow = (0.32 + this.trance * 0.75 + this.resonance * 0.4) * (1 - this.sink * 1.8);
        this.breath = (((this.breath + dt * flow) % PHASE_WRAP) + PHASE_WRAP) % PHASE_WRAP;
        this.pulse = (this.pulse + dt * (1.1 + this.trance * 2.2 + this.drone * 0.6)) % PHASE_WRAP;

        // decays
        this.resonance *= Math.exp(-dt / 1.5);
        this.flash *= Math.exp(-dt / 0.35);
        this.flare *= Math.exp(-dt / 0.9);
        this.drone += (Math.min(1, this.b2b / 3) - this.drone) * approach(1.5, dt);
        const sinkRate = this.sinkTarget > this.sink ? 1 / TIMING.sink : 1 / TIMING.rise;
        this.sink = this.sinkTarget > this.sink
            ? Math.min(this.sinkTarget, this.sink + sinkRate * dt)
            : Math.max(this.sinkTarget, this.sink - sinkRate * dt);

        // the hard drop's kick (a damped spring back to rest)
        if (dt > 0) springStep(this.kick, 0, dt, 7);

        // the kaleidoscope turns while its six sectors are open, and unwinds when they close
        if (this.folds[1] > 0.5 && !this.reducedMotion) this.turn = (this.turn + dt * 0.07 * this.folds[1]) % TAU;
        else this.turn *= Math.exp(-dt / 1.4);

        // the dive
        const diveK = (time - this.diveAt) / TIMING.dive;
        if (diveK >= 1 && this.diveQueue > 0) {
            this.diveQueue -= 1;
            this.diveAt = time;
            this.counts.dives += 1;
        }
        const k = clamp01((time - this.diveAt) / TIMING.dive);
        this.diveProgress = k > 0 && k < 1 ? k : 0;
        this.diveTravel = this.diveProgress > 0 ? smoother(this.diveProgress) * DIVE_LENGTH : 0;

        // ── uniforms ──
        u.time.value = time % WRAP;
        u.breath.value = this.breath;
        u.pulse.value = this.pulse;
        if (camera) {
            u.camWorld.value.copy(camera.matrixWorld);
            u.projInv.value.copy(camera.projectionMatrixInverse);
            // The kaleidoscope folds about the core's live bearing (the eye drifts and rolls), so the
            // core sits on its own centre line, is never doubled into a pair, and the mirror turns
            // with a roll instead of flipping.
            _v.copy(this.heartWorld).applyMatrix4(camera.matrixWorldInverse);
            if (_v.z < -1e-3) {
                this.lensBearing = Math.atan2(_v.y, _v.x);
                u.lens.value.set(this.lensBearing, 0, 0, 0);
            }
            const fov = (camera.fov || RIG.fov) * DEG;
            u.pixelAngle.value = (2 * Math.tan(fov / 2)) / Math.max(120, this.viewportHeight);
        }
        const folds = Math.min(lerp(TEMPLE.detailRest, TEMPLE.detailDeep, this.trance), this.tier.folds);
        const [whole, weight] = foldSplit(folds, this._folds);
        u.shape.value.set(this.sSpring.x, folds, whole, weight);
        const dv = this.diveOffset();
        u.dive.value.set(dv[0], dv[1], dv[2]);
        u.lensS.value.set(this.folds[0], this.folds[1], this.folds[2], 0);
        // the pulse lights the stone; an event's flare brightens only the core's corona and gem
        const pulseLight = 1 + Math.sin(this.pulse) * 0.08 * (0.4 + this.trance);
        u.heartState.value.set(pulseLight, this.drone, this.sink, this.flare);
        const surge = this.diveProgress * (1 - this.diveProgress) * 1.6;
        u.state.value.set(this.trance, Math.min(1.6, this.resonance + surge), this.mandala, this.flash);
        u.air.value.set(lerp(0.34, 0.26, this.trance), 1, 0, 0);
        // the light map is marched from the core's resting place: the dive carries the core off it,
        // so the core's own shadows let go while it flies and hold again as it lands
        u.light.value.y = 1 - Math.sin(Math.PI * this.diveProgress);
        // the gem turns (its facets sweep the beams through the halls), faster in a trance,
        // slowly under reduced motion
        const gemRate = GEM_TURN.rest + GEM_TURN.trance * this.trance;
        this.gemTurn = (this.gemTurn + dt * gemRate * (this.reducedMotion ? GEM_TURN.reduced : 1)) % TAU;
        u.gem.value.set(Math.cos(this.gemTurn), Math.sin(this.gemTurn), 0, 0);
        // a clear's resonance makes the beams blaze; a lock's strike does not (its light stays where it
        // struck). The twelve-sector kaleidoscope mirrors twelve cores' beams round the frame: the air
        // takes a share less while it is open, so dark stays between the rays.
        u.light.value.z = (1 + Math.min(1.6, this.resonance + surge) * 0.55) * (1 - 0.3 * this.folds[2]);

        // the moods
        const place = this.moodPlace();
        const ms = moodMix(place, this._mood);
        ms.place = place;
        this.moodState = ms;
        const { from, to, mix } = ms;
        const rows = u.tables.moods;
        const nc = MOOD_COLOURS.length;
        for (let i = 0; i < nc; i++) {
            const a = MOODS[from][MOOD_COLOURS[i]];
            const b = MOODS[to][MOOD_COLOURS[i]];
            rows[i].set(a[0], a[1], a[2], 1);
            rows[i + nc].set(b[0], b[1], b[2], 1);
        }
        u.moodMix.value = mix;

        // strikes: live rows compacted at the front, newest first (a tier that draws fewer than are
        // ringing drops the OLDEST), ages written (the shader never sees a clock)
        let live = 0;
        const cap = Math.min(STRIKES, this.tier.strikes);
        const sRows = u.tables.strikes;
        for (let n = 0; n < STRIKES && live < cap; n++) {
            const s = this.strikes[(((this.strikeCursor - 1 - n) % STRIKES) + STRIKES) % STRIKES];
            const age = time - s.birth;
            if (s.strength <= 0 || age < 0 || age > TIMING.strike) continue;
            const j = live * STRIKE_ROWS;
            const dim = 1 - this.sink * 0.7;
            sRows[j].set(s.x, s.y, s.z, age);
            sRows[j + 1].set(s.rgb[0], s.rgb[1], s.rgb[2], s.strength * dim);
            sRows[j + 2].set(s.wavelength, s.speed, s.hard, 0);
            live += 1;
        }
        let hLive = 0;
        const hRows = u.tables.harmonics;
        for (let i = 0; i < HARMONICS; i++) {
            const h = this.harmonics[i];
            const age = time - h.birth;
            if (h.strength <= 0 || age < 0 || age > TIMING.harmonic) continue;
            const j = hLive * HARMONIC_ROWS;
            const fade = Math.exp(-age / 1.1) * smooth(0, 0.08, age);
            hRows[j].set(0.15 + age * 1.9, age, h.mode, h.strength * fade);
            hRows[j + 1].set(h.rgb[0], h.rgb[1], h.rgb[2], 0);
            hLive += 1;
        }
        u.counts.value.set(live, hLive, 0, 0);
        // the latest strike and harmonic ring the jewels their wavefronts pass
        this.writePings(time);

        // the post
        const mood = MOODS[from];
        const moodB = MOODS[to];
        const post = this._post;
        post.exposure = lerp(mood.exposure, moodB.exposure, mix) * (1 - this.sink * 0.45);
        post.bloomBoost = Math.min(1.2, this.resonance * 0.45 + this.trance * 0.35);
        const diving = this.diveProgress * (1 - this.diveProgress);
        post.fringe = Math.min(3, this.resonance * 0.7 + diving * 8 + this.trance * 0.4);
        post.flash = this.flash;
        const hc = mood.heart;
        const mx = Math.max(hc[0], hc[1], hc[2]);
        post.flashColour[0] = hc[0] / mx;
        post.flashColour[1] = hc[1] / mx;
        post.flashColour[2] = hc[2] / mx;
        post.saturation = 1.1 + this.trance * 0.16;
    }

    /** The newest live strike and harmonic, for the jewels' sympathetic ringing. */
    writePings(time) {
        const { u } = this;
        let best = null;
        for (const s of this.strikes) {
            const age = time - s.birth;
            if (s.strength > 0 && age >= 0 && age <= TIMING.strike && (!best || s.birth > best.birth)) best = s;
        }
        if (best) {
            const age = time - best.birth;
            u.pingStrike.value.set(best.x, best.y, best.z, age * best.speed);
            const ring = Math.exp(-age * 0.9) * best.strength * (1 - this.sink * 0.7);
            u.pingStrikeCol.value.set(best.rgb[0], best.rgb[1], best.rgb[2], ring);
        } else {
            u.pingStrikeCol.value.w = 0;
        }
        let harm = null;
        for (const h of this.harmonics) {
            const age = time - h.birth;
            if (h.strength > 0 && age >= 0 && age <= TIMING.harmonic && (!harm || h.birth > harm.birth)) harm = h;
        }
        if (harm) {
            const age = time - harm.birth;
            u.pingHarm.value.set(0.15 + age * 1.9, Math.exp(-age / 1.3) * harm.strength, 0, 0);
            u.pingHarmCol.value.set(harm.rgb[0], harm.rgb[1], harm.rgb[2], 0);
        } else {
            u.pingHarm.value.y = 0;
        }
    }

    /** The world's own passes, before each frame (the temple's scout). */
    prerender(renderer) {
        if (this.disposed || !renderer) return;
        for (const part of this.partList) part.prerender?.(renderer);
    }

    getPostState() {
        return this._post;
    }

    getState() {
        const m = this.moodState || moodMix(this.moodPlace());
        return {
            quality: this.quality,
            time: this.time,
            level: this.level,
            combo: this.combo,
            peak: this.peak,
            b2b: this.b2b,
            trance: this.trance,
            folds: [...this.folds],
            shape: this.sSpring.x,
            refold: this.refoldIndex,
            dive: { progress: this.diveProgress, queue: this.diveQueue, travel: this.diveTravel },
            mood: {
                from: MOODS[m.from].name, to: MOODS[m.to].name, mix: m.mix, place: m.place ?? this.moodPlace(),
            },
            strikes: this.u.counts.value.x,
            harmonics: this.u.counts.value.y,
            heart: { ...this.heartScreen, world: this.heartWorld.toArray() },
            resonance: this.resonance,
            mandala: this.mandala,
            sink: this.sink,
            counts: { ...this.counts },
            reducedMotion: this.reducedMotion,
        };
    }

    exportSessionState() {
        return {
            wheel: this.wheel.exportState(),
            refoldIndex: this.refoldIndex,
            shape: this.sSpring.x,
            combo: this.combo,
            peak: this.peak,
            b2b: this.b2b,
            trance: this.trance,
            folds: [...this.folds],
            sinkTarget: this.sinkTarget,
            sink: this.sink,
            drone: this.drone,
            gemTurn: this.gemTurn,
            // a perfect clear's mandala still holding, as its age (none once it has let go)
            mandalaAge: this.time - this.mandalaAt < TIMING.mandalaHold + TIMING.mandalaRelease
                ? this.time - this.mandalaAt : null,
        };
    }

    importSessionState(state) {
        if (!state) return;
        this.wheel.importState(state.wheel);
        this.refoldIndex = Math.max(0, Math.round(Number(state.refoldIndex) || 0));
        if (Number.isFinite(state.shape)) this.sSpring.x = clamp(state.shape, TEMPLE.sMin, TEMPLE.sMax);
        this.combo = Math.max(0, Math.round(Number(state.combo) || 0));
        this.peak = Math.max(this.combo, Math.round(Number(state.peak) || 0));
        this.b2b = clamp(Math.round(Number(state.b2b) || 0), 0, 4);
        this.trance = clamp01(Number(state.trance) || 0);
        if (Array.isArray(state.folds)) {
            for (let k = 0; k < FOLD_AT.length; k++) this.folds[k] = clamp01(Number(state.folds[k]) || 0);
        }
        this.sinkTarget = state.sinkTarget === 1 ? 1 : 0;
        if (Number.isFinite(state.sink)) this.sink = clamp01(state.sink);
        if (Number.isFinite(state.drone)) this.drone = clamp01(state.drone);
        // the beams carry on from where they had turned to
        if (Number.isFinite(state.gemTurn)) {
            const turn = state.gemTurn % TAU;
            this.gemTurn = turn < 0 ? turn + TAU : turn;
        }
        // a mandala still holding goes on from the age it had
        if (Number.isFinite(state.mandalaAge)) this.mandalaAt = this.time - state.mandalaAge;
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        for (const part of this.partList) part.dispose?.();
        this.partList.length = 0;
        this.root.removeFromParent();
    }
}
