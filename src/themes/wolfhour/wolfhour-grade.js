/**
 * Wolfhour's black-and-silver night grade. One scene read, one existing bloom chain,
 * and a static display-space dither keep the alpine silhouettes clean and calm.
 * Shared by the isolated playground and the shipping theme.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    clamp,
    dot,
    emissive,
    float,
    floor,
    fract,
    max,
    mix,
    mrt,
    output,
    pass,
    pow,
    renderOutput,
    screenCoordinate,
    smoothstep,
    uniform,
    vec2,
    vec3,
    vec4,
    viewportUV,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { withEmissiveMaterialBlending } from '../shared/mrt-blend.js';

const LUMA = vec3(0.2126, 0.7152, 0.0722);

function sanitizeDownsample(value, fallback = 0.58) {
    return Number.isFinite(value) ? Math.min(1.0, Math.max(0.3, value)) : fallback;
}

export class WolfhourGrade {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.useMRT = params.useMRT === true;
        this.bloomDownsample = sanitizeDownsample(params.bloomDownsample);
        this.size = { width: 0, height: 0 };

        this.postProcessing = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera);
        if (this.useMRT) {
            this.scenePass.setMRT(withEmissiveMaterialBlending(mrt({ output, emissive })));
        }
        const sceneColor = this.scenePass.getTextureNode('output');
        const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;
        this.bloomNode = bloom(
            bloomSource,
            params.bloomStrength ?? 0.38,
            params.bloomRadius ?? 0.5,
            params.bloomThreshold ?? 0.24,
        );
        // The previous setSize wrapper multiplied the native half-resolution
        // default. Preserve that actual pixel budget with r186's public API.
        this.bloomNode.setResolutionScale(0.5 * this.bloomDownsample);

        this.uSilverTintStrength = uniform(params.silverTintStrength ?? 0.18);
        this.uTintDesaturation = uniform(params.tintDesaturation ?? 0.56);
        this.uVignetteOffset = uniform(params.vignetteOffset ?? 1.18);
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.58);
        this.uExposure = uniform(params.exposure ?? 1.0);
        this.uContrast = uniform(params.contrast ?? 1.04);
        this.uSaturation = uniform(params.saturation ?? 0.98);
        this.uDitherStrength = uniform(params.ditherStrength ?? (1 / 255));

        this.postProcessing.outputNode = Fn(() => {
            const uv = viewportUV;
            const base = sceneColor.sample(uv).toVar();
            const hdr = max(base.rgb.add(this.bloomNode.rgb), vec3(0)).toVar();
            const luminance = dot(hdr, LUMA).toVar();

            // Preserve subtle cool shadows while bright moonlight becomes silver.
            // A slight warm highlight counterbalances the cool atmosphere.
            const silverMask = smoothstep(0.025, 0.48, luminance).toVar();
            const silver = mix(hdr, vec3(luminance), this.uTintDesaturation.mul(silverMask));
            const splitTint = mix(vec3(0.965, 0.98, 1.015), vec3(1.02, 1.015, 1.0), silverMask);
            hdr.assign(mix(hdr, silver.mul(splitTint), this.uSilverTintStrength));
            hdr.mulAssign(this.uExposure);

            // Contrast acts on luminance around a night-scene midpoint and
            // fades out at black. Never subtract a display midpoint from RGB:
            // that erased most of the former mountain and sky detail.
            const exposedLuma = max(dot(hdr, LUMA), 0.0001).toVar();
            const contrastMask = smoothstep(0.004, 0.055, exposedLuma);
            hdr.mulAssign(pow(exposedLuma.div(0.12), this.uContrast.sub(1.0).mul(contrastMask)));

            // ACES-like shoulder retains lunar/meteor highlights. A linear toe
            // beneath 0.035 keeps faint stars and snow ridges above black.
            const numerator = hdr.mul(hdr.mul(2.51).add(0.03));
            const denominator = hdr.mul(hdr.mul(2.43).add(0.59)).add(0.14);
            const filmic = clamp(numerator.div(denominator), 0.0, 1.0);
            const toeMask = smoothstep(0.0, 0.035, exposedLuma);
            const graded = mix(hdr, filmic, toeMask).toVar();
            const gradedLuma = dot(graded, LUMA);
            graded.assign(mix(vec3(gradedLuma), graded, this.uSaturation));

            // Squared radial falloff avoids another square root. Existing
            // profile values now make a soft 20% edge rather than a 60% mask.
            const centered = uv.sub(0.5).mul(2.0).toVar();
            const vignetteStart = max(this.uVignetteOffset.sub(0.55), 0.01);
            const vignetteEnd = max(this.uVignetteOffset, vignetteStart.add(0.01));
            const edge = smoothstep(
                vignetteStart.mul(vignetteStart),
                vignetteEnd.mul(vignetteEnd),
                dot(centered, centered),
            );
            graded.mulAssign(float(1.0).sub(edge.mul(this.uVignetteDarkness).mul(0.34)));

            // Encode exactly once, then dither at physical pixel frequency.
            // No time input: the night sky never develops crawling film grain.
            const display = renderOutput(
                vec4(clamp(graded, 0.0, 1.0), base.a),
                THREE.NoToneMapping,
                THREE.SRGBColorSpace,
            ).toVar();
            const pixel = floor(screenCoordinate);
            const noise = fract(fract(dot(pixel, vec2(0.06711056, 0.00583715))).mul(52.9829189));
            const dither = noise.sub(0.5).mul(this.uDitherStrength).mul(base.a);
            return vec4(clamp(display.rgb.add(dither), 0.0, 1.0), display.a);
        })();
        this.postProcessing.outputColorTransform = false;
        this.postProcessing.needsUpdate = true;
    }

    updateDynamic(params = {}) {
        if (params.bloomStrength !== undefined && this.bloomNode) {
            this.bloomNode.strength.value = params.bloomStrength;
        }
    }

    updateStaticProfile(params = {}) {
        if (params.bloomRadius !== undefined && this.bloomNode) {
            this.bloomNode.radius.value = params.bloomRadius;
        }
        if (params.bloomThreshold !== undefined && this.bloomNode) {
            this.bloomNode.threshold.value = params.bloomThreshold;
        }
        if (params.bloomDownsample !== undefined && this.bloomNode) {
            this.bloomDownsample = sanitizeDownsample(params.bloomDownsample, this.bloomDownsample);
            this.bloomNode.setResolutionScale(0.5 * this.bloomDownsample);
        }
        if (params.silverTintStrength !== undefined) this.uSilverTintStrength.value = params.silverTintStrength;
        if (params.tintDesaturation !== undefined) this.uTintDesaturation.value = params.tintDesaturation;
        if (params.vignetteOffset !== undefined) this.uVignetteOffset.value = params.vignetteOffset;
        if (params.vignetteDarkness !== undefined) this.uVignetteDarkness.value = params.vignetteDarkness;
        if (params.exposure !== undefined) this.uExposure.value = params.exposure;
        if (params.contrast !== undefined) this.uContrast.value = params.contrast;
        if (params.saturation !== undefined) this.uSaturation.value = params.saturation;
        if (params.ditherStrength !== undefined) this.uDitherStrength.value = params.ditherStrength;
    }

    update(params = {}) {
        this.updateStaticProfile(params);
        this.updateDynamic(params);
    }

    render() {
        this.postProcessing.render();
    }

    setSize(width, height) {
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
        this.size.width = width;
        this.size.height = height;
        // PassNode and BloomNode read the renderer's drawing-buffer dimensions
        // before rendering. CSS sizes here must not override the bloom budget.
    }

    dispose() {
        this.scenePass?.dispose();
        disposeBloomNodeDeep(this.bloomNode);
        this.postProcessing?.dispose();
        this.scenePass = null;
        this.bloomNode = null;
        this.postProcessing = null;
    }
}
