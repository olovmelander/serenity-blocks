import * as THREE from 'three/webgpu';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { registerGpuSurface } from '../../utils/gpu-loss-coordinator.js';
import { normalizeQuality } from '../../utils/quality.js';
import { getViewport } from '../../utils/viewport.js';
import { sceneSamples } from '../shared/scene-antialias.js';
import { SUNFALL_CLEAR, approach } from './sunfall-core.js';
import {
    SUNFALL_PIXEL_RATIO_CAP, boolSunfallSetting, readSunfallFlags,
    readSunfallSetting, readSunfallSettingUpdate, resolveSunfallQuality,
} from './sunfall-quality.js';
import { SUNFALL_TETROMINOS } from './sunfall-tetrominos.js';
import { SunfallDirector } from './sunfall-director.js';
import { wireSunfallEvents } from './sunfall-events.js';
import { SunfallWorld } from './sunfall-world.js';
import { SunfallPost, createPassThroughPipeline, resolveSunfallPostLook } from './sunfall-post.js';
import { readBoardViewport } from './sunfall-composition.js';

const THEME_ID = 'sunfall';
const RENDERER_INIT_TIMEOUT_MS = 5500;
const MAX_DELTA_S = 0.05;
const CANVAS_CSS = 'position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none';

export default class SunfallTheme extends BaseTheme {
    constructor() {
        super(THEME_ID);
        Object.assign(this, { renderer: null, scene: null, camera: null });
        Object.assign(this, { world: null, post: null, passThrough: null });
        Object.assign(this, { director: null, isWebGPU: false, forceWebGL: false });
        Object.assign(this, { quality: 'High', pendingQuality: null, flags: readSunfallFlags() });
        Object.assign(this, { time: 0, lastFrameMs: null, animationLoopStarted: false });
        Object.assign(this, { runtimeGeneration: 0, eventUnsubscribers: [], gpuSurfaceUnregister: null });
        Object.assign(this, { gpuRecoveryAttempted: false, reducedMotion: false, reactionsEnabled: true });
        Object.assign(this, { lockRippleEnabled: true, appliedSize: null, rebuildQueued: false });
        this.pointer = {
            x: 0, y: 0, sx: 0, sy: 0,
        };
        this.bufferSize = new THREE.Vector2();
        this.level = 1;
    }

    getTetrominoConfig() { return SUNFALL_TETROMINOS; }

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        const container = document.getElementById(`${this.name}-theme`);
        if (!container) throw new Error('[Sunfall] Theme container not found.');
        this.disposeRuntime({ preserveDirector: Boolean(this.director) });
        const generation = ++this.runtimeGeneration;
        const isCurrent = () => generation === this.runtimeGeneration
            && ownerGeneration === this.lifecycleGeneration && this.isActive && !this.cleanupComplete;

        container.replaceChildren();
        this.flags = readSunfallFlags();
        this.quality = this.pendingQuality ?? normalizeQuality(readSunfallSetting(null, 'effectQuality') || 'High');
        this.pendingQuality = null;
        this.qualityPreset = resolveSunfallQuality(this.quality);

        const renderer = await this.createRenderer(ownerGeneration);
        if (!renderer) return;
        if (!isCurrent()) { this.disposeRenderer(renderer, { nullInstance: false }); return; }

        this.renderer = renderer;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
        renderer.setClearColor(SUNFALL_CLEAR, 1);
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.setAttribute('aria-hidden', 'true');
        renderer.domElement.style.cssText = CANVAS_CSS;
        container.appendChild(renderer.domElement);
        this.setupGpuResilience();

        const assets = await SunfallWorld.prepareSafely({ isCurrent });
        if (!isCurrent()) { SunfallWorld.disposeAssets(assets); return; }
        try {
            this.sceneSamples = sceneSamples(this.quality, this.getAntialiasEnabled());
            this.world = new SunfallWorld({ quality: this.quality, parts: this.flags.parts, assets });
            this.scene = this.world.scene;
            this.camera = this.world.camera;
            this.director ??= new SunfallDirector({
                level: this.level,
                reducedMotion: this.reducedMotion,
                maxNewGrowth: this.qualityPreset.newGrowthSlots || 36,
            });
            this.setupPost();
        } catch (error) {
            if (isCurrent() && generation === this.runtimeGeneration) this.disposeRuntime();
            if (isCurrent()) throw error;
            return;
        }
        if (!isCurrent()) return;

        const { width, height } = getViewport();
        this.appliedSize = null;
        this.resize(width, height);
        this.setupEvents();
        this.applyReactionSettings(null);
        if (this.flags.time !== null) { this.time = this.flags.time; this.director.time = this.flags.time; }
        this.world.applySnapshot(this.director.step(0));
        if (!this.isPaused) this.animate();
    }

    async createRenderer(ownerGeneration) {
        const wantWebGL = this.forceWebGL || this.flags.forceWebGL;
        const canTryWebGPU = !wantWebGL && typeof navigator !== 'undefined' && !!navigator.gpu;
        const stillOwned = () => ownerGeneration === this.lifecycleGeneration
            && this.isActive && !this.cleanupComplete;
        const opts = { timeoutMs: RENDERER_INIT_TIMEOUT_MS, label: 'Sunfall renderer init', ownerGeneration };
        const attempt = (forceWebGL) => this.initializeRendererCandidate(
            new THREE.WebGPURenderer({
                antialias: false, depth: false, alpha: false, forceWebGL, powerPreference: 'high-performance',
            }),
            opts,
        );
        if (canTryWebGPU) {
            try { return await attempt(false); } catch { if (!stillOwned()) return null; }
        }
        return stillOwned() ? attempt(true) : null;
    }

    setupGpuResilience() {
        const { renderer } = this;
        this.setupRendererResilience(renderer, { webgpuDevice: this.isWebGPU ? renderer.backend?.device : null });
        this.gpuSurfaceUnregister?.();
        this.gpuSurfaceUnregister = this.isWebGPU ? registerGpuSurface(this.name, {
            recover: async () => {
                if (this.gpuRecoveryAttempted) throw new Error('Sunfall WebGPU recovery already attempted.');
                this.gpuRecoveryAttempted = true;
                this.forceWebGL = true;
                if (this.isActive) await this.createScene();
            },
        }) : null;
    }

    setupPost() {
        this.post = null;
        this.passThrough = null;
        const preset = this.qualityPreset || resolveSunfallQuality(this.quality);
        if (!preset.enablePost || this.flags.noPost) {
            this.renderer.toneMapping = THREE.AgXToneMapping;
            this.passThrough = createPassThroughPipeline(this.renderer, this.scene, this.camera);
            return;
        }
        try {
            const look = resolveSunfallPostLook(this.quality);
            const samples = this.sceneSamples ?? 0;
            const antialias = this.getAntialiasEnabled();
            this.post = new SunfallPost(this.renderer, this.scene, this.camera, {
                look, samples, antialias, falseColor: this.flags.falseColor, u: this.world.u, parts: this.flags.parts,
            });
        } catch {
            this.renderer.toneMapping = THREE.AgXToneMapping;
            this.passThrough = createPassThroughPipeline(this.renderer, this.scene, this.camera);
        }
    }

    setupEvents() {
        this.clearEventUnsubscribers();
        this.clearTrackedResources();
        // The gameplay events, read from their canonical payloads (sunfall-events.js).
        this.eventUnsubscribers = wireSunfallEvents(this);
        const on = (evt, fn) => { if (evt) this.eventUnsubscribers.push(eventBus.on(evt, fn)); };
        on(EVENTS.SETTINGS_CHANGED, (p) => this.handleSettingsChanged(p));
        on(EVENTS.VIEWPORT_RESIZED, (v) => {
            const view = v?.width > 0 && v?.height > 0 ? v : getViewport();
            this.resize(view.width, view.height);
        });
    }

    applyReactionSettings(payload) {
        const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
        const inGameMotion = boolSunfallSetting(readSunfallSetting(payload, 'reducedMotion'), false);
        this.reducedMotion = inGameMotion || mq?.matches === true;
        this.reactionsEnabled = boolSunfallSetting(readSunfallSetting(payload, 'backgroundComboEffects'), true);
        this.lockRippleEnabled = boolSunfallSetting(readSunfallSetting(payload, 'pieceLockRipple'), true);
        this.director?.setReducedMotion(this.reducedMotion);
    }

    handleSettingsChanged(payload) {
        this.applyReactionSettings(payload);
        if (!this.renderer) return;
        const q = readSunfallSettingUpdate(payload, 'effectQuality');
        if (q.present && normalizeQuality(q.value) !== (this.pendingQuality ?? this.quality) && !this.rebuildQueued) {
            this.pendingQuality = normalizeQuality(q.value);
            this.rebuildQueued = true;
            queueMicrotask(() => {
                this.rebuildQueued = false;
                if (this.isActive && !this.isPaused) this.createScene().catch(() => {});
            });
        }
    }

    resize(width, height) {
        if (!this.renderer || !this.camera) return;
        const w = Math.max(1, Math.round(Number(width) || 1));
        const h = Math.max(1, Math.round(Number(height) || 1));
        const pr = this.getEffectivePixelRatio(SUNFALL_PIXEL_RATIO_CAP[this.quality] ?? 1.15, 'theme');
        this.appliedSize = { w, h, pixelRatio: pr };
        this.world?.setAspect(w, h);
        this.renderer.setPixelRatio(pr);
        this.renderer.setSize(w, h, false);
        this.renderer.getDrawingBufferSize(this.bufferSize);
        this.post?.setSize(w, h, this.bufferSize.x, this.bufferSize.y);
        this.world?.setViewportHeight(this.bufferSize.y);
        this.world?.setBoardViewport(readBoardViewport());
    }

    animate() {
        if (this.animationLoopStarted || !this.world || !this.renderer) return;
        this.animationLoopStarted = true;
        this.lastFrameMs = null;
        const loop = this.safeAnimate((now) => this.stepFrame(now), { maxConsecutiveErrors: 3 });
        this.registerAnimation(requestAnimationFrame(loop));
    }

    stepFrame(now) {
        if (!this.world || !this.renderer || !this.camera || !this.director) return;
        const t = Number.isFinite(now) ? now : performance.now();
        const rawDt = this.lastFrameMs === null ? 1 / 60 : (t - this.lastFrameMs) / 1000;
        const wall = Math.min(MAX_DELTA_S, Math.max(0, rawDt));
        this.lastFrameMs = t;
        const delta = this.flags.time !== null ? 0 : (this.flags.fixedDt ?? wall);
        this.time += delta;
        this.pointer.sx = approach(this.pointer.sx, this.pointer.x, 0.35, wall);
        this.pointer.sy = approach(this.pointer.sy, this.pointer.y, 0.35, wall);
        this.world.setPointer(this.pointer.sx, this.pointer.sy);
        const snap = this.director.step(delta);
        this.world.applySnapshot(snap);
        if (this.post) {
            this.post.update(this.world.postState);
            this.post.render();
        } else if (this.passThrough) this.passThrough.render();
        else this.renderer.render(this.scene, this.camera);
    }

    disposeRuntime({ preserveDirector = false } = {}) {
        this.runtimeGeneration += 1;
        this.cancelAnimationFrames();
        this.animationLoopStarted = false;
        if (!preserveDirector) {
            this.clearEventUnsubscribers();
            this.eventUnsubscribers = [];
            this.clearTrackedResources();
            this.director = null;
        }
        this.removeRendererResilience();
        this.gpuSurfaceUnregister?.();
        this.gpuSurfaceUnregister = null;
        try { this.post?.dispose(); this.passThrough?.dispose(); } catch { /* ignore */ }
        try { this.world?.dispose(); } catch { /* ignore */ }
        Object.assign(this, {
            post: null, passThrough: null, world: null, scene: null, camera: null,
        });
        if (this.renderer) {
            const { renderer } = this;
            this.renderer = null;
            this.disposeRenderer(renderer, { nullInstance: false });
        }
    }

    stop() { super.stop(); this.disposeRuntime(); this.time = 0; }

    cleanup() { this.stop(); super.cleanup(); }
}
