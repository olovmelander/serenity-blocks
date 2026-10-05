/**
 * Sakura Twilight — the lens.
 *
 * Medium tiers and above grade the garden through a RenderPipeline: moonbeams raymarched
 * through the garden's real shadow map (three's GodraysNode), a hue-preserving bloom for
 * the lanterns, the moon and lit blossom, a filmic curve that keeps the shadows violet,
 * and FXAA for the petal edges. Low and Minimal draw the same scene directly with ACES.
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
import { sakuraTier } from './sakura-quality.js';

const LUMA = vec3(0.2126, 0.7152, 0.0722);

export class SakuraPost {
    constructor({
        renderer, scene, camera, quality = 'High', light = null, prime = null,
    }) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.quality = quality;
        this.tier = sakuraTier(quality);
        this.light = light;
        this.disabled = !this.tier.post;
        this.useMRT = false;
        this.disposed = false;
        this.uAspect = uniform(16 / 9);
        this.uExposure = uniform(1.0);
        this.uBeams = uniform(1);
        this.uSpirit = uniform(0);
        this.uMoonScreen = uniform(new THREE.Vector2(0.8, 0.2));
        this.moonPoint = new THREE.Vector3();
        if (this.disabled) return;
        this.pipeline = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: 0 });
        const sceneColor = this.scenePass.getTextureNode('output');
        const sceneDepth = this.scenePass.getTextureNode('depth');
        let lit = sceneColor.rgb;
        if (light && this.tier.godrays > 0) {
            // GodraysNode reads the moon's shadow map while its graph is built, so the
            // shadow rig must exist first: one direct render builds it. `prime` lets the
            // owner do that with a single object instead of compiling the whole garden a
            // second time for the canvas.
            if (!light.moon.shadow.map) {
                if (prime) prime();
                else renderer.render(scene, camera);
            }
            this.godraysNode = godrays(sceneDepth, camera, light.moon);
            this.godraysNode.raymarchSteps.value = this.tier.godrays;
            this.godraysNode.density.value = 0.7;
            this.godraysNode.maxDensity.value = 0.7;
            this.godraysNode.distanceAttenuation.value = 0;
            this.godraysNode.resolutionScale = this.tier.godraysScale;
            // The blur ping-pongs its input texture, so hand it the pass texture itself.
            this.beamsBlur = bilateralBlur(this.godraysNode.getTextureNode(), null, 3, 0.12);
            const centred = screenUV.sub(this.uMoonScreen).mul(vec2(this.uAspect, 1));
            const toward = float(1).sub(saturate(length(centred).mul(0.7)));
            const beamColour = mix(vec3(0.008, 0.01, 0.024), vec3(0.11, 0.15, 0.26), pow(toward, 1.6));
            lit = lit.add(beamColour.mul(this.beamsBlur.r).mul(this.uBeams));
        }
        this.bloomNode = bloom(sceneColor, 0.3, 0.7, 0.9);
        // Soft knee on the brightest channel, so a lantern keeps its amber in the bloom.
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
            const luma = dot(toned, LUMA);
            // Night is violet, not grey: lift the deep shadows toward indigo and let the
            // lit pinks and ambers keep their saturation.
            const shade = float(1).sub(smoothstep(0.0, 0.32, luma));
            toned.addAssign(vec3(0.012, 0.008, 0.03).mul(shade));
            toned.mulAssign(mix(vec3(1), vec3(0.95, 0.94, 1.12), shade.mul(0.5)));
            toned.assign(mix(vec3(dot(toned, LUMA)), toned, this.uSpirit.mul(0.12).add(1.12)));
            const radius = length(screenUV.sub(0.5).mul(vec2(this.uAspect.div(1.778), 1)).mul(2));
            toned.mulAssign(float(1).sub(smoothstep(0.75, 1.75, radius).mul(0.26)));
            return renderOutput(vec4(clamp(toned, 0, 1), 1), THREE.NoToneMapping);
        })();
        this.pipeline.outputNode = fxaa(graded);
    }

    update(frame = {}) {
        const clamp01 = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);
        const glow = clamp01(frame.glow);
        this.uExposure.value = 1.0 + glow * 0.06;
        this.uBeams.value = 1 + clamp01(frame.moon) * 1.5;
        this.uSpirit.value = clamp01(frame.spirit);
        if (this.bloomNode) this.bloomNode.strength.value = 0.3 + glow * 0.16;
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
        this.beamsBlur?.dispose?.();
        disposeBloomNodeDeep(this.bloomNode);
        this.pipeline?.dispose();
        this.scenePass = null;
        this.godraysNode = null;
        this.beamsBlur = null;
        this.bloomNode = null;
        this.pipeline = null;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.light = null;
    }
}
