/**
 * Chromatic Impasto — the world: one canvas, the lamp over it, and the painter the board drives.
 *
 * Owns the uniforms, the parts, the camera rig and the choreography. Shared with the playground
 * effect (src/playground/effects/chromatic-impasto.effect.js), so what is iterated there ships.
 *
 * The painting is a log of strokes (chromatic-impasto-strokes.js). This class decides WHAT is
 * painted and when: the underpainting when the theme starts, the painter's own unhurried strokes
 * while nothing happens, and what the board asks for (chromatic-impasto-gestures.js). Each frame
 * it hands the painter the clock, draws the pieces of stroke that are due into the paint
 * (chromatic-impasto-canvas.js), dries it a little, and winds the twist a chain of clears puts
 * on the canvas.
 */

import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';

import {
    DEG, GOLD, HUSH_HOLD, IMPASTO_PERIODS, INTRO_SPAN, RELIEF, SHEEN_SLOTS, SWIRL_FROM, TAU, TWIST_BAKE_AT, VIEW,
    TWIST_CREEP, VIEW_DISTANCE, approach, clamp, clamp01, createField, lerp, mixRgb, mulberry32, notchForCombo,
    pigmentFromHex, powerForCombo, radicalInverse,
} from './chromatic-impasto-core.js';
import { tierFor } from './chromatic-impasto-quality.js';
import { createBlob } from './chromatic-impasto-strokes.js';
import { Painter } from './chromatic-impasto-painter.js';
import { PaintCanvas } from './chromatic-impasto-canvas.js';
import { createSurface } from './chromatic-impasto-surface.js';
import { createDroplets, createMotes } from './chromatic-impasto-fx.js';
import {
    ambientGesture, burstGesture, canvasExtent, composeUnderpainting, haloGesture, lockGesture, scrapeGesture,
    spiralGesture, splatGesture, sweepGesture,
} from './chromatic-impasto-gestures.js';
import {
    BOARD_GRID, boardFor, boardPoint, cardUnion, fallbackLayout,
} from './chromatic-impasto-composition.js';

/** The rest camera (the frame is always two canvas units tall, so the field of view is fixed). */
export const REST_RIG = Object.freeze({
    fov: VIEW.fov, distance: VIEW_DISTANCE, near: VIEW.near, far: VIEW.far,
});

export function fovForAspect() {
    return REST_RIG.fov;
}

/** The lamp at rest: up and to the left, low over the cloth. */
export const LAMP = Object.freeze({ azimuth: 142 * DEG, elevation: 25 * DEG });
/** Seconds between the painter's own strokes. */
export const AMBIENT_BEAT = 2.6;
/** Wetness is stepped at this interval, and falls to 1/e in DRY_TAU seconds. */
export const DRY_STEP = 0.25;
export const DRY_TAU = 13;
/** Seconds after the last stroke the drying pass keeps running. */
const DRY_SPAN = 70;
/** Quads a live frame lays at most: a long log replayed after a reshape takes a few frames. */
const FRAME_BUDGET = 9000;
/** The link of a chain from which its arcs are fluorescent, and from which they are gold. */
export const COMBO_GLOW = 5;
export const COMBO_GOLD = 8;
/** How far from the board the stirring reaches (canvas units), at rest and at a long chain. */
const TWIST_REACH = [1.05, 1.5];

const PARTS = ['canvas', 'droplets', 'shadows', 'motes'];

const dirFromAngles = (azimuth, elevation, out) => out.set(
    Math.cos(azimuth) * Math.cos(elevation),
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
);

export class ChromaticImpastoWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {THREE.WebGPURenderer} [params.renderer]  without one the painter still runs (tests)
     * @param {boolean} [params.capture=false]  deterministic captures: no wall-clock anywhere
     * @param {number} [params.seed=1]
     */
    constructor({
        scene, quality = 'High', renderer = null, capture = false, seed = 1,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.renderer = renderer;
        this.capture = capture;
        this.seed = seed;
        this.root = new THREE.Group();
        this.root.name = 'Chromatic Impasto';
        this.parts = {};
        this.disposables = [];
        this.u = null;
        this.canvas = null;
        this.painter = new Painter();
        this.droplets = null;
        this.motes = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.buffer = { width: 1600, height: 900 };
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        this.card = {
            x0: -0.4, y0: -0.85, x1: 0.4, y1: 0.85,
        };
        this.heart = { x: 0, y: 0 };
        this.field = createField({ aspect: this.aspect, seed, heart: this.heart });
        this._camera = null;
        this._look = new THREE.Vector3();
        this._lamp = new THREE.Vector3();
        this._point = { x: 0.5, y: 0.5 };
        this._twist = {
            cx: 0, cy: 0, angle: 0, reach: TWIST_REACH[0],
        };
        this._post = {
            flash: 0, kick: 0, exposure: 1, bloomBoost: 0, hush: 0, heart: { x: 0.5, y: 0.5 }, warmth: 0,
        };
        this.needsPaint = true;
        /** True once the passes a game meets late (bake, drying) have been drawn once. */
        this.warmed = false;
        /** Quads a live frame lays at most. */
        this.frameBudget = FRAME_BUDGET;
        /** When the underpainting begins (world seconds), and whether it is in the log yet. */
        this.introStart = 0;
        this.composed = false;
        /** The frame shape the canvas was blocked in for. */
        this.composedAspect = this.aspect;
        this.resetState(0);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.combo = 0;
        this.power = 0;
        this.surge = 0;
        this.flash = 0;
        this.kick = 0;
        this.dip = 0;
        this.swing = 0;
        this.swingPhase = 0;
        this.breath = 1;
        this.level = 1;
        this.periodIndex = 0;
        this.hushUntil = -1;
        this.twistAngle = 0;
        /** Where the twist is easing to: every link of a chain moves it on a notch. */
        this.twistTarget = 0;
        /** How far the stirring reaches: chosen while the canvas is untwisted, held until a bake. */
        this.twistReach = TWIST_REACH[0];
        this.dryClock = 0;
        this.sheenCursor = 0;
        this.session = 0;
        this.ambientIndex = Math.max(0, Math.floor((time - INTRO_SPAN - 1) / AMBIENT_BEAT));
        this.recent = [];
        this.pendingKick = { time: Infinity, amount: 0 };
        this.counts = {
            locks: 0, clears: 0, quads: 0, strokes: 0, bakes: 0,
        };
        this.droplets?.reset();
        if (this.u) {
            for (let i = 0; i < SHEEN_SLOTS; i++) this.u.sheenSlots[i].set(0, 0, -100, 0);
            this.u.twist.value.set(0, 0, 0, TWIST_REACH[0]);
        }
    }

    get period() {
        return IMPASTO_PERIODS[this.periodIndex];
    }

    build() {
        const sheenSlots = Array.from({ length: SHEEN_SLOTS }, () => new THREE.Vector4(0, 0, -100, 0));
        const u = {
            time: uniform(0),
            thickness: uniform(RELIEF.thickness),
            reliefGain: uniform(1),
            lightDir: uniform(dirFromAngles(LAMP.azimuth, LAMP.elevation, new THREE.Vector3())),
            keyColor: uniform(new THREE.Vector3(2.5, 2.4, 2.2)),
            fillColor: uniform(new THREE.Vector3(0.3, 0.33, 0.4)),
            rimDir: uniform(dirFromAngles(-32 * DEG, 34 * DEG, new THREE.Vector3())),
            rimColor: uniform(new THREE.Vector3(0.5, 0.7, 1.05)),
            shadowDepth: uniform(0.82),
            windowGain: uniform(3.4),
            glowGain: uniform(0.8),
            wetLift: uniform(0),
            exposure: uniform(1),
            twist: uniform(new THREE.Vector4(0, 0, 0, TWIST_REACH[0])),
            sheen: uniformArray(sheenSlots, 'vec4'),
            sheenSlots,
            sheenReach: uniform(4.2),
        };
        this.u = u;

        this.canvas = new PaintCanvas({ renderer: this.renderer });
        const surface = createSurface(u, this.canvas, this.tier);
        this.addPart('canvas', surface);

        const drops = createDroplets(u, this.tier.droplets);
        this.droplets = drops;
        this.addPart('shadows', drops.shadows);
        this.addPart('droplets', drops);
        if (this.tier.motes > 0) {
            this.motes = createMotes(u, this.tier.motes);
            this.addPart('motes', this.motes);
        }

        this.sizeCanvas();
        this.scene.add(this.root);
        return this;
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

    // ── Size and layout ─────────────────────────────────────────────────────────

    /** The paint texture follows the frame: `canvasScale` texels per pixel, a little past it. */
    sizeCanvas() {
        if (!this.canvas) return;
        const { halfX, halfY } = canvasExtent(this.aspect);
        const { tier } = this;
        const height = clamp(Math.round(this.buffer.height * VIEW.overscan * tier.canvasScale), 384, tier.canvasMax);
        const width = Math.min(4096, Math.round(height * (halfX / halfY)));
        if (this.canvas.setSize(width, height, halfX, halfY) === 'bare') this.needsPaint = true;
        const surface = this.parts.canvas?.mesh;
        if (surface) {
            surface.scale.set(halfX, halfY, 1);
            surface.updateMatrix();
            surface.updateMatrixWorld(true);
        }
    }

    setViewport(bufferWidth, bufferHeight, aspect) {
        let changed = false;
        if (bufferWidth > 0 && bufferHeight > 0
            && (bufferWidth !== this.buffer.width || bufferHeight !== this.buffer.height)) {
            this.buffer.width = bufferWidth;
            this.buffer.height = bufferHeight;
            changed = true;
        }
        if (Number.isFinite(aspect) && aspect > 0 && Math.abs(aspect - this.aspect) > 1e-4) {
            this.aspect = aspect;
            changed = true;
            if (!this.layoutLive) this.applyLayout(null);
            // A differently shaped frame is a different canvas: block it in again (whatever of
            // the underpainting is already due is simply there). Measured against the shape it
            // was blocked in for, so a window dragged wider in small steps is caught too; a
            // smaller change stays inside the cloth's margin.
            if (this.composed && this.reshaped()) this.compose({ keepGame: true });
        }
        if (changed) this.sizeCanvas();
    }

    /** Has the frame's shape left the one the canvas was blocked in for? */
    reshaped() {
        return Math.abs(this.aspect / this.composedAspect - 1) > 0.04;
    }

    /**
     * The live board / card / HUD rects (screen fractions), or null when no board is on screen:
     * events then aim at where the solo board would be.
     */
    setLayout(rects, aspect) {
        if (Number.isFinite(aspect) && aspect > 0) this.setViewport(0, 0, aspect);
        this.layoutLive = Boolean(rects);
        this.applyLayout(rects);
    }

    applyLayout(rects) {
        this.layout = rects || fallbackLayout(this.aspect * 1000, 1000);
        const union = cardUnion(this.layout);
        if (union) {
            this.card = {
                x0: (union.x0 * 2 - 1) * this.aspect,
                x1: (union.x1 * 2 - 1) * this.aspect,
                y0: 1 - union.y1 * 2,
                y1: 1 - union.y0 * 2,
            };
        }
        const heartX = (this.card.x0 + this.card.x1) * 0.5;
        const heartY = (this.card.y0 + this.card.y1) * 0.5;
        // The paint is stirred about the board: before the board moves, the turn is baked in.
        if (Math.hypot(heartX - this.heart.x, heartY - this.heart.y) > 1e-3) this.bakeTwist();
        this.heart.x = heartX;
        this.heart.y = heartY;
        this.field = createField({ aspect: this.aspect, seed: this.seed + this.session, heart: this.heart });
        this._post.heart.x = clamp01((this.heart.x / this.aspect) * 0.5 + 0.5);
        this._post.heart.y = clamp01(0.5 - this.heart.y * 0.5);
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** A screen point (fractions, y down) on the canvas at rest. `out` = [x, y]. */
    screenToCanvas(sx, sy, out = [0, 0]) {
        out[0] = (sx * 2 - 1) * this.aspect;
        out[1] = 1 - sy * 2;
        return out;
    }

    // ── The painting ────────────────────────────────────────────────────────────

    /**
     * Block the canvas in: the underpainting is laid over INTRO_SPAN seconds from `introStart`
     * (strokes already due by now are simply there). `keepGame` keeps what the game has painted
     * on top. Deferred to the first frame, when the frame's shape and the board are known.
     */
    compose({ keepGame = false } = {}) {
        const { painter } = this;
        // What the game painted is kept with the stirrings it went through, in their order.
        if (keepGame) this.bakeTwist();
        const kept = keepGame ? painter.log.filter((s) => s.tag !== 'under') : [];
        painter.reset();
        this.field = createField({ aspect: this.aspect, seed: this.seed + this.session, heart: this.heart });
        painter.addAll(composeUnderpainting({
            field: this.field,
            aspect: this.aspect,
            period: this.period,
            seed: this.seed + this.session * 31 + this.periodIndex * 7,
            t0: this.introStart,
            density: this.tier.density,
            card: this.card,
        }));
        painter.addAll(kept);
        this.twistAngle = 0;
        this.twistTarget = 0;
        this.needsPaint = true;
        this.composed = true;
        this.composedAspect = this.aspect;
    }

    /** Jump the clock (captures): the canvas as it stands `time` seconds after the theme started. */
    seek(time) {
        const t = Math.max(0, time);
        this.resetState(t);
        this.painter.reset();
        this.introStart = 0;
        this.composed = false;
        this.needsPaint = true;
    }

    /** A game ended or was left: the chain is over; the painting stays. */
    resetSession() {
        this.twistTarget = this.twistAngle;
        this.bakeTwist();
        this.combo = 0;
        this.hushUntil = -1;
        this.pendingKick.time = Infinity;
    }

    /** A new game: the canvas is scraped down and blocked in again, in the first period. */
    freshCanvas() {
        const untouched = this.counts.locks === 0 && this.counts.clears === 0 && this.periodIndex === 0;
        this.level = 1;
        if (untouched) return;
        this.resetSession();
        this.periodIndex = 0;
        this.session += 1;
        this.recent.length = 0;
        this.counts.locks = 0;
        this.counts.clears = 0;
        this.counts.quads = 0;
        this.field = createField({ aspect: this.aspect, seed: this.seed + this.session, heart: this.heart });
        const t = this.time;
        this.introStart = t + 0.5;
        // The old underpainting leaves the log: after a resize only this game's canvas is laid.
        this.painter.log.forEach((s) => {
            if (s.tag === 'under') s.tag = 'past';
        });
        this.painter.addAll(scrapeGesture({
            field: this.field, aspect: this.aspect, ground: this.period.ground, t0: t, seed: this.session + 3,
        }));
        this.painter.addAll(composeUnderpainting({
            field: this.field,
            aspect: this.aspect,
            period: this.period,
            seed: this.seed + this.session * 31 + this.periodIndex * 7,
            t0: this.introStart,
            density: this.tier.density,
            card: this.card,
        }));
    }

    bindCamera(camera) {
        this._camera = camera;
    }

    /**
     * The painting, to hand to another world: the theme rebuilds its world on a quality change
     * and after a lost GPU, and the picture a game has made must outlive both. The log is handed
     * over, not copied: this world must not paint again.
     */
    exportPainting() {
        if (!this.composed) return null;
        return {
            time: this.time,
            aspect: this.aspect,
            log: this.painter.log.slice(),
            introStart: this.introStart,
            level: this.level,
            periodIndex: this.periodIndex,
            session: this.session,
            recent: this.recent.map((c) => [...c]),
            counts: { ...this.counts },
            ambientIndex: this.ambientIndex,
            combo: this.combo,
            twist: {
                cx: this._twist.cx, cy: this._twist.cy, angle: this.twistAngle, reach: this.twistReach,
            },
        };
    }

    /**
     * Take over a painting from `exportPainting`. The canvas is laid again from its log on the
     * next frame, with the turn it was holding.
     * @returns {boolean} false when there was nothing to take
     */
    importPainting(painting) {
        if (!painting || !Array.isArray(painting.log) || !painting.log.length) return false;
        this.time = painting.time;
        this.introStart = painting.introStart;
        this.level = painting.level;
        this.periodIndex = painting.periodIndex;
        this.session = painting.session;
        this.recent = painting.recent.map((c) => [...c]);
        this.counts = { ...painting.counts };
        this.ambientIndex = painting.ambientIndex;
        this.combo = 0;
        // The turn the canvas was holding is still on it (the chain that put it there is over).
        const twist = painting.twist || {
            cx: this.heart.x, cy: this.heart.y, angle: 0, reach: TWIST_REACH[0],
        };
        Object.assign(this._twist, {
            cx: twist.cx, cy: twist.cy, angle: twist.angle, reach: twist.reach,
        });
        this.twistAngle = twist.angle;
        this.twistTarget = twist.angle;
        this.twistReach = twist.reach;
        this.painter.reset();
        for (let i = 0; i < painting.log.length; i++) this.painter.log.push(painting.log[i]);
        this.painter.rewind();
        this.composed = true;
        this.needsPaint = true;
        this.field = createField({ aspect: this.aspect, seed: this.seed + this.session, heart: this.heart });
        this.composedAspect = Number.isFinite(painting.aspect) ? painting.aspect : this.aspect;
        // A long game's log has let go of its oldest strokes, the underpainting first; or the
        // frame changed shape while the world was being rebuilt: the canvas is blocked in again
        // under what the game painted.
        if (this.reshaped() || !this.painter.log.some((s) => s.tag === 'under')) this.compose({ keepGame: true });
        return true;
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const t = sim.time;
        const calm = this.reducedMotion ? 0 : 1;
        if (camera.fov !== REST_RIG.fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = REST_RIG.fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        // Someone standing before a large painting, shifting their weight; the pointer leans them.
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        const dx = (Math.sin(t * 0.11) * 0.03 + Math.sin(t * 0.067 + 1.3) * 0.02) * calm + px * 0.035;
        const dy = (Math.sin(t * 0.09 + 0.7) * 0.016 + Math.sin(t * 0.053) * 0.012) * calm - py * 0.02;
        camera.position.set(dx, dy, REST_RIG.distance + this.kick * 0.035 * calm);
        // Looking nearly where they stand: the frame slides a little, the relief shifts more.
        this._look.set(dx * 0.72, dy * 0.72, 0);
        camera.up.set(Math.sin(t * 0.05) * 0.003 * calm, 1, 0);
        camera.lookAt(this._look);
        camera.updateMatrixWorld();
        this._camera = camera;
    }

    // ── Gameplay ────────────────────────────────────────────────────────────────

    /**
     * An ellipse round the card, `gap` clear of its sides: its x radius, and the y scale that
     * makes it hug the card's height. What is wound round the board is wound on this.
     */
    ringRound(gap) {
        const { card } = this;
        const radius = (card.x1 - card.x0) * 0.5 + gap + 0.06;
        const tall = (card.y1 - card.y0) * 0.5 + gap * 0.5 + 0.04;
        return { radius, squash: tall / radius };
    }

    /**
     * The x a stroke leaves from on one side of the card at height `y`: the card's side, or the
     * far side of the HUD when the HUD stands beside the card at that height (paint laid behind
     * the HUD's panels would not be seen).
     */
    sideEdge(side, y) {
        const { card } = this;
        const edge = side < 0 ? card.x0 : card.x1;
        const { hud } = this.layout;
        if (!hud) return edge;
        const y0 = 1 - hud.y1 * 2;
        const y1 = 1 - hud.y0 * 2;
        if (y < y0 - 0.03 || y > y1 + 0.03) return edge;
        const x0 = (hud.x0 * 2 - 1) * this.aspect;
        const x1 = (hud.x1 * 2 - 1) * this.aspect;
        if (side > 0 && x1 > edge && x0 - edge < 0.4) return x1;
        if (side < 0 && x0 < edge && edge - x1 < 0.4) return x0;
        return edge;
    }

    /** The colours of the last pieces laid, newest first, padded from the period's tubes. */
    recentColors(count) {
        const out = [];
        for (let i = 0; i < count; i++) {
            out.push(this.recent[i] || this.period.masses[(i * 2 + this.counts.clears) % this.period.masses.length]);
        }
        return out;
    }

    /** Thrown paint: drops leave (x, y) and land where the pool says, leaving a dot each. */
    throwPaint({
        x, y, dx, dy, n, color, time, speed = 1, spread = 0.9, size = 1, special = 0,
    }) {
        if (!this.droplets || n <= 0) return;
        const landings = this.droplets.emit({
            x, y, dx, dy, n: Math.round(n * (this.droplets.count / 384)), color, time, speed, spread, size, special,
        });
        for (let i = 0; i < landings.length; i++) {
            const l = landings[i];
            this.painter.add(createBlob({
                x: l.x,
                y: l.y,
                radius: l.radius,
                t0: l.time,
                colorA: color,
                load: 1,
                fingers: 0.3 + 0.5 * l.speed,
                height: 0.95,
                special,
                angle: l.angle,
                seed: l.seed,
                tag: 'drop',
            }));
        }
    }

    /**
     * A piece locked. `rows` = visible board rows it occupies (0 top .. 19 floor), `u` = its
     * column as a fraction of the board width, `color` = its CSS hex colour; `screen`
     * ({ x, y } window fractions) replaces the board position for the meditation mode's clicks.
     */
    onLock({
        rows = null, u = 0.5, hardDrop = false, color = null, player = 0, screen = null,
    } = {}) {
        if (!this.u) return;
        const t = this.time;
        const rgb = color ? pigmentFromHex(color) : this.period.masses[this.counts.locks % this.period.masses.length];
        const index = this.counts.locks;
        const rand = mulberry32(index * 6007 + 131);
        const { card } = this;
        const frameX = this.aspect;
        let x;
        let y;
        let out;
        let reach = radicalInverse(index + 1);
        if (screen) {
            [x, y] = this.screenToCanvas(screen.x, screen.y);
            const a = rand() * TAU;
            out = [Math.cos(a), Math.sin(a)];
        } else {
            const board = boardFor(this.layout, player);
            const row = Array.isArray(rows) && rows.length ? rows[Math.floor(rows.length / 2)] : BOARD_GRID.rows - 1;
            let px = 0.5;
            let py = 0.5;
            if (board) {
                boardPoint(board, u, row, this._point);
                px = this._point.x;
                py = this._point.y;
            }
            const at = this.screenToCanvas(px, py);
            const side = u < 0.5 ? -1 : 1;
            const edgeX = this.sideEdge(side, at[1]);
            const room = side < 0 ? edgeX + frameX : frameX - edgeX;
            if (room > 0.16) {
                // Out of the card's side, at the piece's height: nearer or farther from lock to lock.
                x = edgeX + side * 0.012;
                y = at[1] + (rand() - 0.5) * 0.03;
                out = [side, (rand() - 0.5) * 0.5];
                reach *= clamp((room - 0.12) / 0.9, 0.2, 1);
            } else {
                // No room beside it (a tall, narrow frame): out of the card's top or foot, over
                // the piece's column.
                const up = at[1] > this.heart.y ? 1 : -1;
                const edge = up > 0 ? card.y1 : card.y0;
                x = at[0] + (rand() - 0.5) * 0.03;
                y = edge + up * 0.012;
                out = [(rand() - 0.5) * 0.6, up];
                reach *= clamp((1 - Math.abs(edge)) / 0.9, 0.05, 0.5);
            }
        }
        const under = this.recent[0] || null;
        const gesture = lockGesture({
            field: this.field, x, y, out, color: rgb, under, hard: hardDrop, reach, t0: t, seed: index + 1,
        });
        this.painter.addAll(gesture.strokes);
        if (hardDrop) {
            // The slab is driven out of a splat that stands clear of the card.
            this.painter.addAll(splatGesture({
                x: x + out[0] * 0.05,
                y: y + out[1] * 0.05,
                radius: 0.045 + rand() * 0.015,
                color: rgb,
                colorB: under,
                t0: t,
                seed: index + 7,
                spatter: 7,
            }));
            this.throwPaint({
                x, y, dx: out[0], dy: out[1], n: 22, color: rgb, time: t, speed: 1.25, spread: 1.4, size: 1.1,
            });
        } else {
            // A few drops leave the brush as it lifts.
            const [tipX, tipY] = gesture.tip;
            const [dx, dy] = gesture.heading;
            this.throwPaint({
                x: tipX, y: tipY, dx, dy, n: 6, color: rgb, time: t + 0.2, speed: 0.6, spread: 0.7, size: 0.8,
            });
        }
        this.recent.unshift(rgb);
        if (this.recent.length > 8) this.recent.length = 8;
        this.kick = Math.max(this.kick, hardDrop ? 0.5 : 0.1);
        this.flash = Math.max(this.flash, hardDrop ? 0.08 : 0.015);
        this.counts.locks += 1;
    }

    /** A ring of wet light leaves (x, y) at `time`. */
    sendSheen(x, y, time, strength) {
        const slot = this.sheenCursor % SHEEN_SLOTS;
        this.sheenCursor += 1;
        this.u.sheenSlots[slot].set(x, y, time, strength);
    }

    /**
     * Lines cleared. `lines` 1..4; `rows` = the cleared visible rows; `tspin`, `perfect`.
     */
    onClear({
        rows = null, lines = 1, tspin = false, perfect = false, player = 0, screen = null,
    } = {}) {
        if (!this.u) return;
        const t = this.time;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        const index = this.counts.clears;
        const rand = mulberry32(index * 4421 + 59);
        const { card } = this;
        const { halfX } = canvasExtent(this.aspect);
        const board = boardFor(this.layout, player);
        const colors = this.recentColors(6);
        const birth = quad ? t + HUSH_HOLD : t;

        // ── The cleared rows leave the board as loaded brushes, one pair a row ──
        const list = Array.isArray(rows) && rows.length
            ? rows
            : Array.from({ length: n }, (_, i) => BOARD_GRID.rows - 1 - i);
        const rowHeight = board ? ((board.y1 - board.y0) * 2) / BOARD_GRID.rows : 0.074;
        // A tall frame has no cloth beside the board: there the rows leave from under its foot
        // and over its top, both ways from the middle.
        const narrow = !screen && Math.min(card.x0 + this.aspect, this.aspect - card.x1) < 0.3;
        let centre = this.heart.y;
        for (let i = 0; i < list.length && i < 4; i++) {
            let y;
            let { x0, x1 } = card;
            if (screen) y = this.screenToCanvas(screen.x, screen.y)[1] + (i - (list.length - 1) / 2) * rowHeight;
            else if (board) y = this.screenToCanvas(0.5, boardPoint(board, 0.5, list[i], this._point).y)[1];
            else y = card.y0 + rowHeight * (i + 0.5);
            if (narrow) {
                const out = 0.07 + Math.floor(i / 2) * rowHeight * 1.9;
                y = i % 2 === 0 ? card.y0 - out : card.y1 + out;
                x0 = this.heart.x;
                x1 = this.heart.x;
            }
            centre = y;
            const strokes = sweepGesture({
                y,
                x0,
                x1,
                halfX,
                width: rowHeight * 0.88,
                color: colors[i % colors.length],
                colorB: colors[(i + 1) % colors.length],
                t0: birth + i * 0.045,
                seed: index * 5 + i + 1,
            });
            this.painter.addAll(strokes);
            // Paint flies off the brush as it leaves the card.
            for (let side = -1; side <= 1; side += 2) {
                this.throwPaint({
                    x: side < 0 ? x0 - 0.05 : x1 + 0.05,
                    y,
                    dx: side,
                    dy: 0.15,
                    n: 7 + n * 2,
                    color: colors[i % colors.length],
                    time: birth + i * 0.045 + 0.04,
                    speed: 1.1 + n * 0.12,
                    spread: 0.8,
                });
            }
        }
        this.sendSheen(this.heart.x, centre, birth, Math.min(1, 0.4 + 0.15 * n));
        this.pendingKick = { time: birth + 0.05, amount: 0.18 + 0.09 * n };
        this.swing = Math.max(this.swing, 0.25 + 0.12 * n);

        if (quad) {
            // The studio holds its breath; then the paint flies, and the gold goes on.
            this.hushUntil = t + HUSH_HOLD;
            this.surge = perfect ? 1.3 : 1;
            const burst = burstGesture({
                card,
                colors: this.recentColors(5),
                t0: birth,
                seed: index + 11,
                count: perfect ? 22 : 16,
                reach: Math.min(0.85, halfX * 0.4 + 0.2),
            });
            this.painter.addAll(burst.strokes);
            for (let i = 0; i < burst.throws.length; i++) {
                const th = burst.throws[i];
                this.throwPaint({
                    ...th, n: 8, time: birth + 0.03, speed: 1.9, spread: 0.6, size: 1.05,
                });
            }
            // Every four-line clear of a game lays its ring outside the last: the board's frame.
            this.painter.addAll(haloGesture({
                card, t0: birth + 0.28, seed: index + 3, turns: perfect ? 2 : 1, ring: this.counts.quads % 4,
            }));
            // Flakes of gold in the air over the board.
            this.throwPaint({
                x: this.heart.x,
                y: card.y1 + 0.02,
                dx: 0,
                dy: 1,
                n: 40,
                color: GOLD,
                time: birth + 0.35,
                speed: 1.5,
                spread: 3.0,
                size: 0.7,
                special: 1,
            });
            this.sendSheen(this.heart.x, this.heart.y, birth + 0.3, 1);
            this.pendingKick = { time: birth, amount: 0.9 };
            this.counts.quads += 1;
        }
        if (perfect) {
            // The masterstroke: two great arcs of light and gold wound round the board.
            const round = this.ringRound(0.26);
            this.painter.addAll(spiralGesture({
                cx: this.heart.x,
                cy: this.heart.y,
                radius: round.radius,
                squash: round.squash,
                colors: [this.period.light, GOLD],
                t0: birth + 0.5,
                seed: index + 5,
                arms: 2,
                sweep: 4.6,
                width: 0.04,
                grow: 0.3,
                special: 1,
                dur: 0.8,
                tag: 'gold',
            }));
        }
        if (tspin) {
            // The canvas itself turns a notch, and the turn is drawn.
            if (!this.reducedMotion) this.twistTarget += 0.42;
            const round = this.ringRound(0.12);
            this.painter.addAll(spiralGesture({
                cx: this.heart.x,
                cy: this.heart.y,
                radius: round.radius,
                squash: round.squash,
                colors: [colors[0], this.period.light, colors[1]],
                t0: birth,
                seed: index + 17 + Math.floor(rand() * 9),
                arms: 3,
                sweep: 3.2,
                width: 0.03,
                grow: 0.25,
            }));
        }
        this.counts.clears += 1;
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        if (!this.u) {
            this.combo = n;
            return;
        }
        if (n > this.combo && n >= SWIRL_FROM) {
            // Every link of the chain is drawn: arcs wound round the board, wider as it grows.
            // From the fifth link the paint is fluorescent; from the eighth it is gold.
            const t = this.time;
            const links = Math.min(8, n);
            const { radius, squash } = this.ringRound(0.1 + links * 0.03);
            const gilded = n >= COMBO_GOLD;
            const lit = n >= COMBO_GLOW;
            const colors = gilded ? [GOLD, this.period.light, GOLD] : this.recentColors(3);
            const arms = Math.min(4, 1 + Math.floor(n / 2));
            this.painter.addAll(spiralGesture({
                cx: this.heart.x,
                cy: this.heart.y,
                radius,
                squash,
                colors,
                t0: t + 0.05,
                seed: n * 13 + this.counts.clears,
                arms,
                sweep: 2.6 + links * 0.25,
                width: 0.02 + links * 0.0022,
                grow: 0.22,
                special: Number(gilded) - Number(lit && !gilded),
                // One arc of each link carries the special paint; the rest are the pieces' own.
                specialArms: 1,
                tag: gilded ? 'gold' : 'spiral',
            }));
            // Paint flies off the turning brush, with the turn.
            const rand = mulberry32(n * 919 + this.counts.clears * 31);
            for (let k = 0; k < arms; k++) {
                const a = rand() * TAU;
                this.throwPaint({
                    x: this.heart.x + Math.cos(a) * radius,
                    y: this.heart.y + Math.sin(a) * radius * squash,
                    dx: -Math.sin(a),
                    dy: Math.cos(a) * squash,
                    n: 5 + links,
                    color: colors[k % colors.length],
                    time: t + 0.1 + k * 0.05,
                    speed: 1 + links * 0.08,
                    spread: 0.9,
                    special: gilded ? 1 : 0,
                });
            }
            this.sendSheen(this.heart.x, this.heart.y, t, Math.min(0.9, 0.25 + 0.08 * n));
            // And the canvas turns a notch.
            if (!this.reducedMotion) this.twistTarget += notchForCombo(n);
        }
        if (n === 0 && this.combo >= SWIRL_FROM) {
            // The chain broke: the canvas stops where it is, still turned. (The turn is baked
            // into the paint when it has wound far enough, and when the game ends.)
            this.twistTarget = this.twistAngle;
            this.dip = Math.max(this.dip, 0.2);
        }
        this.combo = n;
    }

    /** A new level: a new period. The painter goes over the picture in the new tubes. */
    levelUp(level, { silent = false } = {}) {
        this.level = Math.max(1, Math.round(Number(level) || 1));
        const next = (this.level - 1) % IMPASTO_PERIODS.length;
        if (next === this.periodIndex) return;
        this.periodIndex = next;
        if (!this.u) return;
        if (silent) {
            // The picture as if it had always been of this period.
            this.introStart = Math.min(this.introStart, this.time - INTRO_SPAN - 1);
            this.compose();
            return;
        }
        const strokes = composeUnderpainting({
            field: this.field,
            aspect: this.aspect,
            period: this.period,
            seed: this.seed + this.level * 101,
            t0: this.time + 0.1,
            span: 2.6,
            density: this.tier.density * 0.42,
            card: this.card,
        }).filter((s) => s.height > 0.5);
        strokes.forEach((s) => {
            s.tag = 'level';
        });
        this.painter.addAll(strokes);
        this.sendSheen(this.heart.x, this.heart.y, this.time, 0.8);
        this.flash = Math.max(this.flash, 0.12);
        this.swing = Math.max(this.swing, 0.6);
    }

    /** Freeze the twist into the paint. */
    bakeTwist() {
        const angle = this.twistAngle;
        this.twistAngle = 0;
        this.twistTarget -= angle;
        if (Math.abs(angle) < 1e-3 || !this.canvas) return;
        const { cx, cy, reach } = this._twist;
        // Recorded in the log, so a replay stirs the paint at the same moment.
        const entry = this.painter.addBake(this.time, cx, cy, angle, reach);
        // (While a replay is still being laid the bake waits its turn in the log: baked now, it
        // would stir a half-laid canvas and leave the rest unstirred.)
        if (!this.needsPaint && !this.painter.behind) {
            this.canvas.bake(cx, cy, angle, reach);
            this.painter.carryBack(cx, cy, angle, reach);
            entry.done = true;
        }
        this.counts.bakes += 1;
    }

    // ── Frame ───────────────────────────────────────────────────────────────────

    update(sim, camera = this._camera) {
        const { u, canvas, painter } = this;
        if (!u || !canvas) return;
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        if (!this.composed) this.compose();
        const t = this.time;
        const motion = this.reducedMotion ? 0 : 1;

        // ── The charge ──
        const target = powerForCombo(this.combo);
        this.power += (target - this.power) * approach(target > this.power ? 2.4 : 0.9, dt);
        this.surge *= Math.exp(-dt / 2.6);
        this.flash *= Math.exp(-dt / 0.25);
        this.kick *= Math.exp(-dt / 0.18);
        this.dip *= Math.exp(-dt / 0.4);
        this.swing *= Math.exp(-dt / 1.1);
        if (t >= this.pendingKick.time) {
            this.kick = Math.max(this.kick, this.pendingKick.amount);
            this.flash = Math.max(this.flash, this.pendingKick.amount * 0.3);
            this.pendingKick.time = Infinity;
        }
        const hush = t < this.hushUntil ? 1 : 0;
        const breathTarget = hush ? 0.3 : 1 - this.dip;
        this.breath += (breathTarget - this.breath) * approach(hush ? 40 : 12, dt);
        if (dt === 0) this.breath = breathTarget;

        // ── The painter's own strokes, on the studio's clock ──
        const beat = Math.floor((t - INTRO_SPAN - 1) / AMBIENT_BEAT);
        if (beat > this.ambientIndex) {
            this.ambientIndex = beat;
            if (dt > 0) {
                painter.addAll(ambientGesture({
                    field: this.field,
                    aspect: this.aspect,
                    period: this.period,
                    card: this.card,
                    t0: t,
                    index: beat + this.session * 977,
                }));
            }
        }

        // ── The twist: a chain of clears turns the canvas ──
        const tw = this._twist;
        // The stirring's centre and reach are chosen while the canvas is untwisted and held
        // until the twist is baked: changed under a held twist they would drag the paint about.
        if (this.twistAngle === 0) {
            tw.cx = this.heart.x;
            tw.cy = this.heart.y;
            this.twistReach = lerp(TWIST_REACH[0], TWIST_REACH[1], clamp01((this.combo - SWIRL_FROM) / 6))
                * Math.min(1.25, Math.max(0.7, this.aspect / 1.6));
        }
        tw.reach = this.twistReach;
        // Each link moved the target on a notch; the canvas eases after it, and creeps on while
        // the chain holds.
        if (this.combo >= SWIRL_FROM) this.twistTarget += TWIST_CREEP * motion * dt;
        this.twistAngle += (this.twistTarget - this.twistAngle) * approach(3.2, dt);
        tw.angle = this.twistAngle;

        // ── Lay what is due ──
        if (this.needsPaint && canvas.ready) {
            canvas.clear(this.period.ground);
            if (!this.warmed) {
                canvas.warm();
                this.warmed = true;
            }
            painter.rewind();
            this.needsPaint = false;
        }
        if (!this.needsPaint) {
            this.counts.strokes += painter.advance(t, canvas.batch, tw, (entry) => {
                canvas.bake(entry.cx, entry.cy, entry.angle, entry.reach);
            }, this.capture ? Infinity : this.frameBudget, (seconds) => {
                // A replay: what is already laid has had this long to dry.
                canvas.flush();
                canvas.dry(Math.exp(-seconds / DRY_TAU));
            });
            canvas.flush();
            // Drying: stepped, and only while something is still wet.
            this.dryClock += dt;
            const k = Math.exp(-DRY_STEP / DRY_TAU);
            let steps = 0;
            while (this.dryClock >= DRY_STEP && steps < 8) {
                this.dryClock -= DRY_STEP;
                steps += 1;
                if (t - painter.lastPaintTime < DRY_SPAN) canvas.dry(k);
            }
            if (this.dryClock >= DRY_STEP) this.dryClock = 0;
        } else {
            // No paint surface (a CPU-only host): the log still advances.
            this.counts.strokes += painter.advance(t, canvas.batch, tw, null);
            canvas.batch.reset();
        }

        // Wound far enough: the twist is baked into the paint. After the frame's paint is laid,
        // so that what was begun under the twist comes before the bake in the log, as it did on
        // the canvas (a replay must stir the same paint).
        if (Math.abs(this.twistAngle) > TWIST_BAKE_AT) {
            this.bakeTwist();
            tw.angle = this.twistAngle;
        }

        this.droplets?.update(t);
        this.motes?.update(t, this.aspect);

        // ── Uniforms ──
        u.time.value = t;
        u.twist.value.set(tw.cx, tw.cy, tw.angle, tw.reach);
        // The lamp wanders a little on its own and swings when the board asks.
        this.swingPhase += dt * 4.6;
        const azimuth = LAMP.azimuth + (Math.sin(t * 0.07) * 0.22 + Math.sin(t * 0.031 + 2) * 0.12) * motion
            + this.swing * Math.sin(this.swingPhase) * 0.16 * motion;
        const elevation = LAMP.elevation
            + (Math.sin(t * 0.05 + 1.1) * 0.05 + this.power * 0.025 + this.surge * 0.025) * (motion * 0.6 + 0.4);
        dirFromAngles(azimuth, elevation, u.lightDir.value);
        const { key } = this.period;
        const lift = (1 + this.power * 0.2 + this.surge * 0.28) * this.breath;
        const tint = mixRgb(key, GOLD, clamp01(this.surge * 0.45));
        u.keyColor.value.set(2.5 * tint[0] * lift, 2.5 * tint[1] * lift, 2.5 * tint[2] * lift);
        const fill = 0.3 * (0.4 + 0.6 * this.breath);
        u.fillColor.value.set(fill, fill * 1.1, fill * 1.33);
        u.wetLift.value = clamp01(this.power * 0.35 + this.surge * 0.25);
        u.windowGain.value = 3.4 * (1 + this.power * 0.2 + this.surge * 0.25) * this.breath;

        // ── Post ──
        const post = this._post;
        post.flash = this.flash;
        post.kick = this.kick;
        post.hush = hush;
        post.bloomBoost = this.surge * 0.3 + this.power * 0.08;
        post.warmth = clamp01(this.surge * 0.6);
        // The iris closes as the studio flares, so the colours survive the surge.
        post.exposure = 1 / (1 + this.surge * 0.3 + this.power * 0.12);
        if (camera) this._camera = camera;
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
            breath: this.breath,
            level: this.level,
            period: this.period.name,
            twist: this.twistAngle,
            counts: { ...this.counts },
            log: this.painter.log.length,
            cursor: this.painter.cursor,
            dropped: this.painter.dropped,
            canvas: this.canvas ? [this.canvas.width, this.canvas.height] : null,
            draws: this.canvas ? this.canvas.draws : 0,
            droplets: this.droplets ? this.droplets.count : 0,
            motes: this.motes ? this.motes.count : 0,
            layoutLive: this.layoutLive,
            card: { ...this.card },
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.scene?.remove(this.root);
        this.disposables.forEach((part) => {
            part.geometry?.dispose?.();
            part.material?.dispose?.();
            part.dispose?.();
        });
        this.canvas?.dispose();
        this.disposables = [];
        this.parts = {};
        this.canvas = null;
        this.droplets = null;
        this.motes = null;
        this.u = null;
        this._camera = null;
    }
}

export { PARTS as CHROMATIC_IMPASTO_PARTS };
