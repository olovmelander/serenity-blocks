/**
 * Nimbus Veil — post stack (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT), one bloom chain and ONE full-screen output pass:
 *   scene → bloom (4-tap max-channel soft-knee prefilter) → crepuscular rays (a radial blur
 *   toward the sun over the LOW-RES bloom texture, which already isolates the bright sky, so the
 *   towers in front of the sun cut real gaps into the rays for a handful of cheap taps) →
 *   hue-preserving neutral tone map → dreamy split-tone grade (lavender shadows, warm highlights)
 *   → vignette → sRGB encode → triangular dither.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    clamp,
    dot,
    exp,
    float,
    floor,
    length,
    max,
    min,
    mix,
    neutralToneMapping,
    pass,
    pow,
    renderOutput,
    screenCoordinate,
    screenUV,
    smoothstep,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { nvHash21, nvMax3 } from './nimbus-veil-tsl.js';

/**
 * Per-tier look. `rays` = radial taps (0 = none). `msaa` is the scene-pass sample count
 * (WebGPU: 1 or 4): the cloud domes' and towers' silhouettes against the sky are geometry edges.
 */
export const POST_LOOK = {
    Extreme: {
        bloom: true, bloomStrength: 0.85, bloomResolution: 0.5, rays: 20, msaa: 4,
    },
    Ultra: {
        bloom: true, bloomStrength: 0.82, bloomResolution: 0.45, rays: 18, msaa: 4,
    },
    High: {
        bloom: true, bloomStrength: 0.8, bloomResolution: 0.4, rays: 16, msaa: 4,
    },
    Medium: {
        bloom: true, bloomStrength: 0.72, bloomResolution: 0.3, rays: 10, msaa: 0,
    },
    Low: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, rays: 0, msaa: 0,
    },
    Minimal: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, rays: 0, msaa: 0,
    },
};

export const BLOOM_THRESHOLD = 1.0;
export const BLOOM_KNEE = 0.55;
export const BLOOM_RADIUS = 0.45;

const LUMA = vec3(0.2126, 0.7152, 0.0722);

/** A render pipeline that only encodes the scene (the no-post / fallback path). */
export function createPassThroughPipeline(renderer, scene, camera) {
    const pipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera, { samples: 0 });
    pipeline.outputNode = scenePass;
    return {
        render: () => pipeline.render(),
        update() {},
        setSize() {},
        dispose() {
            scenePass.dispose();
            pipeline.dispose();
        },
    };
}

export class NimbusVeilPost {
    /**
     * @param {THREE.WebGPURenderer} renderer
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {object} [params]
     * @param {object} [params.look]     POST_LOOK entry
     * @param {number} [params.samples]  scene-pass MSAA samples (default look.msaa)
     */
    constructor(renderer, scene, camera, params = {}) {
        const look = params.look || POST_LOOK.High;
        this.look = look;
        this.renderer = renderer;
        this.postProcessing = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: params.samples ?? look.msaa ?? 0 });
        const sceneColor = this.scenePass.getTextureNode('output');

        this.uAspect = uniform(16 / 9);
        this.uSrcTexel = uniform(new THREE.Vector2(1 / 1920, 1 / 1080));
        this.uSun = uniform(new THREE.Vector2(0.25, 0.4));
        this.uSunVis = uniform(0);
        this.uRays = uniform(1);
        this.uBloomBoost = uniform(0);

        this.bloomNode = null;
        if (look.bloom) {
            this.bloomNode = bloom(sceneColor, look.bloomStrength, BLOOM_RADIUS, BLOOM_THRESHOLD);
            this.bloomNode.threshold.value = BLOOM_THRESHOLD;
            this.bloomNode.smoothWidth.value = BLOOM_KNEE;
            this.bloomNode.setResolutionScale(look.bloomResolution);
            const { uSrcTexel } = this;
            // BloomNode's documented hook, read once at setup. Inline (no setLayout): `input`
            // must stay the raw scene TextureNode for .sample().
            this.bloomNode.highPassFn = Fn(({ input, threshold, smoothWidth }) => {
                const st = uv();
                const o = uSrcTexel.mul(1.25);
                const tap = (dx, dy) => clamp(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb, 0.0, 8.0);
                const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1))
                    .mul(0.25);
                const br = nvMax3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        const rayTaps = this.bloomNode ? look.rays : 0;
        const outputFn = Fn(() => {
            const st = screenUV;
            const centered = st.sub(0.5);
            const S = vec3(sceneColor.sample(st).rgb).toVar();

            const B = vec3(0.0).toVar();
            if (this.bloomNode) {
                const bloomTex = this.bloomNode.getTextureNode();
                B.assign(vec3(bloomTex.sample(st).rgb).mul(float(1.0).add(this.uBloomBoost.mul(0.3))));
                // ── Crepuscular rays: march toward the sun over the bright sky (scene colour
                // above a threshold), so the towers in front of the sun cut gaps into them ──
                if (rayTaps > 0) {
                    const toSun = this.uSun.sub(st);
                    const stepV = toSun.mul(0.92 / rayTaps);
                    const acc = vec3(0.0).toVar();
                    let weight = 1.0;
                    let total = 0.0;
                    for (let i = 1; i <= rayTaps; i += 1) {
                        const tap = vec3(sceneColor.sample(st.add(stepV.mul(i))).rgb);
                        acc.addAssign(max(tap.sub(0.95), 0.0).mul(weight));
                        total += weight;
                        weight *= 0.94;
                    }
                    // Strongest near the sun, fading smoothly with distance (no visible rim).
                    const d = length(toSun.mul(vec2(this.uAspect, 1.0)));
                    const falloff = exp(d.mul(d).mul(-3.2));
                    const rays = acc.div(total).mul(falloff).mul(this.uSunVis).mul(this.uRays);
                    B.addAssign(rays.mul(vec3(1.0, 0.84, 0.62)).mul(0.75));
                }
            }
            const H = S.add(B).toVar();
            // Mid-tone contrast before the tone map (the darks are left alone).
            const Lh = max(dot(H, LUMA), 1e-4);
            H.mulAssign(pow(Lh.div(0.22), float(0.14).mul(smoothstep(0.015, 0.08, Lh))));

            const T = neutralToneMapping(H, float(1.0)).toVar();
            const L = dot(T, LUMA).toVar();
            const shadow = float(1.0).sub(smoothstep(0.0, 0.35, L));
            const high = smoothstep(0.4, 0.95, L);
            T.mulAssign(mix(vec3(1.0), vec3(0.95, 0.94, 1.1), shadow.mul(0.6)));
            T.mulAssign(mix(vec3(1.0), vec3(1.04, 1.0, 0.94), high.mul(0.5)));
            const mx = nvMax3(T);
            const sat = mx.sub(min(T.x, min(T.y, T.z))).div(max(mx, 1e-4));
            T.assign(mix(vec3(L), T, float(1.0).add(float(0.12).mul(float(1.0).sub(sat)))));
            const rad = length(centered.mul(vec2(this.uAspect.div(1.778), 1.0)).mul(2.0));
            T.mulAssign(float(1.0).sub(smoothstep(0.6, 1.4, rad).mul(0.22)));

            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const px = floor(screenCoordinate);
            const dth = nvHash21(px).add(nvHash21(px.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));
            return vec4(clamp(D, 0.0, 1.0), 1.0);
        });

        this.postProcessing.outputColorTransform = false;
        this.postProcessing.outputNode = outputFn();
        this.postProcessing.needsUpdate = true;
        this.size = { width: 0, height: 0 };
    }

    /** Per-frame uniforms (all optional). */
    update(params) {
        if (params.sun) this.uSun.value.copy(params.sun);
        if (params.sunVis !== undefined) this.uSunVis.value = params.sunVis;
        if (params.bloomBoost !== undefined) this.uBloomBoost.value = params.bloomBoost;
        if (params.rays !== undefined) this.uRays.value = params.rays;
    }

    render() {
        this.postProcessing.render();
    }

    setSize(width, height, bufferWidth = width, bufferHeight = height) {
        this.size.width = width;
        this.size.height = height;
        if (width > 0 && height > 0) this.uAspect.value = width / height;
        if (bufferWidth > 0 && bufferHeight > 0) this.uSrcTexel.value.set(1 / bufferWidth, 1 / bufferHeight);
    }

    dispose() {
        this.scenePass.dispose();
        if (this.bloomNode) disposeBloomNodeDeep(this.bloomNode);
        this.postProcessing.dispose();
    }
}
