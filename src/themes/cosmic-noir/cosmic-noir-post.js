/**
 * Cosmic Noir - WebGPU Post Processing
 * Emissive-aware bloom + chromatic aberration + vignette + noir grading.
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
    float,
    length,
    mix,
    smoothstep,
    vec2,
    vec3,
    vec4,
    dot,
    fract,
    max,
    sin,
    Fn,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';

export class CosmicNoirPost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.useMRT = params.useMRT ?? true;
        this.bloomDownsample = params.bloomDownsample ?? 0.8;
        this.resolutionScale = params.resolutionScale ?? 1.0;
        this.chromaticEnabled = params.chromaticEnabled ?? true;
        this.size = { width: 0, height: 0 };
        this.postProcessing = new THREE.PostProcessing(renderer);

        this.scenePass = pass(scene, camera);
        // PassNode.updateBefore() synchronizes its logical size from the renderer every frame.
        // setResolutionScale() is the r181-supported way to retain an internal scene scale.
        this.scenePass.setResolutionScale(this.resolutionScale);
        if (this.useMRT) {
            this.scenePass.setMRT(mrt({ output, emissive }));
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;

        const bloomStrength = params.bloomStrength ?? 0.4;
        const bloomRadius = params.bloomRadius ?? 0.35;
        const bloomThreshold = params.bloomThreshold ?? 0.0;
        this.bloomNode = bloom(bloomSource, bloomStrength, bloomRadius, bloomThreshold);

        const originalBloomSetSize = this.bloomNode.setSize.bind(this.bloomNode);
        this.bloomNode.setSize = (width, height) => {
            originalBloomSetSize(width * this.bloomDownsample, height * this.bloomDownsample);
        };

        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.8);
        this.uVignetteOffset = uniform(params.vignetteOffset ?? 1.2);
        this.baseChromaticStrength = params.chromaticStrength ?? 0.004;
        this.uChromaticStrength = uniform(
            this.chromaticEnabled ? this.baseChromaticStrength : 0.0,
        );
        this.uExposure = uniform(params.exposure ?? 1.05);
        this.uContrast = uniform(params.contrast ?? 1.03);
        this.uSaturation = uniform(params.saturation ?? 0.95);
        this.uBlackFloor = uniform(params.blackFloor ?? 0.06);
        this.uDitherStrength = uniform(params.ditherStrength ?? 0.004);
        this.uLensingStrength = uniform(params.lensingStrength ?? 1.0);

        this.uBhScreenPos = uniform(params.bhScreenPos ?? new THREE.Vector2(0.5, 0.5));
        this.uScreenAspect = uniform(1.0);

        const uv = viewportUV;
        const lensingRadius = float(0.35); // Radius of maximal bending

        // Gravitational lensing + vignette evaluated at an arbitrary screen UV, sampling the scene
        // texture directly. Previously the lensed+vignetted result was fed into chromaticAberration(),
        // which wraps its input in convertToTexture() — forcing a full-screen render-to-texture pass
        // every frame purely so the R/G/B split could sample it. Inlining lets the split sample the
        // scene texture directly, collapsing two post passes into one. Pixel-identical to the old
        // graph (it even skips the intermediate RTT's requantization).
        const sampleVignettedScene = Fn(([p]) => {
            const dir = p.sub(this.uBhScreenPos);
            const dirAspect = vec2(dir.x.mul(this.uScreenAspect), dir.y);
            const distToBh = length(dirAspect);
            const lensPower = float(0.045).mul(this.uLensingStrength);
            const lensingAmount = lensPower
                .mul(smoothstep(float(0.0), lensingRadius, distToBh))
                .div(max(distToBh, 0.01));
            const lensedUV = clamp(p.sub(dir.mul(lensingAmount)), vec2(0.0), vec2(1.0));

            const vigDist = length(p.sub(0.5).mul(2.0));
            const vig = smoothstep(this.uVignetteOffset, this.uVignetteOffset.sub(0.7), vigDist);
            const sampled = sceneColor.sample(lensedUV);
            return mix(
                sampled.mul(float(1.0).sub(this.uVignetteDarkness)),
                sampled,
                vig,
            );
        });

        // Manual chromatic aberration mirroring ChromaticAberrationNode's stepped-scale + radial
        // offset (center 0.5,0.5; scale 1.1), but sampling the scene directly — no RTT.
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

        const centerSample = sampleVignettedScene(uv); // green + alpha (greenUV == uv)
        const redSample = sampleVignettedScene(redUV);
        const blueSample = sampleVignettedScene(blueUV);
        const chroma = vec4(redSample.r, centerSample.g, blueSample.b, centerSample.a);
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
        const blackScale = max(float(0.0001), float(1.0).sub(this.uBlackFloor));
        graded = clamp(graded.sub(this.uBlackFloor).div(blackScale), 0.0, 1.0);

        const dither = fract(sin(dot(uv, vec2(12.9898, 78.233))).mul(43758.5453));
        const dithered = clamp(graded.add(dither.sub(0.5).mul(this.uDitherStrength)), 0.0, 1.0);

        // chroma is vec4, so dithered might be vec4. outputNode expects vec4, so we ensure
        // we pass vec3 + alpha.
        this.postProcessing.outputNode = vec4(dithered.rgb, 1.0);
        this.postProcessing.needsUpdate = true;
    }

    update(params = {}) {
        if (params.bloomStrength !== undefined && this.bloomNode?.strength) {
            if (Math.abs(this.bloomNode.strength.value - params.bloomStrength) > 0.001) {
                this.bloomNode.strength.value = params.bloomStrength;
            }
        }
        if (params.bloomRadius !== undefined && this.bloomNode?.radius) {
            if (Math.abs(this.bloomNode.radius.value - params.bloomRadius) > 0.001) {
                this.bloomNode.radius.value = params.bloomRadius;
            }
        }
        if (params.bloomThreshold !== undefined && this.bloomNode?.threshold) {
            if (Math.abs(this.bloomNode.threshold.value - params.bloomThreshold) > 0.001) {
                this.bloomNode.threshold.value = params.bloomThreshold;
            }
        }
        if (params.chromaticStrength !== undefined) {
            if (Math.abs(this.baseChromaticStrength - params.chromaticStrength) > 0.0001) {
                this.baseChromaticStrength = params.chromaticStrength;
                this.uChromaticStrength.value = this.chromaticEnabled ? this.baseChromaticStrength : 0.0;
            }
        }
        if (params.chromaticEnabled !== undefined) {
            const nextEnabled = Boolean(params.chromaticEnabled);
            if (this.chromaticEnabled !== nextEnabled) {
                this.chromaticEnabled = nextEnabled;
                this.uChromaticStrength.value = this.chromaticEnabled ? this.baseChromaticStrength : 0.0;
            }
        }
        if (params.vignetteOffset !== undefined) {
            if (Math.abs(this.uVignetteOffset.value - params.vignetteOffset) > 0.001) {
                this.uVignetteOffset.value = params.vignetteOffset;
            }
        }
        if (params.vignetteDarkness !== undefined) {
            if (Math.abs(this.uVignetteDarkness.value - params.vignetteDarkness) > 0.001) {
                this.uVignetteDarkness.value = params.vignetteDarkness;
            }
        }
        if (params.exposure !== undefined) {
            if (Math.abs(this.uExposure.value - params.exposure) > 0.001) {
                this.uExposure.value = params.exposure;
            }
        }
        if (params.contrast !== undefined) {
            if (Math.abs(this.uContrast.value - params.contrast) > 0.001) {
                this.uContrast.value = params.contrast;
            }
        }
        if (params.saturation !== undefined) {
            if (Math.abs(this.uSaturation.value - params.saturation) > 0.001) {
                this.uSaturation.value = params.saturation;
            }
        }
        if (params.blackFloor !== undefined) {
            if (Math.abs(this.uBlackFloor.value - params.blackFloor) > 0.001) {
                this.uBlackFloor.value = params.blackFloor;
            }
        }
        if (params.ditherStrength !== undefined) {
            if (Math.abs(this.uDitherStrength.value - params.ditherStrength) > 0.0001) {
                this.uDitherStrength.value = params.ditherStrength;
            }
        }
        if (params.bhScreenPos !== undefined) {
            if (this.uBhScreenPos.value.distanceToSquared(params.bhScreenPos) > 0.000001) {
                this.uBhScreenPos.value.copy(params.bhScreenPos);
            }
        }
        if (params.lensingStrength !== undefined) {
            if (Math.abs(this.uLensingStrength.value - params.lensingStrength) > 0.001) {
                this.uLensingStrength.value = params.lensingStrength;
            }
        }
        if (params.bloomDownsample !== undefined) {
            if (Math.abs(this.bloomDownsample - params.bloomDownsample) > 0.005) {
                this.bloomDownsample = params.bloomDownsample;
            }
        }
        if (params.resolutionScale !== undefined) {
            if (Math.abs(this.resolutionScale - params.resolutionScale) > 0.005) {
                this.resolutionScale = params.resolutionScale;
                this.scenePass.setResolutionScale(this.resolutionScale);
            }
        }
    }

    render() {
        this.postProcessing.render();
    }

    setSize(width, height) {
        this.size.width = width;
        this.size.height = height;
        if (this.uScreenAspect) {
            this.uScreenAspect.value = width / height;
        }
        // PassNode and BloomNode both derive their physical targets from the renderer during
        // updateBefore(). Avoid manual logical-size allocations here, especially at DPR > 1.
    }

    dispose() {
        this.scenePass?.dispose?.();
        disposeBloomNodeDeep(this.bloomNode);
        this.postProcessing?.dispose?.();
    }
}
