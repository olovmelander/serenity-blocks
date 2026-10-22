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
 *            A chain of eight takes it to the brink: it swells, throbs and burns blue-white, and
 *            holds there until four lines push it over, or the chain lets go and it goes off.
 *   four     the star falls in on itself — the nebula holds its breath and the picture is drawn
 *            in — then detonates: a flash, a blast wave that bends the picture, a fireball of
 *            ragged shells, a spray of ejecta in the colours it was fed, an echo across the far
 *            clouds; and what is left is a pulsar whose beams sweep the nebula while a new star
 *            kindles. Four lines too soon after the last flash re-light the fireball and charge
 *            the next one; a perfect clear that settles after its clear crowns the flash.
 *   T-spin   the corona winds into a pinwheel and springs back (a little, for one that clears
 *            nothing).
 *   B2B      the ring of old gas flares and spins up, and a twin of the shock follows it out.
 *   cascade  each wave runs deeper, wider and faster than the last, in the next gas colour.
 *   play     how hot play runs (shared/gameplay-surge.js) bends everything slowly: the star
 *            boils and swells, the corona lengthens, the ring turns, the wind quickens and the
 *            fronts burn in colour instead of white; every answer adds to what is still lit.
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
    IMPACT_HOLD,
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
    lerp,
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
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, Swell, softCeiling } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';

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
/** Seconds the old star's marks and prominences take to burn off in a detonation. */
const BURN_OFF = 0.6;
/** How fast a chain at its critical step takes the star to the brink, and lets it back. */
const CRITICAL_RISE = 1.4;
const CRITICAL_FALL = 2.5;
/** The most a detonation carries (charged by refused fours, past critical, crowned). */
const NOVA_MAX = 1.9;
/** How white a front flares the shells it crosses at rest (play turns it toward its colour). */
const FRONT_WHITE = 0.7;

const PENDING_SLOTS = 40;
const KIND_IMPACT = 1;
const KIND_SHOCK = 2;
const KIND_DETONATE = 3;
/** What a queued shock carries besides its lines. */
const FLAG_AFTERSHOCK = 1;
const FLAG_TSPIN = 2;
const FLAG_B2B = 4;

const PARTS = ['sky', 'nebula', 'beams', 'star', 'ring', 'loops', 'embers', 'streams', 'sparks'];

/**
 * The standing shells' colours from the inside out: a shell is thrown off in the nebula's second
 * gas colour (hot, at the first level a teal), cools through its third (gold) and dies in its
 * first (crimson). Each shell glows in the colour of its place and, in patches, the next one
 * out, so the nebula reads in layers instead of every colour everywhere.
 */
const SHELL_ORDER = Object.freeze(['gasB', 'gasC', 'gasA']);
/**
 * The fireball's three shells, inside out: fire, in the nebula's outer two gas colours only (its
 * second, added over the others' light, went lime against the first level's gold).
 */
const BLAST_HUES = Object.freeze([['gasC', 'gasA'], ['gasA', 'gasC'], ['gasC', 'gasA']]);

/** Linear RGB → [hue 0..1, saturation, value]. */
function toHsv(c) {
    const max = Math.max(c[0], c[1], c[2]);
    const min = Math.min(c[0], c[1], c[2]);
    const d = max - min;
    let h = 0;
    if (d > 1e-6) {
        if (max === c[0]) h = ((c[1] - c[2]) / d + 6) % 6;
        else if (max === c[1]) h = (c[2] - c[0]) / d + 2;
        else h = (c[0] - c[1]) / d + 4;
    }
    return [h / 6, max > 1e-6 ? d / max : 0, max];
}

/** [hue 0..1, saturation, value] → linear RGB, into `out`. */
function fromHsv(h, s, v, out) {
    const k = (n) => (n + h * 6) % 6;
    const f = (n) => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1));
    out[0] = f(5);
    out[1] = f(3);
    out[2] = f(1);
    return out;
}

/** Hues (0..1) a blend should not pass through unless an end is there already: the greens. */
const GREENS = [0.21, 0.44];
const isGreen = (h) => h > GREENS[0] && h < GREENS[1];

/** Whether turning from hue `h` by `dh` passes through the greens. */
function crossesGreen(h, dh) {
    for (let k = 1; k < 8; k++) {
        const at = (((h + (dh * k) / 8) % 1) + 1) % 1;
        if (isGreen(at)) return true;
    }
    return false;
}

/**
 * Between two colours through their hues, never through grey: the short way round, unless that
 * way crosses the greens and neither colour is green (teal into gold the short way goes lime;
 * the long way passes through violet and rose).
 */
function hueBlend(a, b, t, out) {
    const A = toHsv(a);
    const B = toHsv(b);
    let dh = B[0] - A[0];
    if (dh > 0.5) dh -= 1;
    if (dh < -0.5) dh += 1;
    if (!isGreen(A[0]) && !isGreen(B[0]) && crossesGreen(A[0], dh)) dh -= Math.sign(dh);
    return fromHsv((((A[0] + dh * t) % 1) + 1) % 1, lerp(A[1], B[1], t), lerp(A[2], B[2], t), out);
}

/** The colour of a place along SHELL_ORDER (0 = first … 2 = last), each held, then turned. */
function shellColour(p, place, out) {
    const x = Math.max(0, Math.min(SHELL_ORDER.length - 1, place));
    const i = Math.min(SHELL_ORDER.length - 2, Math.floor(x));
    return hueBlend(p[SHELL_ORDER[i]], p[SHELL_ORDER[i + 1]], smooth(0.3, 0.7, x - i), out);
}
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
        live: false, time: 0, kind: 0, dir: [0, 1, 0], rgb: [1, 1, 1], amount: 1, lines: 1, flag: 0, slot: -1, depth: 0,
    };
}

function createFront() {
    return {
        birth: -100,
        strength: 0,
        /** Light of fronts too faint to get a slot of their own, joined to this one. */
        boost: 0,
        reach: 21,
        tau: 1.15,
        fade: 1.5,
        skin: 0.04,
        stir: 1,
        white: FRONT_WHITE,
        rgb: [1, 1, 1],
    };
}

/** What the photosphere keeps of one impact slot (its uniforms are written from this each frame). */
function createImpactSlot() {
    return {
        strength: 0, birth: -100, fadeFrom: Infinity, fadeTo: Infinity, reserved: false,
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
        this.impactSlots = Array.from({ length: IMPACT_SLOTS }, createImpactSlot);
        this.beadLit = new Float32Array(RING.beads);
        /**
         * The star's answers to events. Every one ADDS to what is still lit (shared/swell.js): a
         * weak answer after a strong one never cuts it, and a run of them builds instead of
         * restarting. Read once a frame into the numbers of the same names.
         */
        this.env = {
            flash: new Swell({ release: 0.25, ceiling: 1, knee: 0.85 }),
            kick: new Swell({ release: 0.16, ceiling: 1, knee: 0.85 }),
            pulse: new Swell({ release: PULSE_COOL, ceiling: 1.3, knee: 0.9 }),
            /** The impacts' share of the pulse: a fast run of locks rides up to a glow, not a flood. */
            patter: new Swell({ release: PULSE_COOL, ceiling: 0.45, knee: 0.3 }),
            storm: new Swell({ release: STORM_COOL, ceiling: 1.8, knee: 1.3 }),
            surge: new Swell({ release: SURGE_COOL, ceiling: 2.6, knee: 2 }),
            dip: new Swell({ release: 0.35, ceiling: 0.5, knee: 0.4 }),
            /** A back-to-back's (and a crown's) flare of the ring. */
            b2b: new Swell({
                attack: 0.06, release: 2.4, ceiling: 1.6, knee: 1.1,
            }),
            /** Four lines refused a detonation (or a crown) re-light the fireball and the pulsar. */
            rekindle: new Swell({
                attack: 0.12, release: 2.2, ceiling: 1.8, knee: 1.2,
            }),
        };
        /** How hot play runs: the slow build every part of the star leans into. */
        this.pressure = new GameplaySurge();
        /** The pressure as of the last frame. */
        this.play = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
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
        this.b2bGlow = 0;
        this.rekindle = 0;
        this.b2bRun = 0;
        /** How near the star is to going: 0 → 1 while a chain holds it at its critical step. */
        this.critical = 0;
        /** The chain at its critical step has already set the star off (it waits for a new chain). */
        this.chainBlown = false;
        /** The star's size as play swells it (1 at rest). */
        this.swollen = 1;
        this.random = mulberry32(this.seed);
        /**
         * The last detonation (the moment of its flash, how hard) and the next one: `next` is
         * the moment a collapse under way will flash at, Infinity when none is. `charge`: fours
         * refused a detonation since the last, carried into the next; `hush`: how deep the
         * nebula holds its breath for the next; `crowned`/`b2b`: what the next flash answers too.
         */
        this.nova = {
            birth: -1000, strength: 0, next: Infinity, twist: false, charge: 0, hush: 0.9, crowned: false, b2b: false,
        };
        if (this.env) for (const key of Object.keys(this.env)) this.env[key].reset();
        this.pressure?.reset();
        if (this.play) {
            this.play.punch = 0;
            this.play.level = 0;
            this.play.fever = 0;
            this.play.stage = 0;
        }
        for (let i = 0; i < this.impactSlots.length; i++) Object.assign(this.impactSlots[i], createImpactSlot());
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
        /** How much further play has turned the ring. */
        this.ringSpin = 0;
        this.loopBeat = Math.floor(time / LOOP_BEAT);
        for (let i = 0; i < this.pending.length; i++) this.pending[i].live = false;
        for (let i = 0; i < this.fronts.length; i++) {
            this.fronts[i].birth = -100;
            this.fronts[i].strength = 0;
            this.fronts[i].boost = 0;
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
            time, spin, boil, flow, drift, hueClock, ringTurn, ringSpin, loopBeat,
        } = this;
        this.resetState(time);
        Object.assign(this, {
            spin, boil, flow, drift, hueClock, ringTurn, ringSpin, loopBeat,
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
        this.starR = STAR.radius * size * breathe * (1 + this.pulse * 0.045) * this.swollen;
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
        const fov = fovForAspect(this.aspect) - (this.kick + this.play.punch * 0.12) * 0.5 * calm;
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
        // The shared breath (shared/camera-breath.js) on top of the drift above, pivoting on the
        // star (the look point is only a direction): off under reduced motion.
        applyCameraBreath(camera, t, {
            distance: camera.position.distanceTo(this._centre),
            scale: this.reducedMotion ? 0 : 1,
        });
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
        dir = null, rgb = null, amount = 1, lines = 1, flag = 0, slot = -1, depth = 0,
    } = {}) {
        let entry = null;
        for (let i = 0; i < this.pending.length; i++) {
            if (!this.pending[i].live) {
                entry = this.pending[i];
                break;
            }
        }
        // Full: one more lock is not queued. A clear or a detonation is never dropped: it takes
        // the place of the lock that would have landed last (the stream nearest the star keeps
        // its answer).
        if (!entry) {
            if (kind === KIND_IMPACT) return false;
            for (let i = 0; i < this.pending.length; i++) {
                const p = this.pending[i];
                if (p.kind === KIND_IMPACT && (!entry || p.time > entry.time)) entry = p;
            }
            // The impact slot it was to land in is free again (its old colour has given way).
            if (entry && entry.slot >= 0 && entry.slot < IMPACT_SLOTS) this.impactSlots[entry.slot].reserved = false;
        }
        if (!entry) return false;
        entry.live = true;
        entry.time = time;
        entry.kind = kind;
        entry.amount = amount;
        entry.lines = lines;
        entry.flag = flag;
        entry.slot = slot;
        entry.depth = depth;
        if (dir) {
            entry.dir[0] = dir[0];
            entry.dir[1] = dir[1];
            entry.dir[2] = dir[2];
        }
        if (rgb) {
            entry.rgb[0] = rgb[0];
            entry.rgb[1] = rgb[1];
            entry.rgb[2] = rgb[2];
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
        birth, strength, rgb, reach = 21, tau = 1.15, fade = 1.5, skin = 0.04, stir = 1, white = FRONT_WHITE,
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
        // Fainter than every front already running: it would not be seen, and must not put one
        // out. Its light is not lost: it joins the brightest front already running.
        if (least > strength) {
            this.foldFront(strength);
            return;
        }
        f.birth = birth;
        f.strength = strength;
        f.boost = 0;
        f.white = white;
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

    /** A front with no slot of its own: its light joins the brightest one running. */
    foldFront(strength) {
        let best = null;
        let most = 0;
        for (let i = 0; i < FRONT_SLOTS; i++) {
            const light = this.frontLight(this.fronts[i], this.time);
            if (light > most) {
                most = light;
                best = this.fronts[i];
            }
        }
        if (best) best.boost = Math.min(best.strength * 0.6, best.boost + strength * 0.35);
    }

    /** How much light a front still carries at `t`. */
    frontLight(f, t) {
        const age = t - f.birth;
        if (age < 0 || f.strength <= 0) return 0;
        return (f.strength + f.boost) * Math.exp(-age / f.fade);
    }

    /** How white a front of an event flares the shells: less the hotter play runs. */
    whiteness() {
        return FRONT_WHITE * (1 - 0.65 * Math.max(this.play.level, this.critical));
    }

    // ── The photosphere's impact slots ──────────────────────────────────────────

    /** How far one impact slot's colour has given way at `t` (1 = not at all). */
    impactFade(s, t) {
        if (s.fadeFrom === Infinity || t <= s.fadeFrom) return 1;
        if (t >= s.fadeTo) return 0;
        return 1 - smooth(s.fadeFrom, s.fadeTo, t);
    }

    /** What is left of one impact slot's colour at `t`. */
    impactLeft(i, t) {
        const s = this.impactSlots[i];
        if (s.strength <= 0) return 0;
        return s.strength * Math.exp(-Math.max(0, t - s.birth) / IMPACT_HOLD) * this.impactFade(s, t);
    }

    /**
     * The slot a stream landing at `land` will mark: the one with the least colour left that no
     * other stream has claimed. What is still in it gives way over the stream's flight, so a run
     * of locks never wipes a mark in one frame.
     */
    reserveImpact(land) {
        const now = this.time;
        let best = -1;
        let least = Infinity;
        for (let pass = 0; pass < 2 && best < 0; pass++) {
            for (let i = 0; i < IMPACT_SLOTS; i++) {
                if (pass === 0 && this.impactSlots[i].reserved) continue;
                const left = this.impactLeft(i, now);
                if (left < least) {
                    least = left;
                    best = i;
                }
            }
        }
        const s = this.impactSlots[best];
        s.reserved = true;
        // Already giving way sooner (burnt off by a detonation): it keeps that.
        if (!(s.fadeTo <= land)) {
            s.fadeFrom = Math.min(s.fadeFrom, now);
            s.fadeTo = Math.max(s.fadeFrom + 0.05, land);
        }
        return best;
    }

    /** A claimed slot whose stream was never queued: what was in it stays. */
    releaseImpact(slot) {
        const s = this.impactSlots[slot];
        if (!s) return;
        s.reserved = false;
        if (s.fadeFrom >= this.time) {
            s.fadeFrom = Infinity;
            s.fadeTo = Infinity;
        }
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
            size: (kind === 1 ? 0.08 : 0.1) + amount * 0.07 + this.play.level * 0.03,
            kind,
        });
        this.counts.streams += 1;
        if (kind === 0) {
            const slot = this.reserveImpact(land);
            if (!this.schedule(KIND_IMPACT, land, {
                dir, rgb, amount, slot,
            })) this.releaseImpact(slot);
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
        // The slot its stream claimed when it left (its old colour has been giving way since).
        const slot = ev.slot >= 0 && ev.slot < IMPACT_SLOTS ? ev.slot : this.reserveImpact(ev.time);
        const { level } = this.play;
        const mark = Math.min(1.6, 0.75 + ev.amount * 0.3 + level * 0.25);
        Object.assign(this.impactSlots[slot], {
            strength: mark, birth: ev.time, fadeFrom: Infinity, fadeTo: Infinity, reserved: false,
        });
        u.impactA[slot].value.set(ev.dir[0], ev.dir[1], ev.dir[2], ev.time);
        u.impactC[slot].value.set(ev.rgb[0], ev.rgb[1], ev.rgb[2], mark);
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
                n: (9 + 13 * ev.amount) * share * (1 + level * 0.8),
                rgb: ev.rgb,
                time: ev.time,
                axis: [normal.x, normal.y, normal.z],
                spread: 0.6,
                out: [1.2, 4.5 + ev.amount * 2.5 + level * 2],
                life: [0.45, 1.1],
                size: 0.03,
                from: 0.03,
            });
        }
        // Its colour runs out through the nebula as an echo (stronger, and in more of its own
        // colour, the hotter play runs).
        this.front({
            birth: ev.time,
            strength: 0.5 * ev.amount * (1 + level * 0.5),
            rgb: ev.rgb,
            reach: 20 + level * 2,
            tau: 0.7,
            fade: 1.0,
            skin: 0.045,
            stir: 0.55,
            white: this.whiteness(),
        });
        const { env } = this;
        env.patter.hit(0.22 * ev.amount, ev.time);
        env.flash.hit(0.03 * ev.amount, ev.time);
        if (ev.amount > 1.2) env.kick.hit(0.4, ev.time);
        this.counts.impacts += 1;
    }

    /**
     * A cascade wave's colour: each wave past the first runs in the next of the nebula's gases,
     * so a cascade reads as a tide moving through them, not the first wave again.
     */
    waveColour(depth, out) {
        const p = this._palette;
        const keys = ['gasC', 'gasA', 'rim', 'gasB'];
        const c = p[keys[(depth - 1) % keys.length]];
        const peak = Math.max(c[0], c[1], c[2], 1e-4);
        for (let k = 0; k < 3; k++) out[k] = (c[k] / peak) * 0.92 + 0.08;
        return out;
    }

    /** The cleared rows have reached the star: it answers with a shock, one front per line. */
    shock(ev) {
        // The star is already falling in: these rows feed the collapse, and the flash is their
        // answer, that much bigger (a T-spin among them still winds the corona, with the flash).
        if (this.nova.next !== Infinity) {
            if (ev.flag & FLAG_TSPIN) this.nova.twist = true;
            if (ev.flag & FLAG_B2B) this.nova.b2b = true;
            this.feedCollapse(0.05 * Math.max(1, Math.min(4, ev.lines)) + (ev.flag & FLAG_AFTERSHOCK ? 0.2 : 0));
            return;
        }
        const n = Math.max(1, Math.min(4, ev.lines));
        // A cascade's waves: each one deeper, brighter, wider and faster than the last.
        const depth = Math.max(0, Math.min(9, ev.depth || 0));
        const { level } = this.play;
        const deeper = 1 + depth * 0.14;
        const amount = ev.amount * deeper * (1 + level * 0.25);
        const rgb = depth > 0 ? this.waveColour(depth, [0, 0, 0]) : ev.rgb;
        const fronts = Math.min(5, n + (depth >= 2 ? 1 : 0));
        const quick = 1 - Math.min(0.3, depth * 0.05);
        const white = this.whiteness();
        for (let k = 0; k < fronts; k++) {
            this.front({
                birth: ev.time + k * FRONT_GAP * quick,
                strength: amount * (1 - k * 0.1),
                rgb,
                reach: 21 + n + depth * 1.2 + level * 2,
                tau: (1.15 - n * 0.06) * quick,
                fade: 1.5 + n * 0.12 + depth * 0.08,
                skin: 0.065,
                white,
            });
        }
        const { env } = this;
        env.pulse.hit((0.5 + 0.2 * n) * deeper, ev.time);
        env.kick.hit(0.24 + 0.1 * n + depth * 0.03, ev.time);
        env.flash.hit(0.1 + 0.05 * n, ev.time);
        env.storm.hit(Math.min(1.3, 0.3 + 0.16 * n) * deeper, ev.time);
        if (ev.flag & FLAG_TSPIN) this.windCorona(ev.time);
        if (ev.flag & FLAG_B2B) this.backToBack(ev.time);
        if (this.sparks) {
            const share = this.sparks.count / 800;
            this.sparks.emit({
                x: this._centre.x,
                y: this._centre.y,
                z: this._centre.z,
                n: (26 + 26 * n) * share * (1 + depth * 0.3 + level * 0.5),
                rgb,
                time: ev.time,
                spread: 1,
                out: [2.5, 8 + n * 2.2 + depth],
                life: [0.7, 1.7],
                size: 0.032 + n * 0.003,
                from: this.starR * 1.02,
            });
        }
        // Prominences thrown up all round the limb, in the shock's colour.
        if (this.loops) {
            const rand = this.random;
            const arches = (n >= 3 ? 2 : 1) + (depth >= 2 ? 1 : 0);
            for (let k = 0; k < arches; k++) {
                const site = this.visibleSite(rand() * TAU, rand() * 0.3);
                const mid = this.toStarFrame(site);
                const tangent = this.toStarFrame(this._vec2.copy(this._toCam).cross(site).normalize());
                this.loops.spawn({
                    mid,
                    tangent,
                    span: 0.26 + rand() * 0.26,
                    height: 0.45 + rand() * 0.55 + n * 0.08 + depth * 0.06,
                    lean: (rand() - 0.5) * 1.1,
                    width: 0.08,
                    rgb,
                    time: ev.time + k * 0.07,
                    life: LOOP_LIFE * 0.75,
                    seed: rand(),
                });
            }
        }
        if (ev.flag & FLAG_AFTERSHOCK) {
            this.counts.aftershocks += 1;
            this.rebound(ev.time);
        }
    }

    /**
     * Four lines the star could not go off for (it went off moments ago): the young star does not
     * answer smaller. What it was given re-lights the fireball and the pulsar, and is carried into
     * the next flash, so a run of fours builds toward it instead of fading.
     */
    rebound(time) {
        const { nova, env } = this;
        nova.charge = Math.min(3, nova.charge + 1);
        env.surge.hit(0.3 + 0.1 * nova.charge, time);
        env.rekindle.hit(0.6 + 0.2 * nova.charge, time);
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
            white: 0.4,
        });
        this.env.storm.hit(0.8, time);
    }

    /**
     * A back-to-back: the ring of old gas flares and spins up, and a twin of the shock follows
     * it out in the rim's colour, the second of a pair. Every one more in the run burns brighter.
     */
    backToBack(time) {
        const run = Math.min(4, Math.max(1, this.b2bRun));
        this.env.b2b.hit(0.5 + 0.2 * run, time);
        this.front({
            birth: time + FRONT_GAP * 0.5,
            strength: 0.7 + 0.15 * run,
            rgb: this._palette.rim,
            reach: 23,
            tau: 0.85,
            fade: 1.6,
            skin: 0.035,
            stir: 0.8,
            white: 0.15,
        });
    }

    /**
     * A perfect clear's crown: the element's own colours leave the star one after another and
     * the ring and the fireball flare. Layered on what the clear already set off.
     */
    crown(time) {
        const p = this._palette;
        const hues = [p.rim, p.gasB, p.gasC];
        for (let k = 0; k < hues.length; k++) {
            this.front({
                birth: time + k * 0.09,
                strength: 1.1 - k * 0.15,
                rgb: hues[k],
                reach: 24,
                tau: 0.75 + k * 0.08,
                fade: 1.7,
                skin: 0.04,
                white: 0.15,
            });
        }
        const { env } = this;
        env.rekindle.hit(0.9, time);
        env.b2b.hit(0.8, time);
        env.surge.hit(0.3, time);
        if (this.sparks) {
            this.sparks.emit({
                x: this._centre.x,
                y: this._centre.y,
                z: this._centre.z,
                n: 90 * (this.sparks.count / 800),
                rgb: p.rim,
                time,
                spread: 1,
                out: [3, 14],
                life: [1, 2.4],
                size: 0.045,
                stagger: 0.15,
                from: this.starR * 1.02,
            });
        }
    }

    /** Seconds the star needs after a flash before it can go off again: less in a fever. */
    rearm() {
        return NOVA_REARM * (1 - 0.4 * this.play.fever);
    }

    /** True when the star can go off: no collapse under way, and the last flash long enough ago. */
    canDetonate() {
        return this.nova.next === Infinity && this.time - this.nova.birth > this.rearm();
    }

    /** How much more a flash carries for the chain that holds the star at the brink. */
    criticalBonus() {
        if (this.combo < CRITICAL_COMBO) return 0;
        return this.critical * (0.15 + 0.05 * Math.min(6, this.combo - CRITICAL_COMBO));
    }

    /**
     * The star begins to fall in at `start`; it detonates COLLAPSE_HOLD later. `twist`: the clear
     * that set it off was a T-spin, so the corona winds with the flash. The flash carries what
     * the star was refused since the last and how far past critical the chain has taken it; the
     * hush before it is as deep as play is cold (in a fever the nebula only catches its breath).
     */
    beginCollapse(start, strength, twist = false) {
        const hold = this.reducedMotion ? 0.12 : COLLAPSE_HOLD;
        this.nova.next = start + hold;
        this.nova.twist = twist;
        this.nova.hush = 0.9 * (1 - 0.6 * this.play.level);
        const carried = Math.min(0.45, this.nova.charge * 0.15) + this.criticalBonus();
        const amount = Math.min(NOVA_MAX, strength + carried);
        if (!this.schedule(KIND_DETONATE, this.nova.next, { amount })) this.nova.next = Infinity;
    }

    /** More for the flash a collapse is falling toward. */
    feedCollapse(amount) {
        for (let i = 0; i < this.pending.length; i++) {
            const p = this.pending[i];
            if (p.live && p.kind === KIND_DETONATE) p.amount = Math.min(NOVA_MAX, p.amount + amount);
        }
    }

    /** The flash. */
    detonate(ev) {
        const { u } = this;
        if (!u) return;
        const t0 = ev.time;
        const strength = ev.amount;
        const p = this._palette;
        const { nova, env } = this;
        nova.birth = t0;
        nova.strength = strength;
        nova.next = Infinity;
        nova.charge = 0;
        // A chain held at its critical step has had its flash: it waits for a new chain.
        if (this.combo >= CRITICAL_COMBO) this.chainBlown = true;
        if (nova.twist) {
            nova.twist = false;
            this.windCorona(t0);
        }
        this.blast.birth = t0;
        this.blast.strength = strength;
        // Three fronts, each a little slower than the last, in the order the nebula's own shells
        // burn: the hot gas a shell is thrown off in, then the two it cools through. Colour,
        // not white: the flash is the star's, the fronts are the gas it lights.
        const hues = [p.gasB, p.gasC, p.gasA];
        for (let k = 0; k < 3; k++) {
            this.front({
                birth: t0 + k * 0.11,
                strength: 1.7 * strength * (1 - k * 0.15),
                rgb: hues[k],
                reach: 26,
                tau: 0.8 + k * 0.1,
                fade: 1.5,
                skin: 0.06 - k * 0.008,
                white: 0.25,
            });
        }
        if (nova.crowned) {
            nova.crowned = false;
            this.crown(t0 + 0.12);
        }
        if (nova.b2b) {
            nova.b2b = false;
            this.backToBack(t0 + 0.06);
        }
        u.echo.value.set(t0, strength, 0.85, 0.045);
        u.echoCol.value.set(
            (STARFIRE[0] + p.gasC[0]) * 0.5,
            (STARFIRE[1] + p.gasC[1]) * 0.5,
            (STARFIRE[2] + p.gasC[2]) * 0.5,
        );
        this.spaceRipple.birth = t0;
        this.spaceRipple.strength = this.reducedMotion ? 0.2 : 1;
        env.surge.hit(strength, t0);
        env.storm.hit(1.3, t0);
        env.flash.hit(1, t0);
        env.kick.hit(1, t0);
        if (this.sparks) {
            const pool = this.sparks.count;
            const at = this._centre;
            const burst = (n, rgb, time, out, life, size, stagger) => this.sparks.emit({
                x: at.x, y: at.y, z: at.z, n, rgb, time, spread: 1, out, life, size, stagger, from: 0.25,
            });
            burst(pool * 0.3, p.starHot, t0, [4, 27], [1.3, 3.4], 0.05, 0.1);
            burst(pool * 0.22, p.gasA, t0 + 0.05, [2, 12], [1.8, 3.8], 0.06, 0.25);
            // The colours the star was fed come back out of it: each mark on its surface as
            // ejecta, as much as is left of it.
            let left = 0;
            for (let i = 0; i < IMPACT_SLOTS; i++) left += this.impactLeft(i, t0);
            if (left > 0.05) {
                for (let i = 0; i < IMPACT_SLOTS; i++) {
                    const share = this.impactLeft(i, t0) / left;
                    if (share < 0.02) continue;
                    const c = u.impactC[i].value;
                    this._from[0] = c.x;
                    this._from[1] = c.y;
                    this._from[2] = c.z;
                    burst(pool * 0.3 * share, this._from, t0 + 0.02, [3, 20], [1.4, 3.2], 0.055, 0.15);
                }
            } else burst(pool * 0.3, p.gasB, t0 + 0.02, [3, 20], [1.4, 3.2], 0.055, 0.15);
        }
        // The old star's surface burns off, and its prominences are torn away with it: gone
        // within a moment of the flash, never in one frame.
        for (let i = 0; i < IMPACT_SLOTS; i++) {
            const slot = this.impactSlots[i];
            if (!slot.reserved && slot.strength > 0 && !(slot.fadeTo <= t0 + BURN_OFF)) {
                slot.fadeFrom = Math.min(slot.fadeFrom, t0);
                slot.fadeTo = t0 + BURN_OFF;
            }
        }
        this.loops?.retire(t0, BURN_OFF + 0.1);
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
        this.env.kick.hit(hardDrop ? 0.32 : 0.06, this.time);
        this.env.flash.hit(hardDrop ? 0.06 : 0.01, this.time);
        this.pressure.lock({ hardDrop }, this.time);
        this.counts.locks += 1;
    }

    /**
     * Lines cleared. `lines` 1..4; `tspin`, `perfect`, `b2b`; `cascade` = which wave of a cascade
     * (1 = the lock's own clear); `combo` = the chain; `rows` = the visible rows that went.
     */
    onClear({
        rows = null, lines = 1, tspin = false, perfect = false, b2b = false, cascade = 1, combo = 1, player = 0,
        screen = null,
    } = {}) {
        const { u } = this;
        if (!u || !this.streams) return;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        const depth = Math.max(0, Math.min(9, Math.round(Number(cascade) || 1) - 1));
        const p = this._palette;
        if (depth === 0) this.b2bRun = b2b ? this.b2bRun + 1 : 0;
        // One line answers in the nebula's second colour, two in its first, three in its third,
        // four in the electric colour of the star's own rim, warmed by its fire.
        let rgb;
        if (quad) rgb = [0, 1, 2].map((c) => p.rim[c] * 0.75 + STARFIRE[c] * 0.25);
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
            this.beginCollapse(arrive, (perfect ? 1.3 : 1) + (b2b ? 0.1 : 0), tspin);
            this.nova.b2b = b2b;
        } else {
            // A second four lines too soon after the first: the newborn star answers with an
            // aftershock instead of going off again, as big as what it has been refused.
            const strength = Math.min(1.6 + 0.1 * this.nova.charge, 0.62 + 0.16 * n + (quad ? 0.4 : 0));
            this.schedule(KIND_SHOCK, arrive, {
                rgb,
                amount: strength,
                lines: quad ? 4 : n,
                depth,
                // A T-spin winds the corona when the rows arrive, with the shock.
                flag: (quad ? FLAG_AFTERSHOCK : 0) | (tspin ? FLAG_TSPIN : 0) | (b2b ? FLAG_B2B : 0),
            });
        }
        this.lastClear = { time: arrive, lines: n };
        this.counts.clears += 1;
        this.pressure.clear({
            lines: n, cascade, combo, tspin, perfect, b2b,
        }, this.time);
    }

    /**
     * A perfect clear that settled after its clear had gone (the director's `crown`): it crowns
     * what that clear set off instead of being a clear of its own. Falling in: the flash to come
     * is crowned. Just gone off, or too soon to go again: the crown now. Otherwise it sets the
     * star off, as a perfect clear always has.
     */
    onCrown() {
        if (!this.u) return;
        const t = this.time;
        if (this.nova.next !== Infinity) {
            this.feedCollapse(0.3);
            this.nova.crowned = true;
        } else if (t - this.nova.birth < 2.5 || !this.canDetonate()) {
            this.crown(t);
            this.nova.charge = Math.min(3, this.nova.charge + 1);
        } else {
            this.beginCollapse(t, 1.3, false);
            this.nova.crowned = true;
        }
        this.pressure.crown(t);
    }

    /** A T-spin that cleared nothing: the corona gives a small turn, a thin front leaves. */
    onSpin() {
        if (!this.u) return;
        const t = this.time;
        this.twistVelocity += this.reducedMotion ? 0.5 : 2.2;
        this.front({
            birth: t,
            strength: 0.4,
            rgb: this._palette.rim,
            reach: 14,
            tau: 0.8,
            fade: 1.0,
            skin: 0.03,
            stir: 0.5,
            white: 0.3,
        });
        this.env.storm.hit(0.25, t);
        this.pressure.spin(t);
    }

    /**
     * A chain that held the star at the brink lets go: it goes off (from the moment the last
     * clear's rows arrive), or, too soon after the last flash, answers with an aftershock.
     */
    letGo() {
        this.chainBlown = true;
        if (this.nova.next !== Infinity) return;
        if (this.canDetonate()) {
            this.beginCollapse(Math.max(this.time, this.lastClear.time), 1.15, false);
            return;
        }
        const p = this._palette;
        this.schedule(KIND_SHOCK, Math.max(this.time, this.lastClear.time), {
            rgb: [0, 1, 2].map((c) => p.rim[c] * 0.75 + STARFIRE[c] * 0.25),
            amount: 1.4,
            lines: 4,
            flag: FLAG_AFTERSHOCK,
        });
    }

    /**
     * The true combo changed (0 = the chain broke). `silent`: hold a chain of this length
     * without anything having happened (captures of a held chain).
     */
    onCombo(combo, { silent = false } = {}) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        if (silent) {
            this.combo = n;
            if (n < CRITICAL_COMBO) this.chainBlown = false;
            return;
        }
        // A chain that held the star at the brink lets go of it: the star goes off.
        if (n < CRITICAL_COMBO && this.combo >= CRITICAL_COMBO && !this.chainBlown) {
            this.letGo();
        } else if (n === 0 && this.combo >= 2) {
            // The chain broke: the star lets its breath go as one soft front.
            this.env.dip.hit(0.25, this.time);
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
            this.env.pulse.hit(0.3, this.time);
            this.env.flash.hit(0.04, this.time);
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
                    height: Math.min(2.3, 0.7 + n * 0.14),
                    lean: (rand() - 0.5) * 0.6,
                    width: 0.09,
                    rgb: [0, 1, 2].map((c) => p.starHot[c] * 0.6 + p.rim[c] * 0.4),
                    time: this.time,
                    life: LOOP_LIFE * 0.8,
                    seed: rand(),
                });
            }
        }
        // A long enough chain takes the star to the brink (see update()): it holds there, and
        // goes off when four lines push it over or the chain lets go.
        if (n < CRITICAL_COMBO) this.chainBlown = false;
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
            const { env } = this;
            env.storm.hit(0.75, this.time);
            env.flash.hit(0.14, this.time);
            env.pulse.hit(0.5, this.time);
            this.front({
                birth: this.time,
                strength: 0.9,
                rgb: next.rim,
                reach: 22,
                tau: 1.0,
                fade: 1.6,
                skin: 0.045,
                white: 0.5,
            });
            this.pressure.levelUp(this.time);
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
        const { level, fever } = this.play;
        // The whole nebula is lifted only a little by heat and a flash's overdrive (its light is
        // carried by the fronts, the fireball and the ring, in colour, so the deep gas stays deep).
        const lift = 1 + this.heat * 0.15 + this.surge * 0.2 + this.storm * 0.1 + level * 0.1 + fever * 0.12
            + this.rekindle * 0.1;
        // Hot play flares the shells less toward white and less in gain: in colour instead.
        const flaring = 1.25 * (1 - 0.3 * level);
        let ring = 0;
        for (let k = 0; k < count; k++) {
            const phase = shellPhase(k, count, this.drift);
            const radius = shellRadius(phase);
            // Its colour by its place in its life; its second, the next colour out (the last
            // shells take the one before theirs).
            const place = phase * (SHELL_ORDER.length - 1) * 1.15;
            const colA = shellColour(p, place, [0, 0, 0]);
            const colB = shellColour(p, place < 1.6 ? place + 0.9 : place - 1.0, [0, 0, 0]);
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
                const w = Math.min(1.4, f.strength + f.boost) * f.stir * (crossing * 1.3 + after);
                energy += w;
                // At rest the shell flares mostly white, a little in the shock's colour: the ring
                // carries the colour. (A gold shock added straight onto a teal shell went lime.)
                // The hotter play runs, the more of the front's own colour it takes (`white`).
                for (let c = 0; c < 3; c++) {
                    const lit = f.rgb[c] * (1 - f.white) + f.white;
                    colA[c] += lit * w * 0.8;
                    colB[c] += lit * w * 0.5;
                }
            }
            // However many fronts are in it at once, a shell can only flare so far.
            const flare = Math.min(1.5, energy);
            const norm = 1 / (1 + energy * 0.8);
            const gain = shellGain(phase) * 1.5 * lift * (1 + flare * flaring);
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
            ring += (f.strength + f.boost) * Math.max(0, 1 - Math.abs((radius - RING.radius) / 0.8)) ** 2;
            // Its inner face paler than its edge: as pale as the front is white.
            const pale = 0.4 * Math.min(1, f.white / FRONT_WHITE);
            put(
                [radius, f.skin, 0.7, 2.2],
                [f.rgb[0], f.rgb[1], f.rgb[2], gain],
                [f.rgb[0] * (1 - pale) + pale, f.rgb[1] * (1 - pale) + pale, f.rgb[2] * (1 - pale) + pale, 0.2],
                [0.07, i & 1, (i >> 1) & 1, 1],
                [0, 0, 0, 0],
            );
        }

        // ── A detonation's fireball ──
        const blastAge = t - this.blast.birth;
        if (blastAge >= 0 && blastAge < BLAST_LIVE) {
            const edge = blastRadius(blastAge);
            // Its heart burns toward the flash's colour, its gas keeps the nebula's: a fireball
            // in colour, not a white sphere.
            const hot = Math.exp(-blastAge / 2.4) * 0.3;
            // The same gas over a growing sphere: its light thins as the square of its size. Fours
            // refused a detonation, and a crown, light it again.
            const dying = 1 - smooth(BLAST_LIVE * 0.6, BLAST_LIVE, blastAge);
            // Under a soft ceiling: past it the filmic curve would roll its heart to white.
            const power = softCeiling(
                ((this.blast.strength ** 0.7 * 4.2 * Math.exp(-blastAge / 6) + this.rekindle * 2.4) * dying)
                    / (1 + (edge / 4.5) ** 2),
                0.8,
                1.3,
            );
            for (let j = 0; j < BLAST_SHELLS; j++) {
                const [keyA, keyB] = BLAST_HUES[j % BLAST_HUES.length];
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

        // Whatever has come due (a flash moves the star on in its life, so it must come before
        // that is read), then what every answer so far adds up to now: each joined its swell at
        // its own moment, so a frame that notices it late shows it as old as it is.
        this.runPending(t);
        const { env } = this;
        this.surge = env.surge.valueAt(t);
        this.storm = env.storm.valueAt(t);
        this.flash = env.flash.valueAt(t);
        this.kick = env.kick.valueAt(t);
        this.dip = env.dip.valueAt(t);
        this.pulse = env.pulse.valueAt(t) + env.patter.valueAt(t);
        this.b2bGlow = env.b2b.valueAt(t);
        this.rekindle = env.rekindle.valueAt(t);

        // ── How hot play runs (shared/gameplay-surge.js), and how near the star is to going ──
        const press = this.pressure.sample(t);
        const { play } = this;
        play.punch = press.punch;
        // A lock now and then moves nothing: the star looks as it always has under casual play.
        play.level = Math.max(0, press.level - 0.04) / 0.96;
        play.fever = press.fever;
        play.stage = press.stage;
        const { level, fever } = play;
        const wantCritical = this.combo >= CRITICAL_COMBO && !this.chainBlown ? 1 : 0;
        this.critical += (wantCritical - this.critical)
            * approach(wantCritical > this.critical ? CRITICAL_RISE : CRITICAL_FALL, dt);
        if (dt === 0 && this.capture) this.critical = wantCritical;
        const crit = this.critical;
        // Reduce flashing (ADR-0021): the flash's afterglow, the lens it lights and the throb of a
        // star at the brink keep only what the setting allows.
        const fs = flashScale();
        // A star at the brink throbs (slowly, and on its own disc: never the whole frame).
        const throb = crit * (0.5 + 0.5 * Math.sin(t * TAU * 1.25)) * fs;
        this.swollen = 1 + level * 0.025 + crit * 0.05;

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
        this.spin += dt * STAR.spin * motion
            * (1 + (this.heat * 1.6 + this.surge * 3 + level * 0.6 + crit * 0.8) * hurry);
        this.boil += dt * motion * (1 + (this.heat * 2.4 + this.surge * 2 + falling * 6 + level * 1.2 + crit * 2)
            * hurry);
        // The wind: a chain blows harder, hot play stirs it, a collapse draws it in, a detonation
        // hurls it out.
        const gust = this.heat * 3 + this.surge * 5 + this.storm * 2 + level * 1.5 + fever * 2 + crit * 1.5
            - falling * falling * 46;
        this.flow += motion * (dt * (1 + gust * hurry) + thrown * 70 * hurry);
        this.drift += dt * (1 + this.surge * 22 * hurry) + thrown * 60 * hurry;
        this.ringTurn += dt * 0.035 * motion;
        // Hot play, a star at the brink and a back-to-back spin the ring up.
        this.ringSpin += dt * motion * hurry * (level * 0.08 + fever * 0.1 + crit * 0.18 + this.b2bGlow * 0.5);
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
                // A star straining under hot play, or held at the brink, throws up more.
                if (Math.max(level, crit) > 0.5) this.ambientLoop(beat + 15887, t + 1.2);
            }
        }

        const hush = falling > 0 ? 1 : 0;
        // How deep the hush goes was set when the fall began (shallower the hotter play ran).
        const hushDepth = this.nova.hush / 0.9;
        const breathTarget = hush ? 1 - this.nova.hush * smooth(0, 0.6, falling) : 1 - this.dip;
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
            const pulse = 1 + Math.sin(t * 5 + i * 1.7) * 0.12 + this.pulse * 0.6 + throb * 0.35;
            row.set(
                a[0] + (b[0] - a[0]) * m,
                a[1] + (b[1] - a[1]) * m,
                a[2] + (b[2] - a[2]) * m,
                this.beadLit[i] * pulse,
            );
        }
        u.ring.value.set(
            1 + this.heat * 1.5 + this.surge * 2 + level * 0.6 + crit * 0.8,
            this.ringFlare + (lit >= RING.beads ? 0.5 : 0) + this.surge * 0.4 + this.b2bGlow * 0.9 + throb * 0.3
                + this.rekindle * 0.3,
            this.ringTurn + this.ringSpin,
            0,
        );

        // ── Uniforms ──
        // Each impact slot's mark, as much of it as has not given way to the stream that will
        // land in it (or burnt off in a detonation).
        let impactsLive = 0;
        for (let i = 0; i < IMPACT_SLOTS; i++) {
            const slot = this.impactSlots[i];
            const w = slot.strength * this.impactFade(slot, t);
            u.impactC[i].value.w = w;
            if (w > 0 && t - slot.birth < 34) impactsLive = 1;
        }
        u.impactsLive.value = impactsLive;
        u.time.value = t;
        u.boil.value = this.boil;
        u.flow.value = this.flow;
        u.breath.value = this.breath;
        u.twist.value = this.twist * (this.reducedMotion ? 0.3 : 1);
        // A newborn star is small, blue-white and far too bright; it cools as it swells.
        const young = newborn >= 0 ? Math.exp(-newborn / 4.5) : 0;
        const glow = afterglow * fs;
        // A star at the brink burns blue-white and cracks open along its lanes. A hotter star is
        // a hotter COLOUR, not a brighter one: its gain is held back as it heats, so the white of
        // its disc does not bloom over the frame (the newborn star alone is let blaze).
        u.heat.value = this.heat + falling * 1.1 + young * 1.25 + crit * 0.45 + fever * 0.05;
        u.fissure.value = clamp01(smooth(0.55, 0.95, this.heat) * 0.8 + falling * 1.2 + crit * (0.25 + 0.2 * throb)
            + smooth(0.45, 0.95, level) * 0.2);
        const held = 1 / (1 + this.heat * 0.5 + crit * 0.9);
        u.starGain.value = (1 + this.pulse * 0.55 + falling * 1.4 + glow * 5 + young * 0.7 + throb * 0.08) * held;
        // The light round the star is carried by its corona, the ring and the gas, in colour; the
        // lens's glare and the haze through the nebula grow less with heat than they used to, so
        // the frame keeps its darks.
        u.coronaGain.value = (1 + this.heat * 0.6 + this.surge * 0.6 + this.pulse * 0.4 + young * 1.5 + level * 0.2
            + fever * 0.15 + crit * 0.6 + throb * 0.25 + this.rekindle * 0.5) * (1 - falling * 0.8 * hushDepth);
        u.glare.value.set(
            0.5 + this.heat * 0.3 + this.surge * 0.2 + (this.flash * 2.5 + afterglow * 2) * fs,
            0.2 + this.heat * 0.2 + this.surge * 0.35 + (this.flash * 1.6 + afterglow * 2) * fs + young * 0.5
                + crit * 0.2,
        );
        u.haze.value = (0.5 + this.heat * 0.1 + this.surge * 0.25 + this.pulse * 0.1)
            * (1 - falling * 0.7 * hushDepth);
        u.skyPulse.value = Math.min(1.2, this.storm * 0.7 + this.surge * 0.5 + fever * 0.2);
        u.pulsar.value.set(
            newborn >= 0 ? pulsarGain(newborn) * 1.5 + this.rekindle * 0.8 : 0,
            this.pulsarPhase,
            13,
            0,
        );
        const heatTint = clamp01(this.heat * 0.2 + young * 0.6);
        // At the brink the corona takes the electric colour of the star's own rim.
        const rimTint = clamp01(crit * 0.4 + fever * 0.15) * (1 - young);
        const warm = (key, node, gain = 1) => {
            const c = p[key];
            for (let k = 0; k < 3; k++) {
                const fire = c[k] + (STARFIRE[k] - c[k]) * heatTint;
                this._from[k] = (fire + (p.rim[k] - fire) * rimTint) * gain;
            }
            node.value.set(this._from[0], this._from[1], this._from[2]);
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
        post.kick = Math.min(1, this.kick + play.punch * 0.15);
        const rays = 0.1 + this.heat * 0.08 + this.surge * 0.25 + this.pulse * 0.08 + glow * 0.6 + crit * 0.05;
        post.rays = hush ? lerp(rays, 0.03, hushDepth) : rays;
        post.streak = 0.08 + this.heat * 0.16 + this.surge * 0.5 + (this.flash * 0.9 + afterglow * 0.8) * fs;
        post.bloomBoost = this.surge * 0.2 + this.pulse * 0.15 + glow * 0.6 + level * 0.05;
        // The iris closes as the star flares and as play heats, so its colours survive the surge.
        post.exposure = 1 / (1 + this.surge * 0.6 + this.heat * 0.5 + this.pulse * 0.22 + this.storm * 0.12
            + glow * 1.6 + level * 0.1 + crit * 0.1);
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
            critical: this.critical,
            pressure: this.play.level,
            fever: this.play.fever,
            stage: this.play.stage,
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
/** The standing shells' colour rules, for the tests. */
export { SHELL_ORDER, hueBlend, shellColour };
