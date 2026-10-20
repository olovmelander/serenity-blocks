/**
 * Sunfall Theme — Post-Processing Pipeline (TSL RenderPipeline, WebGPU & WebGL2)
 *
 * Single scene pass (4× MSAA from High upward via `sceneSamples`, FXAA on Low/Medium),
 * optional downsampled bloom on Medium+ with a hue-preserving soft knee so the
 * white-gold oculus and chartreuse canopy glow without bleaching, calm-rect attenuation
 * behind the translucent board card and HUD, hue-preserving filmic shoulder, subtle
 * chamber vignette, grain/dither, and optional `falseColor` diagnostic.
 *
 * No screen-space godray pass is used: the Sunfall Pillar is an in-world 3D volumetric
 * cylinder (`createSunbeamMaterial`).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    pass,
    renderOutput,
    screenCoordinate,
    screenUV,
    select,
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
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { sceneSamples } from '../shared/scene-antialias.js';
import { resolveSunfallQuality } from './sunfall-quality.js';

export const BLOOM_THRESHOLD = 1.15;
export const BLOOM_KNEE = 0.45;
export const CALM_RECTS_MAX = 5;

const sfMax3 = Fn(([v]) => max(v.x, max(v.y, v.z)));
const sfLuma = Fn(([v]) => dot(v, vec3(0.2126, 0.7152, 0.0722)));
const sfHash21 = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));

const roundBoxSdf = Fn(([p, rect, radius]) => {
    const c = rect.xy.add(rect.zw).mul(0.5);
    const h = rect.zw.sub(rect.xy).mul(0.5);
    const q = abs(p.sub(c)).sub(h).add(radius);
    return length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(radius);
});

const sfFilmic = Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(sfMax3(c), 1e-5);
    const k = float(0.62);
    const shoulder = k.add(
        float(1.0).sub(k).mul(float(1.0).sub(exp(peak.sub(k).div(float(1.0).sub(k)).negate()))),
    );
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    const w = smoothstep(2.2, 8.5, peak).mul(0.85);
    return mix(toned, vec3(mapped, mapped, mapped), w);
});

export function resolveSunfallPostLook(quality = 'High') {
    const preset = resolveSunfallQuality(quality);
    return {
        tier: preset.tier,
        bloom: Boolean(preset.enableBloom),
        bloomStrength: preset.bloomStrength ?? 0.16,
        bloomRadius: preset.bloomRadius ?? 0.52,
        bloomResolution: preset.bloomDownsample ?? 0.5,
        fxaa: Boolean(preset.enableFXAA),
        msaa: sceneSamples(preset.tier),
    };
}

export class SunfallPost {
    constructor(renderer, scene, camera, params = {}) {
        const look = params.look || resolveSunfallPostLook(params.quality || 'High');
        this.renderer = renderer;
        this.camera = camera;
        this.look = look;
        this.samples = params.samples ?? look.msaa ?? 0;
        this.pipeline = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: this.samples });
        const sceneColor = this.scenePass.getTextureNode('output');

        this.uAspect = uniform(16 / 9);
        this.uSrcTexel = uniform(new THREE.Vector2(1 / 1920, 1 / 1080));
        this.uViewport = uniform(new THREE.Vector2(1920, 1080));
        this.uTime = uniform(0);
        this.uExposure = uniform(1.05);
        this.uBloomBoost = uniform(0);
        this.uFlash = uniform(0);
        this.uFlashColour = uniform(new THREE.Vector3(1.0, 0.95, 0.80));
        this.uSaturation = uniform(1.08);

        this.calmRects = Array.from({ length: CALM_RECTS_MAX }, () => new THREE.Vector4(0, 0, 0, 0));
        this.uCalm = this.calmRects.map((v) => uniform(v));
        this.uCalmStrength = uniform(0);

        this.bloomNode = null;
        if (look.bloom && params.bloom !== false) {
            this.bloomNode = bloom(
                sceneColor,
                look.bloomStrength,
                look.bloomRadius,
                BLOOM_THRESHOLD,
            );
            this.bloomNode.threshold.value = BLOOM_THRESHOLD;
            this.bloomNode.smoothWidth.value = BLOOM_KNEE;
            this.bloomNode.setResolutionScale(look.bloomResolution);
            const { uSrcTexel } = this;
            this.bloomNode.highPassFn = Fn(({ input, threshold, smoothWidth }) => {
                const st = uv();
                const o = uSrcTexel.mul(1.25);
                const tapB = (dx, dy) => {
                    const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
                    return c.mul(min(float(1.0), float(3.0).div(max(sfMax3(c), 1e-4))));
                };
                const c = tapB(1, 1).add(tapB(-1, 1)).add(tapB(1, -1)).add(tapB(-1, -1))
                    .mul(0.25);
                const br = sfMax3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(
                    soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)),
                    br.sub(threshold),
                ).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        const falseColor = params.falseColor === true;

        const outputFn = Fn(() => {
            const px = screenUV.mul(this.uViewport);
            const hScale = this.uViewport.y.div(1080.0);
            const calm = float(0.0).toVar();
            for (let i = 0; i < CALM_RECTS_MAX; i += 1) {
                const r = this.uCalm[i];
                const sdf = roundBoxSdf(px, r.mul(vec4(this.uViewport, this.uViewport)), hScale.mul(16.0));
                const inside = float(1.0).sub(smoothstep(-20.0, 6.0, sdf)).mul(step(0.001, r.z.sub(r.x)));
                calm.assign(max(calm, inside));
            }
            calm.mulAssign(this.uCalmStrength);

            const S = vec3(sceneColor.sample(screenUV).rgb).toVar();
            const m = max(sfMax3(S), 1e-5);
            const clipped = S.mul(min(m, min(float(0.22).add(m.mul(0.10)), 0.55)).div(m));
            S.assign(mix(S, clipped, calm.mul(0.82)));

            const glare = vec3(0.0).toVar();
            if (this.bloomNode) {
                const B = vec3(this.bloomNode.getTextureNode().sample(screenUV).rgb);
                glare.assign(B.mul(float(1.0).add(this.uBloomBoost.mul(0.75))));
            }
            glare.mulAssign(float(1.0).sub(calm.mul(0.85)));
            const H = S.add(glare);

            const flash = this.uFlashColour.mul(this.uFlash.mul(0.26)).mul(float(1.0).sub(calm.mul(0.8)));
            const X = H.mul(this.uExposure).add(flash);
            const T = sfFilmic(X).toVar();

            const sat = max(sfMax3(T).sub(min(T.x, min(T.y, T.z))), 0.0).div(max(sfMax3(T), 1e-4));
            const vib = mix(this.uSaturation, float(1.0), sat);
            T.assign(max(mix(vec3(sfLuma(T)), T, vib), vec3(0.0)));

            const C = clamp(T, 0.0, 1.0);
            T.assign(mix(C, C.mul(C).mul(float(3.0).sub(C.mul(2.0))), 0.28));

            const cv = screenUV.sub(0.5).mul(vec2(this.uAspect.div(1.778), 1.0));
            const vig = smoothstep(0.52, 1.22, length(cv.mul(1.38)));
            T.mulAssign(float(1.0).sub(vig.mul(0.24)));

            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const pxi = floor(screenCoordinate);
            const frame = floor(this.uTime.mul(24.0));
            const grain = sfHash21(pxi.add(vec2(frame.mul(1.7), frame.mul(-2.3)))).sub(0.5);
            D.addAssign(grain.mul(0.009).mul(float(1.0).sub(calm.mul(0.7))));
            const dth = sfHash21(pxi).add(sfHash21(pxi.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));

            let out = vec4(clamp(D, 0.0, 1.0), 1.0);
            if (falseColor) {
                const mx = sfMax3(H.mul(this.uExposure));
                const fc = select(
                    mx.lessThan(0.1),
                    vec3(0.05, 0.1, 0.6),
                    select(
                        mx.lessThan(0.6),
                        vec3(0.1, 0.55, 0.15),
                        select(
                            mx.lessThan(1.0),
                            vec3(0.85, 0.8, 0.1),
                            select(mx.lessThan(2.5), vec3(1.0, 0.45, 0.05), vec3(0.95, 0.05, 0.05)),
                        ),
                    ),
                );
                out = vec4(fc, 1.0);
            }
            return out;
        });

        this.pipeline.outputColorTransform = false;
        const smoothPass = look.fxaa && this.samples === 0 && params.antialias !== false && !falseColor;
        this.fxaaNode = smoothPass ? fxaa(outputFn()) : null;
        this.pipeline.outputNode = this.fxaaNode || outputFn();
        this.pipeline.needsUpdate = true;
    }

    update({
        exposure,
        bloomBoost,
        flash,
        flashColour,
        saturation,
        time,
    } = {}) {
        if (exposure !== undefined) this.uExposure.value = exposure;
        if (bloomBoost !== undefined) this.uBloomBoost.value = bloomBoost;
        if (flash !== undefined) this.uFlash.value = flash;
        if (flashColour) this.uFlashColour.value.set(flashColour[0], flashColour[1], flashColour[2]);
        if (saturation !== undefined) this.uSaturation.value = saturation;
        if (time !== undefined) this.uTime.value = time;
        if (this.bloomNode && exposure !== undefined) {
            this.bloomNode.threshold.value = BLOOM_THRESHOLD / Math.max(0.2, exposure);
        }
    }

    setCalmRects(rects, strength) {
        for (let i = 0; i < CALM_RECTS_MAX; i += 1) {
            const r = rects?.[i];
            if (r) this.calmRects[i].set(r.x0, r.y0, r.x1, r.y1);
            else this.calmRects[i].set(0, 0, 0, 0);
        }
        this.uCalmStrength.value = strength;
    }

    setSize(width, height, bufferWidth = width, bufferHeight = height) {
        if (width > 0 && height > 0) this.uAspect.value = width / height;
        if (bufferWidth > 0 && bufferHeight > 0) {
            this.uSrcTexel.value.set(1 / bufferWidth, 1 / bufferHeight);
            this.uViewport.value.set(bufferWidth, bufferHeight);
        }
    }

    render() {
        this.pipeline.render();
    }

    dispose() {
        this.scenePass?.dispose();
        if (this.bloomNode) disposeBloomNodeDeep(this.bloomNode);
        this.fxaaNode?.textureNode?.dispose?.();
        this.pipeline?.dispose();
        this.scenePass = null;
        this.bloomNode = null;
        this.fxaaNode = null;
        this.pipeline = null;
    }
}

export function createPassThroughPipeline(renderer, scene, camera) {
    const pipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera, { samples: 0 });
    pipeline.outputNode = scenePass;
    return {
        render: () => pipeline.render(),
        update() {},
        setCalmRects() {},
        setSize() {},
        dispose() {
            scenePass.dispose();
            pipeline.dispose();
        },
    };
}
