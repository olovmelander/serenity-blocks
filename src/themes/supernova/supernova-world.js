/**
 * Supernova — the world.
 *
 * Owns the shared uniforms, every scene part, the camera rig and the choreography. Shared by the
 * theme (supernova-theme.js) and the playground effect
 * (src/playground/effects/supernova.effect.js), so what is iterated there ships.
 *
 * A massive star burns to the left of the card inside the nebula it has thrown off. The board
 * feeds it:
 *
 *   lock     a stream of the piece's colour leaves the card's edge at the piece's own height and
 *            falls into the star. Where it lands the surface flashes in that colour, a ripple
 *            runs round the photosphere, a prominence rises from the spot, and an echo of the
 *            colour runs out through the nebula. A hard drop sends three and hits harder.
 *   clear    the cleared rows go into the star as streaks of light and the star answers with a
 *            shock: one front per line runs out through the nebula, every shell flares in the
 *            front's colour as it is crossed, and the ring round the star flares as it passes.
 *   combo    the star heats: red-gold to white to blue-white, a faster boil, a longer corona,
 *            white cracks along its lanes; and one more bead lights on the ring for every step.
 *            A chain of eight sets it off by itself.
 *   four     the star falls in on itself — the nebula holds its breath and the picture is drawn
 *            in — then detonates: a flash, a blast wave that bends the picture, a fireball of
 *            ragged shells, a spray of ejecta, an echo across the far clouds; and what is left is
 *            a pulsar whose beams sweep the nebula while a new star kindles.
 *   T-spin   the corona winds into a pinwheel and springs back.
 *   level    the star burns a heavier element: its colours move one palette on. Time alone
 *            also carries them on, slowly, whatever the level: about eighty seconds a palette.
 *
 * Everything is a function of the world clock and event timestamps (nothing is created at event
 * time), so seek(t) plus a fixed-step replay reproduces any frame.
 */

import * as THREE from 'three/webgpu';
import {
    BLAST_SHELLS,
    BLUEWHITE,
    COLLAPSED_SIZE,
    COLLAPSE_HOLD,
    CRITICAL_COMBO,
    DEG,
    FRONT_GAP,
    FRONT_SLOTS,
    IMPACT_SLOTS,
    LOOP_LIFE,
    NEBULA,
    NOVA_REARM,
    PALETTE_KEYS,
    REKINDLE,
    RING,
    ROW_FLIGHT,
    SHELL_STRIDE,
    STANDING_MAX,
    STAR,
    STARFIRE,
    STREAM_FLIGHT,
    SUPERNOVA_PALETTES,
    TAU,
    approach,
    bakeNoise3D,
    blastRadius,
    clamp01,
    collapseScale,
    createNoise3DTexture,
    createSupernovaUniforms,
    frontPassTime,
    frontRadius,
    heatForCombo,
    mulberry32,
    paletteDrift,
    pieceColor,
    pulsarGain,
    shellGain,
    shellPhase,
    shellRadius,
    smooth,
    starAnchors,
} from './supernova-tsl.js';
import { tierFor } from './supernova-quality.js';
import { createSky } from './supernova-sky.js';
import { createNebula } from './supernova-nebula.js';
import { createStar } from './supernova-star.js';
import { createLoops } from './supernova-loops.js';
import { createRing } from './supernova-ring.js';
import {
    createBeams, createEmbers, createSparks, createStreams,
} from './supernova-fx.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './supernova-composition.js';

/** The rest camera: a long lens, far enough back that the nebula keeps its depth. */
export const REST_RIG = Object.freeze({
    /** Horizontal field of view the rig holds; the vertical one follows the aspect, clamped. */
    hFov: 48,
    minFov: 23,
    maxFov: 58,
    near: 0.5,
    far: 2000,
});

/** Vertical field of view (degrees) for an aspect ratio. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((REST_RIG.hFov * DEG) / 2) / a)) / DEG;
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, v));
}

/** Seconds the overdrive after a detonation takes to cool to 1/e. */
export const SURGE_COOL = 3.2;
/** Seconds the sky's answer to a clear takes to fade to 1/e. */
export const STORM_COOL = 1.6;
/** Seconds the star's answer to an impact or a shock takes to fade to 1/e. */
export const PULSE_COOL = 0.42;
/** Seconds between the star's own prominences. */
export const LOOP_BEAT = 2.3;
/** How far along the view ray (as a fraction of the star's distance) a stream leaves the card. */
const STREAM_DEPTH = 0.6;
/** The corona's spring: how hard it pulls back, how fast it settles. */
const TWIST_STIFFNESS = 26;
const TWIST_DAMPING = 4.6;
/** The blast ripple a detonation sends through the picture: screen heights per second. */
const RIPPLE_SPEED = 0.95;
/** A front is dropped from the table once it has faded this far. */
const FRONT_FLOOR = 0.012;
/** How long a detonation's fireball stays in the table (seconds). */
const BLAST_LIVE = 19;

const PENDING_SLOTS = 40;
const KIND_IMPACT = 1;
const KIND_SHOCK = 2;
const KIND_DETONATE = 3;
/** What a queued shock carries besides its lines. */
const FLAG_AFTERSHOCK = 1;
const FLAG_TSPIN = 2;

const PARTS = ['sky', 'nebula', 'beams', 'star', 'ring', 'loops', 'embers', 'streams', 'sparks'];

/** Which two of the palette's three gas colours each standing shell glows in. */
const SHELL_HUES = Object.freeze([
    ['gasA', 'gasB'], ['gasC', 'gasA'], ['gasB', 'gasA'], ['gasC', 'gasB'], ['gasA', 'gasC'],
]);
/** Where in the noise each standing shell, then each shell of a fireball, reads its pattern. */
const SHELL_SEEDS = Object.freeze([
    [0.13, 0.57, 0.91], [0.71, 0.23, 0.39], [0.37, 0.83, 0.11], [0.59, 0.07, 0.67], [0.89, 0.43, 0.29],
    [0.21, 0.69, 0.53], [0.47, 0.17, 0.79], [0.97, 0.61, 0.03],
]);
/** The step of the chain that lights each bead of the ring (bead = step × 5 mod 12). */
const BEAD_RANK = Object.freeze(Array.from({ length: RING.beads }, (_, bead) => {
    for (let step = 0; step < RING.beads; step++) if ((step * 5) % RING.beads === bead) return step;
    return bead;
}));
/** How far inside the fireball's edge each of its shells rides. */
const BLAST_DEPTHS = Object.freeze([0.5, 0.75, 1]);

function createPending() {
    return {
        live: false, time: 0, kind: 0, dir: [0, 1, 0], rgb: [1, 1, 1], amount: 1, lines: 1, flag: 0,
    };
}

function createFront() {
    return {
        birth: -100, strength: 0, reach: 21, tau: 1.15, fade: 1.5, skin: 0.04, stir: 1, rgb: [1, 1, 1],
    };
}

export class SupernovaWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {THREE.WebGPURenderer} [params.renderer]
     * @param {boolean} [params.capture=false]  deterministic captures: no wall-clock anywhere
     * @param {number} [params.seed]
     */
    constructor({
        scene, quality = 'High', renderer = null, capture = false, seed = 1987,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.renderer = renderer;
        this.capture = capture;
        this.seed = seed;
        this.root = new THREE.Group();
        this.root.name = 'Supernova';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.loops = null;
        this.streams = null;
        this.sparks = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        /** The star on screen (fractions, y down): where the post's rays, ripple and fall come from. */
        this.heart = { x: 0.2, y: 0.47 };
        this.anchors = starAnchors(this.aspect);
        this.distance = 22;
        this.starR = STAR.radius;
        this._camera = null;
        this._rest = new THREE.PerspectiveCamera(30, 16 / 9, REST_RIG.near, REST_RIG.far);
        this._centre = new THREE.Vector3(0, 0, -22);
        this._toCam = new THREE.Vector3(0, 0, 1);
        this._rot4 = new THREE.Matrix4();
        this._tilt = new THREE.Matrix4();
        this._spin = new THREE.Matrix4();
        this._rot3 = new THREE.Matrix3();
        this._inv3 = new THREE.Matrix3();
        this._ringFrame = new THREE.Matrix4();
        this._e1 = new THREE.Vector3();
        this._e2 = new THREE.Vector3();
        this._e3 = new THREE.Vector3();
        this._ray = new THREE.Vector3();
        this._vec = new THREE.Vector3();
        this._vec2 = new THREE.Vector3();
        this._look = new THREE.Vector3();
        this._point = { x: 0.5, y: 0.5 };
        this._launch = { x: 0.5, y: 0.5, top: false };
        this._from = [0, 0, 0];
        this._pointer = { x: 0, y: 0 };
        this._palette = {};
        /** Where the live palette is heading: two neighbours of the cycle, blended. */
        this._target = {};
        this._drift = { from: 0, to: 1, blend: 0 };
        PALETTE_KEYS.forEach((key) => {
            this._palette[key] = [...SUPERNOVA_PALETTES[0][key]];
            this._target[key] = [...SUPERNOVA_PALETTES[0][key]];
        });
        this.pending = Array.from({ length: PENDING_SLOTS }, createPending);
        this.fronts = Array.from({ length: FRONT_SLOTS }, createFront);
        this.beadLit = new Float32Array(RING.beads);
        this._post = {
            heart: this.heart,
            flash: 0,
            kick: 0,
            rays: 0.1,
            streak: 0.1,
            bloomBoost: 0,
            exposure: 1,
            fall: 0,
            ripple: { radius: 0, strength: 0 },
        };
        this.resetState(0);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.combo = 0;
        this.heat = 0;
        this.surge = 0;
        this.storm = 0;
        this.level = 1;
        this.paletteIndex = 0;
        this.flash = 0;
        this.kick = 0;
        this.dip = 0;
        this.pulse = 0;
        this.breath = 1;
        this.twist = 0;
        this.twistVelocity = 0;
        this.ringFlare = 0;
        this.impactCursor = 0;
        this.random = mulberry32(this.seed);
        /**
         * The last detonation (the moment of its flash, how hard) and the next one: `next` is
         * the moment a collapse under way will flash at, Infinity when none is.
         */
        this.nova = {
            birth: -1000, strength: 0, next: Infinity, twist: false,
        };
        this.blast = { birth: -1000, strength: 0 };
        this.spaceRipple = { birth: -1000, strength: 0 };
        this.lastClear = { time: -1000, lines: 0 };
        this.pulsarPhase = 0;
        this.counts = {
            locks: 0, clears: 0, novas: 0, streams: 0, impacts: 0, fronts: 0, aftershocks: 0,
        };
        // The slow clocks are functions of the world clock until gameplay bends them.
        const motion = this.reducedMotion ? 0.3 : 1;
        this.spin = time * STAR.spin * motion;
        this.boil = time * motion;
        this.flow = time * motion;
        this.drift = time;
        // The palette's own clock: it turns the colours through their cycle whatever the level.
        this.hueClock = time;
        this.ringTurn = time * 0.035 * motion;
        this.loopBeat = Math.floor(time / LOOP_BEAT);
        for (let i = 0; i < this.pending.length; i++) this.pending[i].live = false;
        for (let i = 0; i < this.fronts.length; i++) {
            this.fronts[i].birth = -100;
            this.fronts[i].strength = 0;
        }
        this.beadLit.fill(0);
        this.loops?.reset();
        this.streams?.reset();
        this.sparks?.reset();
        if (this.u) {
            for (let i = 0; i < IMPACT_SLOTS; i++) {
                this.u.impactA[i].value.set(0, 1, 0, -100);
                this.u.impactC[i].value.set(1, 1, 1, 0);
            }
            this.u.echo.value.set(-100, 0, 0.9, 0.05);
            this.u.shellCount.value = 0;
        }
    }

    build() {
        const noise = createNoise3DTexture(bakeNoise3D(this.seed));
        this.textures.push(noise);
        const u = createSupernovaUniforms({ noise });
        this.u = u;
        const { tier } = this;

        this.addPart('sky', createSky(u, { layers: tier.skyLayers, clouds: tier.skyClouds }));
        this.addPart('nebula', createNebula(u, { detail: tier.nebulaDetail }));
        this.addPart('beams', createBeams(u));
        this.addPart('star', createStar(u, { detail: tier.starDetail, spikes: tier.spikes }));
        this.addPart('ring', createRing(u));
        this.loops = createLoops(u, tier.loops);
        this.addPart('loops', this.loops);
        this.addPart('embers', createEmbers(u, tier.embers, this.seed ^ 0xe3be5));

        // ── Gameplay effects (pools, always drawn) ──
        this.streams = createStreams(u);
        this.addPart('streams', this.streams);
        this.sparks = createSparks(u, tier.sparks);
        this.addPart('sparks', this.sparks);

        this.applyPalette(1);
        this.compose();
        this.pose();
        this.seedLoops();
        this.writeShells(this.time);
        this.scene.add(this.root);
        return this;
    }

    addPart(name, part) {
        this.parts[name] = part;
        this.root.add(part.mesh);
        this.disposables.push(part);
    }

    /** Draw only the named parts (captures, bisecting a look). */
    showOnlyParts(names) {
        const keep = new Set(names);
        Object.keys(this.parts).forEach((name) => {
            this.parts[name].mesh.visible = keep.has(name);
        });
    }

    setViewport(bufferWidth, bufferHeight, aspect) {
        if (this.u && bufferWidth > 0 && bufferHeight > 0) this.u.viewport.value.set(bufferWidth, bufferHeight);
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) {
            this.aspect = aspect;
            this.compose();
        }
        if (!this.layoutLive) this.layout = fallbackLayout(this.aspect * 1000, 1000);
        this.updatePixelAngle();
    }

    /**
     * The live board / card / HUD rects (screen fractions), or null when no board is on screen:
     * events then aim at where the solo board would be.
     */
    setLayout(rects, aspect) {
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) {
            this.aspect = aspect;
            this.compose();
            this.updatePixelAngle();
        }
        this.layoutLive = Boolean(rects);
        this.layout = rects || fallbackLayout(this.aspect * 1000, 1000);
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Jump the clock (captures): drops every event in flight. */
    seek(time) {
        this.resetState(Number.isFinite(time) ? Math.max(0, time) : 0);
        this.applyPalette(1);
        // Until a frame says otherwise the eye is where the rest camera stands.
        this._toCam.copy(this._centre).normalize().negate();
        this.pose();
        this.seedLoops();
        this.writeShells(this.time);
    }

    /** A new run: the star back at rest (it keeps turning). */
    resetSession() {
        const {
            time, spin, boil, flow, drift, hueClock, ringTurn, loopBeat,
        } = this;
        this.resetState(time);
        Object.assign(this, {
            spin, boil, flow, drift, hueClock, ringTurn, loopBeat,
        });
        this.applyPalette(1);
        this.pose();
        this.seedLoops();
        this.writeShells(this.time);
    }

    /** Nothing here is layered; kept so the theme and the playground bind every world alike. */
    bindCamera(camera) {
        this._camera = camera;
    }

    updatePixelAngle() {
        if (!this.u) return;
        const height = Math.max(1, this.u.viewport.value.y);
        this.u.pixelAngle.value = (2 * Math.tan((fovForAspect(this.aspect) * DEG) / 2)) / height;
    }

    // ── The star's place and pose ───────────────────────────────────────────────

    /** The rest camera for the current aspect (what the composition is measured in). */
    restCamera() {
        const cam = this._rest;
        cam.fov = fovForAspect(this.aspect);
        cam.aspect = this.aspect;
        cam.near = REST_RIG.near;
        cam.far = REST_RIG.far;
        cam.updateProjectionMatrix();
        cam.position.set(0, 0, 0);
        cam.up.set(0, 1, 0);
        cam.lookAt(0, 0, -10);
        cam.updateMatrixWorld();
        return cam;
    }

    /** Hang the star where the composition wants it for this aspect. */
    compose() {
        this.anchors = starAnchors(this.aspect);
        const a = this.anchors;
        const tanV = Math.tan((fovForAspect(this.aspect) * DEG) / 2);
        const cam = this.restCamera();
        this._centre.set(a.x * 2 - 1, 1 - a.y * 2, 0.5).unproject(cam).normalize();
        // Its size on screen is set by its depth along the lens's axis, not by how far away it
        // is: off to one side it has to stand a little further off to look the same size.
        this.distance = STAR.radius / (a.radius * 2 * tanV) / Math.max(0.2, -this._centre.z);
        this._centre.multiplyScalar(this.distance);
        this._toCam.copy(this._centre).normalize().negate();
        this.heart.x = a.x;
        this.heart.y = a.y;
        if (this.u) this.u.centre.value.copy(this._centre);
    }

    /**
     * Stand the star's frame for this moment: its axis leans from the screen's up and nods a
     * little toward the eye, it turns about that axis, and it has the size this moment gives it.
     * The ring's plane leans back from the line of sight and sways a few degrees.
     */
    pose() {
        const { u } = this;
        if (!u) return;
        const t = this.time;
        const calm = this.reducedMotion ? 0 : 1;
        this._tilt.makeRotationZ(STAR.tilt + Math.sin(t * 0.031) * 0.05 * calm);
        this._spin.makeRotationX(0.3);
        this._rot4.copy(this._tilt).multiply(this._spin);
        this._spin.makeRotationY(this.spin);
        this._rot4.multiply(this._spin);
        this._rot3.setFromMatrix4(this._rot4);
        this._inv3.copy(this._rot3).transpose();
        u.starRot.value.copy(this._rot3);
        u.starInv.value.copy(this._inv3);

        const swell = Math.sin(this.boil * 0.9) * 0.008 + Math.sin(this.boil * 2.3 + 1.1) * 0.004;
        const breathe = 1 + swell * (1 + this.heat * 2);
        const hold = this.reducedMotion ? 0.12 : COLLAPSE_HOLD;
        // What the last flash left, swelling back; and the fall toward the next one, from
        // whatever size the star has when the fall begins.
        const kindled = collapseScale(t, this.nova.birth, hold);
        const toFlash = this.nova.next - t;
        const fall = toFlash > 0 && toFlash < hold ? (1 - toFlash / hold) ** 3 : 0;
        const size = kindled + (COLLAPSED_SIZE - kindled) * fall;
        this.starR = STAR.radius * size * breathe * (1 + this.pulse * 0.045);
        u.starR.value = this.starR;

        const ring = this.parts.ring?.mesh;
        if (ring) {
            // The ring's normal: toward the eye, leaned back by its inclination and rolled.
            const f = this._toCam;
            const right = this._e1.set(0, 1, 0).cross(f).normalize();
            const up = this._e2.copy(f).cross(right).normalize();
            const roll = -0.42 + Math.sin(t * 0.027 + 0.6) * 0.05 * calm;
            const lean = RING.inclination + Math.sin(t * 0.041) * 0.035 * calm;
            const tip = this._e3.copy(up).multiplyScalar(Math.cos(roll)).addScaledVector(right, Math.sin(roll));
            const normal = this._vec.copy(f).multiplyScalar(Math.cos(lean)).addScaledVector(tip, Math.sin(lean))
                .normalize();
            const major = this._vec2.copy(right).multiplyScalar(Math.cos(roll)).addScaledVector(up, -Math.sin(roll))
                .normalize();
            const minor = this._e3.copy(normal).cross(major).normalize();
            this._ringFrame.makeBasis(major, minor, normal).setPosition(this._centre);
            ring.matrix.copy(this._ringFrame);
            ring.matrixWorld.copy(this._ringFrame);
        }
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        if (!Number.isFinite(sim.time)) return;
        const t = sim.time;
        const calm = this.reducedMotion ? 0 : 1;
        const fov = fovForAspect(this.aspect) - this.kick * 0.5 * calm;
        if (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        // A slow drift plus the pointer leaning the view: the near filaments slide across the
        // star, the star across the far clouds.
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        this._pointer.x = px;
        this._pointer.y = py;
        const d = this.distance;
        const swayX = (Math.sin(t * 0.057) * 0.009 + Math.sin(t * 0.023 + 1.3) * 0.006) * d * calm;
        const swayY = (Math.sin(t * 0.041 + 0.7) * 0.006 + Math.sin(t * 0.017) * 0.004) * d * calm;
        camera.position.set(swayX + px * 0.022 * d, swayY - py * 0.014 * d, this.kick * 0.016 * d * calm);
        const yaw = (Math.sin(t * 0.035 + 2.1) * 0.005 - px * 0.01) * calm;
        const pitch = (Math.sin(t * 0.027) * 0.0035 - py * 0.007) * calm;
        this._look.set(
            camera.position.x + Math.sin(yaw) * 10,
            camera.position.y + Math.tan(pitch) * 10,
            camera.position.z - 10,
        );
        camera.up.set(Math.sin(t * 0.021) * 0.01 * calm, 1, 0);
        camera.lookAt(this._look);
        camera.updateMatrixWorld();
        this._camera = camera;
    }

    /** The world point `depth` along the ray through a screen point (fractions, y down). */
    screenToWorld(sx, sy, depth, out = this._from) {
        const camera = this._camera;
        if (!camera) {
            out[0] = 0;
            out[1] = 0;
            out[2] = -depth;
            return out;
        }
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        out[0] = camera.position.x + this._ray.x * depth;
        out[1] = camera.position.y + this._ray.y * depth;
        out[2] = camera.position.z + this._ray.z * depth;
        return out;
    }

    // ── Bookkeeping: what is due later, what is running through the nebula ───────

    /** Queue something for a later moment of the world clock. */
    schedule(kind, time, {
        dir = null, rgb = null, amount = 1, lines = 1, flag = 0,
    } = {}) {
        let slot = null;
        for (let i = 0; i < this.pending.length; i++) {
            if (!this.pending[i].live) {
                slot = this.pending[i];
                break;
            }
        }
        // Full: one more lock is not queued. A clear or a detonation is never dropped: it takes
        // the place of the lock that would have landed last (the stream nearest the star keeps
        // its answer).
        if (!slot) {
            if (kind === KIND_IMPACT) return false;
            for (let i = 0; i < this.pending.length; i++) {
                const p = this.pending[i];
                if (p.kind === KIND_IMPACT && (!slot || p.time > slot.time)) slot = p;
            }
        }
        if (!slot) return false;
        slot.live = true;
        slot.time = time;
        slot.kind = kind;
        slot.amount = amount;
        slot.lines = lines;
        slot.flag = flag;
        if (dir) {
            slot.dir[0] = dir[0];
            slot.dir[1] = dir[1];
            slot.dir[2] = dir[2];
        }
        if (rgb) {
            slot.rgb[0] = rgb[0];
            slot.rgb[1] = rgb[1];
            slot.rgb[2] = rgb[2];
        }
        return true;
    }

    /** Whatever has come due, oldest first, each as of its own moment. */
    runPending(t) {
        for (;;) {
            let next = null;
            for (let i = 0; i < this.pending.length; i++) {
                const p = this.pending[i];
                if (p.live && p.time <= t && (!next || p.time < next.time)) next = p;
            }
            if (!next) return;
            next.live = false;
            if (next.kind === KIND_IMPACT) this.impact(next);
            else if (next.kind === KIND_SHOCK) this.shock(next);
            else if (next.kind === KIND_DETONATE) this.detonate(next);
        }
    }

    /** Send a front out through the nebula from the star. */
    front({
        birth, strength, rgb, reach = 21, tau = 1.15, fade = 1.5, skin = 0.04, stir = 1,
    }) {
        // The faintest front gives way (one not yet born counts as bright: it is about to be).
        let f = this.fronts[0];
        let least = Infinity;
        for (let i = 0; i < FRONT_SLOTS; i++) {
            const other = this.fronts[i];
            const light = other.birth > this.time ? other.strength : this.frontLight(other, this.time);
            if (light < least) {
                least = light;
                f = other;
            }
        }
        // Fainter than every front already running: it would not be seen, and must not put one out.
        if (least > strength) return;
        f.birth = birth;
        f.strength = strength;
        f.reach = reach;
        f.tau = tau;
        f.fade = fade;
        f.skin = skin;
        f.stir = stir;
        f.rgb[0] = rgb[0];
        f.rgb[1] = rgb[1];
        f.rgb[2] = rgb[2];
        this.counts.fronts += 1;
    }

    /** How much light a front still carries at `t`. */
    frontLight(f, t) {
        const age = t - f.birth;
        if (age < 0 || f.strength <= 0) return 0;
        return f.strength * Math.exp(-age / f.fade);
    }

    /** A world direction as a unit vector of the star's frame. */
    toStarFrame(v, out = [0, 0, 0]) {
        const e = this._inv3.elements;
        out[0] = e[0] * v.x + e[3] * v.y + e[6] * v.z;
        out[1] = e[1] * v.x + e[4] * v.y + e[7] * v.z;
        out[2] = e[2] * v.x + e[5] * v.y + e[8] * v.z;
        return out;
    }

    /** A unit vector of the star's frame as a world direction. */
    toWorld(d, out = this._vec) {
        const e = this._rot3.elements;
        return out.set(
            e[0] * d[0] + e[3] * d[1] + e[6] * d[2],
            e[1] * d[0] + e[4] * d[1] + e[7] * d[2],
            e[2] * d[0] + e[5] * d[1] + e[8] * d[2],
        );
    }

    /**
     * A point of the star's surface the eye can see, as a world unit normal: `bearing` round
     * the disc (radians, 0 = screen right), `inward` 0 = on the limb, 1 = the middle of the disc.
     */
    visibleSite(bearing, inward, out = this._vec) {
        const f = this._toCam;
        const right = this._e1.set(0, 1, 0).cross(f).normalize();
        const up = this._e2.copy(f).cross(right).normalize();
        const k = Math.sqrt(Math.max(0, 1 - inward * inward));
        return out.copy(right).multiplyScalar(Math.cos(bearing) * k)
            .addScaledVector(up, Math.sin(bearing) * k)
            .addScaledVector(f, inward)
            .normalize();
    }

    /** Raise one of the star's own prominences: number `index` of an endless, seeded series. */
    ambientLoop(index, time) {
        if (!this.loops) return;
        const rand = mulberry32(0x100b + index * 2654435761);
        const bearing = rand() * TAU;
        const site = this.visibleSite(bearing, -0.08 + rand() * 0.45);
        const mid = this.toStarFrame(site);
        // Its feet lie along the limb, so the arch is seen from the side.
        const tangentWorld = this._vec2.copy(this._toCam).cross(site).normalize();
        if (rand() < 0.35) tangentWorld.applyAxisAngle(site, (rand() - 0.5) * 1.6);
        const tangent = this.toStarFrame(tangentWorld);
        const p = this._palette;
        const pick = rand();
        const rgb = [0, 1, 2].map((c) => p.starMid[c] * (1 - pick) + p.starHot[c] * pick * 0.8 + p.starDeep[c] * 0.3);
        this.loops.spawn({
            mid,
            tangent,
            span: 0.16 + rand() * 0.22,
            height: (0.22 + rand() ** 2 * 0.6) * (1 + this.heat * 0.6),
            lean: (rand() - 0.5) * 0.9,
            width: 0.05 + rand() * 0.05,
            rgb,
            time,
            life: LOOP_LIFE * (0.9 + rand() * 0.7),
            seed: rand(),
        });
    }

    /** After a jump of the clock: the prominences that would be standing now. */
    seedLoops() {
        if (!this.loops) return;
        const now = Math.floor(this.time / LOOP_BEAT);
        for (let i = Math.max(0, now - 3); i <= now; i++) this.ambientLoop(i, i * LOOP_BEAT);
        this.loopBeat = now;
    }

    // ── Gameplay ────────────────────────────────────────────────────────────────

    /** Where on the card's edge a stream leaves for a board point (screen fractions). */
    launchPoint(player, u, row, out = this._launch) {
        const board = boardFor(this.layout, player);
        const card = cardUnion(this.layout) || board;
        if (!board || !card) {
            out.x = 0.5;
            out.y = 0.6;
            out.top = false;
            return out;
        }
        boardPoint(board, u, row, this._point);
        const h = this.heart;
        // `top`: it leaves by the card's top or bottom edge, where a column sets its place.
        out.top = false;
        if (h.x < card.x0) {
            out.x = card.x0;
            out.y = this._point.y;
        } else if (h.x > card.x1) {
            out.x = card.x1;
            out.y = this._point.y;
        } else if (h.y < card.y0) {
            out.x = this._point.x;
            out.y = card.y0;
            out.top = true;
        } else if (h.y > card.y1) {
            out.x = this._point.x;
            out.y = card.y1;
            out.top = true;
        } else {
            out.x = this._point.x;
            out.y = this._point.y;
        }
        return out;
    }

    /**
     * Send one stream from a screen point into the star. Returns its landing time. A piece's
     * stream (`kind` 0) lands as an impact; a cleared row's (`kind` 1) only arrives.
     */
    sendStream(sx, sy, rgb, amount, kind = 0, flightOverride = null) {
        if (!this.streams || !this.u) return this.time;
        const from = this.screenToWorld(sx, sy, this.distance * STREAM_DEPTH);
        const rand = this.random;
        // It lands on the side of the star that faces both the eye and where it came from.
        const fromDir = this._vec2.set(from[0], from[1], from[2]).sub(this._centre);
        const dist = fromDir.length();
        fromDir.normalize();
        const f = this._toCam;
        const sideways = this._e3.copy(fromDir).addScaledVector(f, -fromDir.dot(f));
        if (sideways.lengthSq() < 1e-6) sideways.set(1, 0, 0);
        sideways.normalize();
        const right = this._e1.set(0, 1, 0).cross(f).normalize();
        const up = this._e2.copy(f).cross(right);
        const bearing = Math.atan2(sideways.dot(up), sideways.dot(right)) + (rand() - 0.5) * 1.5;
        const site = this.visibleSite(bearing, 0.25 + rand() * 0.5);
        let flight = flightOverride ?? STREAM_FLIGHT * (0.86 + rand() * 0.3);
        if (this.reducedMotion) flight = Math.min(flight, 0.14);
        const land = this.time + flight;
        const dir = this.toStarFrame(site);
        // The star will have turned a little by then: aim at where the spot will be.
        const turn = -STAR.spin * flight;
        const cx = dir[0] * Math.cos(turn) + dir[2] * Math.sin(turn);
        const cz = dir[2] * Math.cos(turn) - dir[0] * Math.sin(turn);
        dir[0] = cx;
        dir[2] = cz;
        // The path bows out of the straight line, toward the eye and round the star.
        const swing = this._ray.copy(f).cross(sideways)
            .multiplyScalar((rand() < 0.5 ? -1 : 1) * dist * (0.12 + rand() * 0.14));
        const bow = [
            swing.x + f.x * dist * 0.1,
            swing.y + f.y * dist * 0.1,
            swing.z + f.z * dist * 0.1,
        ];
        this.streams.launch({
            from,
            dir,
            bow: kind === 1 ? [bow[0] * 0.3, bow[1] * 0.3, bow[2] * 0.3] : bow,
            rgb,
            time: this.time,
            flight,
            size: (kind === 1 ? 0.08 : 0.1) + amount * 0.07,
            kind,
        });
        this.counts.streams += 1;
        if (kind === 0) {
            this.schedule(KIND_IMPACT, land, { dir, rgb, amount });
            // A few sparks where it tears away from the card, thrown the way it is going.
            if (this.sparks && !this.reducedMotion) {
                this.sparks.emit({
                    x: from[0],
                    y: from[1],
                    z: from[2],
                    n: (3 + 3 * amount) * (this.sparks.count / 800),
                    rgb,
                    time: this.time,
                    axis: [-fromDir.x, -fromDir.y, -fromDir.z],
                    spread: 0.45,
                    out: [1.5, 5],
                    life: [0.25, 0.6],
                    size: 0.022,
                });
            }
        }
        return land;
    }

    /** A stream has landed: the star answers where it came down. */
    impact(ev) {
        const { u } = this;
        if (!u) return;
        const slot = this.impactCursor % IMPACT_SLOTS;
        this.impactCursor += 1;
        u.impactA[slot].value.set(ev.dir[0], ev.dir[1], ev.dir[2], ev.time);
        u.impactC[slot].value.set(ev.rgb[0], ev.rgb[1], ev.rgb[2], Math.min(1.6, 0.75 + ev.amount * 0.3));
        const rand = this.random;
        const normal = this.toWorld(ev.dir, this._vec);
        // A prominence where it came down, in the piece's colour (a hard drop's two side streams
        // raise none: three arches from one piece would push the star's own off its limb).
        if (this.loops && ev.amount >= 0.8) {
            const any = Math.abs(ev.dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
            let tx = ev.dir[1] * any[2] - ev.dir[2] * any[1];
            let ty = ev.dir[2] * any[0] - ev.dir[0] * any[2];
            let tz = ev.dir[0] * any[1] - ev.dir[1] * any[0];
            const tl = Math.hypot(tx, ty, tz) || 1;
            tx /= tl;
            ty /= tl;
            tz /= tl;
            // Turn the feet's line round the spot by a random angle.
            const a = rand() * TAU;
            const bx = ev.dir[1] * tz - ev.dir[2] * ty;
            const by = ev.dir[2] * tx - ev.dir[0] * tz;
            const bz = ev.dir[0] * ty - ev.dir[1] * tx;
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            this.loops.spawn({
                mid: ev.dir,
                tangent: [tx * ca + bx * sa, ty * ca + by * sa, tz * ca + bz * sa],
                span: 0.18 + rand() * 0.16,
                height: (0.42 + rand() * 0.45) * Math.sqrt(ev.amount),
                lean: (rand() - 0.5) * 0.8,
                width: 0.07 + ev.amount * 0.025,
                rgb: ev.rgb,
                time: ev.time,
                life: LOOP_LIFE * (0.8 + rand() * 0.5),
                seed: rand(),
            });
        }
        if (this.sparks) {
            const share = this.sparks.count / 800;
            this.sparks.emit({
                x: this._centre.x + normal.x * this.starR,
                y: this._centre.y + normal.y * this.starR,
                z: this._centre.z + normal.z * this.starR,
                n: (9 + 13 * ev.amount) * share,
                rgb: ev.rgb,
                time: ev.time,
                axis: [normal.x, normal.y, normal.z],
                spread: 0.6,
                out: [1.2, 4.5 + ev.amount * 2.5],
                life: [0.45, 1.1],
                size: 0.03,
                from: 0.03,
            });
        }
        // Its colour runs out through the nebula as an echo.
        this.front({
            birth: ev.time,
            strength: 0.5 * ev.amount,
            rgb: ev.rgb,
            reach: 20,
            tau: 0.7,
            fade: 1.0,
            skin: 0.045,
            stir: 0.55,
        });
        const late = Math.max(0, this.time - ev.time);
        this.pulse = Math.max(this.pulse, 0.22 * ev.amount * Math.exp(-late / PULSE_COOL));
        this.flash = Math.max(this.flash, 0.03 * ev.amount * Math.exp(-late / 0.25));
        if (ev.amount > 1.2) this.kick = Math.max(this.kick, 0.4 * Math.exp(-late / 0.16));
        this.counts.impacts += 1;
    }

    /** The cleared rows have reached the star: it answers with a shock, one front per line. */
    shock(ev) {
        // The star is already falling in: these rows feed the collapse, and the flash is their
        // answer (a T-spin among them still winds the corona, with the flash).
        if (this.nova.next !== Infinity) {
            if (ev.flag & FLAG_TSPIN) this.nova.twist = true;
            return;
        }
        const n = Math.max(1, Math.min(4, ev.lines));
        const late = Math.max(0, this.time - ev.time);
        for (let k = 0; k < n; k++) {
            this.front({
                birth: ev.time + k * FRONT_GAP,
                strength: ev.amount * (1 - k * 0.1),
                rgb: ev.rgb,
                reach: 21 + n,
                tau: 1.15 - n * 0.06,
                fade: 1.5 + n * 0.12,
                skin: 0.065,
            });
        }
        this.pulse = Math.max(this.pulse, (0.5 + 0.2 * n) * Math.exp(-late / PULSE_COOL));
        this.kick = Math.max(this.kick, (0.24 + 0.1 * n) * Math.exp(-late / 0.16));
        this.flash = Math.max(this.flash, (0.1 + 0.05 * n) * Math.exp(-late / 0.25));
        this.storm = Math.max(this.storm, Math.min(1.3, 0.3 + 0.16 * n) * Math.exp(-late / STORM_COOL));
        if (ev.flag & FLAG_TSPIN) this.windCorona(ev.time);
        if (this.sparks) {
            const share = this.sparks.count / 800;
            this.sparks.emit({
                x: this._centre.x,
                y: this._centre.y,
                z: this._centre.z,
                n: (26 + 26 * n) * share,
                rgb: ev.rgb,
                time: ev.time,
                spread: 1,
                out: [2.5, 8 + n * 2.2],
                life: [0.7, 1.7],
                size: 0.032 + n * 0.003,
                from: this.starR * 1.02,
            });
        }
        // Prominences thrown up all round the limb, in the shock's colour.
        if (this.loops) {
            const rand = this.random;
            for (let k = 0; k < (n >= 3 ? 2 : 1); k++) {
                const site = this.visibleSite(rand() * TAU, rand() * 0.3);
                const mid = this.toStarFrame(site);
                const tangent = this.toStarFrame(this._vec2.copy(this._toCam).cross(site).normalize());
                this.loops.spawn({
                    mid,
                    tangent,
                    span: 0.26 + rand() * 0.26,
                    height: 0.45 + rand() * 0.55 + n * 0.08,
                    lean: (rand() - 0.5) * 1.1,
                    width: 0.08,
                    rgb: ev.rgb,
                    time: ev.time + k * 0.07,
                    life: LOOP_LIFE * 0.75,
                    seed: rand(),
                });
            }
        }
        if (ev.flag & FLAG_AFTERSHOCK) this.counts.aftershocks += 1;
    }

    /** A T-spin: the corona winds up and springs back, and a thin front leaves in the rim's colour. */
    windCorona(time) {
        this.twistVelocity += this.reducedMotion ? 1 : 4.2;
        this.front({
            birth: time,
            strength: 0.7,
            rgb: this._palette.rim,
            reach: 18,
            tau: 0.9,
            fade: 1.2,
            skin: 0.03,
            stir: 0.6,
        });
        this.storm = Math.max(this.storm, 0.8);
    }

    /** True when the star can go off: no collapse under way, and the last flash long enough ago. */
    canDetonate() {
        return this.nova.next === Infinity && this.time - this.nova.birth > NOVA_REARM;
    }

    /**
     * The star begins to fall in at `start`; it detonates COLLAPSE_HOLD later. `twist`: the clear
     * that set it off was a T-spin, so the corona winds with the flash.
     */
    beginCollapse(start, strength, twist = false) {
        const hold = this.reducedMotion ? 0.12 : COLLAPSE_HOLD;
        this.nova.next = start + hold;
        this.nova.twist = twist;
        if (!this.schedule(KIND_DETONATE, this.nova.next, { amount: strength })) this.nova.next = Infinity;
    }

    /** The flash. */
    detonate(ev) {
        const { u } = this;
        if (!u) return;
        const t0 = ev.time;
        const strength = ev.amount;
        const late = Math.max(0, this.time - t0);
        this.nova.birth = t0;
        this.nova.strength = strength;
        this.nova.next = Infinity;
        if (this.nova.twist) {
            this.nova.twist = false;
            this.windCorona(t0);
        }
        this.blast.birth = t0;
        this.blast.strength = strength;
        // Three fronts, each a little slower than the last: the flash's own white, then the two
        // colours the old star's gas burned in.
        const hues = [STARFIRE, this._palette.gasC, this._palette.gasA];
        for (let k = 0; k < 3; k++) {
            this.front({
                birth: t0 + k * 0.11,
                strength: 1.7 * strength * (1 - k * 0.15),
                rgb: hues[k],
                reach: 26,
                tau: 0.8 + k * 0.1,
                fade: 1.5,
                skin: 0.06 - k * 0.008,
            });
        }
        u.echo.value.set(t0, strength, 0.85, 0.045);
        u.echoCol.value.set(STARFIRE[0], STARFIRE[1], STARFIRE[2]);
        this.spaceRipple.birth = t0;
        this.spaceRipple.strength = this.reducedMotion ? 0.2 : 1;
        this.surge = Math.max(this.surge, strength * Math.exp(-late / SURGE_COOL));
        this.storm = Math.max(this.storm, 1.3 * Math.exp(-late / STORM_COOL));
        this.flash = Math.max(this.flash, Math.exp(-late / 0.25));
        this.kick = Math.max(this.kick, Math.exp(-late / 0.16));
        // The old star's surface is gone, and its prominences with it.
        for (let i = 0; i < IMPACT_SLOTS; i++) u.impactC[i].value.w = 0;
        this.loops?.reset();
        if (this.sparks) {
            const pool = this.sparks.count;
            this.sparks.emit({
                x: this._centre.x,
                y: this._centre.y,
                z: this._centre.z,
                n: pool * 0.62,
                rgb: STARFIRE,
                time: t0,
                spread: 1,
                out: [4, 27],
                life: [1.3, 3.4],
                size: 0.05,
                stagger: 0.1,
                from: 0.25,
            });
            this.sparks.emit({
                x: this._centre.x,
                y: this._centre.y,
                z: this._centre.z,
                n: pool * 0.22,
                rgb: this._palette.gasA,
                time: t0 + 0.05,
                spread: 1,
                out: [2, 12],
                life: [1.8, 3.8],
                size: 0.06,
                stagger: 0.25,
                from: 0.25,
            });
        }
        this.counts.novas += 1;
    }

    /**
     * A piece locked. `u` = its column as a fraction of the board width, `rows` = the visible
     * rows it covers, `color` = the piece's colour; `screen` (fractions) replaces the board point.
     */
    onLock({
        u = 0.5, rows = null, hardDrop = false, color = null, player = 0, screen = null,
    } = {}) {
        if (!this.u || !this.streams) return;
        const rgb = pieceColor(color);
        const point = screen && Number.isFinite(screen.x) && Number.isFinite(screen.y) ? screen : null;
        let sx;
        let sy;
        let top = false;
        if (point) {
            sx = point.x;
            sy = point.y;
        } else {
            const row = Array.isArray(rows) && rows.length ? rows[Math.floor(rows.length / 2)] : 19;
            const at = this.launchPoint(player, u, row);
            sx = at.x;
            sy = at.y;
            ({ top } = at);
        }
        this.sendStream(sx, sy, rgb, hardDrop ? 1.5 : 1);
        if (hardDrop) {
            // Two more beside it, along the edge they leave by.
            const dx = top ? 0.03 : 0;
            const dy = top ? 0 : 0.022;
            this.sendStream(sx - dx, sy - dy, rgb, 0.7);
            this.sendStream(sx + dx, sy + dy, rgb, 0.7);
        }
        this.kick = Math.max(this.kick, hardDrop ? 0.32 : 0.06);
        this.flash = Math.max(this.flash, hardDrop ? 0.06 : 0.01);
        this.counts.locks += 1;
    }

    /**
     * Lines cleared. `lines` 1..4; `tspin`, `perfect`; `rows` = the visible rows that went.
     */
    onClear({
        rows = null, lines = 1, tspin = false, perfect = false, player = 0, screen = null,
    } = {}) {
        const { u } = this;
        if (!u || !this.streams) return;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        const p = this._palette;
        // One line answers in the nebula's second colour, two in its first, three in its third.
        let rgb;
        if (quad) rgb = [...STARFIRE];
        else if (n === 1) rgb = [...p.gasB];
        else if (n === 2) rgb = [...p.gasA];
        else rgb = [...p.gasC];
        const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
        rgb = rgb.map((c) => (c / peak) * 0.92 + 0.08);

        // ── The cleared rows go into the star ──
        const flight = this.reducedMotion ? 0.08 : ROW_FLIGHT;
        const rowTint = [0, 1, 2].map((c) => rgb[c] * 0.6 + 0.4);
        const point = screen && Number.isFinite(screen.x) && Number.isFinite(screen.y) ? screen : null;
        if (point) {
            this.sendStream(point.x, point.y, rowTint, 1, 1, flight);
        } else {
            const list = Array.isArray(rows) && rows.length ? rows : Array.from({ length: n }, (_, i) => 19 - i);
            const count = Math.min(4, list.length);
            for (let i = 0; i < count; i++) {
                // Beside the card each row leaves at its own height; where they leave by the
                // card's top edge (a phone) they are spread along it instead.
                const at = this.launchPoint(player, 0.5 + (i - (count - 1) / 2) * 0.16, list[i]);
                this.sendStream(at.x, at.y, rowTint, 1, 1, flight + i * 0.018);
            }
        }
        const arrive = this.time + flight;

        if (quad && this.canDetonate()) {
            this.beginCollapse(arrive, perfect ? 1.3 : 1, tspin);
        } else {
            // A second four lines too soon after the first: the newborn star answers with an
            // aftershock instead of going off again.
            const strength = Math.min(1.6, 0.62 + 0.16 * n + (quad ? 0.4 : 0));
            this.schedule(KIND_SHOCK, arrive, {
                rgb,
                amount: strength,
                lines: quad ? 4 : n,
                // A T-spin winds the corona when the rows arrive, with the shock.
                flag: (quad ? FLAG_AFTERSHOCK : 0) | (tspin ? FLAG_TSPIN : 0),
            });
        }
        this.lastClear = { time: arrive, lines: n };
        this.counts.clears += 1;
    }

    /**
     * The true combo changed (0 = the chain broke). `silent`: hold a chain of this length
     * without anything having happened (captures of a held chain).
     */
    onCombo(combo, { silent = false } = {}) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        if (silent) {
            this.combo = n;
            return;
        }
        // The chain broke: the star lets its breath go as one soft front.
        if (n === 0 && this.combo >= 2) {
            this.dip = Math.max(this.dip, 0.25);
            this.front({
                birth: this.time,
                strength: 0.3 + Math.min(0.5, this.combo * 0.06),
                rgb: this._palette.corona,
                reach: 16,
                tau: 1.6,
                fade: 1.8,
                skin: 0.1,
                stir: 0.4,
            });
        }
        if (n >= 2 && n > this.combo) {
            this.pulse = Math.max(this.pulse, 0.3);
            this.flash = Math.max(this.flash, 0.04);
            // Every step of the chain throws up a taller prominence than the last.
            if (this.loops) {
                const rand = this.random;
                const site = this.visibleSite(rand() * TAU, rand() * 0.2);
                const mid = this.toStarFrame(site);
                const tangent = this.toStarFrame(this._vec2.copy(this._toCam).cross(site).normalize());
                const p = this._palette;
                this.loops.spawn({
                    mid,
                    tangent,
                    span: 0.2 + rand() * 0.14,
                    height: Math.min(1.9, 0.7 + n * 0.14),
                    lean: (rand() - 0.5) * 0.6,
                    width: 0.09,
                    rgb: [0, 1, 2].map((c) => p.starHot[c] * 0.6 + p.rim[c] * 0.4),
                    time: this.time,
                    life: LOOP_LIFE * 0.8,
                    seed: rand(),
                });
            }
        }
        // A long enough chain sets the star off by itself.
        if (n >= CRITICAL_COMBO && this.combo < CRITICAL_COMBO && this.canDetonate()) {
            // The clear that got it there is still on its way to the star: the fall begins when
            // its rows arrive, and the shock they would have set off gives way to the flash.
            let twist = false;
            for (let i = 0; i < this.pending.length; i++) {
                const queued = this.pending[i];
                if (queued.live && queued.kind === KIND_SHOCK && queued.time >= this.time) {
                    queued.live = false;
                    if (queued.flag & FLAG_TSPIN) twist = true;
                }
            }
            this.beginCollapse(Math.max(this.time, this.lastClear.time), 1.15, twist);
        }
        this.combo = n;
    }

    /**
     * A new level: the star burns a heavier element, and its colours move one palette on from
     * wherever time has carried them.
     */
    levelUp(level, { silent = false } = {}) {
        const wanted = Number(level);
        this.level = Number.isFinite(wanted) ? Math.max(1, Math.min(9999, Math.round(wanted))) : 1;
        this.paletteIndex = (this.level - 1) % SUPERNOVA_PALETTES.length;
        if (silent) this.applyPalette(1);
        else {
            const next = this.paletteTarget();
            this.storm = Math.max(this.storm, 0.75);
            this.flash = Math.max(this.flash, 0.14);
            this.pulse = Math.max(this.pulse, 0.5);
            this.front({
                birth: this.time,
                strength: 0.9,
                rgb: next.rim,
                reach: 22,
                tau: 1.0,
                fade: 1.6,
                skin: 0.045,
            });
        }
    }

    /**
     * The palette the star is heading for at this moment: the level's, carried on through the
     * cycle by the hue clock, as a blend of two neighbours (a reused object).
     */
    paletteTarget() {
        const d = paletteDrift(this.level, this.hueClock, this._drift);
        const a = SUPERNOVA_PALETTES[d.from];
        const b = SUPERNOVA_PALETTES[d.to];
        const target = this._target;
        for (let i = 0; i < PALETTE_KEYS.length; i++) {
            const key = PALETTE_KEYS[i];
            for (let c = 0; c < 3; c++) target[key][c] = a[key][c] + (b[key][c] - a[key][c]) * d.blend;
        }
        return target;
    }

    /** Ease the live palette toward where it is heading (k = 1 snaps). */
    applyPalette(k) {
        const target = this.paletteTarget();
        const p = this._palette;
        for (let i = 0; i < PALETTE_KEYS.length; i++) {
            const key = PALETTE_KEYS[i];
            for (let c = 0; c < 3; c++) p[key][c] += (target[key][c] - p[key][c]) * k;
        }
    }

    // ── The nebula's shell table ────────────────────────────────────────────────

    /** Write every live shell into the table the nebula's shader walks. Returns the row count. */
    writeShells(t) {
        const { u } = this;
        if (!u) return 0;
        const rows = u.shellRows;
        const p = this._palette;
        let r = 0;
        const put = (a, b, c, d, e) => {
            const o = r * SHELL_STRIDE;
            rows[o].set(a[0], a[1], a[2], a[3]);
            rows[o + 1].set(b[0], b[1], b[2], b[3]);
            rows[o + 2].set(c[0], c[1], c[2], c[3]);
            rows[o + 3].set(d[0], d[1], d[2], d[3]);
            rows[o + 4].set(e[0], e[1], e[2], e[3]);
            r += 1;
        };

        // ── The standing shells ──
        const count = this.tier.shells;
        const lift = 1 + this.heat * 0.3 + this.surge * 0.5 + this.storm * 0.1;
        let ring = 0;
        for (let k = 0; k < count; k++) {
            const phase = shellPhase(k, count, this.drift);
            const radius = shellRadius(phase);
            const [keyA, keyB] = SHELL_HUES[k % SHELL_HUES.length];
            const colA = [p[keyA][0], p[keyA][1], p[keyA][2]];
            const colB = [p[keyB][0], p[keyB][1], p[keyB][2]];
            // What the fronts running through the nebula do to this shell.
            let energy = 0;
            for (let i = 0; i < FRONT_SLOTS; i++) {
                const f = this.fronts[i];
                const light = this.frontLight(f, t);
                if (light < FRONT_FLOOR) continue;
                const age = t - f.birth;
                const at = frontRadius(age, f.reach, f.tau);
                const x = (at - radius) / (0.9 + radius * 0.1);
                const crossing = Math.max(0, 1 - Math.abs(x)) ** 2;
                const since = age - frontPassTime(radius, f.reach, f.tau);
                const after = since > 0 ? Math.exp(-since / 0.7) * 0.28 : 0;
                const w = Math.min(1.4, f.strength) * f.stir * (crossing * 1.3 + after);
                energy += w;
                for (let c = 0; c < 3; c++) {
                    colA[c] += f.rgb[c] * w * 0.8;
                    colB[c] += f.rgb[c] * w * 0.5;
                }
            }
            // However many fronts are in it at once, a shell can only flare so far.
            const flare = Math.min(1.5, energy);
            const norm = 1 / (1 + energy * 0.8);
            const gain = shellGain(phase) * 1.5 * lift * (1 + flare * 1.25);
            const seed = SHELL_SEEDS[k];
            put(
                [radius, 0.3 + phase * 0.08, 0.62 + k * 0.05, 7.5],
                [colA[0] * norm, colA[1] * norm, colA[2] * norm, gain],
                [colB[0] * norm, colB[1] * norm, colB[2] * norm, 0.44 + (k % 2) * 0.06],
                [0.26, k & 1, (k >> 1) & 1, 0],
                [seed[0], seed[1], seed[2], 0.6],
            );
        }

        // ── The fronts themselves ──
        for (let i = 0; i < FRONT_SLOTS; i++) {
            const f = this.fronts[i];
            const light = this.frontLight(f, t);
            if (light < FRONT_FLOOR) continue;
            const age = t - f.birth;
            const radius = frontRadius(age, f.reach, f.tau);
            // The front thins as it grows; it is brightest as it leaves.
            const gain = light * (1.1 + 2.4 * Math.exp(-age / 0.3))
                * (1 - smooth(NEBULA.outer * 0.9, NEBULA.outer * 1.25, radius));
            if (gain < FRONT_FLOOR) continue;
            ring += f.strength * Math.max(0, 1 - Math.abs((radius - RING.radius) / 0.8)) ** 2;
            put(
                [radius, f.skin, 0.7, 2.2],
                [f.rgb[0], f.rgb[1], f.rgb[2], gain],
                [f.rgb[0] * 0.6 + 0.4, f.rgb[1] * 0.6 + 0.4, f.rgb[2] * 0.6 + 0.4, 0.2],
                [0.07, i & 1, (i >> 1) & 1, 1],
                [0, 0, 0, 0],
            );
        }

        // ── A detonation's fireball ──
        const blastAge = t - this.blast.birth;
        if (blastAge >= 0 && blastAge < BLAST_LIVE) {
            const edge = blastRadius(blastAge);
            const hot = Math.exp(-blastAge / 2.4);
            // The same gas over a growing sphere: its light thins as the square of its size.
            const dying = 1 - smooth(BLAST_LIVE * 0.6, BLAST_LIVE, blastAge);
            const power = (this.blast.strength * 4.2 * Math.exp(-blastAge / 6) * dying) / (1 + (edge / 4.5) ** 2);
            for (let j = 0; j < BLAST_SHELLS; j++) {
                const [keyA, keyB] = SHELL_HUES[(j + 1) % SHELL_HUES.length];
                const colA = [0, 1, 2].map((c) => p[keyA][c] * (1 - hot) + STARFIRE[c] * hot);
                const colB = [0, 1, 2].map((c) => p[keyB][c] * (1 - hot * 0.7) + BLUEWHITE[c] * hot * 0.7);
                const seed = SHELL_SEEDS[STANDING_MAX + j];
                put(
                    [edge * BLAST_DEPTHS[j], 0.3, 0.8 + j * 0.2, 4.5],
                    [colA[0], colA[1], colA[2], power * (0.7 + j * 0.25)],
                    [colB[0], colB[1], colB[2], 0.4],
                    [0.55, j & 1, 1 - (j & 1), 0],
                    [seed[0], seed[1], seed[2], 0.6 * Math.exp(-blastAge / 5)],
                );
            }
        }
        u.shellCount.value = r;
        this.ringFlare = Math.min(1.6, ring);
        return r;
    }

    // ── Frame ───────────────────────────────────────────────────────────────────

    update(sim, camera = this._camera) {
        const { u } = this;
        if (!u) return;
        if (!Number.isFinite(sim.time)) return;
        const dt = Number.isFinite(sim.delta) ? Math.max(0, sim.delta) : 0;
        this.time = sim.time;
        const t = this.time;
        const motion = this.reducedMotion ? 0.3 : 1;
        const hurry = this.reducedMotion ? 0 : 1;

        // What is left of the last events, a frame on; then whatever has come due (each sets its
        // own values as of this moment, so it must come after the decays, and a flash moves the
        // star on in its life, so it must come before that is read).
        this.surge *= Math.exp(-dt / SURGE_COOL);
        this.storm *= Math.exp(-dt / STORM_COOL);
        this.flash *= Math.exp(-dt / 0.25);
        this.kick *= Math.exp(-dt / 0.16);
        this.dip *= Math.exp(-dt / 0.35);
        this.pulse *= Math.exp(-dt / PULSE_COOL);
        this.runPending(t);

        // ── Where the star is in its life ──
        const novaAge = t - this.nova.birth;
        const hold = this.reducedMotion ? 0.12 : COLLAPSE_HOLD;
        const toFlash = this.nova.next - t;
        const falling = toFlash > 0 && toFlash < hold ? 1 - toFlash / hold : 0; // 0 → 1 through the fall
        const newborn = novaAge >= 0 && novaAge < REKINDLE * 2 ? novaAge : -1;

        // ── The charge ──
        const target = heatForCombo(this.combo);
        this.heat += (target - this.heat) * approach(target > this.heat ? 2.6 : 0.9, dt);
        if (dt === 0 && this.capture) this.heat = target;

        // The corona's spring (semi-implicit, in small steps so a long frame cannot blow it up).
        let left = Math.min(dt, 0.1);
        while (left > 1e-5) {
            const h = Math.min(left, 1 / 120);
            this.twistVelocity += (-TWIST_STIFFNESS * this.twist - TWIST_DAMPING * this.twistVelocity) * h;
            this.twist += this.twistVelocity * h;
            left -= h;
        }

        // ── The slow clocks ──
        const afterglow = newborn >= 0 ? Math.exp(-newborn / 0.6) : 0;
        // What the afterglow throws over this frame, exactly: it dies in well under a second,
        // so a slow frame and a fast one must agree on how far it threw things.
        const thrown = newborn >= 0 ? 0.6 * (Math.exp(-Math.max(0, newborn - dt) / 0.6) - afterglow) : 0;
        this.spin += dt * STAR.spin * motion * (1 + (this.heat * 1.6 + this.surge * 3) * hurry);
        this.boil += dt * motion * (1 + (this.heat * 2.4 + this.surge * 2 + falling * 6) * hurry);
        // The wind: a chain blows harder, a collapse draws it in, a detonation hurls it out.
        const gust = this.heat * 3 + this.surge * 5 + this.storm * 2 - falling * falling * 46;
        this.flow += motion * (dt * (1 + gust * hurry) + thrown * 70 * hurry);
        this.drift += dt * (1 + this.surge * 22 * hurry) + thrown * 60 * hurry;
        this.ringTurn += dt * 0.035 * motion;
        this.hueClock += dt;
        const whirl = 1.6 + (newborn >= 0 ? 9 * Math.exp(-newborn / 6) : 0);
        this.pulsarPhase += dt * whirl * (this.reducedMotion ? 0.35 : 1);

        // One of the star's own prominences every beat (more of them on a hot star).
        const beat = Math.floor(t / LOOP_BEAT);
        if (beat !== this.loopBeat) {
            this.loopBeat = beat;
            if (dt > 0 && falling === 0 && (newborn < 0 || newborn > 3)) {
                this.ambientLoop(beat, t);
                if (this.heat > 0.45) this.ambientLoop(beat + 7919, t + 0.4);
            }
        }

        const hush = falling > 0 ? 1 : 0;
        const breathTarget = hush ? 1 - 0.9 * smooth(0, 0.6, falling) : 1 - this.dip;
        this.breath += (breathTarget - this.breath) * approach(hush ? 30 : 12, dt);
        if (dt === 0 && this.capture) this.breath = breathTarget;
        this.applyPalette(approach(0.8, dt));
        this.pose();
        this.writeShells(t);

        // ── The ring's beads: one more for every step of the chain ──
        const lit = Math.min(RING.beads, this.combo);
        const p = this._palette;
        for (let i = 0; i < RING.beads; i++) {
            // Each step lights the bead five places on, so a short chain is already spread round
            // the ring instead of bunched on one side of it.
            const rank = BEAD_RANK[i];
            const want = rank < lit ? 1 : 0;
            // They light at once and go out one after another, the last lit first.
            const rate = want > this.beadLit[i] ? 9 : 1.2 + (rank / RING.beads) * 4;
            this.beadLit[i] += (want - this.beadLit[i]) * approach(rate, dt);
            if (dt === 0 && this.capture) this.beadLit[i] = want;
            const k = rank / (RING.beads - 1);
            const row = u.beadRows[i];
            // Gold, then the star's hot white, then the rim's colour.
            const a = k < 0.5 ? p.gasC : p.starHot;
            const b = k < 0.5 ? p.starHot : p.rim;
            const m = k < 0.5 ? k * 2 : k * 2 - 1;
            const pulse = 1 + Math.sin(t * 5 + i * 1.7) * 0.12 + this.pulse * 0.6;
            row.set(
                a[0] + (b[0] - a[0]) * m,
                a[1] + (b[1] - a[1]) * m,
                a[2] + (b[2] - a[2]) * m,
                this.beadLit[i] * pulse,
            );
        }
        u.ring.value.set(
            1 + this.heat * 1.5 + this.surge * 2,
            this.ringFlare + (lit >= RING.beads ? 0.5 : 0) + this.surge * 0.4,
            this.ringTurn,
            0,
        );

        // ── Uniforms ──
        let impactsLive = 0;
        for (let i = 0; i < IMPACT_SLOTS; i++) {
            const age = t - u.impactA[i].value.w;
            if (u.impactC[i].value.w > 0 && age < 34) impactsLive = 1;
        }
        u.impactsLive.value = impactsLive;
        u.time.value = t;
        u.boil.value = this.boil;
        u.flow.value = this.flow;
        u.breath.value = this.breath;
        u.twist.value = this.twist * (this.reducedMotion ? 0.3 : 1);
        // A newborn star is small, blue-white and far too bright; it cools as it swells.
        const young = newborn >= 0 ? Math.exp(-newborn / 4.5) : 0;
        u.heat.value = this.heat + falling * 1.1 + young * 1.25;
        u.fissure.value = clamp01(smooth(0.55, 0.95, this.heat) * 0.8 + falling * 1.2);
        u.starGain.value = 1 + this.pulse * 0.55 + falling * 1.4 + afterglow * 5 + young * 0.7;
        u.coronaGain.value = (1 + this.heat * 1.2 + this.surge * 1.4 + this.pulse * 0.6 + young * 1.5)
            * (1 - falling * 0.8);
        u.glare.value.set(
            0.5 + this.heat * 0.9 + this.surge * 1.2 + this.flash * 2.5 + afterglow * 6,
            0.2 + this.heat * 0.35 + this.surge * 0.9 + this.flash * 1.6 + afterglow * 3 + young * 0.5,
        );
        u.haze.value = (0.5 + this.heat * 0.5 + this.surge * 1.6 + this.pulse * 0.4) * (1 - falling * 0.7);
        u.skyPulse.value = Math.min(1.2, this.storm * 0.7 + this.surge * 0.5);
        u.pulsar.value.set(newborn >= 0 ? pulsarGain(newborn) * 1.5 : 0, this.pulsarPhase, 13, 0);
        const heatTint = clamp01(this.heat * 0.5 + young * 0.6);
        const warm = (key, node, gain = 1) => {
            const c = p[key];
            node.value.set(
                (c[0] + (STARFIRE[0] - c[0]) * heatTint) * gain,
                (c[1] + (STARFIRE[1] - c[1]) * heatTint) * gain,
                (c[2] + (STARFIRE[2] - c[2]) * heatTint) * gain,
            );
        };
        u.starDeep.value.set(p.starDeep[0], p.starDeep[1], p.starDeep[2]);
        u.starMid.value.set(p.starMid[0], p.starMid[1], p.starMid[2]);
        u.starHot.value.set(p.starHot[0], p.starHot[1], p.starHot[2]);
        u.rim.value.set(p.rim[0], p.rim[1], p.rim[2]);
        warm('corona', u.corona);
        u.gasA.value.set(p.gasA[0], p.gasA[1], p.gasA[2]);
        u.gasB.value.set(p.gasB[0], p.gasB[1], p.gasB[2]);
        u.gasC.value.set(p.gasC[0], p.gasC[1], p.gasC[2]);
        u.skyA.value.set(p.skyA[0], p.skyA[1], p.skyA[2]);
        u.skyB.value.set(p.skyB[0], p.skyB[1], p.skyB[2]);
        u.voidCol.value.set(p.void[0], p.void[1], p.void[2]);

        // What follows the camera: the two domes, and the star on screen.
        if (camera) {
            const follow = (name) => {
                const mesh = this.parts[name]?.mesh;
                if (!mesh) return;
                mesh.position.copy(camera.position);
                mesh.updateMatrix();
                mesh.updateMatrixWorld(true);
            };
            follow('sky');
            follow('nebula');
            this._toCam.copy(camera.position).sub(this._centre).normalize();
            u.starDir.value.copy(this._toCam).negate();
            this._ray.copy(this._centre).project(camera);
            this.heart.x = Math.max(-0.5, Math.min(1.5, this._ray.x * 0.5 + 0.5));
            this.heart.y = Math.max(-0.5, Math.min(1.5, 0.5 - this._ray.y * 0.5));
        }
        this.sparks?.flush();

        // ── Post ──
        const post = this._post;
        post.flash = this.flash;
        post.kick = this.kick;
        post.rays = hush ? 0.03 : 0.1 + this.heat * 0.22 + this.surge * 0.4 + this.pulse * 0.2 + afterglow * 0.6;
        post.streak = 0.08 + this.heat * 0.16 + this.surge * 0.5 + this.flash * 0.9 + afterglow * 0.8;
        post.bloomBoost = this.surge * 0.2 + this.pulse * 0.15 + afterglow * 0.6;
        // The iris closes as the star flares, so its colours survive the surge.
        post.exposure = 1
            / (1 + this.surge * 1.1 + this.heat * 0.28 + this.pulse * 0.22 + this.storm * 0.12 + afterglow * 1.6);
        post.fall = falling * falling * (this.reducedMotion ? 0.15 : 1);
        const rippleAge = t - this.spaceRipple.birth;
        post.ripple.radius = Math.max(0, rippleAge) * RIPPLE_SPEED;
        post.ripple.strength = rippleAge >= 0
            ? this.spaceRipple.strength * Math.exp(-rippleAge / 0.9) * smooth(0, 0.1, rippleAge)
            : 0;
    }

    /** What the post stack reads each frame (a reused object). */
    getPostState() {
        return this._post;
    }

    getState() {
        let pending = 0;
        for (let i = 0; i < this.pending.length; i++) if (this.pending[i].live) pending += 1;
        let beads = 0;
        for (let i = 0; i < this.beadLit.length; i++) if (this.beadLit[i] > 0.5) beads += 1;
        return {
            quality: this.quality,
            time: this.time,
            combo: this.combo,
            heat: this.heat,
            surge: this.surge,
            storm: this.storm,
            breath: this.breath,
            pulse: this.pulse,
            twist: this.twist,
            starRadius: this.starR,
            level: this.level,
            // The palette it is nearer to, the one it is turning toward, and how far it has turned.
            palette: SUPERNOVA_PALETTES[this._drift.blend > 0.5 ? this._drift.to : this._drift.from].name,
            paletteNext: SUPERNOVA_PALETTES[this._drift.to].name,
            paletteBlend: this._drift.blend,
            counts: { ...this.counts },
            pending,
            beads,
            shells: this.u ? this.u.shellCount.value : 0,
            loops: this.loops ? this.loops.standing(this.time) : 0,
            novaAge: this.time - this.nova.birth,
            embers: this.parts.embers ? this.parts.embers.count : 0,
            sparks: this.sparks ? this.sparks.count : 0,
            layoutLive: this.layoutLive,
            heart: { ...this.heart },
            distance: this.distance,
            spin: this.spin,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.scene?.remove(this.root);
        this.disposables.forEach((part) => {
            part.geometry?.dispose?.();
            part.material?.dispose?.();
        });
        this.textures.forEach((tex) => tex.dispose());
        this.disposables = [];
        this.textures = [];
        this.parts = {};
        this.loops = null;
        this.streams = null;
        this.sparks = null;
        this.u = null;
        this._camera = null;
    }
}

export { PARTS as SUPERNOVA_PARTS };
