/**
 * Sunbraid — one shared world (the theme and the playground mount the same one).
 *
 * The white valley, its towers and gliders, the sky and the three suns; and everything gameplay
 * does to them.
 *
 * Lifecycle: `await SunbraidWorld.prepare(quality, { signal })` lays the land out;
 * `new SunbraidWorld({ ..., prepared }).build()` makes the scene objects; each frame
 * `updateCamera` → `update` → the post renders.
 */
import * as THREE from 'three/webgpu';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { drainSteps } from '../shared/build-steps.js';
import {
    DEG, LIGHT_GAIN, RIG, SUNS, TAU, azElOf, clamp, rigFor, smooth, sunVector,
} from './sunbraid-core.js';
import { tierFor } from './sunbraid-quality.js';
import { eyePosition, spireCasters } from './sunbraid-plan.js';
import { createNoiseTexture, createUniforms, writeCasters } from './sunbraid-tsl.js';
import { createSky } from './sunbraid-sky.js';
import { createLand } from './sunbraid-land.js';
import { createSpires } from './sunbraid-spires.js';
import { createGliders } from './sunbraid-gliders.js';
import { fallbackLayout } from './sunbraid-composition.js';
import { Braid } from './sunbraid-braid.js';

export const SUNBRAID_PARTS = Object.freeze(['sky', 'land', 'spires', 'gliders']);
export const REST_RIG = Object.freeze({ near: RIG.near, far: RIG.far });
export const fovForAspect = (aspect) => rigFor(aspect).fov;

/** The braid's phase at clock 0: the coral sun rides lowest, a little past the bottom of the circle. */
export const PHASE0 = -100 * DEG;

const COUNTERS = [
    'locks', 'hardDrops', 'clears', 'lines', 'quads', 'tspins', 'perfects', 'chainSteps', 'b2bSteps', 'levelUps',
    'gameOvers', 'mornings',
];
/** Session scalars a rebuild in place carries over. */
const SNAPSHOT = Object.freeze(['time', 'level', 'combo', 'peak', 'b2b']);
const emptyCounts = () => Object.fromEntries(COUNTERS.map((k) => [k, 0]));

export class SunbraidWorld {
    static async prepare(quality = 'High') {
        return SunbraidWorld.prepareSync(quality);
    }

    static prepareSync(quality = 'High') {
        return { quality, casters: spireCasters() };
    }

    constructor({
        scene, quality = 'High', capture = false, prepared = null, samples = 0,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture === true;
        this.samples = samples;
        this.prepared = prepared;
        this.root = new THREE.Group();
        this.root.name = 'SunbraidWorld';
        this.parts = {};
        this.partList = [];
        this.disposed = false;
        this.reducedMotion = false;
        this.overrides = { phase: null };
        this.aspect = 16 / 9;
        this.viewportHeight = 1080;
        this.layout = fallbackLayout(1920, 1080);
        this.layoutLive = false;
        this._camera = null;
        this.u = createUniforms();
        this.braid = new Braid();
        this.textures = null;
        const eye = eyePosition();
        this.eyeVector = new THREE.Vector3(eye[0], eye[1], eye[2]);
        this._az = [0, 0];
        this._dir = [0, 0, 0];
        this._post = {
            exposure: 1, bloomBoost: 0, flash: 0, flashColour: [1, 1, 1], saturation: 1.08,
        };
        this.resetState();
    }

    resetState() {
        this.time = 0;
        this.level = 1;
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.phase = PHASE0;
        this.spread = 1;
        this.white = 0;
        this.dusk = 0;
        this.braid.reset(0, PHASE0);
        this.counts = emptyCounts();
    }

    // ── Build ─────────────────────────────────────────────────────────────────────

    * buildSteps() {
        const prepared = this.prepared || SunbraidWorld.prepareSync(this.quality);
        this.prepared = prepared;
        this.textures = { noise: createNoiseTexture() };
        const { u, textures: t, tier } = this;
        writeCasters(u, prepared.casters);
        u.eye.value.copy(this.eyeVector);
        u.groundY.value = 0;
        this.addPart('land', createLand(u, t, tier));
        yield 'land';
        this.addPart('spires', createSpires(u, t, tier));
        yield 'spires';
        this.addPart('gliders', createGliders(u, t, tier.gliders));
        this.addPart('sky', createSky(u, t));
        this.scene.add(this.root);
        return this;
    }

    build() {
        drainSteps(this.buildSteps());
        return this;
    }

    addPart(name, part) {
        this.parts[name] = part;
        this.partList.push(part);
        const meshes = part.meshes || [part.mesh];
        for (const mesh of meshes) if (mesh) this.root.add(mesh);
    }

    showOnlyParts(names) {
        const keep = new Set(names);
        for (const name of Object.keys(this.parts)) {
            const part = this.parts[name];
            for (const mesh of part.meshes || [part.mesh]) if (mesh) mesh.visible = keep.has(name);
        }
    }

    bindCamera(camera) { this._camera = camera; }

    setReducedMotion(value) { this.reducedMotion = value === true; }

    setCaptureOverrides(overrides) { Object.assign(this.overrides, overrides); }

    setViewport(width, height, aspect) {
        if (aspect > 0) this.aspect = aspect;
        this.u.aspect.value = this.aspect;
        this.viewportHeight = Math.max(1, height);
        if (!this.layoutLive) this.layout = fallbackLayout(width, height);
    }

    setLayout(rects, aspect) {
        if (aspect > 0) this.aspect = aspect;
        this.layoutLive = Boolean(rects);
        this.layout = rects || fallbackLayout(1920, 1920 / Math.max(0.2, this.aspect));
    }

    // ── Camera ────────────────────────────────────────────────────────────────────

    pose(camera, time, pointerX = 0, pointerY = 0) {
        const rig = rigFor(this.aspect);
        camera.aspect = this.aspect;
        camera.fov = rig.fov;
        camera.near = RIG.near;
        camera.far = RIG.far;
        camera.position.copy(this.eyeVector);
        const move = this.reducedMotion ? 0 : 1;
        const yaw = rig.yaw + move * (Math.sin((TAU * time) / 89) * 0.35 + clamp(pointerX, -1, 1) * 0.8);
        const pitch = rig.pitch + move * (Math.sin((TAU * time) / 67) * 0.12 - clamp(pointerY, -1, 1) * 0.25);
        camera.rotation.set(pitch * DEG, -yaw * DEG, 0, 'YXZ');
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
    }

    restCamera(camera) {
        this.pose(camera, 0, 0, 0);
    }

    updateCamera(camera, sim) {
        this.time = Number.isFinite(sim.time) ? sim.time : this.time;
        this.pose(camera, this.time, sim.pointerX || 0, sim.pointerY || 0);
        if (applyCameraBreath(camera, this.time, { scale: this.reducedMotion ? 0 : 1 })) camera.updateMatrixWorld();
        this._camera = camera;
    }

    // ── Gameplay: everything is said by the suns (sunbraid-braid.js) ─────────────

    /** A lock ticks the braid a notch (a hard drop further): play winds the sundial. */
    onLock(c) {
        this.counts.locks += 1;
        if (c?.hardDrop) this.counts.hardDrops += 1;
        this.braid.tick(c?.hardDrop === true && !this.reducedMotion, this.time);
    }

    /**
     * A clear draws the suns together for a breath; four lines bring them into one white sun and
     * part them wide; a T-spin twists the braid a third of a turn per spin-turn.
     */
    onClear(c) {
        const lines = Math.max(1, Math.min(4, Math.round(Number(c?.lines) || 1)));
        this.counts.clears += 1;
        this.counts.lines += lines;
        if (lines >= 4) this.counts.quads += 1;
        if (c?.tspin) this.counts.tspins += 1;
        if (c?.perfect) this.counts.perfects += 1;
        if (c?.perfect) this.braid.noon(this.time);
        else if (lines >= 4) this.braid.conjoin(this.time);
        else this.braid.breathe(lines, this.time);
        if (c?.tspin) this.braid.twist(this.reducedMotion ? 1 : lines, this.time);
    }

    /** A chain turns the braid faster and opens it wider; a break lets it ease back. */
    onCombo(n) {
        const next = Math.max(0, Math.round(Number(n) || 0));
        if (next >= 2 && next > this.combo) this.counts.chainSteps += 1;
        this.combo = next;
        this.peak = Math.max(this.peak, next);
        this.braid.setCombo(next);
    }

    onB2B(level) {
        const next = Math.max(0, Math.round(Number(level) || 0));
        if (next > this.b2b) this.counts.b2bSteps += 1;
        this.b2b = next;
        this.braid.setB2B(next);
    }

    /** A level-up winds the braid on a sixth of a turn (the clock keeps turning it as well). */
    levelUp(level, { silent = false, time = this.time } = {}) {
        const n = Math.max(1, Math.round(Number(level) || 1));
        if (n > this.level && !silent) {
            this.counts.levelUps += 1;
            this.braid.levelUp(n - this.level, time);
        }
        this.level = n;
    }

    /** Game over: the suns set below the rim. */
    onGameOver() {
        this.counts.gameOvers += 1;
        this.braid.setDusk(true, this.time);
    }

    /** A new run after a game over: the suns rise again. */
    onSessionStart() {
        if (this.braid.duskTo > 0) {
            this.counts.mornings += 1;
            this.braid.setDusk(false, this.time);
        }
    }

    resetSession() {
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.level = 1;
        this.braid.setCombo(0);
        this.braid.setB2B(0);
    }

    /** Jump the clock (captures): everything in flight is dropped, the braid stands where the clock puts it. */
    seek(time) {
        const t = Math.max(0, Number(time) || 0);
        this.resetState();
        this.braid.reset(t, PHASE0);
        this.time = t;
    }

    exportSessionState() {
        const scalars = {};
        for (const key of SNAPSHOT) scalars[key] = this[key];
        return { scalars, braid: this.braid.exportState(), counts: { ...this.counts } };
    }

    importSessionState(state) {
        if (!state?.scalars) return;
        for (const key of SNAPSHOT) if (state.scalars[key] !== undefined) this[key] = state.scalars[key];
        this.braid.importState(state.braid);
        this.braid.time = this.time;
        this.counts = { ...emptyCounts(), ...state.counts };
    }

    /** The post marches the light in the air: the land then leaves the sunlit air to it. */
    setAirMarch(on) {
        this.airMarch = on === true;
        this.u.airMarch.value = this.airMarch ? 1 : 0;
    }

    // ── Frame ─────────────────────────────────────────────────────────────────────

    /** Where the suns stand and what light they give: written into the uniforms. */
    writeSuns(time) {
        const { u } = this;
        const phase = this.overrides.phase !== null ? this.overrides.phase : this.phase;
        const duskDrop = this.dusk * 16 * DEG - (this.lift || 0);
        // The dome's own colours away from the suns: cobalt-violet overhead, rose-mauve low.
        const night = 1 - 0.78 * this.dusk;
        const zen = [0.03 * night + 0.012 * this.dusk, 0.036 * night, 0.15 * night + 0.02 * this.dusk];
        const hor = [0.27 * night + 0.16 * this.dusk, 0.17 * night + 0.04 * this.dusk, 0.25 * night + 0.1 * this.dusk];
        const lit = [0, 0, 0];
        const share = [0, 0, 0];
        const disc = [0, 0, 0];
        const pen = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
            const dir = sunVector(phase, k, time, this.spread, this._dir);
            if (duskDrop !== 0) {
                // The cluster sinks: tilt the direction down toward the rim.
                const [az0, el0] = azElOf(dir, this._az);
                const lowered = el0 - duskDrop;
                const c = Math.cos(lowered);
                dir[0] = Math.sin(az0) * c;
                dir[1] = Math.sin(lowered);
                dir[2] = -Math.cos(az0) * c;
            }
            const [, el] = azElOf(dir, this._az);
            const sun = SUNS[k];
            // Low suns lose some light in the long air (and set below the rim).
            const through = smooth(-1.5 * DEG, 5 * DEG, el) * (0.82 + 0.18 * smooth(4 * DEG, 24 * DEG, el));
            // The one white sun of a conjunction: each sun's colour pales toward white as they meet.
            const c = sun.rgb.map((v) => (v + (0.62 - v) * this.white) * sun.power * through * LIGHT_GAIN);
            u[`sun${k}`].value.set(dir[0], dir[1], dir[2]);
            u[`col${k}`].value.set(c[0], c[1], c[2]);
            // The glow outlives the light: a set sun keeps a band of its colour on the horizon.
            const after = smooth(-9 * DEG, 0, el) * (1 + 1.6 * this.dusk * smooth(1 * DEG, -4 * DEG, el));
            const glowing = sun.power * LIGHT_GAIN * Math.max(through, after * 0.7);
            const g = sun.rgb.map((v) => (v + (0.62 - v) * this.white) * glowing);
            u[`glow${k}`].value.set(g[0], g[1], g[2]);
            disc[k] = Math.cos(sun.radius);
            // A crisp penumbra: graphic edges are the point of a coloured shadow.
            pen[k] = 0.42 * DEG;
            share[k] = 0.25 + 1.4 * (1 - smooth(6 * DEG, 32 * DEG, el));
            const high = Math.max(0, Math.sin(el));
            for (let i = 0; i < 3; i++) {
                zen[i] += (c[i] / LIGHT_GAIN) * 0.012 * (0.4 + high);
                hor[i] += (c[i] / LIGHT_GAIN) * 0.05;
                lit[i] += c[i] * high;
            }
        }
        u.discCos.value.set(disc[0], disc[1], disc[2]);
        u.penumbra.value.set(pen[0], pen[1], pen[2]);
        u.glowShare.value.set(share[0], share[1], share[2]);
        u.zenith.value.set(zen[0], zen[1], zen[2]);
        u.horizon.value.set(hor[0], hor[1], hor[2]);
        u.groundLit.value.set(lit[0], lit[1], lit[2]);
    }

    update(sim, camera = this._camera) {
        if (this.disposed) return;
        const prev = this.time;
        this.time = Number.isFinite(sim.time) ? sim.time : this.time;
        const dt = Math.max(0, Math.min(0.25, sim.delta ?? this.time - prev));
        const { time, u } = this;
        this.braid.step(time, dt);
        this.phase = this.braid.phaseNow();
        this.spread = this.braid.spreadNow();
        this.white = this.braid.whiteNow();
        this.dusk = this.braid.duskLevel(time);
        this.lift = this.braid.liftNow();
        u.ribbon.value = this.reducedMotion ? this.braid.ribbon * 0.6 : this.braid.ribbon;
        u.time.value = time % 4096;
        // The high cloud drifts on a steady wind (closed form: the clock times a constant).
        u.cloudDrift.value.set((time * 7.5) % 160000, (time * -3.1) % 160000);
        this.writeSuns(time);
        if (camera) {
            camera.updateMatrixWorld();
            u.eye.value.copy(camera.position);
        }
        for (const part of this.partList) part.update?.(time, dt, this);
    }

    prerender() {}

    getPostState() { return this._post; }

    getState() {
        return {
            quality: this.quality,
            time: this.time,
            level: this.level,
            combo: this.combo,
            peak: this.peak,
            b2b: this.b2b,
            phase: this.phase,
            spread: this.spread,
            white: this.white,
            dusk: this.dusk,
            counts: { ...this.counts },
            reducedMotion: this.reducedMotion,
            sceneChildren: this.root.children.length,
            parts: Object.keys(this.parts),
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.root.removeFromParent();
        for (const part of this.partList) part.dispose();
        this.textures?.noise?.dispose();
        this.root.clear();
        this.partList.length = 0;
    }
}
