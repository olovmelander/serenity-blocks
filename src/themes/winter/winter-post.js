/**
 * Winter Wonderland Theme - WebGPU Post Processing
 * Emissive-only bloom + cold vignette grading (WebGPU path)
 */

import * as THREE from 'three/webgpu';
import {
    emissive,
    mrt,
    output,
    pass,
    viewportUV,
    uniform,
    Loop,
    int,
    float,
    length,
    mix,
    smoothstep,
    vec3,
    vec4,
    vec2,
    clamp,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export class WinterPost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.useMRT = params.useMRT ?? true;
        this.bloomScale = params.bloomScale ?? 0.6;
        this.postProcessing = new THREE.PostProcessing(renderer);
        this.scenePass = pass(scene, camera);
        if (this.useMRT) {
            this.scenePass.setMRT(mrt({ output, emissive }));
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;
        this.bloomNode = bloom(
            bloomSource,
            params.bloomStrength ?? 0.25,
            params.bloomRadius ?? 0.5,
            params.bloomThreshold ?? 0.85,
        );

        this.uTime = uniform(0);
        this.uShaftStrength = uniform(params.shaftStrength ?? 0.0);
        this.uLightPos = uniform(params.lightPos ?? new THREE.Vector2(0.5, 0.5));

        // Cold vignette + subtle blue grade
        const uv = viewportUV;
        const centered = uv.sub(0.5).mul(2.0);
        const dist = length(centered);
        const vignetteOffset = float(params.vignetteOffset ?? 1.0);
        const vignetteDarkness = float(params.vignetteDarkness ?? 0.6);
        const vignette = smoothstep(vignetteOffset, vignetteOffset.sub(0.5), dist);
        const baseSample = sceneColor.sample(uv);
        const coldTint = vec3(0.05, 0.08, 0.15);
        const gradeStrength = float(params.gradeStrength ?? 0.2);
        const graded = vec4(mix(baseSample.rgb, baseSample.rgb.mul(coldTint), gradeStrength), baseSample.a);
        const vignetteColor = mix(
            graded.mul(float(1.0).sub(vignetteDarkness)),
            graded,
            vignette,
        );

        // Volumetric light shafts (moon god rays)
        const shaftDir = this.uLightPos.sub(uv);
        const shaftSamples = int(params.shaftSamples ?? 4);
        const shaftStep = float(0.08);
        const shafts = (() => {
            const sum = vec3(0.0).toVar();
            Loop({ start: int(0), end: shaftSamples, type: 'int', condition: '<' }, ({ i }) => {
                const t = float(i).add(1.0);
                const sampleUv = clamp(uv.add(shaftDir.mul(shaftStep).mul(t)), vec2(0.0), vec2(1.0));
                const sample = bloomSource.sample(sampleUv).rgb;
                const weight = float(1.0).sub(t.div(float(shaftSamples)));
                sum.addAssign(sample.mul(weight));
            });
            return sum;
        })();
        const shaftColor = shafts.mul(this.uShaftStrength);

        const finalColor = vec4(vignetteColor.rgb.add(shaftColor), vignetteColor.a);
        this.postProcessing.outputNode = finalColor.add(this.bloomNode);
        this.postProcessing.needsUpdate = true;
        this.size = { width: 0, height: 0 };
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
        if (params.bloomScale !== undefined) {
            this.bloomScale = params.bloomScale;
            if (this.size.width > 0 && this.bloomNode?._separableBlurMaterials?.length) {
                const w = Math.max(1, Math.floor(this.size.width * this.bloomScale));
                const h = Math.max(1, Math.floor(this.size.height * this.bloomScale));
                this.bloomNode.setSize(w, h);
            }
        }
        if (params.shaftStrength !== undefined) {
            this.uShaftStrength.value = params.shaftStrength;
        }
        if (params.lightPos !== undefined && this.uLightPos?.value) {
            this.uLightPos.value.set(params.lightPos.x, params.lightPos.y);
        }
    }

    updateTime(time) {
        this.uTime.value = time;
    }

    render() {
        this.postProcessing.render();
    }

    setSize(width, height) {
        this.size.width = width;
        this.size.height = height;
        this.scenePass.setSize(width, height);
        if (this.bloomNode?._separableBlurMaterials?.length) {
            const w = Math.max(1, Math.floor(width * this.bloomScale));
            const h = Math.max(1, Math.floor(height * this.bloomScale));
            this.bloomNode.setSize(w, h);
        }
    }

    dispose() {
        this.scenePass.dispose();
        this.bloomNode.dispose();
        this.postProcessing.dispose();
    }
}
