import * as THREE from 'three/webgpu';
import { emissive, mrt, output, pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { withEmissiveMaterialBlending } from '../shared/mrt-blend.js';

type TornadoPostParams = {
    bloomStrength: number;
    bloomRadius: number;
    bloomDownsample?: number;
};

export class TornadoPost {
    private renderer: THREE.WebGPURenderer;
    private postProcessing: THREE.RenderPipeline;
    private scenePass: ReturnType<typeof pass>;
    private bloomNode: ReturnType<typeof bloom>;
    private bloomDownsample: number;

    constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, params: TornadoPostParams) {
        this.renderer = renderer;
        this.postProcessing = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera);
        this.scenePass.setMRT(withEmissiveMaterialBlending(mrt({ output, emissive })));

        const scenePassColor = this.scenePass.getTextureNode('output');
        const emissivePass = this.scenePass.getTextureNode('emissive');
        this.bloomNode = bloom(emissivePass, params.bloomStrength, params.bloomRadius, 0.2);

        // Render the bloom separable-blur pyramid at a fraction of the render
        // resolution (Winter/Chromadelic parity). Bloom is a wide blur so the
        // downsample is near-invisible while cutting bloom pixel work ~2.4x.
        this.bloomDownsample = params.bloomDownsample ?? 0.65;
        const originalBloomSetSize = this.bloomNode.setSize.bind(this.bloomNode);
        this.bloomNode.setSize = (width: number, height: number) => {
            originalBloomSetSize(width * this.bloomDownsample, height * this.bloomDownsample);
        };

        this.postProcessing.outputNode = scenePassColor.add(this.bloomNode);
        this.postProcessing.needsUpdate = true;
    }

    updateParams(params: Partial<TornadoPostParams>) {
        if (params.bloomStrength !== undefined) {
            this.bloomNode.strength.value = params.bloomStrength;
        }
        if (params.bloomRadius !== undefined) {
            this.bloomNode.radius.value = params.bloomRadius;
        }
    }

    render() {
        this.postProcessing.render();
    }

    setSize(width: number, height: number) {
        this.scenePass.setSize(width, height);
        // Size the bloom too (the wrapped setSize applies the downsample). Guard
        // so we only fire once the separable-blur materials exist.
        if ((this.bloomNode as any)?._separableBlurMaterials?.length) {
            this.bloomNode.setSize(width, height);
        }
    }

    dispose() {
        this.scenePass.dispose();
        disposeBloomNodeDeep(this.bloomNode);
        this.postProcessing.dispose();
    }
}
