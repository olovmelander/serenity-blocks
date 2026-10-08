/* eslint-disable import/no-unresolved */
/**
 * Murmuration — theme orchestrator.
 *
 * A swarm of light — tens to hundreds of thousands of motes — rides a flow field through
 * a dark nebula, framing the board like a flock at dusk. Play moves it: a locking piece
 * sends a ring of light out through the swarm, a cleared line throws its light sideways,
 * a chain spins the gyre up and warms it toward gold, and the big moments gather the
 * whole swarm into a figure.
 *
 * This file holds no visual logic. It owns the renderer and the frame loop and wires the
 * parts together:
 *
 *   sim/fluid-particles.js        the swarm simulation (WebGPU compute, or CPU on WebGL2)
 *   sim/flow-field.js             the divergence-free field the swarm rides
 *   sim/shape-formations.js       the figures it can gather into
 *   rendering/…-renderer.js       motes: colour by place, streaks, focus, glints
 *   rendering/nebula-volume.js    the night sky
 *   post/render-pipeline.js       bloom, hue-preserving tonemap, grade
 *   composition/play-director.js  gameplay events → one lock / one clear per frame, true combo
 *   composition/swarm-show.js     what the swarm does about them
 *   composition/camera-director.js  the lens
 */
import * as THREE from 'three/webgpu';
import { BaseTheme } from '../base-theme.js';
import { initializeThemeNodeRenderer } from '../shared/node-renderer.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { CameraDirector } from './composition/camera-director.js';
import { BOARD_CANVAS_SELECTOR, boardPoint, readBoardRect } from './composition/board-layout.js';
import { SWARM_EVENT_HANDLERS, SwarmPlayDirector } from './composition/play-director.js';
import { RANDOM_SHAPE_POOL, SwarmShow } from './composition/swarm-show.js';
import {
    BLOOM_REACTION, BOARD_HALO, NO_POST_EXPOSURE, QUALITY_PRESETS, SWARM_FOCAL,
    applyCrowding, applySwarmFrame, normalizeQuality, projectToPlane, shapeLayout, swarmFrame,
    swarmLook,
} from './composition/swarm-tiers.js';
import { createNebulaSky } from './rendering/nebula-volume.js';
import { createFluidParticlesRenderer } from './rendering/fluid-particles-renderer.js';
import { SwarmPostPipeline, getSwarmPostProfile } from './post/render-pipeline.js';
import { FLUID_BUDGETS, FluidParticleSim, getFluidBudget } from './sim/fluid-particles.js';
import { SHAPE_NAMES } from './sim/shape-formations.js';

const BOARD_MOUNT_SELECTOR = '#phaser-game-container, #online-main-board, .phaser-board-container';
const BOARD_OBSERVATION_ROOT_SELECTOR = [
    '.single-player-stage', '#multiplayer-container', '#online-multiplayer-container', '#odyssey-container',
].join(', ');

const REST_FOV = 38;

/**
 * Settings payloads arrive in three shapes: the window 'settingsChanged' detail holds only
 * the changed keys; the bus SETTINGS_CHANGED carries `{ settings, source }` or `{ type, value }`.
 */
function readUpdate(payload, key) {
    const detail = payload?.detail || payload || null;
    if (!detail) return undefined;
    if (detail.type === key) return detail.value ?? detail[key] ?? detail.settings?.[key];
    const sources = [detail, detail.changed, detail.settings];
    for (let i = 0; i < sources.length; i += 1) {
        const src = sources[i];
        if (src && typeof src === 'object' && Object.prototype.hasOwnProperty.call(src, key)) return src[key];
    }
    return undefined;
}

/** The payload's value for a key, or the stored setting when the payload does not name it. */
function readSetting(payload, key) {
    const update = readUpdate(payload, key);
    if (update !== undefined) return update;
    return typeof window !== 'undefined' ? window.settings?.[key] : undefined;
}

function boolSetting(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'string') {
        const v = value.trim().toLowerCase();
        if (['false', '0', 'off', 'no'].includes(v)) return false;
        if (['true', '1', 'on', 'yes'].includes(v)) return true;
    }
    return Boolean(value);
}

export default class MurmurationTheme extends BaseTheme {
    constructor() {
        super('murmuration');

        // Three.js core
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Timer();

        // Subsystems
        this.cameraDirector = null;
        this.nebula = null;
        this.postPipeline = null;
        this.fluidSim = null;
        this.fluidRenderer = null;
        this.playDirector = null;
        this.show = null;
        this._computeAvailable = false;
        this._computeFailedOnce = false;

        // Quality
        this.qualityName = 'High';
        this.qualityPreset = QUALITY_PRESETS.High;
        this.postProfile = getSwarmPostProfile('High');
        // A tier or render scale changed in settings while running: applied between frames.
        this._pendingQuality = null;
        this._pixelRatioStale = false;

        // Animation state
        this.time = 0;
        this.frameCount = 0;
        this.animationLoopStarted = false;

        // Event subscription handles (for cleanup)
        this.eventUnsubscribers = [];
        this.boundResize = null;
        this._boardMutationObserver = null;
        this._boardResizeObserver = null;
        this._observedBoardCanvas = null;
        this._boardObserverSession = null;

        // The numbers the post stack reads; the show owns and decays them once it exists.
        this.fxState = {
            stageHeat: 0,
            comboIntensity: 0,
            comboPulse: 0,
            rewardPulse: 0,
            actProgress: 0,
            chromaPunch: 0,
            bloomPunch: 0,
            vignettePunch: 0,
        };

        this._focal = new THREE.Vector3(SWARM_FOCAL.x, SWARM_FOCAL.y, SWARM_FOCAL.z);
        this._swarmRadius = FLUID_BUDGETS.High.focalRadius;
        this._swarmLook = { sizeMul: 1, exposure: 1 };
        this._pixelHeight = 1080;
        this._boardRect = null; // the primary board, window fractions
        this._frame = null; // the view at the focal plane (swarmFrame)
        this._screenPoint = { x: 0.5, y: 0.5 };
        this._heartHeld = false;

        // Reused dynamic-params payload — avoid per-frame allocation
        this._dynPostParams = {
            time: 0,
            bloomBoost: 0,
            baseBloom: 0,
            chromaticBoost: 0,
            baseChromatic: 0,
            vignetteBoost: 0,
            baseVignette: 0,
            exposureDip: 0,
            baseExposure: 0,
        };
    }

    async init() {
        this._setQuality(this._getQualityFromSettings());
    }

    _setQuality(name) {
        this.qualityName = name;
        this.qualityPreset = QUALITY_PRESETS[name];
        this.postProfile = getSwarmPostProfile(name);
    }

    // eslint-disable-next-line class-methods-use-this
    _getQualityFromSettings() {
        if (typeof window !== 'undefined' && window.settings?.effectQuality) {
            return normalizeQuality(window.settings.effectQuality);
        }
        return 'High';
    }

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        const container = document.getElementById(`${this.name}-theme`);
        if (!container) {
            console.error('[Murmuration] Container not found');
            return;
        }

        const w = window.innerWidth;
        const h = window.innerHeight;

        const renderer = await initializeThemeNodeRenderer(this, {
            antialias: this.getAntialiasEnabled(),
            alpha: false,
            powerPreference: 'high-performance',
        }, { ownerGeneration, label: 'Murmuration' });
        if (!renderer) return;
        this.renderer = renderer;
        this._computeFailedOnce = false;
        this.setupRendererResilience(renderer, {
            webgpuDevice: renderer.backend?.isWebGPUBackend === true ? renderer.backend.device : null,
        });

        const pixelRatio = this.getEffectivePixelRatio(2);
        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(w, h);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this._pixelHeight = Math.max(1, h * pixelRatio);
        container.innerHTML = '';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        // ── Scene + camera ──
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(REST_FOV, w / h, 0.1, 400);
        this.camera.position.set(0, 0.6, 12);
        this.camera.lookAt(0, 0, 0);

        this.cameraDirector = new CameraDirector(this.camera, new THREE.Vector3(0, 0, 0));
        this.cameraDirector.snapToRest(); // Skip initial spring-in animation
        this.camera.updateMatrixWorld();

        this._buildWorld();

        // ── Events ──
        this._setupEventListeners();
        this._setupResize();

        // ── Start animation ──
        this._startAnimation();

        console.log(`[Murmuration] Scene created (quality=${this.qualityName}, post=${!!this.postPipeline})`);
    }

    /**
     * Everything the quality tier decides: the sky, the swarm, the post stack and the show
     * that drives them. Synchronous, so a tier changed in settings can swap it between frames.
     */
    _buildWorld() {
        const { renderer } = this;
        this.nebula = createNebulaSky({ detail: this.qualityPreset.skyDetail });
        this.scene.add(this.nebula.mesh);

        // ── The swarm ──
        // Storage buffers and compute are the native path. WebGL2 keeps the same swarm,
        // formations and impulses with the CPU step and instanced attributes.
        this._computeAvailable = renderer.backend?.isWebGPUBackend === true
            && typeof renderer.compute === 'function';
        if (this.qualityPreset.enableFluid && !this._computeFailedOnce) {
            try {
                const budget = getFluidBudget(this.qualityName, { native: this._computeAvailable });
                this._swarmRadius = budget.focalRadius;
                const frame = swarmFrame(this.camera, budget.focalRadius, this._focal, REST_FOV);
                this._frame = frame;
                this.fluidSim = new FluidParticleSim(budget.count, {
                    cpu: !this._computeAvailable,
                    focalPoint: this._focal,
                    focalRadius: budget.focalRadius,
                    gravityStrength: budget.gravityStrength,
                    turbulence: 0.6,
                    extent: frame.extent,
                });
                applySwarmFrame(this.fluidSim, frame);
                this.fluidSim.createComputeNode();

                this._swarmLook = swarmLook(this.qualityName, budget.count);
                this.fluidRenderer = createFluidParticlesRenderer(this.fluidSim, {
                    sizeMul: this._swarmLook.sizeMul,
                    emissiveMul: 1.0,
                    exposure: this._swarmLook.exposure,
                    aperture: this.qualityPreset.aperture,
                    maxBlur: this.qualityPreset.maxBlur,
                    stretch: this.qualityPreset.stretch,
                });
                applyCrowding(this.fluidRenderer, this._swarmLook, frame.crowding);
                this.scene.add(this.fluidRenderer.mesh);

                const path = this._computeAvailable ? 'compute' : 'cpu';
                console.log(`[Murmuration] Swarm active (${budget.count} motes, ${path})`);
            } catch (err) {
                console.warn('[Murmuration] Swarm setup failed:', err);
                this._teardownFluid();
            }
        }

        // Post pipeline (optional based on preset).
        if (this.qualityPreset.enablePost) {
            this.postPipeline = new SwarmPostPipeline(this.renderer, this.scene, this.camera, {
                ...this.postProfile,
                useMRT: this.qualityPreset.useMRT,
            });
            this.postPipeline.setProfile(this.postProfile);
            if (!this.postPipeline.isEnabled()) {
                // Post setup failed silently — defensive null-out.
                this.postPipeline = null;
            }
        }

        // Without the post stack (Minimal) nothing tone-maps the frame: let the renderer do
        // it, so the sky keeps its depth instead of coming out as raw grey-blue.
        this.renderer.toneMapping = this.postPipeline ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = this.postPipeline ? 1 : NO_POST_EXPOSURE;

        // ── The show: gameplay → swarm ──
        this.show = new SwarmShow({
            sim: this.fluidSim,
            visual: this.fluidRenderer,
            sky: this.nebula,
            camera: this.cameraDirector,
            focal: this._focal,
            locate: (detail, row, u, out) => this._locate(detail, row, u, out),
        });
        this.fxState = this.show.fx;
        this.playDirector = new SwarmPlayDirector({
            sink: {
                lock: (detail) => this._onLock(detail),
                clear: (detail) => this.show?.clear(detail),
                combo: (count, player) => this.show?.combo(count, player),
                // With reactions switched off the palette still steps on; the wave stays home.
                levelUp: (level) => this.show?.levelUp(level, { silent: this.playDirector?.enabled === false }),
            },
        });
        this._heartHeld = false;
        this._applyReactionSettings(null);

        // ── Board zone wiring (both swarm + post halo). Called AFTER both are
        // constructed so a single call configures everything that depends on
        // the board screen rect.
        this._updateBoardZone();
        // The board decides how wide the hole in the swarm is; compose the first frame with it.
        this.fluidSim?.reset();

        // Debug helper: window.murmuration.shape("torus") from console
        if (this.fluidSim) this._installDebugHelper();
    }

    _teardownWorld() {
        this._uninstallDebugHelper();
        this.playDirector?.reset();
        this.playDirector = null;
        this.show?.dispose();
        this.show = null;
        this._teardownFluid();
        if (this.nebula) {
            this.scene?.remove(this.nebula.mesh);
            this.nebula.dispose();
            this.nebula = null;
        }
        this.postPipeline?.dispose();
        this.postPipeline = null;
    }

    /**
     * A settings change. The reaction toggles apply at once; a new tier or render scale waits
     * for the next frame, where nothing is half way through drawing (and where main.js has
     * already applied the global render scale the pixel ratio is read from).
     */
    _onSettingsChanged(payload) {
        const quality = readUpdate(payload, 'effectQuality');
        if (quality !== undefined && quality !== null) {
            const next = normalizeQuality(quality);
            this._pendingQuality = next === this.qualityName ? null : next;
        }
        if (readUpdate(payload, 'renderScale') !== undefined) this._pixelRatioStale = true;
        this._applyReactionSettings(payload);
    }

    /** Rebuild the tier's world on the renderer that is already running. */
    _rebuildForQuality() {
        const next = this._pendingQuality;
        this._pendingQuality = null;
        if (!next || next === this.qualityName || !this.renderer || !this.scene) return;
        // What the run has built up outlives the swap: the level's palette and a held heart.
        const level = this.show?.level ?? 1;
        const heart = this._heartHeld;
        this._teardownWorld();
        this._setQuality(next);
        this._pixelRatioStale = true; // the tier is part of the pixel ratio
        this._applyPixelRatio();
        this._buildWorld();
        if (level > 1) this.show?.levelUp(level, { silent: true });
        if (heart && this.show) {
            this.show.gameOver();
            this._heartHeld = true;
        }
        console.log(`[Murmuration] Quality changed (quality=${this.qualityName}, post=${!!this.postPipeline})`);
    }

    _applyPixelRatio() {
        this._pixelRatioStale = false;
        if (!this.renderer) return;
        const ratio = this.getEffectivePixelRatio(2);
        const current = this.renderer.getPixelRatio?.();
        if (Number.isFinite(current) && Math.abs(ratio - current) < 1e-3) return;
        this.renderer.setPixelRatio(ratio);
        this.resize(window.innerWidth, window.innerHeight);
    }

    _setupEventListeners() {
        const playing = () => this.isActive && !this.isPaused;
        Object.keys(SWARM_EVENT_HANDLERS).forEach((key) => {
            const handler = SWARM_EVENT_HANDLERS[key];
            if (!EVENTS[key]) return;
            this.eventUnsubscribers.push(eventBus.on(EVENTS[key], (payload) => {
                if (playing()) this.playDirector?.[handler](payload);
            }));
        });
        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.SETTINGS_CHANGED, (payload) => this._onSettingsChanged(payload)),
        );

        // The modes announce a finished run on the window, not on the bus.
        const onGameOver = () => this._onGameOver();
        const onGameStart = () => this._onGameStart();
        const onSettings = (payload) => this._onSettingsChanged(payload);
        window.addEventListener('gameOver', onGameOver);
        window.addEventListener('startGameWithMode', onGameStart);
        window.addEventListener('settingsChanged', onSettings);

        // Pointer → camera director. Converts clientX/Y to NDC ([-1, 1])
        // and pushes to the director, which smooths and applies as orbital
        // parallax around the swarm.
        this._onPointerMove = (e) => {
            if (!this.cameraDirector || this._reducedMotion) return;
            const nx = (e.clientX / window.innerWidth) * 2 - 1;
            const ny = (e.clientY / window.innerHeight) * 2 - 1;
            this.cameraDirector.setPointer(nx, ny);
        };
        window.addEventListener('pointermove', this._onPointerMove, { passive: true });
        this.eventUnsubscribers.push(() => {
            window.removeEventListener('gameOver', onGameOver);
            window.removeEventListener('startGameWithMode', onGameStart);
            window.removeEventListener('settingsChanged', onSettings);
            window.removeEventListener('pointermove', this._onPointerMove);
        });
    }

    /** Reduced motion keeps the swarm and stills the lens; the two reaction toggles gate the show. */
    _applyReactionSettings(payload) {
        const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
        this._reducedMotion = boolSetting(readSetting(payload, 'reducedMotion'), false) || mq?.matches === true;
        if (this.show) this.show.reducedMotion = this._reducedMotion;
        if (this._reducedMotion) this.cameraDirector?.setPointer(0, 0);
        this.playDirector?.configure({
            enabled: boolSetting(readSetting(payload, 'backgroundComboEffects'), true),
            lockRipple: boolSetting(readSetting(payload, 'pieceLockRipple'), true),
        });
    }

    _setupResize() {
        this.boundResize = () => this.resize(window.innerWidth, window.innerHeight);
        this.registerEventListener(window, 'resize', this.boundResize);
        this._setupBoardZoneObserver();
    }

    _setupBoardZoneObserver() {
        this._removeBoardZoneObserver();
        const session = {};
        this._boardObserverSession = session;
        const isCurrent = () => this._boardObserverSession === session
            && this.isActive && !this.cleanupComplete;
        if (typeof ResizeObserver !== 'undefined') {
            this._boardResizeObserver = new ResizeObserver(() => {
                if (isCurrent()) this._updateBoardZone();
            });
        }
        if (typeof MutationObserver !== 'undefined') {
            this._boardMutationObserver = new MutationObserver((mutations) => {
                if (!isCurrent()) return;
                const boards = Array.from(document.querySelectorAll(BOARD_CANVAS_SELECTOR));
                const affectsBoard = mutations.some(({ target, removedNodes }) => (
                    target.matches?.(BOARD_MOUNT_SELECTOR)
                    || boards.some((board) => target.contains?.(board))
                    || Array.from(removedNodes || []).some((node) => node.matches?.(BOARD_MOUNT_SELECTOR)
                        || node.querySelector?.(BOARD_MOUNT_SELECTOR))
                ));
                if (affectsBoard) this._updateBoardZone();
            });
            // These existing shells own board mounting and mode visibility.
            // Observe game shells instead of animated theme DOM; the callback
            // ignores changes within unrelated HUD elements.
            document.querySelectorAll(BOARD_OBSERVATION_ROOT_SELECTOR).forEach((root) => {
                this._boardMutationObserver.observe(root, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['class', 'style'],
                });
            });
        }
        this._updateBoardZone();
    }

    _removeBoardZoneObserver() {
        this._boardObserverSession = null;
        this._boardMutationObserver?.disconnect();
        this._boardResizeObserver?.disconnect();
        this._boardMutationObserver = null;
        this._boardResizeObserver = null;
        this._observedBoardCanvas = null;
    }

    resize(w, h) {
        if (!this.renderer || !this.camera) return;
        this.renderer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this._pixelHeight = Math.max(1, h * (this.renderer.getPixelRatio?.() ?? 1));
        // The swarm follows the frame: wings on a wide screen, a tall loop on a phone.
        if (this.camera.position && typeof this.fluidSim?.setExtent === 'function') {
            const frame = swarmFrame(this.camera, this._swarmRadius, this._focal, REST_FOV);
            this._frame = frame;
            applySwarmFrame(this.fluidSim, frame);
            applyCrowding(this.fluidRenderer, this._swarmLook, frame.crowding);
        }
        // Re-project the board zone — wider aspects shrink the board's
        // world-space half-extents at the focal plane, narrower stretch them.
        this._updateBoardZone();
    }

    // ── Gameplay ──────────────────────────────────────────────────────────────

    /** A piece locking is proof a run is under way: let the game-over heart go first. */
    _onLock(detail) {
        // Called from inside the director's flush: release through the show only. Resetting
        // the director here would wipe the clear staged with this very lock.
        if (this._heartHeld) {
            this._heartHeld = false;
            this.show?.gameStart();
        }
        this.show?.lock(detail);
    }

    _onGameOver() {
        if (!this.isActive || !this.show) return;
        this.playDirector?.reset();
        this.show.resetSession();
        this.show.gameOver();
        this._heartHeld = true;
    }

    _onGameStart() {
        this._heartHeld = false;
        this.playDirector?.reset();
        this.show?.gameStart();
    }

    /**
     * Where a play-director detail is in the world: the board cell it names (or the
     * meditation mode's click), carried along its view ray to the swarm's focal plane.
     */
    _locate(detail, row, u, out) {
        if (!this.camera) return false;
        if (detail?.screen) {
            return projectToPlane(this.camera, detail.screen.x, detail.screen.y, this._focal.z, out);
        }
        const board = readBoardRect(detail?.player || 0) || this._boardRect;
        boardPoint(board, u, row, this._screenPoint);
        return projectToPlane(this.camera, this._screenPoint.x, this._screenPoint.y, this._focal.z, out);
    }

    /**
     * Public API: gather the swarm into a named formation.
     * If autoReleaseMs > 0, it dissolves after that delay; otherwise it is held.
     *
     * @param {string} name     - registered shape name (see shape-formations.js)
     * @param {object} opts     - shape options (see shape-formations.js)
     * @param {number} strength - attraction strength 0..1.5 (default 0.6)
     * @param {number} autoReleaseMs - if > 0, let go after this many ms
     */
    setShape(name, opts = {}, strength = 0.6, autoReleaseMs = 0) {
        if (!this.fluidSim || !this.show) return false;
        if (name === 'free') {
            this.show.releaseShape();
            return true;
        }
        return this.show.requestShape(name, opts, strength, autoReleaseMs > 0 ? autoReleaseMs / 1000 : Infinity, 9);
    }

    setShapeStrength(s) {
        if (this.show && this.show.shape.name !== 'free') this.show.shape.target = Math.max(0, s || 0);
        else this.fluidSim?.setShapeStrength(s);
    }

    /** Let the formation dissolve back into the flow. */
    _fadeReleaseShape() {
        this.show?.releaseShape();
    }

    _pickRandomShape() {
        return this.show ? this.show.pickRandomShape() : null;
    }

    /**
     * Install a window.murmuration debug helper. Lets you experiment with
     * shapes from the browser console:
     *   window.murmuration.shape('torus')
     *   window.murmuration.shape('helix', 0.8)
     *   window.murmuration.list()
     *   window.murmuration.release()
     */
    _installDebugHelper() {
        if (typeof window === 'undefined') return;
        window.murmuration = {
            shape: (name, strength = 0.6, opts = {}) => this.setShape(name, opts, strength, 0),
            release: () => this._fadeReleaseShape(),
            strength: (s) => this.setShapeStrength(s),
            list: () => SHAPE_NAMES,
            current: () => this.fluidSim?.currentShape || 'free',
            pool: () => RANDOM_SHAPE_POOL.slice(),
            roll: (strength = 0.6) => {
                const pick = this._pickRandomShape();
                if (pick) this.setShape(pick, {}, strength, 0);
                return pick;
            },
            state: () => this.show?.getState() || null,
        };
    }

    // eslint-disable-next-line class-methods-use-this
    _uninstallDebugHelper() {
        if (typeof window !== 'undefined' && window.murmuration) {
            delete window.murmuration;
        }
    }

    /**
     * Compute the board's screen rectangle and push it to BOTH the swarm (the hole it
     * keeps round the board) and the post pipeline (UV-space halo glow).
     * Called at scene setup, resize, and board mounting/visibility changes.
     *
     * Strategy: detect the board DOM element if present and project its
     * bounding-rect into world + UV space. Falls back to viewport-relative
     * defaults if the element isn't found (theme can be selected from the
     * picker before a game starts).
     */
    _updateBoardZone() {
        if (!this._scratchVec3A) {
            this._scratchVec3A = new THREE.Vector3();
            this._scratchVec3B = new THREE.Vector3();
            this._scratchVec2A = new THREE.Vector2();
            this._scratchVec2B = new THREE.Vector2();
        }

        // ── Detect board screen rect ──
        // Look for the actual board mount points; fall back to viewport-relative.
        const vw = window.innerWidth || 1920;
        const vh = window.innerHeight || 1080;
        let boardCanvas = null;
        let boardRect = null;
        let spanLeft = Infinity;
        let spanRight = -Infinity;
        for (const board of document.querySelectorAll(BOARD_CANVAS_SELECTOR)) {
            const rect = board.getBoundingClientRect();
            const style = window.getComputedStyle?.(board);
            if (rect.width > 0 && rect.height > 0
                && style?.visibility !== 'hidden' && style?.visibility !== 'collapse') {
                if (!boardCanvas) {
                    boardCanvas = board;
                    boardRect = rect;
                }
                // Every board on screen (local multiplayer has several): the span they cover.
                spanLeft = Math.min(spanLeft, rect.left / vw);
                spanRight = Math.max(spanRight, rect.right / vw);
            }
        }
        if (this._boardResizeObserver && boardCanvas !== this._observedBoardCanvas) {
            this._boardResizeObserver.disconnect();
            this._observedBoardCanvas = boardCanvas;
            if (boardCanvas) this._boardResizeObserver.observe(boardCanvas);
        }
        let rectCenterUV;
        let rectHalfUV;
        if (boardRect) {
            const r = boardRect;
            rectCenterUV = this._scratchVec2A.set(
                ((r.left + r.right) * 0.5) / vw,
                ((r.top + r.bottom) * 0.5) / vh,
            );
            rectHalfUV = this._scratchVec2B.set(
                (r.width * 0.5) / vw,
                (r.height * 0.5) / vh,
            );
            this._boardRect = {
                x0: r.left / vw, y0: r.top / vh, x1: r.right / vw, y1: r.bottom / vh,
            };
        } else {
            // Fallback: tall central rect, ~12% wide × 64% tall. Matches the
            // Serenity board's typical size at 1920×1080.
            rectCenterUV = this._scratchVec2A.set(0.5, 0.5);
            rectHalfUV = this._scratchVec2B.set(0.12, 0.32);
            this._boardRect = null;
        }

        // ── Push to the swarm (world-space) ──
        // Project the UV rect to world-space at the focal plane (Z = -1.5).
        // At 38° FOV and camera Z=15, the world height visible there is:
        //   2 * tan(38°/2) * 16.5 ≈ 11.4 units
        // Width = height * aspect.
        if (this.fluidSim) {
            const focalDepth = 16.5; // distance from the rest camera to the focal plane
            const fovRad = (REST_FOV * Math.PI) / 180;
            const worldHeight = 2 * Math.tan(fovRad * 0.5) * focalDepth;
            const worldWidth = worldHeight * (vw / vh);
            this._scratchVec3A.set(
                (rectCenterUV.x - 0.5) * worldWidth,
                (0.5 - rectCenterUV.y) * worldHeight, // flip Y: UV Y down, world Y up
                this._focal.z,
            );
            this._scratchVec3B.set(
                rectHalfUV.x * worldWidth * 1.05,
                rectHalfUV.y * worldHeight * 1.05,
                0.4,
            );
            // The half-width sizes the soft elliptical hole the swarm keeps round the
            // board (a smooth hole in the gyre, not a rectangular push: that left a
            // cross-shaped silhouette).
            this.fluidSim.setBoardZone({
                center: this._scratchVec3A,
                halfExtents: this._scratchVec3B,
            });
            // Formations go where the boards are not. The card round a board is about a
            // fifth wider than its canvas.
            if (this._frame && typeof this.fluidSim.setShapeLayout === 'function') {
                const blockedUV = spanRight > spanLeft
                    ? Math.max(Math.abs(spanLeft - 0.5), Math.abs(spanRight - 0.5))
                    : rectHalfUV.x;
                this.fluidSim.setShapeLayout(shapeLayout(this._frame, blockedUV * worldWidth * 1.3));
            }
        }

        // ── Push to post pipeline (UV-space halo) ──
        if (this.postPipeline) {
            // Small padding on the halo too so it surrounds the board, not flush.
            this._scratchVec2B.set(rectHalfUV.x * 1.04, rectHalfUV.y * 1.02);
            this.postPipeline.setBoardHalo({
                center: rectCenterUV,
                halfSize: this._scratchVec2B,
                strength: BOARD_HALO.strength,
                radius: BOARD_HALO.radius,
                glow: BOARD_HALO.glow,
            });
        }
    }

    // Try/catch lives in a helper so V8 can optimize the animate body.
    _safeFluidCompute() {
        try {
            if (this.fluidSim.isCPU) this.fluidSim.stepCPU();
            else this.renderer.compute(this.fluidSim.computeNode);
        } catch (err) {
            console.warn('[Murmuration] Swarm compute failed, disabling:', err.message);
            this._computeFailedOnce = true;
            this._teardownFluid();
        }
    }

    _teardownFluid() {
        if (this.show) {
            this.show.sim = null;
            this.show.visual = null;
        }
        if (this.fluidRenderer) {
            this.scene?.remove(this.fluidRenderer.mesh);
            this.fluidRenderer.dispose();
            this.fluidRenderer = null;
        }
        if (this.fluidSim) {
            this.fluidSim.dispose();
            this.fluidSim = null;
        }
    }

    _startAnimation() {
        if (this.animationLoopStarted) return;
        this.animationLoopStarted = true;
        this.clock.reset(); // the scene took a while to build: do not count it as a frame

        const animate = this.safeAnimate(() => {
            this.clock.update();
            const rawDelta = this.clock.getDelta();
            const delta = Number.isFinite(rawDelta) ? Math.min(rawDelta, 0.05) : 0.016;
            this.time += delta;
            this.frameCount += 1;

            // A tier or render scale changed in settings since the last frame.
            if (this._pendingQuality) this._rebuildForQuality();
            if (this._pixelRatioStale) this._applyPixelRatio();

            // Gameplay staged since the last frame → the show; then the show's own clock.
            this.playDirector?.flush();
            this.show?.update(delta, this.time);

            // Camera update (cheap)
            this.cameraDirector?.update(delta, this.fxState);

            // Swarm: update uniforms + dispatch compute. The compute call is
            // wrapped in a one-shot try/catch so a failure on first attempt
            // disables it permanently (avoids per-frame spam).
            if (this.fluidSim && !this._computeFailedOnce) {
                this.fluidSim.update(delta, this.time, this.show?.simParams);
                this._safeFluidCompute();
            }
            if (this.fluidRenderer) {
                this.fluidRenderer.setLens(this.camera, this._pixelHeight, this._focal);
                this.fluidRenderer.update(delta, this.time);
            }

            // Sky: time and parallax here; heat, pulse and tints come from the show.
            if (this.nebula?.uniforms) {
                this.nebula.uniforms.uTime.value = this.time;
                this.nebula.uniforms.uParallax.value.set(this.camera.position.x, this.camera.position.y - 0.4);
            }

            // Post dynamic update — single cached object reused across frames.
            if (this.postPipeline?.isEnabled()) {
                const dp = this._dynPostParams;
                dp.time = this.time;
                dp.baseBloom = this.postProfile.bloomStrength;
                dp.bloomBoost = this.fxState.comboIntensity * BLOOM_REACTION.combo
                    + this.fxState.rewardPulse * BLOOM_REACTION.reward
                    + this.fxState.bloomPunch * BLOOM_REACTION.punch;
                dp.baseChromatic = this.postProfile.chromaticStrength;
                dp.chromaticBoost = this.fxState.comboPulse * 0.002
                    + this.fxState.chromaPunch;
                dp.baseVignette = this.postProfile.vignetteDarkness;
                dp.vignetteBoost = this.fxState.vignettePunch;
                dp.baseExposure = this.postProfile.exposure;
                dp.exposureDip = 0;
                this.postPipeline.updateDynamic(dp);
                // The board's halo wears the swarm's current hue.
                const tint = this.show?.haloTint;
                if (tint) this.postPipeline.uBoardHaloColor?.value.setRGB(tint[0] * 0.6, tint[1] * 0.6, tint[2] * 0.6);

                this.postPipeline.render();
            } else {
                this.renderer.render(this.scene, this.camera);
            }
        }, { maxConsecutiveErrors: 3 });

        animate();
    }

    stop() {
        super.stop();
        this._removeBoardZoneObserver();
        this.removeRendererResilience();
        for (const unsub of this.eventUnsubscribers) {
            try { unsub?.(); } catch (e) { /* ignore */ }
        }
        this.eventUnsubscribers = [];
        this._pendingQuality = null;
        this._pixelRatioStale = false;

        this._teardownWorld();
        this._heartHeld = false;
        this.cameraDirector = null;

        if (this.renderer) {
            try { this.disposeRenderer(this.renderer, { nullInstance: false }); } catch (e) { /* ignore */ }
            this.renderer = null;
        }
        this.scene = null;
        this.camera = null;
        this.animationLoopStarted = false;
    }
}
