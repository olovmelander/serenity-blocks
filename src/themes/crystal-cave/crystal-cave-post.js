/** Crystal Cave: crisp jewel facets, restrained bloom and a cool cave grade. */
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

const BLOOM_RESOLUTION = Object.freeze({
    Extreme: 0.6, Ultra: 0.55, High: 0.45, Medium: 0.3,
});
const EXPOSURE = 0.95;
const BLOOM_STRENGTH = 0.23;
const BLOOM_THRESHOLD = 0.85;
const bounded = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);

export class CrystalCavePost {
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
        this.resolutionScale = this.disabled ? 0 : (BLOOM_RESOLUTION[quality] ?? BLOOM_RESOLUTION.High);
        this.size = { width: 0, height: 0 };
        this.uExposure = uniform(EXPOSURE);
        this.uAspect = uniform(16 / 9);
        this.uReaction = uniform(0);

        // The same crystal light, rock and water scene renders directly on phone tiers.
        // No scene targets, bloom targets or fullscreen pipeline are allocated there.
        if (this.disabled) return;

        this.pipeline = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: 0 });
        const sceneColor = this.scenePass.getTextureNode('output');
        // Full-scene luminance bloom keeps node-material highlights and additive glints
        // consistent on WebGPU and WebGL2 without a second color attachment.
        this.bloomNode = bloom(sceneColor, BLOOM_STRENGTH, 0.4, BLOOM_THRESHOLD);
        this.bloomNode.smoothWidth.value = 0.25;
        this.bloomNode.setResolutionScale(this.resolutionScale);

        const outputFn = Fn(() => {
            const combined = sceneColor.rgb.add(this.bloomNode.rgb);
            const toned = acesFilmicToneMapping(combined.max(0), this.uExposure).toVar();
            const luma = dot(toned, vec3(0.2126, 0.7152, 0.0722));
            const shadow = float(1).sub(smoothstep(0.035, 0.4, luma));
            const highlight = smoothstep(0.42, 0.92, luma);

            // A subtle violet shadow bias and cool gleam support the amethyst/cyan
            // palette; multiplication preserves the scene's shadow detail and depth.
            toned.mulAssign(mix(vec3(1), vec3(1.025, 0.985, 1.075), shadow.mul(0.2)));
            toned.mulAssign(mix(vec3(1), vec3(0.985, 1.025, 1.04), highlight.mul(0.16)));
            const gradedLuma = dot(toned, vec3(0.2126, 0.7152, 0.0722));
            // Keep dark rock neutral while restoring jewel chroma after the ACES shoulder.
            const saturation = mix(
                float(1),
                this.uReaction.mul(0.055).add(1.065),
                smoothstep(0.035, 0.22, gradedLuma),
            );
            toned.assign(mix(vec3(gradedLuma), toned, saturation));

            const radial = length(screenUV.sub(0.5).mul(vec2(this.uAspect.div(1.778), 1)).mul(2));
            toned.mulAssign(float(1).sub(smoothstep(0.72, 1.6, radial).mul(0.065)));

            // Apply the display transform once, then add half an 8-bit step of dither
            // to keep the cave haze smooth without animated grain or colored fringes.
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
        if (this.disposed) return;
        const response = frame ?? {};
        const reaction = Math.sqrt(Math.max(bounded(response.energy), bounded(response.resonance) * 0.8));
        // Crystal surfaces, ripples and traveling glints carry the event. This bounded
        // response retains facet color and never turns gameplay into a screen flash.
        this.uReaction.value = reaction;
        this.uExposure.value = EXPOSURE;
        if (this.bloomNode) this.bloomNode.strength.value = BLOOM_STRENGTH + reaction * 0.11;
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
        if (this.disposed || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
        this.size = { width, height };
        this.uAspect.value = width / height;
        this.scenePass?.setSize(width, height);
        if (this.bloomNode?._separableBlurMaterials?.length) this.bloomNode.setSize(width, height);
    }

    getDiagnostics() {
        return {
            quality: this.quality,
            disabled: this.disabled,
            useMRT: this.useMRT,
            resolutionScale: this.resolutionScale,
            exposure: this.uExposure.value,
            reaction: this.uReaction.value,
            bloomStrength: this.bloomNode?.strength.value ?? 0,
            bloomThreshold: BLOOM_THRESHOLD,
        };
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
