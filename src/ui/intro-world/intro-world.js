/**
 * First Light — the world behind the opening, the title and the main menu.
 *
 * The parts (sky, veils, pieces, motes) are built once; this class owns their shared uniforms
 * and directs them:
 *   - the clocks: time, the breath, and the rise clock (the breath's integral) that paces
 *     everything that ascends;
 *   - the opening: from the frame the loading screen paints (low in the light, the veils not
 *     yet drawn) the eye rises and draws back while the veils unfurl, the pieces rise past and a
 *     wave of light leaves the logo;
 *   - the modes: the title (a halo behind the wordmark, pieces clear of it) and the menu (the
 *     light lower, calmer; pieces clear of the navigation), blended over a second and a half;
 *   - the player's touch: the pointer's parallax, a click that spins and lights a piece, the
 *     begin wave when the title is dismissed.
 * Everything is a function of time except what the player does, so `seek(t)` reproduces any
 * moment of the opening (the playground's fixed-time captures).
 */

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
    OPENING_RISE,
    OPENING_SECONDS,
    PIECE_KEYS,
    STACK,
    STACK_FITS,
    axisAngle,
    breathAt,
    buildPieceField,
    cameraPoseAt,
    chooseStackPair,
    clamp01,
    easeInOutCubic,
    easeOutCubic,
    openingState,
    pieceAt,
    presenceAt,
    qMul,
    qRotate,
    qSlerp,
    riseClock,
    smoothstep,
    stackPhase,
    stackSlot,
} from './intro-world-core.js';
import { bakeGrainTexture } from './intro-world-tsl.js';
import { createSky } from './intro-world-sky.js';
import { createVeils } from './intro-world-veils.js';
import { createPieces } from './intro-world-pieces.js';
import { createMotes } from './intro-world-motes.js';

/** Content per tier (the intro renderer maps its HIGH / MEDIUM / LOW budget onto these). */
export const WORLD_TIERS = Object.freeze({
    High: {
        pieces: 21, motes: 1800, grain: true, bevel: 3, post: 'High', dprCap: 2,
    },
    Medium: {
        pieces: 18, motes: 1100, grain: true, bevel: 2, post: 'Medium', dprCap: 1.5,
    },
    Low: {
        pieces: 14, motes: 600, grain: false, bevel: 1, post: 'Low', dprCap: 1,
    },
});

const MODE_SECONDS = 1.6;
const BEGIN_WAVE_SECONDS = 1.7;
const CLICK_SPIN = Math.PI * 0.9;

const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

export class IntroWorld {
    /**
     * @param {{ quality?: 'High'|'Medium'|'Low', seed?: number }} [options]
     */
    constructor({ quality = 'High', seed = 7 } = {}) {
        this.tierName = WORLD_TIERS[quality] ? quality : 'High';
        this.tier = WORLD_TIERS[this.tierName];
        this.seed = seed;
        this.u = {
            time: uniform(0),
            breath: uniform(0),
            rise: uniform(0),
            aspect: uniform(16 / 9),
            light: uniform(new THREE.Vector4(0, 1, 1, 1)),
            haloDir: uniform(new THREE.Vector3(0, 0.02, -1)),
            unfurl: uniform(1),
            veilGain: uniform(1),
            moteGain: uniform(1),
        };
        this.time = 0;
        this.riseBase = 0;
        this.lanes = buildPieceField({ count: this.tier.pieces, seed });
        this.presence = new Float32Array(this.lanes.length).fill(1);
        this.flash = new Float32Array(this.lanes.length);
        this.spinBase = new Float32Array(this.lanes.length);
        this.spinKick = this.lanes.map(() => null);
        this.pushKick = this.lanes.map(() => null);
        this.viewport = {
            width: 1920, height: 1080, aspect: 16 / 9,
        };
        // Opening: null = not begun (the frame under the loading screen); else its start and length.
        this.opening = null;
        this.mode = 'title';
        this.menuBlend = 0;
        this.menuFrom = 0;
        this.menuAt = -Infinity;
        this.pointer = { x: 0, y: 0 };
        this.pointerTarget = { x: 0, y: 0 };
        this.audio = 0;
        this.motion = 1;
        this.motionTarget = 1;
        this.titleRect = null;
        this.avoidRects = [];
        this.calmRects = [];
        this.beginWave = null;
        this.logoOrigin = { x: 0.5, y: 0.47 };
        this.camera = null;
        this.parts = [];
        this._ndc = new THREE.Vector3();
        this._dir = new THREE.Vector3();
        this._lastPose = null;
    }

    /** Build the parts into `scene`. */
    build(scene) {
        this.scene = scene;
        this.grain = bakeGrainTexture(128);
        this.sky = createSky(this.u, this.grain, { grain: this.tier.grain });
        this.veils = createVeils(this.u, this.grain);
        const perShape = Math.ceil(this.lanes.length / 7) + 2;
        this.pieces = createPieces(this.u, { count: perShape, bevel: this.tier.bevel });
        this.motes = createMotes(this.u, { count: this.tier.motes });
        this.parts = [this.sky, this.veils, this.pieces, this.motes];
        for (const p of this.parts) scene.add(p.mesh);
        return this;
    }

    bindCamera(camera) {
        this.camera = camera;
        camera.near = 0.1;
        camera.far = 1200;
        this.updateCamera();
    }

    setViewport(width, height) {
        if (!(width > 0 && height > 0)) return;
        this.viewport = { width, height, aspect: width / height };
        this.u.aspect.value = this.viewport.aspect;
        if (this.camera) {
            this.camera.aspect = this.viewport.aspect;
            this.camera.updateProjectionMatrix();
        }
    }

    /** The wordmark's rect in CSS pixels (or null): the halo stands behind it, pieces keep clear. */
    setTitleRect(rect) {
        this.titleRect = rect && rect.width > 0 && rect.height > 0 ? { ...rect } : null;
    }

    /** Screen-fraction rects (y down) the pieces must keep out of (the menu's navigation…). */
    setAvoidRects(rects) {
        this.avoidRects = Array.isArray(rects) ? rects.filter(Boolean) : [];
    }

    /** Screen-fraction rects (y down) whose light the post softens, with a level each. */
    setCalmRects(rects) {
        this.calmRects = Array.isArray(rects) ? rects.filter(Boolean) : [];
    }

    setPointer(x, y) {
        this.pointerTarget.x = Math.max(-1, Math.min(1, x || 0));
        this.pointerTarget.y = Math.max(-1, Math.min(1, y || 0));
    }

    setAudio(level) {
        this.audio = Math.max(0, Math.min(1, level || 0));
    }

    setReducedMotion(reduced, immediate = false) {
        this.motionTarget = reduced ? 0.12 : 1;
        if (immediate) this.motion = this.motionTarget;
    }

    /** 'title' or 'menu'. Immediate skips the blend (a return to the menu). */
    setMode(mode, { immediate = false } = {}) {
        const next = mode === 'menu' ? 'menu' : 'title';
        if (next === this.mode && !immediate) return;
        this.mode = next;
        this.menuFrom = this.menuBlend;
        this.menuAt = this.time;
        if (immediate) {
            this.menuBlend = next === 'menu' ? 1 : 0;
            this.menuAt = -Infinity;
        }
    }

    /** Has the opening begun (or been skipped)? */
    get opened() {
        return this.opening !== null;
    }

    /**
     * Begin the opening now. `durationMs` is the loading screen's own dissolve (the world takes a
     * little longer to settle); `origin` the logo's centre (screen fraction, y down).
     */
    beginOpening({ durationMs = 3200, origin = null } = {}) {
        if (this.opening) return;
        const seconds = Math.max(OPENING_SECONDS, (durationMs / 1000) * 1.55);
        if (origin) this.logoOrigin = { x: origin.x, y: origin.y };
        this.opening = { at: this.time, seconds };
    }

    /** Skip the opening (a return to the menu, a reveal with no cover). */
    finishOpening() {
        this.opening = { at: this.time - 1000, seconds: OPENING_SECONDS };
    }

    /** The player began: a wave of light leaves the title's centre (screen fraction, y down). */
    pulseBegin(origin = null) {
        const o = origin || this.titleCentre() || { x: 0.5, y: 0.47 };
        this.beginWave = { at: this.time, x: o.x, y: o.y };
        // Everything takes a small breath outward and the pieces catch the light.
        this.lanes.forEach((_, i) => { this.flash[i] = Math.max(this.flash[i], 0.35); });
    }

    titleCentre() {
        if (!this.titleRect) return null;
        const r = this.titleRect;
        return {
            x: (r.x + r.width / 2) / this.viewport.width,
            y: (r.y + r.height / 2) / this.viewport.height,
        };
    }

    openingProgress() {
        if (!this.opening) return 0;
        return clamp01((this.time - this.opening.at) / this.opening.seconds);
    }

    /** A click at a point (NDC, y up): the nearest piece under it spins and lights. */
    pick(ndcX, ndcY) {
        if (!this.camera || !this._piecesNow) return false;
        let best = -1;
        let bestD = Infinity;
        for (let i = 0; i < this._piecesNow.length; i++) {
            const p = this._piecesNow[i];
            if (!p || p.presence < 0.5) continue;
            const dx = (p.ndcX - ndcX) * this.viewport.aspect;
            const dy = p.ndcY - ndcY;
            const d = Math.hypot(dx, dy);
            if (d < p.ndcRadius * 1.25 && d < bestD) {
                best = i;
                bestD = d;
            }
        }
        if (best < 0) return false;
        const p = this._piecesNow[best];
        this.flash[best] = 1;
        this.settleKick(best);
        this.spinKick[best] = { at: this.time, amount: CLICK_SPIN * (Math.random() < 0.5 ? -1 : 1) };
        // Pushed away from the click, a little, and back.
        const dx = p.ndcX - ndcX;
        const dy = p.ndcY - ndcY;
        const len = Math.hypot(dx, dy) || 1;
        this.pushKick[best] = { at: this.time, x: (dx / len) * 1.4, y: (dy / len) * 1.4 + 0.6 };
        return true;
    }

    settleKick(i) {
        const kick = this.spinKick[i];
        if (kick) {
            this.spinBase[i] += kick.amount * easeOutCubic((this.time - kick.at) / 1.6);
            this.spinKick[i] = null;
        }
    }

    // ── The frame ───────────────────────────────────────────────────────────────

    /** Advance by dt seconds (clamped) and pose everything. */
    update(dt) {
        const step = Math.max(0, Math.min(dt || 0, 1 / 20));
        // The rise is integrated, not a clock times a pace: the pace changes (reduced motion).
        this.riseBase += (riseClock(this.time + step) - riseClock(this.time)) * (0.35 + 0.65 * this.motion);
        this.time += step;
        this.pointer.x = damp(this.pointer.x, this.pointerTarget.x, 2.2, step);
        this.pointer.y = damp(this.pointer.y, this.pointerTarget.y, 2.2, step);
        this.motion = damp(this.motion, this.motionTarget, 2.5, step);
        for (let i = 0; i < this.flash.length; i++) this.flash[i] *= Math.exp(-step * 2.4);
        this.pose(step, false);
    }

    /**
     * Jump to time t (deterministic). `opening` (seconds since the opening began, or null for
     * none yet) and `menu` (0..1) place the moment; presence is evaluated directly.
     */
    seek(t, { opening = undefined, menu = undefined } = {}) {
        this.time = Math.max(0, t);
        if (opening === null) this.opening = null;
        else if (Number.isFinite(opening)) this.opening = { at: this.time - opening, seconds: OPENING_SECONDS };
        if (Number.isFinite(menu)) {
            this.menuBlend = clamp01(menu);
            this.mode = menu >= 0.5 ? 'menu' : 'title';
            this.menuAt = -Infinity;
        }
        this.pointer = { ...this.pointerTarget };
        this.motion = this.motionTarget;
        this.riseBase = riseClock(this.time) * (0.35 + 0.65 * this.motion);
        this.pose(0, true);
    }

    pose(step, direct) {
        const { u } = this;
        const t = this.time;
        const breath = breathAt(t);
        const open = this.opening ? openingState(this.openingProgress()) : openingState(0);
        // The menu blend runs on its own clock (from wherever it was).
        if (Number.isFinite(this.menuAt)) {
            const k = easeInOutCubic((t - this.menuAt) / MODE_SECONDS);
            const target = this.mode === 'menu' ? 1 : 0;
            this.menuBlend = this.menuFrom + (target - this.menuFrom) * k;
            if (k >= 1) this.menuAt = -Infinity;
        }
        const menu = this.menuBlend;

        u.time.value = t;
        u.breath.value = breath;
        // While the world opens everything rises past a little faster (it starts lower).
        const extraRise = OPENING_RISE * (open.rise - 1) * Math.max(0.2, this.motion);
        u.rise.value = this.riseBase + extraRise * 0.7;
        u.unfurl.value = open.unfurl;
        // The world is luminous from its first frame (the eye starts in the light below); the
        // opening adds the veils, the halo and the last of the light.
        u.veilGain.value = (0.7 + 0.3 * open.light) * (1 - 0.3 * menu);
        u.moteGain.value = (0.7 + 0.3 * open.light) * (1 - 0.25 * menu) * (1 + this.audio * 0.35);
        const haloGain = (1 - menu) * open.halo * (this.titleRect ? 1 : 0.6);
        const hazeGain = (0.85 + 0.15 * open.light) * (1 - 0.18 * menu);
        u.light.value.set(breath, hazeGain, haloGain * (1 + this.audio * 0.4), 0.7 + 0.3 * open.light);

        this.updateCamera(open, breath, menu);
        this.updateHalo();
        this.posePieces(open, breath, menu, step, direct);
        this.sky.follow(this.camera);
    }

    updateCamera(open = openingState(this.opened ? 1 : 0), breath = breathAt(this.time), menu = this.menuBlend) {
        const cam = this.camera;
        if (!cam) return;
        const pose = cameraPoseAt({
            travel: open.travel,
            menu,
            breath,
            time: this.time,
            pointerX: this.pointer.x,
            pointerY: this.pointer.y,
            motion: this.motion,
        });
        cam.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
        cam.up.set(0, 1, 0);
        cam.lookAt(pose.look[0], pose.look[1], pose.look[2]);
        if (Math.abs(cam.fov - pose.fov) > 1e-4) {
            cam.fov = pose.fov;
            cam.updateProjectionMatrix();
        }
        cam.updateMatrixWorld();
        this._lastPose = pose;
    }

    /** The halo looks at the title's centre through the live camera. */
    updateHalo() {
        const centre = this.titleCentre() || { x: 0.5, y: 0.46 };
        this._ndc.set(centre.x * 2 - 1, 1 - centre.y * 2, 0.5).unproject(this.camera);
        this._dir.copy(this._ndc).sub(this.camera.position).normalize();
        this.u.haloDir.value.copy(this._dir);
    }

    /**
     * The stack in progress, if any: which two lanes, how far joined, the lock's flash, and the
     * turn they meet in. Every third breath on the title, every sixth behind the menu (and only
     * on its right, clear of the navigation); never during the opening or under reduced motion.
     */
    stackNow(menu) {
        const slot = stackSlot(this.time);
        if (!slot || !this.opening || this.openingProgress() < 1 || this.motion < 0.5) return null;
        const inMenu = menu > 0.5;
        if (inMenu && slot.k % 2 === 1) return null;
        if (!this._stackCache || this._stackCache.k !== slot.k || this._stackCache.inMenu !== inMenu) {
            // Behind the menu always on the right (the navigation is on the left); on the title the
            // sides take turns.
            let side = slot.k % 2 === 0 ? 1 : -1;
            if (inMenu) side = 1;
            const pair = chooseStackPair(this.lanes, { start: slot.start, aspect: this.viewport.aspect, side });
            const tilt = slot.k % 2 === 0 ? 0.32 : -0.32;
            this._stackCache = {
                k: slot.k,
                inMenu,
                pair,
                q: qMul(axisAngle([0.2005, 0.9724, 0.1203], tilt), axisAngle([1, 0, 0], -0.16)),
            };
        }
        const { pair, q } = this._stackCache;
        if (!pair) return null;
        const fit = STACK_FITS[PIECE_KEYS[this.lanes[pair.anchor].shape]];
        // Where they meet across the frame: two thirds out on the title's side, or in the gutter
        // to the right of the menu's card, so the moment is never cut by the frame's edge.
        const sideSign = Math.sign(this.lanes[pair.anchor].sx) || 1;
        const across = inMenu ? 0.9 : 0.66 * sideSign;
        return {
            ...pair, ...stackPhase(slot.tau), tau: slot.tau, fit, q, across,
        };
    }

    posePieces(open, breath, menu, step, direct) {
        const cam = this.camera;
        const { pieces } = this;
        pieces.begin();
        const { aspect } = this.viewport;
        const rise = this.u.rise.value;
        const stack = this.stackNow(menu);
        this._stackWave = null;
        const avoid = [...this.avoidRects];
        if (this.titleRect && menu < 0.5) {
            const r = this.titleRect;
            const { width: W, height: H } = this.viewport;
            avoid.push({
                x0: (r.x - r.width * 0.08) / W,
                y0: (r.y - r.height * 0.12) / H,
                x1: (r.x + r.width * 1.08) / W,
                y1: (r.y + r.height * 1.12) / H,
            });
        }
        const now = this._piecesNow || (this._piecesNow = []);
        const v = this._ndc;
        const halfFov = Math.tan(((cam?.fov ?? 38) * Math.PI) / 360);
        // Every piece where its lane puts it (and where a touch has pushed it)...
        const placed = this.lanes.map((lane, i) => {
            const kick = this.spinKick[i];
            let spin = this.spinBase[i];
            if (kick) {
                const k = (this.time - kick.at) / 1.6;
                spin += kick.amount * easeOutCubic(k);
                if (k >= 1) this.settleKick(i);
            }
            const p = pieceAt(lane, {
                rise, time: this.time, aspect, extraSpin: spin,
            });
            const push = this.pushKick[i];
            if (push) {
                const k = this.time - push.at;
                const bump = Math.exp(-k * 1.6) - Math.exp(-k * 6);
                p.x += push.x * bump * 2.2;
                p.y += push.y * bump * 2.2;
                if (k > 4) this.pushKick[i] = null;
            }
            return p;
        });
        // ...then the stack: the twins glide to meet halfway, turn to fit and lock as one.
        const stackFlash = new Map();
        if (stack) {
            const a = placed[stack.anchor];
            const b = placed[stack.partner];
            // A little larger as they meet: the moment draws the eye.
            const s = ((a.scale + b.scale) / 2) * 1.18;
            const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2];
            // Placed through the live camera (the menu's view is turned): move across until the
            // meeting point stands at `across` on screen.
            v.set(mid[0], mid[1], mid[2]).project(cam);
            const depth = Math.hypot(mid[0] - cam.position.x, mid[1] - cam.position.y, mid[2] - cam.position.z);
            mid[0] += (stack.across - v.x) * depth * halfFov * aspect;
            const half = qRotate(stack.q, [(stack.fit.offset[0] * s) / 2, (stack.fit.offset[1] * s) / 2, 0]);
            const qa = stack.q;
            const qb = qMul(stack.q, axisAngle([0, 0, 1], stack.fit.turn));
            const { join } = stack;
            const dock = (p, sign, q) => {
                p.x += (mid[0] + half[0] * sign - p.x) * join;
                p.y += (mid[1] + half[1] * sign - p.y) * join;
                p.z += (mid[2] + half[2] * sign - p.z) * join;
                p.scale += (s - p.scale) * join;
                p.q = qSlerp(p.q, q, join);
            };
            dock(a, -1, qa);
            dock(b, 1, qb);
            stackFlash.set(stack.anchor, stack.flash);
            stackFlash.set(stack.partner, stack.flash);
            const sinceLock = stack.tau - STACK.approach * 0.96;
            if (sinceLock >= 0 && sinceLock < 1.8) {
                v.set(mid[0], mid[1], mid[2]).project(cam);
                this._stackWave = { x: v.x * 0.5 + 0.5, y: 0.5 - v.y * 0.5, age: sinceLock };
            }
        }
        for (let i = 0; i < this.lanes.length; i++) {
            const lane = this.lanes[i];
            const p = placed[i];
            // Where it is on screen, for the quiet zones and for picking.
            const dist = Math.hypot(p.x - cam.position.x, p.y - cam.position.y, p.z - cam.position.z);
            v.set(p.x, p.y, p.z).project(cam);
            const ndcRadius = (p.scale * 1.7) / Math.max(1e-3, dist * halfFov);
            // NDC spans two screen heights; the rects are screen fractions.
            const target = v.z < 1 ? presenceAt(v.x, v.y, ndcRadius * 0.42, avoid) : 1;
            this.presence[i] = direct ? target : damp(this.presence[i], target, 3.2, step);
            now[i] = {
                ndcX: v.x, ndcY: v.y, ndcRadius, presence: this.presence[i],
            };
            // The far ones are hazed by the air; near ones keep their colour.
            const air = lane.band === 'near' ? 0.4 : 1;
            pieces.write({
                shape: lane.shape,
                x: p.x,
                y: p.y,
                z: p.z,
                scale: p.scale,
                q: p.q,
                glow: 0.028 + breath * 0.033 + this.audio * 0.03,
                flash: Math.max(this.flash[i], stackFlash.get(i) ?? 0),
                presence: Math.max(0.0001, this.presence[i]),
                seed: lane.seed,
                air,
            });
        }
        pieces.commit();
    }

    // ── What the post needs ─────────────────────────────────────────────────────

    getPostState() {
        const open = this.opening ? openingState(this.openingProgress()) : openingState(0);
        const menu = this.menuBlend;
        const waves = [];
        // The opening's exhale, from the logo.
        if (this.opening && open.waveFade > 0.001) {
            waves.push({
                x: this.logoOrigin.x,
                y: this.logoOrigin.y,
                radius: 0.04 + open.wave * 1.25,
                strength: open.waveFade * this.motion,
            });
        }
        if (this.beginWave) {
            const k = (this.time - this.beginWave.at) / BEGIN_WAVE_SECONDS;
            if (k >= 1) this.beginWave = null;
            else {
                waves.push({
                    x: this.beginWave.x,
                    y: this.beginWave.y,
                    radius: 0.03 + easeOutCubic(k) * 1.1,
                    strength: (1 - smoothstep(0.15, 1, k)) * 0.85 * Math.max(0.35, this.motion),
                });
            }
        }
        // The stack's lock: a small ring of light where the twins meet.
        if (this._stackWave) {
            const k = this._stackWave.age / 1.8;
            waves.push({
                x: this._stackWave.x,
                y: this._stackWave.y,
                radius: 0.015 + easeOutCubic(k) * 0.3,
                strength: (1 - smoothstep(0.1, 1, k)) * 0.55 * (1 - menu * 0.5),
            });
        }
        const calm = [...this.calmRects];
        if (this.titleRect && menu < 0.99) {
            const r = this.titleRect;
            const { width: W, height: H } = this.viewport;
            calm.push({
                x0: r.x / W, y0: r.y / H, x1: (r.x + r.width) / W, y1: (r.y + r.height) / H, level: 0.35 * (1 - menu),
            });
        }
        return {
            exposure: (0.88 + 0.12 * open.light) * (1 - 0.12 * menu),
            vignette: 0.5 + 0.08 * menu,
            waves,
            calm,
            time: this.time,
        };
    }

    getState() {
        return {
            tier: this.tierName,
            time: Math.round(this.time * 1000) / 1000,
            breath: Math.round(breathAt(this.time) * 1000) / 1000,
            opening: this.opening ? Math.round(this.openingProgress() * 1000) / 1000 : null,
            mode: this.mode,
            menu: Math.round(this.menuBlend * 1000) / 1000,
            pieces: this.lanes.length,
            motes: this.tier.motes,
            present: Array.from(this.presence).filter((p) => p > 0.5).length,
        };
    }

    dispose() {
        for (const p of this.parts) p.dispose();
        this.parts = [];
        this.grain?.dispose();
        this.grain = null;
    }
}
