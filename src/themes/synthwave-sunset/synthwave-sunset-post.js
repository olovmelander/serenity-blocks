/**
 * Synthwave Sunset — post stack (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT), one bloom chain (Medium and up) and ONE full-screen output pass:
 *   scene (+ radial chromatic aberration on the showcase tiers) → bloom (4-tap, max-channel
 *   soft-knee prefilter so thin bulbs and railings do not flicker) → a hue-preserving filmic
 *   shoulder on the brightest channel (the sun and the neon keep their colour; only the hottest
 *   cores whiten) → split-tone grade by scaling only (teal shadows, warm highlights: no additive
 *   lift, so blacks never take a coloured veil) → vibrance → vignette → sRGB encode → grain on
 *   the darks → triangular dither.
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
    pass,
    renderOutput,
    screenCoordinate,
    screenUV,
    select,
    smoothstep,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { swHash21, swMax3 } from './synthwave-sunset-tsl.js';

/**
 * Per-tier look. `bloom: false` builds no BloomNode (emitters still read through the grade).
 * `msaa` is the scene-pass sample count (WebGPU: 1 or 4). Shader detail is anti-aliased
 * analytically, but box silhouettes, palm trunks and mountain ridges are geometry edges that only
 * MSAA smooths — without it they stair-step and crawl as the camera drifts.
 */
export const POST_LOOK = {
    Extreme: {
        bloom: true, bloomStrength: 0.95, bloomResolution: 0.5, grain: true, ca: 1.0, msaa: 4,
    },
    Ultra: {
        bloom: true, bloomStrength: 0.92, bloomResolution: 0.45, grain: true, ca: 0.7, msaa: 4,
    },
    High: {
        bloom: true, bloomStrength: 0.9, bloomResolution: 0.4, grain: true, ca: 0, msaa: 4,
    },
    Medium: {
        bloom: true, bloomStrength: 0.8, bloomResolution: 0.3, grain: false, ca: 0, msaa: 0,
    },
    Low: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, grain: false, ca: 0, msaa: 0,
    },
    Minimal: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, grain: false, ca: 0, msaa: 0,
    },
};

export const BLOOM_THRESHOLD = 1.0;
export const BLOOM_KNEE = 0.5;
export const BLOOM_RADIUS = 0.55;

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

export class SynthwaveSunsetPost {
    /**
     * @param {THREE.WebGPURenderer} renderer
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {object} [params]
     * @param {object} [params.look]     POST_LOOK entry
     * @param {number} [params.samples]  scene-pass MSAA samples (default look.msaa)
     * @param {boolean} [params.grain=true]  false in deterministic capture modes
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
        this.uSun = uniform(new THREE.Vector2(0.25, 0.55));
        this.uSunVis = uniform(0);
        this.uBloomBoost = uniform(0);
        this.uExposure = uniform(1.0);
        this.grainEnabled = params.grain !== false && look.grain === true;
        this.uGrain = uniform(this.grainEnabled ? 3.5 / 255 : 0);
        this.uGrainPhase = uniform(0);

        // ── Bloom (Medium and up) ──
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
                const br = swMax3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        const caAmount = look.ca ?? 0;
        const outputFn = Fn(() => {
            const st = screenUV;
            const centered = st.sub(0.5).toVar();

            // ── Scene (+ radial CA on the showcase tiers) ──
            const S = vec3(sceneColor.sample(st).rgb).toVar();
            if (caAmount > 0) {
                const off = centered.mul(length(centered)).mul(0.0045 * caAmount);
                S.x.assign(sceneColor.sample(st.add(off)).r);
                S.z.assign(sceneColor.sample(st.sub(off)).b);
            }

            // ── Bloom ──
            const B = vec3(0.0).toVar();
            if (this.bloomNode) {
                const glow = vec3(this.bloomNode.getTextureNode().sample(st).rgb);
                B.assign(glow.mul(float(1.0).add(this.uBloomBoost.mul(0.25))));
            }
            const H = S.add(B).toVar();

            // ── Tone curve: identity to 0.62, then a soft shoulder to 1 on the max channel; the
            // other channels keep their ratio to it, so hue survives. Only cores above ~4 bleach.
            const E = H.mul(this.uExposure).toVar();
            const m = max(swMax3(E), 1e-5).toVar();
            const knee = float(0.62);
            const shoulder = knee.add(float(1.0).sub(knee).mul(float(1.0).sub(exp(m.sub(knee).div(float(1.0).sub(knee)).negate()))));
            const mapped = select(m.lessThan(knee), m, shoulder);
            const T = E.mul(mapped.div(m)).toVar();
            // vec3(select) collapses to a scalar in r186: spell the vector out.
            T.assign(mix(T, vec3(mapped, mapped, mapped), smoothstep(4.0, 14.0, m).mul(0.55)));
            const L = dot(T, LUMA).toVar();
            // Split tone by scaling only: teal-blue shadows, warm highlights.
            const shadow = float(1.0).sub(smoothstep(0.0, 0.3, L));
            const high = smoothstep(0.35, 0.95, L);
            T.mulAssign(mix(vec3(1.0), vec3(0.9, 0.97, 1.1), shadow.mul(0.5)));
            T.mulAssign(mix(vec3(1.0), vec3(1.05, 0.99, 0.92), high.mul(0.4)));
            // Vibrance: lift the less-saturated colours most.
            const mx = swMax3(T);
            const sat = mx.sub(min(T.x, min(T.y, T.z))).div(max(mx, 1e-4));
            T.assign(mix(vec3(L), T, float(1.0).add(float(0.14).mul(float(1.0).sub(sat)))));
            // Vignette: mostly the corners, gentler on bright pixels.
            const rad = length(centered.mul(vec2(this.uAspect.div(1.778), 1.0)).mul(2.0));
            T.mulAssign(float(1.0).sub(smoothstep(0.55, 1.35, rad).mul(float(0.34).sub(L.mul(0.15)))));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const px = floor(screenCoordinate);
            const gp = this.uGrainPhase;
            const gn = swHash21(px.add(vec2(gp.mul(113.1), gp.mul(71.7)))).sub(0.5);
            D.addAssign(gn.mul(this.uGrain).mul(float(1.0).sub(smoothstep(0.03, 0.18, swMax3(D)))));
            const dth = swHash21(px).add(swHash21(px.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));
            return vec4(clamp(D, 0.0, 1.0), 1.0);
        });

        this.postProcessing.outputColorTransform = false;
        this.postProcessing.outputNode = outputFn();
        this.postProcessing.needsUpdate = true;
        this.size = { width: 0, height: 0 };
    }

    /**
     * Per-frame uniforms (all optional).
     * @param {{time?: number, sun?: THREE.Vector2, sunVis?: number, bloomBoost?: number}} params
     */
    update(params) {
        if (params.time !== undefined) this.uGrainPhase.value = Math.floor(params.time * 24) % 256;
        if (params.sun) this.uSun.value.copy(params.sun);
        if (params.sunVis !== undefined) this.uSunVis.value = params.sunVis;
        if (params.bloomBoost !== undefined) this.uBloomBoost.value = params.bloomBoost;
    }

    setGrainEnabled(enabled) {
        this.uGrain.value = enabled && this.look.grain === true ? 3.5 / 255 : 0;
    }

    render() {
        this.postProcessing.render();
    }

    /** The scene pass and bloom chain size themselves from the drawing buffer every frame. */
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
