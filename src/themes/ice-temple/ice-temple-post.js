/**
 * Ice Temple Theme - WebGPU Post Processing
 * Hybrid WebGPU post: standard bloom fallback + optional emissive MRT bloom.
 */

import * as WEBGPU from 'three/webgpu';
import * as TSL from 'three/tsl';
import * as BLOOM from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { withEmissiveMaterialBlending } from '../shared/mrt-blend.js';

export class IceTemplePost {
    static async create(renderer, scene, camera, params = {}) {
        return new IceTemplePost(renderer, scene, camera, params, WEBGPU, TSL, BLOOM);
    }

    constructor(renderer, scene, camera, params, WEBGPU, TSL, BLOOM) {
        const {
            pass,
            mrt,
            output,
            emissive,
            float,
        } = TSL;
        const { bloom } = BLOOM;

        this.renderer = renderer;
        this.useMRT = Boolean(params.useMRT);
        this.postScale = params.postScale ?? 1.0;
        this.scenePass = pass(scene, camera);
        if (this.useMRT) {
            this.scenePass.setMRT(withEmissiveMaterialBlending(mrt({ output, emissive })));
        }
        this.postProcessing = new WEBGPU.RenderPipeline(renderer);
        this.size = { width: 0, height: 0 };

        const sceneColor = this.scenePass.getTextureNode('output');
        const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;

        const bloomStrength = params.bloomStrength ?? 0.5;
        const bloomRadius = params.bloomRadius ?? 0.3;
        const bloomThreshold = params.bloomThreshold ?? 0.4;
        const bloomMix = params.bloomMix ?? 1.0;

        this.bloomNode = bloom(bloomSource, bloomStrength, bloomRadius, bloomThreshold);
        this.bloomDownsample = params.bloomDownsample ?? 1.0;
        const originalBloomSetSize = this.bloomNode.setSize.bind(this.bloomNode);
        this.bloomNode.setSize = (width, height) => {
            originalBloomSetSize(width * this.bloomDownsample, height * this.bloomDownsample);
        };

        this.postProcessing.outputNode = sceneColor.add(this.bloomNode.mul(float(bloomMix)));
        this.postProcessing.needsUpdate = true;

        if (params.auditMRT) {
            console.log('[IceTemplePost] MRT mode', {
                useMRT: this.useMRT,
                bloomDownsample: this.bloomDownsample,
                bloomStrength,
                bloomRadius,
                bloomThreshold,
            });
        }
    }

    render() {
        this.postProcessing.render();
    }

    setSize(width, height) {
        this.size.width = width;
        this.size.height = height;
        const scaledWidth = Math.max(1, Math.floor(width * this.postScale));
        const scaledHeight = Math.max(1, Math.floor(height * this.postScale));
        this.scenePass.setSize(scaledWidth, scaledHeight);
        if (this.bloomNode?._separableBlurMaterials?.length) {
            this.bloomNode.setSize(scaledWidth, scaledHeight);
        }
    }

    dispose() {
        this.scenePass.dispose();
        disposeBloomNodeDeep(this.bloomNode);
        this.postProcessing.dispose();
    }
}
