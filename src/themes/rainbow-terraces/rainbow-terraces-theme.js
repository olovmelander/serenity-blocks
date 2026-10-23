/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  RAINBOW TERRACES
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The edge of the high country, far above anything solid, with the sun low behind the viewer:
 * everything ahead is lit full-face under the other half of the sky, a cobalt zenith paling to
 * an aqua-pearl haze. Left of the card the Spring Isle hangs in the air, white travertine
 * terraces stepping down its face with a milky-jade pool on every lip, and the Mother Fall pours
 * from it into the bottomless Deep below; right of the HUD the Twin Isle reaches a broken span
 * toward the card. Water-droplet optics stand in the spray, away from the sun: the bow and its
 * secondary, a fogbow on the Deep, the glow and the glory at the point the isles' shadows run to.
 * Folded paper gliders circle on the updrafts over the falls.
 *
 * The board is the spring of the high country. A locking piece leaves the card as a light-copy
 * of itself, melts into a thread of light-water and lands in the terraced pool on its side
 * nearest its row; the pool holds its colour (a hard drop fires a straight jet and overflows it).
 * A clear pours the cleared rows off the card's sides, sends a surge down every fall and lets the
 * oldest held pools go, their colours riding down the white water as ribbons. While a chain
 * holds, the gliders paint the bow into the spray one stroke per link, until from this height
 * it closes into a full circle. Four lines hush the world, open the glory one ring per line and
 * then let every pool go at once. A T-spin wrings the falls; a new level tolls the bell on the
 * Spring Isle and turns the light one hour on its wheel of five (jade morning, gilded afternoon,
 * rose hour, moonbow night, pearl dawn), and the light also walks round that wheel by itself,
 * whatever the level.
 *
 * Content lives in RainbowTerracesWorld (rainbow-terraces-world.js), shared with the playground effect
 * src/playground/effects/rainbow-terraces.effect.js, so what is iterated there ships. Nothing is
 * loaded: every mesh is grown in code and every texture is baked on the CPU. This class owns the
 * lifecycle (BaseTheme), the renderer (WebGPURenderer on WebGPU, else its WebGL2 backend;
 * ?forceWebGL or ?rainbowTerracesForceWebGL), the post stack, gameplay events (through
 * RainbowTerracesDirector), the layout watch (events aim at the live board, and the post's calm
 * zones follow the card and HUD; read on frame time, never from a handler), pointer parallax,
 * reduced motion, settings, GPU-loss recovery and deterministic capture flags:
 *   ?rainbowTerracesTime=<s>      seek to t and freeze the simulation (captures)
 *   ?rainbowTerracesFixedDt=<ms>  fixed frame step
 *   ?rainbowTerracesParts=a,b     draw only these parts (the names in RAINBOW_TERRACES_PARTS)
 *   ?rainbowTerracesFalseColor=1  post debug view
 *
 * The world is handed the renderer; everything it shows is in the scene the post stack renders.
 * update() runs every frame, before the post stack draws the frame, and once when the scene is
 * built.
 *
 * The clock: `this.time` turns the light round its wheel of hours, so it is kept when the scene
 * is rebuilt in place (a quality change on screen, a lost WebGPU device), and so are the run's
 * level and its turn of the wheel, which are taken up again silently. A restart that replaces a
 * runtime of the same sitting carries them too: a tier chosen behind the menu (resume() hands the
 * theme back to the manager for one build under its loading mask, never a resume followed by a
 * rebuild that would retire the renderer the manager watches) and a restored WebGL2 context.
 * Any other stop() forgets them. A rebuilt scene comes back in the light it had. The tier is read
 * once the renderer is ready, and again after the build, so one chosen meanwhile is not lost.
 * The end of a run is the world's to mark first (onGameOver), then the session is reset.
 *
 * Warm: none (getWarmupRoots() is empty, usesMrtScenePass() is false). That holds while the world
 * parks nothing at visible = false for an event to reveal (its pools are drawn from the first
 * frame with zero-size dormant slots) and the post's scene pass has one output; change those two
 * hooks if either stops being true.
 */

import * as THREE from 'three/webgpu';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { registerGpuSurface } from '../../utils/gpu-loss-coordinator.js';
import { normalizeQuality } from '../../utils/quality.js';
import { getViewport } from '../../utils/viewport.js';
import { RAINBOW_TERRACES_TETROMINOS } from './rainbow-terraces-tetrominos.js';
import {
    RainbowTerracesWorld, REST_RIG, fovForAspect, rainbowTerracesBakeJobs, rainbowTerracesBakeKey,
} from './rainbow-terraces-world.js';
import { bakeInWorker } from '../shared/bake-worker-client.js';
import { POST_LOOK, RainbowTerracesPost, createPassThroughPipeline } from './rainbow-terraces-post.js';
import { PLAYER_SLOTS, readLayoutRects } from './rainbow-terraces-composition.js';
import { RAINBOW_TERRACES_EVENT_HANDLERS, RainbowTerracesDirector } from './rainbow-terraces-director.js';
import { approach } from './rainbow-terraces-core.js';
import { buildWorldBreathing } from '../shared/build-steps.js';

const THEME_ID = 'rainbow-terraces';
const LOG_PREFIX = '[Rainbow Terraces]';
const CANVAS_ID = 'rainbow-terraces-renderer';
const RENDERER_INIT_TIMEOUT_MS = 5500;
const MAX_DELTA_S = 0.05;
/** The night zenith (the sky covers every pixel; this is what a lost frame shows). */
const CLEAR_COLOR = 0x0b0f2e;

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

/**
 * The capture flags in the page's URL (re-read on every build).
 * @returns {{ forceWebGL: boolean, time: number|null, fixedDt: number|null, parts: string[]|null,
 *   falseColor: boolean }}
 */
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
    const t = num('rainbowTerracesTime');
    const dt = num('rainbowTerracesFixedDt');
    return {
        forceWebGL: bool('forceWebGL') || bool('rainbowTerracesForceWebGL'),
        time: t !== null && t >= 0 ? t : null,
        fixedDt: dt !== null && dt > 0 ? dt / (dt > 1 ? 1000 : 1) : null,
        parts: params.get('rainbowTerracesParts')
            ? params.get('rainbowTerracesParts').split(',').map((p) => p.trim())
            : null,
        falseColor: bool('rainbowTerracesFalseColor'),
    };
}

/**
 * Settings payloads arrive in three shapes: the window 'settingsChanged' detail holds only the
 * changed keys; the bus SETTINGS_CHANGED carries `{ settings, source }` or `{ type, value }`.
 * @param {any} payload
 * @param {string} key
 * @returns {{ present: boolean, value: any }}
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

/** A setting from the payload if it names it, else the saved one. */
function readSetting(payload, key) {
    const update = readSettingUpdate(payload, key);
    if (update.present) return update.value;
    return typeof window !== 'undefined' ? window.settings?.[key] : undefined;
}

/** A boolean setting however it is spelt ('off', 'false', '0', 'no' and their opposites). */
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
export function rainbowTerracesBakes(quality) {
    return bakeInWorker({
        jobs: rainbowTerracesBakeJobs(quality),
        keyOf: rainbowTerracesBakeKey,
        createWorker: () => new Worker(new URL('./rainbow-terraces-bake.worker.js', import.meta.url), { type: 'module' }),
    });
}

export default class RainbowTerracesTheme extends BaseTheme {
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
         * The theme clock (seconds). The light walks round its wheel of hours on it, so it
         * survives a rebuild in place (quality change, GPU recovery); only stop() clears it.
         */
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
        /** The run a restart of this sitting takes with it (snapshotRun()); stop() forgets it. */
        this.keptRun = null;
        /** The run the start in progress carries into its build (runStartAttempt -> createScene). */
        this.carriedRun = null;
        /** The saved tier as last seen (at a build or an event): one saved since is the newest choice. */
        this.savedTierSeen = null;
        /** The true combo per director player slot: the world follows the longest chain. */
        this.combos = new Map();
        /** The level the run is on: a scene rebuilt mid-run (quality change, GPU recovery) takes it up again. */
        this.level = 1;
        this._sim = {
            time: 0, delta: 0, pointerX: 0, pointerY: 0,
        };
        this._calmRects = [];
    }

    getTetrominoConfig() {
        return RAINBOW_TERRACES_TETROMINOS;
    }

    // ── build ───────────────────────────────────────────────────────────────────

    /**
     * Build (or rebuild in place) the renderer, the world, the post stack and the wiring.
     * @param {number} [ownerGeneration]
     */
    async createScene(ownerGeneration = this.lifecycleGeneration) {
        const container = document.getElementById(`${this.name}-theme`);
        if (!container) throw new Error(`${LOG_PREFIX} Theme container not found.`);

        // What this sitting has walked: the old world's (a rebuild in place), or the run a restart
        // of the sitting carried in (its stop() has already forgotten it).
        const carried = this.carriedRun;
        this.carriedRun = null;
        const run = carried ?? (this.world ? this.snapshotRun() : null);
        if (carried) {
            this.time = carried.time;
            this.level = carried.level;
        }
        this.disposeRuntime();
        const generation = ++this.runtimeGeneration;
        const isCurrent = () => generation === this.runtimeGeneration
            && ownerGeneration === this.lifecycleGeneration
            && this.isActive
            && !this.cleanupComplete;

        container.replaceChildren();
        this.flags = readFlags();

        // The first visit's CPU bakes (sea field, optics, noises, puff) run in a worker while the
        // renderer comes up, for the tier the settings name now; the build finds them in the bake
        // cache. A tier saved meanwhile is still read below: the build then bakes what it lacks.
        const baking = rainbowTerracesBakes(this.pendingQuality ?? normalizeQuality(readSetting(null, 'effectQuality')));
        const renderer = await this.createRenderer(ownerGeneration);
        if (!renderer) return; // cancelled: BaseTheme retires the stale start
        if (!isCurrent()) {
            this.disposeRenderer(renderer, { nullInstance: false });
            return;
        }
        // The tier is read only now. Nothing listens for settings while the renderer initialises
        // (the last runtime's listeners went with it), so a tier saved meanwhile is found here and
        // wins over the one an earlier event named; and a superseded build never uses up the tier
        // a newer one was queued for.
        const savedTier = normalizeQuality(readSetting(null, 'effectQuality'));
        const savedSince = savedTier !== this.savedTierSeen;
        this.quality = (savedSince ? null : this.pendingQuality) ?? savedTier;
        this.savedTierSeen = savedTier;
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

        const { width, height } = getViewport();
        this.scene = new THREE.Scene();
        const aspect = Math.max(1, width) / Math.max(1, height);
        this.camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);

        await baking;
        if (!isCurrent()) return;

        try {
            const world = new RainbowTerracesWorld({
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
        this.director = new RainbowTerracesDirector({
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
        // GPU recovery), and the hour the light has walked to is a function of the clock. A start
        // after stop() finds it at zero; a capture pins it.
        if (this.flags.time !== null) this.time = this.flags.time;
        this.scheduleLayoutReads();
        // Rebuilt mid-run: the run's own turn of the wheel (a new run, its levels), without the
        // bell that announced a level long ago. A capture pins the clock and starts at level 1.
        const hours = this.flags.time === null ? run?.hours ?? null : null;
        this.world.seek(this.time, { hours });
        if (!hours && this.level > 1) this.world.levelUp(this.level, { silent: true });
        this.world.updateCamera(this.camera, this.buildSim(0));
        this.world.update(this.buildSim(0), this.camera);

        this.built = true;
        if (!this.isPaused) this.animate();
        const backend = this.isWebGPU ? 'WebGPU' : 'WebGL2';
        console.log(`${LOG_PREFIX} Scene ready (${backend}, ${this.quality})`);

        // Nobody listened for settings while the world was built either. A tier saved in that time
        // is built next, the way any other change of tier is (the saved tier is compared with
        // itself, before and after: a tier an event named is not second-guessed).
        const savedNow = normalizeQuality(readSetting(null, 'effectQuality'));
        if (savedNow !== savedTier && savedNow !== this.quality) {
            this.pendingQuality = savedNow;
            this.savedTierSeen = savedNow;
            this.queueRebuild();
        }
    }

    /** The run as far as it has gone: its clock, its level and its turn of the wheel of hours. */
    snapshotRun() {
        return { time: this.time, level: this.level, hours: this.world?.wheel?.snapshot?.() ?? null };
    }

    /**
     * A start that replaces a runtime of this sitting (a tier chosen behind the menu, a restored
     * WebGL2 context) carries the run kept for it through the stop() that BaseTheme runs first.
     * @param {*} webglRenderer
     * @param {object} [managers]
     */
    async runStartAttempt(webglRenderer, managers = {}) {
        this.carriedRun = (this.isActive || this.isPaused) ? this.keptRun : null;
        this.keptRun = null;
        try {
            return await super.runStartAttempt(webglRenderer, managers);
        } finally {
            this.carriedRun = null;
        }
    }

    /**
     * A node renderer on WebGPU when there is a GPU to ask, else (or when that fails) on its
     * WebGL2 backend. Resolves null when the start it was for has been superseded.
     * @param {number} ownerGeneration
     */
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
                label: `Rainbow Terraces ${forceWebGL ? 'WebGL2' : 'WebGPU'} renderer init`,
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
            throw new Error('Rainbow Terraces could not initialize WebGPU or WebGL2.', { cause: error });
        }
    }

    setupGpuResilience() {
        const { renderer } = this;
        this.setupRendererResilience(renderer, {
            webgpuDevice: this.isWebGPU ? renderer.backend?.device : null,
            // A lost WebGL2 context comes back through a restart: keep the run for it.
            onContextLost: () => {
                this.keptRun = this.snapshotRun();
            },
        });
        this.gpuSurfaceUnregister?.();
        this.gpuSurfaceUnregister = null;
        if (!this.isWebGPU) return; // WebGL2: BaseTheme's CONTEXT_RESTORED restart covers it
        this.gpuSurfaceUnregister = registerGpuSurface(this.name, {
            recover: async () => {
                if (this.gpuRecoveryAttempted) throw new Error('Rainbow Terraces WebGPU recovery already attempted.');
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
            this.post = new RainbowTerracesPost(this.renderer, this.scene, this.camera, {
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

        Object.keys(RAINBOW_TERRACES_EVENT_HANDLERS).forEach((key) => {
            const handler = RAINBOW_TERRACES_EVENT_HANDLERS[key];
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
        // The pointer has left the page when a pointerout names nothing it went to (pointerleave
        // never fires on window).
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

    /**
     * The world follows the longest chain any board is holding.
     * @param {number} combo
     * @param {number} [player]
     */
    reportCombo(combo, player = 0) {
        if (combo > 0) this.combos.set(player, combo);
        else this.combos.delete(player);
        let best = 0;
        this.combos.forEach((n) => {
            if (n > best) best = n;
        });
        this.world?.onCombo(best);
    }

    /** The run is over: the world marks the ending, and then the session is reset whatever that did. */
    handleGameOver() {
        try {
            this.world?.onGameOver?.();
        } finally {
            this.resetSession();
        }
    }

    /** A new run: back to rest, no chain in flight (the clock, and so the light's walk, runs on). */
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
            this.savedTierSeen = normalizeQuality(readSetting(null, 'effectQuality'));
            this.queueRebuild();
            return;
        }
        this.applyReactionSettings(payload);
        // renderScale (incl. the adaptive PERFORMANCE_DOWNSCALE re-emit) = pixel ratio only;
        // deferred a microtask so main.js has applied setGlobalRenderScale() first. resize()
        // compares the ratio, so only a real change resizes: every save carries all the settings,
        // and a forced resize set the canvas's size again out of the frame loop (black flashes
        // as a theme picked in play came in).
        if (readSettingUpdate(payload, 'renderScale').present) {
            queueMicrotask(() => {
                if (!this.isActive) return;
                const { width, height } = getViewport();
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
        // goes back to composing for where the solo board would be.
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

    /**
     * The ThemeManager resize funnel (CSS px). Deduplicated.
     * @param {number} width
     * @param {number} height
     */
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

    /** @param {number} now the frame's timestamp (ms) */
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
        // A tier chosen behind the menu wants a new world: one full restart under the manager's
        // loading mask, carrying the run (a resume followed by a rebuild would retire the renderer
        // the manager's render check watches, and it would restart the theme a second time).
        if (this.rebuildPending) {
            this.keptRun = this.snapshotRun();
            return false;
        }
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
        // The next start is a new sitting (unless it carries the run kept for it, see
        // runStartAttempt): its clock starts over on level one, and it holds no rebuild queued for
        // the runtime that just went.
        this.time = 0;
        this.level = 1;
        this.keptRun = null;
        this.pendingQuality = null;
        this.savedTierSeen = null;
        this.rebuildPending = false;
    }

    cleanup() {
        this.stop();
        super.cleanup();
    }
}
