/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Starlight — Post Pipeline
 *
 * Forked from electric-dreams-v3/post/render-pipeline.js. The post GRAPH is
 * copied verbatim from the proven edv3 pipeline (MRT selective bloom → chromatic
 * aberration → board-halo → vignette → ACES tonemap → grade → grain/dither);
 * only the PROFILES differ — Starlight runs higher bloom (so bright stars +
 * stardust glow magically) and near-zero chromatic aberration (a cleaner deep
 * sky). MRT means ONLY emissive surfaces (stars, dust, meteors) bloom — the
 * luminance-capped nebula/aurora stay calm and never wash out the board.
 *
 * WebGPU-only at the post layer (mirrors edv3). On the WebGL2 fallback the theme
 * renders without post (the orchestrator falls back to renderer.render()).
 */
import * as WEBGPU from 'three/webgpu';
import {
    abs,
    clamp,
    dot,
    emissive,
    float,
    fract,
    length,
    max,
    mix,
    mrt,
    output,
    pass,
    sin,
    smoothstep,
    uniform,
    vec2,
    vec3,
    vec4,
    viewportUV,
} from 'three/tsl';
import * as THREE from 'three';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../../shared/bloom-dispose.js';
import { withEmissiveMaterialBlending } from '../../shared/mrt-blend.js';

export const STARLIGHT_POST_PROFILES = Object.freeze({
    Minimal: Object.freeze({
        enabled: false,
        bloomStrength: 0,
        bloomRadius: 0.5,
        bloomThreshold: 0.2,
        exposure: 1.0,
        contrast: 1.02,
        saturation: 1.0,
        vignetteDarkness: 0.2,
        chromaticStrength: 0,
        grainStrength: 0,
        ditherStrength: 0.001,
    }),
    Low: Object.freeze({
        enabled: true,
        bloomStrength: 0.34,
        bloomRadius: 0.55,
        bloomThreshold: 0.2,
        exposure: 1.0,
        contrast: 1.04,
        saturation: 1.06,
        vignetteDarkness: 0.3,
        chromaticStrength: 0,
        grainStrength: 0.0012,
        ditherStrength: 0.0014,
    }),
    Medium: Object.freeze({
        enabled: true,
        bloomStrength: 0.46,
        bloomRadius: 0.58,
        bloomThreshold: 0.18,
        exposure: 0.97,
        contrast: 1.1,
        saturation: 1.1,
        vignetteDarkness: 0.44,
        chromaticStrength: 0.0008,
        grainStrength: 0.002,
        ditherStrength: 0.0017,
    }),
    High: Object.freeze({
        enabled: true,
        bloomStrength: 0.56,
        bloomRadius: 0.62,
        bloomThreshold: 0.16,
        exposure: 0.95,
        contrast: 1.14,
        saturation: 1.14,
        vignetteDarkness: 0.54,
        chromaticStrength: 0.001,
        grainStrength: 0.0026,
        ditherStrength: 0.0019,
    }),
    Ultra: Object.freeze({
        enabled: true,
        bloomStrength: 0.62,
        bloomRadius: 0.64,
        bloomThreshold: 0.15,
        exposure: 0.94,
        contrast: 1.17,
        saturation: 1.16,
        vignetteDarkness: 0.6,
        chromaticStrength: 0.0012,
        grainStrength: 0.003,
        ditherStrength: 0.0021,
    }),
    Extreme: Object.freeze({
        enabled: true,
        bloomStrength: 0.7,
        bloomRadius: 0.68,
        bloomThreshold: 0.13,
        exposure: 0.92,
        contrast: 1.2,
        saturation: 1.18,
        vignetteDarkness: 0.66,
        chromaticStrength: 0.0015,
        grainStrength: 0.0034,
        ditherStrength: 0.0024,
    }),
});

export function getStarlightPostProfile(qualityName) {
    return { ...(STARLIGHT_POST_PROFILES[qualityName] || STARLIGHT_POST_PROFILES.High) };
}

export class StarlightPostPipeline {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.lastRenderCostMs = 0;
        this.mrtEnabled = params.useMRT !== false;
        this.postProcessing = null;
        // Published for the theme's warm compile: `compileGroupThroughPost` reads
        // `postProcessingStack.scenePass.renderTarget` and `.getMRT()` and nothing else, so
        // publishing the pass IS the whole contract. Stays null on the non-WebGPU early return
        // and on a failed `_setupWebGPU`, which is exactly when the theme renders without post.
        this.scenePass = null;

        if (renderer?.backend?.isWebGPUBackend !== true) {
            console.warn('[Starlight] Post pipeline requires WebGPU; skipping (rendering without post)');
            return;
        }
        try {
            this._setupWebGPU(params);
        } catch (err) {
            console.warn('[Starlight] Post pipeline setup failed; rendering without post:', err.message);
            this.postProcessing = null;
        }
    }

    _setupWebGPU(params) {
        this.postProcessing = new WEBGPU.RenderPipeline(this.renderer);
        const scenePass = pass(this.scene, this.camera);
        this.scenePass = scenePass;

        let bloomSource;
        try {
            if (this.mrtEnabled) {
                scenePass.setMRT(withEmissiveMaterialBlending(mrt({ output, emissive })));
                bloomSource = scenePass.getTextureNode('emissive');
            } else {
                bloomSource = scenePass.getTextureNode('output');
            }
        } catch (err) {
            console.warn('[Starlight] MRT init failed; non-selective bloom:', err.message);
            this.mrtEnabled = false;
            bloomSource = scenePass.getTextureNode('output');
        }
        const sceneColor = scenePass.getTextureNode('output');

        this.bloomNode = bloom(
            bloomSource,
            params.bloomStrength ?? 0.56,
            params.bloomRadius ?? 0.62,
            params.bloomThreshold ?? 0.16,
        );

        this.uExposure = uniform(params.exposure ?? 0.95);
        this.uContrast = uniform(params.contrast ?? 1.14);
        this.uSaturation = uniform(params.saturation ?? 1.14);
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.54);
        this.uChromaticStrength = uniform(params.chromaticStrength ?? 0.001);
        this.uGrainStrength = uniform(params.grainStrength ?? 0.0026);
        this.uDitherStrength = uniform(params.ditherStrength ?? 0.0019);
        this.uTime = uniform(0);

        // Board-halo overlay (screen-space rounded-rect vignette/glow).
        this.uBoardHaloCenter = uniform(new THREE.Vector2(0.5, 0.5));
        this.uBoardHaloHalfSize = uniform(new THREE.Vector2(0.1, 0.32));
        this.uBoardHaloRadius = uniform(0.02);
        this.uBoardHaloGlow = uniform(0.08);
        this.uBoardHaloStrength = uniform(params.boardHaloStrength ?? 0);
        this.uBoardHaloColor = uniform(new THREE.Color(0x9fb8ff)); // cool starlight accent

        const uvNode = viewportUV;
        const centered = uvNode.sub(vec2(0.5, 0.5));
        const dist = length(centered);

        const edgeBoost = float(1.0).add(dist.mul(0.6));
        const chromaOffset = centered.mul(this.uChromaticStrength).mul(edgeBoost);
        const sampleR = sceneColor.sample(uvNode.add(chromaOffset));
        const sampleG = sceneColor.sample(uvNode);
        const sampleB = sceneColor.sample(uvNode.sub(chromaOffset));
        const chroma = vec4(sampleR.r, sampleG.g, sampleB.b, sampleG.a);

        const withBloom = chroma.add(this.bloomNode);

        const boardLocal = uvNode.sub(this.uBoardHaloCenter);
        const boardAbs = vec2(abs(boardLocal.x), abs(boardLocal.y));
        const rectInner = vec2(
            max(boardAbs.x.sub(this.uBoardHaloHalfSize.x).add(this.uBoardHaloRadius), float(0.0)),
            max(boardAbs.y.sub(this.uBoardHaloHalfSize.y).add(this.uBoardHaloRadius), float(0.0)),
        );
        const boardSDF = length(rectInner).sub(this.uBoardHaloRadius);
        const haloT = max(boardSDF, float(0.0)).div(this.uBoardHaloGlow);
        const haloMask = smoothstep(float(0.0), float(1.0), haloT).oneMinus();
        const halo = vec3(
            this.uBoardHaloColor.r,
            this.uBoardHaloColor.g,
            this.uBoardHaloColor.b,
        ).mul(haloMask).mul(this.uBoardHaloStrength);
        const withHalo = vec4(withBloom.rgb.add(halo), withBloom.a);

        const vignetteFactor = smoothstep(0.4, 0.9, dist).oneMinus();
        const vignetted = mix(
            withHalo.rgb.mul(float(1.0).sub(this.uVignetteDarkness)),
            withHalo.rgb,
            vignetteFactor,
        );

        const exposed = vignetted.mul(this.uExposure);
        const acesNum = exposed.mul(exposed.mul(2.51).add(0.03));
        const acesDen = exposed.mul(exposed.mul(2.43).add(0.59)).add(0.14);
        let graded = clamp(acesNum.div(acesDen), 0.0, 1.0);

        const luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        graded = mix(vec3(luma), graded, this.uSaturation);
        graded = graded.sub(0.5).mul(this.uContrast).add(0.5);

        const grainSeed = uvNode.mul(132.0).add(vec2(this.uTime.mul(0.73), this.uTime.mul(1.17)));
        const grain = fract(
            sin(dot(grainSeed, vec2(12.9898, 78.233))).mul(43758.5453),
        ).sub(0.5).mul(this.uGrainStrength);
        const ditherSeed = uvNode.mul(317.0).add(vec2(0.17, 0.31));
        const dither = fract(
            sin(dot(ditherSeed, vec2(127.1, 269.5))).mul(43758.5453),
        ).sub(0.5).mul(this.uDitherStrength);

        const finalColor = clamp(graded.add(vec3(grain)).add(vec3(dither)), 0.0, 1.0);
        this.postProcessing.outputNode = vec4(finalColor, 1.0);
        this.postProcessing.needsUpdate = true;
    }

    isEnabled() {
        return this.postProcessing !== null;
    }

    setBoardHalo({
        center, halfSize, strength, radius, glow, color,
    } = {}) {
        if (!this.uBoardHaloCenter) return;
        if (center) this.uBoardHaloCenter.value.copy(center);
        if (halfSize) this.uBoardHaloHalfSize.value.copy(halfSize);
        if (Number.isFinite(strength)) this.uBoardHaloStrength.value = strength;
        if (Number.isFinite(radius)) this.uBoardHaloRadius.value = radius;
        if (Number.isFinite(glow)) this.uBoardHaloGlow.value = glow;
        if (color) this.uBoardHaloColor.value.copy(color);
    }

    setProfile(profile) {
        if (!this.postProcessing) return;
        if (this.bloomNode?.strength) this.bloomNode.strength.value = profile.bloomStrength;
        if (this.bloomNode?.radius) this.bloomNode.radius.value = profile.bloomRadius;
        if (this.bloomNode?.threshold) this.bloomNode.threshold.value = profile.bloomThreshold;
        this.uExposure.value = profile.exposure;
        this.uContrast.value = profile.contrast;
        this.uSaturation.value = profile.saturation;
        this.uVignetteDarkness.value = profile.vignetteDarkness;
        this.uChromaticStrength.value = profile.chromaticStrength;
        this.uGrainStrength.value = profile.grainStrength;
        this.uDitherStrength.value = profile.ditherStrength;
    }

    updateDynamic(params) {
        if (!this.postProcessing) return;
        if (params.time !== undefined) this.uTime.value = params.time;
        // ?? not || — a legitimate Low/Minimal base of 0 (bloom/chroma) must NOT be
        // clobbered back to the default, which silently reintroduced the effect at Low.
        if (params.bloomBoost !== undefined && this.bloomNode?.strength) {
            this.bloomNode.strength.value = (params.baseBloom ?? 0.56) + params.bloomBoost;
        }
        if (params.chromaticBoost !== undefined) {
            this.uChromaticStrength.value = (params.baseChromatic ?? 0.001) + params.chromaticBoost;
        }
        if (params.vignetteBoost !== undefined) {
            this.uVignetteDarkness.value = (params.baseVignette ?? 0.54) + params.vignetteBoost;
        }
        if (params.exposureDip !== undefined) {
            this.uExposure.value = (params.baseExposure ?? 0.95) - params.exposureDip;
        }
    }

    render() {
        const start = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        this.postProcessing.render();
        this.lastRenderCostMs = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - start;
    }

    dispose() {
        disposeBloomNodeDeep(this.bloomNode);
        this.postProcessing = null;
        this.bloomNode = null;
        this.scenePass = null;
    }
}
