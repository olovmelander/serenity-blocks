/**
 * Aurora post: a wide, restrained bloom and a night grade. The curtains carry their own
 * colour, so the grade's job is to keep it — a hue-faithful tone curve, deep but unclipped
 * shadows, and enough dither that the faint sky gradient never bands.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, clamp, dot, float, floor, fract, length, mix, neutralToneMapping, pass, renderOutput,
    screenCoordinate, screenUV, sin, smoothstep, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';

const EXPOSURE = 1.0;
const BLOOM_STRENGTH = 0.3;
const BLOOM_RADIUS = 0.62;
const BLOOM_THRESHOLD = 0.82;
const bounded = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);

export class AuroraPost {
    /**
     * @param {object} options
     * @param {object} options.preset quality preset; `enablePost: false` renders directly
     * @param {boolean} [options.antialias] multisample the scene pass on the upper tiers
     */
    constructor({
        renderer, scene, camera, preset, antialias = true,
    }) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.preset = preset;
        this.disabled = preset.enablePost !== true;
        this.useMRT = false;
        this.disposed = false;
        this.pipeline = null;
        this.scenePass = null;
        this.bloomNode = null;
        this.uExposure = uniform(EXPOSURE);
        this.uAspect = uniform(16 / 9);

        // The cheapest tiers draw the same scene straight to the canvas: no scene target,
        // no bloom chain, no fullscreen pass.
        if (this.disabled) return;

        this.pipeline = new THREE.RenderPipeline(renderer);
        this.samples = antialias && preset.bloomScale >= 0.45 ? 4 : 0;
        this.scenePass = pass(scene, camera, { samples: this.samples });
        const sceneColor = this.scenePass.getTextureNode('output');
        // Luminance bloom over the composite reads the same on WebGPU and WebGL2 and
        // needs no second colour attachment.
        this.bloomNode = bloom(sceneColor, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
        this.bloomNode.smoothWidth.value = 0.4;
        this.bloomNode.setResolutionScale(preset.bloomScale);

        this.pipeline.outputColorTransform = false;
        this.pipeline.outputNode = Fn(() => {
            const combined = sceneColor.rgb.add(this.bloomNode.rgb).max(0);
            const toned = neutralToneMapping(combined, this.uExposure).toVar();
            // A faint indigo floor keeps the darkest sky from collapsing to pure black,
            // and a touch of chroma restores what the shoulder takes from the greens.
            const luma = dot(toned, vec3(0.2126, 0.7152, 0.0722));
            toned.assign(mix(vec3(luma), toned, float(1.06)));
            toned.addAssign(vec3(0.0016, 0.0022, 0.0048).mul(float(1).sub(smoothstep(0, 0.12, luma))));
            const radial = length(screenUV.sub(0.5).mul(vec2(this.uAspect.div(1.778), 1)).mul(2));
            toned.mulAssign(float(1).sub(smoothstep(0.75, 1.7, radial).mul(0.16)));

            const display = renderOutput(vec4(clamp(toned, 0, 1), 1), THREE.NoToneMapping).rgb.toVar();
            const pixel = floor(screenCoordinate.xy);
            const grain = fract(sin(dot(pixel, vec2(12.9898, 78.233))).mul(43758.5453));
            display.addAssign(grain.sub(0.5).div(255));
            return vec4(clamp(display, 0, 1), 1);
        })();
    }

    /** Events live in the sky itself; the grade only breathes with them, never flashes. */
    update(frame = {}) {
        if (this.disposed) return;
        const activity = bounded(frame.activity);
        const surge = bounded(frame.surge);
        this.uExposure.value = EXPOSURE + surge * 0.02;
        if (this.bloomNode) this.bloomNode.strength.value = BLOOM_STRENGTH + activity * 0.07 + surge * 0.05;
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
            renderer.toneMapping = THREE.NeutralToneMapping;
            renderer.toneMappingExposure = this.uExposure.value;
            renderer.render(this.scene, this.camera);
        } finally {
            renderer.toneMapping = previousToneMapping;
            renderer.toneMappingExposure = previousExposure;
        }
    }

    setSize(width, height) {
        if (this.disposed || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
        this.uAspect.value = width / height;
        this.scenePass?.setSize(width, height);
    }

    getDiagnostics() {
        return {
            disabled: this.disabled,
            useMRT: this.useMRT,
            samples: this.samples ?? 0,
            bloomScale: this.disabled ? 0 : this.preset.bloomScale,
            bloomStrength: this.bloomNode?.strength.value ?? 0,
            exposure: this.uExposure.value,
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
