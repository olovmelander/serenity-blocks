/** Blood Moon's verified playground scene, with game lifecycle and event ownership. */
import * as THREE from 'three/webgpu';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { getViewport } from '../../utils/viewport.js';
import { normalizeQuality } from '../../utils/quality.js';
import { registerGpuSurface } from '../../utils/gpu-loss-coordinator.js';
import { create as createBloodMoon } from '../../playground/effects/blood-moon.effect.js';
import { BLOOD_MOON_TETROMINOS } from './blood-moon-tetrominos.js';

const SETTINGS = ['effectQuality', 'graphicsQuality', 'enableAntialiasing', 'renderScale',
    'backgroundComboEffects', 'pieceLockRipple', 'reducedMotion'];
const BOARD_SELECTORS = '.single-player-card, #phaser-game-container canvas, #main-game-canvas, '
    + '#single-player-game-canvas, #p1-phaser-container canvas, #p2-phaser-container canvas, '
    + '#p3-phaser-container canvas, #p4-phaser-container canvas';

function bool(value, fallback = true) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'string') return !['false', '0', 'off', 'no'].includes(value.toLowerCase());
    return value === true;
}

function settingUpdates(payload) {
    const detail = payload?.detail ?? payload ?? {};
    const updates = {};
    for (const key of SETTINGS) {
        if (detail.type === key) updates[key] = detail.value;
        else {
            for (const source of [detail, detail.changed, detail.settings]) {
                if (source && Object.prototype.hasOwnProperty.call(source, key)) {
                    updates[key] = source[key];
                    break;
                }
            }
        }
    }
    return updates;
}

export default class BloodMoonTheme extends BaseTheme {
    constructor() {
        super('blood-moon');
        this.resourceProfile = 'heavy-gpu';
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.runtime = null;
        this.runtimeGeneration = 0;
        this.runtimeEntry = null;
        this.eventUnsubscribers = [];
        this.animationLoopStarted = false;
        this.animationDriver = null;
        this.lastFrameTime = null;
        this.time = 0;
        this.fixedTime = null;
        this.quality = 'High';
        this.settings = {};
        this.pendingSettings = null;
        this.rebuildQueued = false;
        this.rebuildPending = false;
        this.resizeQueued = false;
        this.layoutClock = 0;
        this.layoutDue = new Float64Array(3).fill(Infinity);
        this.modeManager = null;
        this.reducedMotionQuery = null;
        this.gpuSurfaceUnregister = null;
        this.isWebGPU = false;
        this.forceWebGL = false;
        this.recoveryAttempted = false;
    }

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        const container = document.getElementById(`${this.name}-theme`);
        if (!container) throw new Error('Blood Moon theme container not found.');
        this.disposeRuntime();
        const generation = this.runtimeGeneration;
        const current = () => generation === this.runtimeGeneration
            && ownerGeneration === this.lifecycleGeneration && this.isActive && !this.cleanupComplete;
        this.settings = { ...window.settings, ...this.pendingSettings };
        this.pendingSettings = null;
        this.quality = normalizeQuality(this.settings.effectQuality ?? this.settings.graphicsQuality);
        const antialias = bool(this.settings.enableAntialiasing, this.getAntialiasEnabled());
        const params = new URLSearchParams(window.location?.search || '');
        const renderer = await this.createRenderer(ownerGeneration, antialias, params, current);
        if (!renderer) return;
        if (!current()) {
            this.disposeRenderer(renderer, { nullInstance: false });
            return;
        }

        const entry = {
            renderer, runtime: null, preparing: null, retired: false, ready: false,
        };
        this.runtimeEntry = entry;
        this.renderer = renderer;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
        this.appliedAntialiasing = antialias;
        try {
            renderer.setClearColor(0x010208, 1);
            renderer.toneMapping = THREE.NoToneMapping;
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.domElement.id = 'blood-moon-renderer';
            renderer.domElement.setAttribute('aria-hidden', 'true');
            renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
            container.appendChild(renderer.domElement);
            this.scene = new THREE.Scene();
            this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
            this.camera.position.set(0, 0, 12);
            const { width, height } = getViewport();
            this.resize(width, height);
            const time = Number(params.get('bloodMoonTime'));
            this.fixedTime = params.has('bloodMoonTime') && Number.isFinite(time) ? Math.max(0, time) : null;
            this.time = this.fixedTime ?? 0;
            ['board', 'event', 'eventAge', 'lines', 'combo', 't'].forEach((key) => params.delete(key));
            params.set('quality', this.quality);
            if (params.has('bloodMoonSeed') && Number.isFinite(Number(params.get('bloodMoonSeed')))) {
                params.set('seed', params.get('bloodMoonSeed'));
            }
            entry.runtime = createBloodMoon({
                THREE,
                scene: this.scene,
                camera: this.camera,
                renderer,
                sizes: { width: this.width, height: this.height },
                params,
            });
            this.runtime = entry.runtime;
            this.runtime.camera?.(this.time, this.camera);
            this.runtime.seek(this.time);
            this.setupListeners();
            this.syncLayout();
            this.setupGpuResilience();
            entry.preparing = Promise.resolve().then(() => (entry.retired ? undefined : entry.runtime.prepare()));
            await entry.preparing;
            if (!current()) {
                this.retireEntry(entry);
                return;
            }
            entry.ready = true;
            if (this.rebuildPending) {
                this.rebuildPending = false;
                this.queueRebuild();
                return;
            }
            this.scheduleLayout();
            this.animate();
        } catch (error) {
            if (current()) {
                this.disposeRuntime();
                throw error;
            }
            this.retireEntry(entry);
        }
    }

    async createRenderer(ownerGeneration, antialias, params, current) {
        const forced = this.forceWebGL || ['forceWebGL', 'bloodMoonForceWebGL']
            .some((key) => params.has(key) && bool(params.get(key)));
        const attempt = (forceWebGL) => this.initializeRendererCandidate(new THREE.WebGPURenderer({
            antialias, alpha: false, forceWebGL, powerPreference: 'high-performance',
        }), { ownerGeneration, timeoutMs: 5500, label: 'Blood Moon renderer initialization' });
        if (!forced && typeof navigator !== 'undefined' && navigator.gpu) {
            try {
                return await attempt(false);
            } catch (error) {
                if (!current()) return null;
                console.warn('[BloodMoon] WebGPU initialization failed; trying WebGL2.', error);
            }
        }
        if (!current()) return null;
        try {
            return await attempt(true);
        } catch (error) {
            if (!current()) return null;
            throw error;
        }
    }

    setupGpuResilience() {
        this.setupRendererResilience(this.renderer, {
            webgpuDevice: this.isWebGPU ? this.renderer.backend?.device : null,
        });
        if (this.isWebGPU) {
            this.gpuSurfaceUnregister = registerGpuSurface(this.name, {
                recover: async () => {
                    if (this.recoveryAttempted) throw new Error('Blood Moon GPU recovery already attempted.');
                    this.recoveryAttempted = true;
                    this.forceWebGL = true;
                    if (this.isActive) await this.createScene();
                },
            });
        }
    }

    setupListeners() {
        this.clearEventUnsubscribers();
        this.clearTrackedResources();
        this.modeManager = null;
        this.reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        this.applyEffectSettings();
        const cue = (kind, payload) => {
            if (!this.isActive || this.isPaused || !this.effectsEnabled) return;
            if (kind === 'lock' && !this.lockEnabled) return;
            this.runtime?.cue(kind, payload);
        };
        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.PIECE_LOCK, (data) => cue('lock', data)),
            eventBus.on(EVENTS.LINE_CLEAR, (data) => {
                cue((data?.lineCount ?? data?.lines) >= 4 ? 'tetris' : 'clear', data);
            }),
            eventBus.on(EVENTS.COMBO, (data) => cue('combo', data)),
            eventBus.on(EVENTS.TSPIN, (data) => cue('tspin', data)),
            eventBus.on(EVENTS.PERFECT_CLEAR, (data) => cue('perfectClear', data)),
            eventBus.on(EVENTS.LEVEL_UP, (data) => cue('levelUp', data)),
            eventBus.on(EVENTS.SETTINGS_CHANGED, (data) => this.handleSettings(data)),
            eventBus.on(EVENTS.VIEWPORT_RESIZED, (view) => this.resize(view?.width, view?.height)),
        );
        this.registerEventListener(window, 'settingsChanged', (event) => this.handleSettings(event));
        this.registerEventListener(window, 'gameOver', () => this.runtime?.seek(this.time));
        if (this.reducedMotionQuery?.addEventListener) {
            this.registerEventListener(this.reducedMotionQuery, 'change', () => this.applyEffectSettings());
        }
        this.ensureModeListeners();
    }

    ensureModeListeners() {
        const manager = window.serenityBlocks?.gameModeManager;
        if (!manager?.on || manager === this.modeManager) return;
        this.modeManager = manager;
        this.eventUnsubscribers.push(
            manager.on('modeStarted', () => this.scheduleLayout()),
            manager.on('modeActivated', () => this.scheduleLayout()),
            manager.on('modeStopped', () => { this.runtime?.seek(this.time); this.scheduleLayout(); }),
        );
    }

    applyEffectSettings() {
        this.effectsEnabled = bool(this.settings.backgroundComboEffects);
        this.lockEnabled = bool(this.settings.pieceLockRipple);
        this.reducedMotion = bool(this.settings.reducedMotion, false) || this.reducedMotionQuery?.matches === true;
        this.runtime?.setEffectsEnabled(this.effectsEnabled);
        this.runtime?.setReducedMotion(this.reducedMotion);
    }

    handleSettings(payload) {
        const updates = settingUpdates(payload);
        Object.assign(this.settings, updates);
        this.applyEffectSettings();
        const quality = normalizeQuality(this.settings.effectQuality ?? this.settings.graphicsQuality);
        const antialias = bool(this.settings.enableAntialiasing, this.getAntialiasEnabled());
        if (quality !== this.quality || antialias !== this.appliedAntialiasing) {
            this.pendingSettings = { ...this.settings };
            this.queueRebuild();
        } else if (Object.prototype.hasOwnProperty.call(updates, 'renderScale') && !this.resizeQueued) {
            this.resizeQueued = true;
            const generation = this.runtimeGeneration;
            queueMicrotask(() => {
                this.resizeQueued = false;
                if (this.isActive && generation === this.runtimeGeneration) this.resize();
            });
        }
    }

    queueRebuild() {
        if (this.rebuildQueued) return;
        this.rebuildQueued = true;
        const generation = this.runtimeGeneration;
        queueMicrotask(() => {
            this.rebuildQueued = false;
            if (!this.isActive || generation !== this.runtimeGeneration) return;
            if (this.isPaused || !this.runtimeEntry?.ready) {
                this.rebuildPending = true;
                return;
            }
            this.createScene().catch((error) => {
                console.error('[BloodMoon] Settings rebuild failed.', error);
                this.onRuntimeFailure?.(error);
            });
        });
    }

    resize(width, height) {
        if (!this.renderer) return;
        const view = getViewport();
        this.width = Math.max(1, Number.isFinite(width) ? width : view.width || 1);
        this.height = Math.max(1, Number.isFinite(height) ? height : view.height || 1);
        // Preserve the previous theme's pixel-ratio policy; savings come from the scene itself.
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setSize(this.width, this.height);
        this.runtime?.resize(this.width, this.height);
        this.scheduleLayout();
    }

    scheduleLayout() {
        this.layoutDue[0] = this.layoutClock;
        this.layoutDue[1] = this.layoutClock + 0.5;
        this.layoutDue[2] = this.layoutClock + 1.5;
    }

    syncLayout() {
        if (!this.runtime) return;
        this.ensureModeListeners();
        const rects = [];
        if (this.modeManager?.getCurrentModeId?.() !== 'serenity') {
            for (const node of document.querySelectorAll(BOARD_SELECTORS)) {
                if (node.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) === false) continue;
                const rect = node.getBoundingClientRect();
                if (rect.width < 32 || rect.height < 64 || rect.right <= 0 || rect.bottom <= 0
                    || rect.left >= this.width || rect.top >= this.height) continue;
                rects.push({
                    left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
                });
            }
        }
        this.runtime.setLayout(rects);
    }

    animate() {
        if (this.animationLoopStarted || !this.isActive || this.isPaused || !this.runtimeEntry?.ready) return;
        this.animationLoopStarted = true;
        this.lastFrameTime = null;
        this.animationDriver = this.safeAnimate((timestamp) => this.stepFrame(timestamp));
        this.registerAnimation(requestAnimationFrame(this.animationDriver));
    }

    stepFrame(timestamp) {
        if (!this.runtime || this.isPaused) return;
        const now = Number.isFinite(timestamp) ? timestamp : performance.now();
        const dt = this.lastFrameTime === null
            ? 1 / 60 : Math.max(0, Math.min(0.05, (now - this.lastFrameTime) / 1000));
        this.lastFrameTime = now;
        this.layoutClock += dt;
        let layoutChanged = false;
        for (let i = 0; i < this.layoutDue.length; i++) {
            if (this.layoutClock >= this.layoutDue[i]) {
                this.layoutDue[i] = Infinity;
                layoutChanged = true;
            }
        }
        if (layoutChanged) this.syncLayout();
        this.time = this.fixedTime ?? this.time + dt;
        this.runtime.update(this.time, this.fixedTime === null ? dt : 0);
        this.runtime.render();
    }

    retireEntry(entry) {
        if (!entry || entry.retired) return;
        entry.retired = true;
        entry.renderer.domElement?.remove?.();
        try { entry.runtime?.dispose(); } catch (error) { console.warn('[BloodMoon] Runtime disposal failed.', error); }
        const release = () => this.disposeRenderer(entry.renderer, { nullInstance: false });
        // compileAsync may still own the device. Detach immediately, release GPU after it settles.
        if (entry.preparing && !entry.ready) {
            entry.preparing.then(release, release).catch((error) => {
                console.warn('[BloodMoon] Deferred renderer disposal failed.', error);
            });
        } else release();
    }

    disposeRuntime() {
        this.runtimeGeneration += 1;
        this.cancelAnimationFrames();
        this.clearEventUnsubscribers();
        this.clearTrackedResources();
        this.removeRendererResilience();
        this.gpuSurfaceUnregister?.();
        this.gpuSurfaceUnregister = null;
        const entry = this.runtimeEntry;
        this.runtimeEntry = null;
        this.runtime = null;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.retireEntry(entry);
        this.modeManager = null;
        this.reducedMotionQuery = null;
        this.animationLoopStarted = false;
        this.animationDriver = null;
        this.lastFrameTime = null;
        this.layoutClock = 0;
        this.layoutDue.fill(Infinity);
        this.isWebGPU = false;
    }

    pause() {
        const paused = super.pause();
        if (paused) this.lastFrameTime = null;
        return paused;
    }

    resume() {
        if (!this.runtimeEntry?.ready) return false;
        const resumed = super.resume();
        if (resumed) {
            this.lastFrameTime = null;
            this.resize();
            if (this.rebuildPending) { this.rebuildPending = false; this.queueRebuild(); }
        }
        return resumed;
    }

    stop() { super.stop(); this.disposeRuntime(); }

    async whenCriticalReady() { return this.runtimeEntry?.ready === true; }

    getTetrominoConfig() { return BLOOD_MOON_TETROMINOS; }

    getDiagnostics() {
        return {
            ...this.runtime?.getDiagnostics(),
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            quality: this.quality,
        };
    }
}
