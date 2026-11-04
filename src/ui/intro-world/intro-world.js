/**
 * First Light — the world behind the opening, the title and the main menu.
 *
 * The parts (sky, veils, the murmuration, motes) are built once; this class owns their shared uniforms
 * and directs them:
 *   - the clocks: time, the breath, and the rise clock (the breath's integral) that paces
 *     everything that ascends;
 *   - the opening: from the frame the loading screen paints (low in the light, the veils not
 *     yet drawn) the eye rises and draws back while the veils unfurl, the murmuration pours up out
 *     of the light below and a wave of light leaves the logo;
 *   - the modes: the title (a halo behind the wordmark, the murmuration flying round it) and the
 *     menu (the light lower, calmer; the murmuration on a circuit round the stage card, down the
 *     free gutters of the layout, in the current mode's light, with a thread of light from the
 *     current row into the card), blended over a second and a half;
 *   - the gathering: on every third breath on the title the whole flock pours into a ring of
 *     light fitted to the wordmark, and a wave of light leaves it as the ring closes; behind the
 *     menu, on the same breath, it closes round the stage card into a frame of light;
 *   - the music: the flock swells and brightens with the soundtrack's level;
 *   - the player's touch: the pointer's parallax, a click that sends a pulse of light along the
 *     flock, the begin wave when the title is dismissed.
 * Everything is a function of time except what the player does, so `seek(t)` reproduces any
 * moment of the opening (the playground's fixed-time captures).
 */

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
    FLOCK_POINTS,
    GATHER,
    MODE_HUES,
    MURMURATION,
    OPENING_RISE,
    OPENING_SECONDS,
    breathAt,
    cameraPoseAt,
    clamp01,
    easeInOutCubic,
    easeOutCubic,
    gatherPhase,
    gatherSlot,
    lerp,
    murmurationAt,
    openingState,
    riseClock,
    smoothstep,
    srgbToLinear,
    stageCircuit,
    writeFlockLine,
} from './intro-world-core.js';
import { bakeGrainTexture } from './intro-world-tsl.js';
import { createSky } from './intro-world-sky.js';
import { createVeils } from './intro-world-veils.js';
import { createMurmuration } from './intro-world-murmuration.js';
import { createMotes } from './intro-world-motes.js';

/** Content per tier (the intro renderer maps its HIGH / MEDIUM / LOW budget onto these). */
export const WORLD_TIERS = Object.freeze({
    High: {
        murmuration: 110000, motes: 1800, grain: true, bevel: 3, post: 'High', dprCap: 2,
    },
    Medium: {
        murmuration: 52000, motes: 1100, grain: true, bevel: 2, post: 'Medium', dprCap: 1.5,
    },
    Low: {
        murmuration: 18000, motes: 600, grain: false, bevel: 1, post: 'Low', dprCap: 1,
    },
});

const MODE_SECONDS = 1.6;
const BEGIN_WAVE_SECONDS = 1.7;
/** The murmuration's light at 110 000 motes; fewer motes each carry more (the same total light). */
const MURMUR_GAIN = 1.25;
const MURMUR_REFERENCE = 110000;

const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
/** How fast the flock's path follows the layout, and the current row's thread follows the row. */
const LAYOUT_GLIDE = 6;
const THREAD_GLIDE = 10;
/** A pastel deepened for light: added up in a dense flock the page's pastels wash to white. */
const deepen = (rgb) => {
    const c = rgb.map((v) => v ** 1.5);
    const peak = Math.max(...c, 1e-4);
    return c.map((v) => v / peak);
};
/** The rect keys of a menu layout. */
const LAYOUT_RECTS = ['stage', 'nav', 'brand', 'dock', 'row'];
/** The thread needs this much gutter (frame heights) between the row and the card. */
const THREAD_MIN_GAP = 0.05;

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
        // A touch's pulse along the flock (its start and where), and the begin wave's flash.
        this.pulse = null;
        this.flockFlash = 0;
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
        // The menu as it stands, and the layout the flock flies (it glides to the real one).
        this.layout = null;
        this.flown = null;
        this.onStage = 0;
        this.threadAmount = 0;
        this.calmRects = [];
        // The flock's line and the light lent along it, written every frame.
        this.line = new Float32Array(FLOCK_POINTS * 4);
        this.hues = new Float32Array(FLOCK_POINTS * 4);
        this.modeHue = [0, 0, 0];
        this.modeHueOn = 0;
        this.closed = 0;
        this.threadPoints = new Float32Array(12);
        this._plane = [0, 0, 0];
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
        this.murmuration = createMurmuration(this.u, { count: this.tier.murmuration });
        this.murmuration.setGain(MURMUR_GAIN * (MURMUR_REFERENCE / this.tier.murmuration));
        this.murmuration.setViewport(this.viewport.height, this.viewport.aspect);
        this.motes = createMotes(this.u, { count: this.tier.motes });
        this.parts = [this.sky, this.veils, this.murmuration, this.motes];
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
        this.murmuration?.setViewport(height, this.viewport.aspect);
        if (this.camera) {
            this.camera.aspect = this.viewport.aspect;
            this.camera.updateProjectionMatrix();
        }
    }

    /** The wordmark's rect in CSS pixels (or null): the halo stands behind it, the flock keeps clear. */
    setTitleRect(rect) {
        this.titleRect = rect && rect.width > 0 && rect.height > 0 ? { ...rect } : null;
    }

    /**
     * The main menu as it stands (screen fractions, y down), or null when it is covered: `stage`
     * the card the flock circles, `nav`, `brand` and `dock` the panels it flows round, `row` the
     * current row its thread starts from, `mode` the current mode (it lends the flock its light),
     * `calm` the rects whose light the post softens, with a level each.
     */
    setMenuLayout(layout) {
        const next = layout?.stage ? layout : null;
        this.layout = next;
        this.calmRects = Array.isArray(layout?.calm) ? layout.calm.filter(Boolean) : [];
        const hue = next && MODE_HUES[next.mode];
        if (hue) {
            this.modeHue = deepen(srgbToLinear(hue));
            this.modeHueOn = 1;
        } else {
            this.modeHueOn = 0;
        }
        if (next && !this.flown) this.flown = LAYOUT_RECTS.reduce((all, key) => ({ ...all, [key]: next[key] ? { ...next[key] } : null }), {});
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
        // Everything takes a small breath outward and the flock catches the light.
        this.flockFlash = Math.max(this.flockFlash, 0.35);
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

    /**
     * A click at a point (NDC, y up): a pulse of light runs both ways along the flock from the
     * part of it nearest the click (if the click is near it at all).
     */
    pick(ndcX, ndcY) {
        if (!this.camera || !this._flockLine) return false;
        let best = -1;
        let bestD = Infinity;
        this._flockLine.forEach((p, i) => {
            const d = Math.hypot((p.x - ndcX) * this.viewport.aspect, p.y - ndcY);
            if (d < bestD) {
                best = i;
                bestD = d;
            }
        });
        if (best < 0 || bestD > 0.5) return false;
        this.pulse = { at: this.time, s: best / (this._flockLine.length - 1) };
        return true;
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
        this.flockFlash *= Math.exp(-step * 2.4);
        this.glideLayout(step);
        this.pose();
    }

    /** The flock's path follows the layout (a resize, the current row moving down the list). */
    glideLayout(step) {
        const { layout } = this;
        const onMenu = this.mode === 'menu' && layout;
        this.onStage = damp(this.onStage, onMenu ? 1 : 0, 2.4, step);
        if (!layout || !this.flown) {
            this.threadAmount = damp(this.threadAmount, 0, 3, step);
            this.tintLine(step);
            return;
        }
        for (const key of LAYOUT_RECTS) {
            const target = layout[key];
            // (A panel can leave the layout: the stacked menu has no card beside its list.)
            if (!target || !this.flown[key]) {
                this.flown[key] = target ? { ...target } : null;
                continue;
            }
            const rate = key === 'row' ? THREAD_GLIDE : LAYOUT_GLIDE;
            for (const side of ['x0', 'y0', 'x1', 'y1']) {
                this.flown[key][side] = damp(this.flown[key][side], target[side], rate, step);
            }
        }
        this.threadAmount = damp(this.threadAmount, onMenu && this.threadFits(layout) ? 1 : 0, 2.2, step);
        this.tintLine(step);
    }

    /** The current mode's light reaches the flock's head first and runs down it to the tail. */
    tintLine(step) {
        const { hues, modeHue } = this;
        const lent = this.modeHueOn * this.onStage;
        for (let i = 0; i < FLOCK_POINTS; i++) {
            const s = clamp01((i - 1) / (FLOCK_POINTS - 3));
            const k = step === null ? 1 : 1 - Math.exp(-lerp(6, 1.1, s) * step);
            const row = i * 4;
            hues[row] += (modeHue[0] - hues[row]) * k;
            hues[row + 1] += (modeHue[1] - hues[row + 1]) * k;
            hues[row + 2] += (modeHue[2] - hues[row + 2]) * k;
            // (Evenly when it closes round the card, where its head meets its tail.)
            const share = lerp(lerp(0.86, 0.62, s), 0.74, this.closed);
            hues[row + 3] += (lent * share - hues[row + 3]) * k;
        }
    }

    /** Is there a gutter between the current row and the card for the thread to cross? */
    threadFits(layout) {
        const { row, stage } = layout;
        return Boolean(row && stage && (stage.x0 - row.x1) * this.viewport.aspect >= THREAD_MIN_GAP);
    }

    /**
     * Jump to time t (deterministic). `opening` (seconds since the opening began, or null for
     * none yet) and `menu` (0..1) place the moment.
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
        // A seek lands where the layout has long since settled.
        const onMenu = this.mode === 'menu' && this.layout;
        this.onStage = onMenu ? 1 : 0;
        if (this.layout) {
            this.flown = LAYOUT_RECTS.reduce((all, key) => ({
                ...all, [key]: this.layout[key] ? { ...this.layout[key] } : null,
            }), {});
        }
        this.threadAmount = onMenu && this.threadFits(this.layout) ? 1 : 0;
        this.tintLine(null);
        this.pose();
    }

    pose() {
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
        // The veils are the murmuration's sky now, not the show: they keep to a quieter light.
        u.veilGain.value = (0.7 + 0.3 * open.light) * (1 - 0.45 * menu) * 0.55;
        u.moteGain.value = (0.7 + 0.3 * open.light) * (1 - 0.25 * menu) * (1 + this.audio * 0.35);
        const haloGain = (1 - menu) * open.halo * (this.titleRect ? 1 : 0.6);
        const hazeGain = (0.85 + 0.15 * open.light) * (1 - 0.18 * menu);
        u.light.value.set(breath, hazeGain, haloGain * (1 + this.audio * 0.4), 0.7 + 0.3 * open.light);

        this.updateCamera(open, breath, menu);
        this.updateHalo();
        this.poseMurmuration(open, breath, menu);
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
            gather: this.gatheringNow(menu)?.join ?? 0,
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
     * The gathering in progress, if any: how far the flock has poured into the ring and the flash
     * as it closes. Every third breath, on the title only (behind the menu the ring would cross
     * the navigation); never during the opening or under reduced motion.
     */
    gatheringNow(menu) {
        const slot = gatherSlot(this.time);
        if (!slot || !this.opening || this.openingProgress() < 1 || this.motion < 0.5) return null;
        // It lets go as the menu comes in.
        const phase = gatherPhase(slot.tau);
        const away = 1 - smoothstep(0, 0.5, menu);
        if (away <= 0) return null;
        return { ...phase, join: phase.join * away, tau: slot.tau };
    }

    /** A screen fraction (y down) on the plane z, through the live camera. */
    toPlane(x, y, z) {
        const cam = this.camera;
        const hit = this._plane;
        this._ndc.set(x * 2 - 1, 1 - y * 2, 0.5).unproject(cam);
        this._dir.copy(this._ndc).sub(cam.position);
        const t = (z - cam.position.z) / this._dir.z;
        hit[0] = cam.position.x + this._dir.x * t;
        hit[1] = cam.position.y + this._dir.y * t;
        hit[2] = z;
        return hit;
    }

    /**
     * The panels the flock flows round. The wordmark and its prompt on the title; the menu's
     * card, navigation, logo and dock behind the menu: each comes in with its screen, so a mote
     * is never shoved.
     */
    panels(menu) {
        const { aspect, width: W, height: H } = this.viewport;
        const list = [];
        const add = (r, law, on) => {
            if (on <= 0.001) return;
            const x0 = r.x0 * aspect;
            const x1 = r.x1 * aspect;
            list.push({
                cx: (x0 + x1) / 2,
                cy: (r.y0 + r.y1) / 2,
                hx: (x1 - x0) / 2,
                hy: (r.y1 - r.y0) / 2,
                radius: law.radius,
                reach: law.reach * on,
                fadeFrom: lerp(-2, law.fadeFrom, on),
                fadeTo: lerp(-1.9, law.fadeTo, on),
            });
        };
        const title = 1 - smoothstep(0, 0.5, menu);
        const r = this.titleRect;
        if (r) {
            add({
                x0: r.x / W, y0: r.y / H, x1: (r.x + r.width) / W, y1: (r.y + r.height) / H,
            }, {
                radius: 0.03, reach: 0.06, fadeFrom: -0.012, fadeTo: 0.05,
            }, title);
            const q = r.prompt;
            if (q) {
                add({
                    x0: q.x / W, y0: q.y / H, x1: (q.x + q.width) / W, y1: (q.y + q.height) / H,
                }, {
                    radius: 0.02, reach: 0, fadeFrom: 0, fadeTo: 0.05,
                }, title);
            }
        }
        const f = this.flown;
        if (f) {
            const on = this.onStage;
            add(f.stage, {
                radius: 28 / H, reach: 0.03, fadeFrom: -0.014, fadeTo: 0.004,
            }, on);
            if (f.nav) {
                add(f.nav, {
                    radius: 0.02, reach: 0.045, fadeFrom: -0.006, fadeTo: 0.03,
                }, on);
            }
            if (f.brand) {
                add(f.brand, {
                    radius: 0.02, reach: 0.045, fadeFrom: -0.006, fadeTo: 0.03,
                }, on);
            }
            if (f.dock) {
                add(f.dock, {
                    radius: 0.01, reach: 0.022, fadeFrom: -0.012, fadeTo: 0.018,
                }, on);
            }
        }
        return list;
    }

    /** The ring stands round the wordmark and its tagline, wherever the camera has drifted. */
    fitRing(m) {
        const r = this.titleRect;
        if (!r) return;
        const { width: W, height: H } = this.viewport;
        const { z } = MURMURATION;
        const cx = (r.x + r.width / 2) / W;
        const cy = (r.y + r.height * 0.56) / H;
        const ax = Math.min((r.width * 0.73 + 30) / W, 0.47) * m.ringBreath;
        const ay = Math.min((r.height * 0.73 + 100) / H, 0.44) * m.ringBreath;
        const [x, y] = this.toPlane(cx, cy, z);
        const [xr] = this.toPlane(cx + ax, cy, z);
        const yt = this.toPlane(cx, cy - ay, z)[1];
        m.ring = [x, y, Math.abs(xr - x), Math.abs(yt - y)];
    }

    /** The thread from the current row into the card: level out of the row, level into the card. */
    poseThread() {
        const f = this.flown;
        if (!f?.row || !f.stage || this.threadAmount <= 0.001) {
            this.murmuration.writeThread({
                points: this.threadPoints, amount: 0, width: 0, flow: 0,
            });
            return;
        }
        const { row, stage } = f;
        const { z } = MURMURATION;
        const y0 = (row.y0 + row.y1) / 2;
        const cardMid = (stage.y0 + stage.y1) / 2;
        const y1 = Math.max(stage.y0 + 0.08, Math.min(stage.y1 - 0.08, lerp(y0, cardMid, 0.3)));
        const x0 = row.x1;
        const x1 = stage.x0;
        const gap = x1 - x0;
        const out = this.threadPoints;
        const put = (i, x, y) => {
            const p = this.toPlane(x, y, z);
            out[i] = p[0];
            out[i + 1] = p[1];
            out[i + 2] = p[2];
        };
        put(0, x0, y0);
        put(3, x0 + gap * 0.5, y0);
        put(6, x1 - gap * 0.5, y1);
        put(9, x1, y1);
        this.murmuration.writeThread({
            points: out, amount: this.threadAmount, width: 0.2, flow: this.riseBase * 0.17,
        });
    }

    /** Behind the menu the same breath closes the flock round the stage card, and lets it go. */
    closingNow() {
        const slot = gatherSlot(this.time);
        if (!slot || this.motion < 0.5 || this.onStage <= 0) return null;
        const phase = gatherPhase(slot.tau);
        const here = smoothstep(0.5, 1, this.onStage);
        return { join: phase.join * here, flash: phase.flash * here };
    }

    poseMurmuration(open, breath, menu) {
        const cam = this.camera;
        if (!cam) return;
        const { aspect } = this.viewport;
        const gathering = this.gatheringNow(menu);
        const closing = this.closingNow();
        this.closed = closing ? closing.join : 0;
        this._gatherWave = null;
        this.murmuration.setRects(this.panels(menu));
        const m = murmurationAt({
            time: this.time,
            breath,
            aspect,
            menu,
            motion: this.motion,
            gather: gathering ? gathering.join : 0,
            close: closing ? closing.join : 0,
        });
        this.fitRing(m);
        // The music: the flock swells and brightens with the soundtrack's level.
        m.width *= 1 + this.audio * 0.12;
        const flash = Math.max(this.flockFlash, gathering ? gathering.flash * 0.6 : 0, closing ? closing.flash * 0.45 : 0);
        m.light *= (0.3 + 0.7 * open.light) * (1 + flash * 1.2) * (1 + this.audio * 0.55);
        if (this.pulse) {
            m.pulse = this.time - this.pulse.at;
            m.pulseAt = this.pulse.s;
            m.pulseAmp = 1;
            if (m.pulse > 4) this.pulse = null;
        }
        this.murmuration.write(m, MURMURATION.z);
        const circuit = this.onStage > 0.001 && this.flown?.stage ? stageCircuit(this.flown, aspect) : null;
        const frame = 2 * (cam.position.z - MURMURATION.z) * Math.tan((cam.fov * Math.PI) / 360);
        writeFlockLine(m, this.line, {
            circuit,
            onCircuit: this.onStage,
            risen: this.openingProgress(),
            toWorld: (x, y, z) => this.toPlane(x, y, z),
            worldPerFrame: frame,
        });
        this.murmuration.writeLine(this.line);
        this.murmuration.writeHues(this.hues);
        this.poseThread();
        // Where the flock's line is on screen, for a touch.
        const line = this._flockLine
            || (this._flockLine = Array.from({ length: FLOCK_POINTS - 2 }, () => ({ x: 0, y: 0 })));
        const v = this._ndc;
        line.forEach((p, i) => {
            const row = (i + 1) * 4;
            v.set(this.line[row], this.line[row + 1], this.line[row + 2]).project(cam);
            p.x = v.x;
            p.y = v.y;
        });
        if (gathering) {
            const sinceLock = gathering.tau - GATHER.approach * 0.96;
            if (sinceLock >= 0 && sinceLock < 2.4) {
                const c = this.titleCentre() || { x: 0.5, y: 0.47 };
                this._gatherWave = { x: c.x, y: c.y, age: sinceLock };
            }
        }
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
        // The gathering: as the ring closes, a wave of light leaves the title.
        if (this._gatherWave) {
            const k = this._gatherWave.age / 2.4;
            waves.push({
                x: this._gatherWave.x,
                y: this._gatherWave.y,
                radius: 0.05 + easeOutCubic(k) * 0.95,
                strength: (1 - smoothstep(0.1, 1, k)) * 0.7 * (1 - menu * 0.5),
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
            murmuration: this.tier.murmuration,
            motes: this.tier.motes,
            onStage: Math.round(this.onStage * 1000) / 1000,
            thread: Math.round(this.threadAmount * 1000) / 1000,
        };
    }

    dispose() {
        for (const p of this.parts) p.dispose();
        this.parts = [];
        this.grain?.dispose();
        this.grain = null;
    }
}
