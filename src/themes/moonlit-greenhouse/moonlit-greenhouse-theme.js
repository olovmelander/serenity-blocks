/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  MOONLIT GREENHOUSE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A Victorian palm house at night, seen from the head of the lily canal that runs down its
 * nave. The full moon stands beyond the glass to the left of the board (above it on an upright
 * phone) and its light falls through the iron and glass of the pointed vault, so every beam in
 * the mist carries the shadow of the glazing bars and the lattice lies across the floor, the
 * leaves and the water. Palms rise to the vault, tree ferns and banana leaves crowd the beds,
 * reeds stand at the canal's edge, fireflies drift and luna moths circle the lanterns.
 *
 * The greenhouse blooms to the board. A locking piece sends a seed of light in its colour from
 * the card's edge into the garden, and where it lands a night flower opens in that colour (a
 * lily on the water; a hard drop also shakes a curtain of dew from the glass). A clear makes the
 * garden exhale: the cleared rows release ribbons of fireflies, a wave of moonlight runs across
 * the glazing pane by pane, and the oldest blooms give up their pollen to the beams. A chain pulls
 * the fireflies into step, from their own rhythms to rolling waves down the house to one flash,
 * and bioluminescent moss climbs the iron columns a step a link. Four lines hush the house; then
 * the Queen of the Night opens behind the board, her long white petals reaching out round it,
 * and moonlight floods every pane. A T-spin turns the air. The level moves the night along a
 * wheel of six, and the clock alone drifts it there too.
 *
 * Content lives in MoonlitGreenhouseWorld (moonlit-greenhouse-world.js), shared with the
 * playground effect src/playground/effects/moonlit-greenhouse.effect.js, so what is iterated
 * there ships. This class owns the lifecycle (BaseTheme), the renderer (WebGPURenderer on
 * WebGPU, else its WebGL2 backend; ?forceWebGL or ?greenhouseForceWebGL), the post stack,
 * gameplay events (through MoonlitGreenhouseDirector), the layout watch (events aim at the live
 * board, and the post's calm zones follow the card and HUD; read on frame time, never from a
 * handler), pointer parallax, reduced motion, settings, GPU-loss recovery and deterministic
 * capture flags:
 *   ?greenhouseTime=<s>      seek to t and freeze the simulation (captures)
 *   ?greenhouseFixedDt=<ms>  fixed frame step
 *   ?greenhouseParts=a,b     draw only these parts
 *   ?greenhouseFalseColor=1  post debug view
 *
 * The world is handed the renderer (it may paint a small target inside update(), before the
 * post stack draws the frame).
 *
 * The clock: `this.time` drives the night's drift and the moon's, so it is kept when the scene
 * is rebuilt in place (a quality change, a lost GPU device) and cleared only by stop(). A
 * rebuilt scene comes back on the night it had.
 *
 * Warm: none (every pool is always drawn with zero-size dormant slots, so the first frame
 * compiles every render pipeline; the scene pass has one output). Nothing is downloaded either:
 * the scene uses no texture or model files (its noise is baked on the CPU and its plants grown in
 * code when the world is built), so there is no load step and nothing arrives after the first
 * frame.
 */

import * as THREE from 'three/webgpu';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { registerGpuSurface } from '../../utils/gpu-loss-coordinator.js';
import { normalizeQuality } from '../../utils/quality.js';
import { getViewport } from '../../utils/viewport.js';
import { MOONLIT_GREENHOUSE_TETROMINOS } from './moonlit-greenhouse-tetrominos.js';
import { MoonlitGreenhouseWorld, REST_RIG, fovForAspect } from './moonlit-greenhouse-world.js';
import { GARDEN_NOISE_SEED, gardenNoiseKey, approach } from './moonlit-greenhouse-core.js';
import { tierFor } from './moonlit-greenhouse-quality.js';
import { bakeInWorker } from '../shared/bake-worker-client.js';
import { POST_LOOK, MoonlitGreenhousePost, createPassThroughPipeline } from './moonlit-greenhouse-post.js';
import { PLAYER_SLOTS, readLayoutRects } from './moonlit-greenhouse-composition.js';
import { MOONLIT_GREENHOUSE_EVENT_HANDLERS, MoonlitGreenhouseDirector } from './moonlit-greenhouse-director.js';
import { buildWorldBreathing } from '../shared/build-steps.js';

const THEME_ID = 'moonlit-greenhouse';
const LOG_PREFIX = '[Moonlit Greenhouse]';
const RENDERER_INIT_TIMEOUT_MS = 5500;
const MAX_DELTA_S = 0.05;
/** The night garden's own dark (the house covers every pixel; this is what a lost frame shows). */
const CLEAR_COLOR = 0x03080b;

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
    const t = num('greenhouseTime');
    const dt = num('greenhouseFixedDt');
    return {
        forceWebGL: bool('forceWebGL') || bool('greenhouseForceWebGL'),
        time: t !== null && t >= 0 ? t : null,
        fixedDt: dt !== null && dt > 0 ? dt / (dt > 1 ? 1000 : 1) : null,
        parts: params.get('greenhouseParts')
            ? params.get('greenhouseParts').split(',').map((p) => p.trim())
            : null,
        falseColor: bool('greenhouseFalseColor'),
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

/** A first visit's CPU bakes, in a worker (shared/bake-worker-client.js). */
export function moonlitGreenhouseBakes(quality) {
    return bakeInWorker({
        jobs: [{ kind: 'noise', args: [tierFor(quality).noise, GARDEN_NOISE_SEED] }],
        keyOf: ({ args }) => gardenNoiseKey(...args),
        createWorker: () => new Worker(new URL('./moonlit-greenhouse-bake.worker.js', import.meta.url), { type: 'module' }),
    });
}

export default class MoonlitGreenhouseTheme extends BaseTheme {
    constructor() {
        super(THEME_ID);
        // The registry lists this theme as heavy-GPU and the manager stamps that on the instance;
        // a theme built without the manager (the mobile validator) must say so itself.
        this.resourceProfile = 'heavy-gpu';
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
         * The theme clock (seconds). The night drifts on it, so it survives a rebuild in
         * place (quality change, GPU recovery); only stop() clears it.
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
        /** The true combo per director player slot: the house answers the longest chain. */
        this.combos = new Map();
        /** The level the run is on: a scene rebuilt mid-run (quality change, GPU recovery) takes it up again. */
        this.level = 1;
        this._sim = {
            time: 0, delta: 0, pointerX: 0, pointerY: 0,
        };
        this._calmRects = [];
    }

    getTetrominoConfig() {
        return MOONLIT_GREENHOUSE_TETROMINOS;
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

        // The garden noise (about 0.2 s of main thread on a first visit) bakes in a worker while
        // the renderer comes up; the build below then finds it in the bake cache.
        const baking = moonlitGreenhouseBakes(this.quality);
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

        await baking;
        if (!isCurrent()) return;

        try {
            // The world needs the renderer: it may paint a target inside update().
            const world = new MoonlitGreenhouseWorld({
                scene: this.scene,
                quality: this.quality,
                capture: this.flags.time !== null || this.flags.fixedDt !== null,
                renderer,
            });
            // Built in steps with a breath between them (one long task otherwise), and the theme's only
            // once whole: a stop meanwhile, or a part that throws half-way, disposes it there.
            if (!(await buildWorldBreathing(world, isCurrent))) return;
            this.world = world;
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
        this.director = new MoonlitGreenhouseDirector({
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

        // The clock is NOT reset here: createScene also runs for a rebuild in place (quality change,
        // GPU recovery), and the night and the moon are functions of the clock. A start after stop()
        // finds it at zero; a capture pins it.
        if (this.flags.time !== null) this.time = this.flags.time;
        this.scheduleLayoutReads();
        this.world.seek(this.time);
        // Rebuilt mid-run: the level's night, without the front that announced it long ago.
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
                label: `Moonlit Greenhouse ${forceWebGL ? 'WebGL2' : 'WebGPU'} renderer init`,
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
            throw new Error('Moonlit Greenhouse could not initialize WebGPU or WebGL2.', { cause: error });
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
                if (this.gpuRecoveryAttempted) throw new Error('Moonlit Greenhouse WebGPU recovery already attempted.');
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
            // The post walks the air with the world's moon, lights and noise.
            this.post = new MoonlitGreenhousePost(this.renderer, this.scene, this.camera, {
                look,
                antialias: this.getAntialiasEnabled(),
                falseColor: this.flags.falseColor,
                U: this.world.U,
                noise: this.world.noise,
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

        Object.keys(MOONLIT_GREENHOUSE_EVENT_HANDLERS).forEach((key) => {
            const handler = MOONLIT_GREENHOUSE_EVENT_HANDLERS[key];
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

    /** The house answers the longest chain any board is holding. */
    reportCombo(combo, player = 0) {
        if (combo > 0) this.combos.set(player, combo);
        else this.combos.delete(player);
        let best = 0;
        this.combos.forEach((n) => {
            if (n > best) best = n;
        });
        this.world?.onCombo(best);
    }

    /** A new run: back to rest, no chain in flight (the clock, and so the night's drift, runs on). */
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
        // frame, then the world.
        world.updateCamera(camera, sim);
        this.director?.flush();
        world.update(sim, camera);
        this.easeCalmZones(wall);

        if (this.post) {
            // The world's post state is one object reused every frame; the clock rides on it.
            const postState = world.getPostState();
            postState.time = this.time;
            this.post.update(postState);
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
