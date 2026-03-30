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
    clamp,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export class NeonDistrictPost {
    constructor(renderer, scene, camera, params) {
        this.renderer = renderer;
        this.useMRT = params?.useMRT ?? false;
        this.postProcessing = new THREE.PostProcessing(renderer);
        this.scenePass = pass(scene, camera);
        if (this.useMRT) {
            this.scenePass.setMRT(mrt({ output, emissive }));
        }

        const scenePassColor = this.scenePass.getTextureNode('output');
        const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : scenePassColor;

        const strength = params?.bloomStrength ?? 1.0;
        const radius = params?.bloomRadius ?? 0.6;
        const threshold = params?.bloomThreshold ?? 0.2;
        this.bloomNode = bloom(bloomSource, strength, radius, threshold);
        this.bloomDownsample = params?.bloomDownsample ?? 0.8;
        const originalBloomSetSize = this.bloomNode.setSize.bind(this.bloomNode);
        this.bloomNode.setSize = (width, height) => {
            originalBloomSetSize(width * this.bloomDownsample, height * this.bloomDownsample);
        };
        this.size = { width: 0, height: 0 };

        this.chromaticAmount = uniform(0.0);
        this.time = uniform(0);
        this.grainAmount = uniform(0.0);
        this.fogColor = uniform(params?.fogColor ?? new THREE.Color(0x1a0b2a));
        this.fogNear = uniform(params?.fogNear ?? 0.18);
        this.fogFar = uniform(params?.fogFar ?? 0.92);
        this.fogDensity = uniform(params?.fogDensity ?? 0.85);
        this.fogBloomAttenuation = uniform(params?.fogBloomAttenuation ?? 0.5);

        const vignetteOffset = float(params?.vignetteOffset ?? 1.0);
        const vignetteDarkness = float(params?.vignetteDarkness ?? 0.3);
        const uv = viewportUV;
        const centered = uv.sub(0.5).mul(2.0);
        const dist = length(centered);
        const vignette = smoothstep(vignetteOffset, vignetteOffset.sub(0.5), dist);
        const baseSample = scenePassColor.sample(uv);

        // Depth fog (linear depth) for subtle atmospheric perspective
        const linearDepth = this.scenePass.getLinearDepthNode();
        const fogFactor = smoothstep(this.fogNear, this.fogFar, linearDepth);
        const fogAmount = clamp(fogFactor.mul(this.fogDensity), 0.0, 1.0);
        const fogged = mix(baseSample, this.fogColor, fogAmount);

        const vignetteColor = mix(
            fogged.mul(float(1.0).sub(vignetteDarkness)),
            fogged,
            vignette,
        );

        const bloomAtten = clamp(float(1.0).sub(fogAmount.mul(this.fogBloomAttenuation)), 0.0, 1.0);
        this.postProcessing.outputNode = vignetteColor.add(this.bloomNode.mul(bloomAtten));
        this.postProcessing.needsUpdate = true;
    }

    updateParams(params) {
        if (params?.bloomStrength !== undefined) {
            this.bloomNode.strength.value = params.bloomStrength;
        }
        if (params?.bloomRadius !== undefined) {
            this.bloomNode.radius.value = params.bloomRadius;
        }
        if (params?.bloomThreshold !== undefined) {
            this.bloomNode.threshold.value = params.bloomThreshold;
        }
        if (params?.chromaticAberration !== undefined) {
            this.chromaticAmount.value = 0;
        }
        if (params?.grainAmount !== undefined) {
            this.grainAmount.value = 0;
        }
        if (params?.bloomDownsample !== undefined) {
            this.bloomDownsample = params.bloomDownsample;
            if (this.size.width && this.size.height && this.bloomNode?._separableBlurMaterials?.length) {
                this.bloomNode.setSize(this.size.width, this.size.height);
            }
        }
        if (params?.fogColor !== undefined && this.fogColor) {
            this.fogColor.value = params.fogColor;
        }
        if (params?.fogNear !== undefined && this.fogNear) {
            this.fogNear.value = params.fogNear;
        }
        if (params?.fogFar !== undefined && this.fogFar) {
            this.fogFar.value = params.fogFar;
        }
        if (params?.fogDensity !== undefined && this.fogDensity) {
            this.fogDensity.value = params.fogDensity;
        }
        if (params?.fogBloomAttenuation !== undefined && this.fogBloomAttenuation) {
            this.fogBloomAttenuation.value = params.fogBloomAttenuation;
        }
    }

    updateTime(time) {
        if (this.time) {
            this.time.value = time;
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
