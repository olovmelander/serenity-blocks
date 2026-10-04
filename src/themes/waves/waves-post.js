/** Waves: restrained ocean grade and emission-aware bloom. */
import * as THREE from 'three/webgpu';
import {
    Fn,
    acesFilmicToneMapping,
    clamp,
    dot,
    float,
    floor,
    fract,
    length,
    mix,
    mrt,
    output,
    emissive,
    pass,
    renderOutput,
    screenCoordinate,
    screenUV,
    sin,
    smoothstep,
    uniform,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { withEmissiveMaterialBlending } from '../shared/mrt-blend.js';

const POST_RESOLUTION = Object.freeze({
    Extreme: 0.55, Ultra: 0.5, High: 0.45, Medium: 0.3,
});
const BLOOM_STRENGTH = 0.22;
const EXPOSURE = 1.05;
const bounded = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);

export class WavesPost {
    constructor({
        renderer, scene, camera, quality = 'High',
    }) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.quality = quality;
        this.disabled = quality === 'Low' || quality === 'Minimal';
        this.useMRT = false;
        this.disposed = false;
        this.pipeline = null;
        this.scenePass = null;
        this.bloomNode = null;
        this.size = { width: 0, height: 0 };
        this.uExposure = uniform(EXPOSURE);
        this.uAspect = uniform(16 / 9);

        // Phone tiers render the same ocean directly, without offscreen targets or blur passes.
        if (this.disabled) return;

        this.pipeline = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: 0 });
        this.useMRT = renderer.backend?.isWebGPUBackend === true
            && (renderer.backend?.device?.limits?.maxColorAttachments ?? 0) >= 2;
        if (this.useMRT) {
            this.scenePass.setMRT(withEmissiveMaterialBlending(mrt({ output, emissive })));
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;
        this.bloomNode = bloom(bloomSource, BLOOM_STRENGTH, 0.45, this.useMRT ? 0.12 : 0.9);
        this.bloomNode.smoothWidth.value = 0.35;
        this.bloomNode.setResolutionScale(POST_RESOLUTION[quality] ?? POST_RESOLUTION.High);

        const outputFn = Fn(() => {
            const combined = sceneColor.rgb.add(this.bloomNode.rgb);
            const toned = acesFilmicToneMapping(combined.max(0), this.uExposure).toVar();
            const luma = dot(toned, vec3(0.2126, 0.7152, 0.0722));
            // Preserve the teal shadow floor; avoid subtractive contrast that crushes water detail.
            const shadow = float(1).sub(smoothstep(0.02, 0.4, luma));
            const highlight = smoothstep(0.45, 0.95, luma);
            toned.mulAssign(mix(vec3(1), vec3(0.95, 1.01, 1.06), shadow.mul(0.18)));
            toned.mulAssign(mix(vec3(1), vec3(1.04, 1.01, 0.96), highlight.mul(0.18)));
            toned.assign(mix(vec3(dot(toned, vec3(0.2126, 0.7152, 0.0722))), toned, 1.035));

            const radial = length(screenUV.sub(0.5).mul(vec2(this.uAspect.div(1.778), 1)).mul(2));
            toned.mulAssign(float(1).sub(smoothstep(0.65, 1.5, radial).mul(0.12)));
            const display = renderOutput(vec4(clamp(toned, 0, 1), 1), THREE.NoToneMapping).rgb.toVar();
            const pixel = floor(screenCoordinate.xy);
            const noise = fract(sin(dot(pixel, vec2(12.9898, 78.233))).mul(43758.5453));
            display.addAssign(noise.sub(0.5).div(255));
            return vec4(clamp(display, 0, 1), 1);
        });
        this.pipeline.outputColorTransform = false;
        this.pipeline.outputNode = outputFn();
    }

    update(frame = {}) {
        const reaction = Math.max(bounded(frame.pulse), bounded(frame.shafts) * 0.7);
        // Gameplay lighting belongs to the water and droplets; the post never creates a white flash.
        this.uExposure.value = EXPOSURE + reaction * 0.015;
        if (this.bloomNode) this.bloomNode.strength.value = BLOOM_STRENGTH + reaction * 0.06;
    }

    render() {
        if (this.disposed) return;
        if (this.pipeline) {
            this.pipeline.render();
            return;
        }
        const { renderer } = this;
        const previousToneMapping = renderer.toneMapping;
        const previousExposure = renderer.toneMappingExposure;
        try {
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = this.uExposure.value;
            renderer.render(this.scene, this.camera);
        } finally {
            renderer.toneMapping = previousToneMapping;
            renderer.toneMappingExposure = previousExposure;
        }
    }

    setSize(width, height) {
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
        this.size = { width, height };
        this.uAspect.value = width / height;
        this.scenePass?.setSize(width, height);
        if (this.bloomNode?._separableBlurMaterials?.length) this.bloomNode.setSize(width, height);
    }

    resize(width, height) {
        this.setSize(width, height);
    }

    getDiagnostics() {
        return { quality: this.quality, disabled: this.disabled, useMRT: this.useMRT };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.scenePass?.dispose();
        disposeBloomNodeDeep(this.bloomNode);
        this.pipeline?.dispose();
        this.scenePass = null;
        this.bloomNode = null;
        this.pipeline = null;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
    }
}
