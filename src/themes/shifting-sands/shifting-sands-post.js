/**
 * Shifting Sands Theme - TSL Post Processing
 * Heat shimmer + selective bloom + optional god rays (WebGPU-only)
 */

import * as THREE from 'three/webgpu';
import {
    pass,
    mrt,
    output,
    emissive,
    viewportUV,
    uniform,
    float,
    vec2,
    vec3,
    vec4,
    sin,
    cos,
    smoothstep,
    pow,
    max,
    length,
    mix,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { withEmissiveMaterialBlending } from '../shared/mrt-blend.js';

export class ShiftingSandsPost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.postProcessing = new THREE.RenderPipeline(renderer);

        this.uTime = uniform(0);
        this.uStrength = uniform(params.heatShimmerStrength ?? 0.006);
        this.uBloomStrength = uniform(params.bloomStrength ?? 0.4);
        this.uBloomRadius = uniform(params.bloomRadius ?? 0.3);
        this.uBloomThreshold = uniform(params.bloomThreshold ?? 0.2);
        this.uGodRaysIntensity = uniform(params.godRaysIntensity ?? 0.0);
        this.uMoon1 = uniform(params.moon1 ?? new THREE.Vector2(0.3, 0.8));
        this.uMoon2 = uniform(params.moon2 ?? new THREE.Vector2(0.7, 0.7));
        this.uGradeStrength = uniform(params.gradeStrength ?? 0.0);

        // Scene pass with MRT for selective bloom
        this.scenePass = pass(scene, camera);
        this.scenePass.setMRT(withEmissiveMaterialBlending(mrt({ output, emissive })));

        const sceneColor = this.scenePass.getTextureNode('output');
        const emissivePass = this.scenePass.getTextureNode('emissive');

        const uv = viewportUV.toVar();

        // Heat shimmer mask (stronger at bottom)
        const heatMask = smoothstep(0.8, 0.2, uv.y);

        const xOffset = sin(uv.y.mul(50.0).add(this.uTime.mul(2.0))).mul(0.001)
            .add(sin(uv.y.mul(20.0).add(this.uTime.mul(3.0))).mul(0.002))
            .mul(heatMask)
            .mul(this.uStrength)
            .mul(100.0);

        const yOffset = cos(uv.x.mul(40.0).add(this.uTime.mul(2.0))).mul(0.001)
            .mul(heatMask).mul(this.uStrength)
            .mul(100.0);

        const distortedUV = uv.add(vec2(xOffset, yOffset));
        const distortedColor = sceneColor.sample(distortedUV);

        // Selective bloom (emissive only)
        const spiceBloom = bloom(emissivePass, this.uBloomStrength, this.uBloomRadius, this.uBloomThreshold);
        this.bloomNode = spiceBloom;

        let outColor = distortedColor.add(spiceBloom);

        // Simple god rays (WebGPU enhancement)
        const rayColor = vec3(1.0, 0.8, 0.6);
        const ray1 = this._godRay(uv, this.uMoon1, this.uGodRaysIntensity);
        const ray2 = this._godRay(uv, this.uMoon2, this.uGodRaysIntensity.mul(0.7));
        outColor = outColor.add(vec4(rayColor.mul(ray1.add(ray2)), 1.0));

        // Optional warm color grade
        const warm = vec3(1.05, 1.0, 0.95);
        outColor = vec4(mix(outColor.rgb, outColor.rgb.mul(warm), this.uGradeStrength), outColor.a);

        this.postProcessing.outputNode = outColor;
        this.postProcessing.needsUpdate = true;
    }

    _godRay(uv, moonPos, intensity) {
        const d = length(uv.sub(moonPos));
        const base = max(0.0, float(1.0).sub(d.mul(2.0)));
        const streak = sin((uv.x.add(uv.y)).mul(80.0).add(this.uTime.mul(0.5))).mul(0.1).add(0.9);
        return pow(base, 3.0).mul(streak).mul(intensity);
    }

    update(time, strength, options = {}) {
        this.uTime.value = time;
        if (strength !== undefined) this.uStrength.value = strength;
        if (options.godRaysIntensity !== undefined) this.uGodRaysIntensity.value = options.godRaysIntensity;
        if (options.gradeStrength !== undefined) this.uGradeStrength.value = options.gradeStrength;
    }

    render() {
        this.postProcessing.render();
    }

    setSize(width, height) {
        this.scenePass.setSize(width, height);
    }

    dispose() {
        this.scenePass.dispose();
        disposeBloomNodeDeep(this.bloomNode);
        this.bloomNode = null;
        this.postProcessing.dispose();
    }
}
