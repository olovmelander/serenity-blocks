/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ✧ WAVES - Inside the Surf Barrel ✧
 *  A Three.js Theme for Serenity Blocks
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Realistic water barrel using luminous-tides quality ocean shader.
 * Curved wave geometry wraps around you creating the barrel effect.
 * Camera positioned inside looking toward the bright barrel opening.
 *
 * Gameplay feedback layers (see docs/WAVES_LOCK_COMBO_EFFECTS_PLAN.md):
 *   • Lock       → droplet splash on the barrel wall + caustic flash
 *   • Line clear → swell surge travelling down the tube + spray & foam boost
 *   • Combo      → god-rays through the exit + plankton streaks + foam curtain
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { WAVES_TETROMINOS } from './waves-tetrominos.js';
import {
    VignetteShader,
    WaterBarrelShader,
    SprayShader,
    ExitGlowShader,
} from './waves-shaders.js';
import {
    RippleRingPool,
    DropletBurstPool,
    BubbleStreamPool,
    GodRayArray,
    PlanktonStreakPool,
    FoamCurtain,
} from './waves-effects.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: {
        waveSegments: 256,
        sprayCount: 2000,
        bloomStrength: 0.55,
        bloomRadius: 0.6,
        enablePostProcessing: true,
        ripplePool: 16,
        dropletsPerBurst: 120,
        bubbleStreamPool: 6,
        bubblesPerStream: 10,
        godRayCount: 8,
        plankStreakCount: 24,
        foamCurtainParticles: 400,
        enableBloomSurge: true,
    },
    Ultra: {
        waveSegments: 192,
        sprayCount: 1500,
        bloomStrength: 0.5,
        bloomRadius: 0.55,
        enablePostProcessing: true,
        ripplePool: 14,
        dropletsPerBurst: 100,
        bubbleStreamPool: 5,
        bubblesPerStream: 10,
        godRayCount: 8,
        plankStreakCount: 20,
        foamCurtainParticles: 300,
        enableBloomSurge: true,
    },
    High: {
        waveSegments: 128,
        sprayCount: 1000,
        bloomStrength: 0.45,
        bloomRadius: 0.5,
        enablePostProcessing: true,
        ripplePool: 12,
        dropletsPerBurst: 80,
        bubbleStreamPool: 4,
        bubblesPerStream: 8,
        godRayCount: 6,
        plankStreakCount: 16,
        foamCurtainParticles: 250,
        enableBloomSurge: true,
    },
    Medium: {
        waveSegments: 96,
        sprayCount: 600,
        bloomStrength: 0.4,
        bloomRadius: 0.45,
        enablePostProcessing: true,
        ripplePool: 10,
        dropletsPerBurst: 60,
        bubbleStreamPool: 3,
        bubblesPerStream: 8,
        godRayCount: 5,
        plankStreakCount: 12,
        foamCurtainParticles: 180,
        enableBloomSurge: false,
    },
    Low: {
        waveSegments: 64,
        sprayCount: 300,
        bloomStrength: 0.35,
        bloomRadius: 0.4,
        enablePostProcessing: false,
        ripplePool: 8,
        dropletsPerBurst: 40,
        bubbleStreamPool: 0,
        bubblesPerStream: 0,
        godRayCount: 4,
        plankStreakCount: 8,
        foamCurtainParticles: 0,
        enableBloomSurge: false,
    },
    Minimal: {
        waveSegments: 48,
        sprayCount: 150,
        bloomStrength: 0.3,
        bloomRadius: 0.35,
        enablePostProcessing: false,
        ripplePool: 6,
        dropletsPerBurst: 20,
        bubbleStreamPool: 0,
        bubblesPerStream: 0,
        godRayCount: 3,
        plankStreakCount: 0,
        foamCurtainParticles: 0,
        enableBloomSurge: false,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class WavesTheme extends BaseTheme {
    constructor() {
        super('waves');

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;

        // Scene elements
        this.barrel = null;
        this.barrelMaterial = null;
        this.spray = null;
        this.sprayMaterial = null;
        this.exitGlow = null;
        this.exitGlowMaterial = null;

        // Effect pools
        this.ripplePool = null;
        this.dropletPool = null;
        this.bubblePool = null;
        this.godRays = null;
        this.planktonStreaks = null;
        this.foamCurtain = null;

        // Game-state targets (smoothed each frame)
        this.glowIntensity = 0;
        this.targetGlowIntensity = 0;
        this.waveIntensity = 1.0;
        this.targetWaveIntensity = 1.0;
        this.causticsBase = 0.4;
        this.causticsIntensity = 0.4;
        this.targetCausticsIntensity = 0.4;
        this.sprayEventBoost = 0;
        this.targetSprayEventBoost = 0;
        this.foamBoost = 0;
        this.targetFoamBoost = 0;
        this.exitSurge = 0;
        this.targetExitSurge = 0;
        this.exitGlowBaseScale = 1.0;

        // Swell animation (line-clear surge travelling along Z)
        this.surgeActive = false;
        this.surgeAge = 0;
        this.surgeDuration = 1.2;
        this.surgePeakAmplitude = 0;
        this.surgeStartZ = 0;
        this.surgeEndZ = 0;

        // Bloom surge
        this.bloomBaseStrength = 0;
        this.bloomSurge = 0;
        this.targetBloomSurge = 0;

        // Impact-location history — avoid two bursts in the same spot
        this.recentImpactAngles = [];

        // Animation
        this.clock = new THREE.Clock();
        this.time = 0;
        this.animationFrameId = null;

        // State
        this.eventUnsubscribers = [];
        this.effectTimeouts = new Set();
        this.qualityPreset = QUALITY_PRESETS.High;

        this.barrelRadius = 10;
        this.barrelLength = 80;

        console.log('[Waves] Surf barrel theme constructed');
    }

    getTetrominoConfig() {
        return WAVES_TETROMINOS;
    }

    getCurrentQualityLevel() {
        if (typeof window !== 'undefined' && window.settings?.graphicsQuality) {
            return normalizeQuality(window.settings.graphicsQuality);
        }
        return 'High';
    }

    applyQualityPreset(quality) {
        this.qualityPreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
    }

    scheduleEffectTimeout(callback, delayMs = 0) {
        const id = window.setTimeout(() => {
            this.effectTimeouts.delete(id);
            if (this.isActive) callback();
        }, delayMs);
        this.effectTimeouts.add(id);
        return id;
    }

    clearEffectTimeouts() {
        this.effectTimeouts.forEach((id) => clearTimeout(id));
        this.effectTimeouts.clear();
    }

    async createScene() {
        console.log('[Waves] Creating surf barrel scene...');

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);

        const container = document.getElementById('waves-theme');
        if (!container) {
            console.error('[Waves] Container not found');
            return;
        }

        this.initRenderer(container);
        this.createBarrel();
        this.createExitGlow();
        this.createSpray();
        this.setupLighting();
        this.setupPostProcessing();
        this.createEffectPools();
        this.setupEventListeners();
        this.startAnimation();

        console.log('[Waves] Scene created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Renderer & Camera
    // ─────────────────────────────────────────────────────────────────────────

    initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({
            antialias: this.getAntialiasEnabled(),
            alpha: false,
            powerPreference: 'high-performance',
        });
        this.renderer.setClearColor(0x001015, 1);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setSize(width, height);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.15;

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x002233, 0.015);

        this.camera = new THREE.PerspectiveCamera(95, width / height, 0.1, 150);
        this.camera.position.set(0, 0, -25);
        this.camera.lookAt(0, 0, 40);

        console.log('[Waves] Renderer initialized');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Barrel
    // ─────────────────────────────────────────────────────────────────────────

    createBarrel() {
        const segments = this.qualityPreset.waveSegments;
        const geometry = new THREE.CylinderGeometry(
            this.barrelRadius,
            this.barrelRadius,
            this.barrelLength,
            segments,
            segments / 2,
            true,
        );
        geometry.rotateX(Math.PI / 2);

        // Deep-clone uniforms so pool-shared structures aren't mutated
        const uniforms = THREE.UniformsUtils.clone(WaterBarrelShader.uniforms);
        uniforms.uBarrelRadius.value = this.barrelRadius;
        this.causticsBase = uniforms.uCausticsIntensity.value;

        this.barrelMaterial = new THREE.ShaderMaterial({
            uniforms,
            vertexShader: WaterBarrelShader.vertexShader,
            fragmentShader: WaterBarrelShader.fragmentShader,
            side: THREE.BackSide,
            transparent: true,
        });

        this.barrel = new THREE.Mesh(geometry, this.barrelMaterial);
        this.scene.add(this.barrel);

        console.log('[Waves] Barrel created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Exit Glow
    // ─────────────────────────────────────────────────────────────────────────

    createExitGlow() {
        const geometry = new THREE.PlaneGeometry(40, 40);
        const uniforms = THREE.UniformsUtils.clone(ExitGlowShader.uniforms);
        this.exitGlowMaterial = new THREE.ShaderMaterial({
            uniforms,
            vertexShader: ExitGlowShader.vertexShader,
            fragmentShader: ExitGlowShader.fragmentShader,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
        });

        this.exitGlow = new THREE.Mesh(geometry, this.exitGlowMaterial);
        this.exitGlow.position.set(5, 2, 45);
        this.exitGlow.rotation.y = -0.1;
        this.scene.add(this.exitGlow);

        console.log('[Waves] Exit glow created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Spray
    // ─────────────────────────────────────────────────────────────────────────

    createSpray() {
        const count = this.qualityPreset.sprayCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);
        const speeds = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const angle = Math.random() * Math.PI * 1.5 + Math.PI * 0.25;
            const radius = 2 + Math.random() * 9;
            const z = (Math.random() - 0.5) * 60;

            positions[i3] = Math.cos(angle) * radius;
            positions[i3 + 1] = Math.sin(angle) * radius;
            positions[i3 + 2] = z;

            sizes[i] = 2 + Math.random() * 5;
            phases[i] = Math.random() * Math.PI * 2;
            speeds[i] = 0.2 + Math.random() * 0.5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

        const uniforms = THREE.UniformsUtils.clone(SprayShader.uniforms);
        this.sprayMaterial = new THREE.ShaderMaterial({
            uniforms,
            vertexShader: SprayShader.vertexShader,
            fragmentShader: SprayShader.fragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.spray = new THREE.Points(geometry, this.sprayMaterial);
        this.scene.add(this.spray);

        console.log('[Waves] Spray created -', count, 'particles');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lighting
    // ─────────────────────────────────────────────────────────────────────────

    setupLighting() {
        const ambient = new THREE.AmbientLight(0x224455, 0.3);
        this.scene.add(ambient);

        const exitLight = new THREE.PointLight(0xaaeeff, 1.2, 80);
        exitLight.position.set(5, 5, 50);
        this.scene.add(exitLight);

        const topLight = new THREE.DirectionalLight(0x66aacc, 0.4);
        topLight.position.set(0, 20, 0);
        this.scene.add(topLight);

        const fill = new THREE.PointLight(0x003344, 0.3, 40);
        fill.position.set(0, 0, -20);
        this.scene.add(fill);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post-Processing
    // ─────────────────────────────────────────────────────────────────────────

    setupPostProcessing() {
        if (!this.qualityPreset.enablePostProcessing) return;

        const width = window.innerWidth;
        const height = window.innerHeight;

        this.composer = new EffectComposer(this.renderer);

        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        this.bloomBaseStrength = this.qualityPreset.bloomStrength;
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(width, height),
            this.bloomBaseStrength,
            this.qualityPreset.bloomRadius,
            0.75,
        );
        this.composer.addPass(this.bloomPass);

        const vignettePass = new ShaderPass(VignetteShader);
        this.composer.addPass(vignettePass);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Effect Pools
    // ─────────────────────────────────────────────────────────────────────────

    createEffectPools() {
        const p = this.qualityPreset;

        if (p.ripplePool > 0) {
            this.ripplePool = new RippleRingPool(this.scene, p.ripplePool);
        }
        if (p.dropletsPerBurst > 0 && p.ripplePool > 0) {
            this.dropletPool = new DropletBurstPool(this.scene, p.ripplePool, p.dropletsPerBurst);
        }
        if (p.bubbleStreamPool > 0 && p.bubblesPerStream > 0) {
            this.bubblePool = new BubbleStreamPool(this.scene, p.bubbleStreamPool, p.bubblesPerStream);
        }
        if (p.godRayCount > 0) {
            const anchor = this.exitGlow ? this.exitGlow.position : new THREE.Vector3(5, 2, 45);
            this.godRays = new GodRayArray(this.scene, p.godRayCount, anchor);
        }
        if (p.plankStreakCount > 0) {
            this.planktonStreaks = new PlanktonStreakPool(this.scene, p.plankStreakCount, this.barrelRadius - 0.3);
        }
        if (p.foamCurtainParticles > 0) {
            this.foamCurtain = new FoamCurtain(this.scene, p.foamCurtainParticles, this.barrelRadius - 0.2);
        }

        console.log('[Waves] Effect pools created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        this.teardownEventListeners();

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                const detail = data?.detail || data || {};
                const lineCount = detail.lineCount ?? detail.count ?? detail.lines ?? 1;
                this.onLineClear(lineCount);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                const detail = data?.detail || data || {};
                const comboCount = detail.comboCount ?? detail.combo ?? detail.count ?? 0;
                this.onCombo(comboCount);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock();
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);

        this.handleResize = () => {
            if (!this.isActive || !this.renderer) return;
            const width = window.innerWidth;
            const height = window.innerHeight;
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(width, height);
            if (this.composer) this.composer.setSize(width, height);
        };
        window.addEventListener('resize', this.handleResize);
    }

    teardownEventListeners() {
        this.eventUnsubscribers.forEach((unsub) => {
            try { unsub?.(); } catch { /* ignore */ }
        });
        this.eventUnsubscribers = [];
        if (this.handleResize) {
            window.removeEventListener('resize', this.handleResize);
            this.handleResize = null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Impact Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Pick a random angle around the barrel, avoiding angles close to the last 2
     * impacts so successive splashes feel visually varied.
     */
    pickImpactAngle() {
        const MIN_SEPARATION = 0.9; // rad
        let angle = 0;
        for (let attempt = 0; attempt < 8; attempt++) {
            angle = Math.random() * Math.PI * 2;
            let ok = true;
            for (const prev of this.recentImpactAngles) {
                let diff = Math.abs(angle - prev);
                if (diff > Math.PI) diff = Math.PI * 2 - diff;
                if (diff < MIN_SEPARATION) { ok = false; break; }
            }
            if (ok) break;
        }
        this.recentImpactAngles.push(angle);
        if (this.recentImpactAngles.length > 2) this.recentImpactAngles.shift();
        return angle;
    }

    /**
     * Produce an impact point on the inner barrel wall and its inward normal.
     */
    computeImpact(zBiasAhead = true) {
        const angle = this.pickImpactAngle();
        const camZ = this.camera ? this.camera.position.z : -25;
        const zOffset = zBiasAhead
            ? Math.random() * 35 - 5   // mostly ahead of camera
            : (Math.random() - 0.5) * 40;
        const z = camZ + zOffset;

        const r = this.barrelRadius - 0.15;
        const origin = new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
        // Inward normal = from wall point toward the barrel axis
        const wallNormal = new THREE.Vector3(-Math.cos(angle), -Math.sin(angle), 0).normalize();
        return { origin, wallNormal, angle, z };
    }

    triggerDropletImpact(opts = {}) {
        const strength = opts.strength ?? 1.0;
        const { origin, wallNormal } = this.computeImpact(opts.biasAhead !== false);

        if (this.ripplePool) {
            this.ripplePool.trigger(
                origin,
                wallNormal,
                strength,
                opts.rippleRadius ?? 4.0,
                opts.rippleDuration ?? 0.6,
            );
        }
        if (this.dropletPool) {
            this.dropletPool.trigger(origin, wallNormal, {
                strength,
                size: opts.dropletSize ?? 8.0,
                duration: opts.dropletDuration ?? 0.85,
                speed: opts.dropletSpeed ?? 6.0,
            });
        }
        if (this.bubblePool && (opts.spawnBubbles ?? Math.random() < 0.6)) {
            this.bubblePool.trigger(origin, wallNormal, {
                strength: strength * 0.8,
                duration: 1.5,
            });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Game Events
    // ─────────────────────────────────────────────────────────────────────────

    onPieceLock() {
        this.triggerDropletImpact({ strength: 0.9, rippleRadius: 3.5, dropletSpeed: 5.5 });

        // Caustic flash — brief surge above the baseline
        this.targetCausticsIntensity = Math.max(this.targetCausticsIntensity, this.causticsBase + 0.5);

        // Existing glow nudge preserved
        this.targetGlowIntensity = Math.min(this.targetGlowIntensity + 0.1, 0.5);
    }

    onLineClear(lineCount) {
        const n = Math.max(1, Math.min(lineCount, 4));
        const burstCount = [2, 4, 6, 8][n - 1];
        const surgeAmp = [0.6, 1.0, 1.5, 2.2][n - 1];
        const sprayBoost = [0.3, 0.5, 0.7, 1.0][n - 1];
        const foamAmt = [0.2, 0.35, 0.55, 0.8][n - 1];

        // Staggered droplet bursts around the camera
        for (let i = 0; i < burstCount; i++) {
            this.scheduleEffectTimeout(() => {
                this.triggerDropletImpact({
                    strength: 1.1,
                    rippleRadius: 4.5,
                    dropletSpeed: 7.5,
                    dropletSize: 10.0,
                    spawnBubbles: i % 2 === 0,
                });
            }, i * 60);
        }

        // Swell surge rolling past the camera toward the exit
        this.surgeActive = true;
        this.surgeAge = 0;
        this.surgeDuration = 1.2;
        this.surgePeakAmplitude = surgeAmp;
        this.surgeStartZ = (this.camera?.position.z ?? -25) - 5;
        this.surgeEndZ = this.surgeStartZ + 70;

        // Spray + foam boosts
        this.targetSprayEventBoost = Math.max(this.targetSprayEventBoost, sprayBoost);
        this.targetFoamBoost = Math.max(this.targetFoamBoost, foamAmt);

        // Existing wave/glow envelope
        this.targetWaveIntensity = Math.min(1.0 + lineCount * 0.3, 2.5);
        this.targetGlowIntensity = Math.min(0.3 + lineCount * 0.2, 1.0);

        // Caustic flash stacks with lock flash
        this.targetCausticsIntensity = Math.max(
            this.targetCausticsIntensity,
            this.causticsBase + 0.8,
        );
    }

    onCombo(comboCount) {
        if (comboCount < 2) return;
        const c = Math.max(2, Math.min(comboCount, 7));

        // Tier table (plan §5.2)
        const godRayTier = [0, 4, 6, 8, 8, 8][Math.min(c - 2, 5)];
        const exitSurgeTier = [0.2, 0.4, 0.6, 0.8, 0.8, 0.8][Math.min(c - 2, 5)];
        const plankCount = [8, 12, 16, 20, 20, 20][Math.min(c - 2, 5)];
        const lipFoamParticles = [0, 0, 200, 400, 400, 400][Math.min(c - 2, 5)];
        const bloomBoost = [0, 0.1, 0.15, 0.25, 0.25, 0.25][Math.min(c - 2, 5)];

        // God-ray shafts through the exit
        if (this.godRays && godRayTier > 0) {
            this.godRays.trigger(1.0, 1.5);
        }

        // Exit-glow surge
        this.targetExitSurge = Math.max(this.targetExitSurge, exitSurgeTier);

        // Plankton streaks chasing the curl
        if (this.planktonStreaks && plankCount > 0) {
            const camZ = this.camera?.position.z ?? -25;
            this.planktonStreaks.trigger(
                Math.min(plankCount, this.qualityPreset.plankStreakCount),
                camZ + 5,
                1.0,
                1.4,
            );
        }

        // Breaking-lip foam curtain (combo ≥ 4)
        if (this.foamCurtain && lipFoamParticles > 0 && c >= 4) {
            const camZ = this.camera?.position.z ?? -25;
            this.foamCurtain.trigger(camZ + 10, 1.0, 2.0);
        }

        // Bloom surge
        if (this.qualityPreset.enableBloomSurge && this.bloomPass && bloomBoost > 0) {
            this.targetBloomSurge = Math.max(this.targetBloomSurge, bloomBoost);
        }

        // Existing scalar pushes
        this.targetWaveIntensity = Math.min(1.5 + comboCount * 0.15, 3.0);
        this.targetGlowIntensity = Math.min(0.5 + comboCount * 0.15, 1.8);
        this.targetCausticsIntensity = Math.max(
            this.targetCausticsIntensity,
            this.causticsBase + 1.0,
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    startAnimation() {
        const animate = () => {
            if (!this.isActive) return;

            const delta = this.clock.getDelta();
            this.time += delta;

            // Scalar smoothing + decay of event-driven targets
            this.glowIntensity += (this.targetGlowIntensity - this.glowIntensity) * delta * 3;
            this.targetGlowIntensity *= 0.97;

            this.waveIntensity += (this.targetWaveIntensity - this.waveIntensity) * delta * 2;
            this.targetWaveIntensity += (1.0 - this.targetWaveIntensity) * delta * 0.4;

            // Caustics: event targets decay back toward baseline
            this.causticsIntensity += (this.targetCausticsIntensity - this.causticsIntensity) * delta * 4;
            this.targetCausticsIntensity += (this.causticsBase - this.targetCausticsIntensity) * delta * 1.5;

            this.sprayEventBoost += (this.targetSprayEventBoost - this.sprayEventBoost) * delta * 4;
            this.targetSprayEventBoost *= 0.94;

            this.foamBoost += (this.targetFoamBoost - this.foamBoost) * delta * 3;
            this.targetFoamBoost *= 0.93;

            this.exitSurge += (this.targetExitSurge - this.exitSurge) * delta * 4;
            this.targetExitSurge *= 0.93;

            this.bloomSurge += (this.targetBloomSurge - this.bloomSurge) * delta * 4;
            this.targetBloomSurge *= 0.9;

            // Swell surge Z animation
            let surgeAmplitudeNow = 0;
            let surgeCenterZ = 0;
            if (this.surgeActive) {
                this.surgeAge += delta;
                const t = this.surgeAge / this.surgeDuration;
                if (t >= 1.0) {
                    this.surgeActive = false;
                } else {
                    // Ease-in-out amplitude envelope
                    const envelope = Math.sin(t * Math.PI);
                    surgeAmplitudeNow = this.surgePeakAmplitude * envelope;
                    surgeCenterZ = this.surgeStartZ + (this.surgeEndZ - this.surgeStartZ) * t;
                }
            }

            // Gentle camera sway
            if (this.camera) {
                this.camera.position.x = Math.sin(this.time * 0.3) * 0.8;
                this.camera.position.y = Math.sin(this.time * 0.4) * 0.5;
            }

            // Update shaders
            if (this.barrelMaterial) {
                const u = this.barrelMaterial.uniforms;
                u.uTime.value = this.time;
                u.uWaveIntensity.value = this.waveIntensity;
                u.uGlowIntensity.value = this.glowIntensity;
                u.uCausticsIntensity.value = this.causticsIntensity;
                u.uFoamBoost.value = this.foamBoost;
                u.uSurgeAmplitude.value = surgeAmplitudeNow;
                u.uSurgeCenterZ.value = surgeCenterZ;
            }

            if (this.sprayMaterial) {
                this.sprayMaterial.uniforms.uTime.value = this.time;
                this.sprayMaterial.uniforms.uEventBoost.value = this.sprayEventBoost;
            }

            if (this.exitGlowMaterial) {
                this.exitGlowMaterial.uniforms.uSurge.value = this.exitSurge;
            }
            if (this.exitGlow) {
                const s = this.exitGlowBaseScale + this.exitSurge * 0.6;
                this.exitGlow.scale.set(s, s, 1);
            }

            if (this.bloomPass) {
                this.bloomPass.strength = this.bloomBaseStrength + this.bloomSurge;
            }

            // Update effect pools
            if (this.ripplePool) this.ripplePool.update(delta);
            if (this.dropletPool) this.dropletPool.update(delta);
            if (this.bubblePool) this.bubblePool.update(delta);
            if (this.godRays) this.godRays.update(delta, this.time);
            if (this.planktonStreaks) this.planktonStreaks.update(delta);
            if (this.foamCurtain) this.foamCurtain.update(delta);

            // Render
            if (this.composer) {
                this.composer.render(delta);
            } else {
                this.renderer.render(this.scene, this.camera);
            }

            this.animationFrameId = requestAnimationFrame(animate);
            this.registerAnimation(this.animationFrameId);
        };

        this.animationFrameId = requestAnimationFrame(animate);
        this.registerAnimation(this.animationFrameId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cleanup
    // ─────────────────────────────────────────────────────────────────────────

    cleanup() {
        console.log('[Waves] Cleaning up...');

        this.teardownEventListeners();
        this.clearEffectTimeouts();

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (this.ripplePool) { this.ripplePool.dispose(); this.ripplePool = null; }
        if (this.dropletPool) { this.dropletPool.dispose(); this.dropletPool = null; }
        if (this.bubblePool) { this.bubblePool.dispose(); this.bubblePool = null; }
        if (this.godRays) { this.godRays.dispose(); this.godRays = null; }
        if (this.planktonStreaks) { this.planktonStreaks.dispose(); this.planktonStreaks = null; }
        if (this.foamCurtain) { this.foamCurtain.dispose(); this.foamCurtain = null; }

        if (this.barrel) {
            this.barrel.geometry.dispose();
            this.barrelMaterial?.dispose();
            this.scene.remove(this.barrel);
        }

        if (this.exitGlow) {
            this.exitGlow.geometry.dispose();
            this.exitGlowMaterial?.dispose();
            this.scene.remove(this.exitGlow);
        }

        if (this.spray) {
            this.spray.geometry.dispose();
            this.sprayMaterial?.dispose();
            this.scene.remove(this.spray);
        }

        if (this.composer) {
            this.composer.dispose();
            this.composer = null;
        }

        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }

        this.scene = null;
        this.camera = null;
        this.barrel = null;
        this.barrelMaterial = null;
        this.exitGlow = null;
        this.exitGlowMaterial = null;
        this.spray = null;
        this.sprayMaterial = null;
        this.bloomPass = null;

        super.cleanup();

        console.log('[Waves] Cleanup complete');
    }
}
