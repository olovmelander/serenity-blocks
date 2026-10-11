/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SOLAR ECLIPSE — the crown of the black sun
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The moment of totality, seen through a long lens from a high ridge: the black sun stands in
 * the free space left of the card above range after range of mountains, its corona streaming out
 * along the lines of its field, a thin pink sliver of chromosphere creeping round the limb as the
 * moon wanders, the planets out, and all round the horizon the light of the world beyond the
 * moon's shadow. The board dresses the sun: a locking piece sends a mote of its own colour from
 * the card's edge, at the piece's height, to the limb, where a prominence of that colour rises
 * (an arch, or a ragged hedgerow; a hard drop raises a taller one); a clear sends a necklace of
 * light round the black sun, one bead per line, and the oldest prominences erupt and are flung
 * out through the corona; four lines or a perfect clear bring the diamond ring (daylight floods
 * back for a breath) and a coronal mass ejection; a T-spin twists the corona; a chain of clears
 * is a longer exposure (the outer corona reaches further, the faint stars come out, earthshine
 * lights the moon); a new level turns the light one step (ember, gold, jade, azure, violet,
 * rose) and the solar cycle with it, and both also turn by themselves, slowly, with the clock.
 *
 * Content lives in SolarEclipseWorld (solar-eclipse-world.js), shared with the playground effect
 * src/playground/effects/solar-eclipse.effect.js, so what is iterated there ships. This class
 * owns the lifecycle (BaseTheme), the renderer (WebGPURenderer on WebGPU, else its WebGL2
 * backend; ?forceWebGL or ?eclipseForceWebGL), the post stack, gameplay events (through
 * SolarEclipseDirector), the layout watch (events aim at the live board, and the post's calm
 * zones follow the card and HUD; read on frame time, never from a handler), pointer parallax,
 * reduced motion, settings, GPU-loss recovery and deterministic capture flags:
 *   ?eclipseTime=<s>      seek to t and freeze the simulation (captures)
 *   ?eclipseFixedDt=<ms>  fixed frame step
 *   ?eclipseParts=a,b,... draw only these parts (the names in SOLAR_ECLIPSE_PARTS)
 *   ?eclipseFalseColor=1  post debug view
 *
 * The world draws no render target of its own: everything it shows is in the scene the post
 * stack renders. update() still runs every frame, before the post stack renders (the picture is
 * drawn from what it wrote), and once when the scene is built.
 *
 * Warm: none (the world parks nothing for the manager to compile, and the scene pass has one
 * output).
 */

import * as THREE from 'three/webgpu';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { registerGpuSurface } from '../../utils/gpu-loss-coordinator.js';
import { normalizeQuality } from '../../utils/quality.js';
import { getViewport } from '../../utils/viewport.js';
import { SOLAR_ECLIPSE_TETROMINOS } from './solar-eclipse-tetrominos.js';
import { SolarEclipseWorld, REST_RIG, fovForAspect } from './solar-eclipse-world.js';
import { POST_LOOK, SolarEclipsePost, createPassThroughPipeline } from './solar-eclipse-post.js';
import { PLAYER_SLOTS, readLayoutRects } from './solar-eclipse-composition.js';
import { SOLAR_ECLIPSE_EVENT_HANDLERS, SolarEclipseDirector } from './solar-eclipse-director.js';
import { approach } from './solar-eclipse-core.js';

const THEME_ID = 'solar-eclipse';
const LOG_PREFIX = '[SolarEclipse]';
const RENDERER_INIT_TIMEOUT_MS = 5500;
const MAX_DELTA_S = 0.05;
const CLEAR_COLOR = 0x04050c;

/** Layout re-reads after a trigger (seconds of frame time): immediately, +0.5 s, +1.5 s. */
const LAYOUT_REREAD_OFFSETS = Object.freeze([0, 0.5, 1.5]);

/** Pixel-ratio cap per quality tier (the global render scale and DPR still apply). */
const PIXEL_RATIO_CAP = Object.freeze({
    Minimal: 0.7,
    Low: 0.85,
    Medium: 1.0,
    High: 1.15,
    Ultra: 1.35,
    Extreme: 1.6,
});

function readFlags() {
    const empty = {
        forceWebGL: false, time: null, fixedDt: null, parts: null, falseColor: false,
    };
    if (typeof window === 'undefined') return empty;
    const params = new URLSearchParams(window.location?.search || '');
    const bool = (k) => params.has(k) && ['', '1', 'true', 'yes', 'on'].includes((params.get(k) || '').toLowerCase());
    const num = (k) => {
        const raw = params.get(k);
        if (raw === null || raw === '') return null;
        const v = Number(raw);
        return Number.isFinite(v) ? v : null;
    };
    const t = num('eclipseTime');
    const dt = num('eclipseFixedDt');
    return {
        forceWebGL: bool('forceWebGL') || bool('eclipseForceWebGL'),
        time: t !== null && t >= 0 ? t : null,
        fixedDt: dt !== null && dt > 0 ? dt / (dt > 1 ? 1000 : 1) : null,
        parts: params.get('eclipseParts')
            ? params.get('eclipseParts').split(',').map((p) => p.trim())
            : null,
        falseColor: bool('eclipseFalseColor'),
    };
}

/**
 * Settings payloads arrive in three shapes: the window 'settingsChanged' detail holds only the
 * changed keys; the bus SETTINGS_CHANGED carries `{ settings, source }` or `{ type, value }`.
 */
function readSettingUpdate(payload, key) {
    const detail = payload?.detail || payload || null;
    if (!detail) return { present: false, value: undefined };
    if (detail.type === key) return { present: true, value: detail.value ?? detail[key] ?? detail.settings?.[key] };
    const sources = [detail, detail.changed, detail.settings];
    for (let i = 0; i < sources.length; i += 1) {
        const src = sources[i];
        if (src && typeof src === 'object' && Object.prototype.hasOwnProperty.call(src, key)) {
            return { present: true, value: src[key] };
        }
    }
    return { present: false, value: undefined };
}

function readSetting(payload, key) {
    const update = readSettingUpdate(payload, key);
    if (update.present) return update.value;
    return typeof window !== 'undefined' ? window.settings?.[key] : undefined;
}

function boolSetting(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'string') {
        const v = value.trim().toLowerCase();
        if (['false', '0', 'off', 'no'].includes(v)) return false;
        if (['true', '1', 'on', 'yes'].includes(v)) return true;
    }
    return value === true;
}

export default class SolarEclipseTheme extends BaseTheme {
    constructor() {
        super(THEME_ID);
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.world = null;
        this.post = null;
        this.passThrough = null;
        this.director = null;
        this.isWebGPU = false;
        this.forceWebGL = false;
        this.quality = 'High';
        this.pendingQuality = null;
        this.flags = readFlags();
        this.time = 0;
        this.lastFrameMs = null;
        this.animationLoopStarted = false;
        this.runtimeGeneration = 0;
        this.eventUnsubscribers = [];
        this.gpuSurfaceUnregister = null;
        this.gpuRecoveryAttempted = false;
        this.layoutDue = new Float64Array(LAYOUT_REREAD_OFFSETS.length).fill(Infinity);
        this.layoutClock = 0; // wall time: reads still land while a capture freezes the sim
        this.modeManager = null;
        this.layout = { applied: null, live: false, strength: 0 };
        this.pointer = {
            x: 0, y: 0, sx: 0, sy: 0,
        };
        this.reducedMotion = false;
        this.reducedMotionQuery = null;
        this.appliedSize = null;
        this.bufferSize = new THREE.Vector2();
        this.rebuildQueued = false;
        this.rebuildPending = false;
        /** The true combo per director player slot: the exposure opens to the longest chain. */
        this.combos = new Map();
        /** The level the board is on, and what a rebuild (a quality change, a lost device) carries over. */
        this.level = 1;
        this.carry = null;
        this._sim = {
            time: 0, delta: 0, pointerX: 0, pointerY: 0,
        };
        this._calmRects = [];
    }

    getTetrominoConfig() {
        return SOLAR_ECLIPSE_TETROMINOS;
    }

    // ── build ───────────────────────────────────────────────────────────────────

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        const container = document.getElementById(`${this.name}-theme`);
        if (!container) throw new Error(`${LOG_PREFIX} Theme container not found.`);

        this.disposeRuntime();
        const generation = ++this.runtimeGeneration;
        const isCurrent = () => generation === this.runtimeGeneration
            && ownerGeneration === this.lifecycleGeneration
            && this.isActive
            && !this.cleanupComplete;

        container.replaceChildren();
        this.flags = readFlags();
        this.quality = this.pendingQuality ?? normalizeQuality(readSetting(null, 'effectQuality'));
        this.pendingQuality = null;

        const renderer = await this.createRenderer(ownerGeneration);
        if (!renderer) return; // cancelled: BaseTheme retires the stale start
        if (!isCurrent()) {
            this.disposeRenderer(renderer, { nullInstance: false });
            return;
        }
        this.renderer = renderer;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
        renderer.setClearColor(CLEAR_COLOR, 1);
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.setAttribute('aria-hidden', 'true');
        renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;'
            + 'z-index:0;pointer-events:none';
        container.appendChild(renderer.domElement);
        this.setupGpuResilience();

        const { width, height } = getViewport();
        this.scene = new THREE.Scene();
        const aspect = Math.max(1, width) / Math.max(1, height);
        this.camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);

        try {
            this.world = new SolarEclipseWorld({
                scene: this.scene,
                quality: this.quality,
                capture: this.flags.time !== null || this.flags.fixedDt !== null,
                renderer,
            }).build();
            this.world.bindCamera(this.camera);
            if (this.flags.parts) this.world.showOnlyParts(this.flags.parts);
            this.setupPost();
        } catch (error) {
            console.error(`${LOG_PREFIX} Scene creation failed:`, error);
            if (generation === this.runtimeGeneration) this.disposeRuntime();
            throw error; // current-attempt failure -> start() rejects -> manager falls back
        }
        if (!isCurrent()) return;

        this.combos.clear();
        this.director = new SolarEclipseDirector({
            sink: {
                lock: (c) => this.world?.onLock(c),
                clear: (c) => this.world?.onClear(c),
                combo: (n, player) => this.reportCombo(n, player),
                levelUp: (level) => {
                    this.level = level;
                    this.world?.levelUp(level);
                },
            },
        });
        this.appliedSize = null;
        this.resize(width, height);
        this.applyReactionSettings(null);
        this.setupEvents();
        this.layout = { applied: null, live: false, strength: 0 };
        this.modeManager = null;

        // A rebuild mid-run (a quality change, a lost device) picks totality up where it was:
        // the same clock, the same level's light.
        const carried = this.carry;
        this.carry = null;
        this.time = this.flags.time ?? carried?.time ?? 0;
        this.level = carried?.level ?? 1;
        this.scheduleLayoutReads();
        this.world.seek(this.time);
        if (this.level > 1) this.world.levelUp(this.level, { silent: true });
        this.world.updateCamera(this.camera, this.buildSim(0));
        this.world.update(this.buildSim(0), this.camera);

        if (!this.isPaused) this.animate();
        const backend = this.isWebGPU ? 'WebGPU' : 'WebGL2';
        console.log(`${LOG_PREFIX} Scene ready (${backend}, ${this.quality})`);
    }

    async createRenderer(ownerGeneration) {
        const wantWebGL = this.forceWebGL || this.flags.forceWebGL;
        const canTryWebGPU = !wantWebGL && typeof navigator !== 'undefined' && !!navigator.gpu;
        const stillOwned = () => ownerGeneration === this.lifecycleGeneration && this.isActive && !this.cleanupComplete;
        // The canvas only receives the output quad (the scene pass owns depth and MSAA).
        const attempt = (forceWebGL) => this.initializeRendererCandidate(
            new THREE.WebGPURenderer({
                antialias: false, depth: false, alpha: false, forceWebGL, powerPreference: 'high-performance',
            }),
            {
                timeoutMs: RENDERER_INIT_TIMEOUT_MS,
                label: `Solar Eclipse ${forceWebGL ? 'WebGL2' : 'WebGPU'} renderer init`,
                ownerGeneration,
            },
        );
        if (canTryWebGPU) {
            try {
                return await attempt(false);
            } catch (error) {
                if (!stillOwned()) return null;
                console.warn(`${LOG_PREFIX} WebGPU init failed; trying the WebGL2 backend:`, error);
            }
        }
        if (!stillOwned()) return null;
        try {
            return await attempt(true);
        } catch (error) {
            if (!stillOwned()) return null;
            throw new Error('Solar Eclipse could not initialize WebGPU or WebGL2.', { cause: error });
        }
    }

    setupGpuResilience() {
        const { renderer } = this;
        this.setupRendererResilience(renderer, {
            webgpuDevice: this.isWebGPU ? renderer.backend?.device : null,
        });
        this.gpuSurfaceUnregister?.();
        this.gpuSurfaceUnregister = null;
        if (!this.isWebGPU) return; // WebGL2: BaseTheme's CONTEXT_RESTORED restart covers it
        this.gpuSurfaceUnregister = registerGpuSurface(this.name, {
            recover: async () => {
                if (this.gpuRecoveryAttempted) throw new Error('Solar Eclipse WebGPU recovery already attempted.');
                this.gpuRecoveryAttempted = true;
                this.forceWebGL = true; // one-shot retry on the WebGL2 backend
                if (this.isActive) {
                    this.carry = { time: this.time, level: this.level };
                    await this.createScene();
                }
            },
        });
    }

    setupPost() {
        const look = POST_LOOK[this.quality] || POST_LOOK.High;
        this.post = null;
        this.passThrough = null;
        try {
            this.post = new SolarEclipsePost(this.renderer, this.scene, this.camera, {
                look,
                falseColor: this.flags.falseColor,
            });
        } catch (error) {
            console.warn(`${LOG_PREFIX} Post stack failed; rendering pass-through:`, error);
            this.post = null;
            this.renderer.toneMapping = THREE.AgXToneMapping;
            this.passThrough = createPassThroughPipeline(this.renderer, this.scene, this.camera);
        }
    }

    // ── gameplay + input ────────────────────────────────────────────────────────

    setupEvents() {
        // createScene re-runs on every start() and rebuild: never stack a second set.
        this.clearEventUnsubscribers();
        this.clearTrackedResources();
        this.eventUnsubscribers = [];
        const playing = () => this.isActive && !this.isPaused;

        Object.keys(SOLAR_ECLIPSE_EVENT_HANDLERS).forEach((key) => {
            const handler = SOLAR_ECLIPSE_EVENT_HANDLERS[key];
            if (!EVENTS[key]) return;
            this.eventUnsubscribers.push(eventBus.on(EVENTS[key], (payload) => {
                if (playing()) this.director?.[handler](payload);
            }));
        });
        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.SETTINGS_CHANGED, (p) => this.handleSettingsChanged(p)),
            eventBus.on(EVENTS.VIEWPORT_RESIZED, (v) => {
                const view = v?.width > 0 && v?.height > 0 ? v : getViewport();
                this.resize(view.width, view.height);
            }),
        );
        this.registerEventListener(window, 'settingsChanged', (p) => this.handleSettingsChanged(p));
        this.registerEventListener(window, 'gameOver', () => this.resetSession());

        const resetPointer = () => {
            this.pointer.x = 0;
            this.pointer.y = 0;
        };
        const onPointerMove = (event) => {
            const { w, h } = this.appliedSize || { w: window.innerWidth, h: window.innerHeight };
            const cx = Number(event?.clientX);
            const cy = Number(event?.clientY);
            if (!this.isActive || this.isPaused || this.reducedMotion || event?.pointerType === 'touch'
                || event?.isPrimary === false || !Number.isFinite(cx) || !Number.isFinite(cy) || !(w > 0) || !(h > 0)) {
                resetPointer();
                return;
            }
            this.pointer.x = Math.max(-1, Math.min(1, (cx / w) * 2 - 1));
            this.pointer.y = Math.max(-1, Math.min(1, (cy / h) * 2 - 1));
        };
        this.registerEventListener(window, 'pointermove', onPointerMove, { passive: true });
        this.registerEventListener(window, 'pointerleave', resetPointer, { passive: true });
        this.registerEventListener(window, 'blur', resetPointer);
        const mq = typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)')
            : null;
        this.reducedMotionQuery = mq;
        if (typeof mq?.addEventListener === 'function') {
            this.registerEventListener(mq, 'change', () => this.applyReactionSettings(null));
        }
    }

    /** The exposure opens to the longest chain any board is holding. */
    reportCombo(combo, player = 0) {
        if (combo > 0) this.combos.set(player, combo);
        else this.combos.delete(player);
        let best = 0;
        this.combos.forEach((n) => {
            if (n > best) best = n;
        });
        this.world?.onCombo(best);
    }

    /** A new run: the crown back at rest, no chain in flight. */
    resetSession() {
        this.director?.reset();
        this.combos.clear();
        this.level = 1;
        this.world?.resetSession();
        this.scheduleLayoutReads();
    }

    applyReactionSettings(payload) {
        const mq = this.reducedMotionQuery
            || (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
                ? window.matchMedia('(prefers-reduced-motion: reduce)') : null);
        this.reducedMotion = boolSetting(readSetting(payload, 'reducedMotion'), false) || mq?.matches === true;
        this.director?.configure({
            enabled: boolSetting(readSetting(payload, 'backgroundComboEffects'), true),
            lockRipple: boolSetting(readSetting(payload, 'pieceLockRipple'), true),
        });
        this.world?.setReducedMotion(this.reducedMotion);
    }

    handleSettingsChanged(payload) {
        if (!this.renderer) return;
        const q = readSettingUpdate(payload, 'effectQuality');
        const current = this.pendingQuality ?? this.quality;
        if (q.present && normalizeQuality(q.value) !== current) {
            this.pendingQuality = normalizeQuality(q.value);
            this.queueRebuild();
            return;
        }
        this.applyReactionSettings(payload);
        // renderScale (incl. the adaptive PERFORMANCE_DOWNSCALE re-emit) = pixel ratio only;
        // deferred a microtask so main.js has applied setGlobalRenderScale() first.
        if (readSettingUpdate(payload, 'renderScale').present) {
            queueMicrotask(() => {
                if (!this.isActive) return;
                const { width, height } = getViewport();
                this.appliedSize = null;
                this.resize(width, height);
            });
        }
    }

    queueRebuild() {
        if (this.rebuildQueued) return;
        this.rebuildQueued = true;
        const scheduled = this.runtimeGeneration;
        queueMicrotask(() => {
            this.rebuildQueued = false;
            if (!this.isActive || scheduled !== this.runtimeGeneration) return;
            if (this.isPaused) {
                this.rebuildPending = true; // rebuild on resume, never behind the menu
                return;
            }
            this.carry = { time: this.time, level: this.level };
            this.createScene().catch((error) => {
                console.error(`${LOG_PREFIX} Settings rebuild failed:`, error);
                this.onRuntimeFailure?.(error);
            });
        });
    }

    // ── layout: events aim at the live board, the calm zones follow the card/HUD ──

    /**
     * No polling and no observers: the board/HUD rects are re-read inside the frame loop, on frame
     * time, at 0 s, +0.5 s and +1.5 s after a trigger — scene build, resize, resume, the mode
     * manager's modeStarted/modeActivated/modeStopped, game over. Never from a handler
     * (getBoundingClientRect forces layout).
     */
    scheduleLayoutReads() {
        for (let i = 0; i < LAYOUT_REREAD_OFFSETS.length; i += 1) {
            this.layoutDue[i] = this.layoutClock + LAYOUT_REREAD_OFFSETS[i];
        }
    }

    processLayoutReads() {
        let due = false;
        for (let i = 0; i < this.layoutDue.length; i += 1) {
            if (this.layoutClock >= this.layoutDue[i]) {
                this.layoutDue[i] = Infinity;
                due = true;
            }
        }
        if (!due) return;
        this.ensureModeManagerListeners();
        const rects = readLayoutRects();
        const ls = this.layout;
        // Once the board is gone the last rects stay for the calm zones to fade out on; the world
        // goes back to aiming at where the solo board would be.
        if (rects) ls.applied = rects;
        ls.live = Boolean(rects);
        this.world?.setLayout(rects);
    }

    /** The mode manager may appear after the first build (boot prewarm); subscribe once it does. */
    ensureModeManagerListeners() {
        const manager = typeof window !== 'undefined' ? window.serenityBlocks?.gameModeManager : null;
        if (!manager?.on || manager === this.modeManager) return;
        this.modeManager = manager;
        const relayout = () => this.scheduleLayoutReads();
        this.eventUnsubscribers.push(
            manager.on('modeStarted', relayout),
            manager.on('modeActivated', relayout),
            manager.on('modeStopped', () => this.resetSession()),
        );
    }

    /** Per frame: ease the calm zones in while a board is on screen, out when it leaves. */
    easeCalmZones(dt) {
        if (!this.post) return;
        const ls = this.layout;
        ls.strength += ((ls.live ? 1 : 0) - ls.strength) * approach(3, dt);
        const list = this._calmRects;
        list.length = 0;
        if (ls.applied) {
            for (let i = 0; i < ls.applied.cards.length && i < PLAYER_SLOTS - 1; i++) list.push(ls.applied.cards[i]);
            if (ls.applied.hud) list.push(ls.applied.hud);
        }
        this.post.setCalmRects(list, ls.applied ? ls.strength : 0);
    }

    // ── size ────────────────────────────────────────────────────────────────────

    /** The ThemeManager resize funnel (CSS px). Deduplicated. */
    resize(width, height) {
        if (!this.renderer || !this.camera) return;
        const w = Math.max(1, Math.round(Number(width) || 1));
        const h = Math.max(1, Math.round(Number(height) || 1));
        const pixelRatio = this.getEffectivePixelRatio(PIXEL_RATIO_CAP[this.quality] ?? PIXEL_RATIO_CAP.High, 'theme');
        const last = this.appliedSize;
        if (last && last.w === w && last.h === h && last.pixelRatio === pixelRatio) return;
        this.appliedSize = { w, h, pixelRatio };
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(w, h, false);
        this.renderer.getDrawingBufferSize(this.bufferSize);
        this.world?.setViewport(this.bufferSize.x, this.bufferSize.y, w / h);
        this.post?.setSize(w, h, this.bufferSize.x, this.bufferSize.y);
        this.director?.setViewport(w, h);
        this.scheduleLayoutReads();
    }

    // ── frame loop ──────────────────────────────────────────────────────────────

    animate() {
        if (this.animationLoopStarted || !this.world || !this.renderer) return;
        this.animationLoopStarted = true;
        this.lastFrameMs = null;
        const loop = this.safeAnimate((now) => this.stepFrame(now), { maxConsecutiveErrors: 3 });
        this.registerAnimation(requestAnimationFrame(loop));
    }

    buildSim(delta) {
        const sim = this._sim;
        sim.time = this.time;
        sim.delta = delta;
        sim.pointerX = this.pointer.sx;
        sim.pointerY = this.pointer.sy;
        return sim;
    }

    stepFrame(now) {
        const { world, renderer, camera } = this;
        if (!world || !renderer || !camera) return;
        const t = Number.isFinite(now) ? now : performance.now();
        const wall = this.lastFrameMs === null
            ? 1 / 60
            : Math.min(MAX_DELTA_S, Math.max(0, (t - this.lastFrameMs) / 1000));
        this.lastFrameMs = t;
        let delta = wall;
        if (this.flags.time !== null) delta = 0;
        else if (this.flags.fixedDt !== null) delta = this.flags.fixedDt;
        this.time += delta;
        this.layoutClock += wall;

        const k = approach(2.2, wall);
        this.pointer.sx += (this.pointer.x - this.pointer.sx) * k;
        this.pointer.sy += (this.pointer.y - this.pointer.sy) * k;

        // Other code may resize our renderer: pixel-sized content follows the real buffer.
        const bw = this.bufferSize.x;
        const bh = this.bufferSize.y;
        renderer.getDrawingBufferSize(this.bufferSize);
        if (this.bufferSize.x !== bw || this.bufferSize.y !== bh) {
            const { w, h } = this.appliedSize || { w: window.innerWidth, h: window.innerHeight };
            world.setViewport(this.bufferSize.x, this.bufferSize.y, w / h);
            this.post?.setSize(w, h, this.bufferSize.x, this.bufferSize.y);
        }

        this.processLayoutReads();
        const sim = this.buildSim(delta);
        // The camera first (events aim through it), then the gameplay staged since the last
        // frame, then the world: the picture is drawn from what it wrote this frame, so it runs
        // every frame, before the post stack renders.
        world.updateCamera(camera, sim);
        this.director?.flush();
        world.update(sim, camera);
        this.easeCalmZones(wall);

        if (this.post) {
            this.post.update(world.getPostState());
            this.post.update({ time: this.time });
            this.post.render();
        } else if (this.passThrough) {
            this.passThrough.render();
        } else {
            renderer.render(this.scene, camera);
        }
    }

    // ── lifecycle hooks ─────────────────────────────────────────────────────────

    async whenCriticalReady() {
        return !!(this.world && this.renderer && this.scene && this.camera);
    }

    /** No parked drawables: the world parks nothing for the manager to compile. */
    getWarmupRoots() {
        return [];
    }

    /** Single-output scene pass: the manager's bare prewarm compileAsync has nothing to poison. */
    usesMrtScenePass() {
        return false;
    }

    getDiagnostics() {
        return {
            lifecycle: this.lifecycleState,
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            quality: this.quality,
            pixelRatio: this.renderer?.getPixelRatio?.() ?? null,
            world: this.world?.getState() ?? null,
            reducedMotion: this.reducedMotion,
            droppedEvents: this.director?.droppedEvents ?? 0,
        };
    }

    pause() {
        const paused = super.pause();
        if (paused) {
            this.lastFrameMs = null;
        }
        return paused;
    }

    resume() {
        if (!this.world || !this.renderer || !this.scene || !this.camera) return false; // full restart
        const resumed = super.resume();
        if (resumed) {
            this.lastFrameMs = null;
            // ThemeManager.resize reaches only the ACTIVE theme: catch up on resizes missed while parked.
            const { width, height } = getViewport();
            this.resize(width, height);
            this.ensureModeManagerListeners();
            this.scheduleLayoutReads();
            if (this.rebuildPending) {
                this.rebuildPending = false;
                this.queueRebuild();
            }
        }
        return resumed;
    }

    disposeRuntime() {
        this.runtimeGeneration += 1;
        this.cancelAnimationFrames();
        this.animationLoopStarted = false;
        this.layoutDue.fill(Infinity);
        this.modeManager = null;
        this.clearEventUnsubscribers();
        this.eventUnsubscribers = [];
        this.clearTrackedResources();
        this.removeRendererResilience(); // before the device goes: a dispose is not a loss
        this.gpuSurfaceUnregister?.();
        this.gpuSurfaceUnregister = null;
        this.director = null;

        try {
            this.post?.dispose();
            this.passThrough?.dispose();
        } catch (error) {
            console.warn(`${LOG_PREFIX} Post dispose failed:`, error);
        }
        this.post = null;
        this.passThrough = null;
        try {
            this.world?.dispose();
        } catch (error) {
            console.warn(`${LOG_PREFIX} World dispose failed:`, error);
        }
        this.world = null;
        this.scene?.clear?.();
        this.scene = null;
        this.camera = null;

        if (this.renderer) {
            const { renderer } = this;
            this.renderer = null;
            let canvas = null;
            try {
                canvas = renderer.domElement;
            } catch {
                canvas = null;
            }
            // Stops the loop, quiesces timestamp queries, destroys the owned device.
            this.disposeRenderer(renderer, { nullInstance: false });
            if (canvas?.parentNode) canvas.parentNode.removeChild(canvas);
        }
        this.isWebGPU = false;
        this.appliedSize = null;
        this.lastFrameMs = null;
    }

    stop() {
        super.stop();
        this.disposeRuntime();
        // Totality ends here: only a rebuild in place carries its clock on.
        this.carry = null;
        this.time = 0;
    }

    cleanup() {
        this.stop();
        super.cleanup();
    }
}
