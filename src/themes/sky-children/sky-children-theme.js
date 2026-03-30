import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { SKY_CHILDREN_TETROMINOS } from './sky-children-tetrominos.js';
import {
    createSkyChildrenPhase1LightingState,
    createSkyChildrenPhase2TerrainState,
    createSkyChildrenPhase3CloudState,
    createSkyChildrenPhase4FoliageState,
    createSkyChildrenPhase5PostState,
    getSkyChildrenPhase7QualityPreset,
    listSkyChildrenPhase7QualityPresets,
    normalizeSkyChildrenPhase7QualityTier,
} from './sky-children-resources.js';
import {
    SKY_CHILDREN_PHASE4_SHADER_LABELS,
    SKY_CHILDREN_PHASE5_SHADER_LABELS,
    SKY_CHILDREN_PHASE4_UNIFORM_BYTES,
    SKY_CHILDREN_PHASE4_UNIFORM_FLOATS,
    buildSkyChildrenPhase4TerrainCloudFoliageWGSL,
    buildSkyChildrenPhase5PostWGSL,
    createSkyChildrenPostProcessingModule,
    createSkyChildrenStylizedLightingModule,
} from './sky-children-pipelines.js';
import { clamp } from '@utils/helpers.js';
import stylizedLightingWGSL from './wgsl/stylized_lighting.wgsl?raw';
import terrainWGSL from './wgsl/terrain.wgsl?raw';
import cloudWGSL from './wgsl/cloud.wgsl?raw';
import foliageWGSL from './wgsl/foliage.wgsl?raw';
import postProcessingWGSL from './wgsl/post_processing.wgsl?raw';

const GPU_BUFFER_USAGE_UNIFORM = globalThis.GPUBufferUsage?.UNIFORM ?? 0x40;
const GPU_BUFFER_USAGE_COPY_DST = globalThis.GPUBufferUsage?.COPY_DST ?? 0x08;
const GPU_BUFFER_USAGE_COPY_SRC = globalThis.GPUBufferUsage?.COPY_SRC ?? 0x04;
const GPU_BUFFER_USAGE_MAP_READ = globalThis.GPUBufferUsage?.MAP_READ ?? 0x01;
const GPU_BUFFER_USAGE_QUERY_RESOLVE = globalThis.GPUBufferUsage?.QUERY_RESOLVE ?? 0x200;
const GPU_SHADER_STAGE_VERTEX = globalThis.GPUShaderStage?.VERTEX ?? 0x1;
const GPU_SHADER_STAGE_FRAGMENT = globalThis.GPUShaderStage?.FRAGMENT ?? 0x2;
const GPU_MAP_MODE_READ = globalThis.GPUMapMode?.READ ?? 0x1;
const GPU_TEXTURE_USAGE_COPY_SRC = globalThis.GPUTextureUsage?.COPY_SRC ?? 0x01;
const GPU_TEXTURE_USAGE_TEXTURE_BINDING = globalThis.GPUTextureUsage?.TEXTURE_BINDING ?? 0x04;
const GPU_TEXTURE_USAGE_RENDER_ATTACHMENT = globalThis.GPUTextureUsage?.RENDER_ATTACHMENT ?? 0x10;

const POST_UNIFORM_FLOATS = 24;
const POST_UNIFORM_BYTES = POST_UNIFORM_FLOATS * 4;
const POST_UNIFORM = Object.freeze({
    resolutionTime: 0,
    bloomParams: 4,
    gradingParams: 8,
    shadowColorStrength: 12,
    highlightColorStrength: 16,
    midtoneColorStrength: 20,
});

const UNIFORM = Object.freeze({
    resolutionTime: 0,
    comboMisc: 4,
    sunDir: 8,
    sunColorIntensity: 12,
    ambientColorIntensity: 16,
    shadowTintBoost: 20,
    rimColorPower: 24,
    specParams: 28,
    oceanColorGlitter: 32,
    controls: 36,
    terrainColorRoughnessNear: 40,
    terrainCoolTriplanar: 44,
    terrainShadowNormal: 48,
    terrainRippleRoughnessFar: 52,
    terrainFalloffHeight: 56,
    cloudColorDensity: 60,
    cloudShadowScatter: 64,
    cloudAmbientIntensity: 68,
    cloudMotionOpacity: 72,
    cloudShapeSilver: 76,
    foliageBaseVariation: 80,
    foliageTipSssIntensity: 84,
    foliageSssColorDistortion: 88,
    foliageShapeSss: 92,
    foliageWindPrimary: 96,
    foliageWindSecondary: 100,
});

const SKY_CHILDREN_PHASE1_HERO_SHOTS = Object.freeze([
    'hero-sunset-ridge',
    'hero-sunset-cloud-rim',
    'hero-cloud-sea-wide',
    'hero-cloud-sea-silhouette',
    'hero-interior-haze-entry',
    'hero-interior-haze-depth',
]);

const SKY_CHILDREN_PHASE2_HERO_SHOTS = Object.freeze([
    'terrain-steep-slope',
    'terrain-midground-ridge',
    'terrain-distance-band',
]);

const SKY_CHILDREN_PHASE3_HERO_SHOTS = Object.freeze([
    'hero-sunset-cloud-rim',
    'hero-cloud-sea-wide',
    'hero-cloud-sea-silhouette',
]);

const SKY_CHILDREN_PHASE4_HERO_SHOTS = Object.freeze([
    'hero-foliage-sun-facing',
    'hero-foliage-gust-layering',
    'hero-foliage-midground-readability',
]);

const SKY_CHILDREN_PHASE5_HERO_SHOTS = Object.freeze([
    'hero-post-bloom-halo-control',
    'hero-post-highlight-hue-hold',
    'hero-post-warm-cool-balance',
]);

const SKY_CHILDREN_PHASE6_CAMERA_PATHS = Object.freeze([
    Object.freeze({
        id: 'hero-sunset-ridge',
        durationSec: 8,
        depthBands: Object.freeze([0.48, 0.34, 0.18]),
        silhouetteWeight: 1.0,
        atmosphereWeight: 0.86,
        warmthWeight: 1.06,
    }),
    Object.freeze({
        id: 'hero-sunset-cloud-rim',
        durationSec: 7,
        depthBands: Object.freeze([0.24, 0.38, 0.38]),
        silhouetteWeight: 1.12,
        atmosphereWeight: 1.0,
        warmthWeight: 1.0,
    }),
    Object.freeze({
        id: 'hero-cloud-sea-wide',
        durationSec: 9,
        depthBands: Object.freeze([0.18, 0.36, 0.46]),
        silhouetteWeight: 0.92,
        atmosphereWeight: 1.12,
        warmthWeight: 0.96,
    }),
    Object.freeze({
        id: 'hero-cloud-sea-silhouette',
        durationSec: 7,
        depthBands: Object.freeze([0.2, 0.3, 0.5]),
        silhouetteWeight: 1.2,
        atmosphereWeight: 1.06,
        warmthWeight: 0.98,
    }),
    Object.freeze({
        id: 'hero-interior-haze-entry',
        durationSec: 6,
        depthBands: Object.freeze([0.44, 0.38, 0.18]),
        silhouetteWeight: 0.82,
        atmosphereWeight: 1.18,
        warmthWeight: 0.94,
    }),
    Object.freeze({
        id: 'hero-interior-haze-depth',
        durationSec: 8,
        depthBands: Object.freeze([0.16, 0.34, 0.5]),
        silhouetteWeight: 0.9,
        atmosphereWeight: 1.24,
        warmthWeight: 0.9,
    }),
]);

const SKY_CHILDREN_PHASE6_HERO_SHOTS = Object.freeze(
    SKY_CHILDREN_PHASE6_CAMERA_PATHS.map((path) => path.id),
);

const SKY_CHILDREN_PHASE7_TIERS = Object.freeze(['mobile', 'medium', 'high', 'ultra']);
const SKY_CHILDREN_PHASE7_HERO_SHOTS = Object.freeze([...SKY_CHILDREN_PHASE6_HERO_SHOTS]);

const SKY_CHILDREN_PRESENT_WGSL = `
struct VSOut {
    @builtin(position) clip_position: vec4f,
    @location(0) uv: vec2f,
};

@group(0) @binding(0) var present_input: texture_2d<f32>;
@group(0) @binding(1) var present_sampler: sampler;

@vertex
fn vs_present(@builtin(vertex_index) vertex_index: u32) -> VSOut {
    let positions = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0),
    );
    var output: VSOut;
    let pos = positions[vertex_index];
    output.clip_position = vec4f(pos, 0.0, 1.0);
    output.uv = pos * 0.5 + vec2f(0.5);
    return output;
}

@fragment
fn fs_present(input: VSOut) -> @location(0) vec4f {
    let color = textureSampleLevel(present_input, present_sampler, input.uv, 0.0).rgb;
    return vec4f(color, 1.0);
}
`;

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function average(values) {
    if (!Array.isArray(values) || values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, ratio) {
    if (!Array.isArray(values) || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = clamp(Math.ceil(sorted.length * ratio) - 1, 0, sorted.length - 1);
    return sorted[index];
}

function normalizeVec3(values, fallback = [0, 1, 0]) {
    if (!Array.isArray(values) || values.length < 3) {
        return fallback;
    }
    const x = Number(values[0]) || 0;
    const y = Number(values[1]) || 0;
    const z = Number(values[2]) || 0;
    const len = Math.hypot(x, y, z);
    if (len < 1e-6) {
        return fallback;
    }
    return [x / len, y / len, z / len];
}

function isWindowsPlatform() {
    if (typeof navigator === 'undefined') return false;
    const platform = String(navigator.userAgentData?.platform || navigator.platform || '');
    return /win/i.test(platform);
}

function getWebGPUAdapterOptions() {
    return isWindowsPlatform() ? undefined : { powerPreference: 'high-performance' };
}

function createEmptyWebGPUState() {
    return {
        adapter: null,
        device: null,
        context: null,
        format: null, // swapchain format
        sceneFormat: null,
        depthFormat: null,
        pipelineLayout: null,
        bindGroupLayout: null,
        pipeline: null,
        foliagePipeline: null,
        flowerPipeline: null,
        bindGroup: null,
        foliageBindGroup: null,
        uniformBuffer: null,
        shaderModule: null,
        sceneTexture: null,
        sceneTextureView: null,
        depthTexture: null,
        depthTextureView: null,
        postTexture: null,
        postTextureView: null,
        postTextureWidth: 0,
        postTextureHeight: 0,
        sceneTextureWidth: 0,
        sceneTextureHeight: 0,
        depthTextureWidth: 0,
        depthTextureHeight: 0,
        postShaderModule: null,
        postPipelineLayout: null,
        postBindGroupLayout: null,
        postPipeline: null,
        postSampler: null,
        postUniformBuffer: null,
        postBindGroup: null,
        presentShaderModule: null,
        presentPipelineLayout: null,
        presentBindGroupLayout: null,
        presentPipeline: null,
        presentBindGroup: null,
        timestampQuery: {
            supported: false,
            querySet: null,
            resolveBuffer: null,
            readBuffer: null,
            pending: false,
            reading: false,
        },
        deviceLostInfo: null,
    };
}

export default class SkyChildrenTheme extends BaseTheme {
    constructor() {
        super('sky-children');

        this.canvas = null;
        this.ctx = null;
        this.rafId = null;
        this.lastTime = 0;
        this.lastFramePresentTime = 0;
        this.eventUnsubscribers = [];
        this.boundResizeHandler = () => this.resizeCanvas();
        this.pendingAsyncTimeouts = new Set();

        this.runtime = {
            time: 0,
            eventEnergy: 0,
            eventEnergyTarget: 0,
            comboEnergy: 0,
            comboEnergyTarget: 0,
            palettePhase: Math.random() * Math.PI * 2,
            cameraOffsetX: 0,
            cameraOffsetY: 0,
            cameraPhaseX: Math.random() * Math.PI * 2,
            cameraPhaseY: Math.random() * Math.PI * 2,
            cloudLayers: [],
            motes: [],
        };
        this.resolutionLock = null;

        this.lightingState = createSkyChildrenPhase1LightingState();
        this.terrainState = createSkyChildrenPhase2TerrainState();
        this.cloudState = createSkyChildrenPhase3CloudState();
        this.foliageState = createSkyChildrenPhase4FoliageState();
        this.postState = createSkyChildrenPhase5PostState();
        this.phase7QualityTier = 'high';
        this.phase7QualityPreset = getSkyChildrenPhase7QualityPreset(this.phase7QualityTier);
        this.phase7RenderScale = this.phase7QualityPreset?.renderScale ?? 1.0;
        this.phase1WgslSource = null;
        this.phase2TerrainWgslSource = null;
        this.phase3CloudWgslSource = null;
        this.phase4FoliageWgslSource = null;
        this.phase5PostWgslSource = null;
        this.uniformData = new Float32Array(SKY_CHILDREN_PHASE4_UNIFORM_FLOATS);
        this.postUniformData = new Float32Array(POST_UNIFORM_FLOATS);
        this.performanceSamples = [];
        this.phase5PostSamples = [];
        this.frameIntervalSamples = [];
        this.gpuTimestampSamples = [];
        this.gpuPostTimestampSamples = [];
        this.maxPerformanceSamples = 720;
        this.maxPhase5PostSamples = 720;
        this.maxFrameIntervalSamples = 720;
        this.maxGpuTimestampSamples = 720;
        this.maxGpuPostTimestampSamples = 720;

        this.webgpu = createEmptyWebGPUState();
        this.renderBackend = 'canvas2d';
        this.phase1Validation = {
            renderSamples: this.performanceSamples,
            snapshots: [],
            maxSnapshots: 32,
            lastVisualGate: null,
            lastPerformanceGate: null,
            lastReport: null,
        };
        this.phase2Validation = {
            renderSamples: this.performanceSamples,
            snapshots: [],
            maxSnapshots: 32,
            lastVisualGate: null,
            lastPerformanceGate: null,
            lastReport: null,
        };
        this.phase3Validation = {
            renderSamples: this.performanceSamples,
            snapshots: [],
            maxSnapshots: 32,
            lastVisualGate: null,
            lastPerformanceGate: null,
            lastReport: null,
        };
        this.phase4Validation = {
            renderSamples: this.performanceSamples,
            snapshots: [],
            maxSnapshots: 32,
            lastVisualGate: null,
            lastPerformanceGate: null,
            lastReport: null,
        };
        this.phase5Validation = {
            renderSamples: this.phase5PostSamples,
            snapshots: [],
            maxSnapshots: 32,
            lastVisualGate: null,
            lastPerformanceGate: null,
            lastReport: null,
            lastFrameProbe: null,
        };
        this.phase6Validation = {
            renderSamples: this.performanceSamples,
            snapshots: [],
            maxSnapshots: 32,
            lastVisualGate: null,
            lastPerformanceGate: null,
            lastReport: null,
            lastShotReview: null,
        };
        this.phase7Validation = {
            renderSamples: this.performanceSamples,
            snapshots: [],
            maxSnapshots: 32,
            lastVisualGate: null,
            lastPerformanceGate: null,
            lastReport: null,
        };

        this.layerCount = 5;
        this.moteCount = 180;
    }

    async init() {
        // No deferred assets besides optional WGSL loading for WebGPU path.
    }

    getTetrominoConfig() {
        return SKY_CHILDREN_TETROMINOS;
    }

    async createScene() {
        this.removePhase1Helpers();
        this.removePhase2Helpers();
        this.removePhase3Helpers();
        this.removePhase4Helpers();
        this.removePhase5Helpers();
        this.removePhase6Helpers();
        this.removePhase7Helpers();
        const container = this.getOrCreateThemeContainer();
        if (!container) return;

        this.ensureCanvas(container);
        const hasWebGPU = await this.initWebGPU();

        if (!hasWebGPU) {
            this.ensure2DContext();
            this.renderBackend = 'canvas2d';
        }

        this.setPhase7QualityTier(this.phase7QualityTier, { resize: false, reseed: false });
        this.resizeCanvas();
        this.seedSceneState();
        this.installEventListeners();
        this.startAnimation();
        this.installPhase1Helpers();
        this.installPhase2Helpers();
        this.installPhase3Helpers();
        this.installPhase4Helpers();
        this.installPhase5Helpers();
        this.installPhase6Helpers();
        this.installPhase7Helpers();
    }

    getOrCreateThemeContainer() {
        let container = document.getElementById('sky-children-theme');
        if (!container) {
            const backgroundRoot = document.querySelector('.background-container');
            if (!backgroundRoot) {
                console.error('[SkyChildrenTheme] Missing .background-container');
                return null;
            }

            container = document.createElement('div');
            container.id = 'sky-children-theme';
            container.className = 'theme-container';
            backgroundRoot.appendChild(container);
        }
        return container;
    }

    ensureCanvas(container) {
        if (!this.canvas || !this.canvas.isConnected) {
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'sky-children-canvas';
            this.canvas.style.position = 'absolute';
            this.canvas.style.inset = '0';
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.pointerEvents = 'none';
            this.canvas.style.opacity = '0.98';
            container.appendChild(this.canvas);
        }
    }

    resetCanvasElement(container) {
        if (this.canvas?.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        this.canvas = null;
        this.ctx = null;
        this.ensureCanvas(container);
    }

    ensure2DContext() {
        if (!this.canvas) return false;
        this.ctx = this.canvas.getContext('2d');
        if (this.ctx) {
            return true;
        }

        // A canvas bound to WebGPU cannot switch to 2D; replace and retry once.
        const parent = this.canvas.parentElement;
        if (parent) {
            this.resetCanvasElement(parent);
            this.ctx = this.canvas?.getContext('2d') || null;
            if (this.ctx) {
                return true;
            }
        }

        console.error('[SkyChildrenTheme] Failed to acquire 2D context after canvas reset');
        return false;
    }

    async loadStylizedLightingSource() {
        if (typeof this.phase1WgslSource === 'string' && this.phase1WgslSource.length > 0) {
            return this.phase1WgslSource;
        }

        this.phase1WgslSource = stylizedLightingWGSL;
        return this.phase1WgslSource;
    }

    async loadTerrainSource() {
        if (typeof this.phase2TerrainWgslSource === 'string' && this.phase2TerrainWgslSource.length > 0) {
            return this.phase2TerrainWgslSource;
        }

        this.phase2TerrainWgslSource = terrainWGSL;
        return this.phase2TerrainWgslSource;
    }

    async loadCloudSource() {
        if (typeof this.phase3CloudWgslSource === 'string' && this.phase3CloudWgslSource.length > 0) {
            return this.phase3CloudWgslSource;
        }

        this.phase3CloudWgslSource = cloudWGSL;
        return this.phase3CloudWgslSource;
    }

    async loadFoliageSource() {
        if (typeof this.phase4FoliageWgslSource === 'string' && this.phase4FoliageWgslSource.length > 0) {
            return this.phase4FoliageWgslSource;
        }

        this.phase4FoliageWgslSource = foliageWGSL;
        return this.phase4FoliageWgslSource;
    }

    async loadPostProcessingSource() {
        if (typeof this.phase5PostWgslSource === 'string' && this.phase5PostWgslSource.length > 0) {
            return this.phase5PostWgslSource;
        }

        this.phase5PostWgslSource = postProcessingWGSL;
        return this.phase5PostWgslSource;
    }

    async validateShaderModule(shaderModule, label) {
        if (!shaderModule || typeof shaderModule.getCompilationInfo !== 'function') {
            return;
        }
        const compilationInfo = await shaderModule.getCompilationInfo();
        const messages = Array.isArray(compilationInfo?.messages) ? compilationInfo.messages : [];
        const errors = messages.filter((message) => message?.type === 'error');
        if (errors.length === 0) {
            return;
        }

        const summary = errors
            .slice(0, 4)
            .map((message) => {
                const line = Number.isFinite(message.lineNum) ? message.lineNum : '?';
                const pos = Number.isFinite(message.linePos) ? message.linePos : '?';
                return `L${line}:${pos} ${message.message}`;
            })
            .join(' | ');

        throw new Error(`WGSL compile failed for ${label}: ${summary}`);
    }

    async initWebGPU() {
        if (!this.canvas || !navigator.gpu) {
            return false;
        }

        try {
            const adapter = await navigator.gpu.requestAdapter(getWebGPUAdapterOptions());
            if (!adapter) {
                return false;
            }

            const supportsTimestampQuery = typeof adapter.features?.has === 'function'
                && adapter.features.has('timestamp-query');
            let device = null;
            if (supportsTimestampQuery) {
                try {
                    device = await adapter.requestDevice({
                        requiredFeatures: ['timestamp-query'],
                    });
                } catch {
                    device = await adapter.requestDevice();
                }
            } else {
                device = await adapter.requestDevice();
            }
            const context = this.canvas.getContext('webgpu');
            if (!context) {
                return false;
            }

            const swapchainFormat = navigator.gpu.getPreferredCanvasFormat();
            context.configure({
                device,
                format: swapchainFormat,
                alphaMode: 'premultiplied',
            });
            let sceneFormat = 'rgba16float';
            try {
                const probeTexture = device.createTexture({
                    size: { width: 1, height: 1, depthOrArrayLayers: 1 },
                    format: sceneFormat,
                    usage: GPU_TEXTURE_USAGE_RENDER_ATTACHMENT + GPU_TEXTURE_USAGE_TEXTURE_BINDING,
                });
                probeTexture.destroy();
            } catch {
                sceneFormat = swapchainFormat;
            }
            const depthFormat = 'depth24plus';

            const coreWGSL = await this.loadStylizedLightingSource();
            const terrainWGSL = await this.loadTerrainSource();
            const cloudWGSL = await this.loadCloudSource();
            const foliageWGSL = await this.loadFoliageSource();
            const postWGSL = buildSkyChildrenPhase5PostWGSL(await this.loadPostProcessingSource());
            const shaderSource = buildSkyChildrenPhase4TerrainCloudFoliageWGSL(
                coreWGSL,
                terrainWGSL,
                cloudWGSL,
                foliageWGSL,
            );
            // Phase 1: Wrap shader compilation with error scopes for diagnostics
            device.pushErrorScope('validation');
            const shaderModule = createSkyChildrenStylizedLightingModule(device, shaderSource);
            await this.validateShaderModule(shaderModule, SKY_CHILDREN_PHASE4_SHADER_LABELS.terrainCloudFoliageLighting);
            const shaderScopeError = await device.popErrorScope();
            if (shaderScopeError) {
                console.error('[SkyChildren] Shader validation error:', shaderScopeError.message);
            }

            device.pushErrorScope('validation');
            const postShaderModule = createSkyChildrenPostProcessingModule(device, postWGSL);
            await this.validateShaderModule(postShaderModule, SKY_CHILDREN_PHASE5_SHADER_LABELS.postProcessing);
            const postShaderScopeError = await device.popErrorScope();
            if (postShaderScopeError) {
                console.error('[SkyChildren] Post-processing shader validation error:', postShaderScopeError.message);
            }

            const bindGroupLayout = device.createBindGroupLayout({
                label: 'sky-children/phase4-bind-group-layout',
                entries: [
                    {
                        binding: 0,
                        visibility: GPU_SHADER_STAGE_VERTEX | GPU_SHADER_STAGE_FRAGMENT,
                        buffer: {
                            type: 'uniform',
                        },
                    },
                ],
            });
            const pipelineLayout = device.createPipelineLayout({
                label: 'sky-children/phase4-pipeline-layout',
                bindGroupLayouts: [bindGroupLayout],
            });

            const pipeline = device.createRenderPipeline({
                label: 'sky-children/phase4-terrain-cloud-pass',
                layout: pipelineLayout,
                vertex: {
                    module: shaderModule,
                    entryPoint: 'vs_main',
                },
                fragment: {
                    module: shaderModule,
                    entryPoint: 'fs_main',
                    targets: [{ format: sceneFormat }],
                },
                primitive: {
                    topology: 'triangle-list',
                },
                depthStencil: {
                    format: depthFormat,
                    depthWriteEnabled: false,
                    depthCompare: 'always',
                },
            });

            const foliagePipeline = device.createRenderPipeline({
                label: SKY_CHILDREN_PHASE4_SHADER_LABELS.foliagePass,
                layout: pipelineLayout,
                vertex: {
                    module: shaderModule,
                    entryPoint: 'vs_foliage',
                },
                fragment: {
                    module: shaderModule,
                    entryPoint: 'fs_foliage',
                    targets: [{
                        format: sceneFormat,
                        blend: {
                            color: {
                                srcFactor: 'src-alpha',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add',
                            },
                            alpha: {
                                srcFactor: 'one',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add',
                            },
                        },
                    }],
                },
                primitive: {
                    topology: 'triangle-list',
                    cullMode: 'none',
                },
                depthStencil: {
                    format: depthFormat,
                    depthWriteEnabled: true,
                    depthCompare: 'less-equal',
                },
            });

            const flowerPipeline = device.createRenderPipeline({
                label: SKY_CHILDREN_PHASE4_SHADER_LABELS.flowerPass,
                layout: pipelineLayout,
                vertex: {
                    module: shaderModule,
                    entryPoint: 'vs_flower',
                },
                fragment: {
                    module: shaderModule,
                    entryPoint: 'fs_flower',
                    targets: [{
                        format: sceneFormat,
                        blend: {
                            color: {
                                srcFactor: 'src-alpha',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add',
                            },
                            alpha: {
                                srcFactor: 'one',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add',
                            },
                        },
                    }],
                },
                primitive: {
                    topology: 'triangle-list',
                    cullMode: 'none',
                },
                depthStencil: {
                    format: depthFormat,
                    depthWriteEnabled: false,
                    depthCompare: 'always',
                },
            });

            const uniformBuffer = device.createBuffer({
                label: 'sky-children/phase4-uniforms',
                size: SKY_CHILDREN_PHASE4_UNIFORM_BYTES,
                usage: GPU_BUFFER_USAGE_UNIFORM + GPU_BUFFER_USAGE_COPY_DST,
            });

            const bindGroup = device.createBindGroup({
                layout: bindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: { buffer: uniformBuffer },
                    },
                ],
            });
            const foliageBindGroup = bindGroup;

            const postBindGroupLayout = device.createBindGroupLayout({
                label: 'sky-children/phase5-post-bind-group-layout',
                entries: [
                    {
                        binding: 0,
                        visibility: GPU_SHADER_STAGE_FRAGMENT,
                        texture: {
                            sampleType: 'float',
                            viewDimension: '2d',
                            multisampled: false,
                        },
                    },
                    {
                        binding: 1,
                        visibility: GPU_SHADER_STAGE_FRAGMENT,
                        sampler: {
                            type: 'filtering',
                        },
                    },
                    {
                        binding: 2,
                        visibility: GPU_SHADER_STAGE_FRAGMENT,
                        buffer: {
                            type: 'uniform',
                        },
                    },
                ],
            });
            const postPipelineLayout = device.createPipelineLayout({
                label: 'sky-children/phase5-post-pipeline-layout',
                bindGroupLayouts: [postBindGroupLayout],
            });
            const postPipeline = device.createRenderPipeline({
                label: SKY_CHILDREN_PHASE5_SHADER_LABELS.postPass,
                layout: postPipelineLayout,
                vertex: {
                    module: postShaderModule,
                    entryPoint: 'vs_post',
                },
                fragment: {
                    module: postShaderModule,
                    entryPoint: 'fs_post',
                    targets: [{ format: swapchainFormat }],
                },
                primitive: {
                    topology: 'triangle-list',
                },
            });
            const postSampler = device.createSampler({
                label: 'sky-children/phase5-post-sampler',
                magFilter: 'linear',
                minFilter: 'linear',
                mipmapFilter: 'linear',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
            });
            const postUniformBuffer = device.createBuffer({
                label: 'sky-children/phase5-post-uniforms',
                size: POST_UNIFORM_BYTES,
                usage: GPU_BUFFER_USAGE_UNIFORM + GPU_BUFFER_USAGE_COPY_DST,
            });

            device.pushErrorScope('validation');
            const presentShaderModule = device.createShaderModule({
                label: 'sky-children/phase5-present-shader',
                code: SKY_CHILDREN_PRESENT_WGSL,
            });
            await this.validateShaderModule(presentShaderModule, 'sky-children/phase5-present-shader');
            const presentScopeError = await device.popErrorScope();
            if (presentScopeError) {
                console.error('[SkyChildren] Present shader validation error:', presentScopeError.message);
            }
            const presentBindGroupLayout = device.createBindGroupLayout({
                label: 'sky-children/phase5-present-bind-group-layout',
                entries: [
                    {
                        binding: 0,
                        visibility: GPU_SHADER_STAGE_FRAGMENT,
                        texture: {
                            sampleType: 'float',
                            viewDimension: '2d',
                            multisampled: false,
                        },
                    },
                    {
                        binding: 1,
                        visibility: GPU_SHADER_STAGE_FRAGMENT,
                        sampler: {
                            type: 'filtering',
                        },
                    },
                ],
            });
            const presentPipelineLayout = device.createPipelineLayout({
                label: 'sky-children/phase5-present-pipeline-layout',
                bindGroupLayouts: [presentBindGroupLayout],
            });
            const presentPipeline = device.createRenderPipeline({
                label: 'sky-children/phase5-present-pass',
                layout: presentPipelineLayout,
                vertex: {
                    module: presentShaderModule,
                    entryPoint: 'vs_present',
                },
                fragment: {
                    module: presentShaderModule,
                    entryPoint: 'fs_present',
                    targets: [{ format: swapchainFormat }],
                },
                primitive: {
                    topology: 'triangle-list',
                },
            });

            const timestampQuerySupported = typeof device.features?.has === 'function'
                && device.features.has('timestamp-query');
            let timestampQuery = createEmptyWebGPUState().timestampQuery;
            if (timestampQuerySupported && typeof device.createQuerySet === 'function') {
                try {
                    const querySet = device.createQuerySet({
                        label: 'sky-children/timestamp-query-set',
                        type: 'timestamp',
                        count: 4,
                    });
                    const resolveBuffer = device.createBuffer({
                        label: 'sky-children/timestamp-resolve-buffer',
                        size: 32,
                        usage: GPU_BUFFER_USAGE_QUERY_RESOLVE + GPU_BUFFER_USAGE_COPY_SRC,
                    });
                    const readBuffer = device.createBuffer({
                        label: 'sky-children/timestamp-read-buffer',
                        size: 32,
                        usage: GPU_BUFFER_USAGE_COPY_DST + GPU_BUFFER_USAGE_MAP_READ,
                    });
                    timestampQuery = {
                        supported: true,
                        querySet,
                        resolveBuffer,
                        readBuffer,
                        pending: false,
                        reading: false,
                    };
                } catch {
                    timestampQuery = createEmptyWebGPUState().timestampQuery;
                }
            }

            this.webgpu = {
                adapter,
                device,
                context,
                format: swapchainFormat,
                sceneFormat,
                depthFormat,
                pipelineLayout,
                bindGroupLayout,
                pipeline,
                foliagePipeline,
                flowerPipeline,
                bindGroup,
                foliageBindGroup,
                uniformBuffer,
                shaderModule,
                postShaderModule,
                postPipelineLayout,
                postBindGroupLayout,
                postPipeline,
                postSampler,
                postUniformBuffer,
                presentShaderModule,
                presentPipelineLayout,
                presentBindGroupLayout,
                presentPipeline,
                presentBindGroup: null,
                timestampQuery,
                deviceLostInfo: null,
            };
            this.ensureWebGPUSceneTexture();

            device.lost.then((info) => {
                this.handleWebGPUDeviceLost(info);
            });

            this.ctx = null;
            this.renderBackend = 'webgpu';
            return true;
        } catch (error) {
            console.warn('[SkyChildrenTheme] WebGPU init failed, falling back to 2D:', error);
            this.disposeWebGPU();
            return false;
        }
    }

    handleWebGPUDeviceLost(info) {
        this.webgpu.deviceLostInfo = info;
        const reason = info?.reason || 'unknown';
        console.warn(`[SkyChildrenTheme] WebGPU device lost (${reason}), switching to canvas2d fallback.`);

        if (!this.isActive) {
            this.disposeWebGPU();
            return;
        }

        this.disableWebGPUAndFallback();
    }

    disableWebGPUAndFallback() {
        this.disposeWebGPU();

        const container = this.getOrCreateThemeContainer();
        if (!container) return;

        this.ensure2DContext();

        this.renderBackend = 'canvas2d';
        this.resizeCanvas();
        this.seedSceneState();
    }

    disposeWebGPU() {
        if (this.webgpu.sceneTexture && typeof this.webgpu.sceneTexture.destroy === 'function') {
            try {
                this.webgpu.sceneTexture.destroy();
            } catch {
                // no-op
            }
        }
        if (this.webgpu.depthTexture && typeof this.webgpu.depthTexture.destroy === 'function') {
            try {
                this.webgpu.depthTexture.destroy();
            } catch {
                // no-op
            }
        }
        if (this.webgpu.postTexture && typeof this.webgpu.postTexture.destroy === 'function') {
            try {
                this.webgpu.postTexture.destroy();
            } catch {
                // no-op
            }
        }
        if (this.webgpu.uniformBuffer && typeof this.webgpu.uniformBuffer.destroy === 'function') {
            try {
                this.webgpu.uniformBuffer.destroy();
            } catch {
                // no-op
            }
        }
        if (this.webgpu.postUniformBuffer && typeof this.webgpu.postUniformBuffer.destroy === 'function') {
            try {
                this.webgpu.postUniformBuffer.destroy();
            } catch {
                // no-op
            }
        }
        if (this.webgpu.timestampQuery?.resolveBuffer && typeof this.webgpu.timestampQuery.resolveBuffer.destroy === 'function') {
            try {
                this.webgpu.timestampQuery.resolveBuffer.destroy();
            } catch {
                // no-op
            }
        }
        if (this.webgpu.timestampQuery?.readBuffer && typeof this.webgpu.timestampQuery.readBuffer.destroy === 'function') {
            try {
                this.webgpu.timestampQuery.readBuffer.destroy();
            } catch {
                // no-op
            }
        }
        this.webgpu = createEmptyWebGPUState();
        if (this.renderBackend === 'webgpu') {
            this.renderBackend = 'canvas2d';
        }
    }

    seedSceneState() {
        if (!this.canvas) return;

        const { width, height } = this.canvas;
        if (!width || !height) return;

        const { runtime } = this;
        runtime.cloudLayers = [];

        for (let layerIndex = 0; layerIndex < this.layerCount; layerIndex += 1) {
            const cloudCount = 6 + layerIndex * 3;
            const layer = {
                depth: layerIndex / (this.layerCount - 1 || 1),
                speed: 0.004 + layerIndex * 0.003,
                amplitude: 6 + layerIndex * 8,
                yBase: height * (0.18 + layerIndex * 0.16),
                clouds: [],
            };

            for (let i = 0; i < cloudCount; i += 1) {
                const scale = 0.8 + Math.random() * 2.2;
                layer.clouds.push({
                    x: Math.random() * width,
                    y: layer.yBase + (Math.random() - 0.5) * 40,
                    radiusX: (80 + Math.random() * 140) * scale,
                    radiusY: (24 + Math.random() * 42) * scale * 0.6,
                    drift: (Math.random() * 2 - 1) * layer.speed,
                    phase: Math.random() * Math.PI * 2,
                    alpha: 0.07 + Math.random() * 0.15,
                });
            }
            runtime.cloudLayers.push(layer);
        }

        runtime.motes = [];
        for (let i = 0; i < this.moteCount; i += 1) {
            runtime.motes.push({
                x: Math.random() * width,
                y: Math.random() * height,
                size: 0.8 + Math.random() * 2.6,
                vx: (Math.random() - 0.5) * 5,
                vy: -3 - Math.random() * 8,
                alpha: 0.08 + Math.random() * 0.28,
                twinkle: Math.random() * Math.PI * 2,
            });
        }
    }

    installEventListeners() {
        this.removeEventListeners();

        const onLineClear = eventBus.on(EVENTS.LINE_CLEAR, (payload = {}) => {
            const lineCount = clamp(Number(payload.lineCount) || 1, 1, 4);
            this.runtime.eventEnergyTarget = clamp(
                this.runtime.eventEnergyTarget + lineCount * 0.12,
                0,
                1.2,
            );
        });

        const onCombo = eventBus.on(EVENTS.COMBO, (payload = {}) => {
            const comboCount = clamp(Number(payload.comboCount) || 1, 1, 12);
            this.runtime.comboEnergyTarget = clamp(comboCount / 12, 0, 1);
        });

        const onPieceLock = eventBus.on(EVENTS.PIECE_LOCK, () => {
            this.runtime.eventEnergyTarget = clamp(this.runtime.eventEnergyTarget + 0.05, 0, 1.2);
        });

        this.eventUnsubscribers.push(onLineClear, onCombo, onPieceLock);
        window.addEventListener('resize', this.boundResizeHandler);
    }

    removeEventListeners() {
        this.eventUnsubscribers.forEach((unsubscribe) => unsubscribe?.());
        this.eventUnsubscribers = [];
        window.removeEventListener('resize', this.boundResizeHandler);
    }

    resizeCanvas() {
        if (!this.canvas) return;

        const lock = this.resolutionLock;
        const width = Math.max(1, Math.floor(lock?.width ?? window.innerWidth));
        const height = Math.max(1, Math.floor(lock?.height ?? window.innerHeight));
        const pixelRatio = this.getRenderPixelRatio();
        const targetWidth = Math.max(1, Math.floor(width * pixelRatio));
        const targetHeight = Math.max(1, Math.floor(height * pixelRatio));

        if (this.canvas.width === targetWidth && this.canvas.height === targetHeight) {
            return;
        }

        this.canvas.width = targetWidth;
        this.canvas.height = targetHeight;

        if (this.renderBackend === 'webgpu' && this.webgpu.context && this.webgpu.device && this.webgpu.format) {
            this.webgpu.context.configure({
                device: this.webgpu.device,
                format: this.webgpu.format,
                alphaMode: 'premultiplied',
            });
            this.ensureWebGPUSceneTexture();
            return;
        }

        if (this.ctx) {
            this.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        }
        this.seedSceneState();
    }

    getRenderPixelRatio() {
        const baseRatio = Number.isFinite(this.resolutionLock?.pixelRatio)
            ? this.resolutionLock.pixelRatio
            : this.getEffectivePixelRatio(2);
        const tierScale = Number.isFinite(this.phase7RenderScale)
            ? clamp(this.phase7RenderScale, 0.5, 1.0)
            : 1.0;
        return clamp(baseRatio * tierScale, 0.5, 2.0);
    }

    setResolutionLock(width, height, options = {}) {
        const targetWidth = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1920;
        const targetHeight = Number.isFinite(height) ? Math.max(1, Math.floor(height)) : 1080;
        const pixelRatio = Number.isFinite(options.pixelRatio)
            ? Math.max(0.5, Math.min(2, options.pixelRatio))
            : null;

        this.resolutionLock = {
            width: targetWidth,
            height: targetHeight,
            pixelRatio,
        };
        this.resizeCanvas();
        return this.getLogicalCanvasSize();
    }

    clearResolutionLock() {
        this.resolutionLock = null;
        this.resizeCanvas();
        return this.getLogicalCanvasSize();
    }

    getResolutionLock() {
        if (!this.resolutionLock) return null;
        return { ...this.resolutionLock };
    }

    ensureWebGPUSceneTexture() {
        const { webgpu, canvas } = this;
        if (!webgpu.device || !canvas || !canvas.width || !canvas.height) {
            return;
        }

        const width = Math.max(1, Math.floor(canvas.width));
        const height = Math.max(1, Math.floor(canvas.height));
        const needsRebuild = !webgpu.sceneTexture
            || webgpu.sceneTextureWidth !== width
            || webgpu.sceneTextureHeight !== height
            || !webgpu.depthTexture
            || webgpu.depthTextureWidth !== width
            || webgpu.depthTextureHeight !== height
            || !webgpu.postTexture
            || webgpu.postTextureWidth !== width
            || webgpu.postTextureHeight !== height;
        if (!needsRebuild) {
            return;
        }

        if (webgpu.sceneTexture && typeof webgpu.sceneTexture.destroy === 'function') {
            try {
                webgpu.sceneTexture.destroy();
            } catch {
                // ignore destroy issues; texture will be replaced.
            }
        }
        if (webgpu.postTexture && typeof webgpu.postTexture.destroy === 'function') {
            try {
                webgpu.postTexture.destroy();
            } catch {
                // ignore destroy issues; texture will be replaced.
            }
        }
        if (webgpu.depthTexture && typeof webgpu.depthTexture.destroy === 'function') {
            try {
                webgpu.depthTexture.destroy();
            } catch {
                // ignore destroy issues; texture will be replaced.
            }
        }
        webgpu.sceneTexture = null;
        webgpu.sceneTextureView = null;
        webgpu.depthTexture = null;
        webgpu.depthTextureView = null;
        webgpu.postTexture = null;
        webgpu.postTextureView = null;
        webgpu.postBindGroup = null;
        webgpu.presentBindGroup = null;

        const sceneTexture = webgpu.device.createTexture({
            label: 'sky-children/phase5-scene-color',
            size: {
                width,
                height,
                depthOrArrayLayers: 1,
            },
            format: webgpu.sceneFormat || webgpu.format,
            usage: GPU_TEXTURE_USAGE_RENDER_ATTACHMENT + GPU_TEXTURE_USAGE_TEXTURE_BINDING,
        });
        const sceneTextureView = sceneTexture.createView();
        const depthTexture = webgpu.device.createTexture({
            label: 'sky-children/phase5-scene-depth',
            size: {
                width,
                height,
                depthOrArrayLayers: 1,
            },
            format: webgpu.depthFormat || 'depth24plus',
            usage: GPU_TEXTURE_USAGE_RENDER_ATTACHMENT,
        });
        const depthTextureView = depthTexture.createView();
        const postTexture = webgpu.device.createTexture({
            label: 'sky-children/phase5-post-color',
            size: {
                width,
                height,
                depthOrArrayLayers: 1,
            },
            format: webgpu.format,
            usage: GPU_TEXTURE_USAGE_RENDER_ATTACHMENT + GPU_TEXTURE_USAGE_TEXTURE_BINDING + GPU_TEXTURE_USAGE_COPY_SRC,
        });
        const postTextureView = postTexture.createView();

        let postBindGroup = null;
        if (
            webgpu.postBindGroupLayout
            && webgpu.postSampler
            && webgpu.postUniformBuffer
        ) {
            postBindGroup = webgpu.device.createBindGroup({
                label: 'sky-children/phase5-post-bind-group',
                layout: webgpu.postBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: sceneTextureView,
                    },
                    {
                        binding: 1,
                        resource: webgpu.postSampler,
                    },
                    {
                        binding: 2,
                        resource: { buffer: webgpu.postUniformBuffer },
                    },
                ],
            });
        }
        let presentBindGroup = null;
        if (
            webgpu.presentBindGroupLayout
            && webgpu.postSampler
        ) {
            presentBindGroup = webgpu.device.createBindGroup({
                label: 'sky-children/phase5-present-bind-group',
                layout: webgpu.presentBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: postTextureView,
                    },
                    {
                        binding: 1,
                        resource: webgpu.postSampler,
                    },
                ],
            });
        }

        webgpu.sceneTexture = sceneTexture;
        webgpu.sceneTextureView = sceneTextureView;
        webgpu.depthTexture = depthTexture;
        webgpu.depthTextureView = depthTextureView;
        webgpu.postTexture = postTexture;
        webgpu.postTextureView = postTextureView;
        webgpu.postTextureWidth = width;
        webgpu.postTextureHeight = height;
        webgpu.sceneTextureWidth = width;
        webgpu.sceneTextureHeight = height;
        webgpu.depthTextureWidth = width;
        webgpu.depthTextureHeight = height;
        webgpu.postBindGroup = postBindGroup;
        webgpu.presentBindGroup = presentBindGroup;
    }

    setFoliageInstanceCount(instanceCount) {
        const next = Number.isFinite(instanceCount) ? Math.floor(instanceCount) : this.foliageState.instanceCount;
        this.foliageState.instanceCount = clamp(next, 256, 100000);
        return this.foliageState.instanceCount;
    }

    setPhase5PostState(overrides = {}) {
        const merged = {
            ...this.postState,
            ...(overrides && typeof overrides === 'object' ? overrides : {}),
        };
        this.postState = createSkyChildrenPhase5PostState(merged);
        return this.getPhase5PostState();
    }

    getPhase5PostState() {
        return {
            ...this.postState,
            shadowColor: [...this.postState.shadowColor],
            highlightColor: [...this.postState.highlightColor],
            midtoneColor: [...this.postState.midtoneColor],
        };
    }

    startAnimation() {
        const loop = (now) => {
            if (!this.isActive) return;

            if (!this.shouldRenderFrame()) {
                this.rafId = requestAnimationFrame(loop);
                this.registerAnimation(this.rafId);
                return;
            }

            if (!this.lastTime) {
                this.lastTime = now;
            }
            if (this.lastFramePresentTime > 0) {
                this.recordFrameIntervalSample(now - this.lastFramePresentTime);
            }
            this.lastFramePresentTime = now;
            const dt = clamp((now - this.lastTime) / 1000, 0.001, 0.033);
            this.lastTime = now;
            this.update(dt);
            this.render();

            this.rafId = requestAnimationFrame(loop);
            this.registerAnimation(this.rafId);
        };

        this.lastTime = 0;
        this.lastFramePresentTime = 0;
        this.rafId = requestAnimationFrame(loop);
        this.registerAnimation(this.rafId);
    }

    update(dt) {
        const { runtime } = this;
        runtime.time += dt;

        runtime.eventEnergy += (runtime.eventEnergyTarget - runtime.eventEnergy) * Math.min(1, dt * 5.5);
        runtime.comboEnergy += (runtime.comboEnergyTarget - runtime.comboEnergy) * Math.min(1, dt * 3.2);
        runtime.eventEnergyTarget *= Math.max(0, 1 - dt * 1.9);
        runtime.comboEnergyTarget *= Math.max(0, 1 - dt * 1.15);
        runtime.palettePhase += dt * 0.07;
        const cinematicX = (
            Math.sin(runtime.time * 0.038 + runtime.cameraPhaseX * 0.73) * 0.33
            + Math.sin(runtime.time * 0.082 + runtime.cameraPhaseX * 0.31) * 0.11
        );
        const cinematicY = (
            Math.sin(runtime.time * 0.029 + runtime.cameraPhaseY * 0.61) * 0.18
            + Math.cos(runtime.time * 0.061 + runtime.cameraPhaseY * 0.27) * 0.07
        );
        const reactiveWeight = 0.2 + runtime.comboEnergy * 0.48 + runtime.eventEnergy * 0.36;
        const reactiveX = (
            Math.sin(runtime.time * 0.12 + runtime.cameraPhaseX * 0.57) * 0.2
            + Math.sin(runtime.time * 0.24 + runtime.cameraPhaseX * 0.22) * 0.08
        ) * reactiveWeight;
        const reactiveY = (
            Math.sin(runtime.time * 0.14 + runtime.cameraPhaseY * 0.44) * 0.14
            + Math.cos(runtime.time * 0.21 + runtime.cameraPhaseY * 0.3) * 0.06
        ) * reactiveWeight;
        const dolly = Math.sin(runtime.time * 0.021 + runtime.cameraPhaseX * 0.17) * 0.09;
        const cameraTargetX = cinematicX * 0.62 + reactiveX;
        const cameraTargetY = cinematicY * 0.68 + reactiveY - dolly * 0.45;

        runtime.cameraOffsetX += (cameraTargetX - runtime.cameraOffsetX) * Math.min(1, dt * 1.8);
        runtime.cameraOffsetY += (cameraTargetY - runtime.cameraOffsetY) * Math.min(1, dt * 1.7);
        runtime.cameraOffsetX = clamp(runtime.cameraOffsetX, -0.6, 0.6);
        runtime.cameraOffsetY = clamp(runtime.cameraOffsetY, -0.45, 0.45);

        if (this.renderBackend !== 'canvas2d') {
            return;
        }

        const pixelRatio = this.getRenderPixelRatio();
        const width = this.canvas.width / pixelRatio;
        const height = this.canvas.height / pixelRatio;

        runtime.cloudLayers.forEach((layer, layerIndex) => {
            layer.clouds.forEach((cloud) => {
                cloud.x += cloud.drift * (1 + runtime.comboEnergy * 0.6) * 60 * dt;
                cloud.y += Math.sin(runtime.time * (0.2 + layer.depth * 0.35) + cloud.phase)
                    * layer.amplitude
                    * dt;

                const margin = cloud.radiusX * 1.2;
                if (cloud.x < -margin) cloud.x = width + margin;
                if (cloud.x > width + margin) cloud.x = -margin;

                const yMin = height * (0.12 + layerIndex * 0.12);
                const yMax = height * (0.72 + layer.depth * 0.08);
                cloud.y = clamp(cloud.y, yMin, yMax);
            });
        });

        runtime.motes.forEach((mote) => {
            mote.x += mote.vx * dt * (1 + runtime.comboEnergy * 0.4);
            mote.y += mote.vy * dt * (1 + runtime.eventEnergy * 0.5);
            mote.twinkle += dt * (0.8 + runtime.comboEnergy * 1.2);

            if (mote.y < -20) {
                mote.y = height + 12;
                mote.x = Math.random() * width;
            }
            if (mote.x < -20) mote.x = width + 10;
            if (mote.x > width + 20) mote.x = -10;
        });
    }

    render() {
        if (!this.canvas) return;
        if (this.renderBackend === 'webgpu') {
            this.renderWebGPU();
            return;
        }
        this.renderCanvas2D();
    }

    updateWebGPUUniforms() {
        const {
            runtime,
            lightingState,
            terrainState,
            cloudState,
            foliageState,
        } = this;
        const {
            light,
            shadow,
            specular,
            glitter,
            controls,
        } = lightingState;
        const [sunX, sunY, sunZ] = normalizeVec3(light.direction);

        const pixelRatio = this.getRenderPixelRatio();
        const width = this.canvas.width / pixelRatio;
        const height = this.canvas.height / pixelRatio;

        this.uniformData.fill(0);
        const data = this.uniformData;

        data[UNIFORM.resolutionTime + 0] = width;
        data[UNIFORM.resolutionTime + 1] = height;
        data[UNIFORM.resolutionTime + 2] = runtime.time;
        data[UNIFORM.resolutionTime + 3] = runtime.eventEnergy;

        data[UNIFORM.comboMisc + 0] = runtime.comboEnergy;
        data[UNIFORM.comboMisc + 1] = runtime.eventEnergy;
        data[UNIFORM.comboMisc + 2] = runtime.palettePhase;
        data[UNIFORM.comboMisc + 3] = runtime.cameraOffsetX;

        data[UNIFORM.sunDir + 0] = sunX;
        data[UNIFORM.sunDir + 1] = sunY;
        data[UNIFORM.sunDir + 2] = sunZ;

        data[UNIFORM.sunColorIntensity + 0] = light.color[0];
        data[UNIFORM.sunColorIntensity + 1] = light.color[1];
        data[UNIFORM.sunColorIntensity + 2] = light.color[2];
        data[UNIFORM.sunColorIntensity + 3] = light.intensity;

        data[UNIFORM.ambientColorIntensity + 0] = light.ambientColor[0];
        data[UNIFORM.ambientColorIntensity + 1] = light.ambientColor[1];
        data[UNIFORM.ambientColorIntensity + 2] = light.ambientColor[2];
        data[UNIFORM.ambientColorIntensity + 3] = light.ambientIntensity;

        data[UNIFORM.shadowTintBoost + 0] = shadow.tint[0];
        data[UNIFORM.shadowTintBoost + 1] = shadow.tint[1];
        data[UNIFORM.shadowTintBoost + 2] = shadow.tint[2];
        data[UNIFORM.shadowTintBoost + 3] = shadow.boost;

        data[UNIFORM.rimColorPower + 0] = specular.rimColor[0];
        data[UNIFORM.rimColorPower + 1] = specular.rimColor[1];
        data[UNIFORM.rimColorPower + 2] = specular.rimColor[2];
        data[UNIFORM.rimColorPower + 3] = specular.rimPower;

        data[UNIFORM.specParams + 0] = specular.rimStrength;
        data[UNIFORM.specParams + 1] = specular.oceanPower;
        data[UNIFORM.specParams + 2] = specular.oceanStrength;
        data[UNIFORM.specParams + 3] = glitter.threshold;

        data[UNIFORM.oceanColorGlitter + 0] = specular.oceanColor[0];
        data[UNIFORM.oceanColorGlitter + 1] = specular.oceanColor[1];
        data[UNIFORM.oceanColorGlitter + 2] = specular.oceanColor[2];
        data[UNIFORM.oceanColorGlitter + 3] = glitter.intensity;

        data[UNIFORM.controls + 0] = glitter.enabled ? 1 : 0;
        data[UNIFORM.controls + 1] = controls.yNormalCompression;
        data[UNIFORM.controls + 2] = controls.diffuseMultiplier;
        data[UNIFORM.controls + 3] = runtime.cameraOffsetY;

        data[UNIFORM.terrainColorRoughnessNear + 0] = terrainState.albedoWarm[0];
        data[UNIFORM.terrainColorRoughnessNear + 1] = terrainState.albedoWarm[1];
        data[UNIFORM.terrainColorRoughnessNear + 2] = terrainState.albedoWarm[2];
        data[UNIFORM.terrainColorRoughnessNear + 3] = terrainState.roughnessNear;

        data[UNIFORM.terrainCoolTriplanar + 0] = terrainState.albedoCool[0];
        data[UNIFORM.terrainCoolTriplanar + 1] = terrainState.albedoCool[1];
        data[UNIFORM.terrainCoolTriplanar + 2] = terrainState.albedoCool[2];
        data[UNIFORM.terrainCoolTriplanar + 3] = terrainState.triplanarScale;

        data[UNIFORM.terrainShadowNormal + 0] = terrainState.shadowColor[0];
        data[UNIFORM.terrainShadowNormal + 1] = terrainState.shadowColor[1];
        data[UNIFORM.terrainShadowNormal + 2] = terrainState.shadowColor[2];
        data[UNIFORM.terrainShadowNormal + 3] = terrainState.normalStrength;

        data[UNIFORM.terrainRippleRoughnessFar + 0] = terrainState.rippleScale;
        data[UNIFORM.terrainRippleRoughnessFar + 1] = terrainState.rippleSharpness;
        data[UNIFORM.terrainRippleRoughnessFar + 2] = terrainState.roughnessFar;
        data[UNIFORM.terrainRippleRoughnessFar + 3] = terrainState.shimmerSuppression;

        data[UNIFORM.terrainFalloffHeight + 0] = terrainState.roughnessFalloffStart;
        data[UNIFORM.terrainFalloffHeight + 1] = terrainState.roughnessFalloffEnd;
        data[UNIFORM.terrainFalloffHeight + 2] = terrainState.heightScale;
        data[UNIFORM.terrainFalloffHeight + 3] = terrainState.horizonLift;

        data[UNIFORM.cloudColorDensity + 0] = cloudState.litColor[0];
        data[UNIFORM.cloudColorDensity + 1] = cloudState.litColor[1];
        data[UNIFORM.cloudColorDensity + 2] = cloudState.litColor[2];
        data[UNIFORM.cloudColorDensity + 3] = cloudState.densityScale;

        data[UNIFORM.cloudShadowScatter + 0] = cloudState.shadowColor[0];
        data[UNIFORM.cloudShadowScatter + 1] = cloudState.shadowColor[1];
        data[UNIFORM.cloudShadowScatter + 2] = cloudState.shadowColor[2];
        data[UNIFORM.cloudShadowScatter + 3] = cloudState.scatterG;

        data[UNIFORM.cloudAmbientIntensity + 0] = cloudState.ambientColor[0];
        data[UNIFORM.cloudAmbientIntensity + 1] = cloudState.ambientColor[1];
        data[UNIFORM.cloudAmbientIntensity + 2] = cloudState.ambientColor[2];
        data[UNIFORM.cloudAmbientIntensity + 3] = cloudState.scatterIntensity;

        data[UNIFORM.cloudMotionOpacity + 0] = cloudState.noiseScale;
        data[UNIFORM.cloudMotionOpacity + 1] = cloudState.noiseSpeed;
        data[UNIFORM.cloudMotionOpacity + 2] = cloudState.edgeSoftness;
        data[UNIFORM.cloudMotionOpacity + 3] = cloudState.opacity;

        data[UNIFORM.cloudShapeSilver + 0] = cloudState.coverage;
        data[UNIFORM.cloudShapeSilver + 1] = cloudState.softness;
        data[UNIFORM.cloudShapeSilver + 2] = cloudState.silverStrength;
        data[UNIFORM.cloudShapeSilver + 3] = cloudState.silhouetteStrength;

        data[UNIFORM.foliageBaseVariation + 0] = foliageState.colorBase[0];
        data[UNIFORM.foliageBaseVariation + 1] = foliageState.colorBase[1];
        data[UNIFORM.foliageBaseVariation + 2] = foliageState.colorBase[2];
        data[UNIFORM.foliageBaseVariation + 3] = foliageState.colorVariation;

        data[UNIFORM.foliageTipSssIntensity + 0] = foliageState.colorTip[0];
        data[UNIFORM.foliageTipSssIntensity + 1] = foliageState.colorTip[1];
        data[UNIFORM.foliageTipSssIntensity + 2] = foliageState.colorTip[2];
        data[UNIFORM.foliageTipSssIntensity + 3] = foliageState.sssIntensity;

        data[UNIFORM.foliageSssColorDistortion + 0] = foliageState.sssColor[0];
        data[UNIFORM.foliageSssColorDistortion + 1] = foliageState.sssColor[1];
        data[UNIFORM.foliageSssColorDistortion + 2] = foliageState.sssColor[2];
        data[UNIFORM.foliageSssColorDistortion + 3] = foliageState.sssDistortion;

        data[UNIFORM.foliageShapeSss + 0] = foliageState.sssPower;
        data[UNIFORM.foliageShapeSss + 1] = foliageState.skyNormalBias;
        data[UNIFORM.foliageShapeSss + 2] = foliageState.alpha;
        data[UNIFORM.foliageShapeSss + 3] = foliageState.bladeHeight;

        data[UNIFORM.foliageWindPrimary + 0] = foliageState.windStrength;
        data[UNIFORM.foliageWindPrimary + 1] = foliageState.windFrequency;
        data[UNIFORM.foliageWindPrimary + 2] = foliageState.windDirection[0];
        data[UNIFORM.foliageWindPrimary + 3] = foliageState.windDirection[1];

        data[UNIFORM.foliageWindSecondary + 0] = foliageState.gustStrength;
        data[UNIFORM.foliageWindSecondary + 1] = foliageState.gustFrequency;
        data[UNIFORM.foliageWindSecondary + 2] = foliageState.microStrength;
        data[UNIFORM.foliageWindSecondary + 3] = foliageState.microFrequency;

        this.webgpu.device.queue.writeBuffer(
            this.webgpu.uniformBuffer,
            0,
            data.buffer,
            data.byteOffset,
            data.byteLength,
        );
        this.updateWebGPUPostUniforms(width, height);
    }

    updateWebGPUPostUniforms(width, height) {
        if (!this.webgpu.device || !this.webgpu.postUniformBuffer) {
            return;
        }

        const post = this.postState;
        const data = this.postUniformData;
        data.fill(0);

        data[POST_UNIFORM.resolutionTime + 0] = width;
        data[POST_UNIFORM.resolutionTime + 1] = height;
        data[POST_UNIFORM.resolutionTime + 2] = this.runtime.time;
        data[POST_UNIFORM.resolutionTime + 3] = this.runtime.eventEnergy;

        data[POST_UNIFORM.bloomParams + 0] = post.bloomThreshold;
        data[POST_UNIFORM.bloomParams + 1] = post.bloomSoftKnee;
        data[POST_UNIFORM.bloomParams + 2] = post.bloomBlend;
        data[POST_UNIFORM.bloomParams + 3] = post.bloomRadius;

        data[POST_UNIFORM.gradingParams + 0] = post.exposure;
        data[POST_UNIFORM.gradingParams + 1] = post.contrast;
        data[POST_UNIFORM.gradingParams + 2] = post.saturation;
        data[POST_UNIFORM.gradingParams + 3] = post.agxMix;

        data[POST_UNIFORM.shadowColorStrength + 0] = post.shadowColor[0];
        data[POST_UNIFORM.shadowColorStrength + 1] = post.shadowColor[1];
        data[POST_UNIFORM.shadowColorStrength + 2] = post.shadowColor[2];
        data[POST_UNIFORM.shadowColorStrength + 3] = post.shadowStrength;

        data[POST_UNIFORM.highlightColorStrength + 0] = post.highlightColor[0];
        data[POST_UNIFORM.highlightColorStrength + 1] = post.highlightColor[1];
        data[POST_UNIFORM.highlightColorStrength + 2] = post.highlightColor[2];
        data[POST_UNIFORM.highlightColorStrength + 3] = post.highlightStrength;

        data[POST_UNIFORM.midtoneColorStrength + 0] = post.midtoneColor[0];
        data[POST_UNIFORM.midtoneColorStrength + 1] = post.midtoneColor[1];
        data[POST_UNIFORM.midtoneColorStrength + 2] = post.midtoneColor[2];
        data[POST_UNIFORM.midtoneColorStrength + 3] = post.midtoneStrength;

        this.webgpu.device.queue.writeBuffer(
            this.webgpu.postUniformBuffer,
            0,
            data.buffer,
            data.byteOffset,
            data.byteLength,
        );
    }

    renderWebGPU() {
        const { webgpu } = this;
        if (!webgpu.device || !webgpu.context || !webgpu.pipeline || !webgpu.bindGroup) {
            this.disableWebGPUAndFallback();
            return;
        }

        const frameStartedAt = globalThis.performance?.now?.() ?? Date.now();
        try {
            this.updateWebGPUUniforms();
            this.ensureWebGPUSceneTexture();
            if (
                !webgpu.sceneTextureView
                || !webgpu.depthTextureView
                || !webgpu.postPipeline
                || !webgpu.postBindGroup
                || !webgpu.postTextureView
                || !webgpu.presentPipeline
                || !webgpu.presentBindGroup
            ) {
                throw new Error('Phase 5 post resources are unavailable');
            }

            const encoder = webgpu.device.createCommandEncoder({
                label: 'sky-children/phase6-encoder',
            });
            const timestampQuery = webgpu.timestampQuery;
            const canWriteTimestamps = Boolean(
                timestampQuery?.supported
                && timestampQuery.querySet
                && timestampQuery.resolveBuffer
                && timestampQuery.readBuffer
                && !timestampQuery.pending
                && !timestampQuery.reading,
            );

            const colorView = webgpu.sceneTextureView;
            const scenePassDescriptor = {
                colorAttachments: [
                    {
                        view: colorView,
                        clearValue: {
                            r: 0,
                            g: 0,
                            b: 0,
                            a: 1,
                        },
                        loadOp: 'clear',
                        storeOp: 'store',
                    },
                ],
                depthStencilAttachment: {
                    view: webgpu.depthTextureView,
                    depthClearValue: 1.0,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store',
                },
            };
            if (canWriteTimestamps) {
                scenePassDescriptor.timestampWrites = {
                    querySet: timestampQuery.querySet,
                    beginningOfPassWriteIndex: 0,
                    endOfPassWriteIndex: 1,
                };
            }
            const pass = encoder.beginRenderPass(scenePassDescriptor);

            pass.setPipeline(webgpu.pipeline);
            pass.setBindGroup(0, webgpu.bindGroup);
            pass.draw(3, 1, 0, 0);

            if (webgpu.foliagePipeline && webgpu.foliageBindGroup) {
                pass.setPipeline(webgpu.foliagePipeline);
                pass.setBindGroup(0, webgpu.foliageBindGroup);
                const instanceCount = Math.max(0, Math.floor(this.foliageState.instanceCount || 0));
                if (instanceCount > 0) {
                    pass.draw(6, instanceCount, 0, 0);
                }
            }

            // Flower pass — drawn after grass, blended on top
            if (webgpu.flowerPipeline && webgpu.bindGroup) {
                pass.setPipeline(webgpu.flowerPipeline);
                pass.setBindGroup(0, webgpu.bindGroup);
                // Flower count scales aggressively to avoid sparse meadow reads.
                const flowerCount = Math.max(0, Math.floor((this.foliageState.instanceCount || 0) * 0.62));
                if (flowerCount > 0) {
                    pass.draw(6, flowerCount, 0, 0);
                }
            }
            pass.end();

            const postStartedAt = globalThis.performance?.now?.() ?? Date.now();
            const postPassDescriptor = {
                colorAttachments: [
                    {
                        view: webgpu.postTextureView,
                        clearValue: {
                            r: 0,
                            g: 0,
                            b: 0,
                            a: 1,
                        },
                        loadOp: 'clear',
                        storeOp: 'store',
                    },
                ],
            };
            if (canWriteTimestamps) {
                postPassDescriptor.timestampWrites = {
                    querySet: timestampQuery.querySet,
                    beginningOfPassWriteIndex: 2,
                    endOfPassWriteIndex: 3,
                };
            }
            const postPass = encoder.beginRenderPass(postPassDescriptor);
            postPass.setPipeline(webgpu.postPipeline);
            postPass.setBindGroup(0, webgpu.postBindGroup);
            postPass.draw(3, 1, 0, 0);
            postPass.end();
            const postEndedAt = globalThis.performance?.now?.() ?? Date.now();
            const cpuPostMs = postEndedAt - postStartedAt;

            const swapchainView = webgpu.context.getCurrentTexture().createView();
            const presentPass = encoder.beginRenderPass({
                colorAttachments: [
                    {
                        view: swapchainView,
                        clearValue: {
                            r: 0,
                            g: 0,
                            b: 0,
                            a: 1,
                        },
                        loadOp: 'clear',
                        storeOp: 'store',
                    },
                ],
            });
            presentPass.setPipeline(webgpu.presentPipeline);
            presentPass.setBindGroup(0, webgpu.presentBindGroup);
            presentPass.draw(3, 1, 0, 0);
            presentPass.end();

            if (canWriteTimestamps) {
                encoder.resolveQuerySet(timestampQuery.querySet, 0, 4, timestampQuery.resolveBuffer, 0);
                encoder.copyBufferToBuffer(timestampQuery.resolveBuffer, 0, timestampQuery.readBuffer, 0, 32);
                timestampQuery.pending = true;
            } else {
                this.recordPhase5PostSample(cpuPostMs);
            }

            webgpu.device.queue.submit([encoder.finish()]);
            this.consumeTimestampQueryResults();
        } catch (error) {
            console.warn('[SkyChildrenTheme] WebGPU render failed, falling back to 2D:', error);
            this.disableWebGPUAndFallback();
        } finally {
            const frameEndedAt = globalThis.performance?.now?.() ?? Date.now();
            this.recordRenderSample(frameEndedAt - frameStartedAt);
        }
    }

    consumeTimestampQueryResults() {
        const { webgpu } = this;
        const timestampQuery = webgpu.timestampQuery;
        if (
            !timestampQuery?.supported
            || !timestampQuery.pending
            || timestampQuery.reading
            || !timestampQuery.readBuffer
            || typeof timestampQuery.readBuffer.mapAsync !== 'function'
        ) {
            return;
        }

        timestampQuery.reading = true;
        const readBuffer = timestampQuery.readBuffer;
        const queue = webgpu.device?.queue;
        let mapped = false;
        Promise.resolve()
            .then(() => (typeof queue?.onSubmittedWorkDone === 'function' ? queue.onSubmittedWorkDone() : null))
            .then(() => readBuffer.mapAsync(GPU_MAP_MODE_READ))
            .then(() => {
                const range = readBuffer.getMappedRange();
                mapped = true;
                const timestamps = new BigUint64Array(range.slice(0));
                if (timestamps.length < 4) {
                    return;
                }

                const sceneDelta = timestamps[1] > timestamps[0]
                    ? Number(timestamps[1] - timestamps[0])
                    : 0;
                const postDelta = timestamps[3] > timestamps[2]
                    ? Number(timestamps[3] - timestamps[2])
                    : 0;

                if (Number.isFinite(sceneDelta) && sceneDelta > 0) {
                    this.recordGpuTimestampSample(sceneDelta / 1_000_000);
                }
                if (Number.isFinite(postDelta) && postDelta > 0) {
                    const postMs = postDelta / 1_000_000;
                    this.recordGpuPostTimestampSample(postMs);
                    this.recordPhase5PostSample(postMs);
                }
            })
            .catch(() => {
                // Keep CPU fallback samples when timestamp readback is not available.
            })
            .finally(() => {
                if (mapped) {
                    try {
                        readBuffer.unmap();
                    } catch {
                        // no-op
                    }
                }
                timestampQuery.pending = false;
                timestampQuery.reading = false;
            });
    }

    renderCanvas2D() {
        if (!this.ctx || !this.canvas) return;

        const { ctx } = this;
        const pixelRatio = this.getRenderPixelRatio();
        const width = this.canvas.width / pixelRatio;
        const height = this.canvas.height / pixelRatio;
        const { runtime } = this;
        const pulse = runtime.eventEnergy;
        const combo = runtime.comboEnergy;
        const cameraShiftX = runtime.cameraOffsetX * width * 0.06;
        const cameraShiftY = runtime.cameraOffsetY * height * 0.04;

        ctx.clearRect(0, 0, width, height);

        const horizonShift = Math.sin(runtime.palettePhase) * 0.04 + combo * 0.05;
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        const topSky = [
            Math.floor(240 + pulse * 14),
            Math.floor(188 + pulse * 20),
            Math.floor(114 + pulse * 16),
        ];
        const midSky = [
            Math.floor(222 + combo * 18),
            Math.floor(150 + pulse * 22),
            Math.floor(101 + combo * 10),
        ];
        const lowSky = [
            Math.floor(116 + combo * 14),
            Math.floor(136 + pulse * 16),
            Math.floor(190 + combo * 12),
        ];
        const baseSky = [
            Math.floor(62 + combo * 8),
            Math.floor(73 + pulse * 10),
            Math.floor(123 + combo * 10),
        ];

        gradient.addColorStop(0.0, `rgba(${topSky[0]}, ${topSky[1]}, ${topSky[2]}, 1)`);
        gradient.addColorStop(0.38 + horizonShift, `rgba(${midSky[0]}, ${midSky[1]}, ${midSky[2]}, 1)`);
        gradient.addColorStop(0.72, `rgba(${lowSky[0]}, ${lowSky[1]}, ${lowSky[2]}, 1)`);
        gradient.addColorStop(1.0, `rgba(${baseSky[0]}, ${baseSky[1]}, ${baseSky[2]}, 1)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        const sunX = width * 0.78 + cameraShiftX * 0.25;
        const sunY = height * 0.23 + cameraShiftY * 0.15;
        const sunRadius = height * (0.16 + pulse * 0.04);
        const sunGradient = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunRadius);
        sunGradient.addColorStop(0.0, `rgba(255, 244, 220, ${0.48 + pulse * 0.2})`);
        sunGradient.addColorStop(0.55, `rgba(255, 205, 132, ${0.2 + combo * 0.14})`);
        sunGradient.addColorStop(1.0, 'rgba(255, 170, 110, 0)');
        ctx.fillStyle = sunGradient;
        ctx.fillRect(0, 0, width, height);

        runtime.cloudLayers.forEach((layer, index) => {
            const layerLight = 220 + index * 8;
            const layerBlue = 236 + index * 3;
            const layerAlpha = 0.07 + layer.depth * 0.08 + combo * 0.04;
            ctx.fillStyle = `rgba(${layerLight}, ${layerLight - 8}, ${layerBlue}, ${layerAlpha})`;

            layer.clouds.forEach((cloud) => {
                const drawX = cloud.x + cameraShiftX * (0.24 + layer.depth * 0.82);
                const drawY = cloud.y + cameraShiftY * (0.18 + layer.depth * 0.66);
                const cloudGradient = ctx.createRadialGradient(
                    drawX,
                    drawY,
                    cloud.radiusY * 0.1,
                    drawX,
                    drawY,
                    cloud.radiusX,
                );
                cloudGradient.addColorStop(0, `rgba(255, 248, 236, ${cloud.alpha + combo * 0.06})`);
                cloudGradient.addColorStop(1, 'rgba(236, 230, 248, 0)');
                ctx.fillStyle = cloudGradient;
                ctx.beginPath();
                ctx.ellipse(drawX, drawY, cloud.radiusX, cloud.radiusY, 0, 0, Math.PI * 2);
                ctx.fill();
            });
        });

        ctx.fillStyle = `rgba(250, 236, 215, ${0.1 + pulse * 0.07})`;
        ctx.fillRect(0, height * 0.62, width, height * 0.28);

        runtime.motes.forEach((mote) => {
            const flicker = 0.75 + Math.sin(mote.twinkle) * 0.25;
            const alpha = mote.alpha * flicker * (1 + pulse * 0.5);
            ctx.fillStyle = `rgba(255, 248, 225, ${alpha})`;
            ctx.beginPath();
            ctx.arc(
                mote.x + cameraShiftX * 0.38,
                mote.y + cameraShiftY * 0.28,
                mote.size * (1 + combo * 0.25),
                0,
                Math.PI * 2,
            );
            ctx.fill();
        });

        const haze = ctx.createLinearGradient(0, height * (0.3 + runtime.cameraOffsetY * 0.03), 0, height);
        haze.addColorStop(0, `rgba(196, 208, 236, ${0.02 + combo * 0.02})`);
        haze.addColorStop(1, `rgba(126, 140, 186, ${0.2 + pulse * 0.08})`);
        ctx.fillStyle = haze;
        ctx.fillRect(0, height * 0.3, width, height * 0.7);
    }

    getLogicalCanvasSize() {
        if (!this.canvas) {
            return {
                width: 0,
                height: 0,
                pixelRatio: 1,
            };
        }
        const pixelRatio = this.getRenderPixelRatio();
        return {
            width: Math.max(0, this.canvas.width / pixelRatio),
            height: Math.max(0, this.canvas.height / pixelRatio),
            pixelRatio,
        };
    }

    waitForMs(durationMs) {
        const delayMs = Number.isFinite(durationMs) ? Math.max(0, Math.floor(durationMs)) : 0;
        return new Promise((resolve) => {
            const timeoutId = window.setTimeout(() => {
                this.pendingAsyncTimeouts.delete(timeoutId);
                resolve();
            }, delayMs);
            this.pendingAsyncTimeouts.add(timeoutId);
        });
    }

    clearPendingAsyncTimeouts() {
        this.pendingAsyncTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
        this.pendingAsyncTimeouts.clear();
    }

    recordRenderSample(durationMs) {
        if (!Number.isFinite(durationMs) || durationMs < 0) {
            return;
        }
        const size = this.getLogicalCanvasSize();
        const sample = {
            ms: durationMs,
            width: size.width,
            height: size.height,
            pixelRatio: size.pixelRatio,
            generatedAt: Date.now(),
        };
        const samples = this.performanceSamples;
        samples.push(sample);
        if (samples.length > this.maxPerformanceSamples) {
            samples.splice(0, samples.length - this.maxPerformanceSamples);
        }
    }

    recordFrameIntervalSample(durationMs) {
        if (!Number.isFinite(durationMs) || durationMs <= 0) {
            return;
        }
        const size = this.getLogicalCanvasSize();
        const sample = {
            ms: durationMs,
            width: size.width,
            height: size.height,
            pixelRatio: size.pixelRatio,
            generatedAt: Date.now(),
        };
        const samples = this.frameIntervalSamples;
        samples.push(sample);
        if (samples.length > this.maxFrameIntervalSamples) {
            samples.splice(0, samples.length - this.maxFrameIntervalSamples);
        }
    }

    recordGpuTimestampSample(durationMs) {
        if (!Number.isFinite(durationMs) || durationMs < 0) {
            return;
        }
        const size = this.getLogicalCanvasSize();
        const sample = {
            ms: durationMs,
            width: size.width,
            height: size.height,
            pixelRatio: size.pixelRatio,
            generatedAt: Date.now(),
        };
        const samples = this.gpuTimestampSamples;
        samples.push(sample);
        if (samples.length > this.maxGpuTimestampSamples) {
            samples.splice(0, samples.length - this.maxGpuTimestampSamples);
        }
    }

    recordGpuPostTimestampSample(durationMs) {
        if (!Number.isFinite(durationMs) || durationMs < 0) {
            return;
        }
        const size = this.getLogicalCanvasSize();
        const sample = {
            ms: durationMs,
            width: size.width,
            height: size.height,
            pixelRatio: size.pixelRatio,
            generatedAt: Date.now(),
        };
        const samples = this.gpuPostTimestampSamples;
        samples.push(sample);
        if (samples.length > this.maxGpuPostTimestampSamples) {
            samples.splice(0, samples.length - this.maxGpuPostTimestampSamples);
        }
    }

    recordPhase5PostSample(durationMs) {
        if (!Number.isFinite(durationMs) || durationMs < 0) {
            return;
        }
        const size = this.getLogicalCanvasSize();
        const sample = {
            ms: durationMs,
            width: size.width,
            height: size.height,
            pixelRatio: size.pixelRatio,
            generatedAt: Date.now(),
        };
        const samples = this.phase5PostSamples;
        samples.push(sample);
        if (samples.length > this.maxPhase5PostSamples) {
            samples.splice(0, samples.length - this.maxPhase5PostSamples);
        }
    }

    recordPhase1RenderSample(durationMs) {
        this.recordRenderSample(durationMs);
    }

    collectScopedSamples(samples, size, sampleCount) {
        const list = Array.isArray(samples) ? samples : [];
        const targetPixelRatio = Number.isFinite(size?.pixelRatio) ? size.pixelRatio : null;
        return list
            .filter((entry) => {
                if (entry.width !== size.width || entry.height !== size.height) {
                    return false;
                }
                if (targetPixelRatio == null || !Number.isFinite(entry.pixelRatio)) {
                    return true;
                }
                return Math.abs(entry.pixelRatio - targetPixelRatio) <= 0.005;
            })
            .slice(-sampleCount);
    }

    selectSceneTimingSampleSet(size, sampleCount) {
        const gpu = this.collectScopedSamples(this.gpuTimestampSamples, size, sampleCount);
        const minimumPreferred = Math.min(sampleCount, 45);
        if (gpu.length >= minimumPreferred) {
            return {
                method: 'gpu-timestamp-scene-pass',
                samples: gpu,
            };
        }
        return {
            method: 'cpu-pass-time',
            samples: this.collectScopedSamples(this.performanceSamples, size, sampleCount),
        };
    }

    selectPostTimingSampleSet(size, sampleCount) {
        const gpu = this.collectScopedSamples(this.gpuPostTimestampSamples, size, sampleCount);
        const minimumPreferred = Math.min(sampleCount, 45);
        if (gpu.length >= minimumPreferred) {
            return {
                method: 'gpu-timestamp-post-pass',
                samples: gpu,
            };
        }
        return {
            method: 'cpu-post-pass-time',
            samples: this.collectScopedSamples(this.phase5PostSamples, size, sampleCount),
        };
    }

    selectFrameTimingSampleSet(size, sampleCount) {
        const frameIntervals = this.collectScopedSamples(this.frameIntervalSamples, size, sampleCount);
        if (frameIntervals.length > 0) {
            return {
                method: 'frame-present-interval',
                samples: frameIntervals,
            };
        }
        return {
            method: 'cpu-pass-time-fallback',
            samples: this.collectScopedSamples(this.performanceSamples, size, sampleCount),
        };
    }

    getPhase1VisualSignals() {
        const { light, shadow, specular } = this.lightingState;
        const sunLitColor = [
            light.color[0] * light.intensity,
            light.color[1] * light.intensity,
            light.color[2] * light.intensity,
        ];
        const shadowCompositeColor = [
            shadow.tint[0] * light.ambientColor[0] * light.ambientIntensity,
            shadow.tint[1] * light.ambientColor[1] * light.ambientIntensity,
            shadow.tint[2] * light.ambientColor[2] * light.ambientIntensity,
        ];
        const rimAt = (nDotV) => Math.pow(clamp(1 - nDotV, 0, 1), specular.rimPower) * specular.rimStrength;

        return {
            sunLitColor,
            shadowCompositeColor,
            shadowCompositeFloor: Math.min(...shadowCompositeColor),
            warmDominance: sunLitColor[0] - sunLitColor[2],
            coolDominance: shadowCompositeColor[2] - shadowCompositeColor[0],
            warmCoolDistance: Math.hypot(
                sunLitColor[0] - shadowCompositeColor[0],
                sunLitColor[1] - shadowCompositeColor[1],
                sunLitColor[2] - shadowCompositeColor[2],
            ),
            rimNear: rimAt(0.22),
            rimMid: rimAt(0.48),
            rimFar: rimAt(0.68),
        };
    }

    evaluatePhase1VisualGate(options = {}) {
        const thresholds = {
            noBlackShadowFloor: Number.isFinite(options.noBlackShadowFloor)
                ? clamp(options.noBlackShadowFloor, 0, 1)
                : 0.03,
            rimNearMin: Number.isFinite(options.rimNearMin) ? Math.max(0, options.rimNearMin) : 0.06,
            rimMidMin: Number.isFinite(options.rimMidMin) ? Math.max(0, options.rimMidMin) : 0.025,
            rimFarMin: Number.isFinite(options.rimFarMin) ? Math.max(0, options.rimFarMin) : 0.006,
            warmCoolDistanceMin: Number.isFinite(options.warmCoolDistanceMin)
                ? Math.max(0, options.warmCoolDistanceMin)
                : 0.2,
        };

        const signals = this.getPhase1VisualSignals();
        const noBlackShadows = signals.shadowCompositeFloor >= thresholds.noBlackShadowFloor;
        const rimSeparation = signals.rimNear >= thresholds.rimNearMin
            && signals.rimMid >= thresholds.rimMidMin
            && signals.rimFar >= thresholds.rimFarMin;
        const warmCoolSplit = signals.warmDominance > 0
            && signals.coolDominance > 0
            && signals.warmCoolDistance >= thresholds.warmCoolDistanceMin;
        const pass = noBlackShadows && rimSeparation && warmCoolSplit;

        const report = {
            generatedAt: new Date().toISOString(),
            gate: 'Phase 1 visual gate',
            criteria: [
                'No black shadows',
                'Silhouette rim separation visible at 3 distances',
                'Warm/cool split approved',
            ],
            thresholds,
            signals,
            checks: {
                noBlackShadows,
                rimSeparation,
                warmCoolSplit,
            },
            pass,
        };

        this.phase1Validation.lastVisualGate = report;
        return report;
    }

    capturePhase1Snapshot(label = 'snapshot') {
        const { runtime, lightingState } = this;
        const size = this.getLogicalCanvasSize();
        const snapshot = {
            label,
            generatedAt: new Date().toISOString(),
            backend: this.renderBackend,
            isActive: this.isActive === true,
            canvas: size,
            runtime: {
                time: runtime.time,
                eventEnergy: runtime.eventEnergy,
                comboEnergy: runtime.comboEnergy,
                palettePhase: runtime.palettePhase,
                cameraOffsetX: runtime.cameraOffsetX,
                cameraOffsetY: runtime.cameraOffsetY,
            },
            lighting: {
                light: {
                    direction: [...lightingState.light.direction],
                    color: [...lightingState.light.color],
                    intensity: lightingState.light.intensity,
                    ambientColor: [...lightingState.light.ambientColor],
                    ambientIntensity: lightingState.light.ambientIntensity,
                },
                shadow: {
                    tint: [...lightingState.shadow.tint],
                    boost: lightingState.shadow.boost,
                },
                specular: {
                    rimPower: lightingState.specular.rimPower,
                    rimStrength: lightingState.specular.rimStrength,
                    rimColor: [...lightingState.specular.rimColor],
                    oceanPower: lightingState.specular.oceanPower,
                    oceanStrength: lightingState.specular.oceanStrength,
                    oceanColor: [...lightingState.specular.oceanColor],
                },
                glitter: {
                    threshold: lightingState.glitter.threshold,
                    intensity: lightingState.glitter.intensity,
                    color: [...lightingState.glitter.color],
                    enabled: lightingState.glitter.enabled,
                },
                controls: {
                    yNormalCompression: lightingState.controls.yNormalCompression,
                    diffuseMultiplier: lightingState.controls.diffuseMultiplier,
                },
            },
            visualSignals: this.getPhase1VisualSignals(),
            heroShotChecklist: [...SKY_CHILDREN_PHASE1_HERO_SHOTS],
        };

        const snapshots = this.phase1Validation.snapshots;
        snapshots.push(snapshot);
        if (snapshots.length > this.phase1Validation.maxSnapshots) {
            snapshots.splice(0, snapshots.length - this.phase1Validation.maxSnapshots);
        }
        return snapshot;
    }

    async runPhase1PerformanceGate(options = {}) {
        const targetMs = Number.isFinite(options.targetMs) ? Math.max(0.05, options.targetMs) : 0.5;
        const sampleCount = Number.isFinite(options.sampleCount)
            ? Math.max(10, Math.floor(options.sampleCount))
            : 120;
        const minimumSamples = Number.isFinite(options.minimumSamples)
            ? Math.max(5, Math.floor(options.minimumSamples))
            : Math.min(sampleCount, 45);
        const settleMs = Number.isFinite(options.settleMs) ? Math.max(0, options.settleMs) : 700;
        const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(250, options.timeoutMs) : 5000;
        const requiredWidth = Number.isFinite(options.requiredWidth) ? Math.max(1, options.requiredWidth) : 1920;
        const requiredHeight = Number.isFinite(options.requiredHeight) ? Math.max(1, options.requiredHeight) : 1080;
        const strictResolution = options.strictResolution !== false;

        if (this.renderBackend !== 'webgpu') {
            const report = {
                generatedAt: new Date().toISOString(),
                gate: 'Phase 1 performance gate',
                method: 'cpu-pass-time',
                reason: 'WebGPU backend is not active.',
                targetMs,
                pass: false,
            };
            this.phase1Validation.lastPerformanceGate = report;
            return report;
        }

        if (settleMs > 0) {
            await this.waitForMs(settleMs);
        }

        const size = this.getLogicalCanvasSize();
        const collectSamples = () => this.selectSceneTimingSampleSet(size, sampleCount);

        let scopedSampleSet = collectSamples();
        const waitStartedAt = globalThis.performance?.now?.() ?? Date.now();
        while (scopedSampleSet.samples.length < sampleCount) {
            const now = globalThis.performance?.now?.() ?? Date.now();
            if ((now - waitStartedAt) >= timeoutMs) {
                break;
            }
            await this.waitForMs(34);
            scopedSampleSet = collectSamples();
        }

        const sampleDurations = scopedSampleSet.samples.map((entry) => entry.ms);
        const averageMs = average(sampleDurations);
        const p95Ms = percentile(sampleDurations, 0.95);
        const maxMs = sampleDurations.length ? Math.max(...sampleDurations) : 0;
        const minMs = sampleDurations.length ? Math.min(...sampleDurations) : 0;
        const hasEnoughSamples = sampleDurations.length >= minimumSamples;
        const resolutionPass = size.width >= requiredWidth && size.height >= requiredHeight;
        const pass = hasEnoughSamples
            && averageMs <= targetMs
            && (!strictResolution || resolutionPass);

        const report = {
            generatedAt: new Date().toISOString(),
            gate: 'Phase 1 performance gate',
            method: scopedSampleSet.method,
            targetMs,
            sampleCount: sampleDurations.length,
            minimumSamples,
            hasEnoughSamples,
            averageMs,
            p95Ms,
            maxMs,
            minMs,
            resolution: {
                width: size.width,
                height: size.height,
                pixelRatio: size.pixelRatio,
            },
            requiredResolution: {
                width: requiredWidth,
                height: requiredHeight,
                strict: strictResolution,
            },
            resolutionPass,
            pass,
        };

        this.phase1Validation.lastPerformanceGate = report;
        return report;
    }

    async runPhase1Validation(options = {}) {
        const snapshot = this.capturePhase1Snapshot(options.snapshotLabel || 'phase1-validation');
        const visualGate = this.evaluatePhase1VisualGate(options.visual || {});
        const performanceGate = await this.runPhase1PerformanceGate(options.performance || {});
        const report = {
            generatedAt: new Date().toISOString(),
            phase: 'phase1',
            deliverable: 'Stylized lighting core',
            visualGate,
            performanceGate,
            snapshot,
            heroShotChecklist: [...SKY_CHILDREN_PHASE1_HERO_SHOTS],
            pass: visualGate.pass && performanceGate.pass,
        };
        this.phase1Validation.lastReport = report;
        return report;
    }

    getPhase2TerrainSignals() {
        const terrain = this.terrainState;
        const falloffSpan = Math.max(0, terrain.roughnessFalloffEnd - terrain.roughnessFalloffStart);
        const roughnessDelta = terrain.roughnessFar - terrain.roughnessNear;
        const nearDetail = 1.0;
        const farDetail = 1.0 - clamp(roughnessDelta, 0, 1) * terrain.shimmerSuppression;
        const steepSlopeResponse = Math.pow(0.22, Math.max(0.5, terrain.rippleSharpness * 0.25));

        return {
            triplanarScale: terrain.triplanarScale,
            normalStrength: terrain.normalStrength,
            rippleScale: terrain.rippleScale,
            rippleSharpness: terrain.rippleSharpness,
            roughnessNear: terrain.roughnessNear,
            roughnessFar: terrain.roughnessFar,
            roughnessDelta,
            roughnessFalloffStart: terrain.roughnessFalloffStart,
            roughnessFalloffEnd: terrain.roughnessFalloffEnd,
            falloffSpan,
            shimmerSuppression: terrain.shimmerSuppression,
            nearDetail,
            farDetail,
            steepSlopeResponse,
        };
    }

    evaluatePhase2VisualGate(options = {}) {
        const thresholds = {
            triplanarScaleMin: Number.isFinite(options.triplanarScaleMin) ? Math.max(0, options.triplanarScaleMin) : 0.02,
            normalStrengthMin: Number.isFinite(options.normalStrengthMin) ? Math.max(0, options.normalStrengthMin) : 0.15,
            rippleScaleMin: Number.isFinite(options.rippleScaleMin) ? Math.max(0, options.rippleScaleMin) : 2.0,
            rippleSharpnessMin: Number.isFinite(options.rippleSharpnessMin) ? Math.max(0, options.rippleSharpnessMin) : 2.0,
            roughnessDeltaMin: Number.isFinite(options.roughnessDeltaMin) ? Math.max(0, options.roughnessDeltaMin) : 0.1,
            falloffSpanMin: Number.isFinite(options.falloffSpanMin) ? Math.max(0, options.falloffSpanMin) : 20,
            shimmerSuppressionMin: Number.isFinite(options.shimmerSuppressionMin)
                ? Math.max(0, options.shimmerSuppressionMin)
                : 0.3,
            farDetailMax: Number.isFinite(options.farDetailMax) ? Math.max(0, options.farDetailMax) : 0.85,
        };

        const signals = this.getPhase2TerrainSignals();
        const triplanarActive = signals.triplanarScale >= thresholds.triplanarScaleMin
            && signals.normalStrength >= thresholds.normalStrengthMin;
        const steepSlopeCoverage = signals.rippleScale >= thresholds.rippleScaleMin
            && signals.rippleSharpness >= thresholds.rippleSharpnessMin;
        const distanceStability = signals.roughnessDelta >= thresholds.roughnessDeltaMin
            && signals.falloffSpan >= thresholds.falloffSpanMin
            && signals.shimmerSuppression >= thresholds.shimmerSuppressionMin
            && signals.farDetail <= thresholds.farDetailMax;
        const pass = triplanarActive && steepSlopeCoverage && distanceStability;

        const report = {
            generatedAt: new Date().toISOString(),
            gate: 'Phase 2 visual gate',
            criteria: [
                'No visible UV stretching on steep slopes (tri-planar active)',
                'Distant terrain stable without noisy shimmer',
            ],
            thresholds,
            signals,
            checks: {
                triplanarActive,
                steepSlopeCoverage,
                distanceStability,
            },
            pass,
        };

        this.phase2Validation.lastVisualGate = report;
        return report;
    }

    capturePhase2Snapshot(label = 'snapshot') {
        const size = this.getLogicalCanvasSize();
        const snapshot = {
            label,
            generatedAt: new Date().toISOString(),
            backend: this.renderBackend,
            isActive: this.isActive === true,
            canvas: size,
            resolutionLock: this.getResolutionLock(),
            terrain: { ...this.terrainState },
            terrainSignals: this.getPhase2TerrainSignals(),
            heroShotChecklist: [...SKY_CHILDREN_PHASE2_HERO_SHOTS],
        };

        const snapshots = this.phase2Validation.snapshots;
        snapshots.push(snapshot);
        if (snapshots.length > this.phase2Validation.maxSnapshots) {
            snapshots.splice(0, snapshots.length - this.phase2Validation.maxSnapshots);
        }
        return snapshot;
    }

    async runPhase2PerformanceGate(options = {}) {
        const targetMs = Number.isFinite(options.targetMs) ? Math.max(0.05, options.targetMs) : 2.0;
        const sampleCount = Number.isFinite(options.sampleCount)
            ? Math.max(10, Math.floor(options.sampleCount))
            : 150;
        const minimumSamples = Number.isFinite(options.minimumSamples)
            ? Math.max(5, Math.floor(options.minimumSamples))
            : Math.min(sampleCount, 60);
        const settleMs = Number.isFinite(options.settleMs) ? Math.max(0, options.settleMs) : 700;
        const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(250, options.timeoutMs) : 5000;
        const requiredWidth = Number.isFinite(options.requiredWidth) ? Math.max(1, options.requiredWidth) : 1920;
        const requiredHeight = Number.isFinite(options.requiredHeight) ? Math.max(1, options.requiredHeight) : 1080;
        const strictResolution = options.strictResolution !== false;

        if (this.renderBackend !== 'webgpu') {
            const report = {
                generatedAt: new Date().toISOString(),
                gate: 'Phase 2 performance gate',
                method: 'cpu-pass-time',
                reason: 'WebGPU backend is not active.',
                targetMs,
                pass: false,
            };
            this.phase2Validation.lastPerformanceGate = report;
            return report;
        }

        if (settleMs > 0) {
            await this.waitForMs(settleMs);
        }

        const size = this.getLogicalCanvasSize();
        const collectSamples = () => this.selectSceneTimingSampleSet(size, sampleCount);

        let scopedSampleSet = collectSamples();
        const waitStartedAt = globalThis.performance?.now?.() ?? Date.now();
        while (scopedSampleSet.samples.length < sampleCount) {
            const now = globalThis.performance?.now?.() ?? Date.now();
            if ((now - waitStartedAt) >= timeoutMs) {
                break;
            }
            await this.waitForMs(34);
            scopedSampleSet = collectSamples();
        }

        const sampleDurations = scopedSampleSet.samples.map((entry) => entry.ms);
        const averageMs = average(sampleDurations);
        const p95Ms = percentile(sampleDurations, 0.95);
        const maxMs = sampleDurations.length ? Math.max(...sampleDurations) : 0;
        const minMs = sampleDurations.length ? Math.min(...sampleDurations) : 0;
        const hasEnoughSamples = sampleDurations.length >= minimumSamples;
        const resolutionPass = size.width >= requiredWidth && size.height >= requiredHeight;
        const pass = hasEnoughSamples
            && averageMs <= targetMs
            && (!strictResolution || resolutionPass);

        const report = {
            generatedAt: new Date().toISOString(),
            gate: 'Phase 2 performance gate',
            method: scopedSampleSet.method,
            targetMs,
            sampleCount: sampleDurations.length,
            minimumSamples,
            hasEnoughSamples,
            averageMs,
            p95Ms,
            maxMs,
            minMs,
            resolution: {
                width: size.width,
                height: size.height,
                pixelRatio: size.pixelRatio,
            },
            requiredResolution: {
                width: requiredWidth,
                height: requiredHeight,
                strict: strictResolution,
            },
            resolutionPass,
            pass,
        };

        this.phase2Validation.lastPerformanceGate = report;
        return report;
    }

    async runPhase2Validation(options = {}) {
        const snapshot = this.capturePhase2Snapshot(options.snapshotLabel || 'phase2-validation');
        const visualGate = this.evaluatePhase2VisualGate(options.visual || {});
        const performanceGate = await this.runPhase2PerformanceGate(options.performance || {});
        const report = {
            generatedAt: new Date().toISOString(),
            phase: 'phase2',
            deliverable: 'Terrain pass',
            visualGate,
            performanceGate,
            snapshot,
            heroShotChecklist: [...SKY_CHILDREN_PHASE2_HERO_SHOTS],
            pass: visualGate.pass && performanceGate.pass,
        };
        this.phase2Validation.lastReport = report;
        return report;
    }

    getPhase3CloudSignals() {
        const cloud = this.cloudState;
        const lit = cloud.litColor;
        const shadow = cloud.shadowColor;
        const ambient = cloud.ambientColor;
        const skyReference = [0.73, 0.78, 0.9];

        const henyeyGreenstein = (cosTheta, g) => {
            const anisotropy = clamp(g, -0.95, 0.95);
            const g2 = anisotropy * anisotropy;
            const denom = Math.max(1 + g2 - 2 * anisotropy * cosTheta, 0.001);
            return (1 - g2) / (4 * Math.PI * Math.pow(denom, 1.5));
        };

        const silhouetteContrast = Math.hypot(
            lit[0] - shadow[0],
            lit[1] - shadow[1],
            lit[2] - shadow[2],
        );
        const skyCloudContrast = Math.hypot(
            lit[0] - skyReference[0],
            lit[1] - skyReference[1],
            lit[2] - skyReference[2],
        );
        const ambientShadowDistance = Math.hypot(
            ambient[0] - shadow[0],
            ambient[1] - shadow[1],
            ambient[2] - shadow[2],
        );
        const silhouetteReadability = silhouetteContrast * cloud.opacity * cloud.silhouetteStrength;

        const silverPeak = henyeyGreenstein(0.98, cloud.scatterG)
            * cloud.scatterIntensity
            * cloud.silverStrength;
        const silverMid = henyeyGreenstein(0.75, cloud.scatterG)
            * cloud.scatterIntensity
            * cloud.silverStrength;
        const silverRatio = silverPeak / Math.max(silverMid, 0.0001);

        return {
            silhouetteContrast,
            skyCloudContrast,
            ambientShadowDistance,
            silhouetteReadability,
            silverPeak,
            silverMid,
            silverRatio,
            scatterG: cloud.scatterG,
            scatterIntensity: cloud.scatterIntensity,
            opacity: cloud.opacity,
            coverage: cloud.coverage,
            edgeSoftness: cloud.edgeSoftness,
            densityScale: cloud.densityScale,
            noiseScale: cloud.noiseScale,
        };
    }

    evaluatePhase3VisualGate(options = {}) {
        const thresholds = {
            silhouetteContrastMin: Number.isFinite(options.silhouetteContrastMin)
                ? Math.max(0, options.silhouetteContrastMin)
                : 0.18,
            silhouetteReadabilityMin: Number.isFinite(options.silhouetteReadabilityMin)
                ? Math.max(0, options.silhouetteReadabilityMin)
                : 0.14,
            skyCloudContrastMin: Number.isFinite(options.skyCloudContrastMin)
                ? Math.max(0, options.skyCloudContrastMin)
                : 0.1,
            scatterGMin: Number.isFinite(options.scatterGMin) ? options.scatterGMin : 0.3,
            silverPeakMin: Number.isFinite(options.silverPeakMin)
                ? Math.max(0, options.silverPeakMin)
                : 0.35,
            silverRatioMin: Number.isFinite(options.silverRatioMin)
                ? Math.max(1, options.silverRatioMin)
                : 1.2,
            opacityMin: Number.isFinite(options.opacityMin) ? clamp(options.opacityMin, 0, 1) : 0.45,
            coverageMin: Number.isFinite(options.coverageMin) ? clamp(options.coverageMin, 0, 1) : 0.2,
            coverageMax: Number.isFinite(options.coverageMax) ? clamp(options.coverageMax, 0, 1) : 0.85,
            edgeSoftnessMin: Number.isFinite(options.edgeSoftnessMin)
                ? Math.max(0, options.edgeSoftnessMin)
                : 0.05,
            edgeSoftnessMax: Number.isFinite(options.edgeSoftnessMax)
                ? Math.max(0, options.edgeSoftnessMax)
                : 0.5,
        };

        const signals = this.getPhase3CloudSignals();
        const silhouetteReadability = signals.silhouetteContrast >= thresholds.silhouetteContrastMin
            && signals.silhouetteReadability >= thresholds.silhouetteReadabilityMin
            && signals.skyCloudContrast >= thresholds.skyCloudContrastMin;
        const silverLiningBehavior = signals.scatterG >= thresholds.scatterGMin
            && signals.silverPeak >= thresholds.silverPeakMin
            && signals.silverRatio >= thresholds.silverRatioMin;
        const cloudShapeContinuity = signals.opacity >= thresholds.opacityMin
            && signals.coverage >= thresholds.coverageMin
            && signals.coverage <= thresholds.coverageMax
            && signals.edgeSoftness >= thresholds.edgeSoftnessMin
            && signals.edgeSoftness <= thresholds.edgeSoftnessMax
            && signals.densityScale > 0;
        const pass = silhouetteReadability && silverLiningBehavior && cloudShapeContinuity;

        const report = {
            generatedAt: new Date().toISOString(),
            gate: 'Phase 3 visual gate',
            criteria: [
                'Hero cloud silhouettes read clearly against sky',
                'Backlit silver-lining behavior passes reference check',
            ],
            thresholds,
            signals,
            checks: {
                silhouetteReadability,
                silverLiningBehavior,
                cloudShapeContinuity,
            },
            pass,
        };

        this.phase3Validation.lastVisualGate = report;
        return report;
    }

    capturePhase3Snapshot(label = 'snapshot') {
        const size = this.getLogicalCanvasSize();
        const snapshot = {
            label,
            generatedAt: new Date().toISOString(),
            backend: this.renderBackend,
            isActive: this.isActive === true,
            canvas: size,
            resolutionLock: this.getResolutionLock(),
            cloud: { ...this.cloudState },
            cloudSignals: this.getPhase3CloudSignals(),
            heroShotChecklist: [...SKY_CHILDREN_PHASE3_HERO_SHOTS],
        };

        const snapshots = this.phase3Validation.snapshots;
        snapshots.push(snapshot);
        if (snapshots.length > this.phase3Validation.maxSnapshots) {
            snapshots.splice(0, snapshots.length - this.phase3Validation.maxSnapshots);
        }
        return snapshot;
    }

    async runPhase3PerformanceGate(options = {}) {
        const targetMs = Number.isFinite(options.targetMs) ? Math.max(0.05, options.targetMs) : 2.5;
        const sampleCount = Number.isFinite(options.sampleCount)
            ? Math.max(10, Math.floor(options.sampleCount))
            : 180;
        const minimumSamples = Number.isFinite(options.minimumSamples)
            ? Math.max(5, Math.floor(options.minimumSamples))
            : Math.min(sampleCount, 60);
        const settleMs = Number.isFinite(options.settleMs) ? Math.max(0, options.settleMs) : 800;
        const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(250, options.timeoutMs) : 5000;
        const requiredWidth = Number.isFinite(options.requiredWidth) ? Math.max(1, options.requiredWidth) : 1920;
        const requiredHeight = Number.isFinite(options.requiredHeight) ? Math.max(1, options.requiredHeight) : 1080;
        const strictResolution = options.strictResolution !== false;

        if (this.renderBackend !== 'webgpu') {
            const report = {
                generatedAt: new Date().toISOString(),
                gate: 'Phase 3 performance gate',
                method: 'cpu-pass-time',
                reason: 'WebGPU backend is not active.',
                targetMs,
                pass: false,
            };
            this.phase3Validation.lastPerformanceGate = report;
            return report;
        }

        if (settleMs > 0) {
            await this.waitForMs(settleMs);
        }

        const size = this.getLogicalCanvasSize();
        const collectSamples = () => this.selectSceneTimingSampleSet(size, sampleCount);

        let scopedSampleSet = collectSamples();
        const waitStartedAt = globalThis.performance?.now?.() ?? Date.now();
        while (scopedSampleSet.samples.length < sampleCount) {
            const now = globalThis.performance?.now?.() ?? Date.now();
            if ((now - waitStartedAt) >= timeoutMs) {
                break;
            }
            await this.waitForMs(34);
            scopedSampleSet = collectSamples();
        }

        const sampleDurations = scopedSampleSet.samples.map((entry) => entry.ms);
        const averageMs = average(sampleDurations);
        const p95Ms = percentile(sampleDurations, 0.95);
        const maxMs = sampleDurations.length ? Math.max(...sampleDurations) : 0;
        const minMs = sampleDurations.length ? Math.min(...sampleDurations) : 0;
        const hasEnoughSamples = sampleDurations.length >= minimumSamples;
        const resolutionPass = size.width >= requiredWidth && size.height >= requiredHeight;
        const pass = hasEnoughSamples
            && averageMs <= targetMs
            && (!strictResolution || resolutionPass);

        const report = {
            generatedAt: new Date().toISOString(),
            gate: 'Phase 3 performance gate',
            method: scopedSampleSet.method,
            targetMs,
            sampleCount: sampleDurations.length,
            minimumSamples,
            hasEnoughSamples,
            averageMs,
            p95Ms,
            maxMs,
            minMs,
            resolution: {
                width: size.width,
                height: size.height,
                pixelRatio: size.pixelRatio,
            },
            requiredResolution: {
                width: requiredWidth,
                height: requiredHeight,
                strict: strictResolution,
            },
            resolutionPass,
            pass,
        };

        this.phase3Validation.lastPerformanceGate = report;
        return report;
    }

    async runPhase3Validation(options = {}) {
        const snapshot = this.capturePhase3Snapshot(options.snapshotLabel || 'phase3-validation');
        const visualGate = this.evaluatePhase3VisualGate(options.visual || {});
        const performanceGate = await this.runPhase3PerformanceGate(options.performance || {});
        const report = {
            generatedAt: new Date().toISOString(),
            phase: 'phase3',
            deliverable: 'Cloud pass',
            visualGate,
            performanceGate,
            snapshot,
            heroShotChecklist: [...SKY_CHILDREN_PHASE3_HERO_SHOTS],
            pass: visualGate.pass && performanceGate.pass,
        };
        this.phase3Validation.lastReport = report;
        return report;
    }

    getPhase4FoliageSignals() {
        const foliage = this.foliageState;
        const directionLength = Math.hypot(foliage.windDirection[0], foliage.windDirection[1]);
        const directionNormalization = clamp(1 - Math.abs(directionLength - 1), 0, 1);
        const primaryAmplitude = foliage.windStrength;
        const gustAmplitude = foliage.windStrength * foliage.gustStrength;
        const microAmplitude = foliage.windStrength * foliage.microStrength;
        const frequencySpread = Math.max(
            foliage.windFrequency,
            foliage.gustFrequency,
            foliage.microFrequency,
        ) - Math.min(
            foliage.windFrequency,
            foliage.gustFrequency,
            foliage.microFrequency,
        );
        const gustToPrimaryRatio = gustAmplitude / Math.max(primaryAmplitude, 0.0001);
        const microToPrimaryRatio = microAmplitude / Math.max(primaryAmplitude, 0.0001);
        const nonSyncScore = frequencySpread + Math.abs(foliage.windDirection[0] - foliage.windDirection[1]) * 0.35;
        const translucencyPotential = foliage.sssIntensity
            * (0.55 + foliage.skyNormalBias * 0.6)
            * (0.45 + Math.sqrt(Math.max(foliage.sssDistortion, 0.01)));
        const sunFacingReadability = translucencyPotential / Math.max(Math.pow(foliage.sssPower, 0.32), 0.5);
        const perceivedOcclusionLoad = (foliage.instanceCount / 5000)
            * foliage.alpha
            * (foliage.bladeHeight / 2.0);
        const depthBandBalance = 1
            - Math.abs(foliage.gustStrength - 0.65) * 0.35
            - Math.abs(foliage.microStrength - 0.2) * 0.5;

        return {
            directionLength,
            directionNormalization,
            primaryAmplitude,
            gustAmplitude,
            microAmplitude,
            frequencySpread,
            gustToPrimaryRatio,
            microToPrimaryRatio,
            nonSyncScore,
            translucencyPotential,
            sunFacingReadability,
            sssPower: foliage.sssPower,
            skyNormalBias: foliage.skyNormalBias,
            alpha: foliage.alpha,
            bladeHeight: foliage.bladeHeight,
            instanceCount: foliage.instanceCount,
            perceivedOcclusionLoad,
            depthBandBalance,
        };
    }

    evaluatePhase4VisualGate(options = {}) {
        const thresholds = {
            frequencySpreadMin: Number.isFinite(options.frequencySpreadMin) ? Math.max(0, options.frequencySpreadMin) : 1.0,
            gustToPrimaryMin: Number.isFinite(options.gustToPrimaryMin) ? Math.max(0, options.gustToPrimaryMin) : 0.2,
            microToPrimaryMin: Number.isFinite(options.microToPrimaryMin) ? Math.max(0, options.microToPrimaryMin) : 0.05,
            nonSyncScoreMin: Number.isFinite(options.nonSyncScoreMin) ? Math.max(0, options.nonSyncScoreMin) : 1.1,
            directionLengthMin: Number.isFinite(options.directionLengthMin) ? Math.max(0, options.directionLengthMin) : 0.5,
            directionLengthMax: Number.isFinite(options.directionLengthMax) ? Math.max(0, options.directionLengthMax) : 1.5,
            directionNormalizationMin: Number.isFinite(options.directionNormalizationMin)
                ? clamp(options.directionNormalizationMin, 0, 1)
                : 0.55,
            translucencyPotentialMin: Number.isFinite(options.translucencyPotentialMin)
                ? Math.max(0, options.translucencyPotentialMin)
                : 0.95,
            sunFacingReadabilityMin: Number.isFinite(options.sunFacingReadabilityMin)
                ? Math.max(0, options.sunFacingReadabilityMin)
                : 0.45,
            skyNormalBiasMin: Number.isFinite(options.skyNormalBiasMin) ? Math.max(0, options.skyNormalBiasMin) : 0.2,
            sssPowerMin: Number.isFinite(options.sssPowerMin) ? Math.max(0, options.sssPowerMin) : 2.0,
            alphaMin: Number.isFinite(options.alphaMin) ? clamp(options.alphaMin, 0, 1) : 0.45,
            bladeHeightMin: Number.isFinite(options.bladeHeightMin) ? Math.max(0, options.bladeHeightMin) : 0.8,
            occlusionLoadMax: Number.isFinite(options.occlusionLoadMax) ? Math.max(0, options.occlusionLoadMax) : 0.82,
            depthBandBalanceMin: Number.isFinite(options.depthBandBalanceMin)
                ? Math.max(0, options.depthBandBalanceMin)
                : 0.7,
        };

        const signals = this.getPhase4FoliageSignals();
        const layeredWind = signals.frequencySpread >= thresholds.frequencySpreadMin
            && signals.gustToPrimaryRatio >= thresholds.gustToPrimaryMin
            && signals.microToPrimaryRatio >= thresholds.microToPrimaryMin;
        const nonSynchronousMotion = signals.nonSyncScore >= thresholds.nonSyncScoreMin
            && signals.directionLength >= thresholds.directionLengthMin
            && signals.directionLength <= thresholds.directionLengthMax
            && signals.directionNormalization >= thresholds.directionNormalizationMin;
        const translucencyReadability = signals.translucencyPotential >= thresholds.translucencyPotentialMin
            && signals.sunFacingReadability >= thresholds.sunFacingReadabilityMin
            && signals.skyNormalBias >= thresholds.skyNormalBiasMin
            && signals.sssPower >= thresholds.sssPowerMin
            && signals.alpha >= thresholds.alphaMin
            && signals.bladeHeight >= thresholds.bladeHeightMin;
        const silhouetteSafety = signals.perceivedOcclusionLoad <= thresholds.occlusionLoadMax
            && signals.depthBandBalance >= thresholds.depthBandBalanceMin;
        const pass = layeredWind && nonSynchronousMotion && translucencyReadability && silhouetteSafety;

        const report = {
            generatedAt: new Date().toISOString(),
            gate: 'Phase 4 visual gate',
            criteria: [
                'Wind motion looks layered/non-synchronous',
                'Translucency reads from sun-facing camera angles',
            ],
            thresholds,
            signals,
            checks: {
                layeredWind,
                nonSynchronousMotion,
                translucencyReadability,
                silhouetteSafety,
            },
            pass,
        };

        this.phase4Validation.lastVisualGate = report;
        return report;
    }

    capturePhase4Snapshot(label = 'snapshot') {
        const size = this.getLogicalCanvasSize();
        const snapshot = {
            label,
            generatedAt: new Date().toISOString(),
            backend: this.renderBackend,
            isActive: this.isActive === true,
            canvas: size,
            resolutionLock: this.getResolutionLock(),
            foliage: { ...this.foliageState },
            foliageSignals: this.getPhase4FoliageSignals(),
            heroShotChecklist: [...SKY_CHILDREN_PHASE4_HERO_SHOTS],
        };

        const snapshots = this.phase4Validation.snapshots;
        snapshots.push(snapshot);
        if (snapshots.length > this.phase4Validation.maxSnapshots) {
            snapshots.splice(0, snapshots.length - this.phase4Validation.maxSnapshots);
        }
        return snapshot;
    }

    async runPhase4PerformanceGate(options = {}) {
        const targetMs = Number.isFinite(options.targetMs) ? Math.max(0.05, options.targetMs) : 2.0;
        const sampleCount = Number.isFinite(options.sampleCount)
            ? Math.max(10, Math.floor(options.sampleCount))
            : 180;
        const minimumSamples = Number.isFinite(options.minimumSamples)
            ? Math.max(5, Math.floor(options.minimumSamples))
            : Math.min(sampleCount, 60);
        const settleMs = Number.isFinite(options.settleMs) ? Math.max(0, options.settleMs) : 800;
        const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(250, options.timeoutMs) : 5000;
        const requiredWidth = Number.isFinite(options.requiredWidth) ? Math.max(1, options.requiredWidth) : 1920;
        const requiredHeight = Number.isFinite(options.requiredHeight) ? Math.max(1, options.requiredHeight) : 1080;
        const strictResolution = options.strictResolution !== false;
        const requiredInstanceCount = Number.isFinite(options.requiredInstanceCount)
            ? Math.max(1, Math.floor(options.requiredInstanceCount))
            : this.foliageState.instanceCount;

        if (this.renderBackend !== 'webgpu') {
            const report = {
                generatedAt: new Date().toISOString(),
                gate: 'Phase 4 performance gate',
                method: 'cpu-pass-time',
                reason: 'WebGPU backend is not active.',
                targetMs,
                pass: false,
            };
            this.phase4Validation.lastPerformanceGate = report;
            return report;
        }

        if (settleMs > 0) {
            await this.waitForMs(settleMs);
        }

        const size = this.getLogicalCanvasSize();
        const collectSamples = () => this.selectSceneTimingSampleSet(size, sampleCount);

        let scopedSampleSet = collectSamples();
        const waitStartedAt = globalThis.performance?.now?.() ?? Date.now();
        while (scopedSampleSet.samples.length < sampleCount) {
            const now = globalThis.performance?.now?.() ?? Date.now();
            if ((now - waitStartedAt) >= timeoutMs) {
                break;
            }
            await this.waitForMs(34);
            scopedSampleSet = collectSamples();
        }

        const sampleDurations = scopedSampleSet.samples.map((entry) => entry.ms);
        const averageMs = average(sampleDurations);
        const p95Ms = percentile(sampleDurations, 0.95);
        const maxMs = sampleDurations.length ? Math.max(...sampleDurations) : 0;
        const minMs = sampleDurations.length ? Math.min(...sampleDurations) : 0;
        const hasEnoughSamples = sampleDurations.length >= minimumSamples;
        const resolutionPass = size.width >= requiredWidth && size.height >= requiredHeight;
        const instanceCountPass = this.foliageState.instanceCount >= requiredInstanceCount;
        const pass = hasEnoughSamples
            && averageMs <= targetMs
            && instanceCountPass
            && (!strictResolution || resolutionPass);

        const report = {
            generatedAt: new Date().toISOString(),
            gate: 'Phase 4 performance gate',
            method: scopedSampleSet.method,
            targetMs,
            sampleCount: sampleDurations.length,
            minimumSamples,
            hasEnoughSamples,
            averageMs,
            p95Ms,
            maxMs,
            minMs,
            resolution: {
                width: size.width,
                height: size.height,
                pixelRatio: size.pixelRatio,
            },
            requiredResolution: {
                width: requiredWidth,
                height: requiredHeight,
                strict: strictResolution,
            },
            foliage: {
                instanceCount: this.foliageState.instanceCount,
                requiredInstanceCount,
                instanceCountPass,
            },
            resolutionPass,
            pass,
        };

        this.phase4Validation.lastPerformanceGate = report;
        return report;
    }

    async runPhase4Validation(options = {}) {
        const snapshot = this.capturePhase4Snapshot(options.snapshotLabel || 'phase4-validation');
        const visualGate = this.evaluatePhase4VisualGate(options.visual || {});
        const performanceGate = await this.runPhase4PerformanceGate(options.performance || {});
        const report = {
            generatedAt: new Date().toISOString(),
            phase: 'phase4',
            deliverable: 'Foliage instancing',
            visualGate,
            performanceGate,
            snapshot,
            heroShotChecklist: [...SKY_CHILDREN_PHASE4_HERO_SHOTS],
            pass: visualGate.pass && performanceGate.pass,
        };
        this.phase4Validation.lastReport = report;
        return report;
    }

    estimatePhase5PostSignalsFromState() {
        const post = this.postState;
        const bloomThresholdScore = 1 - Math.abs(post.bloomThreshold - 0.75) / 0.65;
        const bloomKneeScore = 1 - Math.abs(post.bloomSoftKnee - 0.3) / 0.35;
        const bloomBlendScore = 1 - Math.abs(post.bloomBlend - 0.4) / 0.45;
        const bloomRadiusScore = 1 - Math.abs(post.bloomRadius - 1.1) / 0.9;
        const bloomHaloControl = clamp(
            (bloomThresholdScore + bloomKneeScore + bloomBlendScore + bloomRadiusScore) / 4,
            0,
            1.5,
        );
        const warmHighlightBias = post.highlightColor[0] - post.highlightColor[2];
        const coolShadowBias = post.shadowColor[2] - post.shadowColor[0];
        const warmCoolDistance = Math.hypot(
            post.highlightColor[0] - post.shadowColor[0],
            post.highlightColor[1] - post.shadowColor[1],
            post.highlightColor[2] - post.shadowColor[2],
        );
        const highlightChroma = Math.max(...post.highlightColor) - Math.min(...post.highlightColor);
        const gradingBalanceScore = clamp(
            1
            - Math.abs(post.exposure - 0.15) * 0.55
            - Math.abs(post.contrast - 1.12) * 0.85
            - Math.max(0, post.saturation - 1.35) * 0.6
            - Math.max(0, 0.8 - post.agxMix) * 0.5,
            0,
            1.6,
        );
        const huePreservationScore = clamp(
            gradingBalanceScore
            + highlightChroma * 0.22
            + post.agxMix * 0.35
            - Math.abs(post.highlightStrength - 0.3) * 0.25
            - Math.abs(post.shadowStrength - 0.35) * 0.2,
            0,
            2.0,
        );
        return {
            source: 'state-estimate',
            bloomThreshold: post.bloomThreshold,
            bloomSoftKnee: post.bloomSoftKnee,
            bloomBlend: post.bloomBlend,
            bloomRadius: post.bloomRadius,
            bloomHaloControl,
            warmHighlightBias,
            coolShadowBias,
            warmCoolDistance,
            highlightChroma,
            gradingBalanceScore,
            huePreservationScore,
            exposure: post.exposure,
            contrast: post.contrast,
            saturation: post.saturation,
            agxMix: post.agxMix,
        };
    }

    async capturePhase5FrameProbe(options = {}) {
        const { webgpu } = this;
        if (
            this.renderBackend !== 'webgpu'
            || !webgpu.device
            || !webgpu.postTexture
            || !Number.isFinite(webgpu.postTextureWidth)
            || !Number.isFinite(webgpu.postTextureHeight)
        ) {
            return null;
        }

        const textureWidth = Math.max(1, Math.floor(webgpu.postTextureWidth));
        const textureHeight = Math.max(1, Math.floor(webgpu.postTextureHeight));
        const desiredSampleWidth = Number.isFinite(options.sampleWidth)
            ? Math.floor(options.sampleWidth)
            : Math.min(textureWidth, 320);
        const desiredSampleHeight = Number.isFinite(options.sampleHeight)
            ? Math.floor(options.sampleHeight)
            : Math.min(textureHeight, 180);
        const sampleWidth = clamp(desiredSampleWidth, 16, textureWidth);
        const sampleHeight = clamp(desiredSampleHeight, 16, textureHeight);
        const originX = clamp(
            Number.isFinite(options.originX)
                ? Math.floor(options.originX)
                : Math.floor((textureWidth - sampleWidth) * 0.5),
            0,
            Math.max(0, textureWidth - sampleWidth),
        );
        const originY = clamp(
            Number.isFinite(options.originY)
                ? Math.floor(options.originY)
                : Math.floor((textureHeight - sampleHeight) * 0.5),
            0,
            Math.max(0, textureHeight - sampleHeight),
        );
        const bytesPerPixel = 4;
        const bytesPerRowUnaligned = sampleWidth * bytesPerPixel;
        const bytesPerRow = Math.ceil(bytesPerRowUnaligned / 256) * 256;
        const readbackSize = bytesPerRow * sampleHeight;

        const readbackBuffer = webgpu.device.createBuffer({
            label: 'sky-children/phase5-frame-probe',
            size: readbackSize,
            usage: GPU_BUFFER_USAGE_COPY_DST + GPU_BUFFER_USAGE_MAP_READ,
        });

        let mapped = false;
        try {
            const encoder = webgpu.device.createCommandEncoder({
                label: 'sky-children/phase5-frame-probe-encoder',
            });
            encoder.copyTextureToBuffer(
                {
                    texture: webgpu.postTexture,
                    origin: {
                        x: originX,
                        y: originY,
                        z: 0,
                    },
                },
                {
                    buffer: readbackBuffer,
                    bytesPerRow,
                    rowsPerImage: sampleHeight,
                },
                {
                    width: sampleWidth,
                    height: sampleHeight,
                    depthOrArrayLayers: 1,
                },
            );
            webgpu.device.queue.submit([encoder.finish()]);
            if (typeof webgpu.device.queue.onSubmittedWorkDone === 'function') {
                await webgpu.device.queue.onSubmittedWorkDone();
            }

            await readbackBuffer.mapAsync(GPU_MAP_MODE_READ);
            mapped = true;
            const mappedRange = readbackBuffer.getMappedRange();
            const pixels = new Uint8Array(mappedRange.slice(0));
            const isBgraFormat = String(webgpu.format || '').startsWith('bgra');

            const nearColor = [0, 0, 0];
            const midColor = [0, 0, 0];
            const farColor = [0, 0, 0];
            let nearLumaSum = 0;
            let midLumaSum = 0;
            let farLumaSum = 0;
            let nearCount = 0;
            let midCount = 0;
            let farCount = 0;
            let allLumaSum = 0;
            const lumaValues = [];
            const rowMeans = new Array(sampleHeight).fill(0);

            for (let y = 0; y < sampleHeight; y += 1) {
                const rowOffset = y * bytesPerRow;
                let rowLuma = 0;
                for (let x = 0; x < sampleWidth; x += 1) {
                    const offset = rowOffset + x * bytesPerPixel;
                    const rRaw = pixels[offset + (isBgraFormat ? 2 : 0)] / 255;
                    const gRaw = pixels[offset + 1] / 255;
                    const bRaw = pixels[offset + (isBgraFormat ? 0 : 2)] / 255;
                    const r = Math.pow(rRaw, 2.2);
                    const g = Math.pow(gRaw, 2.2);
                    const b = Math.pow(bRaw, 2.2);
                    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;

                    allLumaSum += luma;
                    rowLuma += luma;
                    lumaValues.push(luma);

                    if (y >= sampleHeight * 0.66) {
                        nearColor[0] += r;
                        nearColor[1] += g;
                        nearColor[2] += b;
                        nearLumaSum += luma;
                        nearCount += 1;
                    } else if (y >= sampleHeight * 0.33) {
                        midColor[0] += r;
                        midColor[1] += g;
                        midColor[2] += b;
                        midLumaSum += luma;
                        midCount += 1;
                    } else {
                        farColor[0] += r;
                        farColor[1] += g;
                        farColor[2] += b;
                        farLumaSum += luma;
                        farCount += 1;
                    }
                }
                rowMeans[y] = rowLuma / sampleWidth;
            }

            const meanColor = (sum, count) => (count > 0
                ? [sum[0] / count, sum[1] / count, sum[2] / count]
                : [0, 0, 0]);
            const nearMean = meanColor(nearColor, nearCount);
            const midMean = meanColor(midColor, midCount);
            const farMean = meanColor(farColor, farCount);
            const nearLuma = nearCount > 0 ? nearLumaSum / nearCount : 0;
            const midLuma = midCount > 0 ? midLumaSum / midCount : 0;
            const farLuma = farCount > 0 ? farLumaSum / farCount : 0;
            const averageLuma = lumaValues.length > 0 ? allLumaSum / lumaValues.length : 0;

            const p25 = percentile(lumaValues, 0.25);
            const p75 = percentile(lumaValues, 0.75);
            const p90 = percentile(lumaValues, 0.9);
            const highlightThreshold = clamp(Math.max(0.35, p90), 0.2, 1.0);
            const shadowThreshold = clamp(Math.min(0.28, p25), 0.0, 0.45);
            const haloLow = clamp(Math.max(0.12, p75 * 0.9), 0.0, highlightThreshold);
            const haloHigh = highlightThreshold;

            const highlightColor = [0, 0, 0];
            const shadowColor = [0, 0, 0];
            let highlightCount = 0;
            let shadowCount = 0;
            let haloCount = 0;
            let highlightLumaSum = 0;
            let shadowLumaSum = 0;

            for (let y = 0; y < sampleHeight; y += 1) {
                const rowOffset = y * bytesPerRow;
                for (let x = 0; x < sampleWidth; x += 1) {
                    const offset = rowOffset + x * bytesPerPixel;
                    const rRaw = pixels[offset + (isBgraFormat ? 2 : 0)] / 255;
                    const gRaw = pixels[offset + 1] / 255;
                    const bRaw = pixels[offset + (isBgraFormat ? 0 : 2)] / 255;
                    const r = Math.pow(rRaw, 2.2);
                    const g = Math.pow(gRaw, 2.2);
                    const b = Math.pow(bRaw, 2.2);
                    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;

                    if (luma >= highlightThreshold) {
                        highlightColor[0] += r;
                        highlightColor[1] += g;
                        highlightColor[2] += b;
                        highlightCount += 1;
                        highlightLumaSum += luma;
                    } else if (luma <= shadowThreshold) {
                        shadowColor[0] += r;
                        shadowColor[1] += g;
                        shadowColor[2] += b;
                        shadowCount += 1;
                        shadowLumaSum += luma;
                    }

                    if (luma >= haloLow && luma < haloHigh) {
                        haloCount += 1;
                    }
                }
            }

            const highlightMean = meanColor(highlightColor, highlightCount);
            const shadowMean = meanColor(shadowColor, shadowCount);
            const totalPixelCount = sampleWidth * sampleHeight;
            const highlightCoverage = totalPixelCount > 0 ? highlightCount / totalPixelCount : 0;
            const haloCoverage = totalPixelCount > 0 ? haloCount / totalPixelCount : 0;
            const haloToHighlightRatio = haloCoverage / Math.max(highlightCoverage, 1e-5);
            const highlightLuma = highlightCount > 0 ? highlightLumaSum / highlightCount : 0;
            const shadowLuma = shadowCount > 0 ? shadowLumaSum / shadowCount : shadowThreshold;
            const highlightChroma = Math.max(...highlightMean) - Math.min(...highlightMean);
            const warmHighlightBias = highlightMean[0] - highlightMean[2];
            const coolShadowBias = shadowMean[2] - shadowMean[0];
            const warmCoolDistance = Math.hypot(
                highlightMean[0] - shadowMean[0],
                highlightMean[1] - shadowMean[1],
                highlightMean[2] - shadowMean[2],
            );

            let silhouetteContrast = 0;
            for (let y = 1; y < rowMeans.length; y += 1) {
                const diff = Math.abs(rowMeans[y] - rowMeans[y - 1]);
                const normalizedY = y / Math.max(1, rowMeans.length - 1);
                if (normalizedY >= 0.2 && normalizedY <= 0.92) {
                    silhouetteContrast = Math.max(silhouetteContrast, diff);
                }
            }
            const depthBandContrast = Math.abs(nearLuma - midLuma) + Math.abs(midLuma - farLuma);
            const depthHaze = clamp(Math.abs(nearLuma - farLuma), 0, 1);
            const haloRatioScore = clamp(1 - Math.abs(haloToHighlightRatio - 2.4) / 2.4, 0, 1);
            const haloCoverageScore = clamp(1 - Math.abs(haloCoverage - 0.2) / 0.2, 0, 1);
            const clippingPenalty = clamp((highlightLuma - 0.93) / 0.12, 0, 1);
            const bloomHaloControl = clamp(
                haloRatioScore * 0.65 + haloCoverageScore * 0.35 - clippingPenalty * 0.35,
                0,
                1.5,
            );
            const gradingBalanceScore = clamp(
                (1 - Math.abs(averageLuma - 0.46) / 0.46) * 0.55
                + clamp((depthBandContrast + silhouetteContrast * 1.5) / 0.35, 0, 1) * 0.45,
                0,
                1.6,
            );
            const huePreservationScore = clamp(
                clamp(highlightChroma / 0.22, 0, 1.5) * 0.35
                + clamp(warmCoolDistance / 0.38, 0, 1.5) * 0.4
                + clamp(Math.max(0, warmHighlightBias) / 0.16, 0, 1.5) * 0.15
                + clamp(Math.max(0, coolShadowBias) / 0.16, 0, 1.5) * 0.1
                - clippingPenalty * 0.35,
                0,
                2.0,
            );

            const signals = {
                source: 'post-frame-probe',
                bloomThreshold: this.postState.bloomThreshold,
                bloomSoftKnee: this.postState.bloomSoftKnee,
                bloomBlend: this.postState.bloomBlend,
                bloomRadius: this.postState.bloomRadius,
                bloomHaloControl,
                warmHighlightBias,
                coolShadowBias,
                warmCoolDistance,
                highlightChroma,
                gradingBalanceScore,
                huePreservationScore,
                exposure: this.postState.exposure,
                contrast: this.postState.contrast,
                saturation: this.postState.saturation,
                agxMix: this.postState.agxMix,
                averageLuma,
                highlightLuma,
                shadowLuma,
                highlightCoverage,
                haloCoverage,
                haloToHighlightRatio,
                silhouetteContrast,
                depthBandContrast,
                depthHaze,
            };

            const probe = {
                generatedAt: new Date().toISOString(),
                generatedAtMs: Date.now(),
                texture: {
                    width: textureWidth,
                    height: textureHeight,
                    format: webgpu.format || 'unknown',
                },
                sampleWindow: {
                    x: originX,
                    y: originY,
                    width: sampleWidth,
                    height: sampleHeight,
                },
                bands: {
                    near: { color: nearMean, luma: nearLuma },
                    mid: { color: midMean, luma: midLuma },
                    far: { color: farMean, luma: farLuma },
                },
                signals,
            };
            this.phase5Validation.lastFrameProbe = probe;
            return probe;
        } catch (error) {
            console.warn('[SkyChildrenPhase5] Frame probe capture failed:', error);
            return null;
        } finally {
            if (mapped) {
                try {
                    readbackBuffer.unmap();
                } catch {
                    // no-op
                }
            }
            if (typeof readbackBuffer.destroy === 'function') {
                try {
                    readbackBuffer.destroy();
                } catch {
                    // no-op
                }
            }
        }
    }

    async getPhase5PostSignals(options = {}) {
        const forceProbe = options.forceProbe !== false;
        const maxProbeAgeMs = Number.isFinite(options.maxProbeAgeMs)
            ? Math.max(0, options.maxProbeAgeMs)
            : 300;
        const lastProbe = this.phase5Validation.lastFrameProbe;
        const probeAgeMs = lastProbe ? Math.max(0, Date.now() - Number(lastProbe.generatedAtMs || 0)) : Infinity;

        if (
            forceProbe
            && this.renderBackend === 'webgpu'
            && (options.refresh === true || !lastProbe || probeAgeMs > maxProbeAgeMs)
        ) {
            const probe = await this.capturePhase5FrameProbe(options);
            if (probe?.signals) {
                return {
                    ...probe.signals,
                    source: 'post-frame-probe',
                };
            }
        }

        if (lastProbe?.signals) {
            return {
                ...lastProbe.signals,
                source: 'post-frame-probe-cached',
            };
        }

        return this.estimatePhase5PostSignalsFromState();
    }

    async evaluatePhase5VisualGate(options = {}) {
        const thresholds = {
            bloomHaloControlMin: Number.isFinite(options.bloomHaloControlMin)
                ? Math.max(0, options.bloomHaloControlMin)
                : 0.52,
            bloomThresholdMin: Number.isFinite(options.bloomThresholdMin)
                ? Math.max(0, options.bloomThresholdMin)
                : 0.45,
            bloomThresholdMax: Number.isFinite(options.bloomThresholdMax)
                ? Math.max(0, options.bloomThresholdMax)
                : 1.1,
            bloomBlendMin: Number.isFinite(options.bloomBlendMin)
                ? Math.max(0, options.bloomBlendMin)
                : 0.18,
            bloomBlendMax: Number.isFinite(options.bloomBlendMax)
                ? Math.max(0, options.bloomBlendMax)
                : 0.7,
            huePreservationScoreMin: Number.isFinite(options.huePreservationScoreMin)
                ? Math.max(0, options.huePreservationScoreMin)
                : 0.62,
            warmCoolDistanceMin: Number.isFinite(options.warmCoolDistanceMin)
                ? Math.max(0, options.warmCoolDistanceMin)
                : 0.35,
            highlightChromaMin: Number.isFinite(options.highlightChromaMin)
                ? Math.max(0, options.highlightChromaMin)
                : 0.12,
            agxMixMin: Number.isFinite(options.agxMixMin)
                ? clamp(options.agxMixMin, 0, 1)
                : 0.75,
            saturationMax: Number.isFinite(options.saturationMax)
                ? Math.max(0, options.saturationMax)
                : 1.65,
        };

        const signals = await this.getPhase5PostSignals({
            ...options,
            forceProbe: options.forceProbe !== false,
        });
        const bloomHaloControlled = signals.bloomHaloControl >= thresholds.bloomHaloControlMin
            && signals.bloomThreshold >= thresholds.bloomThresholdMin
            && signals.bloomThreshold <= thresholds.bloomThresholdMax
            && signals.bloomBlend >= thresholds.bloomBlendMin
            && signals.bloomBlend <= thresholds.bloomBlendMax;
        const highlightHueSafety = signals.huePreservationScore >= thresholds.huePreservationScoreMin
            && signals.warmHighlightBias > 0
            && signals.coolShadowBias > 0
            && signals.warmCoolDistance >= thresholds.warmCoolDistanceMin
            && signals.highlightChroma >= thresholds.highlightChromaMin
            && signals.agxMix >= thresholds.agxMixMin
            && signals.saturation <= thresholds.saturationMax;
        const pass = bloomHaloControlled && highlightHueSafety;

        const report = {
            generatedAt: new Date().toISOString(),
            gate: 'Phase 5 visual gate',
            criteria: [
                'Bloom halo soft but controlled',
                'No highlight hue collapse in approved sunset scenes',
            ],
            thresholds,
            signals,
            probe: this.phase5Validation.lastFrameProbe,
            checks: {
                bloomHaloControlled,
                highlightHueSafety,
            },
            pass,
        };

        this.phase5Validation.lastVisualGate = report;
        return report;
    }

    async capturePhase5Snapshot(label = 'snapshot', options = {}) {
        const size = this.getLogicalCanvasSize();
        const postSignals = await this.getPhase5PostSignals({
            ...options,
            forceProbe: options.forceProbe !== false,
        });
        const snapshot = {
            label,
            generatedAt: new Date().toISOString(),
            backend: this.renderBackend,
            isActive: this.isActive === true,
            canvas: size,
            resolutionLock: this.getResolutionLock(),
            post: { ...this.postState },
            postSignals,
            postProbe: this.phase5Validation.lastFrameProbe,
            heroShotChecklist: [...SKY_CHILDREN_PHASE5_HERO_SHOTS],
        };

        const snapshots = this.phase5Validation.snapshots;
        snapshots.push(snapshot);
        if (snapshots.length > this.phase5Validation.maxSnapshots) {
            snapshots.splice(0, snapshots.length - this.phase5Validation.maxSnapshots);
        }
        return snapshot;
    }

    async runPhase5PerformanceGate(options = {}) {
        const targetMs = Number.isFinite(options.targetMs) ? Math.max(0.05, options.targetMs) : 1.5;
        const sampleCount = Number.isFinite(options.sampleCount)
            ? Math.max(10, Math.floor(options.sampleCount))
            : 180;
        const minimumSamples = Number.isFinite(options.minimumSamples)
            ? Math.max(5, Math.floor(options.minimumSamples))
            : Math.min(sampleCount, 60);
        const settleMs = Number.isFinite(options.settleMs) ? Math.max(0, options.settleMs) : 800;
        const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(250, options.timeoutMs) : 5000;
        const requiredWidth = Number.isFinite(options.requiredWidth) ? Math.max(1, options.requiredWidth) : 1920;
        const requiredHeight = Number.isFinite(options.requiredHeight) ? Math.max(1, options.requiredHeight) : 1080;
        const strictResolution = options.strictResolution !== false;

        if (this.renderBackend !== 'webgpu') {
            const report = {
                generatedAt: new Date().toISOString(),
                gate: 'Phase 5 performance gate',
                method: 'cpu-post-pass-time',
                reason: 'WebGPU backend is not active.',
                targetMs,
                pass: false,
            };
            this.phase5Validation.lastPerformanceGate = report;
            return report;
        }

        if (settleMs > 0) {
            await this.waitForMs(settleMs);
        }

        const size = this.getLogicalCanvasSize();
        const collectSamples = () => this.selectPostTimingSampleSet(size, sampleCount);

        let scopedSampleSet = collectSamples();
        const waitStartedAt = globalThis.performance?.now?.() ?? Date.now();
        while (scopedSampleSet.samples.length < sampleCount) {
            const now = globalThis.performance?.now?.() ?? Date.now();
            if ((now - waitStartedAt) >= timeoutMs) {
                break;
            }
            await this.waitForMs(34);
            scopedSampleSet = collectSamples();
        }

        const sampleDurations = scopedSampleSet.samples.map((entry) => entry.ms);
        const averageMs = average(sampleDurations);
        const p95Ms = percentile(sampleDurations, 0.95);
        const maxMs = sampleDurations.length ? Math.max(...sampleDurations) : 0;
        const minMs = sampleDurations.length ? Math.min(...sampleDurations) : 0;
        const hasEnoughSamples = sampleDurations.length >= minimumSamples;
        const resolutionPass = size.width >= requiredWidth && size.height >= requiredHeight;
        const pass = hasEnoughSamples
            && averageMs <= targetMs
            && (!strictResolution || resolutionPass);

        const report = {
            generatedAt: new Date().toISOString(),
            gate: 'Phase 5 performance gate',
            method: scopedSampleSet.method,
            targetMs,
            sampleCount: sampleDurations.length,
            minimumSamples,
            hasEnoughSamples,
            averageMs,
            p95Ms,
            maxMs,
            minMs,
            resolution: {
                width: size.width,
                height: size.height,
                pixelRatio: size.pixelRatio,
            },
            requiredResolution: {
                width: requiredWidth,
                height: requiredHeight,
                strict: strictResolution,
            },
            resolutionPass,
            pass,
        };

        this.phase5Validation.lastPerformanceGate = report;
        return report;
    }

    async runPhase5Validation(options = {}) {
        const snapshot = await this.capturePhase5Snapshot(
            options.snapshotLabel || 'phase5-validation',
            options.snapshot || {},
        );
        const visualGate = await this.evaluatePhase5VisualGate(options.visual || {});
        const performanceGate = await this.runPhase5PerformanceGate(options.performance || {});
        const report = {
            generatedAt: new Date().toISOString(),
            phase: 'phase5',
            deliverable: 'Post stack',
            visualGate,
            performanceGate,
            snapshot,
            heroShotChecklist: [...SKY_CHILDREN_PHASE5_HERO_SHOTS],
            pass: visualGate.pass && performanceGate.pass,
        };
        this.phase5Validation.lastReport = report;
        return report;
    }

    getPhase6CameraPathBookmarks() {
        return SKY_CHILDREN_PHASE6_CAMERA_PATHS.map((path) => ({
            ...path,
            depthBands: [...path.depthBands],
        }));
    }

    buildPhase6PathSignalsFromProbe(path, probeSignals, probeBands) {
        const [nearWeight, midWeight, farWeight] = path.depthBands;
        const weightedLuma = (
            probeBands.near.luma * nearWeight
            + probeBands.mid.luma * midWeight
            + probeBands.far.luma * farWeight
        );
        const weightedColor = [
            probeBands.near.color[0] * nearWeight + probeBands.mid.color[0] * midWeight + probeBands.far.color[0] * farWeight,
            probeBands.near.color[1] * nearWeight + probeBands.mid.color[1] * midWeight + probeBands.far.color[1] * farWeight,
            probeBands.near.color[2] * nearWeight + probeBands.mid.color[2] * midWeight + probeBands.far.color[2] * farWeight,
        ];
        const rimBlend = clamp(
            probeSignals.silhouetteContrast * (0.75 + path.silhouetteWeight * 0.35),
            0,
            2.5,
        );
        const warmCoolBalance = clamp(probeSignals.warmCoolDistance * path.warmthWeight, 0, 2.5);
        const silhouetteScore = clamp(
            (probeSignals.silhouetteContrast * 2.1 + probeSignals.depthBandContrast * 0.9) * path.silhouetteWeight,
            0,
            2.5,
        );
        const atmosphereScore = clamp(
            (probeSignals.depthHaze * 0.6 + probeSignals.depthBandContrast * 0.35 + (1 - weightedLuma) * 0.2)
            * path.atmosphereWeight,
            0,
            2.5,
        );
        const gradeStability = clamp(
            probeSignals.huePreservationScore * 0.7 + probeSignals.bloomHaloControl * 0.5,
            0,
            2.5,
        );
        const depthBandReadability = clamp(
            probeSignals.depthBandContrast * 2.9
            + probeSignals.silhouetteContrast * 2.1
            + Math.abs(probeBands.mid.luma - probeBands.far.luma) * 1.4,
            0,
            3.0,
        );
        const styleVector = [
            clamp(probeSignals.shadowLuma * 3.0 + probeSignals.coolShadowBias * 0.6, 0, 2.5),
            clamp(warmCoolBalance, 0, 2.5),
            clamp(silhouetteScore, 0, 2.5),
            clamp(atmosphereScore, 0, 2.5),
            clamp(gradeStability, 0, 2.5),
            clamp(depthBandReadability, 0, 3.0),
        ];
        const pathPass = depthBandReadability >= 0.55
            && styleVector[1] >= 0.45
            && styleVector[2] >= 0.25
            && styleVector[3] >= 0.45
            && styleVector[4] >= 0.45;

        return {
            id: path.id,
            durationSec: path.durationSec,
            depthBands: [...path.depthBands],
            weightedLuma,
            weightedColor,
            rimBlend,
            warmCoolBalance,
            silhouetteScore,
            atmosphereScore,
            gradeStability,
            depthBandReadability,
            styleVector,
            pass: pathPass,
        };
    }

    estimatePhase6ShotReviewSignalsFromState() {
        const phase1 = this.getPhase1VisualSignals();
        const phase2 = this.getPhase2TerrainSignals();
        const phase3 = this.getPhase3CloudSignals();
        const phase4 = this.getPhase4FoliageSignals();
        const phase5 = this.estimatePhase5PostSignalsFromState();
        const pathCount = SKY_CHILDREN_PHASE6_CAMERA_PATHS.length;

        const cameraPaths = SKY_CHILDREN_PHASE6_CAMERA_PATHS.map((path) => {
            const [nearWeight, midWeight, farWeight] = path.depthBands;
            const rimBlend = (
                phase1.rimNear * nearWeight
                + phase1.rimMid * midWeight
                + phase1.rimFar * farWeight
            );
            const warmCoolBalance = clamp(
                (phase1.warmCoolDistance * 0.6 + phase5.warmCoolDistance * 0.4) * path.warmthWeight,
                0,
                2.5,
            );
            const silhouetteScore = clamp(
                phase3.silhouetteReadability * path.silhouetteWeight
                + phase4.sunFacingReadability * 0.45,
                0,
                2.5,
            );
            const atmosphereScore = clamp(
                (phase2.shimmerSuppression * 0.45
                    + (1 - phase2.farDetail) * 0.35
                    + clamp(phase2.falloffSpan / 260, 0, 1) * 0.2)
                * path.atmosphereWeight,
                0,
                2.5,
            );
            const gradeStability = clamp(
                phase5.huePreservationScore * 0.6
                + phase5.bloomHaloControl * 0.4,
                0,
                2.5,
            );
            const depthBandReadability = clamp(
                rimBlend * 3.2
                + silhouetteScore * 0.55
                + atmosphereScore * 0.4
                + phase4.depthBandBalance * 0.2
                - phase4.perceivedOcclusionLoad * 0.12,
                0,
                3.0,
            );

            const styleVector = [
                clamp(phase1.shadowCompositeFloor * 3.4 + phase5.coolShadowBias * 0.5, 0, 2.5),
                clamp(warmCoolBalance, 0, 2.5),
                clamp(silhouetteScore, 0, 2.5),
                clamp(atmosphereScore, 0, 2.5),
                clamp(gradeStability, 0, 2.5),
                clamp(depthBandReadability, 0, 3.0),
            ];
            const pathPass = depthBandReadability >= 0.7
                && styleVector[1] >= 0.6
                && styleVector[2] >= 0.3
                && styleVector[3] >= 0.5
                && styleVector[4] >= 0.5;

            return {
                id: path.id,
                durationSec: path.durationSec,
                depthBands: [...path.depthBands],
                rimBlend,
                warmCoolBalance,
                silhouetteScore,
                atmosphereScore,
                gradeStability,
                depthBandReadability,
                styleVector,
                pass: pathPass,
            };
        });

        let pairCount = 0;
        let driftSum = 0;
        let maxStyleDrift = 0;
        for (let i = 0; i < cameraPaths.length; i += 1) {
            for (let j = i + 1; j < cameraPaths.length; j += 1) {
                const a = cameraPaths[i].styleVector;
                const b = cameraPaths[j].styleVector;
                const drift = Math.hypot(
                    a[0] - b[0],
                    a[1] - b[1],
                    a[2] - b[2],
                    a[3] - b[3],
                    a[4] - b[4],
                    a[5] - b[5],
                );
                maxStyleDrift = Math.max(maxStyleDrift, drift);
                driftSum += drift;
                pairCount += 1;
            }
        }

        const rangeOf = (values) => {
            if (!Array.isArray(values) || values.length === 0) return 0;
            return Math.max(...values) - Math.min(...values);
        };
        const depthReadabilityValues = cameraPaths.map((path) => path.depthBandReadability);
        const warmCoolValues = cameraPaths.map((path) => path.warmCoolBalance);
        const silhouetteValues = cameraPaths.map((path) => path.silhouetteScore);
        const atmosphereValues = cameraPaths.map((path) => path.atmosphereScore);
        const passingPathCount = cameraPaths.filter((path) => path.pass).length;

        return {
            source: 'state-estimate',
            cameraPathCount: cameraPaths.length,
            expectedCameraPathCount: pathCount,
            heroCoverageRatio: pathCount > 0 ? cameraPaths.length / pathCount : 0,
            passingPathCount,
            passingPathRatio: pathCount > 0 ? passingPathCount / pathCount : 0,
            meanStyleDrift: pairCount > 0 ? driftSum / pairCount : 0,
            maxStyleDrift,
            depthBandReadabilityMin: depthReadabilityValues.length ? Math.min(...depthReadabilityValues) : 0,
            depthBandReadabilityMax: depthReadabilityValues.length ? Math.max(...depthReadabilityValues) : 0,
            warmCoolStability: rangeOf(warmCoolValues),
            silhouetteStability: rangeOf(silhouetteValues),
            atmosphereStability: rangeOf(atmosphereValues),
            cameraPaths,
        };
    }

    async getPhase6ShotReviewSignals(options = {}) {
        const phase5Signals = await this.getPhase5PostSignals({
            ...options,
            forceProbe: options.forceProbe !== false,
        });
        const probe = this.phase5Validation.lastFrameProbe;
        if (!probe?.bands || !phase5Signals) {
            const fallback = this.estimatePhase6ShotReviewSignalsFromState();
            this.phase6Validation.lastShotReview = fallback;
            return fallback;
        }

        const cameraPaths = SKY_CHILDREN_PHASE6_CAMERA_PATHS.map((path) => (
            this.buildPhase6PathSignalsFromProbe(path, phase5Signals, probe.bands)
        ));
        let pairCount = 0;
        let driftSum = 0;
        let maxStyleDrift = 0;
        for (let i = 0; i < cameraPaths.length; i += 1) {
            for (let j = i + 1; j < cameraPaths.length; j += 1) {
                const a = cameraPaths[i].styleVector;
                const b = cameraPaths[j].styleVector;
                const drift = Math.hypot(
                    a[0] - b[0],
                    a[1] - b[1],
                    a[2] - b[2],
                    a[3] - b[3],
                    a[4] - b[4],
                    a[5] - b[5],
                );
                maxStyleDrift = Math.max(maxStyleDrift, drift);
                driftSum += drift;
                pairCount += 1;
            }
        }
        const rangeOf = (values) => {
            if (!Array.isArray(values) || values.length === 0) return 0;
            return Math.max(...values) - Math.min(...values);
        };
        const depthReadabilityValues = cameraPaths.map((path) => path.depthBandReadability);
        const warmCoolValues = cameraPaths.map((path) => path.warmCoolBalance);
        const silhouetteValues = cameraPaths.map((path) => path.silhouetteScore);
        const atmosphereValues = cameraPaths.map((path) => path.atmosphereScore);
        const passingPathCount = cameraPaths.filter((path) => path.pass).length;
        const pathCount = SKY_CHILDREN_PHASE6_CAMERA_PATHS.length;
        const result = {
            source: 'post-frame-probe',
            cameraPathCount: cameraPaths.length,
            expectedCameraPathCount: pathCount,
            heroCoverageRatio: pathCount > 0 ? cameraPaths.length / pathCount : 0,
            passingPathCount,
            passingPathRatio: pathCount > 0 ? passingPathCount / pathCount : 0,
            meanStyleDrift: pairCount > 0 ? driftSum / pairCount : 0,
            maxStyleDrift,
            depthBandReadabilityMin: depthReadabilityValues.length ? Math.min(...depthReadabilityValues) : 0,
            depthBandReadabilityMax: depthReadabilityValues.length ? Math.max(...depthReadabilityValues) : 0,
            warmCoolStability: rangeOf(warmCoolValues),
            silhouetteStability: rangeOf(silhouetteValues),
            atmosphereStability: rangeOf(atmosphereValues),
            probe: {
                generatedAt: probe.generatedAt,
                sampleWindow: { ...probe.sampleWindow },
            },
            cameraPaths,
        };
        this.phase6Validation.lastShotReview = result;
        return result;
    }

    async evaluatePhase6VisualGate(options = {}) {
        const thresholds = {
            expectedCameraPathCount: Number.isFinite(options.expectedCameraPathCount)
                ? Math.max(1, Math.floor(options.expectedCameraPathCount))
                : 6,
            depthBandReadabilityMin: Number.isFinite(options.depthBandReadabilityMin)
                ? Math.max(0, options.depthBandReadabilityMin)
                : 0.7,
            meanStyleDriftMax: Number.isFinite(options.meanStyleDriftMax)
                ? Math.max(0, options.meanStyleDriftMax)
                : 0.35,
            maxStyleDriftMax: Number.isFinite(options.maxStyleDriftMax)
                ? Math.max(0, options.maxStyleDriftMax)
                : 0.65,
            warmCoolStabilityMax: Number.isFinite(options.warmCoolStabilityMax)
                ? Math.max(0, options.warmCoolStabilityMax)
                : 0.42,
            silhouetteStabilityMax: Number.isFinite(options.silhouetteStabilityMax)
                ? Math.max(0, options.silhouetteStabilityMax)
                : 0.36,
            atmosphereStabilityMax: Number.isFinite(options.atmosphereStabilityMax)
                ? Math.max(0, options.atmosphereStabilityMax)
                : 0.36,
            passingPathRatioMin: Number.isFinite(options.passingPathRatioMin)
                ? clamp(options.passingPathRatioMin, 0, 1)
                : 1.0,
        };

        const signals = await this.getPhase6ShotReviewSignals({
            ...options,
            forceProbe: options.forceProbe !== false,
        });
        const cameraPathCoverage = signals.cameraPathCount >= thresholds.expectedCameraPathCount
            && signals.heroCoverageRatio >= 1;
        const styleDriftControlled = signals.meanStyleDrift <= thresholds.meanStyleDriftMax
            && signals.maxStyleDrift <= thresholds.maxStyleDriftMax;
        const depthBandReadability = signals.depthBandReadabilityMin >= thresholds.depthBandReadabilityMin;
        const crossShotContinuity = signals.warmCoolStability <= thresholds.warmCoolStabilityMax
            && signals.silhouetteStability <= thresholds.silhouetteStabilityMax
            && signals.atmosphereStability <= thresholds.atmosphereStabilityMax
            && signals.passingPathRatio >= thresholds.passingPathRatioMin;
        const pass = cameraPathCoverage && styleDriftControlled && depthBandReadability && crossShotContinuity;

        const report = {
            generatedAt: new Date().toISOString(),
            gate: 'Phase 6 visual gate',
            criteria: [
                '6 cinematic camera paths validated against look bible',
                'No style drift between shots',
            ],
            thresholds,
            signals,
            checks: {
                cameraPathCoverage,
                styleDriftControlled,
                depthBandReadability,
                crossShotContinuity,
            },
            pass,
        };

        this.phase6Validation.lastVisualGate = report;
        return report;
    }

    async capturePhase6Snapshot(label = 'snapshot', options = {}) {
        const size = this.getLogicalCanvasSize();
        const shotReviewSignals = await this.getPhase6ShotReviewSignals({
            ...options,
            forceProbe: options.forceProbe !== false,
        });
        const snapshot = {
            label,
            generatedAt: new Date().toISOString(),
            backend: this.renderBackend,
            isActive: this.isActive === true,
            canvas: size,
            resolutionLock: this.getResolutionLock(),
            cameraPaths: this.getPhase6CameraPathBookmarks(),
            shotReviewSignals,
            heroShotChecklist: [...SKY_CHILDREN_PHASE6_HERO_SHOTS],
        };

        const snapshots = this.phase6Validation.snapshots;
        snapshots.push(snapshot);
        if (snapshots.length > this.phase6Validation.maxSnapshots) {
            snapshots.splice(0, snapshots.length - this.phase6Validation.maxSnapshots);
        }
        return snapshot;
    }

    async runPhase6PerformanceGate(options = {}) {
        const targetFps = Number.isFinite(options.targetFps) ? Math.max(24, options.targetFps) : 60;
        const targetFrameMs = 1000 / targetFps;
        const p95MsLimit = Number.isFinite(options.p95MsLimit)
            ? Math.max(0.05, options.p95MsLimit)
            : targetFrameMs * 1.15;
        const maxDroppedFrameRatio = Number.isFinite(options.maxDroppedFrameRatio)
            ? clamp(options.maxDroppedFrameRatio, 0, 1)
            : 0.07;
        const dropFrameThresholdMs = Number.isFinite(options.dropFrameThresholdMs)
            ? Math.max(0.05, options.dropFrameThresholdMs)
            : targetFrameMs * 1.1;
        const sampleCount = Number.isFinite(options.sampleCount)
            ? Math.max(30, Math.floor(options.sampleCount))
            : 360;
        const minimumSamples = Number.isFinite(options.minimumSamples)
            ? Math.max(10, Math.floor(options.minimumSamples))
            : Math.min(sampleCount, 240);
        const settleMs = Number.isFinite(options.settleMs) ? Math.max(0, options.settleMs) : 1200;
        const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(500, options.timeoutMs) : 9000;
        const requiredWidth = Number.isFinite(options.requiredWidth) ? Math.max(1, options.requiredWidth) : 1920;
        const requiredHeight = Number.isFinite(options.requiredHeight) ? Math.max(1, options.requiredHeight) : 1080;
        const strictResolution = options.strictResolution !== false;

        if (this.renderBackend !== 'webgpu') {
            const report = {
                generatedAt: new Date().toISOString(),
                gate: 'Phase 6 performance gate',
                method: 'frame-present-interval',
                reason: 'WebGPU backend is not active.',
                targetFps,
                targetFrameMs,
                pass: false,
            };
            this.phase6Validation.lastPerformanceGate = report;
            return report;
        }

        if (settleMs > 0) {
            await this.waitForMs(settleMs);
        }

        const size = this.getLogicalCanvasSize();
        const collectSamples = () => this.selectFrameTimingSampleSet(size, sampleCount);

        let scopedSampleSet = collectSamples();
        const waitStartedAt = globalThis.performance?.now?.() ?? Date.now();
        while (scopedSampleSet.samples.length < sampleCount) {
            const now = globalThis.performance?.now?.() ?? Date.now();
            if ((now - waitStartedAt) >= timeoutMs) {
                break;
            }
            await this.waitForMs(34);
            scopedSampleSet = collectSamples();
        }

        const sampleDurations = scopedSampleSet.samples.map((entry) => entry.ms);
        const averageMs = average(sampleDurations);
        const p95Ms = percentile(sampleDurations, 0.95);
        const p99Ms = percentile(sampleDurations, 0.99);
        const maxMs = sampleDurations.length ? Math.max(...sampleDurations) : 0;
        const minMs = sampleDurations.length ? Math.min(...sampleDurations) : 0;
        const droppedFrameCount = sampleDurations.filter((ms) => ms > dropFrameThresholdMs).length;
        const droppedFrameRatio = sampleDurations.length > 0 ? droppedFrameCount / sampleDurations.length : 1;
        const hasEnoughSamples = sampleDurations.length >= minimumSamples;
        const averageFps = averageMs > 0 ? 1000 / averageMs : 0;
        const p95Fps = p95Ms > 0 ? 1000 / p95Ms : 0;
        const sustained60Fps = averageMs <= targetFrameMs && p95Ms <= p95MsLimit;
        const resolutionPass = size.width >= requiredWidth && size.height >= requiredHeight;
        const pass = hasEnoughSamples
            && sustained60Fps
            && droppedFrameRatio <= maxDroppedFrameRatio
            && (!strictResolution || resolutionPass);

        const report = {
            generatedAt: new Date().toISOString(),
            gate: 'Phase 6 performance gate',
            method: scopedSampleSet.method,
            targetFps,
            targetFrameMs,
            p95MsLimit,
            sampleCount: sampleDurations.length,
            minimumSamples,
            hasEnoughSamples,
            averageMs,
            p95Ms,
            p99Ms,
            maxMs,
            minMs,
            averageFps,
            p95Fps,
            droppedFrameCount,
            droppedFrameRatio,
            dropFrameThresholdMs,
            maxDroppedFrameRatio,
            sustained60Fps,
            resolution: {
                width: size.width,
                height: size.height,
                pixelRatio: size.pixelRatio,
            },
            requiredResolution: {
                width: requiredWidth,
                height: requiredHeight,
                strict: strictResolution,
            },
            resolutionPass,
            pass,
        };

        this.phase6Validation.lastPerformanceGate = report;
        return report;
    }

    async runPhase6Validation(options = {}) {
        const snapshot = await this.capturePhase6Snapshot(
            options.snapshotLabel || 'phase6-validation',
            options.snapshot || {},
        );
        const visualGate = await this.evaluatePhase6VisualGate(options.visual || {});
        const performanceGate = await this.runPhase6PerformanceGate(options.performance || {});
        const report = {
            generatedAt: new Date().toISOString(),
            phase: 'phase6',
            deliverable: 'Integrated shot review',
            visualGate,
            performanceGate,
            snapshot,
            heroShotChecklist: [...SKY_CHILDREN_PHASE6_HERO_SHOTS],
            pass: visualGate.pass && performanceGate.pass,
        };
        this.phase6Validation.lastReport = report;
        return report;
    }

    getPhase7QualityPresets() {
        return listSkyChildrenPhase7QualityPresets();
    }

    resolvePhase7TierList(options = {}) {
        const requested = Array.isArray(options.tiers) ? options.tiers : null;
        if (!requested || requested.length === 0) {
            return [...SKY_CHILDREN_PHASE7_TIERS];
        }

        const unique = [];
        requested.forEach((tier) => {
            const normalized = normalizeSkyChildrenPhase7QualityTier(tier, this.phase7QualityTier);
            if (!unique.includes(normalized)) {
                unique.push(normalized);
            }
        });
        return unique.length > 0 ? unique : [...SKY_CHILDREN_PHASE7_TIERS];
    }

    getPhase7QualityState() {
        return {
            activeTier: this.phase7QualityTier,
            preset: this.phase7QualityPreset ? { ...this.phase7QualityPreset } : null,
            renderScale: this.phase7RenderScale,
            resolutionLock: this.getResolutionLock(),
            tiers: this.getPhase7QualityPresets(),
        };
    }

    applyPhase7QualityPreset(preset, options = {}) {
        if (!preset) {
            return this.getPhase7QualityState();
        }

        const baseLighting = createSkyChildrenPhase1LightingState();
        const baseTerrain = createSkyChildrenPhase2TerrainState();
        const baseCloud = createSkyChildrenPhase3CloudState();
        const baseFoliage = createSkyChildrenPhase4FoliageState();
        const basePost = createSkyChildrenPhase5PostState();

        const tierIndex = clamp(SKY_CHILDREN_PHASE7_TIERS.indexOf(preset.tier), 0, SKY_CHILDREN_PHASE7_TIERS.length - 1);
        const tierT = SKY_CHILDREN_PHASE7_TIERS.length > 1
            ? tierIndex / (SKY_CHILDREN_PHASE7_TIERS.length - 1)
            : 1.0;
        const cloudMeshT = clamp((preset.cloudMeshes - 3) / 12, 0, 1);
        const cloudOctaveT = clamp((preset.cloudFbmOctaves - 2) / 3, 0, 1);
        const bloomMipT = clamp((preset.bloomMipLevels - 4) / 3, 0, 1);
        const terrainResT = clamp((preset.sandGrainTextureResolution - 256) / 768, 0, 1);
        const rippleResT = clamp((preset.rippleNormalResolution - 256) / 768, 0, 1);
        const mobileTier = preset.tier === 'mobile';

        // Keep a stable art baseline across tiers; only modulate fidelity/perf-sensitive knobs.
        this.lightingState = createSkyChildrenPhase1LightingState({
            ...baseLighting,
            glitter: {
                ...baseLighting.glitter,
                enabled: !mobileTier,
                threshold: clamp(baseLighting.glitter.threshold + (1 - bloomMipT) * 0.008, 0.8, 0.9999),
                intensity: clamp(lerp(baseLighting.glitter.intensity * 0.84, baseLighting.glitter.intensity * 1.1, bloomMipT), 0, 8),
            },
        });

        this.terrainState = createSkyChildrenPhase2TerrainState({
            ...baseTerrain,
            triplanarScale: lerp(baseTerrain.triplanarScale * 0.9, baseTerrain.triplanarScale * 1.14, terrainResT),
            normalStrength: lerp(baseTerrain.normalStrength * 0.74, baseTerrain.normalStrength, terrainResT),
            rippleScale: lerp(baseTerrain.rippleScale * 0.88, baseTerrain.rippleScale * 1.16, rippleResT),
            rippleSharpness: lerp(baseTerrain.rippleSharpness * 0.9, baseTerrain.rippleSharpness * 1.12, rippleResT),
            roughnessFar: clamp(baseTerrain.roughnessFar + (1 - terrainResT) * 0.06, 0, 1),
            shimmerSuppression: lerp(baseTerrain.shimmerSuppression + 0.08, baseTerrain.shimmerSuppression - 0.04, rippleResT),
            roughnessFalloffEnd: lerp(baseTerrain.roughnessFalloffEnd * 0.9, baseTerrain.roughnessFalloffEnd * 1.06, terrainResT),
            heightScale: baseTerrain.heightScale,
            horizonLift: baseTerrain.horizonLift,
        });

        this.cloudState = createSkyChildrenPhase3CloudState({
            ...baseCloud,
            noiseScale: lerp(baseCloud.noiseScale * 0.9, baseCloud.noiseScale * 1.18, cloudOctaveT),
            densityScale: lerp(baseCloud.densityScale * 0.95, baseCloud.densityScale * 1.12, cloudMeshT),
            scatterIntensity: lerp(baseCloud.scatterIntensity * 0.94, baseCloud.scatterIntensity * 1.08, cloudMeshT),
            edgeSoftness: lerp(baseCloud.edgeSoftness * 1.2, baseCloud.edgeSoftness * 0.92, cloudMeshT),
            opacity: lerp(baseCloud.opacity * 0.92, baseCloud.opacity, cloudMeshT),
            coverage: lerp(baseCloud.coverage + 0.04, baseCloud.coverage, cloudMeshT),
            softness: lerp(baseCloud.softness + 0.03, baseCloud.softness, cloudOctaveT),
            silverStrength: lerp(baseCloud.silverStrength * 0.9, baseCloud.silverStrength * 1.18, cloudOctaveT),
            silhouetteStrength: lerp(baseCloud.silhouetteStrength * 0.86, baseCloud.silhouetteStrength, cloudMeshT),
        });

        this.foliageState = createSkyChildrenPhase4FoliageState({
            ...baseFoliage,
            colorVariation: lerp(baseFoliage.colorVariation * 0.82, baseFoliage.colorVariation * 1.06, tierT),
            sssIntensity: lerp(baseFoliage.sssIntensity * 0.88, baseFoliage.sssIntensity * 1.08, tierT),
            skyNormalBias: lerp(baseFoliage.skyNormalBias * 0.94, Math.min(1, baseFoliage.skyNormalBias * 1.06), tierT),
            alpha: lerp(baseFoliage.alpha * 0.9, Math.min(1, baseFoliage.alpha * 1.08), tierT),
            microStrength: lerp(baseFoliage.microStrength * 0.84, baseFoliage.microStrength * 1.06, tierT),
            microFrequency: lerp(baseFoliage.microFrequency * 0.88, baseFoliage.microFrequency * 1.08, tierT),
            bladeHeight: lerp(baseFoliage.bladeHeight * 0.9, baseFoliage.bladeHeight * 1.1, tierT),
            instanceCount: preset.grassInstances,
        });

        this.postState = createSkyChildrenPhase5PostState({
            ...basePost,
            bloomThreshold: lerp(basePost.bloomThreshold + 0.06, basePost.bloomThreshold - 0.03, bloomMipT),
            bloomSoftKnee: lerp(basePost.bloomSoftKnee * 0.92, basePost.bloomSoftKnee * 1.06, bloomMipT),
            bloomBlend: lerp(basePost.bloomBlend * 0.82, basePost.bloomBlend * 1.12, bloomMipT),
            bloomRadius: lerp(basePost.bloomRadius * 0.88, basePost.bloomRadius * 1.18, bloomMipT),
            exposure: lerp(basePost.exposure - 0.05, basePost.exposure + 0.02, tierT),
            contrast: lerp(basePost.contrast * 0.96, basePost.contrast * 1.06, tierT),
            saturation: lerp(basePost.saturation * 0.92, basePost.saturation * 1.05, tierT),
            agxMix: lerp(Math.max(basePost.agxMix, 0.38), Math.max(basePost.agxMix, 0.72), tierT),
            shadowStrength: lerp(basePost.shadowStrength * 0.88, basePost.shadowStrength * 1.02, tierT),
            highlightStrength: lerp(basePost.highlightStrength * 0.84, basePost.highlightStrength * 1.04, tierT),
        });

        this.layerCount = Math.max(2, Math.min(15, Math.floor(preset.cloudMeshes)));
        this.phase7RenderScale = clamp(preset.renderScale, 0.5, 1.0);

        if (options.reseed === true && this.renderBackend === 'canvas2d') {
            this.seedSceneState();
        }
        if (options.resize !== false) {
            this.resizeCanvas();
        }

        return this.getPhase7QualityState();
    }

    setPhase7QualityTier(tier = 'high', options = {}) {
        const normalized = normalizeSkyChildrenPhase7QualityTier(tier, this.phase7QualityTier || 'high');
        const preset = getSkyChildrenPhase7QualityPreset(normalized);
        if (!preset) {
            return this.getPhase7QualityState();
        }

        this.phase7QualityTier = normalized;
        this.phase7QualityPreset = preset;
        return this.applyPhase7QualityPreset(preset, options);
    }

    async collectPhase7TierSignals(options = {}) {
        const phase1 = this.getPhase1VisualSignals();
        const phase2 = this.getPhase2TerrainSignals();
        const phase3 = this.getPhase3CloudSignals();
        const phase4 = this.getPhase4FoliageSignals();
        const phase5 = await this.getPhase5PostSignals({
            forceProbe: options.forceProbe === true,
            refresh: options.forceProbe === true,
        });
        const phase6 = this.estimatePhase6ShotReviewSignalsFromState();

        const rimBlend = phase1.rimNear * 0.5 + phase1.rimMid * 0.35 + phase1.rimFar * 0.15;
        const warmCoolComposite = clamp(
            phase1.warmCoolDistance * 0.58 + phase5.warmCoolDistance * 0.42,
            0,
            4,
        );
        const silhouetteComposite = clamp(
            phase3.silhouetteReadability * 0.7 + phase4.sunFacingReadability * 0.3,
            0,
            4,
        );
        const styleDriftPenalty = clamp(phase6.meanStyleDrift / 0.7, 0, 1);
        const atmosphereContinuity = clamp(
            phase2.shimmerSuppression * 0.45
                + (1 - phase2.farDetail) * 0.25
                + phase6.depthBandReadabilityMin * 0.2
                + phase6.passingPathRatio * 0.2
                - styleDriftPenalty * 0.2,
            0,
            2.5,
        );

        return {
            phase1,
            phase2,
            phase3,
            phase4,
            phase5,
            phase6,
            rimBlend,
            warmCoolComposite,
            silhouetteComposite,
            atmosphereContinuity,
            styleVector: [
                phase1.shadowCompositeFloor,
                warmCoolComposite,
                rimBlend,
                silhouetteComposite,
                atmosphereContinuity,
                phase5.huePreservationScore,
                phase5.bloomHaloControl,
            ],
        };
    }

    async evaluatePhase7VisualGate(options = {}) {
        const thresholds = {
            expectedTierCount: Number.isFinite(options.expectedTierCount)
                ? Math.max(1, Math.floor(options.expectedTierCount))
                : 4,
            shadowCompositeFloorMin: Number.isFinite(options.shadowCompositeFloorMin)
                ? Math.max(0, options.shadowCompositeFloorMin)
                : 0.03,
            rimBlendMin: Number.isFinite(options.rimBlendMin)
                ? Math.max(0, options.rimBlendMin)
                : 0.03,
            warmCoolCompositeMin: Number.isFinite(options.warmCoolCompositeMin)
                ? Math.max(0, options.warmCoolCompositeMin)
                : 0.5,
            silhouetteCompositeMin: Number.isFinite(options.silhouetteCompositeMin)
                ? Math.max(0, options.silhouetteCompositeMin)
                : 0.45,
            atmosphereContinuityMin: Number.isFinite(options.atmosphereContinuityMin)
                ? Math.max(0, options.atmosphereContinuityMin)
                : 0.55,
            huePreservationMin: Number.isFinite(options.huePreservationMin)
                ? Math.max(0, options.huePreservationMin)
                : 0.62,
            bloomHaloControlMin: Number.isFinite(options.bloomHaloControlMin)
                ? Math.max(0, options.bloomHaloControlMin)
                : 0.48,
            meanStyleDriftMax: Number.isFinite(options.meanStyleDriftMax)
                ? Math.max(0, options.meanStyleDriftMax)
                : 0.55,
            maxStyleDriftMax: Number.isFinite(options.maxStyleDriftMax)
                ? Math.max(0, options.maxStyleDriftMax)
                : 0.95,
            tierPassRatioMin: Number.isFinite(options.tierPassRatioMin)
                ? clamp(options.tierPassRatioMin, 0, 1)
                : 1.0,
            settleMs: Number.isFinite(options.settleMs) ? Math.max(0, options.settleMs) : 280,
            forceProbe: options.forceProbe === true,
        };

        const tiers = this.resolvePhase7TierList(options);
        const previousTier = this.phase7QualityTier;
        const tierReports = [];

        try {
            for (const tier of tiers) {
                const state = this.setPhase7QualityTier(tier, { resize: true });
                if (thresholds.settleMs > 0) {
                    await this.waitForMs(thresholds.settleMs);
                }
                const signals = await this.collectPhase7TierSignals({
                    forceProbe: thresholds.forceProbe,
                });
                const styleAnchors = signals.phase1.shadowCompositeFloor >= thresholds.shadowCompositeFloorMin
                    && signals.warmCoolComposite >= thresholds.warmCoolCompositeMin
                    && signals.phase1.warmDominance > 0
                    && signals.phase1.coolDominance > 0;
                const silhouetteReadability = signals.rimBlend >= thresholds.rimBlendMin
                    && signals.silhouetteComposite >= thresholds.silhouetteCompositeMin
                    && signals.phase3.silverRatio >= 1.2;
                const atmosphereContinuity = signals.atmosphereContinuity >= thresholds.atmosphereContinuityMin
                    && signals.phase2.shimmerSuppression >= 0.3
                    && signals.phase6.passingPathRatio >= 0.9;
                const gradingIntegrity = signals.phase5.huePreservationScore >= thresholds.huePreservationMin
                    && signals.phase5.bloomHaloControl >= thresholds.bloomHaloControlMin
                    && signals.phase5.warmHighlightBias > 0
                    && signals.phase5.coolShadowBias > 0;
                const pass = styleAnchors && silhouetteReadability && atmosphereContinuity && gradingIntegrity;

                tierReports.push({
                    tier,
                    preset: state.preset,
                    renderScale: state.renderScale,
                    checks: {
                        styleAnchors,
                        silhouetteReadability,
                        atmosphereContinuity,
                        gradingIntegrity,
                    },
                    signals,
                    pass,
                });
            }
        } finally {
            this.setPhase7QualityTier(previousTier, { resize: true });
        }

        const styleDrifts = [];
        for (let i = 0; i < tierReports.length; i += 1) {
            for (let j = i + 1; j < tierReports.length; j += 1) {
                const a = tierReports[i].signals.styleVector;
                const b = tierReports[j].signals.styleVector;
                styleDrifts.push(Math.hypot(
                    a[0] - b[0],
                    a[1] - b[1],
                    a[2] - b[2],
                    a[3] - b[3],
                    a[4] - b[4],
                    a[5] - b[5],
                    a[6] - b[6],
                ));
            }
        }

        const passingTierCount = tierReports.filter((tier) => tier.pass).length;
        const tierPassRatio = tierReports.length > 0 ? passingTierCount / tierReports.length : 0;
        const meanStyleDrift = styleDrifts.length > 0 ? average(styleDrifts) : 0;
        const maxStyleDrift = styleDrifts.length > 0 ? Math.max(...styleDrifts) : 0;
        const tierCoverage = tierReports.length >= thresholds.expectedTierCount;
        const identityContinuity = meanStyleDrift <= thresholds.meanStyleDriftMax
            && maxStyleDrift <= thresholds.maxStyleDriftMax;
        const allTierIdentityPass = tierPassRatio >= thresholds.tierPassRatioMin;
        const pass = tierCoverage && identityContinuity && allTierIdentityPass;

        const report = {
            generatedAt: new Date().toISOString(),
            gate: 'Phase 7 visual gate',
            criteria: [
                'Mobile/Medium/High/Ultra tiers preserve artistic identity, not just FPS',
            ],
            thresholds,
            tierReports,
            styleDrift: {
                mean: meanStyleDrift,
                max: maxStyleDrift,
                pairCount: styleDrifts.length,
            },
            checks: {
                tierCoverage,
                identityContinuity,
                allTierIdentityPass,
                passingTierCount,
                tierPassRatio,
            },
            pass,
        };

        this.phase7Validation.lastVisualGate = report;
        return report;
    }

    async capturePhase7Snapshot(label = 'snapshot', options = {}) {
        const settleMs = Number.isFinite(options.settleMs) ? Math.max(0, options.settleMs) : 160;
        const tiers = this.resolvePhase7TierList(options);
        const previousTier = this.phase7QualityTier;
        const tierSnapshots = [];

        try {
            for (const tier of tiers) {
                this.setPhase7QualityTier(tier, { resize: true });
                if (settleMs > 0) {
                    await this.waitForMs(settleMs);
                }
                const signals = await this.collectPhase7TierSignals({
                    forceProbe: options.forceProbe === true,
                });
                tierSnapshots.push({
                    tier,
                    preset: this.phase7QualityPreset ? { ...this.phase7QualityPreset } : null,
                    renderScale: this.phase7RenderScale,
                    canvas: this.getLogicalCanvasSize(),
                    signals,
                });
            }
        } finally {
            this.setPhase7QualityTier(previousTier, { resize: true });
        }

        const snapshot = {
            label,
            generatedAt: new Date().toISOString(),
            backend: this.renderBackend,
            isActive: this.isActive === true,
            canvas: this.getLogicalCanvasSize(),
            resolutionLock: this.getResolutionLock(),
            activeQualityState: this.getPhase7QualityState(),
            tiers: tierSnapshots,
            heroShotChecklist: [...SKY_CHILDREN_PHASE7_HERO_SHOTS],
        };

        const snapshots = this.phase7Validation.snapshots;
        snapshots.push(snapshot);
        if (snapshots.length > this.phase7Validation.maxSnapshots) {
            snapshots.splice(0, snapshots.length - this.phase7Validation.maxSnapshots);
        }
        return snapshot;
    }

    async runPhase7PerformanceGate(options = {}) {
        const thresholds = {
            expectedTierCount: Number.isFinite(options.expectedTierCount)
                ? Math.max(1, Math.floor(options.expectedTierCount))
                : 4,
            tierPassRatioMin: Number.isFinite(options.tierPassRatioMin)
                ? clamp(options.tierPassRatioMin, 0, 1)
                : 1.0,
            sampleCount: Number.isFinite(options.sampleCount)
                ? Math.max(30, Math.floor(options.sampleCount))
                : 240,
            minimumSamples: Number.isFinite(options.minimumSamples)
                ? Math.max(10, Math.floor(options.minimumSamples))
                : 120,
            settleMs: Number.isFinite(options.settleMs) ? Math.max(0, options.settleMs) : 1200,
            timeoutMs: Number.isFinite(options.timeoutMs) ? Math.max(500, options.timeoutMs) : 9000,
            requiredWidth: Number.isFinite(options.requiredWidth) ? Math.max(1, options.requiredWidth) : 1920,
            requiredHeight: Number.isFinite(options.requiredHeight) ? Math.max(1, options.requiredHeight) : 1080,
            strictResolution: options.strictResolution !== false,
            p95FrameMultiplier: Number.isFinite(options.p95FrameMultiplier)
                ? Math.max(1.0, options.p95FrameMultiplier)
                : 1.15,
            maxDroppedFrameRatio: Number.isFinite(options.maxDroppedFrameRatio)
                ? clamp(options.maxDroppedFrameRatio, 0, 1)
                : 0.07,
        };

        if (this.renderBackend !== 'webgpu') {
            const report = {
                generatedAt: new Date().toISOString(),
                gate: 'Phase 7 performance gate',
                reason: 'WebGPU backend is not active.',
                thresholds,
                pass: false,
            };
            this.phase7Validation.lastPerformanceGate = report;
            return report;
        }

        const tiers = this.resolvePhase7TierList(options);
        const previousTier = this.phase7QualityTier;
        const tierReports = [];

        try {
            for (const tier of tiers) {
                this.setPhase7QualityTier(tier, { resize: true });
                if (thresholds.settleMs > 0) {
                    await this.waitForMs(thresholds.settleMs);
                }

                const preset = this.phase7QualityPreset ? { ...this.phase7QualityPreset } : getSkyChildrenPhase7QualityPreset(tier);
                const sceneGate = await this.runPhase4PerformanceGate({
                    targetMs: preset.sceneBudgetMs,
                    sampleCount: thresholds.sampleCount,
                    minimumSamples: thresholds.minimumSamples,
                    settleMs: 0,
                    timeoutMs: thresholds.timeoutMs,
                    requiredWidth: thresholds.requiredWidth,
                    requiredHeight: thresholds.requiredHeight,
                    strictResolution: thresholds.strictResolution,
                    requiredInstanceCount: preset.grassInstances,
                });
                const postGate = await this.runPhase5PerformanceGate({
                    targetMs: preset.postBudgetMs,
                    sampleCount: thresholds.sampleCount,
                    minimumSamples: thresholds.minimumSamples,
                    settleMs: 0,
                    timeoutMs: thresholds.timeoutMs,
                    requiredWidth: thresholds.requiredWidth,
                    requiredHeight: thresholds.requiredHeight,
                    strictResolution: thresholds.strictResolution,
                });
                const frameGate = await this.runPhase6PerformanceGate({
                    targetFps: preset.targetFps,
                    sampleCount: thresholds.sampleCount,
                    minimumSamples: thresholds.minimumSamples,
                    settleMs: 0,
                    timeoutMs: thresholds.timeoutMs,
                    requiredWidth: thresholds.requiredWidth,
                    requiredHeight: thresholds.requiredHeight,
                    strictResolution: thresholds.strictResolution,
                    p95MsLimit: (1000 / Math.max(1, preset.targetFps)) * thresholds.p95FrameMultiplier,
                    maxDroppedFrameRatio: thresholds.maxDroppedFrameRatio,
                });

                const tierFrameBudgetCompliance = sceneGate.pass && postGate.pass && frameGate.pass;
                tierReports.push({
                    tier,
                    preset,
                    renderScale: this.phase7RenderScale,
                    sceneGate,
                    postGate,
                    frameGate,
                    pass: tierFrameBudgetCompliance,
                });
            }
        } finally {
            this.setPhase7QualityTier(previousTier, { resize: true });
        }

        const passingTierCount = tierReports.filter((tier) => tier.pass).length;
        const tierPassRatio = tierReports.length > 0 ? passingTierCount / tierReports.length : 0;
        const sceneBudgetPass = tierReports.every((tier) => tier.sceneGate?.pass === true);
        const postBudgetPass = tierReports.every((tier) => tier.postGate?.pass === true);
        const frameBudgetPass = tierReports.every((tier) => tier.frameGate?.pass === true);
        const tierCoverage = tierReports.length >= thresholds.expectedTierCount;
        const tierFrameBudgetCompliance = tierPassRatio >= thresholds.tierPassRatioMin;
        const pass = tierCoverage && tierFrameBudgetCompliance && sceneBudgetPass && postBudgetPass && frameBudgetPass;

        const report = {
            generatedAt: new Date().toISOString(),
            gate: 'Phase 7 performance gate',
            criteria: [
                'Tier frame budget compliance',
            ],
            thresholds,
            tierReports,
            checks: {
                tierCoverage,
                sceneBudgetPass,
                postBudgetPass,
                frameBudgetPass,
                tierFrameBudgetCompliance,
                passingTierCount,
                tierPassRatio,
            },
            pass,
        };

        this.phase7Validation.lastPerformanceGate = report;
        return report;
    }

    async runPhase7Validation(options = {}) {
        const snapshot = await this.capturePhase7Snapshot(
            options.snapshotLabel || 'phase7-validation',
            options.snapshot || {},
        );
        const visualGate = await this.evaluatePhase7VisualGate(options.visual || {});
        const performanceGate = await this.runPhase7PerformanceGate(options.performance || {});
        const report = {
            generatedAt: new Date().toISOString(),
            phase: 'phase7',
            deliverable: 'Quality-tier QA',
            visualGate,
            performanceGate,
            snapshot,
            heroShotChecklist: [...SKY_CHILDREN_PHASE7_HERO_SHOTS],
            pass: visualGate.pass && performanceGate.pass,
        };
        this.phase7Validation.lastReport = report;
        return report;
    }

    downloadJson(filename, payload) {
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            return false;
        }
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
        return true;
    }

    downloadPhase1ValidationReport(label = 'sky-children-phase1-validation') {
        if (!this.phase1Validation.lastReport) {
            console.warn('[SkyChildrenPhase1] No validation report available to download.');
            return null;
        }
        const filename = `${label}-${this.renderBackend}-${Date.now()}.json`;
        this.downloadJson(filename, this.phase1Validation.lastReport);
        return this.phase1Validation.lastReport;
    }

    downloadPhase2ValidationReport(label = 'sky-children-phase2-validation') {
        if (!this.phase2Validation.lastReport) {
            console.warn('[SkyChildrenPhase2] No validation report available to download.');
            return null;
        }
        const filename = `${label}-${this.renderBackend}-${Date.now()}.json`;
        this.downloadJson(filename, this.phase2Validation.lastReport);
        return this.phase2Validation.lastReport;
    }

    downloadPhase3ValidationReport(label = 'sky-children-phase3-validation') {
        if (!this.phase3Validation.lastReport) {
            console.warn('[SkyChildrenPhase3] No validation report available to download.');
            return null;
        }
        const filename = `${label}-${this.renderBackend}-${Date.now()}.json`;
        this.downloadJson(filename, this.phase3Validation.lastReport);
        return this.phase3Validation.lastReport;
    }

    downloadPhase4ValidationReport(label = 'sky-children-phase4-validation') {
        if (!this.phase4Validation.lastReport) {
            console.warn('[SkyChildrenPhase4] No validation report available to download.');
            return null;
        }
        const filename = `${label}-${this.renderBackend}-${Date.now()}.json`;
        this.downloadJson(filename, this.phase4Validation.lastReport);
        return this.phase4Validation.lastReport;
    }

    downloadPhase5ValidationReport(label = 'sky-children-phase5-validation') {
        if (!this.phase5Validation.lastReport) {
            console.warn('[SkyChildrenPhase5] No validation report available to download.');
            return null;
        }
        const filename = `${label}-${this.renderBackend}-${Date.now()}.json`;
        this.downloadJson(filename, this.phase5Validation.lastReport);
        return this.phase5Validation.lastReport;
    }

    downloadPhase6ValidationReport(label = 'sky-children-phase6-validation') {
        if (!this.phase6Validation.lastReport) {
            console.warn('[SkyChildrenPhase6] No validation report available to download.');
            return null;
        }
        const filename = `${label}-${this.renderBackend}-${Date.now()}.json`;
        this.downloadJson(filename, this.phase6Validation.lastReport);
        return this.phase6Validation.lastReport;
    }

    downloadPhase7ValidationReport(label = 'sky-children-phase7-validation') {
        if (!this.phase7Validation.lastReport) {
            console.warn('[SkyChildrenPhase7] No validation report available to download.');
            return null;
        }
        const filename = `${label}-${this.renderBackend}-${Date.now()}.json`;
        this.downloadJson(filename, this.phase7Validation.lastReport);
        return this.phase7Validation.lastReport;
    }

    installPhase1Helpers() {
        if (typeof window === 'undefined') return;
        window.skyChildrenPhase1 = {
            snapshot: (label = 'snapshot') => this.capturePhase1Snapshot(label),
            visualGate: (options = {}) => this.evaluatePhase1VisualGate(options),
            perfGate: (options = {}) => this.runPhase1PerformanceGate(options),
            validate: (options = {}) => this.runPhase1Validation(options),
            report: () => this.phase1Validation.lastReport,
            download: (label) => this.downloadPhase1ValidationReport(label),
            heroShots: () => [...SKY_CHILDREN_PHASE1_HERO_SHOTS],
            setResolutionLock: (width = 1920, height = 1080, options = {}) => this.setResolutionLock(width, height, options),
            clearResolutionLock: () => this.clearResolutionLock(),
            resolutionLock: () => this.getResolutionLock(),
        };
        console.log('[SkyChildrenPhase1] Helpers: window.skyChildrenPhase1.snapshot(label), visualGate(options), perfGate(options), validate(options), report(), download(label), heroShots(), setResolutionLock(width,height,options), clearResolutionLock(), resolutionLock()');
    }

    removePhase1Helpers() {
        if (typeof window !== 'undefined' && window.skyChildrenPhase1) {
            delete window.skyChildrenPhase1;
        }
    }

    installPhase2Helpers() {
        if (typeof window === 'undefined') return;
        window.skyChildrenPhase2 = {
            snapshot: (label = 'snapshot') => this.capturePhase2Snapshot(label),
            visualGate: (options = {}) => this.evaluatePhase2VisualGate(options),
            perfGate: (options = {}) => this.runPhase2PerformanceGate(options),
            validate: (options = {}) => this.runPhase2Validation(options),
            report: () => this.phase2Validation.lastReport,
            download: (label) => this.downloadPhase2ValidationReport(label),
            heroShots: () => [...SKY_CHILDREN_PHASE2_HERO_SHOTS],
            setResolutionLock: (width = 1920, height = 1080, options = {}) => this.setResolutionLock(width, height, options),
            clearResolutionLock: () => this.clearResolutionLock(),
            resolutionLock: () => this.getResolutionLock(),
        };
        console.log('[SkyChildrenPhase2] Helpers: window.skyChildrenPhase2.snapshot(label), visualGate(options), perfGate(options), validate(options), report(), download(label), heroShots(), setResolutionLock(width,height,options), clearResolutionLock(), resolutionLock()');
    }

    removePhase2Helpers() {
        if (typeof window !== 'undefined' && window.skyChildrenPhase2) {
            delete window.skyChildrenPhase2;
        }
    }

    installPhase3Helpers() {
        if (typeof window === 'undefined') return;
        window.skyChildrenPhase3 = {
            snapshot: (label = 'snapshot') => this.capturePhase3Snapshot(label),
            visualGate: (options = {}) => this.evaluatePhase3VisualGate(options),
            perfGate: (options = {}) => this.runPhase3PerformanceGate(options),
            validate: (options = {}) => this.runPhase3Validation(options),
            report: () => this.phase3Validation.lastReport,
            download: (label) => this.downloadPhase3ValidationReport(label),
            heroShots: () => [...SKY_CHILDREN_PHASE3_HERO_SHOTS],
            setResolutionLock: (width = 1920, height = 1080, options = {}) => this.setResolutionLock(width, height, options),
            clearResolutionLock: () => this.clearResolutionLock(),
            resolutionLock: () => this.getResolutionLock(),
        };
        console.log('[SkyChildrenPhase3] Helpers: window.skyChildrenPhase3.snapshot(label), visualGate(options), perfGate(options), validate(options), report(), download(label), heroShots(), setResolutionLock(width,height,options), clearResolutionLock(), resolutionLock()');
    }

    removePhase3Helpers() {
        if (typeof window !== 'undefined' && window.skyChildrenPhase3) {
            delete window.skyChildrenPhase3;
        }
    }

    installPhase4Helpers() {
        if (typeof window === 'undefined') return;
        window.skyChildrenPhase4 = {
            snapshot: (label = 'snapshot') => this.capturePhase4Snapshot(label),
            visualGate: (options = {}) => this.evaluatePhase4VisualGate(options),
            perfGate: (options = {}) => this.runPhase4PerformanceGate(options),
            validate: (options = {}) => this.runPhase4Validation(options),
            report: () => this.phase4Validation.lastReport,
            download: (label) => this.downloadPhase4ValidationReport(label),
            heroShots: () => [...SKY_CHILDREN_PHASE4_HERO_SHOTS],
            setResolutionLock: (width = 1920, height = 1080, options = {}) => this.setResolutionLock(width, height, options),
            clearResolutionLock: () => this.clearResolutionLock(),
            resolutionLock: () => this.getResolutionLock(),
            setInstanceCount: (count) => this.setFoliageInstanceCount(count),
            instanceCount: () => this.foliageState.instanceCount,
        };
        console.log('[SkyChildrenPhase4] Helpers: window.skyChildrenPhase4.snapshot(label), visualGate(options), perfGate(options), validate(options), report(), download(label), heroShots(), setResolutionLock(width,height,options), clearResolutionLock(), resolutionLock(), setInstanceCount(count), instanceCount()');
    }

    removePhase4Helpers() {
        if (typeof window !== 'undefined' && window.skyChildrenPhase4) {
            delete window.skyChildrenPhase4;
        }
    }

    installPhase5Helpers() {
        if (typeof window === 'undefined') return;
        window.skyChildrenPhase5 = {
            snapshot: (label = 'snapshot', options = {}) => this.capturePhase5Snapshot(label, options),
            visualGate: (options = {}) => this.evaluatePhase5VisualGate(options),
            perfGate: (options = {}) => this.runPhase5PerformanceGate(options),
            validate: (options = {}) => this.runPhase5Validation(options),
            report: () => this.phase5Validation.lastReport,
            download: (label) => this.downloadPhase5ValidationReport(label),
            heroShots: () => [...SKY_CHILDREN_PHASE5_HERO_SHOTS],
            setResolutionLock: (width = 1920, height = 1080, options = {}) => this.setResolutionLock(width, height, options),
            clearResolutionLock: () => this.clearResolutionLock(),
            resolutionLock: () => this.getResolutionLock(),
            setPostState: (overrides = {}) => this.setPhase5PostState(overrides),
            postState: () => this.getPhase5PostState(),
            postSignals: (options = {}) => this.getPhase5PostSignals(options),
            postProbe: () => this.phase5Validation.lastFrameProbe,
        };
        console.log('[SkyChildrenPhase5] Helpers: window.skyChildrenPhase5.snapshot(label,options), visualGate(options), perfGate(options), validate(options), report(), download(label), heroShots(), setResolutionLock(width,height,options), clearResolutionLock(), resolutionLock(), setPostState(overrides), postState(), postSignals(options), postProbe()');
    }

    removePhase5Helpers() {
        if (typeof window !== 'undefined' && window.skyChildrenPhase5) {
            delete window.skyChildrenPhase5;
        }
    }

    installPhase6Helpers() {
        if (typeof window === 'undefined') return;
        window.skyChildrenPhase6 = {
            snapshot: (label = 'snapshot') => this.capturePhase6Snapshot(label),
            shotReview: () => this.getPhase6ShotReviewSignals(),
            cameraPaths: () => this.getPhase6CameraPathBookmarks(),
            visualGate: (options = {}) => this.evaluatePhase6VisualGate(options),
            perfGate: (options = {}) => this.runPhase6PerformanceGate(options),
            validate: (options = {}) => this.runPhase6Validation(options),
            report: () => this.phase6Validation.lastReport,
            download: (label) => this.downloadPhase6ValidationReport(label),
            heroShots: () => [...SKY_CHILDREN_PHASE6_HERO_SHOTS],
            setResolutionLock: (width = 1920, height = 1080, options = {}) => this.setResolutionLock(width, height, options),
            clearResolutionLock: () => this.clearResolutionLock(),
            resolutionLock: () => this.getResolutionLock(),
        };
        console.log('[SkyChildrenPhase6] Helpers: window.skyChildrenPhase6.snapshot(label), shotReview(), cameraPaths(), visualGate(options), perfGate(options), validate(options), report(), download(label), heroShots(), setResolutionLock(width,height,options), clearResolutionLock(), resolutionLock()');
    }

    removePhase6Helpers() {
        if (typeof window !== 'undefined' && window.skyChildrenPhase6) {
            delete window.skyChildrenPhase6;
        }
    }

    installPhase7Helpers() {
        if (typeof window === 'undefined') return;
        window.skyChildrenPhase7 = {
            tiers: () => this.getPhase7QualityPresets(),
            tier: () => this.phase7QualityTier,
            setTier: (tier, options = {}) => this.setPhase7QualityTier(tier, options),
            state: () => this.getPhase7QualityState(),
            snapshot: (label = 'snapshot', options = {}) => this.capturePhase7Snapshot(label, options),
            visualGate: (options = {}) => this.evaluatePhase7VisualGate(options),
            perfGate: (options = {}) => this.runPhase7PerformanceGate(options),
            validate: (options = {}) => this.runPhase7Validation(options),
            report: () => this.phase7Validation.lastReport,
            download: (label) => this.downloadPhase7ValidationReport(label),
            heroShots: () => [...SKY_CHILDREN_PHASE7_HERO_SHOTS],
            setResolutionLock: (width = 1920, height = 1080, options = {}) => this.setResolutionLock(width, height, options),
            clearResolutionLock: () => this.clearResolutionLock(),
            resolutionLock: () => this.getResolutionLock(),
        };
        console.log('[SkyChildrenPhase7] Helpers: window.skyChildrenPhase7.tiers(), tier(), setTier(tier,options), state(), snapshot(label,options), visualGate(options), perfGate(options), validate(options), report(), download(label), heroShots(), setResolutionLock(width,height,options), clearResolutionLock(), resolutionLock()');
    }

    removePhase7Helpers() {
        if (typeof window !== 'undefined' && window.skyChildrenPhase7) {
            delete window.skyChildrenPhase7;
        }
    }

    stop() {
        this.clearPendingAsyncTimeouts();
        this.removeEventListeners();
        this.removePhase1Helpers();
        this.removePhase2Helpers();
        this.removePhase3Helpers();
        this.removePhase4Helpers();
        this.removePhase5Helpers();
        this.removePhase6Helpers();
        this.removePhase7Helpers();
        this.lastTime = 0;
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        super.stop();
    }

    cleanup() {
        this.clearPendingAsyncTimeouts();
        this.removeEventListeners();
        this.removePhase1Helpers();
        this.removePhase2Helpers();
        this.removePhase3Helpers();
        this.removePhase4Helpers();
        this.removePhase5Helpers();
        this.removePhase6Helpers();
        this.removePhase7Helpers();
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.disposeWebGPU();
        this.canvas = null;
        this.ctx = null;
        super.cleanup();
    }
}
