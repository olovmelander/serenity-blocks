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
 *     menu (the light lower, calmer; the murmuration to the right of the navigation), blended over
 *     a second and a half;
 *   - the gathering: on every third breath on the title the whole flock pours into a ring of
 *     light round the wordmark, and a wave of light leaves it as the ring closes;
 *   - the music: the flock swells and brightens with the soundtrack's level;
 *   - the player's touch: the pointer's parallax, a click that sends a pulse of light along the
 *     flock, the begin wave when the title is dismissed.
 * Everything is a function of time except what the player does, so `seek(t)` reproduces any
 * moment of the opening (the playground's fixed-time captures).
 */

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
    GATHER,
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
    halfHeightAt,
    murmurationAt,
    murmurationLine,
    openingState,
    riseClock,
    smoothstep,
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

    /** Screen-fraction rects (y down) the flock keeps out of (the menu's navigation…). */
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
        this.pose();
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
        u.veilGain.value = (0.7 + 0.3 * open.light) * (1 - 0.3 * menu) * 0.55;
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

    poseMurmuration(open, breath, menu) {
        const cam = this.camera;
        if (!cam) return;
        const { aspect } = this.viewport;
        const gathering = this.gatheringNow(menu);
        this._gatherWave = null;
        const avoid = [...this.avoidRects];
        if (this.titleRect && menu < 0.5) {
            const r = this.titleRect;
            const { width: W, height: H } = this.viewport;
            avoid.push({
                x0: (r.x - r.width * 0.04) / W,
                y0: (r.y - r.height * 0.06) / H,
                x1: (r.x + r.width * 1.04) / W,
                y1: (r.y + r.height * 1.06) / H,
            });
            // ...and the begin prompt under it.
            const q = r.prompt;
            if (q) {
                avoid.push({
                    x0: (q.x - q.width * 0.1) / W,
                    y0: (q.y - q.height * 0.3) / H,
                    x1: (q.x + q.width * 1.1) / W,
                    y1: (q.y + q.height * 1.3) / H,
                });
            }
        }
        this.murmuration.setAvoid(avoid);
        const m = murmurationAt({
            time: this.time, breath, aspect, menu, motion: this.motion, gather: gathering ? gathering.join : 0,
        });
        // While the world opens it pours up out of the light below.
        m.center[1] -= (1 - open.rise) * halfHeightAt(MURMURATION.z) * 1.5;
        // The music: the flock swells and brightens with the soundtrack's level.
        m.width *= 1 + this.audio * 0.12;
        const flash = Math.max(this.flockFlash, gathering ? gathering.flash : 0);
        m.light *= (0.3 + 0.7 * open.light) * (1 + flash * 1.2) * (1 + this.audio * 0.55);
        if (this.pulse) {
            m.pulse = this.time - this.pulse.at;
            m.pulseAt = this.pulse.s;
            m.pulseAmp = 1;
            if (m.pulse > 4) this.pulse = null;
        }
        this.murmuration.write(m);
        // Where the flock's line is on screen, for a touch.
        const line = this._flockLine || (this._flockLine = Array.from({ length: 25 }, () => ({ x: 0, y: 0 })));
        const v = this._ndc;
        line.forEach((p, i) => {
            const [x, y, z] = murmurationLine(m, i / (line.length - 1));
            v.set(x, y, z).project(cam);
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
        };
    }

    dispose() {
        for (const p of this.parts) p.dispose();
        this.parts = [];
        this.grain?.dispose();
        this.grain = null;
    }
}
