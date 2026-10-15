/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  OCEAN — a reef canyon at the edge of the blue
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The viewer rests in the mouth of a reef canyon, looking out and a little upward. Overhead the
 * surface rolls and the sun's light comes down through the water in shafts that wander over
 * sand and coral; a garden of coral rises on either side, kelp climbs the shoulders behind, a
 * silver school streams through the canyon and something large is always passing in the blue.
 * The board stands in the canyon's mouth: a locking piece's light sinks to the reef on its
 * side, lands in a ring and a crown of sparks, startles the fish and leaves the colonies there
 * glowing in its colour; a clear sends a current across the canyon that bends kelp and grass as
 * its front passes, draws the school out into a ribbon at the cleared rows' height and lets
 * every held colour go, the corals spawning in the pieces' colours; a chain calls the sea's
 * large animals in from the blue, one more with each step — a turtle, mantas, a whale far out,
 * and at the top the whale comes over the board, its shadow cutting the shafts, and sings; four
 * lines hold the sea's breath, then one great shaft comes down over the board, the school winds
 * itself round it and the whole reef spawns. A new level turns the light to its next hour (six
 * on a wheel, from the high sun to the moon with the sea alight), and the light also moves on
 * slowly by itself, an hour every 100 s, whatever the level.
 *
 * Content lives in OceanWorld (ocean-world.js), shared with the playground effect
 * src/playground/effects/ocean.effect.js, so what is iterated there ships. Nothing is loaded:
 * every mesh is grown in code and every texture is baked or painted on the GPU. This class owns
 * the lifecycle (BaseTheme), the renderer (WebGPURenderer on WebGPU, else its WebGL2 backend;
 * ?forceWebGL or ?oceanForceWebGL), the post stack, gameplay events (through OceanDirector),
 * the layout watch (events aim at the live board, and the post's calm zones follow the card and
 * HUD; read on frame time, never from a handler), pointer parallax, reduced motion, settings,
 * GPU-loss recovery and deterministic capture flags:
 *   ?oceanTime=<s>      seek to t and freeze the simulation (captures)
 *   ?oceanFixedDt=<ms>  fixed frame step
 *   ?oceanParts=surface,seabed,...   draw only these parts (the names the world gives them)
 *   ?oceanFalseColor=1  post debug view
 *
 * A quality change builds a new world: at once while the theme is on screen, through a full
 * restart when it was chosen behind the menu (resume() hands the theme back to the manager, so
 * there is one build under the loading mask, never a resume followed by a rebuild). The tier is
 * read when the renderer is ready, so one chosen while it initialised is not lost. A rebuild in
 * place (a new tier while on screen, a WebGPU device loss) comes back at the run's level and at
 * the hour the light's clock had drifted to; a full restart goes through stop(), which forgets
 * the level and the clock.
 *
 * Warm: none declared (getWarmupRoots() is empty, usesMrtScenePass() is false). That holds while
 * the world parks nothing at visible = false for an event to reveal and the post's scene pass has
 * one output; change those two hooks if either stops being true.
 */

import * as THREE from 'three/webgpu';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { registerGpuSurface } from '../../utils/gpu-loss-coordinator.js';
import { normalizeQuality } from '../../utils/quality.js';
import { getViewport } from '../../utils/viewport.js';
import { OCEAN_TETROMINOS } from './ocean-tetrominos.js';
import { OceanWorld, REST_RIG, fovForAspect } from './ocean-world.js';
import { oceanBakes } from './ocean-bakes.js';
import { POST_LOOK, OceanPost, createPassThroughPipeline } from './ocean-post.js';
import { PLAYER_SLOTS, readLayoutRects } from './ocean-composition.js';
import { OCEAN_EVENT_HANDLERS, OceanDirector } from './ocean-director.js';
import { approach } from './ocean-core.js';

const THEME_ID = 'ocean';
const LOG_PREFIX = '[Ocean]';
const CANVAS_ID = 'ocean-renderer';
const RENDERER_INIT_TIMEOUT_MS = 5500;
const MAX_DELTA_S = 0.05;
/** Pure black: the canvas before its first frame. */
const CLEAR_COLOR = 0x000000;

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
    const t = num('oceanTime');
    const dt = num('oceanFixedDt');
    return {
        forceWebGL: bool('forceWebGL') || bool('oceanForceWebGL'),
        time: t !== null && t >= 0 ? t : null,
        fixedDt: dt !== null && dt > 0 ? dt / (dt > 1 ? 1000 : 1) : null,
        parts: params.get('oceanParts')
            ? params.get('oceanParts').split(',').map((p) => p.trim())
            : null,
        falseColor: bool('oceanFalseColor'),
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

export default class OceanTheme extends BaseTheme {
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
        this.time = 0;
        this.lastFrameMs = null;
        this.animationLoopStarted = false;
        /** True once a build has laid out its first frame, until its runtime is retired. */
        this.built = false;
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
        /** The true combo per director player slot: the world is told the longest chain. */
        this.combos = new Map();
        /** The run's level (0 = none reported yet): a rebuild mid-run comes back at it. */
        this.level = 0;
        this._sim = {
            time: 0, delta: 0, pointerX: 0, pointerY: 0,
        };
        this._calmRects = [];
    }

    getTetrominoConfig() {
        return OCEAN_TETROMINOS;
    }

    // ── build ───────────────────────────────────────────────────────────────────

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        const container = document.getElementById(`${this.name}-theme`);
        if (!container) throw new Error(`${LOG_PREFIX} Theme container not found.`);

        // A rebuild in place keeps the place the light had reached on the wheel (the levels'
        // share of it; the clock's share goes on with this.time). A full restart has none.
        const keptPlace = this.world?.getState()?.levelPlace;
        this.disposeRuntime();
        const generation = ++this.runtimeGeneration;
        const isCurrent = () => generation === this.runtimeGeneration
            && ownerGeneration === this.lifecycleGeneration
            && this.isActive
            && !this.cleanupComplete;

        container.replaceChildren();
        this.flags = readFlags();

        // The seabed's sheet (about 0.5 s of main thread on a first visit) bakes in a worker while
        // the renderer comes up, for the tier the settings name now; the build finds it in the bake
        // cache. A tier saved meanwhile is still read below: the build then bakes what it lacks.
        const baking = oceanBakes(this.pendingQuality ?? normalizeQuality(readSetting(null, 'effectQuality')));
        const renderer = await this.createRenderer(ownerGeneration);
        if (!renderer) return; // cancelled: BaseTheme retires the stale start
        if (!isCurrent()) {
            this.disposeRenderer(renderer, { nullInstance: false });
            return;
        }
        // The tier is read only now. Nothing listens for settings while the renderer initialises
        // (the last runtime's listeners went with it), so a tier chosen meanwhile is found here;
        // and a superseded build never uses up the tier a newer one was queued for.
        const savedTier = normalizeQuality(readSetting(null, 'effectQuality'));
        this.quality = this.pendingQuality ?? savedTier;
        this.pendingQuality = null;
        this.rebuildPending = false; // whatever was queued behind the menu, this build is it
        this.renderer = renderer;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
        renderer.setClearColor(CLEAR_COLOR, 1);
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.id = CANVAS_ID;
        renderer.domElement.setAttribute('aria-hidden', 'true');
        renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;'
            + 'z-index:0;pointer-events:none';
        container.appendChild(renderer.domElement);
        this.setupGpuResilience();

        const initial = getViewport();
        this.scene = new THREE.Scene();
        const aspect = Math.max(1, initial.width) / Math.max(1, initial.height);
        this.camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);

        await baking;
        if (!isCurrent()) return;

        try {
            this.world = new OceanWorld({
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
        this.director = new OceanDirector({
            sink: {
                lock: (c) => this.world?.onLock(c),
                clear: (c) => this.world?.onClear(c),
                combo: (n, player) => this.reportCombo(n, player),
                levelUp: (level) => this.reportLevel(level),
            },
        });
        const { width, height } = getViewport();
        this.appliedSize = null;
        this.resize(width, height);
        this.applyReactionSettings(null);
        this.setupEvents();
        this.layout = { applied: null, live: false, strength: 0 };
        this.modeManager = null;

        // The light's own clock goes on across a rebuild in place (a new tier while on screen, a
        // WebGPU device loss): the hour it had drifted to is not lost. A full restart begins anew.
        this.time = this.flags.time ?? this.time;
        this.scheduleLayoutReads();
        this.world.seek(this.time);
        // A rebuild in place in the middle of a run comes back at the run's level, without the
        // level-up's ceremony.
        if (Number.isFinite(keptPlace)) {
            this.world.levelUp(Math.max(1, this.level), { silent: true, place: keptPlace });
        } else if (this.level > 0) this.world.levelUp(this.level, { silent: true });
        this.world.updateCamera(this.camera, this.buildSim(0));
        this.world.update(this.buildSim(0), this.camera);

        this.built = true;
        if (!this.isPaused) this.animate();
        const backend = this.isWebGPU ? 'WebGPU' : 'WebGL2';
        console.log(`${LOG_PREFIX} Scene ready (${backend}, ${this.quality})`);

        // A tier saved while the world was being built is found here and built next, the way any
        // other change of tier is (the saved tier is compared with itself, before and after: a
        // tier an event named is not second-guessed).
        const savedNow = normalizeQuality(readSetting(null, 'effectQuality'));
        if (savedNow !== savedTier && savedNow !== this.quality) {
            this.pendingQuality = savedNow;
            this.queueRebuild();
        }
    }

    async createRenderer(ownerGeneration) {
        const wantWebGL = this.forceWebGL || this.flags.forceWebGL;
        const canTryWebGPU = !wantWebGL && typeof navigator !== 'undefined' && !!navigator.gpu;
        const stillOwned = () => ownerGeneration === this.lifecycleGeneration && this.isActive && !this.cleanupComplete;
        // The canvas only receives the output quad (the post stack's scene pass owns depth).
        const attempt = (forceWebGL) => this.initializeRendererCandidate(
            new THREE.WebGPURenderer({
                antialias: false, depth: false, alpha: false, forceWebGL, powerPreference: 'high-performance',
            }),
            {
                timeoutMs: RENDERER_INIT_TIMEOUT_MS,
                label: `Ocean ${forceWebGL ? 'WebGL2' : 'WebGPU'} renderer init`,
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
            throw new Error('Ocean could not initialize WebGPU or WebGL2.', { cause: error });
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
                if (this.gpuRecoveryAttempted) throw new Error('Ocean WebGPU recovery already attempted.');
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
            this.post = new OceanPost(this.renderer, this.scene, this.camera, {
                look,
                u: this.world.u,
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

        Object.keys(OCEAN_EVENT_HANDLERS).forEach((key) => {
            const handler = OCEAN_EVENT_HANDLERS[key];
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
        this.registerEventListener(window, 'gameOver', () => this.handleGameOver());

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
        // The pointer has left the page when a pointerout names nothing it went to.
        const onPointerOut = (event) => {
            if (!event?.relatedTarget) resetPointer();
        };
        this.registerEventListener(window, 'pointermove', onPointerMove, { passive: true });
        this.registerEventListener(window, 'pointerout', onPointerOut, { passive: true });
        this.registerEventListener(window, 'blur', resetPointer);
        const mq = typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)')
            : null;
        this.reducedMotionQuery = mq;
        if (typeof mq?.addEventListener === 'function') {
            this.registerEventListener(mq, 'change', () => this.applyReactionSettings(null));
        }
    }

    /** The world is told the longest chain any board is holding. */
    reportCombo(combo, player = 0) {
        if (combo > 0) this.combos.set(player, combo);
        else this.combos.delete(player);
        let best = 0;
        this.combos.forEach((n) => {
            if (n > best) best = n;
        });
        this.world?.onCombo(best);
    }

    /** A new level: the world is told, and a rebuild will find the level again. */
    reportLevel(level) {
        this.level = level;
        this.world?.levelUp(level);
    }

    /** The run is over: the world marks the ending, and then the session is reset whatever that did. */
    handleGameOver() {
        try {
            this.world?.onGameOver?.();
        } finally {
            this.resetSession();
        }
    }

    /** A new run: the world back at rest, no combo in flight, no level reached. */
    resetSession() {
        this.director?.reset();
        this.combos.clear();
        this.level = 0;
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
                this.rebuildPending = true; // never behind the menu: resume() asks for a restart
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
        const size = this.appliedSize;
        this.world?.setLayout(rects, size ? size.w / size.h : undefined);
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
        // Not before the build is through: the manager restarts a theme's loop on a resume and
        // when the tab comes back, whatever the theme is in the middle of.
        if (this.animationLoopStarted || !this.built || !this.world || !this.renderer) return;
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
        // The light the surface throws, painted once for everything that reads it this frame.
        world.paint(renderer);

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
        return !!(this.built && this.world && this.renderer && this.scene && this.camera);
    }

    /** No warm roots declared: see the note on warming at the top of this file. */
    getWarmupRoots() {
        return [];
    }

    /** Declared single-output: see the note on warming at the top of this file. */
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
        // A tier chosen behind the menu: super.resume() hands the theme back for one full restart,
        // which carries its run (clock and level) over.
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
        this.built = false;
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
        // A stopped theme holds no run and no queued rebuild: the next start reads the saved tier,
        // and its light begins at the level's own hour.
        this.level = 0;
        this.time = 0;
        this.pendingQuality = null;
        this.rebuildPending = false;
    }

    cleanup() {
        this.stop();
        super.cleanup();
    }
}
