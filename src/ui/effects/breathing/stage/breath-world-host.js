/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Mounts one breathing world into a three r186 node scene and draws it.
 *
 * The host is renderer-agnostic on purpose: the game's BreathStage and the playground effect
 * both hand it a WebGPURenderer (WebGPU or its WebGL2 backend), a scene and a camera, so the
 * artwork iterated in the playground is the artwork that ships.
 *
 * A world is { backdrop, objects, motes, bloom, shafts, grade, camera, exposure, update, dispose }.
 * It is built in one of its moods (stage/breath-moods.js): a visit picks one, and the host keeps
 * it for the rest of its life, so a session that returns to a world finds the same scene.
 * A session's next world can be built ahead, off screen (prepareWorld), and compiled for the
 * target it will draw into (compilePrepared); setWorld then adopts it as it is.
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
import { pickBreathMood, resolveBreathMood } from './breath-moods.js';
import { compileGroupUnderLiveLoop } from '../../../../rendering/odyssey/warmup/post-target-compile.js';
import { BREATH_WORLD_BUILDERS, BREATH_WORLD_MOODS } from '../worlds/index.js';

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
const ONE_MOOD = Object.freeze([{ id: 'classic', name: 'Classic' }]);

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

const samePick = (a, b) => a.worldId === b.worldId && a.moodIndex === b.moodIndex && a.seed === b.seed;

/**
 * Dispose a world and its objects. While three's compile loop is still walking their materials
 * (a world compiled ahead), wait for it to finish first.
 */
function retireWorld(world, objects, compile) {
    const drop = () => {
        try { world?.dispose?.(); } catch (error) { console.warn('[BreathWorldHost] world dispose failed:', error); }
        objects.forEach((object) => {
            object.parent?.remove(object);
            disposeObject(object);
        });
    };
    if (compile && !compile.done) compile.promise.then(drop);
    else drop();
}

export class BreathWorldHost {
    constructor({
        renderer, scene, camera, quality = 'High', pickMood = pickBreathMood,
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
        this.pickMood = pickMood;
        /** world id → the mood index (and the visit seed) this host showed it with */
        this.moodMemory = new Map();
        this.seedMemory = new Map();
        this.mood = null;
        this.life = 1;
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
        /** A world built ahead, off screen, for setWorld to adopt (prepareWorld). */
        this.prepared = null;
        /** The compile of the world on screen, when it was compiled ahead and may still be running. */
        this._worldCompile = null;
        this.disposed = false;
        // Per-frame state handed to the world and the lens: filled in place every frame, so the
        // frame loop makes no garbage. Readers take what they need at once and keep nothing.
        this._frameState = {
            time: 0, delta: 0, breath: 0, breathSoft: 0, phase: 0, progress: 0, life: 1, ext: null, zoom: 1, pan: null,
        };
        this._light = { x: 0.5, y: 0.5, region: null };
        this._lensState = {
            breath: 0, light: null, region: null, aspect: 1,
        };
    }

    /** Kept for diagnostics and tests: the pipeline exists only on tiers with post. */
    get pipeline() { return this.post?.pipeline ?? null; }

    /**
     * Build a world and swap it in. Synchronous; the caller decides how to hide the first frames.
     * `mood` (an index or a mood id) and `seed` (0..1, the visit's own variation) pin a version
     * for previews and captures; without them a first visit picks, and a return keeps the pick.
     * A world built ahead (prepareWorld) with the same pick is adopted as it is: nothing is
     * built again, and what was compiled ahead is what draws.
     */
    setWorld(id, { mood, seed } = {}) {
        const pick = this._pick(id, mood, seed);
        if (this._shows(pick)) return pick.worldId;
        const ahead = this.prepared && samePick(this.prepared, pick) ? this.prepared : null;
        if (ahead) this.prepared = null;
        this._clearWorld();
        this.moodMemory.set(pick.worldId, pick.moodIndex);
        this.seedMemory.set(pick.worldId, pick.seed);
        this.mood = pick.mood;
        this.uniforms.seed.value = pick.seed;
        const { world, objects } = ahead || this._build(pick);
        objects.forEach((object) => this.root.add(object));
        this._worldCompile = ahead?.compile ?? null;
        this.world = world;
        this.worldId = pick.worldId;
        this.rig = { ...DEFAULT_RIG, ...world.camera };
        this.exposure = world.exposure ?? 1;
        this.post?.setWorld(world);
        this._fitCamera();
        return pick.worldId;
    }

    /**
     * Build a world ahead, off screen, for setWorld to adopt: a Hale session's next stage, built
     * while the current one is on screen. Its mood and visit seed are picked now, exactly as
     * setWorld would pick them, and kept like a visit's; nothing on screen changes (the seed
     * uniform is set when the world is adopted). Returns whether anything was built: nothing is
     * when the world is the one on screen, or was already built ahead.
     */
    prepareWorld(id, { mood, seed } = {}) {
        if (this.disposed) return false;
        const pick = this._pick(id, mood, seed);
        if (this._shows(pick)) {
            this.discardPrepared();
            return false;
        }
        if (this.prepared && samePick(this.prepared, pick)) return false;
        this.discardPrepared();
        this.moodMemory.set(pick.worldId, pick.moodIndex);
        this.seedMemory.set(pick.worldId, pick.seed);
        const { world, objects } = this._build(pick);
        // A holder of its own, outside the scene: compileAsync walks it, render() never sees it.
        const holder = new THREE.Group();
        objects.forEach((object) => holder.add(object));
        this.prepared = {
            ...pick, world, objects, holder, compile: null,
        };
        return true;
    }

    /**
     * Whether a world built ahead can be compiled ahead: on every tier with the lens's scene pass
     * (the lightest tier draws straight to the canvas, and builds nothing ahead).
     */
    get compilesAhead() {
        return Boolean(this.post?.scenePass?.renderTarget) && typeof this.renderer?.compileAsync === 'function';
    }

    /**
     * Compile the world built ahead, while the world on screen keeps drawing: its shaders built in
     * steps that yield to the frame loop, its pipelines created on the driver's workers. Its first
     * frame then finds every shader and pipeline it needs. Resolves when that is done, or at once
     * when nothing is built ahead (or this tier cannot compile ahead).
     */
    compilePrepared() {
        const ahead = this.prepared;
        if (!ahead || this.disposed || !this.compilesAhead) return Promise.resolve();
        if (!ahead.compile) {
            // The scene is drawn by the lens's scene pass, one render call deep inside its
            // pipeline. three keys a material's shader build by that render context, and builds
            // it after compileAsync's first await, reading whatever target is bound by then. A
            // plain compileAsync builds for another context: the stage change would build and
            // compile every shader again. compileGroupUnderLiveLoop (the Odyssey warm-up's, pinned
            // by its contract tests) compiles in exactly the scene pass's context, its deferred
            // builds answered from that binding while live frames see their own.
            let compiling;
            try {
                compiling = compileGroupUnderLiveLoop(this.renderer, this.post, this.scene, this.camera, ahead.holder, {
                    concurrency: 2,
                });
            } catch (error) {
                compiling = Promise.reject(error);
            }
            const compile = { done: false, promise: null };
            compile.promise = Promise.resolve(compiling).catch((error) => {
                // The stage change still works: the world's pipelines are made as it first draws.
                console.warn('[BreathWorldHost] compiling a world ahead failed:', error?.message || error);
            }).then(() => { compile.done = true; });
            ahead.compile = compile;
        }
        return ahead.compile.promise;
    }

    /** Drop the world built ahead (the plan changed, the practice ended). */
    discardPrepared() {
        const ahead = this.prepared;
        if (!ahead) return;
        this.prepared = null;
        retireWorld(ahead.world, ahead.objects, ahead.compile);
    }

    /** The world (in its mood, with its visit seed) that a request means. */
    _pick(id, mood, seed) {
        const worldId = BREATH_WORLD_BUILDERS[id] ? id : 'deep-relaxation';
        const moods = BREATH_WORLD_MOODS[worldId]?.length ? BREATH_WORLD_MOODS[worldId] : ONE_MOOD;
        let moodIndex = resolveBreathMood(moods, mood);
        if (moodIndex === null) moodIndex = this.moodMemory.get(worldId) ?? this.pickMood(worldId, moods.length);
        moodIndex = THREE.MathUtils.clamp(Math.floor(moodIndex) || 0, 0, moods.length - 1);
        const visitSeed = Number.isFinite(seed)
            ? THREE.MathUtils.clamp(seed, 0, 1) : (this.seedMemory.get(worldId) ?? Math.random());
        return {
            worldId, moodIndex, mood: moods[moodIndex], seed: visitSeed,
        };
    }

    /** True when `pick` is what is on screen now. */
    _shows(pick) {
        return this.worldId === pick.worldId && Boolean(this.world) && this.mood === pick.mood
            && pick.seed === this.uniforms.seed.value;
    }

    /** Build a world's artwork, not yet in any scene: its backdrop quad, its objects, its motes. */
    _build({ worldId, mood }) {
        const random = seededRandom(0x51ed270b);
        const world = BREATH_WORLD_BUILDERS[worldId]({
            u: this.uniforms, quality: this.quality, random, mood,
        });
        const backdropMaterial = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
        backdropMaterial.colorNode = world.backdrop;
        // A clip-space quad: it fills the frame at any aspect and never needs resizing.
        backdropMaterial.vertexNode = vec4(positionGeometry.xy, 0.5, 1);
        const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), backdropMaterial);
        backdrop.frustumCulled = false;
        backdrop.renderOrder = -1000;
        const objects = [backdrop, ...(world.objects || [])];
        if (world.motes) {
            const list = Array.isArray(world.motes) ? world.motes : [world.motes];
            list.forEach((options) => objects.push(createMotes(this.uniforms, options, {
                scale: this.quality.motes, random,
            })));
        }
        return { world, objects };
    }

    _clearWorld() {
        if (!this.world) return;
        const objects = [...this.root.children];
        objects.forEach((child) => this.root.remove(child));
        retireWorld(this.world, objects, this._worldCompile);
        this._worldCompile = null;
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
        const fov = THREE.MathUtils.radToDeg(2 * Math.atan(ext.y / CAMERA_DISTANCE));
        const aspect = ext.x / ext.y;
        // The lens changes only with the screen's shape. The camera moves every frame, but its
        // projection (and that matrix's inverse) is rebuilt only when one of its inputs changed.
        if (camera.fov !== fov || camera.aspect !== aspect || camera.near !== 0.1 || camera.far !== 60) {
            camera.fov = fov;
            camera.aspect = aspect;
            camera.near = 0.1;
            camera.far = 60;
            camera.updateProjectionMatrix();
        }
        camera.position.set(pan.x, pan.y - u.focus.value / zoom, CAMERA_DISTANCE / zoom);
        camera.quaternion.identity();
        camera.updateMatrixWorld();
    }

    /** Advance scene clocks by `delta` seconds. */
    step(delta) {
        this.calm += (this.calmTarget - this.calm) * (1 - Math.exp(-delta * 0.9));
        // Reduced motion freezes ambient drift; the breath itself keeps moving the scene.
        const pace = this.reducedMotion ? 0 : 1 - this.calm * 0.7;
        this.time += delta * pace;
        // Occasional events (a meteor, a breaching whale) fade away under stillness and reduced motion.
        this.life += (this._lifeTarget() - this.life) * (1 - Math.exp(-delta * 0.8));
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
        this.life = this._lifeTarget();
        this.breathSoft = this.uniforms.breath.value;
        this.breathVel = 0;
        this.lastBreath = this.uniforms.breath.value;
        this._push(0);
    }

    _lifeTarget() { return this.reducedMotion ? 0 : 1 - this.calm * 0.75; }

    _push(delta) {
        const u = this.uniforms;
        u.time.value = this.time;
        u.life.value = this.life;
        u.breathInt.value = this.breathIntegral;
        u.calm.value = this.calm;
        u.breathSoft.value = this.breathSoft;
        u.breathVel.value = this.breathVel;
        this._moveCamera();
        if (this.world?.update) {
            const frame = this._frameState;
            frame.time = this.time;
            frame.delta = delta;
            frame.breath = u.breath.value;
            frame.breathSoft = this.breathSoft;
            frame.phase = u.phase.value;
            frame.progress = u.phaseT.value;
            frame.life = this.life;
            frame.ext = u.ext.value;
            frame.zoom = u.zoom.value;
            frame.pan = u.pan.value;
            this.world.update(frame);
        }
        if (this.post) {
            const light = this._shaftSource();
            const lens = this._lensState;
            lens.breath = this.breathSoft;
            lens.light = light;
            lens.region = light?.region ?? null;
            lens.aspect = this.width / this.height;
            this.post.update(lens);
        }
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
        const sx = (source[0] - u.pan.value.x * k) * scale;
        // Filled in place (called every frame); the arithmetic is the same as ever, term for term.
        const light = this._light;
        light.x = 0.5 + 0.5 * (sx / ext.x);
        light.y = this._toUvY(source[1], k, scale);
        light.region = Number.isFinite(shafts.region) ? this._toUvY(shafts.region, k, scale) : null;
        return light;
    }

    /** A hero-space height on screen (uv, y = 0 at the top) for a layer of depth k. */
    _toUvY(y, k, scale) {
        const u = this.uniforms;
        return 0.5 - 0.5 * (((y - u.pan.value.y * k) * scale + u.focus.value) / u.ext.value.y);
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
            mood: this.mood?.id ?? null,
            seed: this.uniforms.seed.value,
            quality: this.qualityName,
            ahead: this.prepared?.worldId ?? null,
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
        // The renderer goes with the host (the stage disposes it next): dispose everything now,
        // before it, whether or not a compile ahead is still running; that compile only fails.
        const ahead = this.prepared;
        this.prepared = null;
        if (ahead) retireWorld(ahead.world, ahead.objects, null);
        this._worldCompile = null;
        this._clearWorld();
        this.scene.remove(this.root);
        this.post?.dispose();
        this.post = null;
        this.renderer = null;
    }
}
