/**
 * Black Hole post: gravitational ripples, bloom and the grade.
 *
 * The scene is rendered in linear HDR — the inner disk is several times brighter than paper
 * white — so bloom is a plain luminance knee over the composite and needs no second colour
 * attachment. Ripples are refraction, not light: each one bends the picture as its front
 * passes, the way a gravitational wave would, and leaves nothing behind.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, acesFilmicToneMapping, agxToneMapping, clamp, dot, exp, float, floor, fract, length, max, mix,
    neutralToneMapping, pass, renderOutput, screenCoordinate, screenUV, sin, smoothstep, uniform, uniformArray,
    vec2, vec3, vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';

/** Refraction rings in flight at once. */
export const RIPPLE_SLOTS = 4;

const EXPOSURE = 1.0;
const BLOOM_STRENGTH = 0.24;
const BLOOM_RADIUS = 0.62;
const BLOOM_THRESHOLD = 1.0;
/** Bloom input ceiling on the brightest channel: keeps a white-hot knot from flooding the frame. */
const BLOOM_PEAK = 9;
const bounded = (value, high = 1) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, high) : 0);

export class BlackHolePost {
    /**
     * @param {object} options
     * @param {object} options.preset quality preset; `enablePost: false` renders directly
     */
    constructor({
        renderer, scene, camera, preset, tone = 'neutral',
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
        this.uWarmth = uniform(0);
        /** xy: centre (uv, y down), z: front radius, w: strength. Radii are in screen heights. */
        this.rippleData = Array.from({ length: RIPPLE_SLOTS }, () => new THREE.Vector4(0.5, 0.5, 0, 0));
        this.uRipples = uniformArray(this.rippleData, 'vec4');

        // The cheapest tier draws the same scene straight to the canvas: no scene target,
        // no bloom chain, no fullscreen pass.
        if (this.disabled) return;

        this.pipeline = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: 0 });
        const sceneColor = this.scenePass.getTextureNode('output');
        this.bloomNode = bloom(sceneColor, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
        // Soft knee on the brightest channel, so the ember-red rim keeps its hue in the bloom.
        this.bloomNode.highPassFn = Fn(({ input, threshold, smoothWidth }) => {
            const texel = max(input.rgb, vec3(0));
            const peak = max(max(texel.r, texel.g), texel.b);
            const knee = smoothstep(threshold, threshold.add(smoothWidth).add(0.9), peak);
            const limit = float(BLOOM_PEAK).div(max(peak, BLOOM_PEAK));
            return vec4(texel.mul(knee).mul(limit), 1);
        });
        this.bloomNode.setResolutionScale(preset.bloomScale);

        this.pipeline.outputColorTransform = false;
        this.pipeline.outputNode = Fn(() => {
            // Sum the refraction of every ripple in flight, then read the scene once.
            const bend = vec2(0).toVar();
            for (let slot = 0; slot < RIPPLE_SLOTS; slot += 1) {
                const ripple = this.uRipples.element(slot);
                const offset = screenUV.sub(ripple.xy).mul(vec2(this.uAspect, 1));
                const distance = max(length(offset), 1e-4);
                // Width grows with the ring, so a wide front stays a soft swell.
                const width = ripple.z.mul(0.16).add(0.012);
                const front = distance.sub(ripple.z).div(width);
                const swell = front.mul(exp(front.mul(front).negate())).mul(ripple.w);
                bend.addAssign(offset.div(distance).mul(swell).div(vec2(this.uAspect, 1)));
            }
            const at = screenUV.sub(bend).toVar();
            const sampled = sceneColor.sample(at).toVar();
            const picture = sampled.rgb.toVar();
            if (preset.dispersion) {
                // The front splits the light a little: red leads, blue trails.
                picture.assign(vec3(
                    sceneColor.sample(screenUV.sub(bend.mul(1.09))).r,
                    picture.g,
                    sceneColor.sample(screenUV.sub(bend.mul(0.91))).b,
                ));
            }
            // The lens writes the bare shadow into alpha: glare is held out of it.
            const combined = picture.add(this.bloomNode.rgb.mul(clamp(sampled.a, 0, 1))).max(0);
            const curve = { aces: acesFilmicToneMapping, agx: agxToneMapping, neutral: neutralToneMapping }[tone]
                ?? neutralToneMapping;
            const toned = curve(combined, this.uExposure).toVar();
            // A split grade: shadows lean indigo, highlights keep the disk's gold.
            const luma = dot(toned, vec3(0.2126, 0.7152, 0.0722));
            const shade = float(1).sub(smoothstep(0.0, 0.28, luma));
            toned.mulAssign(mix(vec3(1), vec3(0.9, 0.96, 1.16), shade.mul(0.5)));
            toned.assign(mix(vec3(dot(toned, vec3(0.2126, 0.7152, 0.0722))), toned, this.uWarmth.mul(0.08).add(1.06)));
            const radial = length(screenUV.sub(0.5).mul(vec2(this.uAspect.div(1.778), 1)).mul(2));
            toned.mulAssign(float(1).sub(smoothstep(0.72, 1.75, radial).mul(0.26)));

            const display = renderOutput(vec4(clamp(toned, 0, 1), 1), THREE.NoToneMapping).rgb.toVar();
            const pixel = floor(screenCoordinate.xy);
            const grain = fract(sin(dot(pixel, vec2(12.9898, 78.233))).mul(43758.5453));
            display.addAssign(grain.sub(0.5).div(255));
            return vec4(clamp(display, 0, 1), 1);
        })();
    }

    /**
     * @param {object} frame
     * @param {number} frame.energy 0…1 — how wound-up the scene is
     * @param {number} frame.flash 0…1 — a brief lift on impacts
     * @param {Array<{x:number,y:number,radius:number,strength:number}>} [frame.ripples]
     */
    update(frame = {}) {
        if (this.disposed) return;
        const energy = bounded(frame.energy);
        const flash = bounded(frame.flash);
        this.uExposure.value = EXPOSURE + flash * 0.07;
        this.uWarmth.value = energy;
        if (this.bloomNode) this.bloomNode.strength.value = BLOOM_STRENGTH + energy * 0.07 + flash * 0.05;
        const ripples = frame.ripples || [];
        for (let slot = 0; slot < RIPPLE_SLOTS; slot += 1) {
            const ripple = ripples[slot];
            const target = this.rippleData[slot];
            if (ripple && ripple.strength > 0) {
                target.set(ripple.x, ripple.y, Math.max(0, ripple.radius), bounded(ripple.strength, 0.08));
            } else if (target.w !== 0) target.set(0.5, 0.5, 0, 0);
        }
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
            bloomScale: this.disabled ? 0 : this.preset.bloomScale,
            bloomStrength: this.bloomNode?.strength.value ?? 0,
            exposure: this.uExposure.value,
            ripples: this.rippleData.filter((ripple) => ripple.w > 0).length,
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
