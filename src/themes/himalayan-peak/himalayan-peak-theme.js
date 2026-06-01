/* eslint-disable import/no-unresolved */
/**
 * @fileoverview Himalayan Peak Theme — AAA WebGPU "Roof of the World"
 *
 * Thin orchestrator (Electric Dreams V3 / Winter architecture). Owns the renderer,
 * scene, camera, the SHARED sky/sun/fog uniforms, and the frame loop. All visual
 * logic lives in subsystems; the AltitudeDirector maps one `ascentIntensity` scalar
 * to the whole scene to drive the day→alpenglow mood arc.
 *
 * See docs/HIMALAYAN_PEAK_AAA_PLAN.md.
 */
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { HIMALAYAN_PEAK_TETROMINOS } from './himalayan-peak-tetrominos.js';
import { AltitudeDirector } from './composition/altitude-director.js';
import { CameraDirector } from './composition/camera-director.js';
import { createSkyDome } from './rendering/sky-dome.js';
import { createRidgeTerrain } from './rendering/ridge-terrain.js';
import { createPeakEagles } from './rendering/peak-eagles.js';
import { createPrayerFlags } from './rendering/prayer-flags.js';
import { createSpindrift } from './sim/spindrift.js';
import { PeakPostPipeline, getPeakPostProfile } from './post/peak-pipeline.js';

// Day → alpenglow palette endpoints (lerped by AltitudeDirector.warmth).
const PALETTE = {
    dawn: {
        zenith: new THREE.Color(0x3b4d86), // cool blue
        horizon: new THREE.Color(0xb4bbdd), // pale lavender (matches the original mood)
        sun: new THREE.Color(0xfdeedb), // soft pale
    },
    alpen: {
        zenith: new THREE.Color(0x5a4f86), // violet
        horizon: new THREE.Color(0xff9d63), // gold-orange
        sun: new THREE.Color(0xffb257), // warm
    },
};
const WHITE = new THREE.Color(0xffffff);

const QUALITY_PRESETS = Object.freeze({
    Minimal: {
        segments: 96, eagles: 1, flags: 8, spindrift: 0, enablePost: false, useMRT: false,
    },
    Low: {
        segments: 128, eagles: 1, flags: 9, spindrift: 800, enablePost: true, useMRT: false,
    },
    Medium: {
        segments: 168, eagles: 2, flags: 10, spindrift: 1800, enablePost: true, useMRT: true,
    },
    High: {
        segments: 224, eagles: 2, flags: 11, spindrift: 3500, enablePost: true, useMRT: true,
    },
    Ultra: {
        segments: 256, eagles: 3, flags: 12, spindrift: 7000, enablePost: true, useMRT: true,
    },
    Extreme: {
        segments: 320, eagles: 3, flags: 14, spindrift: 12000, enablePost: true, useMRT: true,
    },
});

// Direction TO the sun (low, upper-left, slightly into the scene so it backlights
// the ranges and stays visible for god-rays/flare). Tunable in-browser.
const SUN_DIR = new THREE.Vector3(-0.48, 0.36, -0.80).normalize();

export default class HimalayanPeakTheme extends BaseTheme {
    constructor() {
        super('himalayan-peak');
        this.resourceProfile = 'heavy-gpu';

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.clock = new THREE.Clock();

        this.director = new AltitudeDirector();
        this.cameraDirector = null;
        this.sky = null;
        this.terrain = null;
        this.eagles = null;
        this.flags = null;
        this.spindrift = null;
        this.post = null;

        this.qualityName = 'High';
        this.qualityPreset = QUALITY_PRESETS.High;
        this.postProfile = getPeakPostProfile('High');

        this.time = 0;
        this.animationLoopStarted = false;
        this.eventUnsubscribers = [];

        // Shared uniforms (created in createScene) + scratch objects (no per-frame alloc).
        this.u = null;
        this._tmpColor = new THREE.Color();
        this._fogColor = new THREE.Color();
        this._sunWorld = new THREE.Vector3();
        this._sunNdc = new THREE.Vector3();
        this._camForward = new THREE.Vector3();
        this._sunScreen = new THREE.Vector2(0.5, 0.85);
        this._warmTint = new THREE.Color(0xffb070);
        this._dynPost = {
            time: 0,
            warmth: 0,
            warmTint: this._warmTint,
            sunScreen: this._sunScreen,
            sunVisible: 0,
            bloomBoost: 0,
            chromaBoost: 0,
            godrayBoost: 0,
        };
    }

    async init() {
        this.qualityName = this._getQuality();
        this.qualityPreset = QUALITY_PRESETS[this.qualityName];
        this.postProfile = getPeakPostProfile(this.qualityName);
    }

    _getQuality() {
        if (typeof window !== 'undefined' && window.settings?.effectQuality) {
            return normalizeQuality(window.settings.effectQuality);
        }
        return 'High';
    }

    _comboEffectsEnabled() {
        return typeof window === 'undefined' || window.settings?.backgroundComboEffects === true;
    }

    async createScene() {
        const container = document.getElementById(`${this.name}-theme`);
        if (!container) {
            console.error('[HimalayanPeak] Container not found');
            return;
        }

        if (!navigator.gpu) {
            console.warn('[HimalayanPeak] No WebGPU — fallback message (WebGL path is Phase 5)');
            container.innerHTML = '<div style="color:#c8d2f0;text-align:center;padding:2em;'
                + 'font-family:sans-serif;">Himalayan Peak requires WebGPU. Try Chrome 113+ or Safari 26+.</div>';
            return;
        }

        const w = window.innerWidth;
        const h = window.innerHeight;

        try {
            this.renderer = new THREE.WebGPURenderer({
                antialias: this.getAntialiasEnabled(),
                alpha: false,
                powerPreference: 'high-performance',
            });
            await Promise.race([
                this.renderer.init(),
                new Promise((_, reject) => { setTimeout(() => reject(new Error('WebGPU init timeout')), 4000); }),
            ]);
            if (this.renderer.backend?.isWebGPUBackend !== true) {
                throw new Error('WebGPU backend not active after init');
            }
        } catch (err) {
            console.error('[HimalayanPeak] WebGPU init failed:', err);
            container.innerHTML = '<div style="color:#c8d2f0;text-align:center;padding:2em;'
                + `font-family:sans-serif;">WebGPU initialization failed: ${err.message}</div>`;
            return;
        }

        this.renderer.setPixelRatio(this.getEffectivePixelRatio(2));
        this.renderer.setSize(w, h);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        container.innerHTML = ''; // drop the old DOM layers
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(46, w / h, 1, 4000);

        // ── Shared uniforms (sky + terrain read the SAME handles → fog == sky). ──
        this.u = {
            uTime: uniform(0),
            uWarmth: uniform(0),
            uIgnite: uniform(0),
            uSunDir: uniform(SUN_DIR.clone()),
            uSunColor: uniform(PALETTE.dawn.sun.clone()),
            uSkyZenith: uniform(PALETTE.dawn.zenith.clone()),
            uSkyHorizon: uniform(PALETTE.dawn.horizon.clone()),
            uFogColor: uniform(PALETTE.dawn.horizon.clone()),
            uRimColor: uniform(new THREE.Color(0xffd9a0)),
            uStarFade: uniform(1),
            uCameraPos: uniform(new THREE.Vector3()),
        };

        // ── Subsystems ──
        this.cameraDirector = new CameraDirector(this.camera);
        this.cameraDirector.snapToRest();

        this.sky = createSkyDome(this.u);
        this.scene.add(this.sky.mesh);

        this.terrain = createRidgeTerrain(this.u, { segments: this.qualityPreset.segments });
        this.scene.add(this.terrain.mesh);

        this.eagles = createPeakEagles({ maxEagles: this.qualityPreset.eagles });
        this.scene.add(this.eagles.group);
        this.eagles.load(); // async; spawns once models arrive

        this.flags = createPrayerFlags({ count: this.qualityPreset.flags });
        this.scene.add(this.flags.mesh);

        if (this.qualityPreset.spindrift > 0) {
            this.spindrift = createSpindrift(this.qualityPreset.spindrift);
            this.scene.add(this.spindrift.mesh);
        }

        if (this.qualityPreset.enablePost) {
            this.post = new PeakPostPipeline(this.renderer, this.scene, this.camera, {
                ...this.postProfile,
                useMRT: this.qualityPreset.useMRT,
            });
            this.post.setProfile(this.postProfile);
            if (!this.post.isEnabled()) this.post = null;
        }

        this._setupEvents();
        this._setupResize();
        this._setupPointer();
        this._startAnimation();

        console.log(`[HimalayanPeak] Scene created (quality=${this.qualityName}, post=${!!this.post})`);
    }

    _setupEvents() {
        const push = (unsub) => this.eventUnsubscribers.push(unsub);
        push(eventBus.on(EVENTS.LINE_CLEAR, (d) => {
            if (this.isActive && this._comboEffectsEnabled()) {
                this.director.onLineClear(d?.lineCount || 1, d?.comboCount || 0);
            }
        }));
        push(eventBus.on(EVENTS.COMBO, (d) => {
            if (this.isActive && this._comboEffectsEnabled()) this.director.onCombo(d?.comboCount || 0);
        }));
        push(eventBus.on(EVENTS.PIECE_LOCK, () => {
            if (this.isActive && this._comboEffectsEnabled()) this.director.onPieceLock();
        }));
        push(eventBus.on(EVENTS.HARD_DROP, () => {
            if (this.isActive && this._comboEffectsEnabled()) this.director.onHardDrop();
        }));
        push(eventBus.on(EVENTS.GAME_OVER, () => {
            if (this.isActive) this.director.onGameOver();
        }));
        push(eventBus.on(EVENTS.GAME_START, () => {
            if (this.isActive) this.director.reset();
        }));
    }

    _setupResize() {
        this.boundResize = () => this.resize(window.innerWidth, window.innerHeight);
        this.registerEventListener(window, 'resize', this.boundResize);
    }

    _setupPointer() {
        this._onPointerMove = (e) => {
            if (!this.cameraDirector) return;
            const nx = (e.clientX / window.innerWidth) * 2 - 1;
            const ny = (e.clientY / window.innerHeight) * 2 - 1;
            this.cameraDirector.setPointer(nx, ny);
        };
        window.addEventListener('pointermove', this._onPointerMove, { passive: true });
        this.eventUnsubscribers.push(() => window.removeEventListener('pointermove', this._onPointerMove));
    }

    resize(w, h) {
        if (!this.renderer || !this.camera) return;
        this.renderer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    /** Push current director state into the shared scene/post uniforms. */
    _syncUniforms() {
        const dir = this.director;
        const w = dir.warmth;

        this._tmpColor.lerpColors(PALETTE.dawn.zenith, PALETTE.alpen.zenith, w);
        this.u.uSkyZenith.value.copy(this._tmpColor);
        this._tmpColor.lerpColors(PALETTE.dawn.horizon, PALETTE.alpen.horizon, w);
        this.u.uSkyHorizon.value.copy(this._tmpColor);
        // Aerial-perspective fog = sky horizon, nudged toward white for haze.
        this._fogColor.copy(this._tmpColor).lerp(WHITE, 0.12);
        this.u.uFogColor.value.copy(this._fogColor);
        // Sun color warms + brightens on ignition.
        this._tmpColor.lerpColors(PALETTE.dawn.sun, PALETTE.alpen.sun, w)
            .multiplyScalar(1 + dir.ignite * 0.5);
        this.u.uSunColor.value.copy(this._tmpColor);
        // Alpenglow rim from the director accent (dawn-gold → fuchsia tiers).
        this.u.uRimColor.value.setRGB(dir.accent.r, dir.accent.g, dir.accent.b);

        this.u.uWarmth.value = w;
        this.u.uIgnite.value = dir.ignite;
        this.u.uStarFade.value = Math.max(0, Math.min(1, 1 - w * 2.2));
        this.u.uTime.value = this.time;
        this.u.uCameraPos.value.copy(this.camera.position);
    }

    /** Project the sun to screen UV and gate god-rays/flare on visibility. */
    _updateSunScreen() {
        this.camera.getWorldDirection(this._camForward);
        const inFront = SUN_DIR.dot(this._camForward) > 0;
        this._sunWorld.copy(SUN_DIR).multiplyScalar(1500).add(this.camera.position);
        this._sunNdc.copy(this._sunWorld).project(this.camera);
        const ux = this._sunNdc.x * 0.5 + 0.5;
        const uy = this._sunNdc.y * 0.5 + 0.5;
        this._sunScreen.set(ux, uy);
        const onScreen = inFront && ux > -0.15 && ux < 1.15 && uy > -0.15 && uy < 1.15;
        return onScreen ? 1 : 0;
    }

    _startAnimation() {
        if (this.animationLoopStarted) return;
        this.animationLoopStarted = true;
        this.clock.start();
        this.clock.getDelta();

        const animate = this.safeAnimate(() => {
            const raw = this.clock.getDelta();
            const delta = Number.isFinite(raw) ? Math.min(raw, 0.05) : 0.016;
            this.time += delta;

            this.director.update(delta);
            this.cameraDirector.update(delta);
            this.cameraDirector.punchFromDirector(this.director.cameraPunch);

            this._syncUniforms();

            const dir = this.director;
            this.eagles?.update(delta, this.time, dir.birdScatter, this.u.uSunColor.value, dir.warmth);
            this.flags?.update(this.time, dir.gust, dir.ignite);
            this.spindrift?.update(this.time, dir.gust, dir.gustDir, this.u.uSunColor.value);

            if (this.post?.isEnabled()) {
                const sunVisible = this._updateSunScreen();
                const dp = this._dynPost;
                dp.time = this.time;
                dp.warmth = this.director.warmth;
                dp.sunScreen = this._sunScreen;
                dp.sunVisible = sunVisible;
                dp.bloomBoost = this.director.bloomPunch * 0.5 + this.director.ignite * 0.3;
                dp.chromaBoost = this.director.chromaPunch * 0.004;
                dp.godrayBoost = this.director.flare * 0.5;
                this.post.updateDynamic(dp);
                this.post.render();
            } else {
                this.renderer.render(this.scene, this.camera);
            }
        }, { maxConsecutiveErrors: 3 });

        animate();
    }

    stop() {
        super.stop();
        for (const unsub of this.eventUnsubscribers) {
            try { unsub?.(); } catch (e) { /* ignore */ }
        }
        this.eventUnsubscribers = [];

        if (this.sky) { this.scene?.remove(this.sky.mesh); this.sky.dispose(); this.sky = null; }
        if (this.terrain) { this.scene?.remove(this.terrain.mesh); this.terrain.dispose(); this.terrain = null; }
        if (this.eagles) { this.scene?.remove(this.eagles.group); this.eagles.dispose(); this.eagles = null; }
        if (this.flags) { this.scene?.remove(this.flags.mesh); this.flags.dispose(); this.flags = null; }
        if (this.spindrift) {
            this.scene?.remove(this.spindrift.mesh);
            this.spindrift.dispose();
            this.spindrift = null;
        }
        this.post?.dispose();
        this.post = null;
        this.cameraDirector = null;
        this.director.reset();

        if (this.renderer) {
            try { this.renderer.dispose(); } catch (e) { /* ignore */ }
            this.renderer = null;
        }
        this.scene = null;
        this.camera = null;
        this.u = null;
        this.animationLoopStarted = false;
    }

    getTetrominoConfig() {
        return HIMALAYAN_PEAK_TETROMINOS;
    }
}
