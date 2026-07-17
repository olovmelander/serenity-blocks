/**
 * Stellar Velocity - WebGPU Post Processing (Phase 4)
 * MRT-aware post chain with emissive-isolated bloom, warp-scaled vignette,
 * edge-weighted chromatic aberration, ACES grade, and dithering.
 */

import * as THREE_WEBGPU from 'three/webgpu';
import {
    pass,
    mrt,
    output,
    emissive,
    viewportUV,
    uniform,
    float,
    length,
    smoothstep,
    mix,
    vec2,
    vec3,
    vec4,
    dot,
    clamp,
    fract,
    sin,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';

export class StellarVelocityPost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.requestedMRT = params.useMRT === true;
        this.useMRT = this.requestedMRT;
        this.size = { width: 0, height: 0 };
        this.bloomDownsample = params.bloomDownsample ?? 0.8;
        this.mrtInitError = null;
        this.lastRenderCostMs = 0;
        this.enableTiming = params.enableTiming !== false;

        this.postProcessing = new THREE_WEBGPU.PostProcessing(renderer);
        this.scenePass = pass(scene, camera);
        if (this.useMRT) {
            try {
                this.scenePass.setMRT(mrt({ output, emissive }));
            } catch (error) {
                this.mrtInitError = error;
                this.useMRT = false;
            }
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;
        const bloomThreshold = params.bloomThreshold ?? (this.useMRT ? 0.0 : 0.7);
        this.bloomNode = bloom(
            bloomSource,
            params.bloomStrength ?? 0.45,
            params.bloomRadius ?? 0.40,
            bloomThreshold,
        );

        const originalBloomSetSize = this.bloomNode.setSize.bind(this.bloomNode);
        this.bloomNode.setSize = (width, height) => {
            originalBloomSetSize(width * this.bloomDownsample, height * this.bloomDownsample);
        };

        this.uVignetteOffset = uniform(params.vignetteOffset ?? 1.12);
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.34);
        this.uWarpSpeed = uniform(params.warpSpeed ?? 0.0);
        this.uChromaticStrength = uniform(params.chromaticStrength ?? 0.0);
        this.uExposure = uniform(params.exposure ?? 1.03);
        this.uContrast = uniform(params.contrast ?? 1.08);
        this.uSaturation = uniform(params.saturation ?? 1.10);
        this.uTintStrength = uniform(params.tintStrength ?? 0.12);
        this.uDitherStrength = uniform(params.ditherStrength ?? 0.0018);
        this.uTime = uniform(params.time ?? 0.0);
        this.uTintColor = uniform(new THREE_WEBGPU.Color(0.94, 0.98, 1.08));

        const uv = viewportUV;
        const centered = uv.sub(0.5).mul(2.0);
        const dist = length(centered);
        const warpMask = clamp(this.uWarpSpeed, float(0.0), float(1.0));
        const dynamicVignetteOffset = clamp(
            this.uVignetteOffset.sub(warpMask.mul(0.18)),
            float(0.82),
            float(1.35),
        );
        const dynamicVignetteDarkness = clamp(
            this.uVignetteDarkness.add(warpMask.mul(0.38)),
            float(0.0),
            float(0.9),
        );

        const baseSample = sceneColor.sample(uv);
        const vignette = smoothstep(dynamicVignetteOffset, dynamicVignetteOffset.sub(0.52), dist);
        const vignetteColor = mix(
            baseSample.mul(float(1.0).sub(dynamicVignetteDarkness)),
            baseSample,
            vignette,
        );

        const edgeMask = smoothstep(float(0.08), float(1.0), dist);
        const chromaticStrength = this.uChromaticStrength.mul(edgeMask);
        const chroma = chromaticAberration(vignetteColor, chromaticStrength, vec2(0.5, 0.5), 1.1);
        const combined = chroma.add(this.bloomNode);
        const exposed = combined.rgb.mul(this.uExposure);

        // ACES Filmic tone mapping
        const acesA = float(2.51);
        const acesB = float(0.03);
        const acesC = float(2.43);
        const acesD = float(0.59);
        const acesE = float(0.14);
        const acesNum = exposed.mul(exposed.mul(acesA).add(acesB));
        const acesDen = exposed.mul(exposed.mul(acesC).add(acesD)).add(acesE);
        const toneMapped = clamp(acesNum.div(acesDen), float(0.0), float(1.0));

        // Deep-space grade
        const luma = dot(toneMapped, vec3(0.2126, 0.7152, 0.0722));
        const saturated = mix(vec3(luma), toneMapped, this.uSaturation);
        const contrasted = saturated.sub(0.5).mul(this.uContrast).add(0.5);
        const graded = mix(contrasted, contrasted.mul(this.uTintColor), this.uTintStrength);

        // Dither to reduce deep-space banding
        const noise = fract(
            sin(
                dot(
                    uv.add(vec2(this.uTime.mul(0.011), this.uTime.mul(0.017))),
                    vec2(12.9898, 78.233),
                ),
            ).mul(43758.5453),
        );
        const dither = noise.sub(0.5).mul(this.uDitherStrength);
        const finalColor = clamp(graded.add(dither), float(0.0), float(1.0));

        this.postProcessing.outputNode = vec4(finalColor, combined.a);
        this.postProcessing.needsUpdate = true;
    }

    getDiagnostics() {
        return {
            requestedMRT: this.requestedMRT,
            useMRT: this.useMRT,
            mrtInitError: this.mrtInitError?.message || null,
            bloomDownsample: this.bloomDownsample,
            lastRenderCostMs: this.lastRenderCostMs,
            timingEnabled: this.enableTiming,
        };
    }

    getLastRenderCostMs() {
        return this.lastRenderCostMs;
    }

    update(params = {}) {
        if (params.bloomStrength !== undefined && this.bloomNode?.strength) {
            this.bloomNode.strength.value = params.bloomStrength;
        }
        if (params.bloomRadius !== undefined && this.bloomNode?.radius) {
            this.bloomNode.radius.value = params.bloomRadius;
        }
        if (params.bloomThreshold !== undefined && this.bloomNode?.threshold) {
            this.bloomNode.threshold.value = params.bloomThreshold;
        }
        if (params.bloomDownsample !== undefined) {
            this.bloomDownsample = params.bloomDownsample;
            if (this.size.width > 0 && this.size.height > 0 && this.bloomNode?._separableBlurMaterials?.length) {
                this.bloomNode.setSize(this.size.width, this.size.height);
            }
        }
        if (params.vignetteOffset !== undefined) {
            this.uVignetteOffset.value = params.vignetteOffset;
        }
        if (params.vignetteDarkness !== undefined) {
            this.uVignetteDarkness.value = params.vignetteDarkness;
        }
        if (params.warpSpeed !== undefined) {
            this.uWarpSpeed.value = params.warpSpeed;
        }
        if (params.chromaticStrength !== undefined) {
            this.uChromaticStrength.value = params.chromaticStrength;
        }
        if (params.exposure !== undefined) {
            this.uExposure.value = params.exposure;
        }
        if (params.contrast !== undefined) {
            this.uContrast.value = params.contrast;
        }
        if (params.saturation !== undefined) {
            this.uSaturation.value = params.saturation;
        }
        if (params.tintStrength !== undefined) {
            this.uTintStrength.value = params.tintStrength;
        }
        if (params.tintColor !== undefined && this.uTintColor?.value) {
            const tintValue = params.tintColor;
            if (tintValue?.isColor && this.uTintColor.value.copy) {
                this.uTintColor.value.copy(tintValue);
            } else if (Array.isArray(tintValue) && tintValue.length >= 3 && this.uTintColor.value.setRGB) {
                this.uTintColor.value.setRGB(tintValue[0], tintValue[1], tintValue[2]);
            } else if (
                tintValue
                && Number.isFinite(tintValue.r)
                && Number.isFinite(tintValue.g)
                && Number.isFinite(tintValue.b)
                && this.uTintColor.value.setRGB
            ) {
                this.uTintColor.value.setRGB(tintValue.r, tintValue.g, tintValue.b);
            }
        }
        if (params.ditherStrength !== undefined) {
            this.uDitherStrength.value = params.ditherStrength;
        }
        if (params.time !== undefined) {
            this.uTime.value = params.time;
        }
    }

    render() {
        if (!this.postProcessing) return;
        const shouldTime = this.enableTiming === true;
        const startMs = shouldTime
            ? (typeof performance !== 'undefined' ? performance.now() : Date.now())
            : 0;
        this.postProcessing.render();
        if (shouldTime) {
            const endMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
            this.lastRenderCostMs = Math.max(0, endMs - startMs);
        } else {
            this.lastRenderCostMs = 0;
        }
    }

    setSize(width, height) {
        if (!Number.isFinite(width) || !Number.isFinite(height)) return;
        if (width <= 0 || height <= 0) return;
        this.size.width = width;
        this.size.height = height;
        this.scenePass.setSize(width, height);
        if (this.bloomNode?._separableBlurMaterials?.length) {
            this.bloomNode.setSize(width, height);
        }
    }

    dispose() {
        this.scenePass?.dispose?.();
        disposeBloomNodeDeep(this.bloomNode);
        this.postProcessing?.dispose?.();
    }
}
