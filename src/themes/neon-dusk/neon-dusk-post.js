/**
 * Neon Dusk Theme - WebGPU Post Processing
 * Emissive-only bloom + vignette (WebGPU-only)
 */

import * as THREE from 'three/webgpu';
import {
    emissive,
    mrt,
    output,
    pass,
    viewportUV,
    uniform,
    float,
    mix,
    length,
    smoothstep,
    vec2,
    vec3,
    vec4,
    dot,
    fract,
    sin,
    saturation,
    clamp,
    perspectiveDepthToViewZ,
    viewZToOrthographicDepth,
    max,
    abs,
    pow,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { withEmissiveMaterialBlending } from '../shared/mrt-blend.js';

export class NeonDuskPost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.useMRT = params.useMRT ?? true;
        this.postProcessing = new THREE.RenderPipeline(renderer);

        this.scenePass = pass(scene, camera);
        if (this.useMRT) {
            this.scenePass.setMRT(withEmissiveMaterialBlending(mrt({ output, emissive })));
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const emissivePass = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;

        const bloomStrength = params.bloomStrength ?? 1.1;
        const bloomRadius = params.bloomRadius ?? 0.5;
        const bloomThreshold = params.bloomThreshold ?? 0.2;

        this.bloomNode = bloom(emissivePass, bloomStrength, bloomRadius, bloomThreshold);
        this.bloomDownsample = params.bloomDownsample ?? 0.8;
        const originalBloomSetSize = this.bloomNode.setSize.bind(this.bloomNode);
        this.bloomNode.setSize = (width, height) => {
            originalBloomSetSize(width * this.bloomDownsample, height * this.bloomDownsample);
        };

        this.size = { width: 0, height: 0 };
        this.uTime = uniform(0);
        this.uGrainIntensity = uniform(params.grainIntensity ?? 0.02);
        this.uGrainScale = uniform(params.grainScale ?? 120.0);
        this.uSaturation = uniform(params.saturation ?? 1.08);
        this.uSunScreen = uniform(new THREE.Vector2(0.5, 0.5));
        this.uRayIntensity = uniform(params.rayIntensity ?? 0.35);

        // Cinematic layer — chromatic aberration, DOF, CRT, anamorphic flare
        this.uAberration = uniform(params.aberration ?? 0.0);
        this.uScanlineIntensity = uniform(params.scanlineIntensity ?? 0.0);
        this.uScanlineCount = uniform(params.scanlineCount ?? 700.0);
        this.uBarrel = uniform(params.barrel ?? 0.0);
        this.uFlareIntensity = uniform(0.0);
        this.flareBase = params.flareIntensity ?? 0.0;
        this.uDofStrength = uniform(params.dofStrength ?? 0.0);
        this.uDofFocus = uniform(params.dofFocus ?? 0.55);
        this.uDofRange = uniform(params.dofRange ?? 2.2);
        this.uDofMaxRadius = uniform(params.dofMaxRadius ?? 0.004);

        const cameraNear = uniform(camera.near);
        const cameraFar = uniform(camera.far);

        const depthTexture = this.scenePass.getTextureNode('depth');

        const baseUv = viewportUV;
        const centered = baseUv.sub(0.5).mul(2.0);
        const dist = length(centered);

        // Barrel distortion (CRT curve) applied to scene sampling
        const uv = baseUv.add(centered.mul(dist.mul(dist)).mul(this.uBarrel).mul(0.5));

        // Radial chromatic aberration (sharp), stronger toward the edges
        const caAmt = this.uAberration.mul(dist);
        const caR = sceneColor.sample(uv.add(centered.mul(caAmt))).x;
        const caG = sceneColor.sample(uv).y;
        const caB = sceneColor.sample(uv.sub(centered.mul(caAmt))).z;
        const caColor = vec4(caR, caG, caB, float(1.0));

        // Depth of field — one-sided (far only) so the hero grid stays crisp and
        // only the distant dust/sky softens. Gated off below High to save taps.
        let baseSample = caColor;
        if ((params.dofStrength ?? 0) > 0) {
            const dofDepth = depthTexture.sample(uv).x;
            const dofViewZ = perspectiveDepthToViewZ(dofDepth, cameraNear, cameraFar);
            const dofLinear = viewZToOrthographicDepth(dofViewZ, cameraNear, cameraFar);
            const coc = clamp(
                max(float(0.0), dofLinear.sub(this.uDofFocus)).mul(this.uDofRange),
                float(0.0),
                float(1.0),
            ).mul(this.uDofStrength);
            const o = coc.mul(this.uDofMaxRadius);
            const c0 = sceneColor.sample(uv);
            const c1 = sceneColor.sample(uv.add(vec2(o, o)));
            const c2 = sceneColor.sample(uv.add(vec2(o.negate(), o)));
            const c3 = sceneColor.sample(uv.add(vec2(o, o.negate())));
            const c4 = sceneColor.sample(uv.add(vec2(o.negate(), o.negate())));
            const dofColor = c0.add(c1).add(c2).add(c3).add(c4)
                .mul(float(0.2));
            baseSample = mix(caColor, dofColor, coc);
        }

        const vignetteOffset = float(params.vignetteOffset ?? 1.0);
        const vignetteDarkness = float(params.vignetteDarkness ?? 0.35);
        const vignette = smoothstep(vignetteOffset, vignetteOffset.sub(0.5), dist);

        const vignetteColor = mix(
            baseSample.mul(float(1.0).sub(vignetteDarkness)),
            baseSample,
            vignette,
        );

        const composite = vignetteColor.add(this.bloomNode);

        let rays = vec3(0.0);
        if (params.enableRays ?? true) {
            const sunUV = clamp(this.uSunScreen, vec2(0.0), vec2(1.0));
            const rayDir = sunUV.sub(uv);
            const stepVec = rayDir.mul(float(1.0 / 6.0));

            const sampleRay = (offset) => {
                const coord = uv.add(stepVec.mul(offset));
                const sample = emissivePass.sample(coord).xyz;
                const depthSample = depthTexture.sample(coord).x;
                const viewZ = perspectiveDepthToViewZ(depthSample, cameraNear, cameraFar);
                const linearDepth = viewZToOrthographicDepth(viewZ, cameraNear, cameraFar);
                const occlusion = smoothstep(float(0.2), float(1.0), linearDepth);
                return sample.mul(occlusion);
            };

            const raySample1 = sampleRay(float(1.0)).mul(0.18);
            const raySample2 = sampleRay(float(2.0)).mul(0.15);
            const raySample3 = sampleRay(float(3.0)).mul(0.12);
            const raySample4 = sampleRay(float(4.0)).mul(0.1);
            const raySample5 = sampleRay(float(5.0)).mul(0.08);
            const raySample6 = sampleRay(float(6.0)).mul(0.06);

            const sunDepth = depthTexture.sample(sunUV).x;
            const sunViewZ = perspectiveDepthToViewZ(sunDepth, cameraNear, cameraFar);
            const sunLinear = viewZToOrthographicDepth(sunViewZ, cameraNear, cameraFar);
            const sunVisible = smoothstep(float(0.2), float(0.8), sunLinear);

            rays = raySample1
                .add(raySample2)
                .add(raySample3)
                .add(raySample4)
                .add(raySample5)
                .add(raySample6)
                .mul(this.uRayIntensity)
                .mul(sunVisible)
                .mul(max(float(0.0), float(1.0).sub(length(rayDir))));
        }

        const noiseUV = uv.mul(this.uGrainScale).add(this.uTime.mul(0.1));
        const noiseSeed = dot(noiseUV, vec2(12.9898, 78.233));
        const noise = fract(sin(noiseSeed).mul(43758.5453));
        const grain = noise.sub(0.5).mul(this.uGrainIntensity);

        const graded = saturation(composite.add(vec4(rays, 0.0)).xyz, this.uSaturation).add(vec3(grain));

        // Subtle scanlines (CRT)
        const scan = pow(sin(baseUv.y.mul(this.uScanlineCount)).mul(0.5).add(0.5), float(8.0));
        const scanned = graded.mul(float(1.0).sub(scan.mul(this.uScanlineIntensity)));

        // Anamorphic sun flare — horizontal streak anchored to the sun
        const dx = abs(baseUv.x.sub(this.uSunScreen.x));
        const dy = abs(baseUv.y.sub(this.uSunScreen.y));
        const fx = float(1.0).sub(smoothstep(float(0.0), float(0.6), dx));
        const fy = float(1.0).sub(smoothstep(float(0.0), float(0.014), dy));
        const streak = fx.mul(fx).mul(fy);
        const flared = scanned.add(vec3(1.0, 0.7, 0.5).mul(streak).mul(this.uFlareIntensity));

        const finalColor = vec4(flared, composite.w);

        this.postProcessing.outputNode = finalColor;
        this.postProcessing.needsUpdate = true;
    }

    updateTime(time) {
        if (this.uTime) {
            this.uTime.value = time;
        }
    }

    updateSun(screenPosition, intensity, flare) {
        if (screenPosition) {
            this.uSunScreen.value.copy(screenPosition);
        }
        if (intensity !== undefined) {
            this.uRayIntensity.value = intensity;
        }
        if (flare !== undefined) {
            this.uFlareIntensity.value = flare;
        }
    }

    updateParams(params = {}) {
        if (params.bloomStrength !== undefined) {
            this.bloomNode.strength.value = params.bloomStrength;
        }
        if (params.bloomRadius !== undefined) {
            this.bloomNode.radius.value = params.bloomRadius;
        }
        if (params.bloomThreshold !== undefined) {
            this.bloomNode.threshold.value = params.bloomThreshold;
        }
        if (params.bloomDownsample !== undefined) {
            this.bloomDownsample = params.bloomDownsample;
            if (this.size.width && this.size.height && this.bloomNode?._separableBlurMaterials?.length) {
                this.bloomNode.setSize(this.size.width, this.size.height);
            }
        }
        if (params.grainIntensity !== undefined) {
            this.uGrainIntensity.value = params.grainIntensity;
        }
        if (params.grainScale !== undefined) {
            this.uGrainScale.value = params.grainScale;
        }
        if (params.saturation !== undefined) {
            this.uSaturation.value = params.saturation;
        }
        if (params.rayIntensity !== undefined) {
            this.uRayIntensity.value = params.rayIntensity;
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
        disposeBloomNodeDeep(this.bloomNode);
        this.postProcessing.dispose();
    }
}
