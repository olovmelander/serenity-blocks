/**
 * Verdant Hills — the lens.
 *
 * Before each frame the lens has the sky march its clouds (see verdant-hills-sky.js). Medium
 * tiers and above then grade the hills through a RenderPipeline: the light that falls
 * between the clouds is marched through the same cloud field that shades the ground, so
 * the valley's air is bright under a gap and blue under a cloud, and the two stand beside
 * each other as shafts; a hue-preserving bloom lets the clouds' silver edges and the
 * sunlit grass glow without washing out; a filmic curve keeps the greens fresh; FXAA
 * settles the grass. Low and Minimal draw the same scene directly with ACES tone mapping.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, acesFilmicToneMapping, clamp, dot, exp, float, interleavedGradientNoise, length, max, min, mix,
    normalize, pass, perspectiveDepthToViewZ, pow, renderOutput, rtt, saturate, screenCoordinate, screenUV,
    smoothstep, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { verdantHillsTier } from './verdant-hills-quality.js';

const BLOOM_STRENGTH = 0.18;
/** How far the light between the clouds is followed, metres. */
const SHAFT_RANGE = 9000;
/** How brightly the shaft of the game's own gap in the clouds stands in the air. */
const BEAM_GAIN = 7;

export class VerdantHillsPost {
    constructor({
        renderer, scene, camera, quality = 'High', light = null,
    }) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.quality = quality;
        this.tier = verdantHillsTier(quality);
        this.light = light;
        this.disabled = !this.tier.post;
        this.useMRT = false;
        this.disposed = false;
        this.uAspect = uniform(16 / 9);
        // Resting exposure; events lift it a little from here.
        this.exposure = 0.82;
        this.uExposure = uniform(0.82);
        this.uShafts = uniform(1);
        // The camera's basis, scaled so that `forward + right·x + up·y` is the ray through a pixel.
        this.uEye = uniform(new THREE.Vector3());
        this.uForward = uniform(new THREE.Vector3(0, 0, -1));
        this.uRight = uniform(new THREE.Vector3(1, 0, 0));
        this.uUp = uniform(new THREE.Vector3(0, 1, 0));
        this.uNear = uniform(0.3);
        this.uFar = uniform(30000);
        this.uShaftTexel = uniform(new THREE.Vector2(1 / 640, 1 / 360));
        this.drawing = new THREE.Vector2();
        if (this.disabled) return;
        this.pipeline = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: 0 });
        const sceneColor = this.scenePass.getTextureNode('output');
        const sceneDepth = this.scenePass.getTextureNode('depth');
        let lit = sceneColor.rgb;
        if (light && this.tier.shafts > 0) {
            this.shaftsNode = rtt(this.buildShafts(sceneDepth), null, null, {
                resolutionScale: this.tier.shaftsScale,
            });
            this.shaftsNode.renderTarget.texture.name = 'Verdant Hills — light between the clouds';
            // Four taps a half-texel apart: a tent that takes the march's grain out.
            const tap = (x, y) => this.shaftsNode.sample(screenUV.add(this.uShaftTexel.mul(vec2(x, y))));
            const shafts = tap(-0.5, -0.5).add(tap(0.5, -0.5)).add(tap(-0.5, 0.5)).add(tap(0.5, 0.5))
                .mul(0.25);
            lit = lit.add(shafts.rgb.mul(this.uShafts));
        }
        this.bloomNode = bloom(sceneColor, BLOOM_STRENGTH, 0.6, 1.0);
        // Soft knee on the brightest channel, so a saturated highlight keeps its hue in the bloom.
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
            // Shadows lean a little toward blue, so the sunlit green has something to stand against.
            const shade = float(1).sub(smoothstep(0.02, 0.4, luma));
            toned.mulAssign(mix(vec3(1), vec3(0.95, 0.99, 1.06), shade.mul(0.45)));
            toned.assign(mix(vec3(dot(toned, vec3(0.2126, 0.7152, 0.0722))), toned, 1.12));
            const radius = length(screenUV.sub(0.5).mul(vec2(this.uAspect.div(1.778), 1)).mul(2));
            toned.mulAssign(float(1).sub(smoothstep(0.8, 1.75, radius).mul(0.16)));
            return renderOutput(vec4(clamp(toned, 0, 1), 1), THREE.NoToneMapping);
        })();
        this.pipeline.outputNode = fxaa(graded);
    }

    /**
     * Sunlit air along each pixel's line of sight. The march asks the cloud field, at every
     * step, whether the sun reaches that point of the air; where it does the haze glows, so
     * the gaps between clouds stand in the valley as shafts.
     */
    buildShafts(sceneDepth) {
        const { light } = this;
        const steps = this.tier.shafts;
        return Fn(() => {
            const st = uv();
            const depth = sceneDepth.sample(st).r;
            const viewZ = perspectiveDepthToViewZ(depth, this.uNear, this.uFar);
            const ray = this.uForward.add(this.uRight.mul(st.x.mul(2).sub(1)))
                .add(this.uUp.mul(float(1).sub(st.y.mul(2)))).toVar();
            const direction = normalize(ray).toVar();
            const reach = min(length(ray).mul(viewZ.negate()), SHAFT_RANGE).toVar();
            const stride = reach.div(steps).toVar();
            const travelled = stride.mul(interleavedGradientNoise(screenCoordinate.xy)).toVar();
            const glow = float(0).toVar();
            const beam = float(0).toVar();
            Loop(steps, () => {
                const point = this.uEye.add(direction.mul(travelled));
                const air = exp(max(point.y.sub(light.uGroundLevel), 0).mul(-0.0022));
                const seen = exp(travelled.mul(light.uHaze).mul(-0.7));
                glow.addAssign(light.cloudShadow(point).mul(air).mul(seen));
                // The gap the game opens in the clouds: its shaft stands in the air whichever way one looks.
                beam.addAssign(light.sunGap(point).mul(air).mul(seen));
                travelled.addAssign(stride);
            });
            const sunward = saturate(dot(direction, light.uSunDir));
            const phase = pow(sunward, 3).mul(1.1).add(0.22);
            const amount = glow.mul(stride).mul(light.uHaze).mul(1.5);
            const shaft = beam.mul(stride).mul(light.uHaze).mul(BEAM_GAIN);
            return vec4(light.uHazeWarm.mul(amount).mul(phase).add(vec3(1.0, 0.86, 0.56).mul(shaft)), 1);
        })();
    }

    update(frame = {}) {
        const warmth = Number.isFinite(frame.warmth) ? THREE.MathUtils.clamp(frame.warmth, 0, 1) : 0;
        const shafts = Number.isFinite(frame.shafts) ? THREE.MathUtils.clamp(frame.shafts, 0, 1) : 0;
        this.uExposure.value = this.exposure + warmth * 0.04;
        this.uShafts.value = 1 + shafts * 0.7;
        if (this.bloomNode) this.bloomNode.strength.value = BLOOM_STRENGTH + warmth * 0.06;
    }

    /** Hand this frame's camera to the marches. */
    aim() {
        const { camera, renderer } = this;
        if (!camera?.isPerspectiveCamera) return;
        camera.updateMatrixWorld();
        const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
        this.uEye.value.setFromMatrixPosition(camera.matrixWorld);
        this.uRight.value.setFromMatrixColumn(camera.matrixWorld, 0).normalize().multiplyScalar(tanV * camera.aspect);
        this.uUp.value.setFromMatrixColumn(camera.matrixWorld, 1).normalize().multiplyScalar(tanV);
        this.uForward.value.setFromMatrixColumn(camera.matrixWorld, 2).normalize().negate();
        this.uNear.value = camera.near;
        this.uFar.value = camera.far;
        if (this.shaftsNode) {
            const drawing = renderer.getDrawingBufferSize(this.drawing);
            const scale = this.tier.shaftsScale;
            this.uShaftTexel.value.set(
                1 / Math.max(1, Math.floor(drawing.x * scale)),
                1 / Math.max(1, Math.floor(drawing.y * scale)),
            );
        }
    }

    render() {
        if (this.disposed) return;
        this.aim();
        this.light?.cloudPass?.render(this.renderer, this.camera);
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
            quality: this.quality, disabled: this.disabled, useMRT: false, shafts: Boolean(this.shaftsNode),
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.scenePass?.dispose();
        this.shaftsNode?.dispose?.();
        this.shaftsNode?.renderTarget?.dispose?.();
        disposeBloomNodeDeep(this.bloomNode);
        this.pipeline?.dispose();
        this.scenePass = null;
        this.shaftsNode = null;
        this.bloomNode = null;
        this.pipeline = null;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.light = null;
    }
}
