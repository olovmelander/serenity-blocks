/**
 * Neon Dusk — post stack (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT), one bloom chain and ONE full-screen output pass:
 *   scene (with a whisper of VHS chroma at the screen edges, a real tape glitch on combos) →
 *   bloom (4-tap max-channel soft-knee prefilter, hue-preserving) → neutral tone map → dusk
 *   split-tone (violet shadows, warm highlights) → vignette → sRGB encode → triangular dither.
 *
 * No god rays: with a sun this large the bloom already carries its glow, and an A/B showed a
 * 16-tap radial march changed nothing visible while being the post's most expensive term.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    clamp,
    dot,
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
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { ndHash21, ndMax3 } from './neon-dusk-tsl.js';

/**
 * Per-tier look. `chroma` = VHS edge split (off = one scene tap instead of three). `msaa` is
 * the scene-pass sample count (WebGPU: 1 or 4): ridgelines against the sun are geometry edges.
 */
export const POST_LOOK = {
    Extreme: {
        bloom: true, bloomStrength: 0.9, bloomResolution: 0.5, chroma: true, msaa: 4,
    },
    Ultra: {
        bloom: true, bloomStrength: 0.88, bloomResolution: 0.45, chroma: true, msaa: 4,
    },
    High: {
        bloom: true, bloomStrength: 0.85, bloomResolution: 0.35, chroma: true, msaa: 4,
    },
    Medium: {
        bloom: true, bloomStrength: 0.78, bloomResolution: 0.3, chroma: true, msaa: 0,
    },
    Low: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, chroma: false, msaa: 0,
    },
    Minimal: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, chroma: false, msaa: 0,
    },
};

export const BLOOM_THRESHOLD = 1.0;
export const BLOOM_KNEE = 0.55;
export const BLOOM_RADIUS = 0.36;

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

export class NeonDuskPost {
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

        this.uTime = uniform(0);
        this.uAspect = uniform(16 / 9);
        this.uSrcTexel = uniform(new THREE.Vector2(1 / 1920, 1 / 1080));
        this.uBloomBoost = uniform(0);
        this.uGlitch = uniform(0);

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
                const br = ndMax3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        const withChroma = look.chroma === true;
        const outputFn = Fn(() => {
            const g = this.uGlitch;
            const t = this.uTime;
            const st0 = screenUV;
            // ── Tape glitch: a few horizontal bands slip sideways for a moment ──
            const rows = floor(st0.y.mul(28.0)).add(floor(t.mul(18.0)).mul(7.0));
            const hit = step(float(1.0).sub(g.mul(0.35)), ndHash21(vec2(rows, 3.1)));
            const slip = ndHash21(vec2(rows, 9.7)).sub(0.5).mul(0.05).mul(g)
                .mul(hit);
            const st = vec2(st0.x.add(slip), st0.y);
            const centered = st.sub(0.5);

            const S = vec3(0.0).toVar();
            if (withChroma) {
                // VHS chroma: R and B pull apart toward the edges (and a lot during a glitch).
                const r2 = dot(centered, centered);
                const split = centered.mul(r2.mul(0.012).add(g.mul(0.012)));
                const sr = sceneColor.sample(st.add(split)).r;
                const sg = sceneColor.sample(st).g;
                const sb = sceneColor.sample(st.sub(split)).b;
                S.assign(vec3(sr, sg, sb));
            } else {
                S.assign(sceneColor.sample(st).rgb);
            }

            const B = vec3(0.0).toVar();
            if (this.bloomNode) {
                const bloomTex = this.bloomNode.getTextureNode();
                B.assign(vec3(bloomTex.sample(st).rgb).mul(float(1.0).add(this.uBloomBoost.mul(0.35))));
            }
            const H = S.add(B).toVar();
            // Mid-tone contrast before the tone map (the darks are left alone).
            const Lh = max(dot(H, LUMA), 1e-4);
            H.mulAssign(pow(Lh.div(0.2), float(0.12).mul(smoothstep(0.01, 0.07, Lh))));

            const T = neutralToneMapping(H, float(1.0)).toVar();
            const L = dot(T, LUMA).toVar();
            // Dusk split-tone: violet-blue shadows, warm highlights.
            const shadow = float(1.0).sub(smoothstep(0.0, 0.3, L));
            const high = smoothstep(0.45, 0.95, L);
            T.mulAssign(mix(vec3(1.0), vec3(0.94, 0.9, 1.14), shadow.mul(0.7)));
            T.mulAssign(mix(vec3(1.0), vec3(1.05, 0.99, 0.93), high.mul(0.5)));
            // A touch more colour in the desaturated mids (neon stays neon).
            const mx = ndMax3(T);
            const sat = mx.sub(min(T.x, min(T.y, T.z))).div(max(mx, 1e-4));
            T.assign(mix(vec3(L), T, float(1.0).add(float(0.14).mul(float(1.0).sub(sat)))));
            // Glitch scanlines (only while the tape slips).
            const scan = sin(screenCoordinate.y.mul(2.1)).mul(0.5).add(0.5);
            T.mulAssign(float(1.0).sub(g.mul(0.18).mul(scan)));
            const rad = length(centered.mul(vec2(this.uAspect.div(1.778), 1.0)).mul(2.0));
            T.mulAssign(float(1.0).sub(smoothstep(0.55, 1.4, rad).mul(0.28)));

            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const px = floor(screenCoordinate);
            const dth = ndHash21(px).add(ndHash21(px.add(vec2(17.17, 17.17)))).sub(1.0);
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
        if (params.time !== undefined) this.uTime.value = params.time;
        if (params.bloomBoost !== undefined) this.uBloomBoost.value = params.bloomBoost;
        if (params.glitch !== undefined) this.uGlitch.value = params.glitch;
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
