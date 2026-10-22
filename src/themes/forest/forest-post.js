/**
 * Forest — the lens.
 *
 * Medium tiers and above print the night through a RenderPipeline: volumetric moonbeams
 * raymarched through the old trees' real shadow map (three's GodraysNode) and cut into rays by
 * what stands between each pixel and the moon on screen (a short march), a hue-preserving
 * bloom that lets the moon and the fireflies glow without bleaching them, a filmic curve
 * with deep blue shadows, and smooth needle edges: 4× MSAA in the scene pass from High up
 * (`samples`, shared/scene-antialias.js), FXAA on a single-sampled pass. Low and Minimal draw
 * the same scene directly with ACES tone mapping (the canvas's own MSAA).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, acesFilmicToneMapping, clamp, dot, exp, float, length, max, mix, pass, pow, renderOutput, rtt,
    saturate, screenUV, smoothstep, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { bilateralBlur } from 'three/addons/tsl/display/BilateralBlurNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { flashScale } from '../../utils/photosensitivity.js';
import { FOREST_MOON_FEVER, FOREST_MOON_HOT } from './forest-light.js';
import { forestTier } from './forest-quality.js';

const BLOOM_STRENGTH = 0.3;
/** The iris closes from this level of play, by so much per unit of level and of fever. */
const IRIS = Object.freeze({ from: 0.2, level: 0.1, fever: 0.05 });
/** The rays' contrast is never pushed past this (beyond it a blocked line of sight goes black). */
const RAYS_MAX = 1.8;
const LUMA = vec3(0.2126, 0.7152, 0.0722);

/**
 * The rays: how far a march reaches toward the moon (share of the way), how much a nearer
 * step counts than a farther one, the scene brightness that counts as open sky (linear: the
 * boughs and trunks are under 0.1, the sky round the moon 0.3 to 1.3), the ray targets'
 * resolution, and how the beams answer: a line of sight blocked to the moon keeps 'shadowed'
 * of the haze, an open one 'open', within 'reach' screen heights of the moon (beyond it the
 * haze is left as it was).
 */
const RAYS = Object.freeze({
    length: 0.94, decay: 0.94, sky: [0.08, 0.32], scale: 0.25, refine: 6, shadowed: 0.3, open: 1.25, reach: 0.75,
});

export class ForestPost {
    constructor({
        renderer, scene, camera, quality = 'High', light = null, samples = 0,
    }) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.quality = quality;
        this.tier = forestTier(quality);
        this.light = light;
        this.disabled = !this.tier.post;
        this.samples = this.disabled ? 0 : samples;
        this.useMRT = false;
        this.disposed = false;
        this.uAspect = uniform(16 / 9);
        // Resting exposure; events lift it a little from here.
        this.exposure = 1;
        // How strong the moonbeams and the bloom are drawn (1 in play; the icon lens thins them).
        this.shaftGain = 1;
        this.bloomGain = 1;
        this.uExposure = uniform(1.0);
        this.uShafts = uniform(1.5);
        this.uMoonScreen = uniform(new THREE.Vector2(0.26, 0.18));
        // The crepuscular rays' strength (1 in play; events lift it with the beams).
        this.uRays = uniform(1);
        this.raysGain = 1;
        this.moonPoint = new THREE.Vector3();
        if (this.disabled) return;
        this.pipeline = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: this.samples });
        const sceneColor = this.scenePass.getTextureNode('output');
        const sceneDepth = this.scenePass.getTextureNode('depth');
        let lit = sceneColor.rgb;
        if (light && this.tier.godrays > 0) {
            if (!light.moon.shadow.map) this.buildShadowRig();
            this.godraysNode = godrays(sceneDepth, camera, light.moon);
            this.godraysNode.raymarchSteps.value = this.tier.godrays;
            // Density is per hundred metres of lit air; the shadow box here is hundreds of metres deep.
            this.godraysNode.density.value = 0.5;
            this.godraysNode.maxDensity.value = 0.86;
            this.godraysNode.distanceAttenuation.value = 0;
            this.godraysNode.resolutionScale = this.tier.godraysScale;
            // The blur ping-pongs its input texture, so hand it the pass texture itself.
            this.shaftsBlur = bilateralBlur(this.godraysNode.getTextureNode(), null, 3, 0.12);
            const centred = screenUV.sub(this.uMoonScreen).mul(vec2(this.uAspect, 1));
            const toward = float(1).sub(saturate(length(centred).mul(0.74)));
            // Brightest in a wide ring round the moon, eased off over the disc itself so it stays crisp.
            const clear = smoothstep(0.02, 0.17, length(centred)).mul(0.5).add(0.5);
            const beamColour = mix(light.uBeamCool, light.uBeamMoon, pow(toward, 2.2)).mul(clear);
            let beams = this.shaftsBlur.r;
            if (this.tier.rays > 0) {
                // Cut the moonlit air into rays: bright where the line to the moon is open,
                // dim where a bough or a trunk stands in it, near the moon only.
                this.raysNode = this.createRays(sceneColor, this.tier.rays);
                const sight = this.raysNode.sample(screenUV);
                const open = sight.r.div(max(sight.g, 1e-4));
                const near = exp(dot(centred, centred).div(RAYS.reach * RAYS.reach).negate()).mul(this.uRays);
                beams = beams.mul(mix(float(1), mix(float(RAYS.shadowed), float(RAYS.open), open), near));
            }
            lit = lit.add(beamColour.mul(beams).mul(this.uShafts));
        }
        this.bloomNode = bloom(sceneColor, BLOOM_STRENGTH, 0.6, 0.86);
        // Soft knee on the brightest channel, so a firefly keeps its green in the bloom.
        this.bloomNode.highPassFn = Fn(({ input, threshold, smoothWidth }) => {
            const texel = max(input.rgb, vec3(0));
            const peak = max(max(texel.r, texel.g), texel.b);
            const knee = smoothstep(threshold, threshold.add(smoothWidth).add(0.6), peak);
            const limit = float(7).div(max(peak, 7));
            return vec4(texel.mul(knee).mul(limit), 1);
        });
        this.bloomNode.setResolutionScale(this.tier.bloomScale);
        this.pipeline.outputColorTransform = false;
        const graded = Fn(() => {
            const toned = acesFilmicToneMapping(lit.add(this.bloomNode.rgb).max(0), this.uExposure).toVar();
            const luma = dot(toned, vec3(0.2126, 0.7152, 0.0722));
            // Shadows lean the way the hour leans (toward deep blue in deep night), so the
            // fireflies have something to burn against.
            const shade = float(1).sub(smoothstep(0.02, 0.34, luma));
            toned.mulAssign(mix(vec3(1), light ? light.uShade : vec3(0.9, 1.0, 1.14), shade.mul(0.55)));
            toned.assign(mix(vec3(dot(toned, vec3(0.2126, 0.7152, 0.0722))), toned, 1.1));
            const radius = length(screenUV.sub(0.5).mul(vec2(this.uAspect.div(1.778), 1)).mul(2));
            toned.mulAssign(float(1).sub(smoothstep(0.7, 1.7, radius).mul(0.3)));
            return renderOutput(vec4(clamp(toned, 0, 1), 1), THREE.NoToneMapping);
        })();
        // A multisampled pass is already smooth; FXAA over it would only soften the needles.
        this.pipeline.outputNode = this.samples > 0 ? graded : fxaa(graded);
    }

    /**
     * How open each pixel's line of sight to the moon is, in two short marches instead of one
     * long one (the breathing stage's recipe, ui/effects/breathing/stage/breath-post.js). The
     * first walks each pixel toward the moon on screen and weighs what it crosses: open sky
     * (bright) or a bough or trunk (dark), nearer steps counting more. It returns the open share
     * as a sum and its weight (r / g), so the second can average them without bias: it walks the
     * first's result over one of its steps, filling between its samples, the smoothness of
     * N × M taps from N + M with no jitter and so no grain. Both at quarter size.
     */
    createRays(sceneColor, count) {
        const gather = Fn(() => {
            const coord = uv().toVar();
            const stride = this.uMoonScreen.sub(coord).mul(RAYS.length).div(count).toVar();
            const at = coord.toVar();
            const open = float(0).toVar();
            const total = float(0).toVar();
            const weight = float(1).toVar();
            Loop(count, () => {
                at.addAssign(stride);
                const lum = dot(sceneColor.sample(at).rgb, LUMA);
                open.addAssign(smoothstep(RAYS.sky[0], RAYS.sky[1], lum).mul(weight));
                total.addAssign(weight);
                weight.mulAssign(RAYS.decay);
            });
            return vec4(open, total, 0, 1);
        })();
        this.raysFirst = rtt(gather, null, null, { resolutionScale: RAYS.scale });
        const fill = Fn(() => {
            const coord = uv().toVar();
            const stride = this.uMoonScreen.sub(coord).mul(RAYS.length).div(count * RAYS.refine).toVar();
            const at = coord.toVar();
            const sum = vec2(0).toVar();
            Loop(RAYS.refine, () => {
                sum.addAssign(this.raysFirst.sample(at).rg);
                at.addAssign(stride);
            });
            return vec4(sum.div(RAYS.refine), 0, 1);
        })();
        return rtt(fill, null, null, { resolutionScale: RAYS.scale });
    }

    /**
     * GodraysNode reads the moon's shadow map while its graph is built, so the shadow rig
     * must exist first, and one render of the scene builds it. That render goes to a target
     * shaped like the scene pass's own, so the pipelines it compiles are the ones the pass
     * will use, not a second set for the canvas.
     */
    buildShadowRig() {
        const { renderer, scene, camera } = this;
        if (typeof renderer.setRenderTarget !== 'function') {
            renderer.render(scene, camera);
            return;
        }
        const target = new THREE.RenderTarget(4, 4, { type: THREE.HalfFloatType, samples: this.samples });
        target.depthTexture = new THREE.DepthTexture(4, 4);
        const previous = renderer.getRenderTarget?.() ?? null;
        try {
            renderer.setRenderTarget(target);
            renderer.render(scene, camera);
        } finally {
            renderer.setRenderTarget(previous);
            target.dispose();
        }
    }

    /**
     * One frame of the lens. The event envelopes lift the exposure, the bloom and the beams for a
     * moment: frame-wide brightenings, so each goes through flashScale() (ADR-0021), and lift less
     * the hotter play runs (as the moon does, FOREST_MOON_HOT). How hot play runs (`frame.surge`:
     * level, fever) cuts the moonbeams into sharper rays and closes the iris a little, so the
     * forest keeps its darks while the fireflies pour light.
     */
    update(frame = {}) {
        const unit = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);
        const moon = unit(frame.moon);
        const shafts = unit(frame.shafts);
        const level = unit(frame.surge?.level);
        const fever = unit(frame.surge?.fever);
        const lift = flashScale() * (1 - FOREST_MOON_HOT * level);
        this.uExposure.value = this.exposure + moon * 0.06 * lift - Math.max(0, level - IRIS.from) * IRIS.level
            - fever * IRIS.fever;
        // The moonbeams thin as the moon draws back in a fever (the rays stay cut sharp).
        this.uShafts.value = (1.5 + shafts * 0.9 * lift) * (1 - FOREST_MOON_FEVER * fever) * this.shaftGain;
        this.uRays.value = Math.min(RAYS_MAX, 1 + shafts * 0.8 * lift + fever * 0.4) * this.raysGain;
        if (this.bloomNode) this.bloomNode.strength.value = (BLOOM_STRENGTH + moon * 0.08 * lift) * this.bloomGain;
        if (this.light && this.camera?.isCamera) {
            // Screen position of the moon (uv, y down) for the beam tint.
            const point = this.moonPoint.copy(this.camera.position)
                .addScaledVector(this.light.uMoonDir.value, 500).project(this.camera);
            if (Number.isFinite(point.x) && Number.isFinite(point.y) && point.z < 1) {
                this.uMoonScreen.value.set(point.x * 0.5 + 0.5, 0.5 - point.y * 0.5);
            }
        }
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

    getDiagnostics() {
        return {
            quality: this.quality,
            disabled: this.disabled,
            useMRT: false,
            godrays: Boolean(this.godraysNode),
            rays: Boolean(this.raysNode),
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.scenePass?.dispose();
        this.godraysNode?.dispose();
        this.shaftsBlur?.dispose?.();
        this.raysFirst?.dispose?.();
        this.raysNode?.dispose?.();
        disposeBloomNodeDeep(this.bloomNode);
        this.pipeline?.dispose();
        this.scenePass = null;
        this.godraysNode = null;
        this.shaftsBlur = null;
        this.raysFirst = null;
        this.raysNode = null;
        this.bloomNode = null;
        this.pipeline = null;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.light = null;
    }
}
