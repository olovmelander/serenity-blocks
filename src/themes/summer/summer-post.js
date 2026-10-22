/**
 * Summer — the lens.
 *
 * Medium tiers and above grade the meadow through a RenderPipeline: volumetric sun shafts
 * raymarched through the real shadow map (three's GodraysNode), so the birch and the
 * maypole cut their own beams out of the evening air; a hue-preserving bloom that lets the
 * sun, the glitter on the lake and backlit petals glow without washing out; a filmic curve
 * that keeps the greens fresh and the shadows cool; and smooth grass and birch edges: 4× MSAA
 * in the scene pass from High up (`samples`, shared/scene-antialias.js; the lake's mirror
 * matches it), FXAA on a single-sampled pass. Low and Minimal draw the same scene directly
 * with ACES tone mapping (the canvas's MSAA).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, acesFilmicToneMapping, clamp, dot, float, length, max, mix, pass, pow, renderOutput, saturate, screenUV,
    smoothstep, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { bilateralBlur } from 'three/addons/tsl/display/BilateralBlurNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { flashScale } from '../../utils/photosensitivity.js';
import { summerTier } from './summer-quality.js';

const BLOOM_STRENGTH = 0.2;
/** The sun's volumes at rest (per hundred metres of lit air), and their ceiling. */
const GODRAYS_DENSITY = 0.08;
const GODRAYS_MAX = 0.34;
/** The grade's saturation at rest; play richens it (update()). */
const SATURATION = 1.14;

export class SummerPost {
    constructor({
        renderer, scene, camera, quality = 'High', light = null, samples = 0,
    }) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.quality = quality;
        this.tier = summerTier(quality);
        this.light = light;
        this.disabled = !this.tier.post;
        this.samples = this.disabled ? 0 : samples;
        this.useMRT = false;
        this.disposed = false;
        this.uAspect = uniform(16 / 9);
        // Resting exposure; events lift it a little from here.
        this.exposure = 0.8;
        this.uExposure = uniform(0.8);
        this.uShafts = uniform(1);
        this.uSaturation = uniform(SATURATION);
        this.uSunScreen = uniform(new THREE.Vector2(0.35, 0.3));
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
            const toward = float(1).sub(saturate(length(centred).mul(0.8)));
            // Lit air is gold toward the sun and the faint blue of haze away from it (in the
            // evening; the hour of the night sets both).
            const shaftColour = mix(light.uShaftCool, light.uShaftWarm, pow(toward, 2.1));
            lit = lit.add(shaftColour.mul(this.shaftsBlur.r).mul(this.uShafts));
        }
        this.bloomNode = bloom(sceneColor, BLOOM_STRENGTH, 0.6, 1.0);
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
            // Shadows lean a little toward blue, so the warm light has something to stand against.
            const shade = float(1).sub(smoothstep(0.02, 0.4, luma));
            toned.mulAssign(mix(vec3(1), vec3(0.95, 0.99, 1.06), shade.mul(0.5)));
            toned.assign(mix(vec3(dot(toned, vec3(0.2126, 0.7152, 0.0722))), toned, this.uSaturation));
            const radius = length(screenUV.sub(0.5).mul(vec2(this.uAspect.div(1.778), 1)).mul(2));
            toned.mulAssign(float(1).sub(smoothstep(0.78, 1.75, radius).mul(0.2)));
            return renderOutput(vec4(clamp(toned, 0, 1), 1), THREE.NoToneMapping);
        })();
        // A multisampled pass is already smooth; FXAA over it would only soften the edges.
        this.pipeline.outputNode = this.samples > 0 ? graded : fxaa(graded);
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
     * One frame of the lens. The event envelopes lift exposure, bloom and the shafts for a moment,
     * and a sunburst (a quad, a back-to-back, the perfect clear's crown) floods the shafts:
     * frame-wide brightenings, so each goes through flashScale() (ADR-0021). How hot play runs
     * (`surge`: level, fever) thickens the sun's volumes and richens the colour, and closes the
     * iris a little, so the gold of a fever stays saturated instead of washing pale.
     */
    update(frame = {}) {
        const unit = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);
        const warmth = unit(frame.warmth);
        const shafts = unit(frame.shafts);
        const surge = frame.surge && typeof frame.surge === 'object' ? frame.surge : null;
        const level = unit(surge?.level);
        const fever = unit(surge?.fever);
        const sunburst = unit(frame.sunburst);
        const flash = flashScale();
        this.uExposure.value = this.exposure * (this.light?.hour?.exposure ?? 1) + warmth * 0.04 * flash
            - Math.max(0, level - 0.25) * 0.08 - fever * 0.05;
        // The shafts' floor rises with play; the sunburst floods them for its moment.
        const lit = shafts + (1 - shafts) * (level * 0.2 + fever * 0.35);
        this.uShafts.value = 1 + (lit * 0.6 + sunburst * 0.55) * flash;
        this.uSaturation.value = SATURATION + level * 0.05 + fever * 0.07;
        if (this.bloomNode) this.bloomNode.strength.value = BLOOM_STRENGTH + warmth * 0.07 * flash;
        if (this.godraysNode) {
            // The sun pours in: its shafts thicken with the heat, the most in a fever.
            this.godraysNode.density.value = GODRAYS_DENSITY + level * 0.02 + fever * 0.05 + sunburst * 0.03 * flash;
            this.godraysNode.maxDensity.value = GODRAYS_MAX + level * 0.05 + fever * 0.14 + sunburst * 0.08 * flash;
        }
        if (this.light && this.camera?.isCamera) {
            // Screen position of the sun (uv, y down) for the shaft tint.
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
            quality: this.quality, disabled: this.disabled, useMRT: false, godrays: Boolean(this.godraysNode),
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.scenePass?.dispose();
        this.godraysNode?.dispose();
        this.shaftsBlur?.dispose?.();
        disposeBloomNodeDeep(this.bloomNode);
        this.pipeline?.dispose();
        this.scenePass = null;
        this.godraysNode = null;
        this.shaftsBlur = null;
        this.bloomNode = null;
        this.pipeline = null;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.light = null;
    }
}
