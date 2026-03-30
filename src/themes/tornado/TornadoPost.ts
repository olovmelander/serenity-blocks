import * as THREE from 'three/webgpu';
import { emissive, mrt, output, pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

type TornadoPostParams = {
    bloomStrength: number;
    bloomRadius: number;
};

export class TornadoPost {
    private renderer: THREE.WebGPURenderer;
    private postProcessing: THREE.PostProcessing;
    private scenePass: ReturnType<typeof pass>;
    private bloomNode: ReturnType<typeof bloom>;

    constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, params: TornadoPostParams) {
        this.renderer = renderer;
        this.postProcessing = new THREE.PostProcessing(renderer);
        this.scenePass = pass(scene, camera);
        this.scenePass.setMRT(mrt({ output, emissive }));

        const scenePassColor = this.scenePass.getTextureNode('output');
        const emissivePass = this.scenePass.getTextureNode('emissive');
        this.bloomNode = bloom(emissivePass, params.bloomStrength, params.bloomRadius, 0.2);

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
    }

    dispose() {
        this.scenePass.dispose();
        this.bloomNode.dispose();
        this.postProcessing.dispose();
    }
}
