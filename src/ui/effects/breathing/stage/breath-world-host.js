/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Mounts one breathing world into a three r186 node scene and draws it.
 *
 * The host is renderer-agnostic on purpose: the game's BreathStage and the playground effect
 * both hand it a WebGPURenderer (WebGPU or its WebGL2 backend), a scene and a camera, so the
 * artwork iterated in the playground is the artwork that ships.
 *
 * A world is { backdrop, objects, motes, bloom, exposure, update, dispose }. Its backdrop is a
 * vec3 node painted on one screen-filling quad; the camera maps the z = 0 plane onto the same
 * hero space, so geometry and painted light line up without any per-world camera work.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, clamp, dot, float, floor, fract, length, mix, neutralToneMapping, pass, positionGeometry,
    renderOutput, screenCoordinate, screenUV, sin, smoothstep, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../../../../themes/shared/bloom-dispose.js';
import { createBreathUniforms } from './breath-tsl.js';
import { createMotes } from './breath-motes.js';
import { BREATH_WORLD_BUILDERS } from '../worlds/index.js';

/** Render cost only: every tier draws the same artwork. `bloom` is the bloom chain's scale. */
export const BREATH_QUALITY = Object.freeze({
    Extreme: {
        pixelRatio: 2, maxPixels: 3.6e6, octaves: 6, motes: 1, bloom: 0.5, frameInterval: 0,
    },
    Ultra: {
        pixelRatio: 1.75, maxPixels: 3.0e6, octaves: 5, motes: 1, bloom: 0.5, frameInterval: 0,
    },
    High: {
        pixelRatio: 1.5, maxPixels: 2.4e6, octaves: 5, motes: 1, bloom: 0.5, frameInterval: 0,
    },
    Medium: {
        pixelRatio: 1.25, maxPixels: 1.5e6, octaves: 5, motes: 0.7, bloom: 0.35, frameInterval: 0,
    },
    Low: {
        pixelRatio: 1, maxPixels: 0.9e6, octaves: 4, motes: 0.45, bloom: 0, frameInterval: 1000 / 30,
    },
    Minimal: {
        pixelRatio: 1, maxPixels: 0.5e6, octaves: 3, motes: 0.25, bloom: 0, frameInterval: 1000 / 30,
    },
});
const SESSION_CALM = {
    grounding: 0.25, active: 0, retention: 1, recovery: 0.35, integration: 0.8,
};
const CAMERA_DISTANCE = 6;
const DEFAULT_BLOOM = { strength: 0.35, radius: 0.6, threshold: 0.7 };

function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function disposeObject(object) {
    object.traverse((node) => {
        node.geometry?.dispose?.();
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => material?.dispose?.());
    });
}

export class BreathWorldHost {
    constructor({
        renderer, scene, camera, quality = 'High',
    }) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.qualityName = BREATH_QUALITY[quality] ? quality : 'High';
        this.quality = BREATH_QUALITY[this.qualityName];
        this.uniforms = createBreathUniforms();
        this.root = new THREE.Group();
        this.root.name = 'breath-world';
        this.scene.add(this.root);
        this.world = null;
        this.worldId = null;
        this.time = 0;
        this.breathIntegral = 0;
        this.calm = 0;
        this.calmTarget = 0;
        this.reducedMotion = false;
        this.width = 1;
        this.height = 1;
        this.uExposure = uniform(1);
        this.uAspect = uniform(16 / 9);
        this.pipeline = null;
        this.scenePass = null;
        this.bloomNode = null;
        this.disposed = false;
        if (this.quality.bloom > 0) this._createPipeline();
    }

    _createPipeline() {
        this.pipeline = new THREE.RenderPipeline(this.renderer);
        this.scenePass = pass(this.scene, this.camera);
        const sceneColor = this.scenePass.getTextureNode('output');
        // Luminance bloom over the composite: no second colour attachment, same on both backends.
        this.bloomNode = bloom(sceneColor, DEFAULT_BLOOM.strength, DEFAULT_BLOOM.radius, DEFAULT_BLOOM.threshold);
        this.bloomNode.smoothWidth.value = 0.35;
        this.bloomNode.setResolutionScale(this.quality.bloom);
        this.pipeline.outputColorTransform = false;
        this.pipeline.outputNode = Fn(() => {
            const combined = sceneColor.rgb.add(this.bloomNode.rgb).max(0);
            const toned = neutralToneMapping(combined, this.uExposure).toVar();
            const luma = dot(toned, vec3(0.2126, 0.7152, 0.0722));
            // Restore the chroma the shoulder takes, and keep the deepest tones off pure black.
            toned.assign(mix(vec3(luma), toned, float(1.07)));
            toned.addAssign(vec3(0.0014, 0.0018, 0.004).mul(float(1).sub(smoothstep(0, 0.1, luma))));
            const radial = length(screenUV.sub(0.5).mul(vec2(this.uAspect.div(1.778).max(0.75), 1)).mul(2));
            toned.mulAssign(float(1).sub(smoothstep(0.7, 1.75, radial).mul(0.3)));
            const display = renderOutput(vec4(clamp(toned, 0, 1), 1), THREE.NoToneMapping).rgb.toVar();
            const pixel = floor(screenCoordinate.xy);
            const grain = fract(sin(dot(pixel, vec2(12.9898, 78.233))).mul(43758.5453));
            display.addAssign(grain.sub(0.5).div(255));
            return vec4(clamp(display, 0, 1), 1);
        })();
    }

    /** Build a world and swap it in. Synchronous; the caller decides how to hide the first frames. */
    setWorld(id) {
        const worldId = BREATH_WORLD_BUILDERS[id] ? id : 'deep-relaxation';
        if (this.worldId === worldId && this.world) return worldId;
        this._clearWorld();
        const random = seededRandom(0x51ed270b);
        const world = BREATH_WORLD_BUILDERS[worldId]({ u: this.uniforms, quality: this.quality, random });
        const backdropMaterial = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
        backdropMaterial.colorNode = world.backdrop;
        // A clip-space quad: it fills the frame at any aspect and never needs resizing.
        backdropMaterial.vertexNode = vec4(positionGeometry.xy, 0.5, 1);
        const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), backdropMaterial);
        backdrop.frustumCulled = false;
        backdrop.renderOrder = -1000;
        this.root.add(backdrop);
        (world.objects || []).forEach((object) => this.root.add(object));
        if (world.motes) {
            const list = Array.isArray(world.motes) ? world.motes : [world.motes];
            list.forEach((options) => this.root.add(createMotes(this.uniforms, options, {
                scale: this.quality.motes, random,
            })));
        }
        this.world = world;
        this.worldId = worldId;
        const glow = { ...DEFAULT_BLOOM, ...world.bloom };
        if (this.bloomNode) {
            this.bloomNode.strength.value = glow.strength;
            this.bloomNode.radius.value = glow.radius;
            this.bloomNode.threshold.value = glow.threshold;
        }
        this.uExposure.value = world.exposure ?? 1;
        return worldId;
    }

    _clearWorld() {
        if (!this.world) return;
        try { this.world.dispose?.(); } catch (error) { console.warn('[BreathWorldHost] world dispose failed:', error); }
        [...this.root.children].forEach((child) => {
            this.root.remove(child);
            disposeObject(child);
        });
        this.world = null;
        this.worldId = null;
    }

    /** @param {{breath?: number, phase?: number, progress?: number}} state */
    setBreath({ breath = 0, phase = 0, progress = 0 } = {}) {
        const u = this.uniforms;
        u.breath.value = Number.isFinite(breath) ? THREE.MathUtils.clamp(breath, 0, 1) : 0;
        u.phase.value = phase;
        u.phaseT.value = THREE.MathUtils.clamp(progress, 0, 1);
    }

    setSessionPhase(type) { this.calmTarget = SESSION_CALM[type] ?? 0; }

    setReducedMotion(reduced) { this.reducedMotion = Boolean(reduced); }

    setFocus(focus) {
        if (!Number.isFinite(focus)) return;
        this.uniforms.focus.value = focus;
        this._fitCamera();
    }

    /** @param {number} width CSS pixels @param {number} height CSS pixels @param {number} [bufferHeight] */
    setSize(width, height, bufferHeight = height) {
        if (!(width > 0) || !(height > 0)) return;
        this.width = width;
        this.height = height;
        const aspect = width / height;
        this.uniforms.ext.value.set(Math.max(aspect, 1), Math.max(1 / aspect, 1));
        const shortBuffer = Math.min(bufferHeight * aspect, bufferHeight);
        this.uniforms.px.value = 2 / Math.max(shortBuffer, 1);
        this.uAspect.value = aspect;
        this._fitCamera();
    }

    _fitCamera() {
        const { camera } = this;
        const ext = this.uniforms.ext.value;
        camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(ext.y / CAMERA_DISTANCE));
        camera.aspect = ext.x / ext.y;
        camera.near = 0.1;
        camera.far = 60;
        camera.position.set(0, -this.uniforms.focus.value, CAMERA_DISTANCE);
        camera.quaternion.identity();
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
    }

    /** Advance scene clocks by `delta` seconds. */
    step(delta) {
        this.calm += (this.calmTarget - this.calm) * (1 - Math.exp(-delta * 0.9));
        // Reduced motion freezes ambient drift; the breath itself keeps moving the scene.
        const pace = this.reducedMotion ? 0 : 1 - this.calm * 0.7;
        this.time += delta * pace;
        this.breathIntegral += delta * pace * this.uniforms.breath.value;
        this._push(delta);
    }

    /** Pin the scene clocks for a reproducible frame. */
    seek(time, breathIntegral = time * 0.5) {
        this.time = time;
        this.breathIntegral = breathIntegral;
        this.calm = this.calmTarget;
        this._push(0);
    }

    _push(delta) {
        const u = this.uniforms;
        u.time.value = this.time;
        u.breathInt.value = this.breathIntegral;
        u.calm.value = this.calm;
        this.world?.update?.({
            time: this.time,
            delta,
            breath: u.breath.value,
            phase: u.phase.value,
            progress: u.phaseT.value,
            ext: u.ext.value,
        });
    }

    render() {
        if (this.disposed) return;
        if (this.pipeline) {
            this.pipeline.render();
            return;
        }
        // The light tiers draw straight to the canvas: no scene target, no bloom chain.
        const { renderer } = this;
        const { toneMapping } = renderer;
        const exposure = renderer.toneMappingExposure;
        try {
            renderer.toneMapping = THREE.NeutralToneMapping;
            renderer.toneMappingExposure = this.uExposure.value;
            renderer.render(this.scene, this.camera);
        } finally {
            renderer.toneMapping = toneMapping;
            renderer.toneMappingExposure = exposure;
        }
    }

    getDiagnostics() {
        const info = this.renderer?.info;
        return {
            world: this.worldId,
            quality: this.qualityName,
            post: Boolean(this.pipeline),
            drawCalls: info?.render?.drawCalls ?? null,
            triangles: info?.render?.triangles ?? null,
            geometries: info?.memory?.geometries ?? null,
            textures: info?.memory?.textures ?? null,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this._clearWorld();
        this.scene.remove(this.root);
        this.scenePass?.dispose();
        disposeBloomNodeDeep(this.bloomNode);
        this.pipeline?.dispose();
        this.scenePass = null;
        this.bloomNode = null;
        this.pipeline = null;
        this.renderer = null;
    }
}
