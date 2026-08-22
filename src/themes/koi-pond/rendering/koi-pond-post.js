/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved */
/**
 * Koi Pond — "Moonwake Sanctuary" WebGPU node post-processing.
 *
 * The theme authors every glow (moon, lantern, spirit snake, koi gills, troll
 * eye, motes, pond rim) as an HDR accent that only reads once a threshold bloom
 * lifts it. This chain is the keystone that pass was authored for:
 *
 *   pass(scene, camera)                          linear HDR scene
 *     -> bloom(sceneColor, strength, r, thresh)  glow added in LINEAR before grade
 *     -> agxToneMapping(exposed)                 filmic curve that HOLDS jade/violet
 *        (ACES yellow-skews exactly this theme's teal + violet identity)
 *     -> cool-shadow / warm-highlight split-tone (nocturnal grade)
 *     -> vignette + saturation + optional grain + blue-noise dither
 *
 * Modeled on the proven in-repo src/themes/wolfhour/wolfhour-post.js so the
 * setSize / bloom-downsample / dispose plumbing matches a shipped surface.
 * `renderOutput` (RenderPipeline.outputColorTransform) applies the renderer's
 * NoToneMapping + sRGB OETF to our linear output — so AgX runs once, in-graph.
 */
import * as THREE from 'three/webgpu';
import {
    agxToneMapping,
    clamp,
    dot,
    float,
    fract,
    length,
    mix,
    pass,
    sin,
    smoothstep,
    uniform,
    vec2,
    vec3,
    vec4,
    viewportUV,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../../shared/bloom-dispose.js';

const LUMA = vec3(0.2126, 0.7152, 0.0722);

export const KOI_POND_POST_PROFILES = Object.freeze({
    Minimal: Object.freeze({
        enabled: false,
        bloomStrength: 0.0,
        bloomRadius: 0.6,
        bloomThreshold: 0.6,
        bloomDownsample: 0.5,
        exposure: 1.0,
        contrast: 1.0,
        saturation: 1.0,
        splitStrength: 0.0,
        vignetteOffset: 1.25,
        vignetteDarkness: 0.0,
        useFilmGrain: false,
        grainStrength: 0.0,
        ditherStrength: 0.0012,
    }),
    Low: Object.freeze({
        enabled: false,
        bloomStrength: 0.0,
        bloomRadius: 0.6,
        bloomThreshold: 0.6,
        bloomDownsample: 0.5,
        exposure: 1.0,
        contrast: 1.0,
        saturation: 1.0,
        splitStrength: 0.0,
        vignetteOffset: 1.25,
        vignetteDarkness: 0.0,
        useFilmGrain: false,
        grainStrength: 0.0,
        ditherStrength: 0.0012,
    }),
    Medium: Object.freeze({
        enabled: true,
        bloomStrength: 0.52,
        bloomRadius: 0.6,
        bloomThreshold: 0.62,
        bloomDownsample: 0.5,
        exposure: 1.16,
        contrast: 1.045,
        saturation: 1.08,
        splitStrength: 0.7,
        vignetteOffset: 1.16,
        vignetteDarkness: 0.32,
        useFilmGrain: false,
        grainStrength: 0.0,
        ditherStrength: 0.0016,
    }),
    High: Object.freeze({
        enabled: true,
        bloomStrength: 0.62,
        bloomRadius: 0.64,
        bloomThreshold: 0.58,
        bloomDownsample: 0.55,
        exposure: 1.18,
        contrast: 1.05,
        saturation: 1.1,
        splitStrength: 1.0,
        vignetteOffset: 1.14,
        vignetteDarkness: 0.36,
        useFilmGrain: true,
        grainStrength: 0.0012,
        ditherStrength: 0.0018,
    }),
    Ultra: Object.freeze({
        enabled: true,
        bloomStrength: 0.68,
        bloomRadius: 0.66,
        bloomThreshold: 0.55,
        bloomDownsample: 0.6,
        exposure: 1.2,
        contrast: 1.05,
        saturation: 1.12,
        splitStrength: 1.05,
        vignetteOffset: 1.13,
        vignetteDarkness: 0.38,
        useFilmGrain: true,
        grainStrength: 0.0013,
        ditherStrength: 0.002,
    }),
    Extreme: Object.freeze({
        enabled: true,
        bloomStrength: 0.72,
        bloomRadius: 0.68,
        bloomThreshold: 0.53,
        bloomDownsample: 0.62,
        exposure: 1.2,
        contrast: 1.05,
        saturation: 1.12,
        splitStrength: 1.1,
        vignetteOffset: 1.12,
        vignetteDarkness: 0.4,
        useFilmGrain: true,
        grainStrength: 0.0014,
        ditherStrength: 0.0022,
    }),
});

export function getKoiPondPostProfile(qualityName) {
    const key = typeof qualityName === 'string' ? qualityName : 'High';
    const profile = KOI_POND_POST_PROFILES[key] || KOI_POND_POST_PROFILES.High;
    return { ...profile };
}

export class KoiPondPost {
    constructor(renderer, scene, camera, params = {}) {
        const sanitizeDownsample = (value, fallback = 0.55) => (
            Number.isFinite(value) ? Math.min(1.0, Math.max(0.3, value)) : fallback
        );

        this.renderer = renderer;
        this.bloomDownsample = sanitizeDownsample(params.bloomDownsample, 0.55);
        this.size = { width: 0, height: 0 };
        this.useFilmGrain = params.useFilmGrain === true;
        this.baseGrainStrength = Number.isFinite(params.grainStrength) ? params.grainStrength : 0.0012;

        this.postProcessing = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera);

        // Output-threshold bloom: the marquee glows are MeshBasicNodeMaterial
        // (colorNode only) and write nothing to an emissive MRT target, so we
        // bloom the composited scene color above a luminance threshold instead.
        // Anything pushed into HDR (>threshold) blooms; the dark zen palette
        // stays below it. Bloom is added in LINEAR, before AgX.
        const sceneColor = this.scenePass.getTextureNode('output');
        this.bloomNode = bloom(
            sceneColor,
            params.bloomStrength ?? 0.62,
            params.bloomRadius ?? 0.64,
            params.bloomThreshold ?? 0.58,
        );
        const originalBloomSetSize = this.bloomNode.setSize.bind(this.bloomNode);
        this.bloomNode.setSize = (width, height) => {
            originalBloomSetSize(width * this.bloomDownsample, height * this.bloomDownsample);
        };

        this.uTime = uniform(0);
        this.uExposure = uniform(params.exposure ?? 1.18);
        this.uContrast = uniform(params.contrast ?? 1.05);
        this.uSaturation = uniform(params.saturation ?? 1.1);
        this.uSplitStrength = uniform(params.splitStrength ?? 1.0);
        this.uVignetteOffset = uniform(params.vignetteOffset ?? 1.14);
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.36);
        this.uDitherStrength = uniform(params.ditherStrength ?? 0.0018);
        this.uGrainStrength = uniform(this.useFilmGrain ? this.baseGrainStrength : 0.0);

        const uv = viewportUV;
        const baseColor = sceneColor.sample(uv);
        const bloomColor = baseColor.add(this.bloomNode);

        // AgX filmic tone map (linear in -> linear-sRGB out). Exposure folded in.
        let graded = agxToneMapping(bloomColor.rgb, this.uExposure);

        // Nocturnal split-tone: cool moonlit shadows, warm lantern highlights.
        const luma = dot(graded, LUMA);
        const shadowWeight = smoothstep(0.42, 0.0, luma);
        const highWeight = smoothstep(0.4, 0.95, luma);
        const coolShadow = vec3(-0.014, 0.004, 0.026).mul(shadowWeight);
        const warmHighlight = vec3(0.024, 0.009, -0.02).mul(highWeight);
        graded = graded.add(coolShadow.add(warmHighlight).mul(this.uSplitStrength));

        // Saturation (AgX desaturates saturated hues slightly; nudge jade/violet back).
        const gradedLuma = dot(graded, LUMA);
        graded = mix(vec3(gradedLuma), graded, this.uSaturation);
        // Contrast about mid.
        graded = graded.sub(0.5).mul(this.uContrast).add(0.5);

        // Vignette — deepen the frame corners, focus the eye on the pond.
        const centered = uv.sub(0.5).mul(2.0);
        const dist = length(centered);
        const vignetteMask = float(1.0).sub(
            smoothstep(this.uVignetteOffset.sub(0.6), this.uVignetteOffset, dist),
        );
        graded = mix(
            graded.mul(float(1.0).sub(this.uVignetteDarkness)),
            graded,
            vignetteMask,
        );

        let withGrain = graded;
        if (this.useFilmGrain) {
            const grainNoise = fract(
                sin(dot(
                    uv.mul(148.37).add(vec2(this.uTime.mul(0.73), this.uTime.mul(1.17))),
                    vec2(12.9898, 78.233),
                )).mul(43758.5453),
            );
            withGrain = graded.add(vec3(grainNoise.sub(0.5).mul(this.uGrainStrength)));
        }

        const ditherNoise = fract(sin(dot(uv.mul(311.7), vec2(127.1, 269.5))).mul(43758.5453));
        const finalColor = clamp(
            withGrain.add(vec3(ditherNoise.sub(0.5).mul(this.uDitherStrength))),
            float(0.0),
            float(1.0),
        );

        this.postProcessing.outputNode = vec4(finalColor.x, finalColor.y, finalColor.z, baseColor.a);
        this.postProcessing.needsUpdate = true;
        this.sanitizeDownsample = sanitizeDownsample;
    }

    updateDynamic(params = {}) {
        if (params.time !== undefined) this.uTime.value = params.time;
        if (params.bloomStrength !== undefined && this.bloomNode?.strength) {
            this.bloomNode.strength.value = params.bloomStrength;
        }
    }

    updateStaticProfile(params = {}) {
        if (params.bloomRadius !== undefined && this.bloomNode?.radius) {
            this.bloomNode.radius.value = params.bloomRadius;
        }
        if (params.bloomThreshold !== undefined && this.bloomNode?.threshold) {
            this.bloomNode.threshold.value = params.bloomThreshold;
        }
        if (params.bloomDownsample !== undefined) {
            this.bloomDownsample = this.sanitizeDownsample(params.bloomDownsample, this.bloomDownsample);
            if (this.size.width > 0 && this.size.height > 0 && this.bloomNode?._separableBlurMaterials?.length) {
                this.bloomNode.setSize(this.size.width, this.size.height);
            }
        }
        if (params.exposure !== undefined) this.uExposure.value = params.exposure;
        if (params.contrast !== undefined) this.uContrast.value = params.contrast;
        if (params.saturation !== undefined) this.uSaturation.value = params.saturation;
        if (params.splitStrength !== undefined) this.uSplitStrength.value = params.splitStrength;
        if (params.vignetteOffset !== undefined) this.uVignetteOffset.value = params.vignetteOffset;
        if (params.vignetteDarkness !== undefined) this.uVignetteDarkness.value = params.vignetteDarkness;
        if (params.ditherStrength !== undefined) this.uDitherStrength.value = params.ditherStrength;
        if (params.useFilmGrain !== undefined) this.useFilmGrain = params.useFilmGrain === true;
        if (params.grainStrength !== undefined) this.baseGrainStrength = params.grainStrength;
        this.uGrainStrength.value = this.useFilmGrain ? this.baseGrainStrength : 0.0;
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
        this.scenePass.setSize(width, height);
        if (this.bloomNode?._separableBlurMaterials?.length) {
            this.bloomNode.setSize(width, height);
        }
    }

    dispose() {
        this.scenePass?.dispose?.();
        disposeBloomNodeDeep(this.bloomNode);
        this.postProcessing?.dispose?.();
        this.scenePass = null;
        this.bloomNode = null;
        this.postProcessing = null;
    }
}

export function createKoiPondPost(renderer, scene, camera, params) {
    return new KoiPondPost(renderer, scene, camera, params);
}

export default KoiPondPost;
