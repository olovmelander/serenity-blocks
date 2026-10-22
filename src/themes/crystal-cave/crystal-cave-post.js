/**
 * Crystal Cave — the lens.
 *
 * Bloom lets the crystal cores, the glints and the event light spill; a hue-preserving
 * tone curve keeps amethyst purple and rose pink instead of sliding them toward blue and
 * red; a gentle grade deepens the shadows. Low and Minimal draw the same scene directly.
 * With `atmosphere` (the world's light and lamps) the light in the air is added to the
 * scene before bloom (crystal-cave-atmosphere.js).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, clamp, convertToTexture, dot, float, floor, fract, length, mix, neutralToneMapping, pass, renderOutput,
    screenCoordinate, screenUV, sin, smoothstep, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { QUALITY_PRESETS } from './crystal-cave-quality.js';
import { createCaveAtmosphere } from './crystal-cave-atmosphere.js';

export const CRYSTAL_CAVE_EXPOSURE = 1.06;
const BLOOM_STRENGTH = 0.34;
const BLOOM_THRESHOLD = 0.9;
const bounded = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);

export class CrystalCavePost {
    constructor({
        renderer, scene, camera, quality = 'High', atmosphere = null,
    }) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.quality = quality;
        const preset = QUALITY_PRESETS[quality] ?? QUALITY_PRESETS.High;
        this.disabled = preset.enablePost !== true;
        this.useMRT = false;
        this.disposed = false;
        this.pipeline = null;
        this.scenePass = null;
        this.bloomNode = null;
        this.atmosphere = null;
        this.resolutionScale = this.disabled ? 0 : preset.bloomScale;
        this.uExposure = uniform(CRYSTAL_CAVE_EXPOSURE);
        this.uAspect = uniform(16 / 9);
        this.uReaction = uniform(0);
        /** How hot play runs (0..1): the colours deepen with it instead of the light rising. */
        this.uVivid = uniform(0);
        if (this.disabled) return;

        this.pipeline = new THREE.RenderPipeline(renderer);
        // No MSAA: the pool and the beam read the viewport depth, and a multisampled
        // depth cannot be shared with the (single-sample) mirror pass. FXAA below.
        this.scenePass = pass(scene, camera, { samples: 0 });
        const sceneColor = this.scenePass.getTextureNode('output');
        let lit = sceneColor;
        if (atmosphere?.air?.count) {
            this.atmosphere = createCaveAtmosphere({
                air: atmosphere.air,
                camera,
                depthNode: this.scenePass.getTextureNode('depth'),
            });
            if (atmosphere.air.hasShaft) atmosphere.claimShaft?.();
            const airNode = this.atmosphere.node();
            lit = convertToTexture(Fn(() => vec4(sceneColor.rgb.add(airNode), 1))());
        }
        this.bloomNode = bloom(lit, BLOOM_STRENGTH, 0.55, BLOOM_THRESHOLD);
        this.bloomNode.smoothWidth.value = 0.3;
        this.bloomNode.setResolutionScale(this.resolutionScale);

        const graded = Fn(() => {
            const combined = lit.rgb.add(this.bloomNode.rgb).max(0);
            const toned = neutralToneMapping(combined, this.uExposure).toVar();
            const luma = dot(toned, vec3(0.2126, 0.7152, 0.0722));
            // Cool, slightly violet shadows; the lit stone keeps its own colour.
            const shadow = float(1).sub(smoothstep(0.02, 0.32, luma));
            toned.mulAssign(mix(vec3(1), vec3(0.94, 0.97, 1.1), shadow.mul(0.55)));
            // A touch more colour in the mid-tones, more still while the cave is excited.
            const lifted = dot(toned, vec3(0.2126, 0.7152, 0.0722));
            const richer = this.uReaction.mul(0.08).add(this.uVivid.mul(0.14)).add(1.1);
            const saturation = mix(float(1), richer, smoothstep(0.03, 0.3, lifted));
            toned.assign(mix(vec3(lifted), toned, saturation).max(0));
            const radial = length(screenUV.sub(0.5).mul(vec2(this.uAspect.div(1.778), 1)).mul(2));
            toned.mulAssign(float(1).sub(smoothstep(0.65, 1.55, radial).mul(0.24)));
            const display = renderOutput(vec4(clamp(toned, 0, 1), 1), THREE.NoToneMapping).rgb.toVar();
            // Half an 8-bit step of dither keeps the dark haze free of banding.
            const pixel = floor(screenCoordinate.xy);
            const noise = fract(sin(dot(pixel, vec2(12.9898, 78.233))).mul(43758.5453));
            display.addAssign(noise.sub(0.5).div(255));
            return vec4(clamp(display, 0, 1), 1);
        });
        this.pipeline.outputColorTransform = false;
        this.pipeline.outputNode = fxaa(graded());
    }

    update(frame = {}) {
        if (this.disposed) return;
        const response = frame ?? {};
        const reaction = Math.sqrt(Math.max(bounded(response.energy), bounded(response.resonance) * 0.8));
        this.uReaction.value = reaction;
        // The iris closes a little as play heats (the stones carry the build), so the colours stay
        // deep and the dark stays dark; a fever lets the bloom spill a touch further.
        const level = bounded(response.level);
        const fever = bounded(response.fever);
        const iris = 1 - Math.max(0, level - 0.2) * 0.14 - fever * 0.06;
        this.uVivid.value = (Math.max(0, level - 0.15) / 0.85) * 0.6 + fever * 0.4;
        // The cave brightens a little with play; it never whites out the board.
        this.uExposure.value = CRYSTAL_CAVE_EXPOSURE * (1 + reaction * 0.06) * (1 - bounded(response.dim) * 0.25)
            * iris;
        if (this.bloomNode) this.bloomNode.strength.value = BLOOM_STRENGTH + reaction * 0.16 + fever * 0.05;
    }

    render() {
        if (this.disposed) return;
        if (this.pipeline) {
            this.atmosphere?.update();
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
    }

    getDiagnostics() {
        return {
            quality: this.quality,
            disabled: this.disabled,
            useMRT: this.useMRT,
            resolutionScale: this.resolutionScale,
            exposure: this.uExposure.value,
            reaction: this.uReaction.value,
            vivid: this.uVivid.value,
            bloomStrength: this.bloomNode?.strength.value ?? 0,
            bloomThreshold: BLOOM_THRESHOLD,
            atmosphereLamps: this.atmosphere?.count ?? 0,
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
