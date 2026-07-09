/**
 * Black Hole Theme - WebGPU Post Processing
 * Emissive-only bloom + chromatic aberration + vignette (WebGPU path)
 */

import * as THREE from 'three/webgpu';
import {
    emissive,
    mrt,
    output,
    pass,
    viewportUV,
    uniform,
    clamp,
    Fn,
    float,
    length,
    mix,
    smoothstep,
    vec2,
    vec3,
    vec4,
    dot,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export class BlackHolePost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.useMRT = params.useMRT ?? true;
        this.bloomDownsample = params.bloomDownsample ?? 0.8;
        this.enableChromatic = params.enableChromatic ?? true;
        this.postProcessing = new THREE.PostProcessing(renderer);

        this.scenePass = pass(scene, camera);
        if (this.useMRT) {
            this.scenePass.setMRT(mrt({ output, emissive }));
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;

        const bloomStrength = params.bloomStrength ?? 0.5;
        const bloomRadius = params.bloomRadius ?? 0.6;
        const bloomThreshold = params.bloomThreshold ?? 0.15;
        this.bloomNode = bloom(bloomSource, bloomStrength, bloomRadius, bloomThreshold);

        const originalBloomSetSize = this.bloomNode.setSize.bind(this.bloomNode);
        this.bloomNode.setSize = (width, height) => {
            originalBloomSetSize(
                Math.max(1, Math.floor(width * this.bloomDownsample)),
                Math.max(1, Math.floor(height * this.bloomDownsample)),
            );
        };

        this.uChromaticStrength = uniform(params.chromaticStrength ?? 0.0006);
        this.uVignetteOffset = uniform(params.vignetteOffset ?? 1.2);
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.5);
        this.uExposure = uniform(params.exposure ?? 1.05);
        this.uContrast = uniform(params.contrast ?? 1.04);
        this.uSaturation = uniform(params.saturation ?? 1.08);
        this.uTintStrength = uniform(params.tintStrength ?? 0.22);
        this.uDitherStrength = uniform(params.ditherStrength ?? 0.0);
        this.uTint = uniform(new THREE.Color(1.04, 0.98, 1.08));

        const uv = viewportUV;

        // Vignette-at-UV sampling the scene texture directly. Mirrors the old
        // mix(baseSample*(1-darkness), baseSample, vignette). Wrapped in Fn so each chromatic
        // tap re-evaluates the vignette at its own UV — exactly what the old
        // chromaticAberration(vignetteColor, ...) did: it wraps its input in convertToTexture(),
        // forcing a full-screen render-to-texture pass EVERY frame purely so the R/G/B split
        // could re-sample the vignetted image. Inlining collapses that extra pass into the taps.
        // Pixel-identical (it even skips the intermediate RTT's requantization + bilinear resample).
        const sampleVignettedScene = Fn(([p]) => {
            const vigDist = length(p.sub(0.5).mul(2.0));
            const vig = smoothstep(this.uVignetteOffset, this.uVignetteOffset.sub(0.6), vigDist);
            const sampled = sceneColor.sample(p);
            return mix(
                sampled.mul(float(1.0).sub(this.uVignetteDarkness)),
                sampled,
                vig,
            );
        });

        let chroma;
        if (this.enableChromatic) {
            // Mirrors ChromaticAberrationNode(strength, center=(0.5,0.5), scale=1.1) term-for-term.
            const caCenter = vec2(0.5, 0.5);
            const caScale = float(1.1);
            const caStrength = this.uChromaticStrength;
            const caOffset = uv.sub(caCenter);
            const caDist = length(caOffset);
            const redScale = float(1.0).add(caScale.mul(0.02).mul(caStrength));
            const blueScale = float(1.0).sub(caScale.mul(0.02).mul(caStrength));
            const aberration = caStrength.mul(caDist);
            const redUV = caCenter.add(caOffset.mul(redScale)).add(caOffset.mul(aberration).mul(0.01));
            const blueUV = caCenter.add(caOffset.mul(blueScale)).add(caOffset.mul(aberration).mul(-0.01));
            const centerSample = sampleVignettedScene(uv); // green + alpha (greenUV == uv, gOffset = 0)
            const redSample = sampleVignettedScene(redUV);
            const blueSample = sampleVignettedScene(blueUV);
            chroma = vec4(redSample.r, centerSample.g, blueSample.b, centerSample.a);
        } else {
            chroma = sampleVignettedScene(uv);
        }
        const combined = chroma.add(this.bloomNode);

        const exposed = combined.mul(this.uExposure);
        const acesA = float(2.51);
        const acesB = float(0.03);
        const acesC = float(2.43);
        const acesD = float(0.59);
        const acesE = float(0.14);
        const acesNum = exposed.mul(exposed.mul(acesA).add(acesB));
        const acesDen = exposed.mul(exposed.mul(acesC).add(acesD)).add(acesE);
        let graded = clamp(acesNum.div(acesDen), float(0.0), float(1.0));

        const luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        graded = mix(vec3(luma), graded, this.uSaturation);
        graded = graded.sub(0.5).mul(this.uContrast).add(0.5);
        graded = mix(graded, graded.mul(this.uTint), this.uTintStrength);

        this.postProcessing.outputNode = graded;
        this.postProcessing.needsUpdate = true;
        this.size = { width: 0, height: 0 };
    }

    update(params = {}) {
        if (params.bloomStrength !== undefined) {
            this.bloomNode.strength.value = params.bloomStrength;
        }
        if (params.bloomRadius !== undefined) {
            this.bloomNode.radius.value = params.bloomRadius;
        }
        if (params.bloomThreshold !== undefined) {
            this.bloomNode.threshold.value = params.bloomThreshold;
        }
        if (this.enableChromatic && params.chromaticStrength !== undefined) {
            this.uChromaticStrength.value = params.chromaticStrength;
        }
        if (params.vignetteOffset !== undefined) {
            this.uVignetteOffset.value = params.vignetteOffset;
        }
        if (params.vignetteDarkness !== undefined) {
            this.uVignetteDarkness.value = params.vignetteDarkness;
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
        if (params.ditherStrength !== undefined) {
            this.uDitherStrength.value = params.ditherStrength;
        }
        if (params.bloomDownsample !== undefined) {
            this.bloomDownsample = params.bloomDownsample;
            if (this.size.width > 0 && this.size.height > 0 && this.bloomNode?._separableBlurMaterials?.length) {
                this.bloomNode.setSize(this.size.width, this.size.height);
            }
        }
    }

    render() {
        this.postProcessing.render();
    }

    setSize(width, height) {
        this.size.width = width;
        this.size.height = height;
        this.scenePass.setSize(width, height);
        if (this.bloomNode?._separableBlurMaterials?.length) {
            this.bloomNode.setSize(width, height);
        }
    }

    dispose() {
        this.scenePass.dispose();
        this.bloomNode.dispose();
        this.postProcessing.dispose();
    }
}
