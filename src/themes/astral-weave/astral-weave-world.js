/**
 * Astral Weave — the world: builds and animates every element, owns the camera rig and the event
 * choreography. Shared by the theme (astral-weave-theme.js) and the playground effect
 * (src/playground/effects/astral-weave.effect.js), so what is iterated there is what ships.
 *
 * The event language (one verb each):
 *   lock     the shuttle crosses the loom at the piece's rows and leaves a weft thread ringing;
 *            the rosette threads that pass the lock are plucked and carry its light to the hoop.
 *   clear    the cleared rows burn: a runner races out to the hoop, two fronts chase round it
 *            re-drawing the weave thread by thread, pulses leave along the warp, and a ring of
 *            excited gas crosses the nebula.
 *   combo    every consecutive clear weaves one more petal into the rosette (k rises) and
 *            raises its temperature from pearl to gold.
 *   quad     the whole weave gathers into the crown peg (k → 0), the crown flares, and it
 *            re-opens as the iris (k = 1): every thread tangent to one circle of gold round the
 *            board, which then blooms back into petals (k = 2, 3, …) as it relaxes. A quad
 *            while the iris is open (a back-to-back, the perfect clear that crowns it) holds
 *            the iris longer and tightens it round the board for a beat; it never re-gathers.
 *   b2b      the gimbals take up gold thread and whirl.
 *
 * Fast play BUILDS instead of popping (src/themes/shared/gameplay-surge.js): every flash, kick,
 * crown flare and burst of energy is a Swell that adds to what is still lit; fronts, rings and
 * plucks take the slot with the least light left; a burning row the tapestry drops early
 * finishes its burn as an ember; a broken chain unweaves one petal at a time. A GameplaySurge
 * spends how hot the hands run on the loom itself: warm, the beads and comets quicken and the
 * lamps in the gas wake; hot, the weave warms to rose, the gimbals turn faster and the warp
 * winds tighter; fever, two lobes of light orbit the hoop (the carousel), the lamps blaze and
 * the nebula takes the gold. When the hands rest it all coasts back to calm.
 *
 * Everything that moves is closed-form in the world clock and event timestamps, except a few
 * eased scalars (k, heat) and clocks the world runs faster as play heats, stepped with exact,
 * frame-rate-independent updates; `seek(t)` plus a fixed-step replay reproduces any frame for
 * captures.
 */

import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import {
    PLAYER_SLOTS, REST_RIG, VIEW_HEIGHT, boardInLoom, fallbackLayout, screenToLoom, solveLoom,
} from './astral-weave-composition.js';
import { approach, createNoiseTexture, mulberry32 } from './astral-weave-tsl.js';
import { compileComputeAsync, isAsyncComputeCapable } from '../../rendering/webgpu-compute-pipeline-async.js';
import { createSky, lampFlare, lampPositions } from './astral-weave-sky.js';
import { MOTE_TIERS, createMotes } from './astral-weave-motes.js';
import { DUST_STATIC_MAX, DUST_TIERS, createDust } from './astral-weave-dust.js';
import {
    EMBER_SLOTS, LOOM_TIERS, PLUCK_SLOTS, SHUTTLE_SECONDS, SWEEP_SLOTS, WEFT_ROWS, WEFT_SLOTS,
    createFlares, createHoop, createPegs, createRosette, createSparks, createWarp, createWefts,
} from './astral-weave-loom.js';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';

const { PI } = Math;

/** The resting weave: a nephroid, its two cusps pointing in at the card from the sides. */
export const K_REST = 3;
/** The most petals a combo can weave on top of the resting figure. */
export const K_COMBO_MAX = 8;
/** The quad's figure: chords a → a + φ, all tangent to one circle (the iris). */
export const K_IRIS = 1;
/** Quad timeline (seconds): gather into the crown, dwell there, open the iris, hold it, relax. */
export const QUAD = Object.freeze({
    gather: 0.42, dwell: 0.16, open: 0.75, hold: 3.4, relax: 1.7,
});
/** The iris opens from a tight sunburst to a halo just outside the card (hoop radii). */
export const IRIS = Object.freeze({ from: 0.16, to: 0.45, perfectFrom: 0.03 });
/** Seconds after a clear before the burnt rows drop out of the tapestry. */
const WEFT_SETTLE = 0.95;
/** An ember (a burning row already dropped) is let go this long after its clear: its flash is spent. */
const EMBER_LIFE = 2.2;
const K_SPRING = 5.2;
/** A chain that broke unweaves one petal this often, thread by thread, instead of all at once. */
export const PETAL_STEP = 0.38;
/** The clears' rings through the gas: four at once (one vec4 of radii, one of gains). */
export const SHOCK_SLOTS = 4;
/** How fast a front, a ring and a pluck lose their light (1/s), and how fast a ring runs out. */
const SWEEP_FADE = 1.15;
const SHOCK_FADE = 1.15;
const SHOCK_SPEED = 1.9;
const PLUCK_FADE = 1.9;
/** How far a quad inside the quad (or a perfect clear's crown) tightens the iris, in hoop radii. */
const IRIS_SQUEEZE = 0.14;

const smoother = (x) => {
    const v = Math.min(1, Math.max(0, x));
    return v * v * v * (v * (v * 6 - 15) + 10);
};
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** The phase φ of an iris whose circle of tangency has this radius (chords a → a + φ). */
export const irisPhase = (radius) => 2 * Math.acos(Math.max(0, Math.min(1, radius)));

/**
 * The rosette's phase for a given k. Petals (k ≥ 3): φ = π puts a cusp on the hoop's right and,
 * for the resting nephroid, one on its left — they point in at the card. Iris (k = 1): φ sets the
 * circle's radius. Fan (k = 0): φ = π/2, every thread gathered into the crown peg.
 */
export function phaseForK(k, iris = irisPhase(IRIS.to)) {
    if (k >= K_REST) return PI;
    if (k >= K_IRIS) return iris + (PI - iris) * ((k - K_IRIS) / (K_REST - K_IRIS));
    return PI / 2 + (iris - PI / 2) * Math.max(0, k);
}

export class AstralWeaveWorld {
    /**
     * @param {object} opts
     * @param {THREE.Scene} opts.scene
     * @param {string} [opts.quality]
     * @param {boolean} [opts.capture] deterministic capture mode (no fade-in)
     * @param {THREE.WebGPURenderer} [opts.renderer] enables the simulated dust on WebGPU
     */
    constructor({
        scene, quality = 'High', capture = false, renderer = null,
    } = {}) {
        this.scene = scene;
        this.renderer = renderer;
        this.quality = LOOM_TIERS[quality] ? quality : 'High';
        this.tier = LOOM_TIERS[this.quality];
        this.capture = capture;
        this.group = new THREE.Group();
        this.group.name = 'astral-weave-world';
        this.loomGroup = new THREE.Group();
        this.loomGroup.name = 'astral-weave-loom';
        this.time = 0;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.loom = { cx: 0, cy: 0, radius: 0.58 };
        this.board = {
            left: -0.3, width: 0.6, top: 0.7, rowStep: 0.07,
        };
        this.hasBoard = false;
        /** Every live board in loom-local coordinates, by player slot (null when absent). */
        this.boards = new Array(PLAYER_SLOTS).fill(null);
        this.primaryPlayer = 0;
        this.parts = null;
        this.rand = mulberry32(90210);
        this._scratch = { x: 0, y: 0 };
        this._heart = { x: 0.5, y: 0.5 };
        this._lamps = [0, 0, 0, 0];
        this._post = {
            heart: this._heart, flash: 0, kick: 0, bloomBoost: 0, exposure: 1,
        };
        this._lockCue = { hardDrop: false };
        this._clearCue = {
            lines: 1, cascade: 1, combo: 1, tspin: false, perfect: false, b2b: false,
        };
        // Everything an event lights ADDS to what is still lit (shared/swell.js): a weak hit
        // after a strong one can only lift the light, rapid hits ride up to a plateau.
        this.energySwell = new Swell({ release: 1 / 1.15, ceiling: 2, knee: 1.4 });
        this.flashSwell = new Swell({ release: 1 / 3.2, ceiling: 1, knee: 0.6 });
        this.kickSwell = new Swell({ release: 1 / 4.6, ceiling: 1, knee: 0.7 });
        this.crownSwell = new Swell({ release: 1 / 1.5, ceiling: 1.6, knee: 1.2 });
        /** The iris tightening round the board for a beat (a quad inside the quad, a crown). */
        this.squeezeSwell = new Swell({
            attack: 0.12, release: 0.9, ceiling: 1.2, knee: 0.9,
        });
        /** Back-to-back: gold thread in the gimbals, and their whirl. */
        this.laceSwell = new Swell({
            attack: 0.1, release: 3, ceiling: 1.5, knee: 1,
        });
        /** How hot play runs (src/themes/shared/gameplay-surge.js). */
        this.surge = new GameplaySurge();
        this.play = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        this.shockAt = new Float64Array(SHOCK_SLOTS);
        this.shockGain = new Float64Array(SHOCK_SLOTS);
        this.shockSpeed = new Float64Array(SHOCK_SLOTS);
        this.gimbalTurn = new Float64Array(2);
        this.resetState();
    }

    resetState() {
        this.k = K_REST;
        this.kFree = K_REST;
        this.kVelocity = 0;
        this.kRest = K_REST;
        this.combo = 0;
        this.petals = 0;
        this.petalTarget = 0;
        this.unweaveAt = Infinity;
        this.heat = 0;
        this.heatTarget = 0;
        this.heatFlash = 0;
        this.energy = 0;
        this.kick = 0;
        this.flash = 0;
        this.crown = 0;
        this.squeeze = 0;
        this.lace = 0;
        this.warm = 0;
        this.spin = 0;
        this.spinVelocity = 0;
        [
            this.energySwell, this.flashSwell, this.kickSwell, this.crownSwell, this.squeezeSwell, this.laceSwell,
            this.surge,
        ].forEach((swell) => swell.reset());
        this.play.punch = 0;
        this.play.level = 0;
        this.play.fever = 0;
        this.play.stage = 0;
        this.shockAt.fill(-1000);
        this.shockGain.fill(0);
        this.shockSpeed.fill(1);
        this.quadAt = -1000;
        this.quadFrom = K_REST;
        this.quadHold = QUAD.hold;
        this.irisFrom = IRIS.from;
        this.irisStart = IRIS.to;
        this.shuttleDir = 1;
        this.flowPhase = this.time;
        this.runPhase = this.time;
        this.carouselAngle = 0;
        this.gimbalTurn[0] = this.time * 0.05;
        this.gimbalTurn[1] = this.time * -0.034;
        this.timers = [];
        this.pendingShift = null;
        this.fade = this.capture ? 1 : 0;
    }

    build() {
        this.noiseTex = createNoiseTexture();
        const far = () => new THREE.Vector4(0, 0, -1000, 0);
        const s = {
            uTime: uniform(0),
            uAspect: uniform(16 / 9),
            uViewport: uniform(new THREE.Vector2(1920, 1080)),
            uPxScale: uniform(1),
            uLoomPx: uniform(670),
            uLoom: uniform(new THREE.Vector3(0, 0, 0.58)),
            uSkyShift: uniform(new THREE.Vector2(0, 0)),
            uParallax: uniform(new THREE.Vector2(0, 0)),
            uLamps: uniform(new THREE.Vector4(-0.68, -0.31, 0.71, 0.3)),
            uLampFlare: uniform(new THREE.Vector2(1, 1)),
            uK: uniform(K_REST),
            uPhase: uniform(phaseForK(K_REST)),
            uSpin: uniform(0),
            uWarpTwist: uniform(0.5),
            uHeat: uniform(0),
            uEnergy: uniform(0),
            uCore: uniform(0.6),
            uCrown: uniform(0),
            uFade: uniform(this.fade),
            // The clears' rings through the gas: radius (hoop radii) and gain, one per component.
            uShockR: uniform(new THREE.Vector4(0, 0, 0, 0)),
            uShockG: uniform(new THREE.Vector4(0, 0, 0, 0)),
            // The fever's carousel: angle of its two lobes, gain.
            uCarousel: uniform(new THREE.Vector4(0, 0, 0, 0)),
            // Clocks the world runs faster as play heats: the beads' flow, the comets' run.
            uFlow: uniform(0),
            uRun: uniform(0),
            uLace: uniform(0),
            uBoard: uniform(new THREE.Vector4(-0.3, 0.6, 0.7, 0.07)),
            uPluck: uniformArray(Array.from({ length: PLUCK_SLOTS }, far), 'vec4'),
            uSweep: uniformArray(Array.from({ length: SWEEP_SLOTS }, () => new THREE.Vector4(0, -1000, 0, 0)), 'vec4'),
            uWeftA: uniformArray(Array.from({ length: WEFT_SLOTS }, () => new THREE.Vector4(-1000, 0, 1, 0)), 'vec4'),
            uWeftB: uniformArray(Array.from({ length: WEFT_SLOTS }, () => new THREE.Vector4(-2000, 0, 0, 0)), 'vec4'),
            uEmber: uniformArray(Array.from({ length: EMBER_SLOTS }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4'),
            noiseTex: this.noiseTex,
        };
        this.shared = s;

        const { tier } = this;
        this.sky = createSky(s, this.quality);
        this.rosette = createRosette(s, tier.threads, tier.segments);
        this.wefts = createWefts(s, tier.segments);
        this.warp = createWarp(s, tier.warp, tier.segments);
        this.hoop = createHoop(s, { main: true });
        this.gimbals = [];
        const gimbalLooks = [
            { radius: 1.075, gain: 0.42, speed: -0.13 },
            { radius: 1.15, gain: 0.28, speed: 0.09 },
        ];
        for (let i = 0; i < tier.gimbals; i++) {
            this.gimbals.push(createHoop(s, { ...gimbalLooks[i], main: false, name: `astral-weave-gimbal-${i}` }));
        }
        this.pegs = createPegs(s, tier.pegs);
        this.flares = createFlares(s);
        this.sparks = createSparks(s, tier.sparks);
        const dustTier = DUST_TIERS[this.quality];
        const simulate = dustTier.compute && this.renderer?.backend?.isWebGPUBackend === true
            && isAsyncComputeCapable(this.renderer);
        this.dust = null;
        if (dustTier.count > 0) {
            this.dust = createDust(s, simulate ? dustTier.count : Math.min(dustTier.count, DUST_STATIC_MAX), simulate);
            this.loomGroup.add(this.dust.mesh);
        }

        const moteCount = MOTE_TIERS[this.quality] ?? 0;
        this.motes = moteCount > 0 ? createMotes(s, moteCount) : null;

        this.group.add(this.sky.field, this.sky.jewels, this.loomGroup);
        if (this.motes) this.group.add(this.motes.mesh);
        this.loomGroup.add(
            this.flares.mesh,
            this.warp.mesh,
            ...this.gimbals.map((g) => g.mesh),
            this.rosette.mesh,
            this.wefts.mesh,
            this.hoop.mesh,
            this.pegs.mesh,
            this.sparks.mesh,
        );
        this.scene.add(this.group);
        this.parts = {
            sky: [this.sky.field, this.sky.jewels],
            rosette: [this.rosette.mesh],
            wefts: [this.wefts.mesh],
            warp: [this.warp.mesh],
            hoop: [this.hoop.mesh, this.pegs.mesh, ...this.gimbals.map((g) => g.mesh)],
            flares: [this.flares.mesh],
            sparks: [this.sparks.mesh],
            dust: this.dust ? [this.dust.mesh] : [],
            motes: this.motes ? [this.motes.mesh] : [],
        };
        this.setLayout(null, this.aspect);
        return this;
    }

    /**
     * Compile the dust simulation off the frame and start it. Resolves to 'ready', 'static' (no
     * simulation on this tier / backend) or the failure status — on failure the dust falls back
     * to its closed-form twin, so there is always dust and never a stalled frame.
     */
    async prepareCompute({ timeoutMs = 6000 } = {}) {
        const { dust } = this;
        if (!dust?.simulated) return 'static';
        let status = 'failed';
        try {
            ({ status } = await compileComputeAsync(this.renderer, dust.computeNodes, { timeoutMs }));
        } catch (error) {
            console.warn('[AstralWeave] Dust compute compile failed:', error);
        }
        if (this.disposed || this.dust !== dust) return 'disposed';
        if (status === 'ready') {
            dust.start(this.renderer);
            return status;
        }
        // Not ready (failed, timed out, device lost): draw the motes at their homes instead.
        const index = this.parts.dust.indexOf(dust.mesh);
        this.loomGroup.remove(dust.mesh);
        dust.dispose();
        this.dust = createDust(this.shared, Math.min(dust.count, DUST_STATIC_MAX), false);
        this.loomGroup.add(this.dust.mesh);
        if (index >= 0) this.parts.dust[index] = this.dust.mesh;
        return status;
    }

    /** Debug: draw only the named parts (sky, rosette, wefts, warp, hoop, flares, sparks, dust, motes). */
    showOnlyParts(names) {
        const keep = new Set(names);
        Object.keys(this.parts).forEach((key) => {
            this.parts[key].forEach((mesh) => {
                mesh.visible = keep.has(key);
            });
        });
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    // ── size + layout ───────────────────────────────────────────────────────────

    /** Drawing-buffer size (pixels) and the CSS aspect. */
    setViewport(bufferWidth, bufferHeight, aspect) {
        const s = this.shared;
        s.uViewport.value.set(Math.max(1, bufferWidth), Math.max(1, bufferHeight));
        s.uPxScale.value = Math.max(0.85, bufferHeight / 1080);
        if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
        s.uAspect.value = this.aspect;
        this.applyLoom();
    }

    /**
     * Seat the loom on the live gameplay rects (screen fractions, from readLayoutRects). `null`
     * keeps the stylesheet's own solo layout, so the loom is already in place before a card shows.
     */
    setLayout(layout, aspect = this.aspect) {
        if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
        const live = layout || fallbackLayout(this.aspect * 1080, 1080);
        solveLoom(this.aspect, live, this.loom);
        this.hasBoard = false;
        for (let i = 0; i < PLAYER_SLOTS; i++) {
            const rect = live.boards?.[i] ?? null;
            this.boards[i] = rect ? boardInLoom(rect, this.aspect, this.loom, this.boards[i] || undefined) : null;
            if (rect && !this.hasBoard) {
                // The first live board owns the weft rows.
                this.hasBoard = true;
                this.primaryPlayer = i;
                Object.assign(this.board, this.boards[i]);
            }
        }
        this.applyLoom();
    }

    applyLoom() {
        const s = this.shared;
        if (!s) return;
        const { cx, cy, radius } = this.loom;
        const scale = radius * VIEW_HEIGHT;
        this.loomGroup.position.set(cx * VIEW_HEIGHT, cy * VIEW_HEIGHT, 0);
        this.loomGroup.scale.setScalar(scale);
        s.uLoom.value.set(cx, cy, radius);
        s.uLoomPx.value = radius * s.uViewport.value.y;
        s.uLamps.value.fromArray(lampPositions(this.aspect, this._lamps));
        s.uBoard.value.set(this.board.left, this.board.width, this.board.top, this.board.rowStep);
        this._heart.x = 0.5 + cx / this.aspect;
        this._heart.y = 0.5 - cy;
    }

    /** The hoop's heart in screen UV (y down), for the post's lens terms. */
    getHeartScreen() {
        return this._heart;
    }

    // ── gameplay ────────────────────────────────────────────────────────────────

    /** Board row (0 = top visible row) → loom-local y of its centre. */
    rowY(row) {
        return this.board.top - (row + 0.5) * this.board.rowStep;
    }

    /** Loom-local y → the nearest board row. */
    rowAt(y) {
        const row = Math.floor((this.board.top - y) / Math.max(1e-4, this.board.rowStep));
        return Math.max(0, Math.min(WEFT_ROWS - 1, row));
    }

    /** A screen position (fractions, y down) → { row, x } on the loom. */
    screenToBoard(sx, sy) {
        const p = screenToLoom(sx, sy, this.aspect, this.loom, this._scratch);
        return { row: this.rowAt(p.y), x: p.x };
    }

    /** True when this player's board is the one the wefts are strung on. */
    isPrimary(player) {
        const p = Number.isFinite(player) ? player : 0;
        return p === this.primaryPlayer || (p <= 1 && this.primaryPlayer <= 1);
    }

    // The director's sink: route each cue by its anchor (a click, the weft board, another board).

    onLock(c) {
        if (c.screen) {
            const at = this.screenToBoard(c.screen.x, c.screen.y);
            this.lock({ rows: [at.row], x: at.x, hardDrop: c.hardDrop });
        } else if (this.isPrimary(c.player)) {
            this.lock(c);
        } else {
            this.echo(c.player, c.rows, c.u, c.hardDrop ? 0.34 : 0.2);
        }
    }

    onClear(c) {
        if (c.screen) {
            const at = this.screenToBoard(c.screen.x, c.screen.y);
            this.clear({ ...c, rows: [at.row] });
        } else if (this.isPrimary(c.player)) {
            this.clear(c);
        } else {
            this.echo(c.player, c.rows, 0.5, 0.4 + 0.12 * Math.min(4, c.lines || 1));
            this.ring(0.3, 1);
        }
    }

    onCombo(combo, player) {
        if (this.isPrimary(player)) this.setCombo(combo);
    }

    /** A perfect clear that settled after its clear (the director's sink.perfect): the crown. */
    onPerfect(c) {
        if (this.isPrimary(c?.player)) this.crownClear();
        else {
            this.echo(c.player, null, 0.5, 0.6);
            this.ring(0.5, 1);
        }
    }

    /** A T-spin that cleared nothing (the director's sink.spin). */
    onSpin(c) {
        if (this.isPrimary(c?.player)) this.spinOnly();
    }

    /**
     * Another local board's event: no weft (the rows belong to the primary board), but the weave
     * is plucked where that board is and the hoop rings from the nearest peg.
     */
    echo(player, rows, u, gain) {
        const board = this.boards[player] || this.board;
        const row = Array.isArray(rows) && rows.length ? rows[0] : WEFT_ROWS - 1;
        const x = board.left + clamp01(u) * board.width;
        const y = board.top - (row + 0.5) * board.rowStep;
        this.pluck(x, y, gain * 2.5);
        this.ripple(Math.atan2(y, x), gain);
        this.energySwell.hit(gain * 0.4, this.time);
    }

    /** Pluck the weave at (x, y): the slot whose ringing has the least light left takes it. */
    pluck(x, y, gain) {
        const slots = this.shared.uPluck.array;
        let weakest = 0;
        let least = Infinity;
        for (let i = 0; i < PLUCK_SLOTS; i++) {
            const age = this.time - slots[i].z;
            const left = age >= 0 ? slots[i].w * Math.exp(-age * PLUCK_FADE) : slots[i].w;
            if (left < least) {
                least = left;
                weakest = i;
            }
        }
        slots[weakest].set(x, y, this.time, gain);
    }

    /**
     * A piece locked.
     * @param {object} c
     * @param {number[]} c.rows   visible board rows the piece occupies (0 = top), at most four
     * @param {number} [c.u]      lock column as a fraction of the board width (0..1)
     * @param {number} [c.x]      …or the lock's loom-local x directly (screen-anchored cues)
     * @param {boolean} [c.hardDrop]
     * @param {number} [c.strength]
     */
    lock({
        rows, u = 0.5, x = null, hardDrop = false, strength = 1,
    } = {}) {
        this.applyPendingShift();
        const list = Array.isArray(rows) && rows.length ? rows : [WEFT_ROWS - 1];
        const lockX = x ?? this.board.left + clamp01(u) * this.board.width;
        const { uWeftA, uWeftB } = this.shared;
        this.shuttleDir = -this.shuttleDir;
        let meanY = 0;
        const n = Math.min(4, list.length);
        for (let i = 0; i < n; i++) {
            const row = Math.max(0, Math.min(WEFT_ROWS - 1, Math.round(list[i])));
            const y = this.rowY(row);
            meanY += y / n;
            const birth = this.time + i * 0.05;
            uWeftA.array[row].set(birth, strength, this.shuttleDir, hardDrop ? 1 : 0);
            uWeftB.array[row].set(-2000, 0, lockX, 1);
            if (Math.abs(y) < 0.98) {
                // The shuttle lands on the hoop: the hoop rings from that peg and a few sparks
                // leave along its flight.
                const half = Math.sqrt(1 - y * y);
                if (i === 0) {
                    this.timers.push({
                        at: birth + SHUTTLE_SECONDS * 0.9,
                        kind: 'ripple',
                        angle: this.shuttleDir > 0 ? Math.asin(y) : PI - Math.asin(y),
                        gain: (hardDrop ? 0.42 : 0.24) * strength,
                    });
                }
                this.timers.push({
                    at: birth + SHUTTLE_SECONDS * 0.92,
                    kind: 'sparks',
                    amount: Math.round((hardDrop ? 9 : 5) * strength),
                    shape: {
                        x: this.shuttleDir * half,
                        y,
                        dirX: this.shuttleDir,
                        dirY: 0,
                        speed: hardDrop ? 0.75 : 0.5,
                        spread: 0.7,
                        life: 0.9,
                        size: 10,
                        hue: 0.05 + (row / WEFT_ROWS) * 0.45,
                        swirl: this.shuttleDir * 0.25,
                    },
                });
            }
        }
        this.pluck(lockX, meanY, (hardDrop ? 1.35 : 0.9) * strength);
        this.energySwell.hit((hardDrop ? 0.2 : 0.11) * strength, this.time);
        if (hardDrop && !this.reducedMotion) this.kickSwell.hit(0.12 * strength, this.time);
        this._lockCue.hardDrop = hardDrop === true;
        this.surge.lock(this._lockCue, this.time);
    }

    /**
     * Lines cleared.
     * @param {object} c
     * @param {number[]} c.rows   the cleared visible board rows (0 = top)
     * @param {number} [c.lines]  1..4 (defaults to rows.length)
     * @param {number} [c.combo]  true consecutive-clear combo after this clear (1 = first)
     * @param {number} [c.cascade] cascade depth of this wave (1 = the lock's own clear)
     * @param {boolean} [c.tspin]
     * @param {boolean} [c.perfect]
     * @param {boolean} [c.b2b]   the second (or later) difficult clear in a row
     * @param {number} [c.strength]
     */
    clear({
        rows, lines, combo = null, cascade = 1, tspin = false, perfect = false, b2b = false, strength = 1,
    } = {}) {
        this.applyPendingShift();
        const list = Array.isArray(rows) && rows.length ? rows : [WEFT_ROWS - 1];
        const n = Math.max(1, Math.min(4, Math.round(lines ?? list.length)));
        // Each cascade wave builds on the last: brighter, more sparks, faster rings (a log
        // curve: wave 2 ×1.17, wave 4 ×1.33, wave 10 ×1.55, instead of a cap at the fourth).
        const depth = Math.max(1, Math.min(12, Math.round(Number(cascade) || 1)));
        const deep = Math.log(depth);
        const gain = strength * (1 + 0.24 * deep);
        const quad = n >= 4 || perfect;
        const { uWeftA, uWeftB } = this.shared;
        let meanY = 0;
        const burnt = [];
        const count = Math.min(4, list.length);
        for (let i = 0; i < count; i++) {
            const row = Math.max(0, Math.min(WEFT_ROWS - 1, Math.round(list[i])));
            burnt.push(row);
            meanY += this.rowY(row) / count;
            // A row with no thread yet still burns: lay it first, then light it.
            if (uWeftA.array[row].y <= 0) uWeftA.array[row].set(this.time - 10, 1, 1, 0);
            uWeftB.array[row].x = this.time;
            uWeftB.array[row].y = gain;
            const y = this.rowY(row);
            const edge = this.board.width * 0.5;
            if (Math.abs(y) < 0.98) {
                const half = Math.sqrt(1 - y * y);
                [-1, 1].forEach((sideSign) => {
                    this.sparks.emit(this.time, Math.round((5 + n * 2) * gain * (1 + 0.2 * deep)), {
                        x: this.board.left + edge + sideSign * edge,
                        y,
                        dirX: sideSign,
                        dirY: 0,
                        speed: (0.9 + n * 0.12) * (1 + 0.1 * deep),
                        spread: 0.55,
                        life: 1.1,
                        size: 11,
                        hue: 0.1 + (row / WEFT_ROWS) * 0.4 + deep * 0.05,
                        swirl: sideSign * 0.3,
                    });
                    this.timers.push({
                        at: this.time + Math.max(0, half - edge) / 2.6,
                        kind: 'sparks',
                        amount: Math.round((4 + n * 2) * gain),
                        shape: {
                            x: sideSign * half, y, speed: 0.55, life: 1.2, size: 12, hue: 0.6, swirl: sideSign * 0.5,
                        },
                    });
                });
            }
        }
        this.pendingShift = { at: this.time + WEFT_SETTLE, rows: burnt };

        // Two fronts leave the hoop where the cleared rows meet it and chase round both ways,
        // after whatever fronts are still running (they take the slots with the least light left).
        const yc = Math.max(-0.95, Math.min(0.95, meanY));
        const hit = Math.asin(yc);
        const sweepGain = (0.55 + 0.16 * n) * gain * (quad ? 1.35 : 1) * (b2b ? 1.2 : 1);
        this.front(hit, sweepGain);
        this.front(PI - hit, sweepGain);
        // A ring through the gas; a cascade's deeper waves send theirs out faster, nested.
        this.ring((0.45 + 0.2 * n) * gain, Math.min(2, 1 + 0.14 * (depth - 1)));
        this.energySwell.hit((0.3 + 0.16 * n) * gain, this.time);
        this.flashSwell.hit((0.12 + 0.07 * n) * gain, this.time);
        if (!this.reducedMotion) this.kickSwell.hit((0.1 + 0.09 * n) * gain, this.time);
        if (combo !== null) this.setCombo(combo);
        if (tspin) {
            // A T-spin wrings the hoop: one quick turn of the whole weave, sprung back.
            this.spinVelocity += (this.shuttleDir > 0 ? 1 : -1) * (this.reducedMotion ? 0.4 : 1.5);
            this.heatFlash = Math.max(this.heatFlash, 0.25);
        }
        if (b2b) {
            // Back-to-back: the gimbals take up gold thread and whirl; the next one in a row
            // laces them brighter still (the swell adds).
            this.laceSwell.hit(n >= 4 ? 1 : 0.75, this.time);
            this.heatFlash = Math.max(this.heatFlash, 0.5);
        }
        const cue = this._clearCue;
        cue.lines = n;
        cue.cascade = depth;
        cue.combo = combo ?? 1;
        cue.tspin = tspin === true;
        cue.perfect = perfect === true;
        cue.b2b = b2b === true;
        this.surge.clear(cue, this.time);
        if (quad) this.startQuad(perfect);
    }

    /**
     * True consecutive-clear combo (0 = the chain broke). A new link weaves its petal at once; a
     * chain that broke unweaves thread by thread (PETAL_STEP a petal), and its heat eases out.
     */
    setCombo(combo) {
        const c = Math.max(0, Math.round(Number.isFinite(combo) ? combo : 0));
        this.combo = c;
        // Pearl to gold over the same links that weave the petals (gold with the last petal).
        this.heatTarget = clamp01((c - 1) / K_COMBO_MAX);
        this.petalTarget = Math.min(K_COMBO_MAX, Math.max(0, c - 1));
        if (this.petalTarget >= this.petals) {
            this.petals = this.petalTarget;
            this.unweaveAt = Infinity;
        } else if (this.unweaveAt === Infinity) {
            this.unweaveAt = this.time + PETAL_STEP * 0.5;
        }
    }

    /** The k the weave rests at right now: the level's figure plus one petal per chained clear. */
    get kTarget() {
        return this.kRest + this.petals;
    }

    startQuad(perfect = false) {
        this.heatFlash = 1;
        this.flashSwell.hit(perfect ? 0.85 : 0.65, this.time);
        if (this.reducedMotion) {
            // No re-weave: the crown and the fronts carry it.
            this.crownSwell.hit(perfect ? 1.4 : 1, this.time);
            return;
        }
        const tau = this.time - this.quadAt;
        const running = this.quadK() !== null;
        if (running && tau < this.quadHold) {
            // A quad inside the quad (a back-to-back, the perfect clear that crowns it): the weave
            // is already gathered or the iris already open. It holds longer and tightens round
            // the board for a beat; it never re-gathers.
            this.quadHold = Math.max(this.quadHold, tau + QUAD.hold * 0.75) + (perfect ? 1.4 : 0);
            this.squeezeSwell.hit(perfect ? 1 : 0.65, this.time);
            const at = Math.max(this.time + 0.08, this.quadAt + QUAD.gather);
            this.crownSwell.hit(perfect ? 1.2 : 0.8, at);
            this.timers.push({
                at,
                kind: 'sparks',
                amount: perfect ? 120 : 70,
                shape: {
                    x: 0, y: 1, speed: 1.5, life: 1.9, size: 15, hue: 0.12, swirl: 0.35, jitter: 0.05,
                },
            });
            return;
        }
        // From rest, or while the petals bloom back: gather from wherever the weave is now, the
        // iris's circle carried on from where it was (no jump in the phase).
        const crownAt = this.time + QUAD.gather;
        this.crownSwell.hit(perfect ? 1.4 : 1, crownAt);
        this.irisStart = running ? this.irisRadius() : IRIS.to;
        this.quadAt = this.time;
        this.quadFrom = this.k;
        this.quadHold = perfect ? QUAD.hold + 1.4 : QUAD.hold;
        this.irisFrom = perfect ? IRIS.perfectFrom : IRIS.from;
        this.timers.push({
            at: crownAt,
            kind: 'sparks',
            amount: perfect ? 150 : 90,
            shape: {
                x: 0, y: 1, speed: 1.5, life: 1.9, size: 15, hue: 0.12, swirl: 0.35, jitter: 0.05,
            },
        });
    }

    /**
     * A perfect clear that settled after its clear (physics sends it ~360 ms after the last
     * wave): the CROWN on the quad still playing (it holds longer and tightens, the crown burns
     * brighter), or an iris of its own after a smaller clear. Never a clear of its own: no row
     * burns, nothing restarts. The whole hoop answers, from the crown and the base.
     */
    crownClear() {
        this.startQuad(true);
        this.front(PI * 0.5, 1.1);
        this.front(-PI * 0.5, 1.1);
        this.ring(1.3, 1.25);
        this.energySwell.hit(0.6, this.time);
        this.surge.crown(this.time);
    }

    /** A T-spin that cleared nothing: a small wring of the hoop. */
    spinOnly() {
        this.spinVelocity += (this.shuttleDir > 0 ? 1 : -1) * (this.reducedMotion ? 0.2 : 0.6);
        this.heatFlash = Math.max(this.heatFlash, 0.12);
        this.energySwell.hit(0.15, this.time);
        this.surge.spin(this.time);
    }

    /**
     * LEVEL_UP: each level rests on a richer figure (2, 3, 4, then 5 petals from level 4 on: a
     * level-up never takes petals away).
     */
    levelUp(level) {
        const n = Number.isFinite(level) ? Math.max(1, Math.round(level)) : 2;
        this.kRest = K_REST + Math.min(3, n - 1);
        this.ripple(-PI / 2, 0.9);
        this.energySwell.hit(0.5, this.time);
        this.surge.levelUp(this.time);
    }

    /** Ring the hoop from one peg: a front runs both ways round it (locks, level-ups). */
    ripple(angle, gain) {
        this.front(angle, gain);
    }

    /** A front leaving the hoop at `angle`: it takes the slot with the least light left. */
    front(angle, gain) {
        const slots = this.shared.uSweep.array;
        let weakest = 0;
        let least = Infinity;
        for (let i = 0; i < SWEEP_SLOTS; i++) {
            const S = slots[i];
            const age = this.time - S.y;
            const left = S.z > 0 && age >= 0 ? S.z * Math.exp(-age * SWEEP_FADE) : 0;
            if (left < least) {
                least = left;
                weakest = i;
            }
        }
        slots[weakest].set(angle, this.time, gain, gain);
    }

    /** A ring of excited gas out from the hoop's heart: the slot with the least light left takes it. */
    ring(gain, speed = 1) {
        let weakest = 0;
        let least = Infinity;
        for (let i = 0; i < SHOCK_SLOTS; i++) {
            const age = this.time - this.shockAt[i];
            const left = age >= 0 ? this.shockGain[i] * Math.exp(-age * SHOCK_FADE) : 0;
            if (left < least) {
                least = left;
                weakest = i;
            }
        }
        this.shockAt[weakest] = this.time;
        this.shockGain[weakest] = gain;
        this.shockSpeed[weakest] = speed;
    }

    /** A new run: an empty tapestry on the resting weave. */
    resetSession() {
        const { uWeftA, uWeftB } = this.shared;
        for (let i = 0; i < WEFT_SLOTS; i++) {
            uWeftA.array[i].set(-1000, 0, 1, 0);
            uWeftB.array[i].set(-2000, 0, 0, 0);
        }
        this.pendingShift = null;
        this.timers.length = 0;
        this.setCombo(0);
        this.kRest = K_REST;
        this.quadAt = -1000;
    }

    /**
     * Drop the burnt rows out of the tapestry: everything above them moves down, as the stack did.
     * Runs when the burn has settled, or earlier when the next lock or cascade wave needs the rows
     * where the board has them: a row still burning then finishes its burn as an ember, where it was.
     */
    applyPendingShift() {
        const shift = this.pendingShift;
        if (!shift) return;
        this.pendingShift = null;
        const { uWeftA, uWeftB } = this.shared;
        for (let i = 0; i < shift.rows.length; i++) this.keepEmber(shift.rows[i]);
        const gone = shift.rows;
        let write = WEFT_ROWS - 1;
        for (let read = WEFT_ROWS - 1; read >= 0; read--) {
            if (gone.includes(read)) continue;
            if (write !== read) {
                uWeftA.array[write].copy(uWeftA.array[read]);
                uWeftB.array[write].copy(uWeftB.array[read]);
            }
            write -= 1;
        }
        for (; write >= 0; write--) {
            uWeftA.array[write].set(-1000, 0, 1, 0);
            uWeftB.array[write].set(-2000, 0, 0, 0);
        }
    }

    /** A burning row leaves the tapestry: its burn carries on in an ember slot (the oldest gives way). */
    keepEmber(row) {
        const { uWeftA, uWeftB, uEmber } = this.shared;
        const A = uWeftA.array[row];
        const B = uWeftB.array[row];
        if (!(A.y > 0) || !(B.x >= A.x) || this.time - B.x >= EMBER_LIFE) return;
        let slot = 0;
        let oldest = Infinity;
        for (let i = 0; i < EMBER_SLOTS; i++) {
            const at = uWeftA.array[WEFT_ROWS + i].y > 0 ? uWeftB.array[WEFT_ROWS + i].x : -Infinity;
            if (at < oldest) {
                oldest = at;
                slot = i;
            }
        }
        uWeftA.array[WEFT_ROWS + slot].copy(A);
        uWeftB.array[WEFT_ROWS + slot].copy(B);
        uEmber.array[slot].x = row;
    }

    /** Embers whose burn is spent go back to sleep. */
    retireEmbers() {
        const { uWeftA, uWeftB } = this.shared;
        for (let i = WEFT_ROWS; i < WEFT_SLOTS; i++) {
            if (uWeftA.array[i].y > 0 && this.time - uWeftB.array[i].x >= EMBER_LIFE) {
                uWeftA.array[i].set(-1000, 0, 1, 0);
                uWeftB.array[i].set(-2000, 0, 0, 0);
            }
        }
    }

    // ── time ────────────────────────────────────────────────────────────────────

    /** Jump to an idle frame at absolute time `t` (captures): no events in flight. */
    seek(t) {
        const keepRest = this.kRest;
        this.time = Math.max(0, t);
        this.resetState();
        const s = this.shared;
        for (let i = 0; i < PLUCK_SLOTS; i++) s.uPluck.array[i].set(0, 0, -1000, 0);
        for (let i = 0; i < SWEEP_SLOTS; i++) s.uSweep.array[i].set(0, -1000, 0, 0);
        this.resetSession();
        this.kRest = keepRest;
        this.k = this.kTarget;
        this.kFree = this.k;
        // The clocks the world runs faster as play heats start on the world clock.
        const calm = this.reducedMotion ? 0.3 : 1;
        this.gimbalTurn[0] = this.time * 0.05 * calm;
        this.gimbalTurn[1] = this.time * -0.034 * calm;
        this.sparks.reset();
        this.pushWeave();
        this.dust?.reseat(this.renderer);
    }

    /** Write k and its phase (the dust reads them when it is reseated). */
    pushWeave(breath = 0) {
        const s = this.shared;
        const running = this.quadK() !== null;
        const radius = Math.max(0.02, (running ? this.irisRadius() : IRIS.to) - this.squeeze * IRIS_SQUEEZE);
        s.uK.value = this.k + breath;
        s.uPhase.value = phaseForK(this.k, irisPhase(radius));
        s.uTime.value = this.time;
    }

    /** k along the quad timeline, or null when no quad is running. */
    quadK() {
        const tau = this.time - this.quadAt;
        if (tau < 0) return null;
        const openStart = QUAD.gather + QUAD.dwell;
        if (tau < QUAD.gather) {
            const g = tau / QUAD.gather;
            return this.quadFrom * (1 - g * g);
        }
        if (tau < openStart) return 0;
        if (tau < openStart + QUAD.open) {
            const o = 1 - (tau - openStart) / QUAD.open;
            return K_IRIS * (1 - o * o * o);
        }
        if (tau < this.quadHold) return K_IRIS;
        if (tau < this.quadHold + QUAD.relax) {
            // It blooms into the free weave (which follows the chain all along), so a petal the
            // chain adds or unweaves meanwhile never makes k jump.
            return K_IRIS + (this.kFree - K_IRIS) * smoother((tau - this.quadHold) / QUAD.relax);
        }
        return null;
    }

    /**
     * The iris radius right now: it carries on from the last circle while the weave gathers, then
     * opens from a sunburst to its halo while the quad holds.
     */
    irisRadius() {
        const tau = this.time - this.quadAt;
        if (tau < QUAD.gather) return this.irisStart + (this.irisFrom - this.irisStart) * smoother(tau / QUAD.gather);
        return this.irisFrom + (IRIS.to - this.irisFrom) * smoother((tau - QUAD.gather - QUAD.dwell) / 1.5);
    }

    updateCamera(camera, sim) {
        const t = sim.time;
        const calm = this.reducedMotion ? 0.25 : 1;
        const px = (sim.pointerX || 0) * 0.16 * calm;
        const py = (sim.pointerY || 0) * 0.1 * calm;
        const x = Math.sin(t * 0.071) * 0.13 * calm + px;
        const y = Math.sin(t * 0.093 + 0.7) * 0.08 * calm - py;
        const push = this.kick * 0.42;
        camera.position.set(x, y, REST_RIG.distance - push);
        camera.up.set(Math.sin(Math.sin(t * 0.05) * 0.006 * calm), 1, 0);
        camera.lookAt(0, 0, 0);
        // The shared breath (shared/camera-breath.js) on top of the drift above, turning back
        // toward the loom at the origin: fully off under reduced motion (the drift keeps 25%).
        applyCameraBreath(camera, t, { distance: camera.position.length(), scale: this.reducedMotion ? 0 : 1 });
        camera.updateMatrixWorld();
        // The gas also drifts with time; what is authored in the frame (jewels, lamps, near motes)
        // takes the camera's parallax alone.
        this.shared.uParallax.value.set(x * -0.011, y * -0.011);
        this.shared.uSkyShift.value.set(x * -0.011 + t * 0.00035, y * -0.011);
    }

    update(sim) {
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const t = this.time;
        const s = this.shared;
        const calm = this.reducedMotion ? 0.3 : 1;

        // Due timers (delayed sparks). Kept sorted enough: the list is tiny.
        if (this.timers.length) {
            for (let i = this.timers.length - 1; i >= 0; i--) {
                const timer = this.timers[i];
                if (t < timer.at) continue;
                this.timers.splice(i, 1);
                if (timer.kind === 'sparks') {
                    this.sparks.emit(t, this.reducedMotion ? Math.ceil(timer.amount * 0.4) : timer.amount, timer.shape);
                } else if (timer.kind === 'ripple') {
                    this.ripple(timer.angle, timer.gain);
                }
            }
        }
        if (this.pendingShift && t >= this.pendingShift.at) this.applyPendingShift();
        this.retireEmbers();
        this.sparks.flush();

        // ── a broken chain unweaves one petal at a time ──
        while (this.petals > this.petalTarget && t >= this.unweaveAt) {
            this.petals -= 1;
            this.unweaveAt += PETAL_STEP;
        }
        if (this.petals <= this.petalTarget) this.unweaveAt = Infinity;

        // ── the envelopes: everything an event lit, as of now ──
        this.energy = this.energySwell.valueAt(t);
        this.flash = this.flashSwell.valueAt(t);
        this.kick = this.kickSwell.valueAt(t);
        this.crown = this.crownSwell.valueAt(t);
        this.squeeze = this.squeezeSwell.valueAt(t);
        this.lace = this.laceSwell.valueAt(t);
        // How hot play runs. `warm` is nothing below a level of 0.2 (calm play looks as it
        // always has) and all of it at 0.8; `fever` fills only while the heat is sustained.
        const play = this.surge.sample(t);
        this.play.punch = play.punch;
        this.play.level = play.level;
        this.play.fever = play.fever;
        this.play.stage = play.stage;
        const warm = smoother((play.level - 0.2) / 0.6);
        const { fever } = play;
        this.warm = warm;

        // ── k: the free weave springs toward its figure; the quad timeline owns k while it runs ──
        if (dt > 0) {
            const target = this.kTarget;
            const c1 = this.kFree - target;
            const c2 = this.kVelocity + K_SPRING * c1;
            const e = Math.exp(-K_SPRING * dt);
            this.kFree = target + (c1 + c2 * dt) * e;
            this.kVelocity = (c2 - K_SPRING * (c1 + c2 * dt)) * e;
        }
        const quadK = this.quadK();
        if (quadK !== null) this.k = quadK;
        else {
            this.quadAt = -1000;
            this.k = this.kFree;
        }
        const settled = quadK === null && Math.abs(this.k - this.kTarget) < 0.05;
        const breath = settled ? Math.sin(t * 0.19) * 0.014 * calm : 0;
        this.pushWeave(breath);

        // ── eased scalars ──
        if (dt > 0) {
            const rate = this.heatTarget > this.heat ? 2.4 : 0.55;
            this.heat += (this.heatTarget - this.heat) * approach(rate, dt);
            this.heatFlash *= Math.exp(-dt * 0.5);
            // The hoop's spin: a sprung turn (T-spins) on top of a slow sway.
            const w = 3.4;
            const c1 = this.spin;
            const c2 = this.spinVelocity + w * c1;
            const e = Math.exp(-w * dt);
            this.spin = (c1 + c2 * dt) * e;
            this.spinVelocity = (c2 - w * (c1 + c2 * dt)) * e;
            if (!this.capture) this.fade = Math.min(1, this.fade + dt / 1.4);
        }
        // The gathered weave and the iris are gold; the gold drains as the petals bloom back.
        const quadTau = t - this.quadAt;
        const quadHeat = quadK !== null
            ? clamp01((quadTau - QUAD.gather * 0.5) / 0.4) * (1 - smoother((quadTau - this.quadHold) / QUAD.relax))
            : 0;
        // Hot play warms the weave and the nebula toward rose; a fever carries them to gold.
        const surgeHeat = warm * 0.5 + fever * 0.5;
        const heat = clamp01(Math.max(this.heat, this.heatFlash * 0.9, quadHeat, surgeHeat));
        // The weave hums with the pace: shimmer, flow, warp, hoop, pegs, dust, motes.
        const energy = this.energy + warm * 0.35 + fever * 0.45;
        const { crown } = this;

        // The loom spins up: the beads flow and the comets run faster, the gimbals turn faster
        // (faster still while a back-to-back laces them), the carousel orbits in a fever. Each
        // is a clock stepped by its rate, so a change of pace never throws anything along.
        this.flowPhase += dt * (1 + energy * 1.2);
        this.runPhase += dt * (1 + (warm * 0.9 + fever * 2.2) * calm);
        this.carouselAngle += dt * (0.55 + fever * 1.3) * calm;
        const whirl = 1 + warm * 1.5 + fever * 4 + this.lace * 5;
        this.gimbalTurn[0] += dt * 0.05 * calm * whirl;
        this.gimbalTurn[1] -= dt * 0.034 * calm * whirl;

        s.uTime.value = t;
        s.uHeat.value = heat;
        s.uEnergy.value = energy;
        s.uCrown.value = crown;
        s.uCore.value = 0.62 + this.energy * 0.5 + heat * 0.45 + crown * 1.2;
        s.uFade.value = this.fade * this.fade * (3 - 2 * this.fade);
        s.uSpin.value = this.spin + Math.sin(t * 0.043) * 0.09 * calm;
        // The warp winds tighter as play heats.
        s.uWarpTwist.value = 0.52 + Math.sin(t * 0.061) * 0.14 * calm + this.energy * 0.05 + warm * 0.08 + fever * 0.12;
        s.uFlow.value = this.flowPhase;
        s.uRun.value = this.runPhase;
        // The gimbals take up gold in a fever too (a back-to-back laces them brighter).
        s.uLace.value = Math.min(1.3, Math.max(this.lace, fever * 0.6));
        s.uCarousel.value.set(this.carouselAngle, warm * 0.05 + fever * 0.5, 0, 0);

        // The fronts: the light each has left (the shaders read it, the next front reads it to
        // pick the weakest slot).
        const sweeps = s.uSweep.array;
        for (let i = 0; i < SWEEP_SLOTS; i++) {
            const S = sweeps[i];
            const age = t - S.y;
            S.w = S.z > 0 && age >= 0 ? S.z * Math.exp(-age * SWEEP_FADE) : 0;
        }
        // The rings through the gas; each flares the lamps in the gas as it passes them (where a
        // lamp is drawn: parallax only), and the lamps burn steadily brighter as play heats.
        const [l1x, l1y, l2x, l2y] = this._lamps;
        const { x: px, y: py } = s.uParallax.value;
        const lampFloor = 1 + warm * 0.3 + fever * 0.9;
        let flare1 = lampFloor;
        let flare2 = lampFloor;
        for (let i = 0; i < SHOCK_SLOTS; i++) {
            const age = t - this.shockAt[i];
            let radius = 0;
            let gain = 0;
            if (age >= 0 && this.shockGain[i] > 0) {
                radius = 0.2 + age * SHOCK_SPEED * this.shockSpeed[i];
                gain = this.shockGain[i] * Math.exp(-age * SHOCK_FADE);
                flare1 += lampFlare(l1x - px, l1y - py, this.loom, radius, gain) - 1;
                flare2 += lampFlare(l2x - px, l2y - py, this.loom, radius, gain) - 1;
            }
            s.uShockR.value.setComponent(i, radius);
            s.uShockG.value.setComponent(i, gain);
        }
        s.uLampFlare.value.set(flare1, flare2);

        // ── the loom's own slow life ──
        this.loomGroup.rotation.set(
            Math.sin(t * 0.13) * 0.06 * calm - (sim.pointerY || 0) * 0.03 * calm,
            Math.sin(t * 0.097 + 1.3) * 0.085 * calm + (sim.pointerX || 0) * 0.04 * calm,
            0,
        );
        if (this.gimbals[0]) {
            this.gimbals[0].mesh.rotation.set(0.24 + Math.sin(t * 0.07) * 0.05, 0.1, this.gimbalTurn[0]);
        }
        if (this.gimbals[1]) {
            this.gimbals[1].mesh.rotation.set(0.08, 0.3 + Math.sin(t * 0.05 + 2) * 0.06, this.gimbalTurn[1] + 0.8);
        }
        this.dust?.step(this.renderer, dt);
    }

    /**
     * The post stack's per-frame values (reused object): the event flash and kick, and as play
     * heats a little more bloom with the iris closing a touch, so the colours stay saturated
     * and the deep sky stays deep. The crown's bloom is sudden: Reduce flashing scales it
     * (ADR-0021; the post scales the flash itself).
     */
    getPostState() {
        const out = this._post;
        const { fever } = this.play;
        out.heart = this._heart;
        out.flash = this.flash;
        out.kick = this.kick;
        out.bloomBoost = this.warm * 0.1 + fever * 0.25 + Math.min(1, this.crown) * 0.25 * flashScale();
        out.exposure = 1 - this.warm * 0.06 - fever * 0.08;
        return out;
    }

    /** Diagnostics for captures and tests. */
    getState() {
        return {
            k: this.k,
            kTarget: this.kTarget,
            combo: this.combo,
            heat: this.heat,
            energy: this.energy,
            quad: this.quadK() !== null,
            loom: { ...this.loom },
            board: { ...this.board },
            hasBoard: this.hasBoard,
            wefts: this.shared.uWeftA.array.slice(0, WEFT_ROWS).filter((v) => v.y > 0).length,
            embers: this.shared.uWeftA.array.slice(WEFT_ROWS).filter((v) => v.y > 0).length,
            play: { ...this.play },
            dust: this.dust ? { count: this.dust.count, simulated: this.dust.simulated, ready: this.dust.ready } : null,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.group.removeFromParent();
        [
            this.sky, this.rosette, this.wefts, this.warp, this.hoop, this.pegs, this.flares, this.sparks, this.dust,
            this.motes, ...this.gimbals,
        ].forEach((part) => part?.dispose());
        this.noiseTex?.dispose();
        this.timers.length = 0;
    }
}
