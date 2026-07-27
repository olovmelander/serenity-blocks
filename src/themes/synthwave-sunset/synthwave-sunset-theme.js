/**
 * Synthwave Sunset Theme - Three.js Masterpiece Edition
 *
 * A stunning 3D retrofuturistic experience featuring:
 * - Infinite perspective neon grid with glow
 * - Volumetric sun with stripes and corona
 * - 3D procedural cityscape with window lights
 * - Dynamic tetromino grid highlighting
 * - Particle-based combo effects
 * - Post-processing bloom and atmosphere
 */

import * as THREE from 'three/webgpu';
import { WebGLRenderer } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { SYNTHWAVE_SUNSET_TETROMINOS } from './synthwave-sunset-tetrominos.js';
import {
    createGridNodeMaterial,
    createSunNodeMaterial,
    createSunGlowNodeMaterial,
    createStarNodeMaterial,
    createHighlightNodeMaterial,
    createParticleNodeMaterial,
    createBuildingNodeMaterial,
    createBuildingEdgeNodeMaterial,
    createMoteNodeMaterial,
    createHazeNodeMaterial,
    createPalmNodeMaterial,
} from './synthwave-sunset-materials.js';
import { SynthwaveSunsetPost } from './synthwave-sunset-post.js';
import { SynthwaveParticleCompute, SynthwaveHighlightCompute } from './synthwave-sunset-compute.js';
import {
    gridVertexShader,
    gridFragmentShader,
    sunVertexShader,
    sunFragmentShader,
    sunGlowVertexShader,
    sunGlowFragmentShader,
    starVertexShader,
    starFragmentShader,
    highlightVertexShader,
    highlightFragmentShader,
    particleVertexShader,
    particleFragmentShader,
} from './synthwave-shaders.js';

export default class SynthwaveSunsetTheme extends BaseTheme {
    constructor() {
        super('synthwave-sunset');

        // Three.js core
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();
        this.isWebGPU = false;
        this.isWebGL = false;
        this.forceWebGL = false;
        this.enableWebGPU = false;
        this.webgpuMaterialsReady = true;
        this._sceneToken = 0;
        this._resizeHandler = null;
        this.baselineEnabled = false;
        this.baselineFrames = [];
        this.baselineMaxFrames = 600;
        this.fixedDtSeconds = null;
        this.fixedElapsed = 0;
        this.dynamicResolution = {
            enabled: true,
            scale: 1.0,
            minScale: 0.7,
            maxScale: 1.0,
            targetMs: 16.6,
            emaMs: 16.6,
            adjustInterval: 0.5,
            elapsed: 0,
        };
        this.budgetMonitor = {
            enabled: false,
            samples: [],
            maxSamples: 120,
            lastLog: 0,
            lastWarn: 0,
            warnThreshold: 28,
            frameStart: 0,
            lastMark: 0,
            marks: [],
        };
        this.lodState = {
            starCount: 0,
            showFarBuildings: true,
        };
        this.randomFn = Math.random;
        this.randomSeed = null;
        this.noPost = false;
        this.mrtAuditEnabled = false;
        this.smoothedTime = 0;
        this.lastElapsed = 0;
        this.gridUniforms = null;
        this.sunUniforms = null;
        this.sunGlowUniforms = [];
        this.starUniforms = null;
        this.highlightUniforms = [];
        this.particleUniforms = null;
        this.postProcessing = null;
        this.particleCompute = null;
        this.highlightCompute = null;
        this.highlightInstanced = null;
        this.highlightData = [];
        this.buildingEdgeUniforms = null;
        this.buildingEdgeMaterial = null;
        this.buildingMaterials = [];
        this.buildingUniforms = [];
        this.shootingStarPool = [];

        // Scene elements
        this.grid = null;
        this.sun = null;
        this.sunGlowLayers = [];
        this.starField = null;
        this.buildings = [];
        this.buildingEdges = [];
        this.hazeLayers = [];
        this.ambientMotes = null;
        this.ambientMotesUniforms = null;
        this.palms = [];
        this.palmUniforms = [];

        // Effects
        this.gridHighlights = [];
        this.highlightPool = [];
        this.particles = null;
        this.particleData = [];

        // Animation state
        this.sunPosition = { x: 0, y: 0 };
        this.sunPhaseX = 0;
        this.timeOffset = 0;
        this.sunScreenUv = new THREE.Vector2(0.5, 0.5);
        this.sunNdc = new THREE.Vector3();
        this.horizonUv = 0.46;
        this._sunWorld = new THREE.Vector3();
        this._horizonWorld = new THREE.Vector3(0, 10, -80);
        this._horizonNdc = new THREE.Vector3();
        this.horizonOffset = 0.05;

        // Event state
        this.gridPulseIntensity = 0;
        this.gridWaveOrigin = new THREE.Vector2(0, 0);
        this.gridWaveIntensity = 0;
        this.gridWaveFrequency = 0.35;
        this.gridWaveSpeed = 6.0;
        this.gridWaveFalloff = 0.045;
        this.gridWaveDecay = 0.92;
        this.enableGridWaves = false;
        this.sunPulseIntensity = 0;
        this.cityGlowIntensity = 0;
        this.comboColorShift = 0;
        this.highlightTwinkleIntensity = 0; // For combo twinkle effect on highlights

        // Event handlers
        this.eventUnsubscribers = [];

        // Pointer tracking for parallax camera
        this.pointerX = 0;
        this.pointerY = 0;
        this.smoothedPointerX = 0;
        this.smoothedPointerY = 0;

        // Quality presets — new tier keys drive the AAA visual stack:
        //   windowEmissive / windowFlicker / rimIntensity / colorVariety → buildings
        //   hazeLayers / ambientMotes / palms → atmospheric depth
        //   chromaticAberration / filmGrain / reflectionIntensity → post
        this.qualityPresets = {
            Minimal: {
                starCount: 500,
                buildingCount: 30,
                glowLayers: 1,
                maxHighlights: 30,
                particleBudget: 500,
                windowEmissive: 0.25,
                windowFlicker: 0,
                rimIntensity: 0.3,
                colorVariety: 0,
                hazeLayers: 0,
                ambientMotes: 0,
                palms: 0,
                chromaticAberration: 0.0,
                filmGrain: 0.0,
                reflectionIntensity: 0.0,
            },
            Low: {
                starCount: 1000,
                buildingCount: 50,
                glowLayers: 2,
                maxHighlights: 40,
                particleBudget: 1000,
                windowEmissive: 0.3,
                windowFlicker: 0,
                rimIntensity: 0.35,
                colorVariety: 0,
                hazeLayers: 0,
                ambientMotes: 0,
                palms: 0,
                chromaticAberration: 0.0,
                filmGrain: 0.0,
                reflectionIntensity: 0.0,
            },
            Medium: {
                starCount: 1800,
                buildingCount: 70,
                glowLayers: 3,
                maxHighlights: 60,
                particleBudget: 2000,
                windowEmissive: 0.4,
                windowFlicker: 0,
                rimIntensity: 0.45,
                colorVariety: 1,
                hazeLayers: 1,
                ambientMotes: 100,
                palms: 0,
                chromaticAberration: 0.0,
                filmGrain: 0.0,
                reflectionIntensity: 0.0,
            },
            High: {
                starCount: 2500,
                buildingCount: 90,
                glowLayers: 4,
                maxHighlights: 80,
                particleBudget: 3500,
                windowEmissive: 0.5,
                windowFlicker: 1,
                rimIntensity: 0.55,
                colorVariety: 1,
                hazeLayers: 3,
                ambientMotes: 220,
                palms: 4,
                chromaticAberration: 0.2,
                filmGrain: 0.0,
                reflectionIntensity: 0.0,
            },
            Ultra: {
                starCount: 4000,
                buildingCount: 120,
                glowLayers: 5,
                maxHighlights: 100,
                particleBudget: 6000,
                windowEmissive: 0.55,
                windowFlicker: 1,
                rimIntensity: 0.6,
                colorVariety: 1,
                hazeLayers: 3,
                ambientMotes: 320,
                palms: 6,
                chromaticAberration: 0.25,
                filmGrain: 0.0,
                reflectionIntensity: 0.0,
            },
            Extreme: {
                starCount: 6000,
                buildingCount: 150,
                glowLayers: 6,
                maxHighlights: 150,
                particleBudget: 10000,
                windowEmissive: 0.6,
                windowFlicker: 1,
                rimIntensity: 0.65,
                colorVariety: 1,
                hazeLayers: 3,
                ambientMotes: 420,
                palms: 6,
                chromaticAberration: 0.3,
                filmGrain: 0.0,
                reflectionIntensity: 0.0,
            },
        };
        this.currentQuality = 'High';
        this.activePreset = this.qualityPresets.High;

        // Colors
        this.colors = {
            gridPink: new THREE.Color(0xff0066),
            gridCyan: new THREE.Color(0x00ffff),
            sunTop: new THREE.Color(0xffdd00),
            sunMid: new THREE.Color(0xff8800),
            sunBottom: new THREE.Color(0xff0066),
            skyTop: new THREE.Color(0x1a0033),
            skyMid: new THREE.Color(0x660066),
            skyBottom: new THREE.Color(0xff6600),
            buildingDark: new THREE.Color(0x0a0515),
        };

        // Neon palette for highlights
        this.neonColors = [
            new THREE.Color(0x00ffff), // Cyan
            new THREE.Color(0xff00ff), // Magenta
            new THREE.Color(0xffff00), // Yellow
            new THREE.Color(0x00ff00), // Lime
            new THREE.Color(0x9900ff), // Purple
            new THREE.Color(0xff6600), // Orange
        ];

        // Tetromino shapes (relative cell positions)
        this.tetrominoShapes = [
            [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }], // I
            [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }], // J
            [{ x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }], // L
            [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }], // O
            [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }], // S
            [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }], // T
            [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }], // Z
        ];
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    getDebugFlags() {
        if (typeof window === 'undefined') {
            return {
                forceWebGL: false,
                baseline: false,
                enableWebGPU: false,
                fixedDt: null,
                seed: null,
                noPost: false,
                noDrs: false,
                budget: false,
                mrtAudit: false,
            };
        }

        const params = new URLSearchParams(window.location.search);
        const hasFlag = (name) => params.has(name)
            || params.get(name) === '1'
            || params.get(name) === 'true';

        const forceWebGL = hasFlag('forceWebGL');
        const baseline = hasFlag('synthwaveBaseline') || hasFlag('baseline');
        const enableWebGPU = !hasFlag('synthwaveNoWebGPU') && !hasFlag('noWebGPU');
        const noPost = hasFlag('synthwaveNoPost') || hasFlag('noPost');
        const noDrs = hasFlag('synthwaveNoDRS') || hasFlag('noDRS') || hasFlag('noDrs');
        const budget = hasFlag('synthwaveBudget') || hasFlag('budget');
        const mrtAudit = hasFlag('synthwaveMrtAudit') || hasFlag('mrtAudit');

        const fixedDtValue = Number(params.get('synthwaveFixedDt') || params.get('fixedDt'));
        const fixedDt = Number.isFinite(fixedDtValue) && fixedDtValue > 0 ? fixedDtValue : null;

        const seedValue = Number(params.get('synthwaveSeed') || params.get('seed'));
        const seed = Number.isFinite(seedValue) ? seedValue : null;

        return {
            forceWebGL,
            baseline,
            enableWebGPU,
            fixedDt,
            seed,
            noPost,
            noDrs,
            budget,
            mrtAudit,
        };
    }

    isNodeMaterial(material) {
        if (!material) return false;
        if (material.isNodeMaterial) return true;
        if (
            material.isMeshBasicNodeMaterial
            || material.isMeshStandardNodeMaterial
            || material.isMeshPhysicalNodeMaterial
            || material.isMeshPhongNodeMaterial
            || material.isPointsNodeMaterial
        ) {
            return true;
        }
        const type = material.type || material.constructor?.name || '';
        return type.includes('NodeMaterial');
    }

    auditMrtMaterials(label = 'MRT Audit') {
        if (!this.isWebGPU || !this.scene) return;

        const seen = new Set();
        const nonNode = [];
        const missingEmissive = [];

        const recordMaterial = (material, object) => {
            if (!material) return;
            if (Array.isArray(material)) {
                material.forEach((mat) => recordMaterial(mat, object));
                return;
            }
            if (seen.has(material)) return;
            seen.add(material);

            const objectName = object?.name || object?.type || 'UnknownObject';
            const materialName = material.name || material.type || material.constructor?.name || 'UnknownMaterial';

            if (!this.isNodeMaterial(material)) {
                nonNode.push({ objectName, materialName });
                return;
            }
            if (!('emissiveNode' in material) || !material.emissiveNode) {
                missingEmissive.push({ objectName, materialName });
            }
        };

        if (this.scene.material) {
            recordMaterial(this.scene.material, this.scene);
        }
        this.scene.traverse((child) => {
            if (child.material) {
                recordMaterial(child.material, child);
            }
        });

        const formatSample = (entries) => entries
            .slice(0, 12)
            .map((entry) => `- ${entry.objectName}: ${entry.materialName}`)
            .join('\n');

        console.groupCollapsed(`[SynthwaveSunset][${label}] WebGPU MRT material audit`);
        console.log(`Total unique materials: ${seen.size}`);
        console.log(`Non-NodeMaterials: ${nonNode.length}`);
        if (nonNode.length) console.warn(formatSample(nonNode));
        console.log(`NodeMaterials missing emissiveNode: ${missingEmissive.length}`);
        if (missingEmissive.length) console.warn(formatSample(missingEmissive));
        console.groupEnd();
    }

    initRandom(seed) {
        if (Number.isFinite(seed)) {
            this.randomSeed = seed;
            this.randomFn = this.seededRandom(seed);
        } else {
            this.randomSeed = null;
            this.randomFn = Math.random;
        }
    }

    rand() {
        return this.randomFn ? this.randomFn() : Math.random();
    }

    trackBaseline(delta) {
        const frameMs = delta * 1000;
        this.baselineFrames.push(frameMs);
        if (this.baselineFrames.length > this.baselineMaxFrames) {
            this.baselineFrames.shift();
        }
    }

    resetBaseline() {
        this.baselineFrames = [];
    }

    reportBaseline() {
        if (!this.baselineFrames.length) {
            console.log('[SynthwaveBaseline] No frames collected yet.');
            return null;
        }
        const frames = [...this.baselineFrames].sort((a, b) => a - b);
        const avgMs = this.baselineFrames.reduce((a, b) => a + b, 0) / this.baselineFrames.length;
        const avgFps = 1000 / avgMs;
        const p99Index = Math.max(0, Math.floor(frames.length * 0.99) - 1);
        const p99Ms = frames[p99Index];
        const low1Fps = 1000 / p99Ms;
        const report = {
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL',
            preset: this.currentQuality,
            avgFps: Number(avgFps.toFixed(1)),
            p99Ms: Number(p99Ms.toFixed(2)),
            low1Fps: Number(low1Fps.toFixed(1)),
            frames: this.baselineFrames.length,
        };
        console.log('[SynthwaveBaseline] Report:', report);
        return report;
    }

    beginBudgetFrame() {
        if (!this.budgetMonitor?.enabled || typeof performance === 'undefined') return;
        const now = performance.now();
        this.budgetMonitor.frameStart = now;
        this.budgetMonitor.lastMark = now;
        this.budgetMonitor.marks = [];
    }

    markBudget(label) {
        if (!this.budgetMonitor?.enabled || typeof performance === 'undefined') return;
        const now = performance.now();
        const ms = now - this.budgetMonitor.lastMark;
        this.budgetMonitor.lastMark = now;
        this.budgetMonitor.marks.push({ label, ms });
    }

    endBudgetFrame() {
        if (!this.budgetMonitor?.enabled || typeof performance === 'undefined') return;
        const now = performance.now();
        const frameMs = now - this.budgetMonitor.frameStart;
        const sample = {
            frameMs,
            marks: this.budgetMonitor.marks,
            calls: this.renderer?.info?.render?.calls ?? 0,
            triangles: this.renderer?.info?.render?.triangles ?? 0,
        };
        this.budgetMonitor.samples.push(sample);
        if (this.budgetMonitor.samples.length > this.budgetMonitor.maxSamples) {
            this.budgetMonitor.samples.shift();
        }

        if (frameMs > this.budgetMonitor.warnThreshold) {
            if (!this.budgetMonitor.lastWarn || now - this.budgetMonitor.lastWarn > 1000) {
                this.budgetMonitor.lastWarn = now;
                const breakdown = sample.marks.map((m) => `${m.label}:${m.ms.toFixed(1)}ms`).join(' ');
                console.warn(`[SynthwaveBudget][Slow] ${frameMs.toFixed(1)}ms | ${breakdown}`);
            }
        }

        if (!this.budgetMonitor.lastLog || now - this.budgetMonitor.lastLog > 5000) {
            this.budgetMonitor.lastLog = now;
            const frames = this.budgetMonitor.samples.map((s) => s.frameMs);
            const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
            const sorted = [...frames].sort((a, b) => a - b);
            const p95Index = Math.max(0, Math.floor(sorted.length * 0.95) - 1);
            const p95 = sorted[p95Index] ?? avg;
            const avgCalls = this.budgetMonitor.samples
                .reduce((sum, s) => sum + s.calls, 0) / this.budgetMonitor.samples.length;
            console.log(`[SynthwaveBudget] avg=${avg.toFixed(1)}ms p95=${p95.toFixed(1)}ms calls=${avgCalls.toFixed(0)}`);
        }
    }

    applyLod() {
        if (!this.dynamicResolution?.enabled) return;

        const scale = this.dynamicResolution.scale;
        let starFactor = 1.0;
        if (scale < 0.75) {
            starFactor = 0.4;
        } else if (scale < 0.85) {
            starFactor = 0.6;
        }

        if (this.starField?.geometry) {
            const baseCount = this.starField.userData.baseCount || this.activePreset.starCount;
            const targetCount = Math.max(150, Math.floor(baseCount * starFactor));
            const current = this.starField.geometry.drawRange?.count ?? baseCount;
            if (current !== targetCount) {
                this.starField.geometry.setDrawRange(0, targetCount);
                this.lodState.starCount = targetCount;
            }
        }

        const showFarBuildings = starFactor >= 0.6;
        if (this.buildings.length >= 2 && this.buildingEdges.length >= 2) {
            if (this.lodState.showFarBuildings !== showFarBuildings) {
                this.buildings[0].visible = showFarBuildings;
                this.buildingEdges[0].visible = showFarBuildings;
                this.lodState.showFarBuildings = showFarBuildings;
            }
        }
    }

    getDynamicPixelRatio() {
        const baseRatio = this.getEffectivePixelRatio();
        const scale = this.dynamicResolution?.enabled ? this.dynamicResolution.scale : 1.0;
        return Math.max(0.25, Math.round(baseRatio * scale * 100) / 100);
    }

    applyDynamicResolution() {
        if (!this.renderer || typeof window === 'undefined') return;
        const ratio = this.getDynamicPixelRatio();
        this.renderer.setPixelRatio(ratio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        const pixelRatio = this.renderer.getPixelRatio();
        if (this.starUniforms?.uPixelRatio) this.starUniforms.uPixelRatio.value = pixelRatio;
        if (this.particleUniforms?.uPixelRatio) this.particleUniforms.uPixelRatio.value = pixelRatio;
        if (this.postProcessing) {
            this.postProcessing.setSize(window.innerWidth, window.innerHeight);
        }
    }

    updateDynamicResolution(delta) {
        const drs = this.dynamicResolution;
        if (!drs?.enabled || !this.renderer) return;
        const frameMs = delta * 1000;
        drs.emaMs = drs.emaMs * 0.9 + frameMs * 0.1;
        drs.elapsed += delta;
        if (drs.elapsed < drs.adjustInterval) return;
        drs.elapsed = 0;

        let newScale = drs.scale;
        if (drs.emaMs > drs.targetMs * 1.12) {
            newScale = Math.max(drs.minScale, drs.scale - 0.05);
        } else if (drs.emaMs < drs.targetMs * 0.85) {
            newScale = Math.min(drs.maxScale, drs.scale + 0.05);
        }

        if (Math.abs(newScale - drs.scale) >= 0.01) {
            drs.scale = newScale;
            this.applyDynamicResolution();
            this.applyLod();
        }
    }

    captureBaseline(label = 'synthwave') {
        if (!this.renderer?.domElement) {
            console.warn('[SynthwaveBaseline] No renderer canvas available.');
            return;
        }
        const canvas = this.renderer.domElement;
        const name = `${label}-${this.isWebGPU ? 'webgpu' : 'webgl'}-${Date.now()}.png`;
        if (canvas.toBlob) {
            canvas.toBlob((blob) => {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = name;
                link.click();
                URL.revokeObjectURL(url);
            });
        } else {
            const link = document.createElement('a');
            link.href = canvas.toDataURL('image/png');
            link.download = name;
            link.click();
        }
    }

    async initRenderer(container, ownerGeneration = this.lifecycleGeneration) {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const antialias = this.getAntialiasEnabled();
        const preserveDrawingBuffer = this.baselineEnabled === true;
        const ownsLifecycle = () => ownerGeneration === this.lifecycleGeneration
            && this.isActive
            && !this.cleanupComplete;

        this.renderer = null;
        this.isWebGPU = false;
        this.isWebGL = false;
        let renderer = null;

        if (this.enableWebGPU && !this.forceWebGL) {
            const webgpuRenderer = new THREE.WebGPURenderer({
                antialias,
                powerPreference: 'high-performance',
                alpha: false,
                forceWebGL: false,
                preserveDrawingBuffer,
            });
            let webgpuReady = false;
            try {
                await this.initializeRendererCandidate(webgpuRenderer, {
                    label: 'Synthwave Sunset WebGPU renderer init',
                    ownerGeneration,
                });
                webgpuReady = true;
            } catch (error) {
                if (!ownsLifecycle()) return null;
                console.warn('[Synthwave3D] WebGPU init failed, falling back to WebGL2:', error);
            }

            const isWebGPU = webgpuReady && webgpuRenderer.backend?.isWebGPUBackend === true;
            if (isWebGPU && this.webgpuMaterialsReady) {
                renderer = webgpuRenderer;
                this.isWebGPU = true;
            } else {
                webgpuRenderer.dispose();
            }
        }

        if (!renderer) {
            if (!ownsLifecycle()) return null;
            if (this.enableWebGPU && !this.webgpuMaterialsReady) {
                console.warn('[Synthwave3D] WebGPU requested but TSL materials are not ready. Using WebGL2 fallback.');
            }
            renderer = new WebGLRenderer({
                alpha: false,
                antialias,
                powerPreference: 'high-performance',
                preserveDrawingBuffer,
            });
            this.isWebGL = true;
        }

        if (!ownsLifecycle()) {
            this.disposeRenderer(renderer, { nullInstance: false });
            return null;
        }
        this.renderer = renderer;
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(this.getDynamicPixelRatio());
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);
        return renderer;
    }

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        console.log('[Synthwave3D] Initializing Three.js scene...');

        const container = document.getElementById('synthwave-sunset-theme');
        if (!container) {
            console.error('[Synthwave3D] Container not found');
            return;
        }

        const sceneToken = ++this._sceneToken;
        container.innerHTML = '';

        const debugFlags = this.getDebugFlags();
        this.forceWebGL = debugFlags.forceWebGL;
        this.baselineEnabled = debugFlags.baseline;
        this.enableWebGPU = debugFlags.enableWebGPU;
        this.noPost = debugFlags.noPost;
        if (this.dynamicResolution) {
            this.dynamicResolution.enabled = !debugFlags.noDrs && !this.baselineEnabled;
            this.dynamicResolution.scale = 1.0;
            this.dynamicResolution.emaMs = 16.6;
            this.dynamicResolution.elapsed = 0;
        }
        if (this.budgetMonitor) {
            this.budgetMonitor.enabled = debugFlags.budget === true;
            this.budgetMonitor.samples = [];
            this.budgetMonitor.lastLog = 0;
            this.budgetMonitor.lastWarn = 0;
            this.budgetMonitor.frameStart = 0;
            this.budgetMonitor.lastMark = 0;
            this.budgetMonitor.marks = [];
        }
        this.mrtAuditEnabled = debugFlags.mrtAudit;
        this.fixedDtSeconds = Number.isFinite(debugFlags.fixedDt) ? debugFlags.fixedDt / 1000 : null;
        this.fixedElapsed = 0;
        this.initRandom(debugFlags.seed);
        this.sunPhaseX = this.rand() * Math.PI * 2;
        this.timeOffset = this.rand() * 10000;
        this.smoothedTime = 0;
        this.lastElapsed = 0;
        this.gridUniforms = null;
        this.sunUniforms = null;
        this.sunGlowUniforms = [];
        this.starUniforms = null;
        this.highlightUniforms = [];
        this.particleUniforms = null;
        this.highlightData = [];
        this.buildingUniforms = [];
        this.shootingStarPool = [];
        this.hazeLayers = [];
        this.ambientMotes = null;
        this.ambientMotesUniforms = null;
        this.palms = [];
        this.palmUniforms = [];
        this.sunScreenUv.set(0.5, 0.5);
        this.horizonUv = 0.46;
        this.gridWaveOrigin.set(0, 0);
        this.gridWaveIntensity = 0;

        if (this.forceWebGL) {
            console.log('[Synthwave3D] Debug: forceWebGL enabled');
        }
        if (this.baselineEnabled) {
            console.log('[SynthwaveBaseline] Baseline capture enabled');
        }

        // Apply quality settings
        this.currentQuality = this.getGraphicsQuality();
        this.activePreset = this.qualityPresets[this.currentQuality] || this.qualityPresets.High;

        const renderer = await this.initRenderer(container, ownerGeneration);
        if (!renderer) return;
        if (!this.isActive
            || ownerGeneration !== this.lifecycleGeneration
            || this._sceneToken !== sceneToken) {
            if (this.renderer === renderer) {
                try {
                    this.disposeRenderer(renderer, { nullInstance: false });
                } catch (error) {
                    console.warn('[Synthwave3D] Renderer dispose failed during abort:', error);
                }
                if (container.contains(renderer.domElement)) {
                    container.removeChild(renderer.domElement);
                }
                this.renderer = null;
            }
            return;
        }
        if (this.dynamicResolution) {
            this.dynamicResolution.enabled = this.dynamicResolution.enabled && this.isWebGPU;
            this.dynamicResolution.scale = 1.0;
            this.dynamicResolution.emaMs = 16.6;
            this.dynamicResolution.elapsed = 0;
            this.applyDynamicResolution();
        }
        if (this.baselineEnabled && typeof window !== 'undefined') {
            window.synthwaveBaseline = {
                capture: (label) => this.captureBaseline(label),
                report: () => this.reportBaseline(),
                reset: () => this.resetBaseline(),
            };
            console.log('[SynthwaveBaseline] Helpers: window.synthwaveBaseline.capture(label), report(), reset()');
        }

        // Setup Three.js scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a0033);
        this.scene.fog = new THREE.FogExp2(0x330033, 0.015);

        // Setup camera
        this.camera = new THREE.PerspectiveCamera(
            70,
            window.innerWidth / window.innerHeight,
            0.1,
            1000,
        );
        this.camera.position.set(0, 8, 20);
        this.camera.lookAt(0, 2, -20);
        this.clock.start();

        // Create scene elements
        this.createSkyGradient();
        this.createStarField();
        this.createShootingStars();
        this.createSun();
        this.createHazeLayers();
        this.createBuildings();
        this.createPalmTrees();
        this.createGrid();
        this.createAmbientMotes();
        this.createHighlightPool();
        this.createParticleSystem();
        this.setupPostProcessing();
        this.applyLod();
        if (this.mrtAuditEnabled) {
            this.auditMrtMaterials('PostSetup');
        }

        // Setup events
        this.setupEventListeners();
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
        }
        this._resizeHandler = this.onResize.bind(this);
        window.addEventListener('resize', this._resizeHandler);

        // Start animation
        this.animate();

        console.log(`[Synthwave3D] Scene initialized with ${this.currentQuality} quality`);
    }

    createSkyGradient() {
        // Create a sphere that surrounds the entire scene (radius 4000)
        // BackSide so we see it from inside
        const geometry = new THREE.SphereGeometry(4000, 32, 32);

        // Use vertex colors for gradient
        const colors = new Float32Array(geometry.attributes.position.count * 3);
        const positions = geometry.attributes.position.array;

        for (let i = 0; i < geometry.attributes.position.count; i++) {
            const y = positions[i * 3 + 1];
            // Normalize y from -4000..4000 to 0..1
            // Use a slightly shifted range to keep the "sunset" colors more visible near horizon
            const t = (y + 1000) / 3000;
            const clampedT = Math.max(0, Math.min(1, t));

            let color;
            if (clampedT < 0.5) {
                color = this.colors.skyBottom.clone().lerp(this.colors.skyMid, clampedT / 0.5);
            } else {
                color = this.colors.skyMid.clone().lerp(this.colors.skyTop, (clampedT - 0.5) / 0.5);
            }

            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            side: THREE.BackSide, // Render inside of sphere
            depthWrite: false,
        });

        const sky = new THREE.Mesh(geometry, material);
        // Center at origin
        sky.position.set(0, 0, 0);
        this.scene.add(sky);

        // Also add a bottom fading plane to mask the "south pole" if needed,
        // but sphere usually covers it well.
    }

    createStarField() {
        const count = this.activePreset.starCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        const starColors = [
            new THREE.Color(0xffffff),
            new THREE.Color(0xaaddff),
            new THREE.Color(0xffddee),
        ];

        for (let i = 0; i < count; i++) {
            // Distribute in a full large sphere surrounding the scene
            // Radius much larger to cover all camera angles
            const radius = 300 + this.rand() * 200;
            const theta = this.rand() * Math.PI * 2; // Full horizontal rotation
            const phi = Math.acos(2 * this.rand() - 1); // Uniform sphere distribution

            // Only keep stars above a certain horizon (y > -50) to avoid wasting stars deep underground
            // But keep enough low ones to fill gaps near horizon
            // User requested "higher" stars, so we cut off earlier (0.45 * PI) to lift them off the "ground"
            if (phi > Math.PI * 0.45) {
                i--; // Retry
                continue;
            }

            positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = radius * Math.cos(phi);
            positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

            sizes[i] = this.rand() * 2.5 + 1.5; // Larger stars since they are far away
            phases[i] = this.rand() * Math.PI * 2;

            const color = starColors[Math.floor(this.rand() * starColors.length)];
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        let material = null;
        if (this.isWebGPU) {
            const { material: starMaterial, uniforms } = createStarNodeMaterial();
            material = starMaterial;
            this.starUniforms = uniforms;
            if (this.starUniforms?.uPixelRatio) {
                this.starUniforms.uPixelRatio.value = this.renderer.getPixelRatio();
            }
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    time: { value: 0 },
                },
                vertexShader: starVertexShader,
                fragmentShader: starFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            this.starUniforms = null;
        }

        this.starField = new THREE.Points(geometry, material);
        this.starField.userData.baseCount = count;
        this.starField.geometry.setDrawRange(0, count);
        this.scene.add(this.starField);
    }

    createShootingStars() {
        this.shootingStarPool = [];
        const maxStars = 6;

        for (let i = 0; i < maxStars; i++) {
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(6);
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

            const material = new THREE.LineBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0,
                blending: THREE.AdditiveBlending,
            });

            const star = new THREE.Line(geometry, material);
            star.visible = false;
            star.frustumCulled = false;
            star.userData = {
                active: false,
                life: 0,
                maxLife: 1,
                tail: 12,
                velocity: new THREE.Vector3(),
                position: new THREE.Vector3(),
                direction: new THREE.Vector3(1, -0.4, 0.6),
                tailVec: new THREE.Vector3(),
                tailPos: new THREE.Vector3(),
            };
            this.scene.add(star);
            this.shootingStarPool.push(star);
        }
    }

    createSun() {
        // Main sun sphere - Slightly smaller as requested
        const sunGeometry = new THREE.SphereGeometry(25, 64, 32);
        let sunMaterial = null;
        if (this.isWebGPU) {
            const { material, uniforms } = createSunNodeMaterial(this.colors);
            sunMaterial = material;
            this.sunUniforms = uniforms;
        } else {
            sunMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    time: { value: 0 },
                    colorTop: { value: this.colors.sunTop },
                    colorMid: { value: this.colors.sunMid },
                    colorBottom: { value: this.colors.sunBottom },
                    stripeCount: { value: 12.0 },
                    pulseIntensity: { value: 0 },
                },
                vertexShader: sunVertexShader,
                fragmentShader: sunFragmentShader,
                transparent: true,
                side: THREE.FrontSide,
            });
            this.sunUniforms = null;
        }

        this.sun = new THREE.Mesh(sunGeometry, sunMaterial);
        this.sun.position.set(0, 35, -100);
        this.scene.add(this.sun);

        // Glow layers
        const glowCount = this.activePreset.glowLayers;
        const glowColors = [
            new THREE.Color(0xff8800),
            new THREE.Color(0xff4400),
            new THREE.Color(0xff0066),
            new THREE.Color(0xaa0088),
            new THREE.Color(0x6600aa),
            new THREE.Color(0x330066),
        ];

        for (let i = 0; i < glowCount; i++) {
            const scale = 1.5 + i * 0.8;
            // Larger glow planes to match bigger sun
            const glowGeometry = new THREE.PlaneGeometry(60 * scale, 60 * scale);
            let glowMaterial = null;
            if (this.isWebGPU) {
                const { material, uniforms } = createSunGlowNodeMaterial(
                    glowColors[i % glowColors.length],
                    0.4 - i * 0.05,
                );
                glowMaterial = material;
                this.sunGlowUniforms[i] = uniforms;
            } else {
                glowMaterial = new THREE.ShaderMaterial({
                    uniforms: {
                        glowColor: { value: glowColors[i % glowColors.length] },
                        opacity: { value: 0.4 - i * 0.05 },
                        pulseIntensity: { value: 0 },
                    },
                    vertexShader: sunGlowVertexShader,
                    fragmentShader: sunGlowFragmentShader,
                    transparent: true,
                    depthWrite: false,
                    blending: THREE.AdditiveBlending,
                    side: THREE.DoubleSide,
                });
            }

            const glow = new THREE.Mesh(glowGeometry, glowMaterial);
            glow.position.copy(this.sun.position);
            glow.position.z += 1 + i * 0.5;
            if (this.isWebGPU && this.sunGlowUniforms[i]) {
                glow.userData.uniforms = this.sunGlowUniforms[i];
            }
            this.scene.add(glow);
            this.sunGlowLayers.push(glow);
        }
    }

    createBuildings() {
        const count = this.activePreset.buildingCount;
        this.buildings = [];
        this.buildingEdges = [];
        this.buildingMaterials = [];

        // Two layers of buildings
        const layers = [
            {
                y: 0, zStart: -80, zEnd: -50, scaleY: 1.0, color: 0x0a0515,
            },
            {
                y: 0, zStart: -60, zEnd: -35, scaleY: 0.7, color: 0x08040f,
            },
        ];

        let edgeMaterial = null;
        let edgeUniforms = null;
        if (this.isWebGPU) {
            const edgeMatData = createBuildingEdgeNodeMaterial(new THREE.Color(0xff0066));
            edgeMaterial = edgeMatData.material;
            edgeUniforms = edgeMatData.uniforms;
            this.buildingEdgeUniforms = edgeUniforms;
            this.buildingEdgeMaterial = edgeMaterial;
        } else {
            edgeMaterial = new THREE.LineBasicMaterial({
                color: 0xff0066,
                transparent: true,
                opacity: 0,
                blending: THREE.AdditiveBlending,
            });
            this.buildingEdgeUniforms = null;
            this.buildingEdgeMaterial = edgeMaterial;
        }

        layers.forEach((layer, layerIndex) => {
            const buildingsPerLayer = Math.floor(count / 2);
            let buildingMaterial = null;
            if (this.isWebGPU) {
                // Far layer reads slightly dimmer + less rim than the near layer
                const farLayer = layerIndex === 0;
                const { material, uniforms } = createBuildingNodeMaterial(new THREE.Color(layer.color), {
                    windowEmissive: this.activePreset.windowEmissive * (farLayer ? 0.85 : 1.0),
                    rimIntensity: this.activePreset.rimIntensity * (farLayer ? 0.8 : 1.0),
                    flickerEnabled: this.activePreset.windowFlicker,
                    windowDensity: 0.35,
                    colorVariety: this.activePreset.colorVariety,
                    distanceBoost: farLayer ? 0.7 : 1.0,
                });
                buildingMaterial = material;
                this.buildingMaterials.push(material);
                this.buildingUniforms.push(uniforms);
            } else {
                buildingMaterial = new THREE.MeshBasicMaterial({
                    color: layer.color,
                });
            }

            const geometries = [];
            const spreadX = 250;

            for (let i = 0; i < buildingsPerLayer; i++) {
                const width = 2 + this.rand() * 6;
                const height = (5 + this.rand() * 25) * layer.scaleY;
                const depth = 3 + this.rand() * 8;

                const geometry = new THREE.BoxGeometry(width, height, depth);

                // Position across the horizon - full screen width
                const posX = (i / buildingsPerLayer) * spreadX - spreadX / 2 + (this.rand() - 0.5) * 5;
                const posY = height / 2 + layer.y;
                const posZ = layer.zStart + this.rand() * (layer.zEnd - layer.zStart);
                geometry.translate(posX, posY, posZ);

                geometries.push(geometry);
            }

            if (!geometries.length) return;

            const mergedGeometry = mergeGeometries(geometries, false);
            geometries.forEach((geometry) => geometry.dispose());
            if (!mergedGeometry) return;

            const building = new THREE.Mesh(mergedGeometry, buildingMaterial);
            this.scene.add(building);
            this.buildings.push(building);

            const edges = new THREE.EdgesGeometry(mergedGeometry);
            const edgeLines = new THREE.LineSegments(edges, edgeMaterial);
            this.scene.add(edgeLines);
            this.buildingEdges.push(edgeLines);
        });
    }

    createHazeLayers() {
        this.hazeLayers = [];
        const layerCount = this.activePreset.hazeLayers ?? 0;
        if (!this.isWebGPU || layerCount <= 0) return;

        // Bottom-fade gradient quads sitting behind the buildings to give depth.
        // Wider/taller for far layer, narrower/taller near the horizon.
        const layerSpecs = [
            {
                width: 360, height: 95, y: 28, z: -92, color: new THREE.Color(0xff2266), opacity: 0.16,
            },
            {
                width: 250, height: 50, y: 16, z: -65, color: new THREE.Color(0xff7a18), opacity: 0.22,
            },
            {
                width: 180, height: 28, y: 10, z: -38, color: new THREE.Color(0xff5599), opacity: 0.12,
            },
        ].slice(0, layerCount);

        layerSpecs.forEach((spec) => {
            const geometry = new THREE.PlaneGeometry(spec.width, spec.height, 1, 1);
            const { material } = createHazeNodeMaterial(spec.color, spec.opacity);
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(0, spec.y, spec.z);
            mesh.renderOrder = -1;
            this.scene.add(mesh);
            this.hazeLayers.push(mesh);
        });
    }

    createAmbientMotes() {
        this.ambientMotes = null;
        this.ambientMotesUniforms = null;
        const moteCount = this.activePreset.ambientMotes ?? 0;
        if (!this.isWebGPU || moteCount <= 0) return;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(moteCount * 3);
        const sizes = new Float32Array(moteCount);
        const phases = new Float32Array(moteCount);
        const speeds = new Float32Array(moteCount);
        const driftRanges = new Float32Array(moteCount);
        const colors = new Float32Array(moteCount * 3);

        const palette = [
            new THREE.Color(0xffd9b5),
            new THREE.Color(0xffb5d9),
            new THREE.Color(0xffffff),
            new THREE.Color(0xff8c66),
        ];

        for (let i = 0; i < moteCount; i++) {
            // Spread across the mid-distance air pocket between camera and sun
            positions[i * 3] = (this.rand() - 0.5) * 160;
            positions[i * 3 + 1] = 4 + this.rand() * 22;
            positions[i * 3 + 2] = -15 - this.rand() * 70;
            sizes[i] = 0.9 + this.rand() * 1.6;
            phases[i] = this.rand() * Math.PI * 2;
            speeds[i] = 0.08 + this.rand() * 0.18;
            driftRanges[i] = 1.2 + this.rand() * 2.5;
            const color = palette[Math.floor(this.rand() * palette.length)];
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
        geometry.setAttribute('aDriftRange', new THREE.BufferAttribute(driftRanges, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        const { material, uniforms } = createMoteNodeMaterial();
        this.ambientMotesUniforms = uniforms;
        if (uniforms?.uPixelRatio) {
            uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
        }

        this.ambientMotes = new THREE.Points(geometry, material);
        this.ambientMotes.frustumCulled = false;
        this.scene.add(this.ambientMotes);
    }

    createPalmTrees() {
        this.palms = [];
        this.palmUniforms = [];
        const palmCount = this.activePreset.palms ?? 0;
        if (!this.isWebGPU || palmCount <= 0) return;

        // Camera (0, 8, 20), 70° FOV, ~16:9 → horizontal half-FOV ~51°. The visible
        // half-width at world-z is (20 − z) * tan(51°) ≈ (20 − z) * 1.235. Palms sit
        // at 90–95% of edge so trunks frame the very sides of the shot and fronds
        // spill slightly off-screen for that iconic "driving past palms" look.
        const placements = [
            {
                x: -22, z: 2, scale: 1.05, rotation: 0.15,
            }, // close-left
            {
                x: 24, z: 0, scale: 1.05, rotation: -0.2,
            }, // close-right
            {
                x: -29, z: -7, scale: 1.0, rotation: -0.1,
            }, // mid-left
            {
                x: 31, z: -9, scale: 0.95, rotation: 0.25,
            }, // mid-right
            {
                x: -37, z: -18, scale: 0.9, rotation: 0.05,
            }, // far-left
            {
                x: 40, z: -20, scale: 0.85, rotation: -0.15,
            }, // far-right
        ].slice(0, palmCount);

        const { material: palmMaterial, uniforms: palmMatUniforms } = createPalmNodeMaterial(
            new THREE.Color(0xff66cc),
        );
        if (palmMatUniforms?.uRimIntensity) {
            palmMatUniforms.uRimIntensity.value = 3.0;
        }
        this.palmUniforms.push(palmMatUniforms);

        placements.forEach((spec) => {
            const group = new THREE.Group();
            group.position.set(spec.x, 0, spec.z);
            group.rotation.y = spec.rotation;
            group.scale.setScalar(spec.scale);

            // Trunk — slight curve via TubeGeometry path
            const curve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0.4, 3, 0),
                new THREE.Vector3(-0.2, 6, 0),
                new THREE.Vector3(0.3, 9, 0),
            ]);
            const trunkGeo = new THREE.TubeGeometry(curve, 16, 0.22, 8, false);
            const trunk = new THREE.Mesh(trunkGeo, palmMaterial);
            group.add(trunk);

            // Fronds — radial planes from the crown
            const frondCount = 8;
            for (let i = 0; i < frondCount; i++) {
                const frondGeo = new THREE.PlaneGeometry(5.5, 1.2, 6, 1);
                // Curve the frond by displacing y-coords down at the tips
                const pos = frondGeo.attributes.position;
                for (let v = 0; v < pos.count; v++) {
                    const x = pos.getX(v);
                    const drop = Math.pow(Math.abs(x) / 2.75, 1.8) * 1.6;
                    pos.setY(v, pos.getY(v) - drop);
                }
                pos.needsUpdate = true;
                frondGeo.computeVertexNormals();

                const frond = new THREE.Mesh(frondGeo, palmMaterial);
                const angle = (i / frondCount) * Math.PI * 2;
                frond.position.set(0, 9, 0);
                frond.rotation.y = angle;
                // Tilt fronds downward
                frond.rotation.z = -0.25;
                group.add(frond);
            }

            this.scene.add(group);
            this.palms.push(group);
        });
    }

    createGrid() {
        // Grid plane - reduced depth to prevent sky grid artifact
        const geometry = new THREE.PlaneGeometry(400, 120, 100, 30);
        geometry.rotateX(-Math.PI / 2);

        let material = null;
        if (this.isWebGPU) {
            const { material: gridMaterial, uniforms } = createGridNodeMaterial(this.colors);
            material = gridMaterial;
            this.gridUniforms = uniforms;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    time: { value: 0 },
                    speed: { value: -5.0 }, // Negative speed moves grid TOWARDS camera (driving forward)
                    gridColor: { value: this.colors.gridPink.clone() },
                    glowIntensity: { value: 1.0 },
                    pulseIntensity: { value: 0 },
                    sunX: { value: 0.0 },
                    waveOrigin: { value: this.gridWaveOrigin.clone() },
                    waveIntensity: { value: this.gridWaveIntensity },
                    waveFrequency: { value: this.gridWaveFrequency },
                    waveSpeed: { value: this.gridWaveSpeed },
                    waveFalloff: { value: this.gridWaveFalloff },
                    resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
                },
                vertexShader: gridVertexShader,
                fragmentShader: gridFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.FrontSide,
            });
            this.gridUniforms = null;
        }

        this.grid = new THREE.Mesh(geometry, material);
        this.grid.position.y = 0;
        this.grid.position.z = -20;
        this.scene.add(this.grid);
    }

    createHighlightPool() {
        const poolSize = this.activePreset.maxHighlights;
        this.highlightPool = [];
        this.gridHighlights = [];

        // Match the grid cell size (gridSpacing = 1.5)
        // Increased to 1.55 for better fit/overlap (retro solid look)
        const geometry = new THREE.PlaneGeometry(1.55, 1.55);
        geometry.rotateX(-Math.PI / 2);

        if (this.isWebGPU) {
            if (this.highlightCompute) {
                this.highlightCompute.dispose();
            }
            this.highlightCompute = new SynthwaveHighlightCompute(poolSize);
            this.highlightCompute.createComputeNode();
            this.highlightData = [];
            const { material: highlightMaterial, uniforms } = createHighlightNodeMaterial({
                isWebGPU: true,
                highlightCompute: this.highlightCompute,
            });
            this.highlightUniforms = uniforms;
            this.highlightInstanced = new THREE.InstancedMesh(geometry, highlightMaterial, poolSize);
            this.highlightInstanced.frustumCulled = false;
            const identity = new THREE.Matrix4();
            for (let i = 0; i < poolSize; i++) {
                this.highlightInstanced.setMatrixAt(i, identity);
                this.highlightData.push({
                    active: false,
                    x: 0,
                    y: 0,
                    z: 0,
                    intensity: 0,
                    phase: 0,
                    color: new THREE.Color(0x00ffff),
                });
            }
            this.highlightInstanced.instanceMatrix.needsUpdate = true;
            this.scene.add(this.highlightInstanced);
            return;
        }

        if (this.highlightCompute) {
            this.highlightCompute.dispose();
            this.highlightCompute = null;
        }
        this.highlightInstanced = null;
        this.highlightData = [];
        this.highlightData = [];

        for (let i = 0; i < poolSize; i++) {
            let material = null;
            material = new THREE.ShaderMaterial({
                uniforms: {
                    color: { value: new THREE.Color(0x00ffff) },
                    intensity: { value: 0 },
                    time: { value: 0 },
                },
                vertexShader: highlightVertexShader,
                fragmentShader: highlightFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.visible = false;
            mesh.userData = {
                active: false,
                life: 0,
                maxLife: 4.0,
                intensity: 0,
                decay: 0.01,
            };

            this.scene.add(mesh);
            this.highlightPool.push(mesh);
        }
    }

    createParticleSystem() {
        const count = this.activePreset.particleBudget;
        this.particleData = [];
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const lives = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aLife', new THREE.BufferAttribute(lives, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        if (this.isWebGPU) {
            if (this.particleCompute) {
                this.particleCompute.dispose();
            }
            this.particleCompute = new SynthwaveParticleCompute(count);
            this.particleCompute.createComputeNode();
        } else if (this.particleCompute) {
            this.particleCompute.dispose();
            this.particleCompute = null;
        }

        let material = null;
        if (this.isWebGPU) {
            const { material: particleMaterial, uniforms } = createParticleNodeMaterial({
                isWebGPU: true,
                particleCompute: this.particleCompute,
            });
            material = particleMaterial;
            this.particleUniforms = uniforms;
            if (this.particleUniforms?.uPixelRatio) {
                this.particleUniforms.uPixelRatio.value = this.renderer.getPixelRatio();
            }
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {},
                vertexShader: particleVertexShader,
                fragmentShader: particleFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            this.particleUniforms = null;
        }

        this.particles = new THREE.Points(geometry, material);
        this.scene.add(this.particles);

        // Initialize particle data
        for (let i = 0; i < count; i++) {
            this.particleData.push({
                index: i,
                active: false,
                x: 0,
                y: 0,
                z: 0,
                vx: 0,
                vy: 0,
                vz: 0,
                life: 0,
                maxLife: 1,
                size: 1,
                color: new THREE.Color(0xffffff),
            });
        }
    }

    setupPostProcessing() {
        if (this.postProcessing) {
            this.postProcessing.dispose();
            this.postProcessing = null;
        }

        if (!this.isWebGPU || this.noPost) {
            return;
        }

        this.postProcessing = new SynthwaveSunsetPost(this.renderer, this.scene, this.camera, {
            bloomStrength: 0.85,
            bloomRadius: 0.65,
            bloomThreshold: 0.22,
            bloomDownsample: 0.85,
            vignetteOffset: 1.0,
            vignetteDarkness: 0.4,
            gradeStrength: 0.18,
            scanlineIntensity: 0.08,
            godRaysIntensity: 0.22,
            // NOTE: post-pass wet reflection is disabled — y-axis mismatch between
            // viewportUV and the horizon line causes the reflection to render above
            // the horizon (wavy red streaks across the upper sky). The grid material
            // already has its own sun-streak reflection baked in.
            reflectionIntensity: 0.0,
            reflectionDistort: 0.0,
            reflectionSpeed: 0.0,
            chromaticAberration: this.activePreset.chromaticAberration ?? 0.0,
            filmGrain: this.activePreset.filmGrain ?? 0.0,
            horizon: this.horizonUv,
            sunScreen: this.sunScreenUv,
        });
        this.postProcessing.setSize(window.innerWidth, window.innerHeight);
    }

    // =========================================================================
    // EVENT HANDLERS
    // =========================================================================

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handleLineClear(data);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handleCombo(data);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handlePieceLock(data);
            }
        });

        // Pointer tracking for parallax camera
        const onPointerMove = (e) => {
            if (!this.isActive) return;
            this.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
            this.pointerY = (e.clientY / window.innerHeight) * 2 - 1;
        };
        window.addEventListener('pointermove', onPointerMove);
        const pointerUnsub = () => window.removeEventListener('pointermove', onPointerMove);

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub, pointerUnsub);
    }

    handlePieceLock(data) {
        const currentTime = Number.isFinite(this.lastElapsed)
            ? this.lastElapsed
            : this.clock.getElapsedTime();
        // Grid shader speed is 5.0 world units/sec. Grid cell spacing is 1.5.
        // Highlight logic multiplies relative grid index by 1.5.
        // So internal scroll speed must be 5.0 / 1.5 to result in 5.0 world speed.
        const scrollSpeed = 5.0 / 1.5;
        const scrollOffset = currentTime * scrollSpeed;

        // Get the actual piece that was locked
        const piece = data?.piece;
        if (!piece) return;

        // Get the color for this piece type from the theme colors
        const pieceType = piece.type; // 'I', 'O', 'T', 'S', 'Z', 'J', 'L'
        const color = this.getPieceColor(pieceType);

        // Position on grid based on piece position on board
        // Board width is typically 10 units (0-9). Center is ~4.5.
        // Map 0-9 to -30 to +30 on grid (scale factor ~6-8)
        let gridX;
        if (piece.x !== undefined) {
            // Center 0 is at piece.x = 4.5
            // Scale by 6 to cover a good portion of the width without being too extreme
            // Center 0 is at piece.x = 4.5
            // Scale by 6 to cover a good portion of the width without being too extreme
            // ROUND to nearest integer to snap to grid lines
            gridX = Math.round((piece.x - 4.5) * 6);
            // Removed random scatter for perfect alignment
        } else {
            // Fallback to random if no position data
            gridX = Math.floor(this.rand() * 80 - 40);
        }

        const gridZ = Math.floor(scrollOffset + 3 + this.rand() * 12);

        // Get the shape for this piece type
        const shape = this.getShapeForType(pieceType);
        // Use actual rotation from the piece if available, otherwise random
        const rotation = piece.rotation !== undefined ? piece.rotation : Math.floor(this.rand() * 4);

        let sumX = 0;
        let sumY = 0;
        let blockCount = 0;

        // Spawn each cell of the actual tetromino shape
        for (const block of shape) {
            let rx = block.x;
            let ry = block.y;

            // Apply rotation
            for (let r = 0; r < rotation; r++) {
                const temp = rx;
                rx = -ry;
                ry = temp;
            }

            this.spawnHighlightCell(gridX + rx, gridZ + ry, color, scrollOffset);
            sumX += rx;
            sumY += ry;
            blockCount += 1;
        }

        if (this.enableGridWaves && blockCount > 0 && this.grid) {
            const centerX = gridX + sumX / blockCount;
            const centerZ = gridZ + sumY / blockCount;
            const worldX = centerX * 1.5 + 0.75;
            const worldZ = -(centerZ - scrollOffset) * 1.5 + this.grid.position.z - 0.75;
            this.gridWaveOrigin.set(
                worldX - this.grid.position.x,
                worldZ - this.grid.position.z,
            );
            this.gridWaveIntensity = Math.min(1.5, this.gridWaveIntensity + 0.9);
        }

        // Grid pulse
        this.gridPulseIntensity = Math.min(1, this.gridPulseIntensity + 0.25);

        // Trigger highlight glitch effect - stronger
        this.highlightTwinkleIntensity = 1.6;
    }

    getPieceColor(pieceType) {
        // Use the theme's tetromino colors from synthwave-sunset-tetrominos.js
        const colorMap = {
            I: new THREE.Color(0xff0066), // Hot Pink
            O: new THREE.Color(0xff4500), // Orange-Red
            T: new THREE.Color(0xb000ff), // Violet Purple
            S: new THREE.Color(0xff006e), // Deep Pink
            Z: new THREE.Color(0xff5e78), // Coral
            J: new THREE.Color(0x00d4ff), // Electric Blue
            L: new THREE.Color(0xffff00), // Neon Yellow
        };
        return colorMap[pieceType] || this.neonColors[0];
    }

    getShapeForType(pieceType) {
        const shapes = {
            I: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
            J: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
            L: [{ x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
            O: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
            S: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
            T: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
            Z: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
        };
        return shapes[pieceType] || shapes.T;
    }

    getInactiveParticleIndex() {
        for (let i = 0; i < this.particleData.length; i++) {
            if (!this.particleData[i].active) return i;
        }
        return -1;
    }

    getInactiveHighlightIndex() {
        for (let i = 0; i < this.highlightData.length; i++) {
            if (!this.highlightData[i].active) return i;
        }
        return -1;
    }

    spawnHighlightCell(gridX, gridZ, color, scrollOffset) {
        if (this.isWebGPU && this.highlightCompute) {
            const index = this.getInactiveHighlightIndex();
            if (index === -1) return;

            const highlight = this.highlightData[index];
            highlight.active = true;
            highlight.intensity = 2.5 + this.rand() * 0.5;
            highlight.color = color.clone();
            highlight.phase = gridZ * 0.5 + highlight.intensity * 2.0;

            const worldX = gridX * 1.5 + 0.75;
            const worldY = 0.05;
            const worldZ = -(gridZ - scrollOffset) * 1.5 + this.grid.position.z - 0.75;
            highlight.x = worldX;
            highlight.y = worldY;
            highlight.z = worldZ;

            this.highlightCompute.spawn(index, {
                x: worldX,
                y: worldY,
                z: worldZ,
                intensity: highlight.intensity,
                color: highlight.color,
                phase: highlight.phase,
            });

            return;
        }

        // Find inactive highlight from pool
        const highlight = this.highlightPool.find((h) => !h.userData.active);
        if (!highlight) return;

        highlight.userData.active = true;
        highlight.userData.life = 1.0;
        highlight.userData.maxLife = 15.0 + this.rand() * 10.0; // Stay very long (15-25 seconds)
        highlight.userData.intensity = 2.5 + this.rand() * 0.5;
        highlight.userData.decay = 0.001 + this.rand() * 0.001; // Very slow decay
        highlight.userData.gridZ = gridZ;
        highlight.userData.scrollOffset = scrollOffset;

        // Position in world space - scale by gridSpacing (1.5) and offset to center in cell
        highlight.position.x = gridX * 1.5 + 0.75;
        highlight.position.y = 0.05;
        // Reverted to -0.75 (mathematical center) as X-jitter was likely the issue
        highlight.position.z = -(gridZ - scrollOffset) * 1.5 + this.grid.position.z - 0.75;

        // Set color
        const highlightUniforms = highlight.userData.uniforms || highlight.material.uniforms;
        if (highlightUniforms?.uColor) {
            highlightUniforms.uColor.value.copy(color);
        } else if (highlightUniforms?.color) {
            highlightUniforms.color.value.copy(color);
        }
        if (highlightUniforms?.uIntensity) {
            highlightUniforms.uIntensity.value = highlight.userData.intensity;
        } else if (highlightUniforms?.intensity) {
            highlightUniforms.intensity.value = highlight.userData.intensity;
        }

        highlight.visible = true;
        this.gridHighlights.push(highlight);
    }

    handleLineClear(data) {
        const { lineCount } = data;

        this.gridPulseIntensity = Math.min(1, this.gridPulseIntensity + 0.3 * lineCount);
        this.cityGlowIntensity = Math.min(1, this.cityGlowIntensity + 0.3 * lineCount);

        // Spawn horizon burst particles
        this.createHorizonBurst(lineCount);
    }

    handleCombo(data) {
        const { comboCount } = data;

        this.sunPulseIntensity = Math.min(1, this.sunPulseIntensity + 0.3);
        this.cityGlowIntensity = Math.min(1, this.cityGlowIntensity + 0.4);
        this.comboColorShift = Math.min(1, comboCount * 0.15);

        // Make all highlights twinkle during combo
        this.highlightTwinkleIntensity = Math.min(1.5, 0.5 + comboCount * 0.2);

        // Spawn sun corona burst
        if (comboCount >= 2) {
            this.createSunBurst(comboCount);
        }

        if (comboCount >= 3 && this.shootingStarPool.length) {
            const chance = Math.min(0.7, 0.25 + comboCount * 0.1);
            if (this.rand() < chance) {
                this.spawnShootingStar();
            }
        }
    }

    spawnShootingStar() {
        const star = this.shootingStarPool.find((entry) => !entry.userData.active);
        if (!star) return;

        const startX = (this.rand() - 0.5) * 320;
        const startY = 60 + this.rand() * 60;
        const startZ = -180 - this.rand() * 120;

        const dir = new THREE.Vector3(
            -0.4 - this.rand() * 0.4,
            -0.2 - this.rand() * 0.3,
            0.6 + this.rand() * 0.4,
        ).normalize();

        const speed = 60 + this.rand() * 40;
        star.userData.velocity.copy(dir).multiplyScalar(speed);
        star.userData.direction.copy(dir);
        star.userData.position.set(startX, startY, startZ);
        star.userData.tail = 12 + this.rand() * 18;
        star.userData.life = 1;
        star.userData.maxLife = 0.8 + this.rand() * 0.6;
        star.userData.active = true;

        const hue = 0.55 + this.rand() * 0.15;
        star.material.color.setHSL(hue, 0.8, 0.7);
        star.material.opacity = 1;
        star.visible = true;
    }

    createHorizonBurst(lineCount) {
        const baseCount = 20 * lineCount;
        const colors = [
            new THREE.Color(0xff0066),
            new THREE.Color(0xff4500),
            new THREE.Color(0xff006e),
            new THREE.Color(0xb000ff),
        ];

        for (let i = 0; i < baseCount; i++) {
            const index = this.getInactiveParticleIndex();
            if (index === -1) break;
            const particle = this.particleData[index];

            particle.active = true;
            particle.x = (this.rand() - 0.5) * 60;
            particle.y = 5 + this.rand() * 3;
            particle.z = -45 + this.rand() * 5;
            particle.vx = (this.rand() - 0.5) * 3;
            particle.vy = 3 + this.rand() * 4;
            particle.vz = (this.rand() - 0.5) * 2;
            particle.life = 1.0;
            particle.maxLife = 1.5 + this.rand() * 0.5;
            particle.size = 2 + this.rand() * 3;
            particle.color = colors[Math.floor(this.rand() * colors.length)];

            if (this.isWebGPU && this.particleCompute) {
                this.particleCompute.spawn(index, particle);
            }
        }
    }

    createSunBurst(comboCount) {
        const count = 30 * comboCount;
        const colors = [
            new THREE.Color(0xff4500),
            new THREE.Color(0xff8c00),
            new THREE.Color(0xffd700),
            new THREE.Color(0xff0000),
        ];

        for (let i = 0; i < count; i++) {
            const index = this.getInactiveParticleIndex();
            if (index === -1) break;
            const particle = this.particleData[index];

            const angle = this.rand() * Math.PI;
            const speed = 2 + this.rand() * 3;

            particle.active = true;
            particle.x = this.sun.position.x + Math.cos(angle) * 12;
            particle.y = this.sun.position.y + Math.sin(angle) * 12;
            particle.z = this.sun.position.z + 5;
            particle.vx = Math.cos(angle) * speed;
            particle.vy = Math.sin(angle) * speed;
            particle.vz = (this.rand() - 0.5) * 2;
            particle.life = 1.0;
            particle.maxLife = 1.0 + this.rand() * 0.8;
            particle.size = 3 + this.rand() * 4;
            particle.color = colors[Math.floor(this.rand() * colors.length)];

            if (this.isWebGPU && this.particleCompute) {
                this.particleCompute.spawn(index, particle);
            }
        }
    }

    // =========================================================================
    // ANIMATION
    // =========================================================================

    animate() {
        if (!this.isActive) return;

        const animId = requestAnimationFrame(() => this.animate());
        this.registerAnimation(animId);

        this.beginBudgetFrame();

        const rawDelta = this.fixedDtSeconds !== null ? this.fixedDtSeconds : this.clock.getDelta();
        const delta = this.fixedDtSeconds !== null ? rawDelta : Math.min(rawDelta, 0.05);
        if (this.fixedDtSeconds !== null) {
            this.fixedElapsed += this.fixedDtSeconds;
        }
        this.smoothedTime += delta;
        const elapsed = this.fixedDtSeconds !== null ? this.fixedElapsed : this.smoothedTime;
        this.lastElapsed = elapsed;
        if (this.baselineEnabled) {
            this.trackBaseline(rawDelta);
        }
        this.updateDynamicResolution(rawDelta);

        if (this.isWebGPU && this.particleCompute?.computeNode) {
            this.particleCompute.update(delta);
            this.renderer.compute(this.particleCompute.computeNode);
        }
        if (this.isWebGPU && this.highlightCompute?.computeNode) {
            this.highlightCompute.update(delta);
            this.renderer.compute(this.highlightCompute.computeNode);
        }
        this.markBudget('compute');

        this.updateCamera(elapsed, delta);
        this.updateSun(elapsed, delta);
        this.updateScreenSpaceTargets();
        this.updateGrid(elapsed, delta);
        this.updateHighlights(elapsed, delta);
        this.updateParticles(delta);
        this.updateBuildings(elapsed, delta);
        this.updateStars(elapsed);
        this.updateShootingStars(delta);
        this.updateAmbience(elapsed);
        this.markBudget('update');

        if (this.postProcessing) {
            const godRaysIntensity = 0.22 + this.sunPulseIntensity * 0.35;
            this.postProcessing.update(elapsed, {
                godRaysIntensity,
                sunScreen: this.sunScreenUv,
                reflectionIntensity: 0.0,
                horizon: this.horizonUv,
            });
            this.postProcessing.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
        this.markBudget('render');
        this.endBudgetFrame();
    }

    updateCamera(time, delta = 0) {
        // Gentle orbital sway
        const t = time * 0.03;

        // Smooth pointer tracking for subtle mouse parallax
        this.smoothedPointerX = THREE.MathUtils.lerp(this.smoothedPointerX, this.pointerX, delta * 2.2);
        this.smoothedPointerY = THREE.MathUtils.lerp(this.smoothedPointerY, this.pointerY, delta * 2.2);
        const parallaxX = this.smoothedPointerX * 4.0;
        const parallaxY = -this.smoothedPointerY * 2.0;

        this.camera.position.x = Math.sin(t) * 4 + parallaxX;
        this.camera.position.y = 8 + Math.cos(t * 0.7) * 2 + parallaxY;
        this.camera.position.z = 20 + Math.sin(t * 0.5) * 2;

        this.camera.lookAt(
            Math.sin(t * 0.4) * 2 + parallaxX * 0.4,
            3 + Math.cos(t * 0.3) + parallaxY * 0.4,
            -20,
        );
    }

    updateScreenSpaceTargets() {
        if (!this.camera || !this.sun) return;

        this.sun.getWorldPosition(this._sunWorld);
        this.sunNdc.copy(this._sunWorld).project(this.camera);
        this.sunScreenUv.set(
            this.sunNdc.x * 0.5 + 0.5,
            this.sunNdc.y * 0.5 + 0.5,
        );

        this._horizonNdc.copy(this._horizonWorld).project(this.camera);
        const horizon = this._horizonNdc.y * 0.5 + 0.5;
        this.horizonUv = THREE.MathUtils.clamp(horizon + this.horizonOffset, 0.35, 0.85);
    }

    updateSun(time, delta) {
        // Sun drift (left to right)
        // Much wider range so it starts OFF SCREEN left and ends OFF SCREEN right
        const driftTime = time + this.timeOffset;
        const driftProgress = (driftTime * 0.002) % 1; // Even slower progress (0.002 scale)
        // Range -350 to 350 covers full width at z=-100 and more
        const sunX = (driftProgress * 2 - 1) * 350;

        this.sun.position.x = sunX;

        // Update glow layers
        this.sunGlowLayers.forEach((glow, i) => {
            glow.position.x = sunX;
            const glowUniforms = glow.userData.uniforms || glow.material.uniforms;
            if (glowUniforms?.uPulseIntensity) {
                glowUniforms.uPulseIntensity.value = this.sunPulseIntensity;
            } else if (glowUniforms?.pulseIntensity) {
                glowUniforms.pulseIntensity.value = this.sunPulseIntensity;
            }

            // Subtle scale pulse
            const scale = 1 + Math.sin(time * 0.5 + i * 0.5) * 0.05;
            glow.scale.setScalar(scale + this.sunPulseIntensity * 0.2);
        });

        // Update sun shader
        const sunUniforms = this.sunUniforms || this.sun.material.uniforms;
        if (sunUniforms?.uTime) {
            sunUniforms.uTime.value = time;
        } else if (sunUniforms?.time) {
            sunUniforms.time.value = time;
        }
        if (sunUniforms?.uPulseIntensity) {
            sunUniforms.uPulseIntensity.value = this.sunPulseIntensity;
        } else if (sunUniforms?.pulseIntensity) {
            sunUniforms.pulseIntensity.value = this.sunPulseIntensity;
        }

        // Decay pulse
        if (this.sunPulseIntensity > 0) {
            this.sunPulseIntensity *= 0.97;
            if (this.sunPulseIntensity < 0.01) this.sunPulseIntensity = 0;
        }
    }

    updateGrid(time, delta) {
        // Update shader uniforms
        const gridUniforms = this.gridUniforms || this.grid.material.uniforms;
        if (gridUniforms?.uTime) {
            gridUniforms.uTime.value = time;
        } else if (gridUniforms?.time) {
            gridUniforms.time.value = time;
        }
        if (gridUniforms?.uPulseIntensity) {
            gridUniforms.uPulseIntensity.value = this.gridPulseIntensity;
        } else if (gridUniforms?.pulseIntensity) {
            gridUniforms.pulseIntensity.value = this.gridPulseIntensity;
        }

        // Color shift on combos
        const baseColor = this.colors.gridPink.clone();
        if (this.comboColorShift > 0) {
            baseColor.lerp(this.colors.gridCyan, this.comboColorShift);
        }
        if (gridUniforms?.uGridColor) {
            gridUniforms.uGridColor.value.copy(baseColor);
        } else if (gridUniforms?.gridColor) {
            gridUniforms.gridColor.value.copy(baseColor);
        }
        if (gridUniforms?.sunX) {
            gridUniforms.sunX.value = this.sun?.position?.x ?? 0;
        }
        if (gridUniforms?.uBloomScale) {
            gridUniforms.uBloomScale.value = 0.55 + this.gridPulseIntensity * 0.15;
        }

        const waveEnabled = this.enableGridWaves === true;
        if (gridUniforms?.uWaveOrigin) {
            gridUniforms.uWaveOrigin.value.copy(this.gridWaveOrigin);
        } else if (gridUniforms?.waveOrigin) {
            gridUniforms.waveOrigin.value.copy(this.gridWaveOrigin);
        }
        if (gridUniforms?.uWaveIntensity) {
            gridUniforms.uWaveIntensity.value = waveEnabled ? this.gridWaveIntensity : 0;
        } else if (gridUniforms?.waveIntensity) {
            gridUniforms.waveIntensity.value = waveEnabled ? this.gridWaveIntensity : 0;
        }
        if (gridUniforms?.uWaveFrequency) {
            gridUniforms.uWaveFrequency.value = this.gridWaveFrequency;
        } else if (gridUniforms?.waveFrequency) {
            gridUniforms.waveFrequency.value = this.gridWaveFrequency;
        }
        if (gridUniforms?.uWaveSpeed) {
            gridUniforms.uWaveSpeed.value = this.gridWaveSpeed;
        } else if (gridUniforms?.waveSpeed) {
            gridUniforms.waveSpeed.value = this.gridWaveSpeed;
        }
        if (gridUniforms?.uWaveFalloff) {
            gridUniforms.uWaveFalloff.value = this.gridWaveFalloff;
        } else if (gridUniforms?.waveFalloff) {
            gridUniforms.waveFalloff.value = this.gridWaveFalloff;
        }

        // Decay effects
        if (this.gridPulseIntensity > 0) {
            this.gridPulseIntensity *= 0.95;
            if (this.gridPulseIntensity < 0.01) this.gridPulseIntensity = 0;
        }

        if (this.comboColorShift > 0) {
            const comboDecay = Math.exp(-delta / 0.4);
            this.comboColorShift *= comboDecay;
            if (this.comboColorShift < 0.01) this.comboColorShift = 0;
        }

        if (waveEnabled && this.gridWaveIntensity > 0) {
            this.gridWaveIntensity *= this.gridWaveDecay;
            if (this.gridWaveIntensity < 0.001) this.gridWaveIntensity = 0;
        }
    }

    updateHighlights(time, delta) {
        if (this.isWebGPU && this.highlightCompute?.computeNode) {
            if (this.highlightUniforms?.uTime) {
                this.highlightUniforms.uTime.value = time;
            }
            if (this.highlightUniforms?.uTwinkleIntensity) {
                this.highlightUniforms.uTwinkleIntensity.value = this.highlightTwinkleIntensity;
            }

            const scrollSpeed = 5.0;
            const maxZ = 90.0;
            const stateData = this.highlightCompute?.stateData;
            for (let i = 0; i < this.highlightData.length; i++) {
                const data = this.highlightData[i];
                if (!data.active) continue;
                data.z += scrollSpeed * delta;
                if (stateData) {
                    const base = i * 4;
                    stateData[base] = data.x;
                    stateData[base + 1] = data.y;
                    stateData[base + 2] = data.z;
                    stateData[base + 3] = data.intensity;
                }
                if (data.z > maxZ) {
                    data.active = false;
                    data.intensity = 0;
                    if (stateData) {
                        stateData[i * 4 + 3] = 0;
                    }
                    if (this.highlightCompute) {
                        this.highlightCompute.deactivate(i);
                    }
                }
            }

            if (this.highlightTwinkleIntensity > 0) {
                this.highlightTwinkleIntensity *= 0.96;
                if (this.highlightTwinkleIntensity < 0.01) this.highlightTwinkleIntensity = 0;
            }
            return;
        }

        // Grid shader speed is 5.0 world units/sec. Grid cell spacing is 1.5.
        const scrollSpeed = 5.0 / 1.5;
        const currentScroll = time * scrollSpeed;

        for (let i = this.gridHighlights.length - 1; i >= 0; i--) {
            const highlight = this.gridHighlights[i];
            const data = highlight.userData;

            // Update position to match grid scroll - scale by gridSpacing (1.5)
            // Update position to match grid scroll - scale by gridSpacing (1.5)
            const relativeZ = data.gridZ - currentScroll;
            highlight.position.z = -relativeZ * 1.5 + this.grid.position.z - 0.75; // Reverted to -0.75

            // Keep at full intensity - no time-based fade
            // Only fade slightly based on distance to horizon for visual effect
            const distanceFade = Math.max(0.3, 1.0 - Math.max(0, -relativeZ - 30) / 50);

            // Add twinkle effect during combos
            let twinkle = 1.0;
            if (this.highlightTwinkleIntensity > 0) {
                // Medium-High frequency blink - visible glitch feel matching Neon Dusk
                const phase = (data.gridZ * 0.5 + data.intensity * 2.0);
                const glitch = Math.sin(time * 30.0 + phase);
                twinkle = 1.0 + glitch * this.highlightTwinkleIntensity * 0.5;
            }

            const highlightUniforms = highlight.userData.uniforms || highlight.material.uniforms;
            const intensityValue = data.intensity * distanceFade * twinkle;
            if (highlightUniforms?.uIntensity) {
                highlightUniforms.uIntensity.value = intensityValue;
            } else if (highlightUniforms?.intensity) {
                highlightUniforms.intensity.value = intensityValue;
            }
            if (highlightUniforms?.uTime) {
                highlightUniforms.uTime.value = time;
            } else if (highlightUniforms?.time) {
                highlightUniforms.time.value = time;
            }

            // Remove ONLY when scrolled past visible horizon (far away)
            if (relativeZ < -80) {
                highlight.visible = false;
                data.active = false;
                this.gridHighlights.splice(i, 1);
            }
        }

        // Decay twinkle intensity
        if (this.highlightTwinkleIntensity > 0) {
            this.highlightTwinkleIntensity *= 0.96;
            if (this.highlightTwinkleIntensity < 0.01) this.highlightTwinkleIntensity = 0;
        }
    }

    updateParticles(delta) {
        if (this.isWebGPU && this.particleCompute?.computeNode) {
            // CPU shadow update for lifecycle only (no geometry updates)
            for (let i = 0; i < this.particleData.length; i++) {
                const p = this.particleData[i];
                if (p.active) {
                    p.x += p.vx * delta;
                    p.y += p.vy * delta;
                    p.z += p.vz * delta;
                    p.vy -= 5 * delta;
                    p.life -= delta / p.maxLife;
                    if (p.life <= 0) {
                        p.active = false;
                        p.life = 0;
                    }
                }
            }
            return;
        }

        const positions = this.particles.geometry.attributes.position.array;
        const sizes = this.particles.geometry.attributes.aSize.array;
        const lives = this.particles.geometry.attributes.aLife.array;
        const colors = this.particles.geometry.attributes.aColor.array;

        for (let i = 0; i < this.particleData.length; i++) {
            const p = this.particleData[i];

            if (p.active) {
                // Physics
                p.x += p.vx * delta;
                p.y += p.vy * delta;
                p.z += p.vz * delta;
                p.vy -= 5 * delta; // Gravity

                p.life -= delta / p.maxLife;

                if (p.life <= 0) {
                    p.active = false;
                    p.life = 0;
                }

                // Update buffers
                positions[i * 3] = p.x;
                positions[i * 3 + 1] = p.y;
                positions[i * 3 + 2] = p.z;
                sizes[i] = p.size;
                lives[i] = Math.max(0, p.life);
                colors[i * 3] = p.color.r;
                colors[i * 3 + 1] = p.color.g;
                colors[i * 3 + 2] = p.color.b;
            } else {
                // Hide inactive particles
                positions[i * 3 + 1] = -1000;
                lives[i] = 0;
            }
        }

        this.particles.geometry.attributes.position.needsUpdate = true;
        this.particles.geometry.attributes.aSize.needsUpdate = true;
        this.particles.geometry.attributes.aLife.needsUpdate = true;
        this.particles.geometry.attributes.aColor.needsUpdate = true;
    }

    updateBuildings(time, delta) {
        if (this.isWebGPU && this.buildingUniforms.length) {
            const glow = Math.min(0.35, 0.06 + this.cityGlowIntensity * 0.25);
            this.buildingUniforms.forEach((uniforms) => {
                if (uniforms?.uGlowIntensity) uniforms.uGlowIntensity.value = glow;
                if (uniforms?.uTime) uniforms.uTime.value = time;
            });
        }

        // Update building edge glow for combo effects
        if (this.cityGlowIntensity > 0) {
            if (this.isWebGPU && this.buildingEdgeUniforms?.uGlowIntensity) {
                this.buildingEdgeUniforms.uGlowIntensity.value = Math.min(1.0, this.cityGlowIntensity * 1.5);
            } else {
                this.buildingEdges.forEach((edge) => {
                    // Increase multiplier for much brighter edge glow (cap at 1.0 implicitly by material)
                    edge.material.opacity = Math.min(1.0, this.cityGlowIntensity * 1.5);
                    // Also scale line width if supported by browser (often strictly 1, but worth trying)
                    edge.material.linewidth = 2;
                });
            }

            // Slower decay for longer lasting glow effect
            this.cityGlowIntensity *= 0.985;
            if (this.cityGlowIntensity < 0.01) this.cityGlowIntensity = 0;
        } else if (this.isWebGPU && this.buildingEdgeUniforms?.uGlowIntensity) {
            this.buildingEdgeUniforms.uGlowIntensity.value = 0;
        }
    }

    updateStars(time) {
        if (this.starField) {
            if (this.starUniforms?.uTime) {
                this.starUniforms.uTime.value = time;
            } else if (this.starField.material.uniforms?.time) {
                this.starField.material.uniforms.time.value = time;
            }
            this.starField.rotation.y = time * 0.002;
        }
    }

    updateAmbience(time) {
        if (this.ambientMotesUniforms?.uTime) {
            this.ambientMotesUniforms.uTime.value = time;
        }
        // Subtle palm sway — single rotation y per palm group
        if (this.palms.length) {
            for (let i = 0; i < this.palms.length; i++) {
                const palm = this.palms[i];
                const baseRotation = palm.userData.baseRotation ?? palm.rotation.y;
                if (palm.userData.baseRotation === undefined) {
                    palm.userData.baseRotation = palm.rotation.y;
                }
                palm.rotation.y = baseRotation + Math.sin(time * 0.4 + i * 1.7) * 0.04;
            }
        }
    }

    updateShootingStars(delta) {
        if (!this.shootingStarPool.length) return;

        for (let i = 0; i < this.shootingStarPool.length; i++) {
            const star = this.shootingStarPool[i];
            const data = star.userData;
            if (!data.active) continue;

            data.position.addScaledVector(data.velocity, delta);
            data.life -= delta / data.maxLife;

            data.tailVec.copy(data.direction).multiplyScalar(data.tail);
            data.tailPos.copy(data.position).sub(data.tailVec);

            const positions = star.geometry.attributes.position.array;
            positions[0] = data.position.x;
            positions[1] = data.position.y;
            positions[2] = data.position.z;
            positions[3] = data.tailPos.x;
            positions[4] = data.tailPos.y;
            positions[5] = data.tailPos.z;
            star.geometry.attributes.position.needsUpdate = true;

            star.material.opacity = Math.max(0, data.life);
            if (data.life <= 0) {
                data.active = false;
                star.visible = false;
                star.material.opacity = 0;
            }
        }
    }

    // =========================================================================
    // LIFECYCLE
    // =========================================================================

    onResize() {
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.applyDynamicResolution();
    }

    stop() {
        // Stop base theme state immediately
        super.stop();

        // Invalidate any in-flight async scene creation
        this._sceneToken += 1;

        // Unsubscribe events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }

        // Clear effects
        this.gridHighlights = [];
        this.particleData.forEach((p) => p.active = false);

        if (this.postProcessing) {
            this.postProcessing.dispose();
            this.postProcessing = null;
        }
        if (this.particleCompute) {
            this.particleCompute.dispose();
            this.particleCompute = null;
        }
        if (this.highlightCompute) {
            this.highlightCompute.dispose();
            this.highlightCompute = null;
        }
        this.highlightInstanced = null;

        // Dispose Three.js resources (dispose scene objects before renderer)
        if (this.scene) {
            this.scene.traverse((obj) => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach((m) => m.dispose());
                    } else {
                        obj.material.dispose();
                    }
                }
            });
        }

        if (this.renderer) {
            this.disposeRenderer(this.renderer, { nullInstance: false });
            const container = document.getElementById('synthwave-sunset-theme');
            if (container && container.contains(this.renderer.domElement)) {
                container.removeChild(this.renderer.domElement);
            }
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.gridUniforms = null;
        this.sunUniforms = null;
        this.sunGlowUniforms = [];
        this.starUniforms = null;
        this.highlightUniforms = [];
        this.particleUniforms = null;
        this.buildingEdgeUniforms = null;
        this.buildingEdgeMaterial = null;
        this.buildingMaterials = [];
        this.buildingUniforms = [];
        this.shootingStarPool = [];
        this.hazeLayers = [];
        this.ambientMotes = null;
        this.ambientMotesUniforms = null;
        this.palms = [];
        this.palmUniforms = [];
        if (this.budgetMonitor) {
            this.budgetMonitor.samples = [];
            this.budgetMonitor.enabled = false;
        }
        if (typeof window !== 'undefined' && window.synthwaveBaseline) {
            delete window.synthwaveBaseline;
        }

        return;
    }

    getTetrominoConfig() {
        return SYNTHWAVE_SUNSET_TETROMINOS;
    }
}
