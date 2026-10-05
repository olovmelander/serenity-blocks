/** Restrained bloom: the canopy keeps its colors during the largest celebrations. */
import * as THREE from 'three/webgpu';
import {
    Fn, acesFilmicToneMapping, clamp, dot, float, length, mix, pass,
    renderOutput, screenUV, smoothstep, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';

export class FallPost {
    constructor({
        renderer, scene, camera, quality = 'High',
    }) {
        this.renderer = renderer; this.scene = scene; this.camera = camera;
        this.quality = quality; this.disabled = quality === 'Minimal' || quality === 'Low';
        this.useMRT = false; this.disposed = false;
        this.uAspect = uniform(16 / 9); this.uExposure = uniform(1.05);
        if (this.disabled) return;
        this.pipeline = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: 0 });
        const sceneColor = this.scenePass.getTextureNode('output');
        // The same full-scene graph works on WebGPU and node WebGL2. Only luminous
        // dust/shafts cross this threshold; ordinary foliage stays richly colored.
        this.bloomNode = bloom(sceneColor, 0.19, 0.55, 1.05);
        this.bloomNode.setResolutionScale({
            Medium: 0.3, High: 0.4, Ultra: 0.45, Extreme: 0.5,
        }[quality] || 0.4);
        this.pipeline.outputColorTransform = false;
        this.pipeline.outputNode = Fn(() => {
            const toned = acesFilmicToneMapping(sceneColor.rgb.add(this.bloomNode.rgb).max(0), this.uExposure).toVar();
            const luma = dot(toned, vec3(0.2126, 0.7152, 0.0722));
            const shade = float(1).sub(smoothstep(0.03, 0.45, luma));
            toned.mulAssign(mix(vec3(1), vec3(0.97, 1.01, 1.065), shade.mul(0.28)));
            toned.assign(mix(vec3(dot(toned, vec3(0.2126, 0.7152, 0.0722))), toned, 1.06));
            const radius = length(screenUV.sub(0.5).mul(vec2(this.uAspect.div(1.778), 1)).mul(2));
            toned.mulAssign(float(1).sub(smoothstep(0.65, 1.65, radius).mul(0.14)));
            return renderOutput(vec4(clamp(toned, 0, 1), 1), THREE.NoToneMapping);
        })();
    }

    update(frame = {}) {
        const warmth = Number.isFinite(frame.warmth) ? THREE.MathUtils.clamp(frame.warmth, 0, 1) : 0;
        this.uExposure.value = 1.05 + warmth * 0.025;
        if (this.bloomNode) this.bloomNode.strength.value = 0.19 + warmth * 0.06;
    }

    render() {
        if (this.disposed) return;
        if (this.pipeline) this.pipeline.render();
        else {
            const previousTone = this.renderer.toneMapping;
            const previousExposure = this.renderer.toneMappingExposure;
            try {
                this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
                this.renderer.toneMappingExposure = this.uExposure.value;
                this.renderer.render(this.scene, this.camera);
            } finally {
                this.renderer.toneMapping = previousTone;
                this.renderer.toneMappingExposure = previousExposure;
            }
        }
    }

    setSize(width, height) {
        if (!Number.isFinite(width) || !Number.isFinite(height) || !(width > 0 && height > 0)) return;
        this.uAspect.value = width / height;
        this.scenePass?.setSize(width, height);
    }

    getDiagnostics() { return { quality: this.quality, disabled: this.disabled, useMRT: false }; }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.scenePass?.dispose(); disposeBloomNodeDeep(this.bloomNode); this.pipeline?.dispose();
        this.scenePass = null; this.bloomNode = null; this.pipeline = null;
        this.renderer = null; this.scene = null; this.camera = null;
    }
}
