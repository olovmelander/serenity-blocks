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
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';
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
import { BRAID_EVENTS, Braid } from './sunbraid-braid.js';

export const SUNBRAID_PARTS = Object.freeze(['sky', 'land', 'spires', 'gliders']);
export const REST_RIG = Object.freeze({ near: RIG.near, far: RIG.far });
export const fovForAspect = (aspect) => rigFor(aspect).fov;

/** The braid's phase at clock 0: the coral sun rides lowest, a little past the bottom of the circle. */
export const PHASE0 = -100 * DEG;

/**
 * The post's answers to the braid: the one white sun's glare (bloom boost) and flash (scaled by
 * the photosensitivity setting in the post), noon's glare and how far the iris closes, and the
 * grade's saturation at rest and its lift at a full chain's ribbons.
 */
export const POST_EVENTS = Object.freeze({
    whiteGlare: 1.1, whiteFlash: 0.45, noonGlare: 0.5, noonIris: 0.12, saturation: 1.08, chainSaturation: 0.12,
});

/**
 * How the valley answers the heat of play (src/themes/shared/gameplay-surge.js: `level` 0..1,
 * `fever` 0..1, `punch` the momentary hit). Below `from` the world looks exactly as it always has,
 * so casual play changes nothing. Above it the triple star spirals in: the suns draw together
 * (`pull`, a share of their spread, on top of the chain's own draw; sunbraid-braid.js) and sink a
 * little toward the rim, so every tower's fan of coloured shadows stretches toward the eye; their
 * tight halos blaze and their discs swell, the sky's glow round them and on the horizon under them
 * deepens, the ribbons braided between them brighten, swing wider and wind faster, the towers'
 * coloured wedges stand a little stronger in the valley air, the high cloud and the gliders
 * quicken, and the iris closes a little so the colours keep their depth. Four lines are the peak:
 * the suns join as one white sun and part wide, letting go of the whole pull at once (the release).
 */
export const SURGE_LOOK = Object.freeze({
    from: 0.2,
    pull: Object.freeze({ level: 0.16, fever: 0.08 }),
    /** The coronas (gain over 1): the heat, every clear's shine, the white sun's brilliance. */
    blaze: Object.freeze({
        level: 0.6, fever: 0.8, shine: 0.5, brilliance: 0.6,
    }),
    /** The sky's glow round each sun and on the horizon below it (gain over 1). */
    glow: Object.freeze({ level: 0.3, fever: 0.4, shine: 0.25 }),
    /**
     * The suns sink toward the rim (degrees): the sundial's shadows stretch toward the eye and the
     * horizon under them glows; the crown of a perfect clear lifts them from there.
     */
    sink: Object.freeze({ level: 1.6, fever: 1.4 }),
    /** The discs swell (a share of their radius); the one white sun swells further. */
    disc: Object.freeze({ level: 0.08, fever: 0.1, white: 0.1 }),
    /** The ribbons between the suns, over a chain's: the heat's, a back-to-back's flare. */
    ribbon: Object.freeze({ level: 0.45, fever: 0.65, flare: 1.1 }),
    /**
     * The valley mist's density (gain over 1) and the post's light in the air: a touch only (the
     * three suns' light in the mist is white; more of it is a veil, not colour).
     */
    mist: Object.freeze({ level: 0.08, fever: 0.1 }),
    air: Object.freeze({ level: 0.06, fever: 0.1, shine: 0.08 }),
    /**
     * The iris closes this much (exposure) so the added glare keeps the colours deep (a little:
     * the sinking suns already light the floor less).
     */
    iris: Object.freeze({ level: 0.01, fever: 0.03 }),
    /** The glare on the suns (bloom boost): the heat's, and every clear's shine. */
    glare: Object.freeze({ level: 0.06, fever: 0.1, shine: 0.25 }),
    /** The air runs ahead of the clock: extra seconds of drift per second (cloud, gliders, ribbons). */
    stir: Object.freeze({ level: 1.2, fever: 1.0 }),
    /** A hit: the lens dips (degrees), the suns glare, and a big one flashes past `flashFrom`. */
    kick: 0.3,
    punchGlare: 0.35,
    punchFlash: 0.12,
    flashFrom: 0.3,
});

const COUNTERS = [
    'locks', 'hardDrops', 'clears', 'lines', 'quads', 'tspins', 'perfects', 'chainSteps', 'b2bSteps', 'levelUps',
    'gameOvers', 'mornings',
];
/** Session scalars a rebuild in place carries over. */
const SNAPSHOT = Object.freeze(['time', 'level', 'combo', 'peak', 'b2b', 'stir']);
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
        /** The mist as the valley holds it at rest (the heat of play thickens and raises it). */
        this.mistRest = { density: this.u.mistDensity.value };
        this.braid = new Braid();
        /** How hot play runs (sampled once a frame on the world's clock). */
        this.surge = new GameplaySurge();
        /** Every clear's light on the suns' coronas: hits add, so rapid clears build a shimmer. */
        this.shine = new Swell({ release: 1.4, ceiling: 1.5, knee: 1 });
        /** Four lines' brilliance: the white sun swells as the suns close (a second quad adds). */
        this.brilliance = new Swell({
            attack: 0.5, release: 2.4, ceiling: 1.6, knee: 1.1,
        });
        /** The ribbons' flare: a back-to-back's, a spin's, a perfect clear's crown. */
        this.flare = new Swell({
            attack: 0.12, release: 1.6, ceiling: 1.4, knee: 1,
        });
        /** This frame's reading of all of it (one object, reused). */
        this.look = {
            punch: 0, level: 0, fever: 0, stage: 0, warm: 0, shine: 0, brilliance: 0, flare: 0,
        };
        this.textures = null;
        const eye = eyePosition();
        this.eyeVector = new THREE.Vector3(eye[0], eye[1], eye[2]);
        this._az = [0, 0];
        this._dir = [0, 0, 0];
        this._post = {
            exposure: 1, bloomBoost: 0, flash: 0, flashColour: [1, 1, 1], saturation: 1.08, air: 1,
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
        /** Extra seconds the air has drifted ahead of the clock (the heat of play stirs it). */
        this.stir = 0;
        /** The lens's dip for a hit (degrees). */
        this.kick = 0;
        /** How far the heat of play has sunk the suns (radians). */
        this.sink = 0;
        this.braid.reset(0, PHASE0);
        this.surge.reset();
        this.shine.reset();
        this.brilliance.reset();
        this.flare.reset();
        for (const key of Object.keys(this.look)) this.look[key] = 0;
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

    pose(camera, time, pointerX = 0, pointerY = 0, kick = 0) {
        const rig = rigFor(this.aspect);
        camera.aspect = this.aspect;
        camera.fov = rig.fov;
        camera.near = RIG.near;
        camera.far = RIG.far;
        camera.position.copy(this.eyeVector);
        const move = this.reducedMotion ? 0 : 1;
        const yaw = rig.yaw + move * (Math.sin((TAU * time) / 89) * 0.35 + clamp(pointerX, -1, 1) * 0.8);
        // A hit dips the lens a touch (it rides on a floor under rapid locks, never a shake).
        const pitch = rig.pitch + move * (Math.sin((TAU * time) / 67) * 0.12 - clamp(pointerY, -1, 1) * 0.25 - kick);
        camera.rotation.set(pitch * DEG, -yaw * DEG, 0, 'YXZ');
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
    }

    restCamera(camera) {
        this.pose(camera, 0, 0, 0);
    }

    updateCamera(camera, sim) {
        this.time = Number.isFinite(sim.time) ? sim.time : this.time;
        this.pose(camera, this.time, sim.pointerX || 0, sim.pointerY || 0, this.kick);
        if (applyCameraBreath(camera, this.time, { scale: this.reducedMotion ? 0 : 1 })) camera.updateMatrixWorld();
        this._camera = camera;
    }

    // ── Gameplay: everything is said by the suns (sunbraid-braid.js) ─────────────

    /** A lock ticks the braid a notch (a hard drop further): play winds the sundial. */
    onLock(c) {
        this.counts.locks += 1;
        if (c?.hardDrop) this.counts.hardDrops += 1;
        this.braid.tick(c?.hardDrop === true && !this.reducedMotion, this.time);
        this.surge.lock(c, this.time);
    }

    /**
     * A clear draws the suns together for a breath (each cascade wave deeper, winding the sundial
     * further) and lights their coronas (hits add: rapid clears build a shimmer); four lines bring
     * them into one white sun and part them wide (a second four lines feeds the one in flight); a
     * T-spin twists the braid a third of a turn per spin-turn; a back-to-back flares the ribbons
     * between the suns; a perfect clear riding on it crowns it.
     */
    onClear(c) {
        const lines = Math.max(1, Math.min(4, Math.round(Number(c?.lines) || 1)));
        const wave = Math.max(1, Math.min(12, Math.round(Number(c?.cascade) || 1)));
        const at = this.time;
        this.counts.clears += 1;
        this.counts.lines += lines;
        if (lines >= 4) this.counts.quads += 1;
        if (c?.tspin) this.counts.tspins += 1;
        if (c?.perfect) this.counts.perfects += 1;
        this.surge.clear(c, at);
        if (lines >= 4) {
            this.braid.conjoin(at);
            this.brilliance.hit(1, at);
        } else {
            this.braid.breathe(lines, at, wave);
        }
        if (wave > 1) this.braid.wave(wave, at);
        if (c?.tspin) this.braid.twist(this.reducedMotion ? 1 : lines, at);
        this.shine.hit(0.18 + 0.1 * lines + 0.12 * (wave - 1) + (c?.tspin ? 0.25 : 0), at);
        // A back-to-back: the braid itself flares, harder the longer the run (its level steps
        // after this clear, so the run this clear extends is one more than the one held).
        if (c?.b2b) this.flare.hit(0.45 + 0.15 * Math.min(4, this.b2b + 1), at);
        if (c?.perfect) this.crown(at, false);
    }

    /**
     * A perfect clear on its own frame (it settles after its clear's last wave): the crown on the
     * clear still playing, never a clear of its own.
     */
    onPerfect() {
        this.counts.perfects += 1;
        this.crown(this.time, true);
    }

    /** The crown: a joined sun holds a beat longer and the cluster climbs; the braid flares. */
    crown(at, own) {
        this.braid.crown(at);
        this.brilliance.hit(0.7, at);
        this.flare.hit(0.9, at);
        this.shine.hit(0.6, at);
        if (own) this.surge.crown(at);
    }

    /** A T-spin that cleared nothing: the braid turns a twelfth and its ribbons flicker. */
    onSpin() {
        this.counts.tspins += 1;
        this.braid.spin(this.time);
        this.flare.hit(0.35, this.time);
        this.shine.hit(0.15, this.time);
        this.surge.spin(this.time);
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
            this.surge.levelUp(time);
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
        const { surge } = this;
        return {
            scalars,
            braid: this.braid.exportState(),
            counts: { ...this.counts },
            // The heat of play and what it lights: a rebuild in place carries on mid-surge.
            surge: surge.exportState(),
            swells: {
                shine: this.shine.exportState(),
                brilliance: this.brilliance.exportState(),
                flare: this.flare.exportState(),
            },
        };
    }

    importSessionState(state) {
        if (!state?.scalars) return;
        for (const key of SNAPSHOT) if (state.scalars[key] !== undefined) this[key] = state.scalars[key];
        this.braid.importState(state.braid);
        this.braid.time = this.time;
        this.counts = { ...emptyCounts(), ...state.counts };
        if (state.surge) this.surge.importState(state.surge);
        this.shine.importState(state.swells?.shine);
        this.brilliance.importState(state.swells?.brilliance);
        this.flare.importState(state.swells?.flare);
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
        // Dusk sets the cluster, a perfect clear's crown lifts it, the heat of play sinks it a little.
        const duskDrop = this.dusk * 16 * DEG - (this.lift || 0) + (this.sink || 0);
        // The heat of play: the suns' glow in the sky brightens and their discs swell; the one white
        // sun of four lines swells further with its brilliance.
        const L = SURGE_LOOK;
        const { warm, fever } = this.look;
        // The dome's own colours away from the suns: cobalt-violet overhead, rose-mauve low.
        const night = 1 - 0.78 * this.dusk;
        // (Deep cobalt-violet overhead: the dome's top is the frame's darkest, saturated field.)
        const zen = [0.022 * night + 0.012 * this.dusk, 0.026 * night, 0.17 * night + 0.02 * this.dusk];
        const hor = [0.27 * night + 0.16 * this.dusk, 0.17 * night + 0.04 * this.dusk, 0.25 * night + 0.1 * this.dusk];
        const lit = [0, 0, 0];
        const share = [0, 0, 0];
        const disc = [0, 0, 0];
        const pen = [0, 0, 0];
        const glowGain = 1 + L.glow.level * warm + L.glow.fever * fever + L.glow.shine * this.look.shine;
        const swell = 1 + L.disc.level * warm + L.disc.fever * fever
            + L.disc.white * this.white * Math.min(1.2, 0.6 + 0.4 * this.look.brilliance);
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
            const glowing = sun.power * LIGHT_GAIN * Math.max(through, after * 0.7) * glowGain;
            const g = sun.rgb.map((v) => (v + (0.62 - v) * this.white) * glowing);
            u[`glow${k}`].value.set(g[0], g[1], g[2]);
            disc[k] = Math.cos(sun.radius * swell);
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
        const look = this.sampleSurge(time);
        const L = SURGE_LOOK;
        const { warm, fever } = look;
        this.braid.step(time, dt);
        this.phase = this.braid.phaseNow();
        this.spread = this.braid.spreadNow();
        this.white = this.braid.whiteNow();
        this.dusk = this.braid.duskLevel(time);
        this.lift = this.braid.liftNow();
        // The air runs ahead of the clock as play heats (the drift integrates the stir, so it
        // never jumps back when play cools).
        const calm = this.reducedMotion ? 0.3 : 1;
        this.stir += dt * (L.stir.level * warm + L.stir.fever * fever) * calm;
        this.glideTime = time + this.stir * 0.6;
        const ribbon = this.braid.ribbon + L.ribbon.level * warm + L.ribbon.fever * fever + L.ribbon.flare * look.flare;
        u.ribbon.value = this.reducedMotion ? ribbon * 0.6 : ribbon;
        u.ribbonWind.value = ((time + 1.5 * this.stir) * 0.7) % (TAU * 512);
        u.blaze.value = 1 + L.blaze.level * warm + L.blaze.fever * fever + L.blaze.shine * look.shine
            + L.blaze.brilliance * look.brilliance;
        u.mistDensity.value = this.mistRest.density * (1 + L.mist.level * warm + L.mist.fever * fever);
        u.time.value = time % 4096;
        // The high cloud drifts on a steady wind (closed form at rest: the clock times a constant).
        const drift = time + this.stir;
        u.cloudDrift.value.set((drift * 7.5) % 160000, (drift * -3.1) % 160000);
        this.writeSuns(time);
        this.writePost();
        if (camera) {
            camera.updateMatrixWorld();
            u.eye.value.copy(camera.position);
        }
        for (const part of this.partList) part.update?.(time, dt, this);
    }

    /**
     * What the gameplay does to the picture (POST_EVENTS): the one white sun of four lines glares and
     * floods the frame with white; noon (a perfect clear) blazes and the iris closes a little so the
     * floor keeps its crust; a chain's braid deepens the colour.
     */
    writePost() {
        const post = this._post;
        const P = POST_EVENTS;
        const L = SURGE_LOOK;
        const {
            warm, fever, punch, shine, brilliance,
        } = this.look;
        const white = clamp(this.white || 0, 0, 1);
        const noon = clamp((this.lift || 0) / BRAID_EVENTS.noon.lift, 0, 1);
        const ribbon = clamp(this.braid.ribbon || 0, 0, 1);
        // The white sun glares as it always has, brighter for every four lines that fed it; the
        // heat of play and every clear's shine add to the glare on the suns; a hit kicks it (a
        // momentary kick: held back under Reduce flashing, as the post holds the flash).
        post.bloomBoost = P.whiteGlare * white * (1 + 0.25 * Math.min(1.2, Math.max(0, brilliance - 1)))
            + P.noonGlare * noon
            + L.glare.level * warm + L.glare.fever * fever + L.glare.shine * shine
            + flashScale() * L.punchGlare * punch;
        post.flash = P.whiteFlash * white + L.punchFlash * Math.max(0, punch - L.flashFrom);
        // The iris closes a little as heat adds light, so the fans keep their colour.
        post.exposure = 1 - P.noonIris * noon - L.iris.level * warm - L.iris.fever * fever;
        post.saturation = P.saturation + P.chainSaturation * ribbon;
        // The mist's light in the air (the towers' coloured wedges) rises with the heat.
        post.air = 1 + L.air.level * warm + L.air.fever * fever + L.air.shine * shine;
    }

    /**
     * Where play stands (once a frame, on the world's clock): the surge, every clear's shine, the
     * white sun's brilliance and the ribbons' flare; and how close the heat draws the suns.
     */
    sampleSurge(time) {
        const L = SURGE_LOOK;
        const s = this.surge.sample(time);
        const { look } = this;
        look.punch = s.punch;
        look.level = s.level;
        look.fever = s.fever;
        look.stage = s.stage;
        // Nothing below `from`: casual play leaves the valley as it is.
        look.warm = smooth(L.from, 1, s.level);
        look.shine = this.shine.valueAt(time);
        look.brilliance = this.brilliance.valueAt(time);
        look.flare = this.flare.valueAt(time);
        this.braid.pull = L.pull.level * look.warm + L.pull.fever * look.fever;
        this.kick = L.kick * look.punch;
        this.sink = (L.sink.level * look.warm + L.sink.fever * look.fever) * DEG;
        return look;
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
            sink: this.sink,
            heat: {
                punch: this.look.punch, level: this.look.level, fever: this.look.fever, stage: this.look.stage,
            },
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
