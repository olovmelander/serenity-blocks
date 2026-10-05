/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * The breathing stage's lens: bloom, light shafts, a per-world grade and a little glass.
 *
 * One pipeline serves every world. A world only states numbers (bloom, shafts, grade,
 * exposure); they live in uniforms, so swapping worlds never rebuilds the graph — except that
 * the light-shaft pass is a separate reduced-resolution target, present only in the output graph
 * of worlds that use it (a zeroed pass still costs its samples). The swap happens during the
 * world-change blink, so that one rebuild is never seen.
 *
 *   scene ─┬─ bloom (mip chain, tier-scaled) ───────────────┐
 *          ├─ shafts (radial march toward the light, ¼–½ res) ┤
 *          └─ edge chromatic aberration (high tiers) ────────┴→ neutral tone map → grade → vignette → dither
 *
 * Light-shaft and screen positions follow three's post convention: uv.y = 0 at the TOP.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, clamp, dot, exp, float, floor, fract, length, mix, neutralToneMapping, pass,
    renderOutput, rtt, screenCoordinate, screenUV, sin, smoothstep, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../../../../themes/shared/bloom-dispose.js';
import { fadeOut } from './breath-tsl.js';

export const DEFAULT_BLOOM = Object.freeze({
    strength: 0.35, radius: 0.6, threshold: 0.7, breath: 0.35,
});
export const NEUTRAL_GRADE = Object.freeze({
    shadows: [1, 1, 1], highlights: [1, 1, 1], saturation: 1, contrast: 1, vignette: 0.3,
});
const LUMA = vec3(0.2126, 0.7152, 0.0722);

export class BreathPost {
    /**
     * @param {THREE.WebGPURenderer} renderer
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {{bloom: number, shafts: number, shaftScale: number, chroma: boolean}} quality
     */
    constructor(renderer, scene, camera, quality) {
        this.renderer = renderer;
        this.quality = quality;
        this.uExposure = uniform(1);
        this.uAspect = uniform(16 / 9);
        this.uShaftCenter = uniform(new THREE.Vector2(0.5, 0.35));
        this.uShaftStrength = uniform(0);
        this.uShaftThreshold = uniform(0.6);
        this.uShaftDecay = uniform(0.96);
        this.uShaftLength = uniform(0.85);
        this.uShaftRegion = uniform(2);
        this.uShaftRadius = uniform(10);
        this.uShaftTint = uniform(new THREE.Color(1, 1, 1));
        this.uShadowTint = uniform(new THREE.Color(1, 1, 1));
        this.uHighlightTint = uniform(new THREE.Color(1, 1, 1));
        this.uSaturation = uniform(1);
        this.uContrast = uniform(1);
        this.uVignette = uniform(0.3);
        this.uChroma = uniform(1);

        this.pipeline = new THREE.RenderPipeline(renderer);
        this.pipeline.outputColorTransform = false;
        this.scenePass = pass(scene, camera);
        this.sceneColor = this.scenePass.getTextureNode('output');
        // Luminance bloom over the composite: no second colour attachment, same on both backends.
        this.bloomNode = bloom(this.sceneColor, DEFAULT_BLOOM.strength, DEFAULT_BLOOM.radius, DEFAULT_BLOOM.threshold);
        this.bloomNode.smoothWidth.value = 0.35;
        this.bloomNode.setResolutionScale(quality.bloom);
        this.bloomBase = DEFAULT_BLOOM.strength;
        this.bloomBreath = DEFAULT_BLOOM.breath;
        this.shaftsNode = null;
        this.outputs = new Map();
        this.usesShafts = null;
        this._useShafts(false);
    }

    /**
     * The shafts, in two short marches instead of one long one. The first walks each pixel toward
     * the light and gathers what glows on the way (only above `region`, where the world says light
     * comes from); the second walks the first's result over one of its steps, filling the gaps
     * between its samples. N + M taps give the smoothness of N x M, with no jitter and so no grain.
     */
    _createShafts() {
        const count = this.quality.shafts;
        const refine = 6;
        const { sceneColor } = this;
        const gather = Fn(() => {
            const coord = uv().toVar();
            const stride = this.uShaftCenter.sub(coord).mul(this.uShaftLength).div(count).toVar();
            const at = coord.toVar();
            const sum = vec3(0).toVar();
            const weight = float(1).toVar();
            Loop(count, () => {
                at.addAssign(stride);
                const sample = sceneColor.sample(at).rgb.toVar();
                const lum = dot(sample, LUMA);
                // Only what is bright enough to be a light source streaks; dark occluders cut the beams.
                // Emitters sit near the light (radius in screen heights) and above the region line.
                const off = at.sub(this.uShaftCenter).mul(vec2(this.uAspect, 1)).toVar();
                const source = smoothstep(this.uShaftThreshold, this.uShaftThreshold.add(0.5), lum)
                    .mul(fadeOut(this.uShaftRegion.sub(0.04), this.uShaftRegion.add(0.04), at.y))
                    .mul(exp(dot(off, off).div(this.uShaftRadius.mul(this.uShaftRadius)).negate()));
                sum.addAssign(sample.mul(source).mul(weight));
                weight.mulAssign(this.uShaftDecay);
            });
            return vec4(sum.div(count), 1);
        })();
        const first = rtt(gather, null, null, { resolutionScale: this.quality.shaftScale });
        const fill = Fn(() => {
            const coord = uv().toVar();
            const stride = this.uShaftCenter.sub(coord).mul(this.uShaftLength).div(count * refine).toVar();
            const at = coord.toVar();
            const sum = vec3(0).toVar();
            Loop(refine, () => {
                sum.addAssign(first.sample(at).rgb);
                at.addAssign(stride);
            });
            return vec4(sum.div(refine), 1);
        })();
        this.shaftsFirst = first;
        return rtt(fill, null, null, { resolutionScale: this.quality.shaftScale });
    }

    _buildOutput(withShafts) {
        const { sceneColor, bloomNode } = this;
        const shafts = withShafts ? this.shaftsNode : null;
        const { chroma } = this.quality;
        return Fn(() => {
            const coord = uv();
            const color = sceneColor.rgb.toVar();
            if (chroma) {
                // A whisper of lateral colour toward the corners, as a real lens has.
                const off = coord.sub(0.5).toVar();
                const reach = off.mul(dot(off, off).mul(0.012).mul(this.uChroma));
                color.assign(vec3(sceneColor.sample(coord.add(reach)).r, color.g, sceneColor.sample(coord.sub(reach)).b));
            }
            color.addAssign(bloomNode.rgb);
            if (shafts) color.addAssign(shafts.sample(coord).rgb.mul(this.uShaftTint).mul(this.uShaftStrength));
            const toned = neutralToneMapping(color.max(0), this.uExposure).toVar();
            const luma = dot(toned, LUMA);
            // Restore the chroma the shoulder takes, and keep the deepest tones off pure black.
            toned.assign(mix(vec3(luma), toned, float(1.07)));
            toned.addAssign(vec3(0.0014, 0.0018, 0.004).mul(float(1).sub(smoothstep(0, 0.1, luma))));
            const display = renderOutput(vec4(clamp(toned, 0, 1), 1), THREE.NoToneMapping).rgb.toVar();
            // The grade works on display values, where "shadows" and "highlights" mean what they look like.
            const shade = dot(display, LUMA).toVar();
            display.mulAssign(mix(this.uShadowTint, this.uHighlightTint, smoothstep(0.05, 0.85, shade)));
            display.assign(display.sub(0.5).mul(this.uContrast).add(0.5));
            display.assign(mix(vec3(dot(display, LUMA)), display, this.uSaturation));
            const radial = length(screenUV.sub(0.5).mul(vec2(this.uAspect.div(1.778).max(0.75), 1)).mul(2));
            display.mulAssign(float(1).sub(smoothstep(0.62, 1.75, radial).mul(this.uVignette)));
            const pixel = floor(screenCoordinate.xy);
            const grain = fract(sin(dot(pixel, vec2(12.9898, 78.233))).mul(43758.5453));
            display.addAssign(grain.sub(0.5).div(255));
            return vec4(clamp(display, 0, 1), 1);
        })();
    }

    _useShafts(enabled) {
        const want = Boolean(enabled && this.quality.shafts > 0);
        if (want === this.usesShafts) return;
        if (want && !this.shaftsNode) this.shaftsNode = this._createShafts();
        if (!this.outputs.has(want)) this.outputs.set(want, this._buildOutput(want));
        this.pipeline.outputNode = this.outputs.get(want);
        this.pipeline.needsUpdate = true;
        this.usesShafts = want;
    }

    /** Take a world's look. Only uniforms change, unless the world turns light shafts on or off. */
    setWorld(world) {
        const glow = { ...DEFAULT_BLOOM, ...world.bloom };
        this.bloomBase = glow.strength;
        this.bloomBreath = glow.breath;
        this.bloomNode.strength.value = glow.strength;
        this.bloomNode.radius.value = glow.radius;
        this.bloomNode.threshold.value = glow.threshold;
        this.uExposure.value = world.exposure ?? 1;
        const grade = { ...NEUTRAL_GRADE, ...world.grade };
        this.uShadowTint.value.setRGB(...grade.shadows);
        this.uHighlightTint.value.setRGB(...grade.highlights);
        this.uSaturation.value = grade.saturation;
        this.uContrast.value = grade.contrast;
        this.uVignette.value = grade.vignette;
        const shafts = world.shafts || null;
        this.shafts = shafts ? {
            strength: 1, threshold: 0.6, decay: 0.96, length: 0.85, tint: [1, 1, 1], breath: 0.5, region: null, radius: 10, ...shafts,
        } : null;
        if (this.shafts) {
            this.uShaftThreshold.value = this.shafts.threshold;
            // A world's decay is per step of a 32-step march: every tier fades over the same length.
            this.uShaftDecay.value = this.shafts.decay ** (32 / Math.max(this.quality.shafts, 1));
            this.uShaftLength.value = this.shafts.length;
            this.uShaftTint.value.setRGB(...this.shafts.tint);
            this.uShaftRadius.value = this.shafts.radius;
        }
        this._useShafts(Boolean(this.shafts));
    }

    /**
     * Per-frame lens state.
     * @param {{breath: number, light?: {x: number, y: number}|null, region?: number|null, aspect: number}} state
     *   `light` is the shafts' source in screen uv (y = 0 at the top); `region` the screen uv y
     *   below which nothing emits rays (null: everything may).
     */
    update({
        breath, light, region = null, aspect,
    }) {
        this.uAspect.value = aspect;
        this.bloomNode.strength.value = this.bloomBase * (1 + this.bloomBreath * breath);
        if (this.shafts && this.usesShafts) {
            if (light) this.uShaftCenter.value.set(light.x, light.y);
            this.uShaftRegion.value = region ?? 2;
            const swell = 1 - this.shafts.breath + this.shafts.breath * breath;
            this.uShaftStrength.value = this.shafts.strength * swell;
        }
    }

    render() { this.pipeline.render(); }

    dispose() {
        this.scenePass?.dispose();
        disposeBloomNodeDeep(this.bloomNode);
        this.shaftsFirst?.dispose();
        this.shaftsNode?.dispose();
        this.shaftsFirst = null;
        this.pipeline?.dispose();
        this.scenePass = null;
        this.bloomNode = null;
        this.shaftsNode = null;
        this.pipeline = null;
        this.outputs.clear();
    }
}
