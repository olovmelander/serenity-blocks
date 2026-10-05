/**
 * Chiral Gold - WebGPU post processing
 */

import * as THREE from 'three/webgpu';
import {
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
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { withEmissiveMaterialBlending } from '../shared/mrt-blend.js';

export class ChiralGoldPost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.useMRT = params.useMRT ?? true;
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
            params.bloomStrength ?? 0.55,
            params.bloomRadius ?? 0.4,
            params.bloomThreshold ?? 0.0,
        );

        this.uBloomBoost = uniform(params.bloomBoost ?? 0);
        this.uChromaticStrength = uniform(params.chromaticStrength ?? 0.001);
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.42);
        this.uVignetteOffset = uniform(params.vignetteOffset ?? 1.16);
        this.uExposure = uniform(params.exposure ?? 0.94);
        this.uContrast = uniform(params.contrast ?? 1.03);
        this.uSaturation = uniform(params.saturation ?? 1.06);
        this.uBlackFloor = uniform(params.blackFloor ?? 0.006);
        this.uFilmGrain = uniform(params.filmGrain ?? 0.0025);
        this.uDitherStrength = uniform(params.ditherStrength ?? 0.0015);
        this.uWarmTint = uniform(params.warmTint ?? new THREE.Color(1.0, 0.92, 0.76));
        this.uResolution = uniform(new THREE.Vector2(1, 1));
        this.uTime = uniform(0);

        const uv = viewportUV;

        const vigDist = length(uv.sub(0.5).mul(2.0));
        const vignetteFalloff = smoothstep(this.uVignetteOffset.sub(0.65), this.uVignetteOffset, vigDist);
        const vignette = float(1.0).sub(vignetteFalloff.mul(this.uVignetteDarkness));

        // Sample the existing scene texture directly. Applying the addon to an
        // already-vignetted expression allocated an unnecessary intermediate
        // render target and full-screen pass, especially costly on phones.
        let chroma = sceneColor.sample(uv);
        if (params.chromaticStrength !== 0) {
            const radialOffset = uv.sub(0.5);
            const chromaticOffset = radialOffset.mul(length(radialOffset))
                .mul(this.uChromaticStrength).mul(0.12);
            chroma = vec4(
                sceneColor.sample(uv.add(chromaticOffset)).r,
                chroma.g,
                sceneColor.sample(uv.sub(chromaticOffset)).b,
                1.0,
            );
        }

        const bloomTint = this.uWarmTint.mul(float(0.82).add(this.uBloomBoost.mul(0.18)));
        // Vignette the complete composition, including bloom, so corner halos
        // do not float above the grade or reveal the edge of the canvas.
        const combined = chroma.add(this.bloomNode.mul(vec4(bloomTint, 1.0)))
            .mul(vignette);

        const exposed = combined.rgb.mul(this.uExposure);

        const acesA = float(2.51);
        const acesB = float(0.03);
        const acesC = float(2.43);
        const acesD = float(0.59);
        const acesE = float(0.14);

        const acesNum = exposed.mul(exposed.mul(acesA).add(acesB));
        const acesDen = exposed.mul(exposed.mul(acesC).add(acesD)).add(acesE);
        const filmic = clamp(acesNum.div(acesDen), 0.0, 1.0);

        // A small luminance-preserving shoulder keeps bright amber/copper
        // highlights from collapsing into a broad white patch during combos.
        const inputLuma = max(dot(exposed, vec3(0.2126, 0.7152, 0.0722)), 0.0001);
        const lumaNum = inputLuma.mul(inputLuma.mul(acesA).add(acesB));
        const lumaDen = inputLuma.mul(inputLuma.mul(acesC).add(acesD)).add(acesE);
        const colorPreserving = exposed.mul(lumaNum.div(lumaDen).div(inputLuma));
        let graded = mix(filmic, colorPreserving, 0.14);

        const luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        graded = mix(vec3(luma), graded, this.uSaturation);
        graded = graded.sub(0.5).mul(this.uContrast).add(0.5);

        const blackScale = max(float(0.0001), float(1.0).sub(this.uBlackFloor));
        graded = clamp(graded.sub(this.uBlackFloor).div(blackScale), 0.0, 1.0);

        const pixel = uv.mul(this.uResolution);
        const grain = fract(sin(dot(pixel.add(this.uTime.mul(7.6)), vec2(12.9898, 78.233))).mul(43758.5453));
        const grainExposure = float(1.0).sub(clamp(luma, 0.0, 1.0).mul(0.7));
        graded = clamp(graded.add(grain.sub(0.5).mul(this.uFilmGrain).mul(grainExposure)), 0.0, 1.0);

        const dither = fract(fract(dot(pixel, vec2(0.06711056, 0.00583715))).mul(52.9829189));
        graded = clamp(graded.add(dither.sub(0.5).mul(this.uDitherStrength)), 0.0, 1.0);

        this.postProcessing.outputNode = vec4(graded, 1.0);
        this.postProcessing.needsUpdate = true;
    }

    update(params = {}) {
        if (params.time !== undefined) {
            this.uTime.value = params.time;
        }
        if (params.bloomStrength !== undefined && this.bloomNode?.strength) {
            this.bloomNode.strength.value = params.bloomStrength;
        }
        if (params.bloomRadius !== undefined && this.bloomNode?.radius) {
            this.bloomNode.radius.value = params.bloomRadius;
        }
        if (params.bloomThreshold !== undefined && this.bloomNode?.threshold) {
            this.bloomNode.threshold.value = params.bloomThreshold;
        }
        if (params.bloomBoost !== undefined) {
            this.uBloomBoost.value = params.bloomBoost;
        }
        if (params.chromaticStrength !== undefined) {
            this.uChromaticStrength.value = params.chromaticStrength;
        }
        if (params.vignetteDarkness !== undefined) {
            this.uVignetteDarkness.value = params.vignetteDarkness;
        }
        if (params.vignetteOffset !== undefined) {
            this.uVignetteOffset.value = params.vignetteOffset;
        }
        if (params.filmGrain !== undefined) {
            this.uFilmGrain.value = params.filmGrain;
        }
        for (const [parameter, node] of [
            ['exposure', this.uExposure],
            ['contrast', this.uContrast],
            ['saturation', this.uSaturation],
            ['blackFloor', this.uBlackFloor],
            ['ditherStrength', this.uDitherStrength],
        ]) {
            if (params[parameter] !== undefined) node.value = params[parameter];
        }
    }

    render() {
        this.postProcessing.render();
    }

    setSize(width, height) {
        this.size.width = width;
        this.size.height = height;
        this.uResolution.value.set(width, height);
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
