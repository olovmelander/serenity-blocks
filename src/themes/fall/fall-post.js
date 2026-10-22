/**
 * Fall — the lens.
 *
 * Medium tiers and above grade the grove through a RenderPipeline: volumetric sun shafts
 * raymarched through the grove's real shadow map (three's GodraysNode), a restrained
 * hue-preserving bloom, a filmic curve with cool shadows, and smooth leaf edges: 4× MSAA in
 * the scene pass from High up (`samples`, shared/scene-antialias.js), FXAA on a single-sampled
 * pass. Low and Minimal draw the same scene directly with ACES tone mapping (the canvas's MSAA).
 *
 * As play heats the shafts stand in the air between the trees (never over the sky, which keeps
 * its resting veil), each event's lift of the lens shrinks, and the iris closes a little so the
 * late gold stays saturated and the darks stay dark. A perfect clear's sunburst is the one
 * frame-wide brightening, so it goes through flashScale() (Reduce flashing, ADR-0021).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, acesFilmicToneMapping, clamp, dot, float, length, max, mix, pass, perspectiveDepthToViewZ, pow, renderOutput,
    saturate, screenUV, smoothstep, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { bilateralBlur } from 'three/addons/tsl/display/BilateralBlurNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { flashScale } from '../../utils/photosensitivity.js';
import { fallTier } from './fall-quality.js';

/** How far the iris closes at a full ripening of the light (exposure). */
const POST_IRIS = 0.075;
/** The share of the ripened light that stands in the shafts. */
const POST_SHAFT_FLOOR = 0.55;
/** A perfect clear's sunburst at its height: a lift of the exposure and of the shafts' gain. */
const POST_CROWN = Object.freeze({ exposure: 0.05, shafts: 0.7 });

export class FallPost {
    constructor({
        renderer, scene, camera, quality = 'High', light = null, samples = 0,
    }) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.quality = quality;
        this.tier = fallTier(quality);
        this.light = light;
        this.disabled = !this.tier.post;
        this.samples = this.disabled ? 0 : samples;
        this.useMRT = false;
        this.disposed = false;
        this.uAspect = uniform(16 / 9);
        this.uExposure = uniform(1.0);
        this.uShafts = uniform(1);
        this.uSunScreen = uniform(new THREE.Vector2(0.27, 0.45));
        this.uNear = uniform(camera?.near ?? 0.3);
        this.uFar = uniform(camera?.far ?? 600);
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
            this.godraysNode.density.value = 0.8;
            this.godraysNode.maxDensity.value = 0.8;
            this.godraysNode.distanceAttenuation.value = 0;
            this.godraysNode.resolutionScale = this.tier.godraysScale;
            // The blur ping-pongs its input texture, so hand it the pass texture itself.
            this.shaftsBlur = bilateralBlur(this.godraysNode.getTextureNode(), null, 3, 0.12);
            const centred = screenUV.sub(this.uSunScreen).mul(vec2(this.uAspect, 1));
            const toward = float(1).sub(saturate(length(centred).mul(0.62)));
            const shaftColour = mix(vec3(0.3, 0.22, 0.15), vec3(1.5, 0.84, 0.33), pow(toward, 1.4));
            // Toward the sky dome the march integrates hundreds of metres of lit air and veils the
            // whole sky a milky lavender. The dome already holds its own air, so beyond the last
            // ridge (about 250 m) the shafts keep only the glow round the sun.
            const distance = perspectiveDepthToViewZ(sceneDepth, this.uNear, this.uFar).negate();
            const skyward = smoothstep(280, 390, distance);
            const keep = mix(float(1), toward.pow2().pow2().mul(0.45).add(0.06), skyward);
            // The gain play adds stands in the air among the trees; the sky keeps its resting veil.
            const gain = mix(this.uShafts, float(1), skyward);
            lit = lit.add(shaftColour.mul(this.shaftsBlur.r).mul(gain).mul(keep));
        }
        this.bloomNode = bloom(sceneColor, 0.22, 0.6, 1.05);
        // Soft knee on the brightest channel, so a saturated sun keeps its hue in the bloom.
        this.bloomNode.highPassFn = Fn(({ input, threshold, smoothWidth }) => {
            const texel = max(input.rgb, vec3(0));
            const peak = max(max(texel.r, texel.g), texel.b);
            const knee = smoothstep(threshold, threshold.add(smoothWidth).add(0.6), peak);
            const limit = float(6).div(max(peak, 6));
            return vec4(texel.mul(knee).mul(limit), 1);
        });
        this.bloomNode.setResolutionScale(this.tier.bloomScale);
        this.pipeline.outputColorTransform = false;
        const graded = Fn(() => {
            const toned = acesFilmicToneMapping(lit.add(this.bloomNode.rgb).max(0), this.uExposure).toVar();
            const luma = dot(toned, vec3(0.2126, 0.7152, 0.0722));
            // Split tone by scaling only: cool shade under the warm sun, a touch of gold in the
            // highlights (an added constant would lift every black into a veil).
            const shade = float(1).sub(smoothstep(0.02, 0.4, luma));
            const highlight = smoothstep(0.5, 0.95, luma);
            toned.mulAssign(mix(vec3(1), vec3(0.9, 0.98, 1.14), shade.mul(0.55)));
            toned.mulAssign(mix(vec3(1), vec3(1.03, 1.0, 0.94), highlight.mul(0.5)));
            toned.assign(mix(vec3(dot(toned, vec3(0.2126, 0.7152, 0.0722))), toned, 1.08));
            const radius = length(screenUV.sub(0.5).mul(vec2(this.uAspect.div(1.778), 1)).mul(2));
            toned.mulAssign(float(1).sub(smoothstep(0.7, 1.7, radius).mul(0.2)));
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

    update(frame = {}) {
        const unit = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);
        const warmth = unit(frame.warmth);
        const shafts = unit(frame.shafts);
        const level = unit(frame.surge?.level);
        const fever = unit(frame.surge?.fever);
        const ripen = unit(frame.ripen);
        const crown = (Number.isFinite(frame.crown) ? THREE.MathUtils.clamp(frame.crown, 0, 1.2) : 0) * flashScale();
        // Each event lifts the lens less the hotter play runs; the iris closes as the light ripens.
        this.uExposure.value = 1.0 + warmth * 0.05 * (1 - 0.5 * level) + crown * POST_CROWN.exposure
            - ripen * POST_IRIS;
        // The shafts hold while the action lasts: the ripened light is a floor under the events'.
        this.uShafts.value = 1 + Math.min(1, shafts + ripen * POST_SHAFT_FLOOR) * 1.4 + crown * POST_CROWN.shafts;
        if (this.bloomNode) {
            this.bloomNode.strength.value = 0.22 + warmth * 0.1 * (1 - 0.4 * level) + fever * 0.03;
        }
        if (this.camera?.isCamera) {
            this.uNear.value = this.camera.near;
            this.uFar.value = this.camera.far;
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
