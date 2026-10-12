/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  RAINBARK
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A cathedral of colossal painted giants rising out of a floor of luminous mist, in blue air.
 * We hang in the middle storey, looking level into the haze: on the left the Elder, a cropped
 * wall of bark whose face is a mosaic of tall lozenges in every age of the spectrum (chartreuse
 * against teal, cobalt against violet, ruby against ember, most of it old maroon husk); deep on
 * the right two slim Sisters, and between them and the card nothing but sunlit air; behind the
 * card the grove recedes on a diagonal, each rank paler and bluer, into endless faint verticals.
 * The sun stands high and out of frame on the right, so its flecks land on the faces where the
 * pieces peel; below, the trunks plunge into cream mist; above, a dark lace of canopy.
 *
 * Every piece is one age of the bark. A lock peels a strip off a lane trunk and the bark under it
 * is the piece's colour (a hard drop knocks the giant); a clear sheds a girdle at each cleared
 * row, and the ring ripens into the row's own colours; four lines make the whole grove moult;
 * each step of a chain opens the canopy one counted pool of sunlight; the chain's end lets a
 * curtain of curls fall; back-to-backs bring a sunshower; a T-spin unwinds a helix with amber
 * beads; a perfect clear drains the mist to show the forest floor; a new level climbs a storey;
 * the end of a run lets the mist rise, and the next run brings the morning back.
 *
 * Content lives in RainbarkWorld (rainbark-world.js), shared with the playground effect
 * src/playground/effects/rainbark.effect.js, so what is iterated there ships. This class owns
 * the lifecycle (BaseTheme), the renderer (WebGPURenderer on WebGPU, else its WebGL2 backend;
 * ?forceWebGL or ?rainbarkForceWebGL), the post stack, gameplay events (through
 * RainbarkDirector), the layout watch (events aim at the live board, and the post's calm zones
 * follow the card and HUD; read on frame time, never from a handler), pointer parallax, reduced
 * motion, settings, GPU-loss recovery and deterministic capture flags:
 *   ?rainbarkTime=<s>      seek to t and freeze the simulation (captures)
 *   ?rainbarkFixedDt=<ms>  fixed frame step
 *   ?rainbarkParts=a,b     draw only these parts
 *   ?rainbarkFalseColor=1  post debug view
 *
 * The clock: `this.time` drives the tide, the sun's drift and the bark's ripening, so it is kept
 * when the scene is rebuilt in place (a quality change, a lost GPU device) and cleared only by
 * stop(). The run's level is kept the same way: a rebuilt scene comes back at its storey.
 *
 * Warm: none (every pool is always drawn with zero-size dormant slots, so the first frame
 * compiles every render pipeline; the scene pass has one output). Nothing is downloaded either:
 * the scene uses no texture or model files (its textures are baked on the CPU when the world is
 * built), so there is no load step and nothing arrives after the first frame.
 */

import * as THREE from 'three/webgpu';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { registerGpuSurface } from '../../utils/gpu-loss-coordinator.js';
import { normalizeQuality } from '../../utils/quality.js';
import { getViewport } from '../../utils/viewport.js';
import { RAINBARK_TETROMINOS } from './rainbark-tetrominos.js';
import { RainbarkWorld, REST_RIG, fovForAspect } from './rainbark-world.js';
import { POST_LOOK, RainbarkPost, createPassThroughPipeline } from './rainbark-post.js';
import { PLAYER_SLOTS, readLayoutRects } from './rainbark-composition.js';
import { RAINBARK_EVENT_HANDLERS, RainbarkDirector } from './rainbark-director.js';
import { approach } from './rainbark-core.js';

const THEME_ID = 'rainbark';
const LOG_PREFIX = '[Rainbark]';
const RENDERER_INIT_TIMEOUT_MS = 5500;
const MAX_DELTA_S = 0.05;
/**
 * A deep terpene shade (the backdrop covers every pixel; this is what a lost frame shows): a
 * mid-dark blue, so the container's fade never flashes white or black.
 */
const CLEAR_COLOR = 0x3a4a72;

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
    const t = num('rainbarkTime');
    const dt = num('rainbarkFixedDt');
    return {
        forceWebGL: bool('forceWebGL') || bool('rainbarkForceWebGL'),
        time: t !== null && t >= 0 ? t : null,
        fixedDt: dt !== null && dt > 0 ? dt / (dt > 1 ? 1000 : 1) : null,
        parts: params.get('rainbarkParts')
            ? params.get('rainbarkParts').split(',').map((p) => p.trim())
            : null,
        falseColor: bool('rainbarkFalseColor'),
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

export default class RainbarkTheme extends BaseTheme {
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
        /**
         * The theme clock (seconds). The tide, the sun's drift and the bark's ripening run on it,
         * so it survives a rebuild in place (quality change, GPU recovery); only stop() clears it.
         */
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
        /** The true combo per director player slot: the canopy answers the longest chain. */
        this.combos = new Map();
        /** The live back-to-back level per player slot: the sunshower answers the heaviest. */
        this.b2bs = new Map();
        /** The level the run is on: a scene rebuilt mid-run (quality change, GPU recovery) climbs back to it. */
        this.level = 1;
        this._sim = {
            time: 0, delta: 0, pointerX: 0, pointerY: 0,
        };
        this._calmRects = [];
    }

    getTetrominoConfig() {
        return RAINBARK_TETROMINOS;
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
            // Owned before it is built: a build that fails half-way is still disposed.
            this.world = new RainbarkWorld({
                scene: this.scene,
                quality: this.quality,
                capture: this.flags.time !== null || this.flags.fixedDt !== null,
            });
            this.world.build();
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
        this.b2bs.clear();
        this.director = new RainbarkDirector({
            sink: {
                lock: (c) => this.world?.onLock(c),
                clear: (c) => this.world?.onClear(c),
                combo: (n, player) => this.reportCombo(n, player),
                b2b: (level, player) => this.reportB2B(level, player),
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

        // The clock is NOT reset here: createScene also runs for a rebuild in place (quality change,
        // GPU recovery), and the tide and the bark are functions of the clock. A start after stop()
        // finds it at zero; a capture pins it.
        if (this.flags.time !== null) this.time = this.flags.time;
        this.scheduleLayoutReads();
        this.world.seek(this.time);
        // Rebuilt mid-run: straight to the level's storey, without the climb that announced it.
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
        // The canvas only receives the output quad (the scene pass owns depth).
        const attempt = (forceWebGL) => this.initializeRendererCandidate(
            new THREE.WebGPURenderer({
                antialias: false, depth: false, alpha: false, forceWebGL, powerPreference: 'high-performance',
            }),
            {
                timeoutMs: RENDERER_INIT_TIMEOUT_MS,
                label: `Rainbark ${forceWebGL ? 'WebGL2' : 'WebGPU'} renderer init`,
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
            throw new Error('Rainbark could not initialize WebGPU or WebGL2.', { cause: error });
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
                if (this.gpuRecoveryAttempted) throw new Error('Rainbark WebGPU recovery already attempted.');
                this.gpuRecoveryAttempted = true;
                this.forceWebGL = true; // one-shot retry on the WebGL2 backend
                if (this.isActive) await this.createScene();
            },
        });
    }

    setupPost() {
        const look = POST_LOOK[this.quality] || POST_LOOK.High;
        this.post = null;
        this.passThrough = null;
        try {
            this.post = new RainbarkPost(this.renderer, this.scene, this.camera, {
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

        Object.keys(RAINBARK_EVENT_HANDLERS).forEach((key) => {
            const handler = RAINBARK_EVENT_HANDLERS[key];
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
        this.registerEventListener(window, 'gameOver', () => this.endRun());

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

    /** The canopy answers the longest chain any board is holding. */
    reportCombo(combo, player = 0) {
        this.world?.onCombo(this.bestOf(this.combos, combo, player));
    }

    /** The sunshower answers the heaviest back-to-back run any board is holding. */
    reportB2B(level, player = 0) {
        this.world?.onB2B(this.bestOf(this.b2bs, level, player));
    }

    /** Record one board's value (0 forgets it) and return the largest any board holds. */
    bestOf(map, value, player) {
        if (value > 0) map.set(player, value);
        else map.delete(player);
        let best = 0;
        map.forEach((n) => {
            if (n > best) best = n;
        });
        return best;
    }

    /** A run ended (game over, or the mode stopped): Mistfall, then a new session. */
    endRun() {
        this.world?.onGameOver();
        this.resetSession();
    }

    /** A new run: back to rest, no chain or rain in flight (the clock, and so the tide, runs on). */
    resetSession() {
        this.director?.reset();
        this.combos.clear();
        this.b2bs.clear();
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
            manager.on('modeStarted', () => {
                relayout();
                this.world?.onSessionStart();
            }),
            manager.on('modeActivated', relayout),
            manager.on('modeStopped', () => this.endRun()),
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
        // frame, then the world.
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

    /** Nothing is parked for the manager to compile: what the world draws is in its scene. */
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
        // The next start is a new sitting: its clock starts over. (The run's level is kept, as a
        // rebuild keeps it: a theme switched away from and back mid-run returns on its level.)
        this.time = 0;
    }

    cleanup() {
        this.stop();
        super.cleanup();
    }
}
