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
/** How strong the rays are ever drawn (past 1, the open ones burn brighter; see the cut below). */
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
    length: 0.94,
    decay: 0.94,
    sky: [0.08, 0.32],
    scale: 0.25,
    refine: 6,
    shadowed: 0.06,
    open: 1.8,
    reach: 1.05,
    // How much further a full moonburst throws the cut (screen heights).
    burst: 1.1,
});
/** How much a full moonburst adds to the beams themselves, and how bright a ring of moonlight is drawn. */
const BURST_SHAFTS = 1.7;
const RING_GAIN = 0.3;
/**
 * A back-to-back's ring of moonlight: where it starts and how far it runs from the moon (screen
 * heights), how fast it eases out (per second), its width (a floor, and a share of its radius), how
 * fast it fades, the depth of air that carries it in full (metres) and the share a near surface keeps.
 */
const RING = Object.freeze({
    start: 0.07,
    reach: 1.9,
    rate: 0.55,
    width: 0.012,
    spread: 0.02,
    // How much longer the light trails inside the front than the front is wide.
    trail: 3.5,
    fade: 0.75,
    near: 5,
    far: 55,
    onNear: 0.16,
});

/**
 * How the beams are laid on: the light a line of sight gathers eases toward `ceiling` (the march
 * returns up to 0.86 for open sky), and over what is bright already (scene brightness from `from`
 * to `to`, linear) they ease to `onBright` of themselves.
 */
const BEAMS = Object.freeze({
    ceiling: 0.3, from: 0.25, to: 0.9, onBright: 0.35,
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
        // The moonburst (four lines, a perfect clear, a new level): the beams open wide, 0..1.5.
        this.uBurst = uniform(0);
        // A back-to-back's rings of moonlight through the mist: each one's radius from the moon
        // (in screen heights) and its strength now.
        this.uRingA = uniform(new THREE.Vector2(0, 0));
        this.uRingB = uniform(new THREE.Vector2(0, 0));
        this.moonPoint = new THREE.Vector3();
        if (this.disabled) return;
        this.pipeline = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: this.samples });
        const sceneColor = this.scenePass.getTextureNode('output');
        const sceneDepth = this.scenePass.getTextureNode('depth');
        let lit = sceneColor.rgb;
        // How far off the pixel's surface stands (metres): the beams and the rings are light in the air.
        const range = this.scenePass.getViewZNode().negate();
        const centred = screenUV.sub(this.uMoonScreen).mul(vec2(this.uAspect, 1));
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
                // (A moonburst throws them wide: the cut reaches out over the whole frame.) Hot play's
                // strength over 1 brightens the open rays; the blend's weight never passes 1, or it
                // extrapolates: past 1 a blocked line of sight's multiplier goes below nothing, and the
                // soft ceiling below turns a negative beam into a black hole in the sky.
                const reach = this.uBurst.mul(RAYS.burst).add(RAYS.reach);
                const near = exp(dot(centred, centred).div(reach.mul(reach)).negate()).mul(this.uRays.min(1));
                const lit2 = float(RAYS.open).mul(this.uRays.max(1));
                const cut = mix(float(RAYS.shadowed), lit2, smoothstep(0.12, 0.8, open));
                beams = beams.mul(mix(float(1), cut, near));
            }
            beams = beams.max(0);
            // The beams are light in the air, and read against the dark of the trees. A line of sight
            // out to the sky gathers hundreds of metres of lit air, and laid on in full that only
            // bleaches the sky and drowns the moon's face: the gathered light is given a soft ceiling
            // (the short path to a near tree is far under it and keeps what it has). A ceiling on the
            // march itself, not a cut by depth: an edge pixel of a multisampled pass has one depth
            // but a blend of colours, and a cut by depth left every far spruce a fringe of white sparks.
            beams = float(BEAMS.ceiling).mul(float(1).sub(exp(beams.div(BEAMS.ceiling).negate())));
            // (And what is brightest already, the moon's face and the mist it stands in, keeps a share.)
            const bright = smoothstep(BEAMS.from, BEAMS.to, dot(sceneColor.rgb, LUMA));
            beams = beams.mul(mix(float(1), float(BEAMS.onBright), bright));
            lit = lit.add(beamColour.mul(beams).mul(this.uShafts));
        }
        if (light) {
            // A back-to-back: rings of moonlight run out from the moon through the mist of the whole
            // wood. Light in the air again: full where there is depth of air to carry it, a share on
            // what stands near the eye, so the old trunk stays a silhouette the ring passes behind.
            const away = length(centred);
            const air = smoothstep(RING.near, RING.far, range).mul(1 - RING.onNear).add(RING.onNear);
            const band = (ring) => {
                const offset = away.sub(ring.x).div(ring.x.mul(RING.spread).add(RING.width));
                // A front with light trailing behind it: sharp where it leads, a long soft fall inside.
                const inside = offset.min(0).div(RING.trail);
                const outside = offset.max(0);
                const shape = exp(inside.mul(inside).add(outside.mul(outside)).negate());
                // Silver, its inner edge warm, as a ring of ice would be.
                const tint = mix(vec3(1.0, 0.82, 0.55), vec3(0.72, 0.88, 1.12), smoothstep(-2.5, 0.2, offset));
                return tint.mul(shape.mul(ring.y));
            };
            lit = lit.add(band(this.uRingA).add(band(this.uRingB)).mul(air));
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
        // The air's beams (wide in mist, thin in wind), and none through a clouded moon.
        const air = this.light?.air;
        const veil = unit(this.light?.uVeil?.value);
        const airRays = (Number.isFinite(air?.rays) ? Math.max(0, air.rays) : 1) * (1 - 0.9 * veil);
        // The moonbeams thin as the moon draws back in a fever (the rays stay cut sharp).
        // The moonburst: a frame-wide brightening too (flashScale), and nothing through cloud.
        const burst = (Number.isFinite(frame.burst) ? THREE.MathUtils.clamp(frame.burst, 0, 1.5) : 0)
            * flashScale() * (1 - 0.8 * veil);
        this.uBurst.value = burst;
        this.uShafts.value = (1.5 * airRays + (shafts * 0.9 * lift + burst * BURST_SHAFTS) * (1 - 0.6 * veil))
            * (1 - FOREST_MOON_FEVER * fever) * this.shaftGain;
        // A back-to-back's rings: each eases out from the moon and thins as it goes.
        const rings = Array.isArray(frame.rings) ? frame.rings : [];
        [this.uRingA, this.uRingB].forEach((ring, index) => {
            const cue = rings[index];
            const age = Number.isFinite(cue?.age) ? cue.age : -1;
            if (!(age >= 0) || !(cue.strength > 0)) {
                ring.value.set(0, 0);
                return;
            }
            const radius = RING.start + RING.reach * (1 - Math.exp(-age * RING.rate));
            const strength = Math.min(1.5, cue.strength) * Math.exp(-age * RING.fade) * Math.min(1, age / 0.1);
            ring.value.set(radius, strength * RING_GAIN);
        });
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
