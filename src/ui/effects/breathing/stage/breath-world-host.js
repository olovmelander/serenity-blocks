/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Mounts one breathing world into a three r186 node scene and draws it.
 *
 * The host is renderer-agnostic on purpose: the game's BreathStage and the playground effect
 * both hand it a WebGPURenderer (WebGPU or its WebGL2 backend), a scene and a camera, so the
 * artwork iterated in the playground is the artwork that ships.
 *
 * A world is { backdrop, objects, motes, bloom, shafts, grade, camera, exposure, update, dispose }.
 * Its backdrop is a vec3 node painted on one screen-filling quad; the camera maps the z = 0 plane
 * onto the same hero space, so geometry and painted light line up without per-world camera work.
 *
 * The breathing camera: the view leans in a little as the lungs fill and drifts slowly, never
 * faster than the breath. Meshes see the real camera move; painted layers follow through
 * `layer(p, u, k)` (breath-tsl.js), so near things slide past far ones. Reduced motion and a
 * session's stillness hold the camera.
 */
import * as THREE from 'three/webgpu';
import { positionGeometry, vec4 } from 'three/tsl';
import { createBreathUniforms } from './breath-tsl.js';
import { createMotes } from './breath-motes.js';
import { BreathPost } from './breath-post.js';
import { BREATH_WORLD_BUILDERS } from '../worlds/index.js';

/**
 * Render cost only: every tier draws the same artwork. `bloom` is the bloom chain's scale (0: no
 * post pipeline at all), `shafts` the light-shaft march length (0: none) at `shaftScale`,
 * `chroma` the lens's edge colour, `detail` scales the march lengths a world chooses.
 */
export const BREATH_QUALITY = Object.freeze({
    Extreme: {
        pixelRatio: 2, maxPixels: 3.6e6, octaves: 6, motes: 1, bloom: 0.5, shafts: 48, shaftScale: 0.5, chroma: true, detail: 1, frameInterval: 0,
    },
    Ultra: {
        pixelRatio: 1.75, maxPixels: 3.0e6, octaves: 5, motes: 1, bloom: 0.5, shafts: 40, shaftScale: 0.5, chroma: true, detail: 1, frameInterval: 0,
    },
    High: {
        pixelRatio: 1.5, maxPixels: 2.4e6, octaves: 5, motes: 1, bloom: 0.5, shafts: 36, shaftScale: 0.5, chroma: true, detail: 0.85, frameInterval: 0,
    },
    Medium: {
        pixelRatio: 1.25, maxPixels: 1.5e6, octaves: 5, motes: 0.7, bloom: 0.35, shafts: 32, shaftScale: 0.35, chroma: false, detail: 0.7, frameInterval: 0,
    },
    Low: {
        pixelRatio: 1, maxPixels: 0.9e6, octaves: 4, motes: 0.45, bloom: 0.25, shafts: 32, shaftScale: 0.25, chroma: false, detail: 0.5, frameInterval: 1000 / 30,
    },
    Minimal: {
        pixelRatio: 1, maxPixels: 0.5e6, octaves: 3, motes: 0.25, bloom: 0, shafts: 0, shaftScale: 0.25, chroma: false, detail: 0.4, frameInterval: 1000 / 30,
    },
});
const SESSION_CALM = {
    grounding: 0.25, active: 0, retention: 1, carry: 0.45, recovery: 0.35, integration: 0.8,
};
const CAMERA_DISTANCE = 6;
/** dolly: how far the view leans in at full lungs; drift: slow wander (hero units); period in seconds. */
const DEFAULT_RIG = Object.freeze({ dolly: 0.035, drift: [0.03, 0.016], period: 56 });
const TAU = Math.PI * 2;

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
        this.breathSoft = 0;
        this.breathVel = 0;
        this.lastBreath = null;
        this.calm = 0;
        this.calmTarget = 0;
        this.reducedMotion = false;
        this.width = 1;
        this.height = 1;
        this.exposure = 1;
        this.rig = DEFAULT_RIG;
        this.post = this.quality.bloom > 0 ? new BreathPost(renderer, scene, camera, this.quality) : null;
        this.disposed = false;
    }

    /** Kept for diagnostics and tests: the pipeline exists only on tiers with post. */
    get pipeline() { return this.post?.pipeline ?? null; }

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
        this.rig = { ...DEFAULT_RIG, ...world.camera };
        this.exposure = world.exposure ?? 1;
        this.post?.setWorld(world);
        this._fitCamera();
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
        this._fitCamera();
    }

    /**
     * Place the lens so the z = 0 plane shows hero point (X, Y) at screen hero point
     * ((X - pan) * zoom): distance 6 / zoom, centred on the pan, and the hero kept `focus` above
     * the middle of the screen. At rest (zoom 1, no pan) this is the plain hero mapping.
     */
    _fitCamera() {
        const { camera } = this;
        const u = this.uniforms;
        const ext = u.ext.value;
        const zoom = u.zoom.value;
        const pan = u.pan.value;
        camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(ext.y / CAMERA_DISTANCE));
        camera.aspect = ext.x / ext.y;
        camera.near = 0.1;
        camera.far = 60;
        camera.position.set(pan.x, pan.y - u.focus.value / zoom, CAMERA_DISTANCE / zoom);
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
        const { breath } = this.uniforms;
        this.breathIntegral += delta * pace * breath.value;
        // Secondary motion: a critically damped follower of the breath, and its smoothed rate.
        if (delta > 0) {
            const follow = 1 - Math.exp(-delta * 3.2);
            this.breathSoft += (breath.value - this.breathSoft) * follow;
            const rate = this.lastBreath === null ? 0 : (breath.value - this.lastBreath) / delta;
            this.breathVel += (rate - this.breathVel) * (1 - Math.exp(-delta * 6));
        }
        this.lastBreath = breath.value;
        this._push(delta);
    }

    /** Pin the scene clocks for a reproducible frame. */
    seek(time, breathIntegral = time * 0.5) {
        this.time = time;
        this.breathIntegral = breathIntegral;
        this.calm = this.calmTarget;
        this.breathSoft = this.uniforms.breath.value;
        this.breathVel = 0;
        this.lastBreath = this.uniforms.breath.value;
        this._push(0);
    }

    _push(delta) {
        const u = this.uniforms;
        u.time.value = this.time;
        u.breathInt.value = this.breathIntegral;
        u.calm.value = this.calm;
        u.breathSoft.value = this.breathSoft;
        u.breathVel.value = this.breathVel;
        this._moveCamera();
        this.world?.update?.({
            time: this.time,
            delta,
            breath: u.breath.value,
            breathSoft: this.breathSoft,
            phase: u.phase.value,
            progress: u.phaseT.value,
            ext: u.ext.value,
            zoom: u.zoom.value,
            pan: u.pan.value,
        });
        const light = this._shaftSource();
        this.post?.update({
            breath: this.breathSoft,
            light,
            region: light?.region ?? null,
            aspect: this.width / this.height,
        });
    }

    /** Breath-led dolly and a slow Lissajous drift, both held still by reduced motion and calm. */
    _moveCamera() {
        const u = this.uniforms;
        const still = this.reducedMotion ? 0 : 1 - this.calm * 0.85;
        const { dolly, drift, period } = this.rig;
        const phase = (this.time / period) * TAU;
        u.zoom.value = 1 + dolly * this.breathSoft * still;
        u.pan.value.set(
            drift[0] * Math.sin(phase) * still,
            drift[1] * Math.sin(phase * 1.37 + 1.1) * still,
        );
        this._fitCamera();
    }

    /**
     * Screen uv (y = 0 at the top) of the world's light-shaft source, through the camera rig, and
     * of its `region` line (hero y) above which light may stream (null: anywhere).
     */
    _shaftSource() {
        const shafts = this.world?.shafts;
        const source = shafts?.source;
        if (!source) return null;
        const u = this.uniforms;
        const k = source[2] ?? 0;
        const scale = 1 + (u.zoom.value - 1) * k;
        const ext = u.ext.value;
        const toUvY = (y) => 0.5 - 0.5 * (((y - u.pan.value.y * k) * scale + u.focus.value) / ext.y);
        const sx = (source[0] - u.pan.value.x * k) * scale;
        return {
            x: 0.5 + 0.5 * (sx / ext.x),
            y: toUvY(source[1]),
            region: Number.isFinite(shafts.region) ? toUvY(shafts.region) : null,
        };
    }

    render() {
        if (this.disposed) return;
        if (this.post) {
            this.post.render();
            return;
        }
        // The lightest tier draws straight to the canvas: no scene target, no bloom chain.
        const { renderer } = this;
        const { toneMapping } = renderer;
        const exposure = renderer.toneMappingExposure;
        try {
            renderer.toneMapping = THREE.NeutralToneMapping;
            renderer.toneMappingExposure = this.exposure;
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
            post: Boolean(this.post),
            shafts: Boolean(this.post?.usesShafts),
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
        this.post?.dispose();
        this.post = null;
        this.renderer = null;
    }
}
