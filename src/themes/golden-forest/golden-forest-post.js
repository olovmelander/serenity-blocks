/**
 * Golden Forest — the lens.
 *
 * Medium tiers and above grade the lake through a RenderPipeline: volumetric sun shafts
 * raymarched through the shores' real shadow map (three's GodraysNode), the sun's rays cut by
 * whatever stands between each pixel and the sun on screen (two short marches at quarter size:
 * the boughs round the sun comb its light into a fan), a hue-preserving bloom that lets the sun
 * and the fireflies glow without turning yellow, a filmic curve with deep umber shadows, and
 * smooth needle edges: 4× MSAA in the scene pass from High up (`samples`,
 * shared/scene-antialias.js; the lake's mirror matches it), FXAA on a single-sampled pass. Low
 * and Minimal draw the same scene directly with ACES tone mapping (the canvas's MSAA).
 *
 * The rays are also how the lake answers a cleared line: each line opens one shaft of the fan
 * (GOLDEN_FOREST_BEAM_SLOTS of them, `frame.beams`), four lines the whole sunburst (`frame.burst`).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, acesFilmicToneMapping, clamp, dot, exp, float, int, length, max, mix, pass, perspectiveDepthToViewZ,
    pow, renderOutput, rtt, saturate, screenUV, smoothstep, step, uniform, uniformArray, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { bilateralBlur } from 'three/addons/tsl/display/BilateralBlurNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { flashScale } from '../../utils/photosensitivity.js';
import { goldenForestTier } from './golden-forest-quality.js';
import { GOLDEN_FOREST_BEAM_SLOTS } from './golden-forest-reactions.js';

const BLOOM_STRENGTH = 0.22;
/** The sun's volumes at rest (per hundred metres of lit air), and their ceiling. */
const GODRAYS_DENSITY = 0.2;
const GODRAYS_MAX = 0.7;
// (The shafts of the fan cleared lines hold open are the director's: GOLDEN_FOREST_BEAM_SLOTS.)
/**
 * The rays: the march's steps toward the sun and the fill's steps between them, the targets'
 * share of the frame, how far from the sun's centre its light still counts as the lamp (screen
 * heights), and beyond what distance a pixel is open sky (metres: the dome is never written to
 * the depth buffer, the far ranges are).
 */
const RAYS = Object.freeze({
    steps: 20, refine: 6, scale: 0.25, lamp: 0.2, sky: 2400,
});

export class GoldenForestPost {
    constructor({
        renderer, scene, camera, quality = 'High', light = null, samples = 0,
    }) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.quality = quality;
        this.tier = goldenForestTier(quality);
        this.light = light;
        this.disabled = !this.tier.post;
        this.samples = this.disabled ? 0 : samples;
        this.useMRT = false;
        this.disposed = false;
        this.uAspect = uniform(16 / 9);
        // Resting exposure; events lift it a little from here.
        this.exposure = 1;
        // The sun's volumes at rest; play thickens them from here (update()).
        this.godraysDensity = GODRAYS_DENSITY;
        this.godraysMax = GODRAYS_MAX;
        this.uExposure = uniform(1.0);
        this.uShafts = uniform(1);
        // The grade's saturation: richer the hotter play runs.
        this.uSaturation = uniform(1.1);
        this.uSunScreen = uniform(new THREE.Vector2(0.26, 0.37));
        this.uNear = uniform(camera?.near ?? 0.3);
        this.uFar = uniform(camera?.far ?? 3400);
        // The fan of rays through the trees: its strength at rest (the air sets it), the whole
        // sunburst of a great clear, and the shafts single lines open (direction x, y on screen,
        // sharpness, strength).
        this.uRays = uniform(1);
        this.uBurst = uniform(0);
        this.uBeamCount = uniform(0, 'int');
        this.beamRows = Array.from({ length: GOLDEN_FOREST_BEAM_SLOTS }, () => new THREE.Vector4(1, 0, 40, 0));
        this.raysGain = 1;
        this.sunPoint = new THREE.Vector3();
        if (this.disabled) return;
        this.pipeline = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: this.samples });
        const sceneColor = this.scenePass.getTextureNode('output');
        const sceneDepth = this.scenePass.getTextureNode('depth');
        let lit = sceneColor.rgb;
        if (light && this.tier.godrays > 0) {
            if (!light.sun.shadow.map) this.buildShadowRig();
            this.godraysNode = godrays(sceneDepth, camera, light.sun);
            this.godraysNode.raymarchSteps.value = this.tier.godrays;
            // Density is per hundred metres of lit air; the shadow box here is hundreds of metres deep.
            this.godraysNode.density.value = GODRAYS_DENSITY;
            this.godraysNode.maxDensity.value = GODRAYS_MAX;
            this.godraysNode.distanceAttenuation.value = 0;
            this.godraysNode.resolutionScale = this.tier.godraysScale;
            // The blur ping-pongs its input texture, so hand it the pass texture itself.
            this.shaftsBlur = bilateralBlur(this.godraysNode.getTextureNode(), null, 3, 0.12);
            const centred = screenUV.sub(this.uSunScreen).mul(vec2(this.uAspect, 1));
            const toward = float(1).sub(saturate(length(centred).mul(0.78)));
            // The hour sets the shafts' colour away from the sun and toward it (golden-forest-moods.js).
            const shaftColour = mix(light.uShaftShade, light.uShaftSun, pow(toward, 2.1));
            // The shadow box ends about 300 m out, so the march counts everything beyond it as lit
            // air and laid a veil over the ridges and the sky. Past the far forest the shafts keep
            // only the glow round the sun; the haze and the dome carry the distance.
            const distance = perspectiveDepthToViewZ(sceneDepth, this.uNear, this.uFar).negate();
            const beyond = smoothstep(380, 620, distance);
            const keep = mix(float(1), toward.pow3().mul(0.62).add(0.1), beyond);
            lit = lit.add(shaftColour.mul(this.shaftsBlur.r).mul(this.uShafts).mul(keep));
            // The fan: where a pixel's line of sight to the sun is open, the air between is lit.
            this.raysNode = this.createRays(sceneDepth);
            lit = lit.add(this.fan(light));
        }
        this.bloomNode = bloom(sceneColor, BLOOM_STRENGTH, 0.62, 1.0);
        // Soft knee on the brightest channel, so a saturated sun keeps its hue in the bloom.
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
            // Split tone by scaling only: the shade leans to dusk violet so the gold has something to
            // stand against, and the highlights keep their gold.
            const shade = float(1).sub(smoothstep(0.02, 0.36, luma));
            const highlight = smoothstep(0.5, 0.95, luma);
            toned.mulAssign(mix(vec3(1), vec3(0.95, 0.94, 1.1), shade.mul(0.5)));
            toned.mulAssign(mix(vec3(1), vec3(1.03, 1.0, 0.93), highlight.mul(0.45)));
            toned.assign(mix(vec3(dot(toned, vec3(0.2126, 0.7152, 0.0722))), toned, this.uSaturation));
            const radius = length(screenUV.sub(0.5).mul(vec2(this.uAspect.div(1.778), 1)).mul(2));
            toned.mulAssign(float(1).sub(smoothstep(0.72, 1.7, radius).mul(0.24)));
            return renderOutput(vec4(clamp(toned, 0, 1), 1), THREE.NoToneMapping);
        })();
        // A multisampled pass is already smooth; FXAA over it would only soften the edges.
        this.pipeline.outputNode = this.samples > 0 ? graded : fxaa(graded);
    }

    /**
     * How open each pixel's line of sight to the sun is, in two short marches instead of one long
     * one (the Forest's recipe, forest-post.js). The first walks each pixel toward the sun on
     * screen and weighs what it crosses by the lamp's own glow there: open sky (the dome is not
     * in the depth buffer) or a bough, a trunk, a ridge. It returns the open share as a sum and
     * its weight (r / g), so the second can average them without bias: it walks the first's result
     * over one of its steps, filling between its samples: the smoothness of N × M taps from N + M
     * with no jitter and so no grain. Both at quarter size.
     */
    createRays(sceneDepth) {
        const gather = Fn(() => {
            const coord = uv().toVar();
            const stride = this.uSunScreen.sub(coord).div(RAYS.steps).toVar();
            const at = coord.toVar();
            const open = float(0).toVar();
            const total = float(0).toVar();
            Loop(RAYS.steps, () => {
                at.addAssign(stride);
                const away = at.sub(this.uSunScreen).mul(vec2(this.uAspect, 1));
                // The lamp: the sun's disc and the glow round it; a far step of the walk counts for little.
                const lamp = exp(dot(away, away).div(RAYS.lamp * RAYS.lamp).negate()).add(0.015);
                const range = perspectiveDepthToViewZ(sceneDepth.sample(at).r, this.uNear, this.uFar).negate();
                open.addAssign(step(RAYS.sky, range).mul(lamp));
                total.addAssign(lamp);
            });
            return vec4(open, total, 0, 1);
        })();
        this.raysFirst = rtt(gather, null, null, { resolutionScale: RAYS.scale, type: THREE.HalfFloatType });
        const fill = Fn(() => {
            const coord = uv().toVar();
            const stride = this.uSunScreen.sub(coord).div(RAYS.steps * RAYS.refine).toVar();
            const at = coord.toVar();
            const sum = vec2(0).toVar();
            Loop(RAYS.refine, () => {
                sum.addAssign(this.raysFirst.sample(at).rg);
                at.addAssign(stride);
            });
            return vec4(sum.div(RAYS.refine), 0, 1);
        })();
        return rtt(fill, null, null, { resolutionScale: RAYS.scale, type: THREE.HalfFloatType });
    }

    /**
     * The light the fan adds (TSL): the rays at rest, close round the sun; the shafts cleared
     * lines open, each a lobe about its own direction reaching across the frame; and the sunburst.
     * All of it is cut by the boughs between the pixel and the sun (the rays' open share), and
     * combed into finer rays by a noise read round the sun.
     */
    fan(light) {
        const beams = uniformArray(this.beamRows, 'vec4');
        return Fn(() => {
            const away = screenUV.sub(this.uSunScreen).mul(vec2(this.uAspect, 1)).toVar();
            const reach = length(away).toVar();
            const direction = away.div(max(reach, 1e-4)).toVar();
            const sight = this.raysNode.sample(screenUV).toVar();
            const open = sight.r.div(max(sight.g, 1e-4)).toVar();
            // Finer rays inside the fan, turning very slowly round the sun.
            const comb = light.noise(direction.mul(1.9).add(vec2(light.uTime.mul(0.006), light.uTime.mul(-0.004))))
                .toVar();
            const streaks = comb.g.mul(0.7).add(comb.b.mul(0.5)).toVar();
            // Not on the disc itself (it stays crisp), brightest a little way out, then falling away.
            const off = smoothstep(0.035, 0.11, reach).toVar();
            // The comb's crests: spokes with shade between them (the sunburst's, and fainter the fan's at rest).
            const spokes = pow(saturate(streaks.sub(0.28).mul(1.5)), 3).toVar();
            const rest = exp(reach.mul(-2.8)).mul(spokes.mul(0.85).add(streaks.mul(0.2)).add(0.06)).mul(this.uRays)
                .mul(0.3);
            const shafts = float(0).toVar();
            Loop({
                start: int(0), end: int(this.uBeamCount), type: 'int', condition: '<',
            }, ({ i }) => {
                const beam = beams.element(i); // direction x, y; sharpness; strength
                const lobe = exp(dot(direction, beam.xy).sub(1).mul(beam.z));
                shafts.addAssign(lobe.mul(beam.w));
            });
            // A shaft reaches across the frame; the trees round the sun cut it but never put it out.
            const far = exp(reach.mul(-0.85));
            const beamLight = shafts.mul(far).mul(streaks.mul(0.5).add(0.62)).mul(1.15).mul(open.mul(0.6).add(0.4));
            // The sunburst is spokes with shade between them, not a wash: only the comb's crests burn.
            const burst = spokes.mul(1.0).add(0.03).mul(exp(reach.mul(-1.6))).mul(this.uBurst)
                .mul(open.mul(0.85).add(0.15));
            const light3 = mix(light.uShaftSun, light.uSunColor.mul(0.34), 0.35);
            return light3.mul(rest.mul(open.mul(0.92).add(0.08)).add(beamLight).add(burst).mul(off));
        })();
    }

    /**
     * GodraysNode reads the sun's shadow map while its graph is built, so the shadow rig
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
     * One frame of the lens. The event envelopes lift exposure, bloom and the shafts for a moment:
     * frame-wide brightenings, so each goes through flashScale() (ADR-0021). How hot play runs
     * (`level`, `fever`) thickens the sun's volumes (GodraysNode density) and the colour, and
     * closes the iris a little so the gold stays saturated instead of washing pale. `frame.beams`
     * are the shafts cleared lines hold open ({ angle: their direction on screen, sharp, strength }),
     * `frame.burst` the sunburst, `frame.dusk` the evening after a game.
     */
    update(frame = {}) {
        const unit = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);
        const warmth = unit(frame.warmth);
        const shafts = unit(frame.shafts);
        const level = unit(frame.level);
        const fever = unit(frame.fever);
        const dusk = unit(frame.dusk);
        const gold = Number.isFinite(frame.gold) ? THREE.MathUtils.clamp(frame.gold, 0, 1.5) : 0;
        const flash = flashScale();
        // The hour asks a little more or less of the iris (golden-forest-moods.js), play adds to it.
        const hour = Number.isFinite(this.light?.exposureScale) ? this.light.exposureScale : 1;
        this.uExposure.value = (this.exposure * hour + warmth * 0.035 * flash
            - Math.max(0, level - 0.2) * 0.1 - fever * 0.05) * (1 - dusk * 0.2);
        if (this.camera?.isCamera) {
            this.uNear.value = this.camera.near;
            this.uFar.value = this.camera.far;
        }
        // The shafts' envelope now accumulates under fast play, so it lifts them less per unit.
        this.uShafts.value = 1 + shafts * 0.4 * flash;
        this.uSaturation.value = (1.1 + level * 0.1 + fever * 0.08) * (1 - dusk * 0.14);
        // The fan at rest is the air's (a mist stands the rays up, a clear evening thins them);
        // hot play combs it a little harder.
        const air = Number.isFinite(this.light?.air?.rays) ? this.light.air.rays : 1;
        this.uRays.value = (air + shafts * 0.6 * flash + fever * 0.35) * this.raysGain * (1 - dusk * 0.6);
        this.uBurst.value = unit(frame.burst) * flash * this.raysGain;
        // A shaft's direction is an angle clockwise from the right with the sun left of the frame's
        // middle (the landscape lens); with the sun on the right the fan is mirrored, so its long
        // diagonals still cross the open frame.
        const mirror = this.uSunScreen.value.x > 0.5 ? -1 : 1;
        const beams = Array.isArray(frame.beams) ? frame.beams : [];
        let count = 0;
        for (let i = 0; i < beams.length && count < GOLDEN_FOREST_BEAM_SLOTS; i += 1) {
            const beam = beams[i];
            const strength = unit(beam?.strength) * flash * this.raysGain;
            if (strength > 0.002 && Number.isFinite(beam.angle)) {
                this.beamRows[count].set(
                    Math.cos(beam.angle) * mirror,
                    Math.sin(beam.angle),
                    Number.isFinite(beam.sharp) && beam.sharp > 0 ? beam.sharp : 120,
                    strength,
                );
                count += 1;
            }
        }
        this.uBeamCount.value = count;
        if (this.bloomNode) this.bloomNode.strength.value = BLOOM_STRENGTH + warmth * 0.07 * flash;
        if (this.godraysNode) {
            // The sun pours in: its shafts thicken with the heat, the most in a fever, and a
            // back-to-back's gold floods them for its moment.
            this.godraysNode.density.value = this.godraysDensity + level * 0.05 + fever * 0.08 + gold * 0.05;
            this.godraysNode.maxDensity.value = this.godraysMax + level * 0.05 + fever * 0.08 + gold * 0.04;
        }
        if (this.light && this.camera?.isCamera) {
            // Screen position of the sun (uv, y down) for the shaft tint and the fan.
            const point = this.sunPoint.copy(this.camera.position)
                .addScaledVector(this.light.uSunDir.value, 500).project(this.camera);
            if (Number.isFinite(point.x) && Number.isFinite(point.y) && point.z < 1) {
                this.uSunScreen.value.set(point.x * 0.5 + 0.5, 0.5 - point.y * 0.5);
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
            beams: this.uBeamCount.value,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.scenePass?.dispose();
        this.godraysNode?.dispose();
        this.shaftsBlur?.dispose?.();
        this.raysNode?.dispose?.();
        this.raysFirst?.dispose?.();
        disposeBloomNodeDeep(this.bloomNode);
        this.pipeline?.dispose();
        this.scenePass = null;
        this.godraysNode = null;
        this.shaftsBlur = null;
        this.raysNode = null;
        this.raysFirst = null;
        this.bloomNode = null;
        this.pipeline = null;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.light = null;
    }
}
