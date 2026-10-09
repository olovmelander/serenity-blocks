/**
 * Forest — the lens.
 *
 * Medium tiers and above print the night through a RenderPipeline: volumetric moonbeams
 * raymarched through the old trees' real shadow map (three's GodraysNode), a hue-preserving
 * bloom that lets the moon and the fireflies glow without bleaching them, a filmic curve
 * with deep blue shadows, and FXAA for the needle edges. Low and Minimal draw the same
 * scene directly with ACES tone mapping.
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
import { forestTier } from './forest-quality.js';

const BLOOM_STRENGTH = 0.3;

export class ForestPost {
    constructor({
        renderer, scene, camera, quality = 'High', light = null,
    }) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.quality = quality;
        this.tier = forestTier(quality);
        this.light = light;
        this.disabled = !this.tier.post;
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
        this.moonPoint = new THREE.Vector3();
        if (this.disabled) return;
        this.pipeline = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: 0 });
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
            lit = lit.add(beamColour.mul(this.shaftsBlur.r).mul(this.uShafts));
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
        this.pipeline.outputNode = fxaa(graded);
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
        const target = new THREE.RenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 0 });
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
        const moon = Number.isFinite(frame.moon) ? THREE.MathUtils.clamp(frame.moon, 0, 1) : 0;
        const shafts = Number.isFinite(frame.shafts) ? THREE.MathUtils.clamp(frame.shafts, 0, 1) : 0;
        this.uExposure.value = this.exposure + moon * 0.06;
        this.uShafts.value = (1.5 + shafts * 0.9) * this.shaftGain;
        if (this.bloomNode) this.bloomNode.strength.value = (BLOOM_STRENGTH + moon * 0.08) * this.bloomGain;
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
