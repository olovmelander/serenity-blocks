/**
 * Fall — the lens.
 *
 * Medium tiers and above grade the grove through a RenderPipeline: volumetric sun shafts
 * raymarched through the grove's real shadow map (three's GodraysNode), a restrained
 * hue-preserving bloom, a filmic curve with cool shadows, and FXAA for the leaf edges.
 * Low and Minimal draw the same scene directly with ACES tone mapping.
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
import { fallTier } from './fall-quality.js';

export class FallPost {
    constructor({
        renderer, scene, camera, quality = 'High', light = null,
    }) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.quality = quality;
        this.tier = fallTier(quality);
        this.light = light;
        this.disabled = !this.tier.post;
        this.useMRT = false;
        this.disposed = false;
        this.uAspect = uniform(16 / 9);
        this.uExposure = uniform(1.0);
        this.uShafts = uniform(1);
        this.uSunScreen = uniform(new THREE.Vector2(0.27, 0.45));
        this.sunPoint = new THREE.Vector3();
        if (this.disabled) return;
        this.pipeline = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: 0 });
        const sceneColor = this.scenePass.getTextureNode('output');
        const sceneDepth = this.scenePass.getTextureNode('depth');
        let lit = sceneColor.rgb;
        if (light && this.tier.godrays > 0) {
            // GodraysNode reads the sun's shadow map while its graph is built, so the
            // shadow rig must exist first: one direct render builds it.
            if (!light.sun.shadow.map) renderer.render(scene, camera);
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
            lit = lit.add(shaftColour.mul(this.shaftsBlur.r).mul(this.uShafts));
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
            const shade = float(1).sub(smoothstep(0.02, 0.4, luma));
            toned.mulAssign(mix(vec3(1), vec3(0.94, 1.0, 1.1), shade.mul(0.45)));
            toned.assign(mix(vec3(dot(toned, vec3(0.2126, 0.7152, 0.0722))), toned, 1.08));
            const radius = length(screenUV.sub(0.5).mul(vec2(this.uAspect.div(1.778), 1)).mul(2));
            toned.mulAssign(float(1).sub(smoothstep(0.7, 1.7, radius).mul(0.2)));
            return renderOutput(vec4(clamp(toned, 0, 1), 1), THREE.NoToneMapping);
        })();
        this.pipeline.outputNode = fxaa(graded);
    }

    update(frame = {}) {
        const warmth = Number.isFinite(frame.warmth) ? THREE.MathUtils.clamp(frame.warmth, 0, 1) : 0;
        const shafts = Number.isFinite(frame.shafts) ? THREE.MathUtils.clamp(frame.shafts, 0, 1) : 0;
        this.uExposure.value = 1.0 + warmth * 0.05;
        this.uShafts.value = 1 + shafts * 1.4;
        if (this.bloomNode) this.bloomNode.strength.value = 0.22 + warmth * 0.1;
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
