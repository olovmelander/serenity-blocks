/* eslint-disable import/no-unresolved */
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import {
    getLowerVoidEmberTier,
    getVoidEmberPresetFromEffectQuality,
    getVoidEmberQualityPreset,
    resolveVoidEmberTier,
} from './void-ember-presets.js';
import { StellarConductor } from './composition/stellar-conductor.js';
import { createStellarDebugOverlay } from './composition/stellar-debug-overlay.js';
import commonWGSL from './wgsl/void-ember-common.wgsl?raw';
import environmentWGSL from './wgsl/environment.wgsl?raw';
import flowWGSL from './wgsl/flow.wgsl?raw';
import particlesWGSL from './wgsl/particles.wgsl?raw';
import sceneWGSL from './wgsl/scene.wgsl?raw';
import lensFlareWGSL from './wgsl/lens-flare.wgsl?raw';
import bloomPrefilterWGSL from './wgsl/bloom-prefilter.wgsl?raw';
import bloomDownWGSL from './wgsl/bloom-down.wgsl?raw';
import bloomUpWGSL from './wgsl/bloom-up.wgsl?raw';
import postWGSL from './wgsl/post.wgsl?raw';
import presentWGSL from './wgsl/present.wgsl?raw';

// Shared WGSL helpers (hash/noise/FBM/black-body/scattering) are concatenated
// ahead of any module that needs them, so there is one source of truth.
const withCommon = (moduleSource) => `${commonWGSL}\n${moduleSource}`;

const GPU_BUFFER_USAGE_UNIFORM = globalThis.GPUBufferUsage?.UNIFORM ?? 0x40;
const GPU_BUFFER_USAGE_COPY_DST = globalThis.GPUBufferUsage?.COPY_DST ?? 0x08;
const GPU_BUFFER_USAGE_COPY_SRC = globalThis.GPUBufferUsage?.COPY_SRC ?? 0x04;
const GPU_BUFFER_USAGE_STORAGE = globalThis.GPUBufferUsage?.STORAGE ?? 0x80;
const GPU_BUFFER_USAGE_QUERY_RESOLVE = globalThis.GPUBufferUsage?.QUERY_RESOLVE ?? 0x200;
const GPU_BUFFER_USAGE_MAP_READ = globalThis.GPUBufferUsage?.MAP_READ ?? 0x01;
const GPU_TEXTURE_USAGE_COPY_SRC = globalThis.GPUTextureUsage?.COPY_SRC ?? 0x01;
const GPU_TEXTURE_USAGE_COPY_DST = globalThis.GPUTextureUsage?.COPY_DST ?? 0x02;
const GPU_TEXTURE_USAGE_TEXTURE_BINDING = globalThis.GPUTextureUsage?.TEXTURE_BINDING ?? 0x04;
const GPU_TEXTURE_USAGE_RENDER_ATTACHMENT = globalThis.GPUTextureUsage?.RENDER_ATTACHMENT ?? 0x10;
const GPU_MAP_MODE_READ = globalThis.GPUMapMode?.READ ?? 0x1;

const UNIFORM_FLOATS = 48;
const BYTES_PER_FLOAT = 4;
const UNIFORM_BYTES = UNIFORM_FLOATS * BYTES_PER_FLOAT;
const BYTES_PER_FLOW_CELL = 16;
const BYTES_PER_PARTICLE = 32;

const UNIFORM = Object.freeze({
    resolution: 0,
    sim: 4,
    ember: 8,
    reaction: 12,
    quality: 16,
    post: 20,
    colorA: 24,
    colorB: 28,
    misc: 32,
    fx: 36,
    star0: 40, // temperature, agitation, coronaEnergy, breath
    star1: 44, // novaFlash, cmePulse, cameraPush, reserved
});

// Color temperature stops for slow evolution cycle
// Each: [core_r, core_g, core_b, outer_r, outer_g, outer_b]
const COLOR_STOPS = Object.freeze([
    [7.2, 1.15, 0.16, 1.8, 0.24, 0.05], // Deep magma red
    [8.5, 2.4, 0.22, 2.4, 0.55, 0.06], // Volcanic orange
    [9.2, 4.8, 0.85, 3.0, 1.2, 0.15], // Golden amber
    [10.0, 7.5, 3.2, 3.8, 2.2, 0.8], // White-hot
    [8.5, 2.4, 0.22, 2.4, 0.55, 0.06], // Back through orange
]);
const COLOR_CYCLE_PERIOD = 180; // seconds for full cycle (~3 minutes)

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function average(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function combineFlags(...flags) {
    return flags.reduce((sum, flag) => sum + flag, 0);
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
        format: null,
        sceneFormat: null,
        sampler: null,
        uniformBuffer: null,
        flowBuffers: [],
        particleBuffer: null,
        flowComputePipeline: null,
        particleComputePipeline: null,
        scenePipeline: null,
        particlePipeline: null,
        bloomPrefilterPipeline: null,
        bloomDownPipeline: null,
        bloomUpPipeline: null,
        postPipeline: null,
        presentPipeline: null,
        flowComputeBindGroups: [],
        particleComputeBindGroups: [],
        sceneBindGroups: [],
        bloomPrefilterBindGroup: null,
        bloomDownBindGroups: [],
        bloomUpBindGroups: [],
        postBindGroup: null,
        presentBindGroup: null,
        sceneTexture: null,
        postTexture: null,
        historyTexture: null,
        bloomTextures: [],
        bloomViews: [],
        bloomLevels: 0,
        sceneView: null,
        postView: null,
        historyView: null,
        currentFlowIndex: 0,
        timestampQuery: null,
        gpuPassSamples: [],
    };
}

export default class VoidEmberTheme extends BaseTheme {
    constructor() {
        super('void-ember');

        this.resourceProfile = 'heavy-gpu';
        this.canvas = null;
        this.ctx2d = null;
        this.renderBackend = 'none';
        this.webgpu = createEmptyWebGPUState();
        this.eventUnsubscribers = [];
        this.frameTimes = [];
        this.cpuPostTimes = [];
        this.buildVersion = 0;
        this.rebuildScheduled = false;
        this.performanceTierCap = null;
        this.lastFrameAt = 0;
        this.frameCounter = 0;
        this.fallbackParticles = [];

        this.runtime = {
            time: 0,
            delta: 1 / 60,
            eventEnergy: 0,
            eventTarget: 0,
            comboEnergy: 0,
            comboTarget: 0,
            turbulence: 0.22,
            turbulenceTarget: 0.22,
            pulse: 0,
            pulseTarget: 0,
            lineEnergy: 0,
            lineTarget: 0,
            collapse: 0,
            collapseTarget: 0,
            shockwave: 0,
            shockwaveTarget: 0,
            flare: 0,
            flareTarget: 0,
            hardDropFlash: 0,
            hardDropFlashTarget: 0,
            intensity: 0,
            intensityTarget: 0,
        };

        this.currentTier = null;
        this.qualityPreset = getVoidEmberPresetFromEffectQuality(this.getGraphicsQuality());

        // Phase 0: the new reactive spine. Runs alongside the legacy `runtime`
        // channels (which still drive the uniform/WGSL untouched) so we can prove
        // it tracks gameplay via the `?voidEmber=1` overlay. Phases 1+ migrate the
        // render path onto the conductor.
        this.stellarConductor = new StellarConductor();
        this.stellarDebug = null;
        this.stellarDebugEnabled = false;
        if (typeof window !== 'undefined') {
            try {
                this.stellarDebugEnabled = new URLSearchParams(window.location.search).get('voidEmber') === '1';
            } catch {
                this.stellarDebugEnabled = false;
            }
        }
    }

    async init() {
        // No external assets required.
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    resolveRequestedTier() {
        const requestedTier = resolveVoidEmberTier(this.getGraphicsQuality());
        if (!this.performanceTierCap) {
            return requestedTier;
        }

        const order = ['low', 'medium', 'high', 'ultra'];
        const requestedIndex = order.indexOf(requestedTier);
        const cappedIndex = order.indexOf(this.performanceTierCap);
        if (requestedIndex === -1 || cappedIndex === -1) {
            return requestedTier;
        }
        return order[Math.min(requestedIndex, cappedIndex)];
    }

    getOrCreateThemeContainer() {
        const containerId = `${this.name}-theme`;
        let container = document.getElementById(containerId);
        if (container) {
            return container;
        }

        const backgroundRoot = document.querySelector('.background-container');
        if (!backgroundRoot) {
            return null;
        }

        container = document.createElement('div');
        container.id = containerId;
        container.className = 'theme-container';
        backgroundRoot.appendChild(container);
        this.registerContainer(container);
        return container;
    }

    createCanvasElement(container) {
        // Defensive: never leave a stale void-ember canvas anywhere in the DOM.
        // A leftover canvas keeps its own WebGPU context + render loop alive,
        // drawing a SECOND star on its own clock/anchor (the "two stars" bug).
        document.querySelectorAll(`#${this.name}-canvas`).forEach((stale) => stale.remove());

        const canvas = document.createElement('canvas');
        canvas.id = `${this.name}-canvas`;
        canvas.style.position = 'absolute';
        canvas.style.inset = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.pointerEvents = 'none';
        canvas.style.background = '#000';
        canvas.style.opacity = '1';
        canvas.style.zIndex = '0';
        canvas.style.imageRendering = 'auto';
        container.appendChild(canvas);
        this.canvas = canvas;
        return canvas;
    }

    replaceCanvas(container) {
        if (this.canvas?.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        return this.createCanvasElement(container);
    }

    async createScene() {
        const buildVersion = ++this.buildVersion;
        this.clearEventUnsubscribers();
        this.resetAnimationLoop();
        this.teardownRuntime();

        const requestedTier = this.resolveRequestedTier();
        this.currentTier = requestedTier;
        this.qualityPreset = getVoidEmberQualityPreset(requestedTier);

        const container = this.getOrCreateThemeContainer();
        if (!container) {
            return;
        }

        container.innerHTML = '';
        if (this.isActive || this.isPaused) {
            document.querySelectorAll('.theme-container').forEach((themeContainer) => {
                themeContainer.classList.remove('active');
            });
            container.classList.add('active');
        }

        this.createCanvasElement(container);
        this.resizeCanvas();
        this.setupEventListeners();

        this.stellarConductor.reset();
        if (this.stellarDebugEnabled && !this.stellarDebug) {
            this.stellarDebug = createStellarDebugOverlay();
        }

        const hasWebGPU = await this.initWebGPU(buildVersion);
        if (!hasWebGPU && buildVersion !== this.buildVersion) {
            return;
        }

        if (!hasWebGPU) {
            this.replaceCanvas(container);
            this.init2DFallback();
        }

        this.lastFrameAt = performance.now();
        this.startAnimation();
    }

    async initWebGPU(buildVersion) {
        if (!this.canvas || typeof navigator === 'undefined' || !navigator.gpu) {
            return false;
        }

        try {
            const adapter = await navigator.gpu.requestAdapter(getWebGPUAdapterOptions());
            if (!adapter || buildVersion !== this.buildVersion) {
                return false;
            }

            const supportsTimestampQuery = typeof adapter.features?.has === 'function'
                && adapter.features.has('timestamp-query');

            let device;
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

            if (!device || buildVersion !== this.buildVersion) {
                return false;
            }

            const context = this.canvas.getContext('webgpu');
            if (!context) {
                return false;
            }

            const format = navigator.gpu.getPreferredCanvasFormat();
            context.configure({
                device,
                format,
                alphaMode: 'premultiplied',
            });

            let sceneFormat = 'rgba16float';
            try {
                const probeTexture = device.createTexture({
                    size: { width: 1, height: 1, depthOrArrayLayers: 1 },
                    format: sceneFormat,
                    usage: combineFlags(
                        GPU_TEXTURE_USAGE_RENDER_ATTACHMENT,
                        GPU_TEXTURE_USAGE_TEXTURE_BINDING,
                    ),
                });
                probeTexture.destroy();
            } catch {
                sceneFormat = format;
            }

            this.webgpu = createEmptyWebGPUState();
            this.webgpu.adapter = adapter;
            this.webgpu.device = device;
            this.webgpu.context = context;
            this.webgpu.format = format;
            this.webgpu.sceneFormat = sceneFormat;
            this.webgpu.sampler = device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
            });

            this.createPipelines();
            this.createOrResizeResources();
            this.setupTimestampQuery();
            this.setupRendererResilience(null, {
                webgpuDevice: device,
                onDeviceLost: (info) => this.handleWebGPUDeviceLost(info),
            });

            this.renderBackend = 'webgpu';
            return true;
        } catch (error) {
            console.warn('[VoidEmber] WebGPU init failed, switching to 2D fallback:', error);
            this.teardownGPUResources();
            return false;
        }
    }

    createPipelines() {
        const { device, sceneFormat, format } = this.webgpu;
        if (!device) {
            return;
        }

        const flowComputeModule = device.createShaderModule({
            label: 'void-ember/flow-compute',
            code: withCommon(flowWGSL),
        });
        const particleComputeModule = device.createShaderModule({
            label: 'void-ember/particle-compute',
            code: particlesWGSL,
        });
        const sceneModule = device.createShaderModule({
            label: 'void-ember/scene',
            code: withCommon(`${environmentWGSL}\n${sceneWGSL}`),
        });
        const postModule = device.createShaderModule({
            label: 'void-ember/post',
            code: withCommon(`${lensFlareWGSL}\n${postWGSL}`),
        });
        const presentModule = device.createShaderModule({
            label: 'void-ember/present',
            code: presentWGSL,
        });

        this.webgpu.flowComputePipeline = device.createComputePipeline({
            label: 'void-ember/flow-compute-pipeline',
            layout: 'auto',
            compute: {
                module: flowComputeModule,
                entryPoint: 'main',
            },
        });

        this.webgpu.particleComputePipeline = device.createComputePipeline({
            label: 'void-ember/particle-compute-pipeline',
            layout: 'auto',
            compute: {
                module: particleComputeModule,
                entryPoint: 'main',
            },
        });

        this.webgpu.scenePipeline = device.createRenderPipeline({
            label: 'void-ember/scene-pipeline',
            layout: 'auto',
            vertex: {
                module: sceneModule,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: sceneModule,
                entryPoint: 'fs_main',
                targets: [{ format: sceneFormat }],
            },
            primitive: {
                topology: 'triangle-list',
            },
        });

        this.webgpu.particlePipeline = device.createRenderPipeline({
            label: 'void-ember/particle-pipeline',
            layout: 'auto',
            vertex: {
                module: device.createShaderModule({
                    label: 'void-ember/particle-visuals',
                    code: `
struct Params {
    resolution: vec4f,
    sim: vec4f,
    ember: vec4f,
    reaction: vec4f,
    quality: vec4f,
    post: vec4f,
    colorA: vec4f,
    colorB: vec4f,
    misc: vec4f,
    fx: vec4f,
};

struct Particle {
    pos_vel: vec4f,
    life_data: vec4f,
};

struct VSOut {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) alpha: f32,
    @location(2) heat: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

@vertex
fn vs_main(
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32,
) -> VSOut {
    let quad = array<vec2f, 6>(
        vec2f(-1.0, -1.0),
        vec2f(1.0, -1.0),
        vec2f(-1.0, 1.0),
        vec2f(-1.0, 1.0),
        vec2f(1.0, -1.0),
        vec2f(1.0, 1.0),
    );

    let particle = particles[instance_index];
    let life = particle.life_data.x;
    let size_px = particle.life_data.z;
    let alpha = particle.life_data.w * clamp(life, 0.0, 1.0);

    var out: VSOut;
    if (life <= 0.001 || alpha <= 0.001) {
        out.position = vec4f(-2.0, -2.0, 0.0, 1.0);
        out.uv = vec2f(0.0);
        out.alpha = 0.0;
        out.heat = 0.0;
        return out;
    }

    // Class by particle fraction (matches particles.wgsl): spark / cinder / dust.
    let frac = f32(instance_index) / max(params.quality.w, 1.0);
    let is_spark = frac < 0.5;
    let is_cinder = frac >= 0.5 && frac < 0.82;

    let pos = particle.pos_vel.xy;
    let vel = particle.pos_vel.zw;
    let res = params.resolution.xy;
    let inv_res = params.resolution.zw;

    // Velocity-stretched quad (pixel space → aspect-correct): sparks streak,
    // cinders mildly, dust stays round.
    let vel_px = vel * res;
    let speed_px = length(vel_px);
    let dir = select(vec2f(1.0, 0.0), vel_px / max(speed_px, 1e-5), speed_px > 1e-5);
    let perp = vec2f(-dir.y, dir.x);
    var trail = 0.0;
    if (is_spark) {
        trail = 2.4;
    } else if (is_cinder) {
        trail = 0.8;
    }
    let stretch = 1.0 + trail * clamp(speed_px * 0.6, 0.0, 4.0);

    let local = quad[vertex_index];
    let corner_px = dir * (local.x * size_px * stretch) + perp * (local.y * size_px);
    let final_uv = pos + corner_px * inv_res;
    out.position = vec4f(final_uv * 2.0 - 1.0, 0.0, 1.0);
    out.uv = local * 0.5 + vec2f(0.5);
    out.alpha = alpha;

    // Per-class black-body temperature (0..1): sparks hot, cinders warm, dust cool
    // (and dust warms as it catches the star's light).
    let rnd = fract(particle.life_data.y * 13.17);
    var temp = 0.3;
    if (is_spark) {
        temp = (0.5 + rnd * 0.4) * (0.6 + 0.4 * clamp(life, 0.0, 1.0));
    } else if (is_cinder) {
        temp = (0.28 + rnd * 0.22) * (0.7 + 0.3 * clamp(life, 0.0, 1.0));
    } else {
        let to_star = (pos - params.ember.xy) * vec2f(max(params.sim.z, 0.001), 1.0);
        let prox = exp(-length(to_star) * 4.0);
        temp = 0.16 + rnd * 0.12 + prox * 0.4;
    }
    out.heat = clamp(temp, 0.0, 1.0);
    return out;
}
`,
                }),
                entryPoint: 'vs_main',
            },
            fragment: {
                module: device.createShaderModule({
                    label: 'void-ember/particle-visuals-fragment',
                    code: `
struct VSOut {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) alpha: f32,
    @location(2) heat: f32,
};

// Black-body ramp (mirrors wgsl/void-ember-common.wgsl ve_blackbody) so sparks
// share the same physical colour model as the star.
fn bb(t: f32) -> vec3f {
    let x = clamp(t, 0.0, 1.0);
    let c0 = vec3f(0.35, 0.02, 0.005);
    let c1 = vec3f(1.10, 0.18, 0.03);
    let c2 = vec3f(1.90, 0.75, 0.18);
    let c3 = vec3f(2.60, 1.90, 1.10);
    let c4 = vec3f(2.20, 2.40, 3.20);
    let f = x * 4.0;
    if (f < 1.0) { return mix(c0, c1, smoothstep(0.0, 1.0, f)); }
    if (f < 2.0) { return mix(c1, c2, smoothstep(0.0, 1.0, f - 1.0)); }
    if (f < 3.0) { return mix(c2, c3, smoothstep(0.0, 1.0, f - 2.0)); }
    return mix(c3, c4, smoothstep(0.0, 1.0, f - 3.0));
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4f {
    let local = input.uv * 2.0 - 1.0;
    let radius = dot(local, local);
    let halo = exp(-radius * 4.6);
    let core = exp(-radius * 36.0);
    // input.heat already carries the per-particle black-body temperature.
    let temp = input.heat;
    let color = bb(temp);
    let alpha = input.alpha * (halo * 0.72 + core * 0.9);
    let crisp_color = mix(color, bb(min(1.0, temp + 0.3)), core * 0.8);
    return vec4f(crisp_color * alpha, alpha);
}
`,
                }),
                entryPoint: 'fs_main',
                targets: [{
                    format: sceneFormat,
                    blend: {
                        color: {
                            srcFactor: 'one',
                            dstFactor: 'one',
                            operation: 'add',
                        },
                        alpha: {
                            srcFactor: 'one',
                            dstFactor: 'one',
                            operation: 'add',
                        },
                    },
                }],
            },
            primitive: {
                topology: 'triangle-list',
            },
        });

        this.webgpu.postPipeline = device.createRenderPipeline({
            label: 'void-ember/post-pipeline',
            layout: 'auto',
            vertex: {
                module: postModule,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: postModule,
                entryPoint: 'fs_main',
                targets: [{ format: sceneFormat }],
            },
            primitive: {
                topology: 'triangle-list',
            },
        });

        this.webgpu.presentPipeline = device.createRenderPipeline({
            label: 'void-ember/present-pipeline',
            layout: 'auto',
            vertex: {
                module: presentModule,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: presentModule,
                entryPoint: 'fs_main',
                targets: [{ format }],
            },
            primitive: {
                topology: 'triangle-list',
            },
        });

        // --- Dual-filter bloom pyramid (prefilter → downsample → additive upsample) ---
        const bloomPrefilterModule = device.createShaderModule({
            label: 'void-ember/bloom-prefilter',
            code: bloomPrefilterWGSL,
        });
        const bloomDownModule = device.createShaderModule({
            label: 'void-ember/bloom-down',
            code: bloomDownWGSL,
        });
        const bloomUpModule = device.createShaderModule({
            label: 'void-ember/bloom-up',
            code: bloomUpWGSL,
        });

        this.webgpu.bloomPrefilterPipeline = device.createRenderPipeline({
            label: 'void-ember/bloom-prefilter-pipeline',
            layout: 'auto',
            vertex: { module: bloomPrefilterModule, entryPoint: 'vs_main' },
            fragment: {
                module: bloomPrefilterModule,
                entryPoint: 'fs_main',
                targets: [{ format: sceneFormat }],
            },
            primitive: { topology: 'triangle-list' },
        });

        this.webgpu.bloomDownPipeline = device.createRenderPipeline({
            label: 'void-ember/bloom-down-pipeline',
            layout: 'auto',
            vertex: { module: bloomDownModule, entryPoint: 'vs_main' },
            fragment: {
                module: bloomDownModule,
                entryPoint: 'fs_main',
                targets: [{ format: sceneFormat }],
            },
            primitive: { topology: 'triangle-list' },
        });

        this.webgpu.bloomUpPipeline = device.createRenderPipeline({
            label: 'void-ember/bloom-up-pipeline',
            layout: 'auto',
            vertex: { module: bloomUpModule, entryPoint: 'vs_main' },
            fragment: {
                module: bloomUpModule,
                entryPoint: 'fs_main',
                targets: [{
                    format: sceneFormat,
                    // Additive: each upsampled level accumulates onto the larger one.
                    blend: {
                        color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                        alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                    },
                }],
            },
            primitive: { topology: 'triangle-list' },
        });
    }

    createOrResizeResources() {
        const { device } = this.webgpu;
        if (!device || !this.canvas) {
            return;
        }

        this.resizeCanvas();
        this.destroyGPUTextures();
        this.destroyGPUBuffers();

        this.webgpu.uniformBuffer = device.createBuffer({
            size: UNIFORM_BYTES,
            usage: combineFlags(GPU_BUFFER_USAGE_UNIFORM, GPU_BUFFER_USAGE_COPY_DST),
        });

        const flowCellCount = this.qualityPreset.flowGridWidth * this.qualityPreset.flowGridHeight;
        const flowBufferSize = flowCellCount * BYTES_PER_FLOW_CELL;
        this.webgpu.flowBuffers = [
            device.createBuffer({
                size: flowBufferSize,
                usage: combineFlags(GPU_BUFFER_USAGE_STORAGE, GPU_BUFFER_USAGE_COPY_DST),
            }),
            device.createBuffer({
                size: flowBufferSize,
                usage: combineFlags(GPU_BUFFER_USAGE_STORAGE, GPU_BUFFER_USAGE_COPY_DST),
            }),
        ];
        this.webgpu.currentFlowIndex = 0;

        const particleBufferSize = this.qualityPreset.particleCount * BYTES_PER_PARTICLE;
        this.webgpu.particleBuffer = device.createBuffer({
            size: particleBufferSize,
            usage: combineFlags(GPU_BUFFER_USAGE_STORAGE, GPU_BUFFER_USAGE_COPY_DST),
        });

        const textureSize = {
            width: Math.max(1, this.canvas.width),
            height: Math.max(1, this.canvas.height),
            depthOrArrayLayers: 1,
        };
        const textureUsage = combineFlags(
            GPU_TEXTURE_USAGE_RENDER_ATTACHMENT,
            GPU_TEXTURE_USAGE_TEXTURE_BINDING,
            GPU_TEXTURE_USAGE_COPY_SRC,
            GPU_TEXTURE_USAGE_COPY_DST,
        );

        this.webgpu.sceneTexture = device.createTexture({
            size: textureSize,
            format: this.webgpu.sceneFormat,
            usage: textureUsage,
        });
        this.webgpu.postTexture = device.createTexture({
            size: textureSize,
            format: this.webgpu.sceneFormat,
            usage: textureUsage,
        });
        this.webgpu.historyTexture = device.createTexture({
            size: textureSize,
            format: this.webgpu.sceneFormat,
            usage: textureUsage,
        });

        this.webgpu.sceneView = this.webgpu.sceneTexture.createView();
        this.webgpu.postView = this.webgpu.postTexture.createView();
        this.webgpu.historyView = this.webgpu.historyTexture.createView();

        // Bloom mip chain — half-res base, halving each level, capped by preset.
        const bloomUsage = combineFlags(
            GPU_TEXTURE_USAGE_RENDER_ATTACHMENT,
            GPU_TEXTURE_USAGE_TEXTURE_BINDING,
        );
        const maxMips = Math.max(1, this.qualityPreset.bloomMips ?? 5);
        this.webgpu.bloomTextures = [];
        this.webgpu.bloomViews = [];
        let bw = Math.max(1, Math.floor(this.canvas.width / 2));
        let bh = Math.max(1, Math.floor(this.canvas.height / 2));
        for (let level = 0; level < maxMips; level++) {
            const tex = device.createTexture({
                size: { width: bw, height: bh, depthOrArrayLayers: 1 },
                format: this.webgpu.sceneFormat,
                usage: bloomUsage,
            });
            this.webgpu.bloomTextures.push(tex);
            this.webgpu.bloomViews.push(tex.createView());
            bw = Math.max(1, Math.floor(bw / 2));
            bh = Math.max(1, Math.floor(bh / 2));
            if (bw < 4 || bh < 4) {
                break;
            }
        }
        this.webgpu.bloomLevels = this.webgpu.bloomTextures.length;

        this.seedBuffers();
        this.createBindGroups();
    }

    destroyGPUTextures() {
        [
            this.webgpu.sceneTexture,
            this.webgpu.postTexture,
            this.webgpu.historyTexture,
            ...(this.webgpu.bloomTextures || []),
        ].forEach((texture) => {
            if (texture && typeof texture.destroy === 'function') {
                try {
                    texture.destroy();
                } catch {
                    // noop
                }
            }
        });

        this.webgpu.sceneTexture = null;
        this.webgpu.postTexture = null;
        this.webgpu.historyTexture = null;
        this.webgpu.bloomTextures = [];
        this.webgpu.bloomViews = [];
        this.webgpu.bloomLevels = 0;
        this.webgpu.sceneView = null;
        this.webgpu.postView = null;
        this.webgpu.historyView = null;
    }

    destroyGPUBuffers() {
        [
            this.webgpu.uniformBuffer,
            this.webgpu.particleBuffer,
            ...(this.webgpu.flowBuffers || []),
            this.webgpu.timestampQuery?.resolveBuffer,
            this.webgpu.timestampQuery?.readBuffer,
        ].forEach((buffer) => {
            if (buffer && typeof buffer.destroy === 'function') {
                try {
                    buffer.destroy();
                } catch {
                    // noop
                }
            }
        });

        this.webgpu.uniformBuffer = null;
        this.webgpu.particleBuffer = null;
        this.webgpu.flowBuffers = [];
        if (this.webgpu.timestampQuery) {
            this.webgpu.timestampQuery.resolveBuffer = null;
            this.webgpu.timestampQuery.readBuffer = null;
        }
    }

    seedBuffers() {
        const { device } = this.webgpu;
        if (!device || !this.webgpu.particleBuffer) {
            return;
        }

        const flowSeed = new Float32Array(this.qualityPreset.flowGridWidth * this.qualityPreset.flowGridHeight * 4);
        device.queue.writeBuffer(this.webgpu.flowBuffers[0], 0, flowSeed);
        device.queue.writeBuffer(this.webgpu.flowBuffers[1], 0, flowSeed);

        // Class-aware initial seeding (mirrors particles.wgsl spawn): sparks/cinders
        // around the ember, dust scattered across the frame. Dust is long-lived, so
        // its initial scatter matters; sparks/cinders respawn within ~1s anyway.
        const count = this.qualityPreset.particleCount;
        const anchor = this.getEmberAnchor();
        const particleSeed = new Float32Array(count * 8);
        for (let i = 0; i < count; i++) {
            const base = i * 8;
            const frac = i / Math.max(count, 1);
            const angle = Math.random() * Math.PI * 2;
            if (frac < 0.5) {
                // SPARK
                const radius = 0.004 + Math.random() * 0.03;
                particleSeed[base] = anchor.x + Math.cos(angle) * radius;
                particleSeed[base + 1] = anchor.y + Math.sin(angle) * radius;
                particleSeed[base + 2] = Math.cos(angle) * 0.0015;
                particleSeed[base + 3] = -0.0012 - Math.random() * 0.0016;
                particleSeed[base + 4] = 0.5 + Math.random() * 0.7; // life
                particleSeed[base + 6] = 1.5 + Math.random() * 3.0; // size
                particleSeed[base + 7] = 0.4 + Math.random() * 0.5; // alpha
            } else if (frac < 0.82) {
                // CINDER
                const radius = 0.02 + Math.random() * 0.09;
                particleSeed[base] = anchor.x + Math.cos(angle) * radius;
                particleSeed[base + 1] = anchor.y + Math.sin(angle) * radius;
                particleSeed[base + 2] = (Math.random() - 0.5) * 0.001;
                particleSeed[base + 3] = -0.0005 - Math.random() * 0.001;
                particleSeed[base + 4] = 1.5 + Math.random() * 1.6;
                particleSeed[base + 6] = 2.0 + Math.random() * 4.0;
                particleSeed[base + 7] = 0.22 + Math.random() * 0.35;
            } else {
                // DUST — scattered across the whole frame
                particleSeed[base] = Math.random();
                particleSeed[base + 1] = Math.random();
                particleSeed[base + 2] = (Math.random() - 0.5) * 0.0004;
                particleSeed[base + 3] = (Math.random() - 0.5) * 0.0004;
                particleSeed[base + 4] = 4.0 + Math.random() * 5.0;
                particleSeed[base + 6] = 0.8 + Math.random() * 1.4;
                particleSeed[base + 7] = 0.06 + Math.random() * 0.16;
            }
            particleSeed[base + 5] = Math.random(); // stable per-particle seed
        }
        device.queue.writeBuffer(this.webgpu.particleBuffer, 0, particleSeed);
    }

    createBindGroups() {
        const { device } = this.webgpu;
        if (!device) {
            return;
        }

        this.webgpu.flowComputeBindGroups = [
            device.createBindGroup({
                layout: this.webgpu.flowComputePipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.webgpu.uniformBuffer } },
                    { binding: 1, resource: { buffer: this.webgpu.flowBuffers[0] } },
                    { binding: 2, resource: { buffer: this.webgpu.flowBuffers[1] } },
                ],
            }),
            device.createBindGroup({
                layout: this.webgpu.flowComputePipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.webgpu.uniformBuffer } },
                    { binding: 1, resource: { buffer: this.webgpu.flowBuffers[1] } },
                    { binding: 2, resource: { buffer: this.webgpu.flowBuffers[0] } },
                ],
            }),
        ];

        this.webgpu.particleComputeBindGroups = [
            device.createBindGroup({
                layout: this.webgpu.particleComputePipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.webgpu.uniformBuffer } },
                    { binding: 1, resource: { buffer: this.webgpu.flowBuffers[0] } },
                    { binding: 2, resource: { buffer: this.webgpu.particleBuffer } },
                ],
            }),
            device.createBindGroup({
                layout: this.webgpu.particleComputePipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.webgpu.uniformBuffer } },
                    { binding: 1, resource: { buffer: this.webgpu.flowBuffers[1] } },
                    { binding: 2, resource: { buffer: this.webgpu.particleBuffer } },
                ],
            }),
        ];

        this.webgpu.sceneBindGroups = [
            device.createBindGroup({
                layout: this.webgpu.scenePipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.webgpu.uniformBuffer } },
                    { binding: 1, resource: { buffer: this.webgpu.flowBuffers[0] } },
                ],
            }),
            device.createBindGroup({
                layout: this.webgpu.scenePipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.webgpu.uniformBuffer } },
                    { binding: 1, resource: { buffer: this.webgpu.flowBuffers[1] } },
                ],
            }),
        ];

        this.webgpu.particleVisualBindGroup = device.createBindGroup({
            layout: this.webgpu.particlePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.webgpu.uniformBuffer } },
                { binding: 1, resource: { buffer: this.webgpu.particleBuffer } },
            ],
        });

        // Bloom pyramid bind groups.
        this.webgpu.bloomPrefilterBindGroup = device.createBindGroup({
            layout: this.webgpu.bloomPrefilterPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.webgpu.uniformBuffer } },
                { binding: 1, resource: this.webgpu.sceneView },
                { binding: 2, resource: this.webgpu.sampler },
            ],
        });
        this.webgpu.bloomDownBindGroups = [];
        this.webgpu.bloomUpBindGroups = [];
        for (let level = 0; level < this.webgpu.bloomLevels - 1; level++) {
            // downsample[level] reads bloomViews[level], writes bloomViews[level+1]
            this.webgpu.bloomDownBindGroups.push(device.createBindGroup({
                layout: this.webgpu.bloomDownPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: this.webgpu.bloomViews[level] },
                    { binding: 1, resource: this.webgpu.sampler },
                ],
            }));
            // upsample[level] reads bloomViews[level+1], additively writes bloomViews[level]
            this.webgpu.bloomUpBindGroups.push(device.createBindGroup({
                layout: this.webgpu.bloomUpPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: this.webgpu.bloomViews[level + 1] },
                    { binding: 1, resource: this.webgpu.sampler },
                ],
            }));
        }

        this.webgpu.postBindGroup = device.createBindGroup({
            layout: this.webgpu.postPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.webgpu.uniformBuffer } },
                { binding: 1, resource: this.webgpu.sceneView },
                { binding: 2, resource: this.webgpu.sampler },
                { binding: 3, resource: this.webgpu.historyView },
                { binding: 4, resource: this.webgpu.bloomViews[0] },
            ],
        });

        this.webgpu.presentBindGroup = device.createBindGroup({
            layout: this.webgpu.presentPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.webgpu.postView },
                { binding: 1, resource: this.webgpu.sampler },
            ],
        });
    }

    setupTimestampQuery() {
        const { device } = this.webgpu;
        if (!device?.features?.has?.('timestamp-query')) {
            this.webgpu.timestampQuery = {
                supported: false,
                querySet: null,
                resolveBuffer: null,
                readBuffer: null,
                pending: false,
                reading: false,
            };
            return;
        }

        this.webgpu.timestampQuery = {
            supported: true,
            querySet: device.createQuerySet({
                type: 'timestamp',
                count: 4,
            }),
            resolveBuffer: device.createBuffer({
                size: 32,
                usage: combineFlags(GPU_BUFFER_USAGE_QUERY_RESOLVE, GPU_BUFFER_USAGE_COPY_SRC),
            }),
            readBuffer: device.createBuffer({
                size: 32,
                usage: combineFlags(GPU_BUFFER_USAGE_COPY_DST, GPU_BUFFER_USAGE_MAP_READ),
            }),
            pending: false,
            reading: false,
        };
    }

    init2DFallback() {
        if (!this.canvas) {
            return;
        }

        this.ctx2d = this.canvas.getContext('2d', { alpha: false });
        this.renderBackend = 'canvas2d';
        this.fallbackParticles = Array.from(
            { length: this.qualityPreset.fallbackParticleCount },
            () => this.createFallbackParticle(),
        );
    }

    createFallbackParticle() {
        const anchor = this.getEmberAnchor();
        const angle = Math.random() * Math.PI * 2;
        const radius = 0.015 + Math.random() * 0.05;
        return {
            x: anchor.x + Math.cos(angle) * radius,
            y: anchor.y + Math.sin(angle) * radius,
            vx: (Math.random() - 0.5) * 0.0008,
            vy: -0.0008 - Math.random() * 0.0014,
            size: 0.7 + Math.random() * 2.2,
            life: 0.3 + Math.random() * 1.2,
            alpha: 0.08 + Math.random() * 0.25,
        };
    }

    handleWebGPUDeviceLost(info) {
        console.warn('[VoidEmber] WebGPU device lost, falling back to 2D:', info);
        const container = this.getOrCreateThemeContainer();
        if (!container) {
            return;
        }

        this.resetAnimationLoop();
        this.teardownGPUResources();
        this.replaceCanvas(container);
        this.resizeCanvas();
        this.init2DFallback();
        this.startAnimation();
    }

    teardownGPUResources() {
        this.removeRendererResilience();
        this.destroyGPUTextures();
        this.destroyGPUBuffers();

        if (this.webgpu.context?.unconfigure) {
            try {
                this.webgpu.context.unconfigure();
            } catch {
                // noop
            }
        }

        if (this.webgpu.device) {
            try {
                this.webgpu.device.destroy();
            } catch {
                // noop
            }
        }

        this.webgpu = createEmptyWebGPUState();
    }

    teardownRuntime() {
        this.ctx2d = null;
        if (this.renderBackend === 'webgpu') {
            this.teardownGPUResources();
        } else {
            this.removeRendererResilience();
        }
        this.renderBackend = 'none';
    }

    resetAnimationLoop() {
        this.animationIds.forEach((id) => cancelAnimationFrame(id));
        this.animationIds = [];
    }

    setupEventListeners() {
        const onResize = () => this.handleResize();
        window.addEventListener('resize', onResize);
        this.eventUnsubscribers.push(() => window.removeEventListener('resize', onResize));

        const onWindowSettings = () => this.handleSettingsChanged();
        window.addEventListener('settingsChanged', onWindowSettings);
        this.eventUnsubscribers.push(() => window.removeEventListener('settingsChanged', onWindowSettings));

        this.eventUnsubscribers.push(eventBus.on(EVENTS.SETTINGS_CHANGED, () => this.handleSettingsChanged()));

        this.eventUnsubscribers.push(eventBus.on(EVENTS.PIECE_LOCK, () => {
            this.runtime.pulseTarget = clamp(this.runtime.pulseTarget + 0.55, 0, 2.8);
            this.runtime.eventTarget = clamp(this.runtime.eventTarget + 0.18, 0, 2.6);
            this.runtime.shockwaveTarget = clamp(this.runtime.shockwaveTarget + 0.7, 0, 1.0);
            this.runtime.flareTarget = clamp(this.runtime.flareTarget + 0.15, 0, 2.0);
            this.runtime.intensityTarget = clamp(this.runtime.intensityTarget + 0.02, 0, 3.0);
            this.stellarConductor.onPieceLock();
        }));

        this.eventUnsubscribers.push(eventBus.on(EVENTS.HARD_DROP, () => {
            this.runtime.hardDropFlashTarget = 1.0;
            this.runtime.shockwaveTarget = clamp(this.runtime.shockwaveTarget + 0.85, 0, 1.0);
            this.runtime.pulseTarget = clamp(this.runtime.pulseTarget + 0.7, 0, 3.0);
            this.runtime.eventTarget = clamp(this.runtime.eventTarget + 0.25, 0, 3.0);
            this.runtime.turbulenceTarget = clamp(this.runtime.turbulenceTarget + 0.08, 0.2, 2.0);
            this.stellarConductor.onHardDrop();
        }));

        this.eventUnsubscribers.push(eventBus.on(EVENTS.LINE_CLEAR, (payload = {}) => {
            const lineCount = clamp(Number(payload.lineCount) || 1, 1, 4);
            this.stellarConductor.onLineClear(lineCount, Number(payload.comboCount) || 0);
            const multiplier = lineCount === 4 ? 2.5 : lineCount;
            this.runtime.eventTarget = clamp(this.runtime.eventTarget + multiplier * 0.5, 0, 4.0);
            this.runtime.lineTarget = clamp(this.runtime.lineTarget + multiplier * 0.45, 0, 3.5);
            this.runtime.turbulenceTarget = clamp(this.runtime.turbulenceTarget + multiplier * 0.18, 0.2, 2.4);
            this.runtime.pulseTarget = clamp(this.runtime.pulseTarget + multiplier * 0.35, 0, 3.0);
            this.runtime.flareTarget = clamp(this.runtime.flareTarget + multiplier * 0.55, 0, 3.0);
            this.runtime.shockwaveTarget = clamp(this.runtime.shockwaveTarget + multiplier * 0.4, 0, 1.0);
            this.runtime.intensityTarget = clamp(this.runtime.intensityTarget + multiplier * 0.06, 0, 3.0);
        }));

        this.eventUnsubscribers.push(eventBus.on(EVENTS.COMBO, (payload = {}) => {
            const comboCount = clamp(Number(payload.comboCount) || 1, 1, 12);
            if (comboCount <= 1) {
                return;
            }
            this.stellarConductor.onCombo(comboCount);
            this.runtime.comboTarget = clamp(this.runtime.comboTarget + comboCount * 0.24, 0, 4.0);
            this.runtime.turbulenceTarget = clamp(this.runtime.turbulenceTarget + comboCount * 0.1, 0.2, 2.8);
            this.runtime.eventTarget = clamp(this.runtime.eventTarget + comboCount * 0.14, 0, 4.0);
            this.runtime.flareTarget = clamp(this.runtime.flareTarget + comboCount * 0.35, 0, 3.5);
            this.runtime.intensityTarget = clamp(this.runtime.intensityTarget + comboCount * 0.08, 0, 3.0);
        }));

        this.eventUnsubscribers.push(eventBus.on(EVENTS.LEVEL_UP, () => {
            this.runtime.collapseTarget = clamp(this.runtime.collapseTarget + 0.5, 0, 1.0);
            this.runtime.flareTarget = clamp(this.runtime.flareTarget + 1.2, 0, 3.5);
            this.runtime.shockwaveTarget = 1.0;
            this.runtime.pulseTarget = clamp(this.runtime.pulseTarget + 0.9, 0, 3.5);
            this.runtime.intensityTarget = clamp(this.runtime.intensityTarget + 0.15, 0, 3.0);
            this.stellarConductor.onLevelUp();
        }));

        const collapse = () => {
            this.runtime.collapseTarget = 1;
            this.runtime.pulseTarget = clamp(this.runtime.pulseTarget + 0.6, 0, 2.8);
            this.runtime.flareTarget = clamp(this.runtime.flareTarget + 0.8, 0, 3.0);
            this.runtime.shockwaveTarget = 1.0;
            this.stellarConductor.onCollapse();
        };

        this.eventUnsubscribers.push(eventBus.on(EVENTS.ODYSSEY_GOAL_COMPLETE, collapse));
        this.eventUnsubscribers.push(eventBus.on(EVENTS.ODYSSEY_VICTORY_LAP_END, collapse));
        this.eventUnsubscribers.push(eventBus.on(EVENTS.EXIT_TO_MAIN_MENU, collapse));
    }

    handleSettingsChanged() {
        this.performanceTierCap = null;
        const nextTier = resolveVoidEmberTier(this.getGraphicsQuality());
        if (nextTier !== this.currentTier) {
            this.scheduleRebuild('settings-quality');
            return;
        }

        this.qualityPreset = getVoidEmberQualityPreset(nextTier);
        this.handleResize();
    }

    scheduleRebuild(reason = 'runtime') {
        if (this.rebuildScheduled || !this.isActive) {
            return;
        }

        this.rebuildScheduled = true;
        window.setTimeout(() => {
            this.rebuildScheduled = false;
            if (!this.isActive) {
                return;
            }
            console.log(`[VoidEmber] Rebuilding runtime (${reason})`);
            this.createScene().catch((error) => {
                console.error('[VoidEmber] Rebuild failed:', error);
            });
        }, 0);
    }

    getEmberAnchor() {
        const t = this.runtime.time;

        // Lissajous-style orbit with irrational frequency ratios for organic, non-repeating drift
        const x1 = Math.sin(t * 0.067) * 0.38;
        const x2 = Math.sin(t * 0.031 + 1.7) * 0.12;
        const y1 = Math.sin(t * 0.053 + 0.8) * 0.38;
        const y2 = Math.cos(t * 0.041 + 2.3) * 0.12;

        return {
            x: clamp(0.50 + x1 + x2, 0.05, 0.95),
            y: clamp(0.50 + y1 + y2, 0.05, 0.95),
        };
    }

    getEmberColors() {
        const t = this.runtime.time;
        const stopCount = COLOR_STOPS.length;
        const cyclePos = (t % COLOR_CYCLE_PERIOD) / COLOR_CYCLE_PERIOD;
        const totalSegments = stopCount - 1;
        const segmentFloat = cyclePos * totalSegments;
        const segmentIndex = Math.min(Math.floor(segmentFloat), totalSegments - 1);
        const segmentFrac = segmentFloat - segmentIndex;

        // Smooth hermite interpolation for organic transitions
        const smooth = segmentFrac * segmentFrac * (3 - 2 * segmentFrac);

        const a = COLOR_STOPS[segmentIndex];
        const b = COLOR_STOPS[Math.min(segmentIndex + 1, stopCount - 1)];

        return {
            core: [
                lerp(a[0], b[0], smooth),
                lerp(a[1], b[1], smooth),
                lerp(a[2], b[2], smooth),
            ],
            outer: [
                lerp(a[3], b[3], smooth),
                lerp(a[4], b[4], smooth),
                lerp(a[5], b[5], smooth),
            ],
        };
    }

    resizeCanvas() {
        if (!this.canvas) {
            return false;
        }

        const rect = this.canvas.getBoundingClientRect?.();
        const displayWidth = Math.max(
            1,
            rect?.width || this.canvas.clientWidth || window.innerWidth || 1,
        );
        const displayHeight = Math.max(
            1,
            rect?.height || this.canvas.clientHeight || window.innerHeight || 1,
        );
        const ratio = clamp(this.getEffectivePixelRatio(2) * this.qualityPreset.renderScale, 0.45, 2);
        const maxTextureDimension = this.webgpu.device?.limits?.maxTextureDimension2D || 16384;
        const width = Math.max(1, Math.min(maxTextureDimension, Math.ceil(displayWidth * ratio)));
        const height = Math.max(1, Math.min(maxTextureDimension, Math.ceil(displayHeight * ratio)));

        if (this.canvas.width === width && this.canvas.height === height) {
            return false;
        }
        this.canvas.width = width;
        this.canvas.height = height;
        return true;
    }

    handleResize() {
        const resized = this.resizeCanvas();
        if (this.renderBackend === 'webgpu' && this.webgpu.device) {
            if (!resized && this.webgpu.sceneTexture) {
                return;
            }
            this.webgpu.context.configure({
                device: this.webgpu.device,
                format: this.webgpu.format,
                alphaMode: 'premultiplied',
            });
            this.createOrResizeResources();
        }
    }

    startAnimation() {
        // Guard against a second concurrent RAF loop (e.g. resume() while already
        // animating). safeAnimate re-registers its id each frame, so resetting
        // here reliably cancels any loop already running before we start a new one.
        this.resetAnimationLoop();
        const animate = this.safeAnimate((time) => this.renderFrame(time));
        const frameId = requestAnimationFrame(animate);
        this.registerAnimation(frameId);
    }

    renderFrame(time) {
        const now = Number.isFinite(time) ? time : performance.now();
        const deltaMs = clamp(now - (this.lastFrameAt || now), 0.1, 80);
        this.lastFrameAt = now;
        this.runtime.delta = deltaMs / 1000;
        this.runtime.time += this.runtime.delta;
        this.frameCounter += 1;

        this.updateReactiveState(this.runtime.delta);

        // Phase 0: advance the reactive spine alongside the legacy channels and
        // surface it in the debug overlay. Not yet consumed by the render path.
        this.stellarConductor.update(this.runtime.delta);
        if (this.stellarDebug) {
            this.stellarDebug.update(this.stellarConductor, { legacyIntensity: this.runtime.intensity });
        }

        const frameStartedAt = performance.now();
        if (this.renderBackend === 'webgpu') {
            this.renderWebGPU();
        } else if (this.renderBackend === 'canvas2d') {
            this.renderFallback2D();
        }
        const frameCpuMs = performance.now() - frameStartedAt;

        this.frameTimes.push(frameCpuMs);
        if (this.frameTimes.length > 180) {
            this.frameTimes.shift();
        }

        if (this.renderBackend === 'webgpu') {
            this.pollTimestampQuery();
        }

        if (this.frameCounter % 90 === 0) {
            this.evaluatePerformance();
        }
    }

    updateReactiveState(delta) {
        const settle = 1 - Math.exp(-delta * 3.2);
        const quick = 1 - Math.exp(-delta * 8.5);

        this.runtime.eventEnergy = lerp(this.runtime.eventEnergy, this.runtime.eventTarget, quick);
        this.runtime.comboEnergy = lerp(this.runtime.comboEnergy, this.runtime.comboTarget, settle);
        this.runtime.turbulence = lerp(this.runtime.turbulence, this.runtime.turbulenceTarget, settle);
        this.runtime.pulse = lerp(this.runtime.pulse, this.runtime.pulseTarget, quick);
        this.runtime.lineEnergy = lerp(this.runtime.lineEnergy, this.runtime.lineTarget, quick);
        this.runtime.collapse = lerp(this.runtime.collapse, this.runtime.collapseTarget, settle * 0.75);

        // Shockwave expands fast then fades — snap-on, smooth-off
        const shockSnap = 1 - Math.exp(-delta * 18.0);
        this.runtime.shockwave = lerp(this.runtime.shockwave, this.runtime.shockwaveTarget, shockSnap);
        // Flare rises fast, fades at medium speed
        const flareRise = 1 - Math.exp(-delta * 14.0);
        this.runtime.flare = lerp(this.runtime.flare, this.runtime.flareTarget, flareRise);
        // Hard drop flash is ultra-fast snap
        const flashSnap = 1 - Math.exp(-delta * 28.0);
        this.runtime.hardDropFlash = lerp(this.runtime.hardDropFlash, this.runtime.hardDropFlashTarget, flashSnap);
        // Intensity builds slowly, decays very slowly
        const intensitySettle = 1 - Math.exp(-delta * 2.0);
        this.runtime.intensity = lerp(this.runtime.intensity, this.runtime.intensityTarget, intensitySettle);

        this.runtime.eventTarget = lerp(this.runtime.eventTarget, 0, delta * 1.2);
        this.runtime.comboTarget = lerp(this.runtime.comboTarget, 0, delta * 0.65);
        this.runtime.lineTarget = lerp(this.runtime.lineTarget, 0, delta * 1.4);
        this.runtime.pulseTarget = lerp(this.runtime.pulseTarget, 0.08, delta * 2.8);
        this.runtime.turbulenceTarget = lerp(this.runtime.turbulenceTarget, 0.22, delta * 0.75);
        this.runtime.collapseTarget = lerp(this.runtime.collapseTarget, 0, delta * 0.08);
        // New channels decay
        this.runtime.shockwaveTarget = lerp(this.runtime.shockwaveTarget, 0, delta * 3.2);
        this.runtime.flareTarget = lerp(this.runtime.flareTarget, 0, delta * 2.4);
        this.runtime.hardDropFlashTarget = lerp(this.runtime.hardDropFlashTarget, 0, delta * 12.0);
        this.runtime.intensityTarget = lerp(this.runtime.intensityTarget, 0, delta * 0.12);
    }

    updateUniformBuffer() {
        const { device, uniformBuffer } = this.webgpu;
        if (!device || !uniformBuffer || !this.canvas) {
            return;
        }

        const floats = new Float32Array(UNIFORM_FLOATS);
        const invWidth = 1 / Math.max(this.canvas.width, 1);
        const invHeight = 1 / Math.max(this.canvas.height, 1);
        const anchor = this.getEmberAnchor();
        const aspect = this.canvas.width / Math.max(this.canvas.height, 1);

        floats[UNIFORM.resolution + 0] = this.canvas.width;
        floats[UNIFORM.resolution + 1] = this.canvas.height;
        floats[UNIFORM.resolution + 2] = invWidth;
        floats[UNIFORM.resolution + 3] = invHeight;

        floats[UNIFORM.sim + 0] = this.runtime.time;
        floats[UNIFORM.sim + 1] = this.runtime.delta;
        floats[UNIFORM.sim + 2] = aspect;
        floats[UNIFORM.sim + 3] = this.frameCounter;

        floats[UNIFORM.ember + 0] = anchor.x;
        floats[UNIFORM.ember + 1] = anchor.y;
        floats[UNIFORM.ember + 2] = this.runtime.pulse;
        floats[UNIFORM.ember + 3] = this.runtime.collapse;

        floats[UNIFORM.reaction + 0] = this.runtime.eventEnergy;
        floats[UNIFORM.reaction + 1] = this.runtime.comboEnergy;
        floats[UNIFORM.reaction + 2] = this.runtime.turbulence;
        floats[UNIFORM.reaction + 3] = this.runtime.lineEnergy;

        floats[UNIFORM.quality + 0] = this.qualityPreset.flowGridWidth;
        floats[UNIFORM.quality + 1] = this.qualityPreset.flowGridHeight;
        floats[UNIFORM.quality + 2] = this.qualityPreset.raySteps;
        floats[UNIFORM.quality + 3] = this.qualityPreset.particleCount;

        floats[UNIFORM.post + 0] = this.qualityPreset.bloomStrength;
        floats[UNIFORM.post + 1] = this.qualityPreset.bloomThreshold;
        floats[UNIFORM.post + 2] = this.qualityPreset.anamorphicStrength;
        floats[UNIFORM.post + 3] = this.currentTier === 'high' || this.currentTier === 'ultra'
            ? this.qualityPreset.temporalMix
            : 0;

        const emberColors = this.getEmberColors();
        floats[UNIFORM.colorA + 0] = emberColors.core[0];
        floats[UNIFORM.colorA + 1] = emberColors.core[1];
        floats[UNIFORM.colorA + 2] = emberColors.core[2];
        floats[UNIFORM.colorA + 3] = this.qualityPreset.exposure;

        floats[UNIFORM.colorB + 0] = emberColors.outer[0];
        floats[UNIFORM.colorB + 1] = emberColors.outer[1];
        floats[UNIFORM.colorB + 2] = emberColors.outer[2];
        floats[UNIFORM.colorB + 3] = 1;

        floats[UNIFORM.misc + 0] = this.qualityPreset.vignetteStrength;
        floats[UNIFORM.misc + 1] = this.qualityPreset.noiseStrength;
        floats[UNIFORM.misc + 2] = this.qualityPreset.historyClamp;
        floats[UNIFORM.misc + 3] = this.qualityPreset.sharpness ?? 0.12;

        // Pack reactive gameplay channels into the fx slot
        floats[UNIFORM.fx + 0] = this.runtime.shockwave;
        floats[UNIFORM.fx + 1] = this.runtime.flare;
        floats[UNIFORM.fx + 2] = this.runtime.hardDropFlash;
        floats[UNIFORM.fx + 3] = this.runtime.intensity;

        // StellarConductor life-state — drives the hero star (scene.wgsl)
        const conductor = this.stellarConductor;
        floats[UNIFORM.star0 + 0] = conductor.temperature;
        floats[UNIFORM.star0 + 1] = conductor.agitation;
        floats[UNIFORM.star0 + 2] = conductor.coronaEnergy;
        floats[UNIFORM.star0 + 3] = conductor.breath;
        floats[UNIFORM.star1 + 0] = conductor.novaFlash;
        floats[UNIFORM.star1 + 1] = conductor.cmePulse;
        floats[UNIFORM.star1 + 2] = conductor.cameraPush;
        floats[UNIFORM.star1 + 3] = 0;

        device.queue.writeBuffer(uniformBuffer, 0, floats);
    }

    runBloomPyramid(encoder) {
        const levels = this.webgpu.bloomLevels;
        if (!levels || levels < 1 || !this.webgpu.bloomPrefilterPipeline) {
            return;
        }

        const clearBlack = {
            r: 0, g: 0, b: 0, a: 1,
        };

        // Prefilter + bright-pass: scene → bloomViews[0] (half-res).
        const prefilterPass = encoder.beginRenderPass({
            colorAttachments: [{
                view: this.webgpu.bloomViews[0],
                clearValue: clearBlack,
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });
        prefilterPass.setPipeline(this.webgpu.bloomPrefilterPipeline);
        prefilterPass.setBindGroup(0, this.webgpu.bloomPrefilterBindGroup);
        prefilterPass.draw(3, 1, 0, 0);
        prefilterPass.end();

        // Downsample chain: bloomViews[i-1] → bloomViews[i].
        for (let level = 1; level < levels; level++) {
            const pass = encoder.beginRenderPass({
                colorAttachments: [{
                    view: this.webgpu.bloomViews[level],
                    clearValue: clearBlack,
                    loadOp: 'clear',
                    storeOp: 'store',
                }],
            });
            pass.setPipeline(this.webgpu.bloomDownPipeline);
            pass.setBindGroup(0, this.webgpu.bloomDownBindGroups[level - 1]);
            pass.draw(3, 1, 0, 0);
            pass.end();
        }

        // Upsample chain: additively accumulate bloomViews[i+1] onto bloomViews[i].
        for (let level = levels - 2; level >= 0; level--) {
            const pass = encoder.beginRenderPass({
                colorAttachments: [{
                    view: this.webgpu.bloomViews[level],
                    loadOp: 'load',
                    storeOp: 'store',
                }],
            });
            pass.setPipeline(this.webgpu.bloomUpPipeline);
            pass.setBindGroup(0, this.webgpu.bloomUpBindGroups[level]);
            pass.draw(3, 1, 0, 0);
            pass.end();
        }
    }

    renderWebGPU() {
        const { device, context } = this.webgpu;
        if (
            !device
            || !context
            || !this.webgpu.scenePipeline
            || !this.webgpu.postPipeline
            || !this.webgpu.presentPipeline
        ) {
            return;
        }

        this.updateUniformBuffer();

        const currentFlow = this.webgpu.currentFlowIndex;
        const nextFlow = 1 - currentFlow;
        const encoder = device.createCommandEncoder({
            label: 'void-ember/frame-encoder',
        });

        const { timestampQuery } = this.webgpu;
        const canWriteTimestamps = Boolean(
            timestampQuery?.supported
            && timestampQuery.querySet
            && timestampQuery.resolveBuffer
            && timestampQuery.readBuffer
            && !timestampQuery.pending
            && !timestampQuery.reading,
        );

        const flowPass = encoder.beginComputePass(
            canWriteTimestamps
                ? {
                    timestampWrites: {
                        querySet: timestampQuery.querySet,
                        beginningOfPassWriteIndex: 0,
                        endOfPassWriteIndex: 1,
                    },
                }
                : undefined,
        );
        flowPass.setPipeline(this.webgpu.flowComputePipeline);
        flowPass.setBindGroup(0, this.webgpu.flowComputeBindGroups[currentFlow]);
        flowPass.dispatchWorkgroups(
            Math.ceil(this.qualityPreset.flowGridWidth / 8),
            Math.ceil(this.qualityPreset.flowGridHeight / 8),
        );
        flowPass.end();

        const particlePass = encoder.beginComputePass();
        particlePass.setPipeline(this.webgpu.particleComputePipeline);
        particlePass.setBindGroup(0, this.webgpu.particleComputeBindGroups[nextFlow]);
        particlePass.dispatchWorkgroups(Math.ceil(this.qualityPreset.particleCount / 64));
        particlePass.end();

        this.webgpu.currentFlowIndex = nextFlow;

        const scenePass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: this.webgpu.sceneView,
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
        scenePass.setPipeline(this.webgpu.scenePipeline);
        scenePass.setBindGroup(0, this.webgpu.sceneBindGroups[this.webgpu.currentFlowIndex]);
        scenePass.draw(3, 1, 0, 0);
        scenePass.end();

        const particleRenderPass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: this.webgpu.sceneView,
                    loadOp: 'load',
                    storeOp: 'store',
                },
            ],
        });
        particleRenderPass.setPipeline(this.webgpu.particlePipeline);
        particleRenderPass.setBindGroup(0, this.webgpu.particleVisualBindGroup);
        particleRenderPass.draw(6, this.qualityPreset.particleCount, 0, 0);
        particleRenderPass.end();

        // Dual-filter bloom pyramid: scene → soft, wide HDR bloom in bloomViews[0].
        this.runBloomPyramid(encoder);

        const postStartedAt = performance.now();
        const postPass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: this.webgpu.postView,
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
        postPass.setPipeline(this.webgpu.postPipeline);
        postPass.setBindGroup(0, this.webgpu.postBindGroup);
        postPass.draw(3, 1, 0, 0);
        postPass.end();
        this.cpuPostTimes.push(performance.now() - postStartedAt);
        if (this.cpuPostTimes.length > 120) {
            this.cpuPostTimes.shift();
        }

        encoder.copyTextureToTexture(
            { texture: this.webgpu.postTexture },
            { texture: this.webgpu.historyTexture },
            {
                width: Math.max(1, this.canvas.width),
                height: Math.max(1, this.canvas.height),
                depthOrArrayLayers: 1,
            },
        );

        const currentTexture = context.getCurrentTexture();
        const presentPass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: currentTexture.createView(),
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
        presentPass.setPipeline(this.webgpu.presentPipeline);
        presentPass.setBindGroup(0, this.webgpu.presentBindGroup);
        presentPass.draw(3, 1, 0, 0);
        presentPass.end();

        if (canWriteTimestamps) {
            encoder.resolveQuerySet(timestampQuery.querySet, 0, 4, timestampQuery.resolveBuffer, 0);
            encoder.copyBufferToBuffer(timestampQuery.resolveBuffer, 0, timestampQuery.readBuffer, 0, 32);
            timestampQuery.pending = true;
        }

        device.queue.submit([encoder.finish()]);
    }

    pollTimestampQuery() {
        const { timestampQuery, device } = this.webgpu;
        if (!timestampQuery?.supported || !timestampQuery.pending || timestampQuery.reading || !device) {
            return;
        }

        timestampQuery.pending = false;
        timestampQuery.reading = true;

        Promise.resolve(device.queue.onSubmittedWorkDone?.())
            .then(() => timestampQuery.readBuffer.mapAsync(GPU_MAP_MODE_READ))
            .then(() => {
                const values = new BigUint64Array(timestampQuery.readBuffer.getMappedRange().slice(0));
                timestampQuery.readBuffer.unmap();
                timestampQuery.reading = false;
                if (values.length >= 4) {
                    const totalNs = Number(values[3] - values[0]);
                    if (Number.isFinite(totalNs) && totalNs > 0) {
                        const totalMs = totalNs / 1_000_000;
                        this.webgpu.gpuPassSamples.push(totalMs);
                        if (this.webgpu.gpuPassSamples.length > 120) {
                            this.webgpu.gpuPassSamples.shift();
                        }
                    }
                }
            })
            .catch(() => {
                timestampQuery.reading = false;
            });
    }

    evaluatePerformance() {
        const gpuAverage = average(this.webgpu.gpuPassSamples);
        const cpuAverage = average(this.frameTimes);
        const signal = gpuAverage > 0 ? gpuAverage : cpuAverage;
        if (!Number.isFinite(signal) || signal <= 0) {
            return;
        }

        if (signal <= this.qualityPreset.downshiftThresholdMs) {
            return;
        }

        const lowerTier = getLowerVoidEmberTier(this.currentTier);
        if (!lowerTier) {
            return;
        }

        console.warn(
            `[VoidEmber] Performance downshift ${this.currentTier} -> ${lowerTier} (${signal.toFixed(2)}ms)`,
        );
        this.performanceTierCap = lowerTier;
        this.scheduleRebuild('performance-downshift');
    }

    renderFallback2D() {
        if (!this.ctx2d || !this.canvas) {
            return;
        }

        const ctx = this.ctx2d;
        const { width, height } = this.canvas;
        const anchor = this.getEmberAnchor();
        const emberX = anchor.x * width;
        const emberY = anchor.y * height;

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);

        const hazeRadius = Math.max(width, height) * 0.18;
        const haze = ctx.createRadialGradient(emberX, emberY, 0, emberX, emberY, hazeRadius);
        haze.addColorStop(0, `rgba(255, 68, 10, ${0.08 + this.runtime.pulse * 0.03})`);
        haze.addColorStop(0.2, `rgba(168, 12, 8, ${0.06 + this.runtime.eventEnergy * 0.03})`);
        haze.addColorStop(0.55, 'rgba(20, 4, 4, 0.05)');
        haze.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = haze;
        ctx.fillRect(emberX - hazeRadius, emberY - hazeRadius, hazeRadius * 2, hazeRadius * 2);

        const coreRadius = Math.max(3, Math.min(width, height) * 0.0065);
        const core = ctx.createRadialGradient(emberX, emberY, 0, emberX, emberY, coreRadius * 5);
        core.addColorStop(0, `rgba(255, 252, 220, ${0.95 - this.runtime.collapse * 0.4})`);
        core.addColorStop(0.15, `rgba(255, 200, 72, ${0.9 - this.runtime.collapse * 0.25})`);
        core.addColorStop(0.35, `rgba(255, 74, 14, ${0.75 - this.runtime.collapse * 0.2})`);
        core.addColorStop(0.7, `rgba(120, 8, 8, ${0.08 + this.runtime.lineEnergy * 0.04})`);
        core.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = core;
        ctx.fillRect(emberX - coreRadius * 5, emberY - coreRadius * 5, coreRadius * 10, coreRadius * 10);

        const arcAlpha = (0.04 + this.runtime.lineEnergy * 0.12) * (1 - this.runtime.collapse * 0.7);
        if (arcAlpha > 0.01) {
            ctx.strokeStyle = `rgba(255, 72, 24, ${arcAlpha})`;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(emberX, emberY, coreRadius * 9, -0.8 + this.runtime.time * 0.25, 0.8 + this.runtime.time * 0.25);
            ctx.stroke();
        }

        this.updateFallbackParticles();
        this.drawFallbackParticles(ctx, width, height);

        ctx.globalCompositeOperation = 'source-over';
        const vignette = ctx.createRadialGradient(
            width * 0.5,
            height * 0.5,
            Math.min(width, height) * 0.15,
            width * 0.5,
            height * 0.5,
            Math.max(width, height) * 0.72,
        );
        vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vignette.addColorStop(1, `rgba(0, 0, 0, ${0.55 + this.qualityPreset.vignetteStrength * 0.3})`);
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, width, height);
    }

    updateFallbackParticles() {
        const anchor = this.getEmberAnchor();
        this.fallbackParticles.forEach((particle) => {
            particle.life -= this.runtime.delta * (0.32 + Math.random() * 0.18);
            particle.vx += (Math.random() - 0.5) * 0.00006 + this.runtime.comboEnergy * 0.00002;
            particle.vy -= 0.00002 + this.runtime.eventEnergy * 0.00001;
            particle.x += particle.vx * 60 * this.runtime.delta;
            particle.y += particle.vy * 60 * this.runtime.delta;

            const dx = particle.x - anchor.x;
            const dy = particle.y - anchor.y;
            if (particle.life <= 0 || Math.hypot(dx, dy) > 0.24 || particle.y < -0.1) {
                Object.assign(particle, this.createFallbackParticle());
            }
        });
    }

    drawFallbackParticles(ctx, width, height) {
        ctx.globalCompositeOperation = 'lighter';
        this.fallbackParticles.forEach((particle) => {
            const { x, y } = particle;
            const alpha = particle.alpha * clamp(particle.life, 0, 1);
            ctx.fillStyle = `rgba(255, 154, 72, ${alpha})`;
            ctx.beginPath();
            ctx.arc(x * width, y * height, particle.size, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    clearEventUnsubscribers() {
        super.clearEventUnsubscribers();
        this.eventUnsubscribers = [];
    }

    resume() {
        const resumed = super.resume();
        if (!resumed) {
            return false;
        }

        this.startAnimation();
        return true;
    }

    stop() {
        super.stop();
        this.clearEventUnsubscribers();
        this.resetAnimationLoop();
        this.teardownRuntime();
        if (this.stellarDebug) {
            this.stellarDebug.dispose();
            this.stellarDebug = null;
        }
        if (this.stellarConductor) {
            this.stellarConductor.reset();
        }
    }

    cleanup() {
        this.stop();
        super.cleanup();
    }
}
