/**
 * Geode — the world.
 *
 * Owns the plan, the shared uniforms, every scene part, the camera rig and the choreography.
 * Shared by the theme (geode-theme.js) and the playground effect
 * (src/playground/effects/geode.effect.js), so what is iterated there ships.
 *
 * The camera floats inside a great hollow geode, looking down its long axis at the heart: a
 * window of backlit agate. The geode is an instrument of crystal and the board plays it:
 *
 *   lock     a ring of the piece's colour leaves the heart and runs out through the agate's
 *            bands into the lining, waking its glitter; a spark of the same colour leaves the
 *            card and flies into a hero crystal, which flashes from root to point, keeps some of
 *            that light, and sends a ripple over the wall round its foot. A hard drop sends
 *            three sparks and hits harder.
 *   clear    the cleared rows leave the card as blades of light, and a wave runs from the heart
 *            down the wall toward the viewer, one front per line: every crystal answers as it
 *            passes and lets go of the colour it was holding.
 *   combo    the geode GROWS: for every step of the chain a ring of crystals shoots out of the
 *            wall, each ring further from the heart and in the next colour of the spectrum; the
 *            heart brightens, the dust quickens. When the chain breaks the crown shatters.
 *   four     the geode holds its breath — every light sinks for a fifth of a second — then the
 *            lining fractures with light from the heart outward, every cluster's tallest crystal
 *            throws a prismatic lance, and a ring crosses the frame splitting it into colours.
 *   level    the geode recrystallises as the next mineral.
 *
 * Fast play BUILDS (src/themes/shared/gameplay-surge.js): every flash, kick, storm and surge is a
 * Swell that adds to what is still lit, the waves of a cascade stand on the wall together (six
 * slots, the weakest given up first), each deeper and further up the spectrum than the last, and
 * the heat of play is spent on the geode's own light:
 *   calm     as it always was;
 *   warm     the lining wakes: its glitter and the caustic fire on the druzy quicken;
 *   hot      the bells hum (every hero crystal's core glows), the dust streams, the stars flare,
 *            the heart burns brighter and the view leans in toward it;
 *   fever    the geode cracks open with light: the fracture network creeps out from the heart and
 *            burns, light pulsing outward along it, the heart turns to geodefire.
 * A late perfect clear crowns the clear still playing (every bell rings in fire opal and keeps
 * it, the heart's window flares white, the lances and the cracks blaze: nothing restarts);
 * back-to-back clears wind the agate tighter and set its bands blazing; a twist that clears
 * nothing still turns the agate half a notch. When the hands rest it all breathes back to calm.
 *
 * And with no help from the board it turns through the same minerals by the clock: it rests on
 * one, then melts into the next over most of a minute (mineralDrift). A level is a step on top
 * of wherever the clock has brought it.
 *
 * Everything is a function of the world clock and event timestamps (nothing is created at event
 * time), so seek(t) plus a fixed-step replay reproduces any frame.
 */

import * as THREE from 'three/webgpu';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';
import {
    CAVITY,
    CLEAR_LIVE,
    CLEAR_SLOTS,
    CLEAR_TRAVEL,
    CROWN_COLORS,
    CROWN_RINGS,
    DEG,
    FIRE_OPAL,
    FRACTURE_HEAL,
    FRACTURE_TRAVEL,
    GEODEFIRE,
    GEODE_PALETTES,
    HUSH_HOLD,
    MINERALS,
    NOISE_SIZE,
    PALETTE_KEYS,
    PULSE_FADE,
    PULSE_SLOTS,
    STRIKE_FADE,
    STRIKE_SLOTS,
    WISP_FLIGHT,
    approach,
    clamp01,
    clearEnergy,
    clearPassTime,
    createGeodeUniforms,
    createNoiseTexture,
    crownForCombo,
    mineralDrift,
    mulberry32,
    paletteAt,
    pieceColor,
    powerForCombo,
    smooth,
} from './geode-tsl.js';
import { planOptionsFor, sessionNoiseField, sessionPlan } from './geode-bakes.js';
import { tierFor } from './geode-quality.js';
import {
    airAt, airDrift, airName, visitAt, visitHeld,
} from './geode-airs.js';
import { createShell } from './geode-shell.js';
import { createCrystals, createDruzy } from './geode-crystals.js';
import {
    createAir, createGlitterFall, createRowBeams, createShards, createWisps,
} from './geode-fx.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './geode-composition.js';

/** The rest camera: floating on the cavity's axis, looking at the heart. */
export const REST_RIG = Object.freeze({
    /** Horizontal field of view the rig holds; the vertical one follows the aspect, clamped. */
    hFov: 92,
    minFov: 46,
    maxFov: 78,
    near: 0.3,
    far: 400,
});

/** Vertical field of view (degrees) for an aspect ratio. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((REST_RIG.hFov * DEG) / 2) / a)) / DEG;
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, v));
}

/** Seconds the overdrive after a four-line clear takes to cool to 1/e. */
export const SURGE_COOL = 3.2;
/** How far along the view ray (spans) a spark leaves the card. */
export const SPARK_DEPTH = 17;
/** Seconds a ring / a ripple / a clear wave stays in the geode (the shaders skip their loops after). */
const PULSE_LIVE = 5;
const STRIKE_LIVE = 4.5;
const FRACTURE_LIVE = FRACTURE_TRAVEL + FRACTURE_HEAL * 1.6;
/** Seconds the post's prism ring takes to cross the frame, and to fade to 1/e. */
const RING_LIFE = 2.2;
const RING_FADE = 0.75;
/** A ripple from a hard drop's second and third sparks only takes a slot whose ripple is this spent. */
const RIPPLE_SPENT = 0.12;
/** How far (spans) the view leans in toward the heart at full heat, and in a fever on top of that. */
const LEAN_HOT = 0.9;
const LEAN_FEVER = 1.5;

/**
 * How much of the heat of play the geode wears: none of it up to casual play's level (a lock
 * every second or so, a clear now and then), all of it at a long chain's.
 */
export const warmth = (level) => clamp01((level - 0.15) / 0.75);
/** A struck crystal sets this many of its cluster chiming, this far apart, at this share of its light. */
const CHIME_VOICES = 7;
const CHIME_GAP = 0.045;
const CHIME_SHARE = 0.42;
/** One notch of the agate's fortification: a twist turns the bands this far. */
const TWIST_NOTCH = 1 / 7;
/** Seconds a twist's pinwheel stays in the geode (the shaders skip it after), and its fall to 1/e. */
const WHIRL_LIVE = 7;
const WHIRL_FADE = 1.25;
/**
 * Seconds a level-up's front takes to carry the new mineral down the whole wall (the pale wave's
 * own run, and the width of the front behind it).
 */
export const SWEEP_LIFE = CLEAR_TRAVEL + 0.35;
/** How far (spans) the light behind the heart's window wanders from the axis. */
export const HEART_WANDER = 5.5;
/** A shower gameplay pours while the last is younger than this joins it instead of starting again. */
const FALL_JOIN = 2.6;

const PARTS = [
    'shell', 'druzy', 'crystals', 'glints', 'beams', 'air', 'glitterFall', 'shards', 'wisps', 'rowBeams',
];

export class GeodeWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {THREE.WebGPURenderer} [params.renderer]
     * @param {boolean} [params.capture=false]  deterministic captures: no wall-clock anywhere
     * @param {number} [params.seed]
     */
    constructor({
        scene, quality = 'High', renderer = null, capture = false, seed,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.renderer = renderer;
        this.capture = capture;
        // The noise, the plan over it and the shell are kept for the session (geode-bakes.js).
        this.noiseField = sessionNoiseField();
        this.plan = sessionPlan(this.noiseField, planOptionsFor(this.tier, seed));
        this.list = this.plan.crystalsFor(this.tier.heroes);
        /** Which drawn crystals stand in each hero cluster (a struck crystal sets its cluster chiming). */
        this.clusterMembers = this.plan.clusters.map(() => []);
        this.list.forEach((c, i) => {
            if (c.ring === 0 && c.cluster >= 0) this.clusterMembers[c.cluster].push(i);
        });
        this.root = new THREE.Group();
        this.root.name = 'Geode';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.crystals = null;
        this.shards = null;
        this.wisps = null;
        this.rowBeams = null;
        this.glitterFall = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        /** The heart on screen (fractions, y down): where the post's shafts come from. */
        this.heart = { x: 0.5, y: 0.5 };
        this.targets = { left: [], right: [] };
        this._camera = null;
        this._look = new THREE.Vector3();
        this._ray = new THREE.Vector3();
        this._vec = new THREE.Vector3();
        this._rest = new THREE.PerspectiveCamera(60, 16 / 9, REST_RIG.near, REST_RIG.far);
        this._point = { x: 0.5, y: 0.5 };
        this._from = [0, 0, 0];
        this._palette = {};
        this._paletteB = {};
        this._target = {};
        PALETTE_KEYS.forEach((key) => {
            this._palette[key] = [...GEODE_PALETTES[0][key]];
            this._paletteB[key] = [...GEODE_PALETTES[0][key]];
            this._target[key] = [...GEODE_PALETTES[0][key]];
        });
        /** The air the geode stands in this frame (geode-airs.js), and the visit under way. */
        this._air = airAt(0);
        this._visit = visitAt(-1);
        /** Hold one air, or one moment of one visit (captures); null lets the clock turn them. */
        this.airHold = null;
        this.visitHold = null;
        /** Visits can be switched off (captures of the geode at rest). */
        this.visits = true;
        this._post = {
            heart: this.heart,
            flash: 0,
            kick: 0,
            shafts: 0.3,
            bloomBoost: 0,
            exposure: 1,
            grade: 0,
            prism: { radius: 0, strength: 0 },
            /** The air's own iris (the event iris above is `exposure`: the post multiplies them). */
            airExposure: 1,
            /** The heart's rays in the dust: how far its two combs have turned, and how strongly they stand. */
            rays: { a: 0, b: 0, gain: 0.07 },
            /** The heart's colour, peak-normalised (the rays are drawn in it). */
            heartColor: [1, 0.8, 0.55],
            /** The air's grade: its lights' warmth, a saturation lift, the depth of its shadows. */
            airGrade: { warmth: 0, saturation: 0, depth: 0 },
        };
        /**
         * Every envelope the events light: each hit ADDS to what is still lit (a weak one after a
         * strong one can only lift it), rapid hits ride up under a soft ceiling, and each falls
         * away on its own clock. Read every frame into the numbers of the same names.
         */
        this.env = {
            /** The post's event flash (a lift on the whole frame; the post applies Reduce flashing). */
            flash: new Swell({ release: 0.25, ceiling: 0.6, knee: 0.4 }),
            /** The impact: the lens dollies and the fringe widens. */
            kick: new Swell({ release: 0.16, ceiling: 1.0, knee: 0.7 }),
            /** The stir in the cavity: the dust quickens, the heart lifts. Clears pile it up. */
            storm: new Swell({ release: 1.7, ceiling: 1.6, knee: 1.0 }),
            /** A four-line clear's overdrive: back-to-back fours stack. */
            surge: new Swell({ release: SURGE_COOL, ceiling: 1.8, knee: 1.15 }),
            /** The breath a broken chain lets go. */
            dip: new Swell({ release: 0.35, ceiling: 0.5, knee: 0.35 }),
            /** A clear's swell of the heart's shafts and the bloom (every clear adds to it). */
            glow: new Swell({ release: 0.7, ceiling: 1.3, knee: 0.85 }),
            /** A perfect clear's crown: the heart's window flares white and cools over ten seconds. */
            crown: new Swell({
                attack: 0.12, release: 2.6, ceiling: 1.4, knee: 1.0,
            }),
            /** Back-to-back: the agate's bands blaze, more with every one in a row. */
            band: new Swell({
                attack: 0.15, release: 3.5, ceiling: 1.2, knee: 0.8,
            }),
            /** The blaze: the light a chain's clears pour into the crown. */
            blaze: new Swell({
                attack: 0.3, release: 5, ceiling: 1.2, knee: 0.8,
            }),
            /** Three lines and more flood the lining with spectral fire. */
            fire: new Swell({
                attack: 0.25, release: 1.7, ceiling: 1.7, knee: 1.1,
            }),
            /** A perfect clear's opal fire: the play of colour over every facet. */
            opal: new Swell({
                attack: 0.35, release: 3.4, ceiling: 1.4, knee: 1.0,
            }),
        };
        /** How hot play runs (src/themes/shared/gameplay-surge.js), and its reading this frame. */
        this.play = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        this.resetState(0);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.combo = 0;
        this.power = 0;
        this.level = 1;
        this.mineralStep = 0;
        /** A level-up's front: the step it is carrying down the wall, when it left, whether it runs. */
        this.sweepTo = 0;
        this.sweepAt = -100;
        this.sweepOn = false;
        this.breath = 1;
        this.crown = 0;
        this.twistTarget = 0;
        this.twist = 0;
        this.hushUntil = -1;
        /** How deep the hush before a four-line clear goes: as deep as play was cold. */
        this.hushDepth = 1;
        /** The post's prism ring: when it left the heart, and how strongly. */
        this.ring = { time: -100, strength: 0 };
        /** Back-to-back difficult clears in a row. */
        this.b2bStreak = 0;
        Object.values(this.env).forEach((swell) => swell.reset());
        this.play.reset();
        this.heat.punch = 0;
        this.heat.level = 0;
        this.heat.fever = 0;
        this.heat.stage = 0;
        this.refresh(time);
        this.counts = {
            locks: 0, clears: 0, quads: 0, wisps: 0, shatters: 0, crowns: 0, spins: 0, whirls: 0, falls: 0,
        };
        // The slow clock is a function of the world clock until gameplay bends it.
        this.drift = time * (this.reducedMotion ? 0.3 : 1);
        this.crystals?.reset();
        this.shards?.reset();
        this.wisps?.reset();
        this.rowBeams?.reset();
        this.glitterFall?.reset();
        if (this.u) {
            this.u.whirl.value.set(-100, 0, 3, 1);
            this.u.sweep.value.set(-100, 0);
            this.u.opal.value = 0;
            this.u.live2.value.set(0, 0, 0, 0);
            for (let i = 0; i < PULSE_SLOTS; i++) this.u.pulseA[i].value.set(-100, 0, 1, 0);
            for (let i = 0; i < STRIKE_SLOTS; i++) this.u.strikeA[i].value.set(0, 0, 0, -100);
            for (let i = 0; i < CLEAR_SLOTS; i++) this.u.clearA[i].value.set(-100, 1, 0, 0);
            this.u.shock.value.set(-100, 0);
            this.u.shockB.value.set(-100, 0);
            this.u.veins.value.set(0, 0);
            this.u.heat.value.set(0, 0, 0, 0);
        }
    }

    /** The envelopes' readings at `t`, as the numbers the frame and the tests read. */
    refresh(t) {
        const { env } = this;
        this.flash = env.flash.valueAt(t);
        this.kick = env.kick.valueAt(t);
        this.storm = env.storm.valueAt(t);
        this.surge = env.surge.valueAt(t);
        this.dip = env.dip.valueAt(t);
    }

    build() {
        const noise = createNoiseTexture(this.noiseField, NOISE_SIZE);
        this.textures.push(noise);
        const u = createGeodeUniforms({ noise });
        this.u = u;
        const { tier, plan } = this;

        this.addPart('shell', createShell(u, plan, { glitter: tier.glitter, fracture: tier.fracture }));
        this.addPart('druzy', createDruzy(u, plan.druzy, tier.druzy, {
            caustics: tier.caustics, fracture: tier.fracture, facets: tier.glitter,
        }));
        const stones = createCrystals(u, this.list, { dispersion: tier.dispersion });
        this.crystals = stones.crystals;
        this.addPart('crystals', stones.crystals);
        this.addPart('glints', stones.glints);
        if (stones.beams) this.addPart('beams', stones.beams);
        this.addPart('air', createAir(u, plan.stars, { motes: tier.motes, stars: tier.stars }));
        this.glitterFall = createGlitterFall(u, tier.fall);
        this.addPart('glitterFall', this.glitterFall);

        // ── Gameplay effects (pools, always drawn) ──
        this.shards = createShards(u, tier.shards);
        this.addPart('shards', this.shards);
        this.wisps = createWisps(u);
        this.addPart('wisps', this.wisps);
        this.rowBeams = createRowBeams(u);
        this.addPart('rowBeams', this.rowBeams);

        this.applyPalette(1);
        this.findTargets();
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
            // With no board on screen the events aim at where the solo board would be in THIS frame.
            if (!this.layoutLive) this.layout = fallbackLayout(this.aspect * 1000, 1000);
            this.findTargets();
        }
    }

    /**
     * The live board / card / HUD rects (screen fractions), or null when no board is on screen:
     * events then aim at where the solo board would be.
     */
    setLayout(rects, aspect) {
        if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
        this.layoutLive = Boolean(rects);
        this.layout = rects || fallbackLayout(this.aspect * 1000, 1000);
        this.findTargets();
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Jump the clock (captures): drops every event in flight. */
    seek(time) {
        this.resetState(Math.max(0, time));
        this.applyPalette(1);
    }

    /** A new run: the geode back at rest (the dust keeps drifting). */
    resetSession() {
        const { time, drift } = this;
        this.resetState(time);
        this.drift = drift;
        this.applyPalette(1);
    }

    /** The camera that will render the world (kept for symmetry with the other worlds). */
    bindCamera(camera) {
        this._camera = camera;
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

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

    /**
     * Which hero crystals a spark can be sent to: the ones the rest camera sees clear of the
     * card, split by the side of the card they stand on, those nearest the card first.
     */
    findTargets() {
        const left = [];
        const right = [];
        if (this.crystals) {
            const cam = this.restCamera();
            const card = cardUnion(this.layout) || { x0: 0.4, x1: 0.6 };
            const centre = (card.x0 + card.x1) * 0.5;
            for (let i = 0; i < this.crystals.heroes; i++) {
                const c = this.list[i];
                // A spark needs a crystal big enough to be seen ringing.
                if (c.height < 4) continue;
                const reach = c.height * 0.7;
                this._vec.set(c.x + c.axis[0] * reach, c.y + c.axis[1] * reach, c.z + c.axis[2] * reach).project(cam);
                if (this._vec.z > 1 || Math.abs(this._vec.x) > 0.96 || Math.abs(this._vec.y) > 0.94) continue;
                const sx = this._vec.x * 0.5 + 0.5;
                if (sx > card.x0 - 0.01 && sx < card.x1 + 0.01) continue;
                const entry = { index: i, dist: sx < centre ? card.x0 - sx : sx - card.x1 };
                (sx < centre ? left : right).push(entry);
            }
            const byDist = (a, b) => a.dist - b.dist;
            left.sort(byDist);
            right.sort(byDist);
        }
        this.targets = { left: left.map((e) => e.index), right: right.map((e) => e.index) };
    }

    updateCamera(camera, sim) {
        const t = sim.time;
        const calm = this.reducedMotion ? 0 : 1;
        const fov = fovForAspect(this.aspect) - this.kick * 0.9 * calm;
        if (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        // A slow float, as of something weightless in the hollow, plus the pointer leaning the view.
        const swayX = (Math.sin(t * 0.13) * 1.5 + Math.sin(t * 0.071 + 1.3) * 1.0) * calm;
        const swayY = (Math.sin(t * 0.17 + 0.7) * 0.9 + Math.sin(t * 0.083) * 0.6) * calm;
        const swayZ = (Math.sin(t * 0.058 + 2.2) * 1.8) * calm;
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        // The view leans in toward the heart as play heats (none of it under reduced motion).
        const lean = (warmth(this.heat.level) * LEAN_HOT + this.heat.fever * LEAN_FEVER) * calm;
        camera.position.set(swayX + px * 2.4, swayY - py * 1.5, swayZ + this.kick * 0.5 * calm - lean);
        const yaw = (Math.sin(t * 0.09 + 2.1) * 0.012 - px * 0.03) * calm;
        const pitch = (Math.sin(t * 0.11) * 0.008 - py * 0.02) * calm;
        this._look.set(
            camera.position.x * 0.55 + Math.sin(yaw) * 60,
            camera.position.y * 0.55 + Math.tan(pitch) * 60,
            -60,
        );
        // It turns a little about the axis as it floats.
        camera.up.set(Math.sin(t * 0.047) * 0.035 * calm, 1, 0);
        camera.lookAt(this._look);
        // The shared breath (shared/camera-breath.js) on top of the float above: off under reduced motion.
        applyCameraBreath(camera, t, { scale: calm });
        camera.updateMatrixWorld();
        this._camera = camera;
        // The heart on screen: where the shafts come from.
        if (this.u) {
            // The light behind the heart's window wanders (as the day outside the stone might).
            const wander = HEART_WANDER * calm;
            const heartPos = this.u.heartPos.value;
            heartPos.x = (Math.sin(t * 0.023) * 0.7 + Math.sin(t * 0.0131 + 1.7) * 0.3) * wander;
            heartPos.y = (Math.sin(t * 0.019 + 2.3) * 0.65 + Math.sin(t * 0.011 + 0.4) * 0.35) * wander * 0.8;
            this._ray.copy(heartPos).project(camera);
            this.heart.x = Math.max(-0.5, Math.min(1.5, this._ray.x * 0.5 + 0.5));
            this.heart.y = Math.max(-0.5, Math.min(1.5, 0.5 - this._ray.y * 0.5));
        }
    }

    /** The world point `depth` spans along the ray through a screen point (fractions, y down). */
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

    // ── Gameplay ────────────────────────────────────────────────────────────────

    /**
     * The crystals a lock on `side` (−1 left, +1 right) can strike. A side with fewer than three
     * (a narrow screen at a low tier) borrows the other side's, so a hard drop still finds three.
     */
    targetsOn(side) {
        const own = side < 0 ? this.targets.left : this.targets.right;
        const other = side < 0 ? this.targets.right : this.targets.left;
        return own.length >= 3 ? own : [...own, ...other];
    }

    /** Pick the crystal a lock on `side` (−1 left, +1 right) strikes; those by the card more often. */
    pickTarget(side, salt = 0) {
        const list = this.targetsOn(side);
        if (!list.length) return -1;
        const rand = mulberry32(0x1f3d + (this.counts.locks + 1) * 2654435761 + salt * 97)();
        return list[Math.min(list.length - 1, Math.floor(rand ** 1.6 * list.length))];
    }

    /** Send a ring out from the heart at `time` (it takes the slot whose ring has faded most). */
    pulse(time, strength, rgb, reach = 1) {
        let slot = 0;
        let least = Infinity;
        for (let i = 0; i < PULSE_SLOTS; i++) {
            const A = this.u.pulseA[i].value;
            const age = this.time - A.x;
            let left = 0;
            if (age <= 0) left = A.y;
            else if (age < PULSE_LIVE) left = A.y * Math.exp(-age * PULSE_FADE);
            if (left < least) {
                least = left;
                slot = i;
            }
        }
        this.u.pulseA[slot].value.set(time, strength, reach, 0);
        this.u.pulseC[slot].value.set(rgb[0] * 1.4, rgb[1] * 1.4, rgb[2] * 1.4);
    }

    /**
     * Send one spark from a world point into crystal `index`. Returns its arrival time. A spark
     * sent `{ echo: true }` (a hard drop's second and third) ripples the wall only where a ripple
     * has spent itself: it never cuts one still running.
     */
    sendWisp(index, from, rgb, amount, salt = 0, { echo = false } = {}) {
        const c = this.list[index];
        if (!c || !this.wisps) return this.time;
        // It enters the stone somewhere in its upper half.
        const f = 0.5 + 0.38 * mulberry32(index * 31 + this.counts.wisps * 7 + salt)();
        const to = [c.x + c.axis[0] * c.height * f, c.y + c.axis[1] * c.height * f, c.z + c.axis[2] * c.height * f];
        const dist = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
        const flight = this.reducedMotion ? 0.12 : WISP_FLIGHT * (0.75 + Math.min(1.4, dist / 40));
        const arrive = this.time + flight;
        // The arc bows toward the viewer and away from the axis.
        const out = Math.hypot(to[0], to[1]) || 1;
        this.wisps.launch({
            from,
            to,
            rgb,
            time: this.time,
            flight,
            size: 0.5 + amount * 0.34,
            bow: [(to[0] / out) * dist * 0.1, (to[1] / out) * dist * 0.1 + dist * 0.05, dist * 0.14],
        });
        this.crystals.strike(index, rgb, arrive, amount, this.time);
        // The cluster chimes: its other crystals answer one after another, more faintly.
        const members = this.clusterMembers[c.cluster] || [];
        let step = 0;
        for (let k = 0; k < members.length && step < CHIME_VOICES; k++) {
            if (members[k] === index) continue;
            step += 1;
            const share = CHIME_SHARE * (1 - step / (CHIME_VOICES + 2));
            this.crystals.strike(members[k], rgb, arrive + step * CHIME_GAP, amount * share, this.time);
        }
        // A ripple runs over the wall from the crystal's foot when the spark arrives (in the slot
        // whose ripple has faded most).
        let slot = 0;
        let least = Infinity;
        for (let i = 0; i < STRIKE_SLOTS; i++) {
            const age = this.time - this.u.strikeA[i].value.w;
            const { w: lit } = this.u.strikeC[i].value;
            let left = 0;
            if (age <= 0) left = lit;
            else if (age < STRIKE_LIVE) left = lit * Math.exp(-age * STRIKE_FADE);
            if (left < least) {
                least = left;
                slot = i;
            }
        }
        if (!echo || least < RIPPLE_SPENT) {
            this.u.strikeA[slot].value.set(c.x, c.y, c.z, arrive);
            this.u.strikeC[slot].value.set(rgb[0] * 1.3, rgb[1] * 1.3, rgb[2] * 1.3, 0.55 + amount * 0.45);
        }
        const share = this.shards.count / 512;
        this.shards.emit({
            x: to[0],
            y: to[1],
            z: to[2],
            n: Math.round((8 + 14 * amount) * share),
            rgb,
            time: arrive,
            dir: c.axis,
            out: [0.6, 4.5 + amount * 3.5],
            along: [0.5, 5 + amount * 3],
            size: 0.05 + c.height * 0.004,
            now: this.time,
        });
        this.counts.wisps += 1;
        return arrive;
    }

    /**
     * A piece locked. `u` = its column as a fraction of the board width, `rows` = the visible
     * rows it covers, `color` = the piece's colour; `screen` (fractions) replaces the board point.
     */
    onLock({
        u = 0.5, rows = null, hardDrop = false, color = null, player = 0, screen = null,
    } = {}) {
        if (!this.u || !this.crystals) return;
        const rgb = pieceColor(color);
        // ── The ring: the heart answers in the piece's colour ──
        this.pulse(this.time, hardDrop ? 1.15 : 0.75, rgb, hardDrop ? 1.12 : 0.92);

        // ── The spark: the piece's light flies into a crystal ──
        let wx = 0.5;
        let wy = 0.6;
        let side = u < 0.5 ? -1 : 1;
        if (Math.abs(u - 0.5) < 0.03) side = this.counts.locks % 2 ? 1 : -1;
        if (screen) {
            wx = screen.x;
            wy = screen.y;
            side = screen.x < 0.5 ? -1 : 1;
        } else {
            const board = boardFor(this.layout, player);
            const card = cardUnion(this.layout);
            if (board) {
                const row = Array.isArray(rows) && rows.length ? rows[Math.floor(rows.length / 2)] : 19;
                boardPoint(board, u, row, this._point);
                // The spark leaves the card's edge on the piece's side, at the piece's height.
                const edges = card || board;
                wx = side < 0 ? edges.x0 : edges.x1;
                wy = this._point.y;
            }
        }
        const from = this.screenToWorld(wx, wy, SPARK_DEPTH);
        const target = this.pickTarget(side);
        if (target >= 0) {
            this.sendWisp(target, from, rgb, hardDrop ? 1.3 : 0.85);
            if (hardDrop) {
                // Two more, into the next two crystals on that side.
                const list = this.targetsOn(side);
                const at = list.indexOf(target);
                for (let k = 1; k <= 2 && k < list.length; k++) {
                    this.sendWisp(list[(at + k) % list.length], from, rgb, 0.6, k, { echo: true });
                }
            }
        }
        const now = this.time;
        this.env.kick.hit(hardDrop ? 0.5 : 0.1, now);
        this.env.flash.hit(hardDrop ? 0.1 : 0.02, now);
        this.play.lock({ hardDrop }, now);
        this.refresh(now);
        this.counts.locks += 1;
    }

    /** The clear slot a new wave takes: the one with the least left on the wall (never the newest). */
    clearSlot() {
        let slot = 0;
        let least = Infinity;
        for (let i = 0; i < CLEAR_SLOTS; i++) {
            const A = this.u.clearA[i].value;
            const left = clearEnergy(A.x, A.z, this.time);
            if (left < least) {
                least = left;
                slot = i;
            }
        }
        return slot;
    }

    /**
     * The post's prism ring leaves the heart at `at`. A ring already crossing the frame brighter
     * than half this one carries its light instead of restarting (a twist inside a four-line
     * clear's ring, a perfect clear's crown): only a fainter one is replaced, by a brighter.
     */
    ringOut(strength, at) {
        const { ring } = this;
        const age = at - ring.time;
        let left = 0;
        if (age < 0) left = ring.strength;
        else if (age < RING_LIFE) left = ring.strength * Math.exp(-age / RING_FADE);
        if (left >= strength * 0.5) {
            // Raise what it shows from here on by half this one's light.
            ring.strength += strength * 0.5 * (age > 0 ? Math.exp(age / RING_FADE) : 1);
            ring.strength = Math.min(ring.strength, 1.4 * (age > 0 ? Math.exp(age / RING_FADE) : 1));
        } else {
            ring.time = at;
            ring.strength = Math.min(1.4, strength + left);
        }
    }

    /**
     * A four-line clear's fracture opens at `birth`. The one still healing moves under it (two
     * are drawn): the fainter of the two older ones is the one that goes.
     */
    openFracture(birth, strength) {
        const A = this.u.shock.value;
        const B = this.u.shockB.value;
        const left = (v) => {
            const age = this.time - v.x;
            if (age < 0) return v.y;
            if (age >= FRACTURE_LIVE) return 0;
            return v.y * Math.exp(-Math.max(0, age - FRACTURE_TRAVEL) / (FRACTURE_HEAL * 0.4));
        };
        if (left(A) > left(B)) B.copy(A);
        A.set(birth, strength);
    }

    /**
     * Lines cleared. `lines` 1..4; `twist`, `perfect`, `b2b`; `cascade` is this wave's depth in
     * its lock's cascade (1 = the lock's own clear), `combo` the true chain.
     */
    onClear({
        rows = null, lines = 1, twist = false, perfect = false, b2b = false, cascade = 1, combo = 1,
        player = 0, screen = null,
    } = {}) {
        const { u: uniforms } = this;
        if (!uniforms || !this.crystals) return;
        const now = this.time;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        // How deep in its cascade this wave is (0 = the lock's own clear).
        const depth = Math.max(0, Math.min(9, Math.round(Number(cascade) || 1) - 1));
        const p = this._palette;
        // One line answers in the agate's first band, two in the heart's light, three in the lining's.
        let rgb;
        if (quad) rgb = [...GEODEFIRE];
        else if (n === 1) rgb = [...p.band0];
        else if (n === 2) rgb = [0, 1, 2].map((c) => p.heart[c] * 0.8 + p.band3[c] * 0.3);
        else rgb = [0, 1, 2].map((c) => p.druzy[c] * 0.7 + p.heart[c] * 0.5);
        if (depth > 0 && !quad) {
            // Each deeper wave of a cascade climbs the spectrum: the wall pours a rainbow.
            const climb = CROWN_COLORS[(depth - 1) % CROWN_RINGS];
            rgb = rgb.map((c, k) => c * 0.35 + climb[k] * 0.65);
        }
        const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
        rgb = rgb.map((c) => (c / peak) * 0.92 + 0.08);
        // Deeper waves run stronger, with more fronts.
        const strength = Math.min(1.8, (0.62 + 0.14 * n + (quad ? 0.25 : 0)) * (1 + 0.12 * depth));
        const fronts = perfect ? 4 : Math.min(4, n + depth);
        const birth = quad ? now + HUSH_HOLD : now;
        if (quad) {
            // The geode holds its breath — as deep as play was cold: a four in a fever only inhales.
            this.hushDepth = (1 - 0.85 * clamp01(this.heat.level)) * flashScale();
        }

        // ── The wave leaves the heart (in the slot with the least left on the wall) ──
        const slot = this.clearSlot();
        // (the wave that was in this slot is no longer drawn: the crystals forget it too)
        const forget = uniforms.clearA[slot].value.x;
        uniforms.clearA[slot].value.set(birth, fronts, strength, quad ? 1 : 0);
        uniforms.clearC[slot].value.set(rgb[0] * 1.25, rgb[1] * 1.25, rgb[2] * 1.25);
        // The heart's shafts and the bloom swell with it, on top of what the last clear left.
        this.env.glow.hit(0.3 + 0.12 * n + 0.05 * depth, birth);

        // ── Every crystal lets go of what it holds as the wave passes it ──
        const { released, passes, amounts } = this.crystals.release(birth, rgb, strength, {
            beam: quad ? 1 : 0, now, forget,
        });
        const holders = [];
        for (let i = 0; i < this.crystals.heroes && holders.length < 16; i++) {
            if (amounts[i] > 0.12) holders.push(i);
        }
        const share = this.shards.count / 512;
        for (let k = 0; k < holders.length; k++) {
            const i = holders[k];
            const c = this.list[i];
            this.shards.emit({
                x: c.tip[0],
                y: c.tip[1],
                z: c.tip[2],
                n: Math.round((quad ? 20 : 12) * share),
                rgb,
                time: passes[i],
                dir: c.axis,
                out: [0.8, 6],
                along: [1.5, 9],
                life: [1.0, 2.2],
                size: 0.05 + c.height * 0.004,
                now,
            });
        }
        // A chain pours what its clears let go into the crown: it blazes brighter with each.
        if (combo >= 2 || depth > 0) this.env.blaze.hit(Math.min(0.45, 0.08 + released * 0.025), birth + 0.6);
        this.env.storm.hit(Math.min(1.4, 0.3 + 0.14 * n + released * 0.06 + (quad ? 0.4 : 0)) * (1 + 0.1 * depth), now);
        // The camera takes the blow a beat after the wave leaves; deeper waves hit harder.
        const blow = (0.22 + 0.1 * n) * (1 + 0.15 * depth);
        this.env.kick.hit(blow, birth + 0.12);
        this.env.flash.hit(blow * 0.5, birth + 0.12);

        // ── Two lines shake dust loose from the vault; three set fire running over the lining ──
        if (n >= 2 || quad) this.pourGlitter(birth, Math.min(1.5, 0.55 + 0.2 * n + 0.1 * depth), rgb);
        if (n >= 3 || quad) this.env.fire.hit(Math.min(1.2, 0.65 + 0.2 * depth + (quad ? 0.25 : 0)), birth + 0.15);

        // ── The cleared rows leave the card as blades of light ──
        const board = boardFor(this.layout, player);
        const card = cardUnion(this.layout);
        if (board && card && this.layoutLive && !screen) {
            const list = Array.isArray(rows) && rows.length ? rows : Array.from({ length: n }, (_, i) => 19 - i);
            const ys = [];
            for (let i = 0; i < list.length && i < 4; i++) ys.push(boardPoint(board, 0.5, list[i], this._point).y);
            this.rowBeams.fire(ys, card.x0, card.x1, rgb, now, Math.min(1.4, 0.7 + 0.18 * n) * (1 + 0.15 * depth));
        }

        if (quad) {
            // The geode holds its breath, then everything fires.
            this.hushUntil = now + HUSH_HOLD;
            this.env.surge.hit(perfect ? 1.3 : 1, now);
            const shock = this.reducedMotion ? 0.5 : 1;
            this.openFracture(birth, shock);
            this.ringOut(shock, birth);
            // Every cluster's tallest point throws dust with its lance.
            for (let i = 0; i < this.crystals.heroes; i++) {
                const c = this.list[i];
                if (!c.main) continue;
                this.shards.emit({
                    x: c.tip[0],
                    y: c.tip[1],
                    z: c.tip[2],
                    n: Math.round(14 * share),
                    rgb: GEODEFIRE,
                    time: passes[i],
                    dir: c.axis,
                    out: [0.5, 5],
                    along: [3, 16],
                    life: [1.2, 2.6],
                    size: 0.07,
                    stagger: 0.3,
                    now,
                });
            }
            this.counts.quads += 1;
        }
        if (twist) {
            // The agate itself turns a notch, and a pinwheel of light winds out of the heart.
            this.twistTarget += TWIST_NOTCH;
            this.env.storm.hit(0.55, now);
            this.whirlOut(0.85 + 0.12 * n, 3, now);
            // …and a faint prism ring crosses the frame (no fracture).
            if (!quad) this.ringOut(0.42, now);
        }
        // A perfect clear in the same frame as its clear: the opal fire starts with it.
        if (perfect) this.env.opal.hit(1, birth);
        // Back-to-back: the second difficult clear in a row (and every one after) winds the agate.
        this.b2bStreak = b2b ? this.b2bStreak + 1 : 0;
        if (b2b) this.backToBack(this.b2bStreak);
        // The heat of play: a cascade's later waves each count as one more wave of the same lock.
        this.play.clear({
            lines: n, cascade: depth > 0 ? 2 : 1, combo: depth > 0 ? 1 : combo, twist, perfect, b2b,
        }, now);
        this.refresh(now);
        this.counts.clears += 1;
    }

    /**
     * Back-to-back (the `streak`-th in a row): the agate's fortification winds half a notch
     * tighter, its bands blaze (more with every one in a row), and rings in the bands' own colours
     * run out of the heart one after another — two, then three.
     */
    backToBack(streak) {
        const now = this.time;
        const k = Math.min(4, Math.max(1, streak));
        this.twistTarget += TWIST_NOTCH * 0.5;
        this.env.band.hit(0.45 + 0.15 * k, now);
        const rings = Math.min(3, 1 + k);
        for (let j = 0; j < rings; j++) {
            const c = this._palette[`band${j % 4}`];
            const peak = Math.max(c[0], c[1], c[2], 1e-4);
            this.pulse(now + 0.1 * j, 1.0, [c[0] / peak, c[1] / peak, c[2] / peak], 0.95 + 0.07 * j);
        }
    }

    /**
     * A perfect clear, settled after its clear's last wave: the crown on the clear still playing,
     * never a second one. Every bell rings at once in fire opal, from the heart outward, and keeps
     * the colour; the heart's window flares white and cools over ten seconds; the lances still
     * standing and the cracks still open burn brighter; a fire-opal ring leaves the heart. No hush.
     */
    onPerfect() {
        if (!this.u || !this.crystals) return;
        const now = this.time;
        this.play.crown(now);
        this.env.crown.hit(1, now);
        // Opal fire: every facet in the geode plays a colour of its own, and dust comes down through it.
        this.env.opal.hit(1, now);
        this.env.fire.hit(0.35, now);
        this.pourGlitter(now, 1.3, FIRE_OPAL);
        this.env.surge.hit(0.35, now);
        this.env.flash.hit(0.3, now);
        this.env.storm.hit(0.5, now);
        this.ringOut(0.9, now);
        this.crystals.ringAll(FIRE_OPAL, now + 0.05, 1.1, { now, spread: 0.5 });
        this.crystals.boostLances(0.8, now);
        const shock = this.u.shock.value;
        if (now - shock.x < FRACTURE_LIVE && shock.y > 0) shock.y = Math.min(1.6, shock.y + 0.45);
        this.pulse(now, 1.3, FIRE_OPAL, 1.25);
        // The bells' points throw fire-opal dust as the ringing reaches them.
        const share = this.shards.count / 512;
        for (let i = 0; i < this.crystals.heroes; i++) {
            const c = this.list[i];
            if (!c.main) continue;
            this.shards.emit({
                x: c.tip[0],
                y: c.tip[1],
                z: c.tip[2],
                n: Math.round(10 * share),
                rgb: FIRE_OPAL,
                time: now + 0.05 + 0.5 * clearPassTime(c.w),
                dir: c.axis,
                out: [0.6, 5],
                along: [2, 12],
                life: [1.2, 2.6],
                size: 0.07,
                now,
            });
        }
        this.refresh(now);
        this.counts.crowns += 1;
    }

    /** A twist that cleared nothing: the agate turns half a notch, and a faint ring leaves the heart. */
    onSpin() {
        if (!this.u) return;
        const now = this.time;
        this.twistTarget += TWIST_NOTCH * 0.5;
        this.env.storm.hit(0.35, now);
        this.ringOut(0.22, now);
        this.whirlOut(0.5, 2, now);
        const c = this._palette.band3;
        const peak = Math.max(c[0], c[1], c[2], 1e-4);
        this.pulse(now, 0.7, [c[0] / peak, c[1] / peak, c[2] / peak], 0.85);
        this.play.spin(now);
        this.refresh(now);
        this.counts.spins += 1;
    }

    /**
     * A twist's pinwheel winds out of the heart at `at`: `arms` arms of iridescent light turning
     * about the axis (each one the other way from the last). One still turning brighter than half
     * this one carries its light instead of starting again.
     */
    whirlOut(strength, arms, at) {
        if (!this.u) return;
        const W = this.u.whirl.value;
        const age = at - W.x;
        const left = age >= 0 && age < WHIRL_LIVE && W.y > 0 ? W.y * Math.exp(-age / WHIRL_FADE) : 0;
        if (left >= strength * 0.5) {
            const grown = age > 0 ? Math.exp(age / WHIRL_FADE) : 1;
            W.y = Math.min(1.8 * grown, W.y + strength * 0.5 * grown);
        } else {
            W.set(at, Math.min(1.8, strength + left), arms, this.counts.whirls % 2 ? -1 : 1);
            this.counts.whirls += 1;
        }
    }

    /**
     * Dust shaken loose from the vault comes down through the cavity from `at`, in `rgb`. Gameplay
     * has two showers: the one that began longest ago is poured again; while the newest is still
     * young it takes this one's dust instead (nothing in the air restarts).
     */
    pourGlitter(at, strength, rgb) {
        const fall = this.glitterFall;
        if (!fall || this.reducedMotion) return;
        const ageA = fall.ageOf(1, at);
        const ageB = fall.ageOf(2, at);
        const newest = ageA <= ageB ? 1 : 2;
        const youngest = Math.min(ageA, ageB);
        if (youngest < FALL_JOIN) {
            // (the dust already in the air takes half this shower's colour)
            const row = fall.uniforms.rows[newest].value;
            row.y = Math.min(1.6, row.y + strength * 0.4);
            const tone = fall.uniforms.colors[newest].value;
            tone.set((tone.x + rgb[0]) * 0.5, (tone.y + rgb[1]) * 0.5, (tone.z + rgb[2]) * 0.5);
            return;
        }
        const slot = newest === 1 ? 2 : 1;
        fall.pour(slot, at, strength, rgb, (this.counts.falls * 0.618034) % 1);
        this.counts.falls += 1;
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        if (n === 0 && this.combo >= 2) {
            // The chain broke: the crown shatters and the geode lets its breath go.
            this.env.dip.hit(0.28, this.time);
            this.refresh(this.time);
            this.shatterCrown();
        } else if (n > this.combo && crownForCombo(n) > crownForCombo(this.combo) && this.u) {
            // A new ring of the crown: the heart announces it in the ring's colour.
            this.pulse(this.time, 0.85, CROWN_COLORS[crownForCombo(n) - 1], 1.05);
        }
        this.combo = n;
    }

    /** The crown's standing rings burst into dust in their own colours. */
    shatterCrown() {
        const { plan } = this;
        if (!this.shards || !plan.crown.length) return;
        const standing = Math.min(CROWN_RINGS, Math.ceil(this.crown - 0.05));
        if (standing <= 0) return;
        const share = this.shards.count / 512;
        // Every third crystal throws: the pool is shared with the strikes.
        const stride = Math.max(2, Math.round(3 / Math.max(0.3, share)));
        for (let i = 0; i < plan.crown.length; i += stride) {
            const c = plan.crown[i];
            if (c.ring > standing) continue;
            this.shards.emit({
                x: c.tip[0],
                y: c.tip[1],
                z: c.tip[2],
                n: 5,
                rgb: CROWN_COLORS[c.ring - 1],
                time: this.time + (standing - c.ring) * 0.04,
                dir: c.axis,
                out: [0.6, 5],
                along: [-2, 6],
                life: [0.9, 2.0],
                size: 0.07,
            });
        }
        this.counts.shatters += 1;
    }

    /** A new level: the geode recrystallises as the next mineral. */
    levelUp(level, { silent = false } = {}) {
        this.level = Math.max(1, Math.round(Number(level) || 1));
        if (silent) this.applyPalette(1);
        else {
            const now = this.time;
            // The new mineral runs down the wall behind the pale wave (a front still running lands).
            if (this.sweepOn) this.mineralStep = this.sweepTo;
            this.sweepTo = this.level - 1;
            this.sweepAt = now;
            this.sweepOn = this.sweepTo !== this.mineralStep;
            this.env.storm.hit(0.75, now);
            this.env.flash.hit(0.14, now);
            this.play.levelUp(now);
            // A pale wave carries the new mineral down the wall (in a slot of its own: the clear
            // that brought the level keeps its wave).
            const next = paletteAt(this.mineralPhase(), this._target);
            const pale = next.heart.map((c) => c * 0.7 + 0.3);
            if (this.u) {
                const slot = this.clearSlot();
                const forget = this.u.clearA[slot].value.x;
                this.u.clearA[slot].value.set(now, 2, 0.8, 0);
                this.u.clearC[slot].value.set(pale[0], pale[1], pale[2]);
                // It is a wave like any other: every crystal lets go of what it holds as it passes.
                this.crystals?.release(now, pale, 0.8, { now, forget });
            }
            this.env.glow.hit(0.54, now);
            this.refresh(now);
        }
    }

    /**
     * Where the geode is heading in its cycle of minerals: one step per level, turned on by the
     * clock. The whole part names a mineral, the fraction is how far it has melted into the next.
     */
    mineralPhase() {
        return (this.level - 1) + mineralDrift(this.time);
    }

    /** How far a level-up's front has run (0..1; 0 when none is running). */
    sweepProgress() {
        return this.sweepOn ? clamp01((this.time - this.sweepAt) / SWEEP_LIFE) : 0;
    }

    /**
     * Set the live palettes. The clock's turn is exact (a function of the time alone, so a seek
     * and a replay agree). A level's step is carried down the wall by a front (levelUp): until it
     * has run, the first palette is the mineral the geode was and the second the one it is
     * turning into, and the materials show each on its own side of the front. `k` = 1 lands the
     * step at once; a step with no front (never in play) eases in by `k`.
     */
    applyPalette(k) {
        const step = this.level - 1;
        if (k >= 1) {
            this.mineralStep = step;
            this.sweepOn = false;
        } else if (this.sweepOn) {
            if (this.time - this.sweepAt >= SWEEP_LIFE || this.time < this.sweepAt) {
                this.mineralStep = this.sweepTo;
                this.sweepOn = false;
            }
        } else if (this.mineralStep !== step) {
            this.mineralStep += (step - this.mineralStep) * k;
            if (Math.abs(step - this.mineralStep) < 1e-4) this.mineralStep = step;
        }
        const drift = mineralDrift(this.time);
        paletteAt(this.mineralStep + drift, this._palette);
        paletteAt((this.sweepOn ? this.sweepTo : this.mineralStep) + drift, this._paletteB);
    }

    // ── Frame ───────────────────────────────────────────────────────────────────

    update(sim) {
        const { u } = this;
        if (!u) return;
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const t = this.time;
        const motion = this.reducedMotion ? 0.3 : 1;

        // ── The heat of play, and every envelope's reading ──
        const reading = this.play.sample(t);
        const { heat } = this;
        heat.punch = reading.punch;
        heat.level = reading.level;
        heat.fever = reading.fever;
        heat.stage = reading.stage;
        const { fever } = heat;
        // What the geode wears of it: nothing under casual play (it looks as it always has), all of
        // it once the hands are quick.
        const level = warmth(heat.level);
        this.refresh(t);
        const { env } = this;
        const glow = env.glow.valueAt(t);
        const blaze = env.blaze.valueAt(t);
        const band = env.band.valueAt(t);
        // Three lines' fire on the lining, and a perfect clear's opal fire (gentler under Reduce flashing).
        const fireFlood = env.fire.valueAt(t);
        const opal = env.opal.valueAt(t) * (0.4 + 0.6 * flashScale());
        // ── The air the geode stands in, and what visits it (geode-airs.js) ──
        const air = airAt(this.airHold ?? airDrift(t), this._air);
        const visit = this.readVisit(t);
        // A perfect clear's white flare (gentler under Reduce flashing).
        const flare = env.crown.valueAt(t) * (0.35 + 0.65 * flashScale());

        // ── The charge ──
        const target = powerForCombo(this.combo);
        this.power += (target - this.power) * approach(target > this.power ? 2.4 : 0.8, dt);
        this.crystals?.tick(t);
        const hush = t < this.hushUntil ? 1 : 0;
        const breathTarget = hush ? 1 - 0.88 * this.hushDepth : 1 - this.dip;
        this.breath += (breathTarget - this.breath) * approach(hush ? 40 : 14, dt);
        if (dt === 0) this.breath = breathTarget;

        // One ring of the crown for every step of the chain past the first; when the chain breaks
        // it sinks back into the wall over a second or two while it shatters.
        const crownTarget = crownForCombo(this.combo);
        this.crown += (crownTarget - this.crown) * approach(crownTarget > this.crown ? 4.2 : 2.2, dt);
        if (Math.abs(crownTarget - this.crown) < 1e-3) this.crown = crownTarget;
        this.twist += (this.twistTarget - this.twist) * approach(3.2, dt);
        this.applyPalette(approach(0.8, dt));

        // ── The slow clock: the dust streams faster the hotter play runs ──
        this.drift += dt * motion * (1 + this.power * 3 + this.surge * 5 + this.storm * 2 + level * 1.2 + fever * 2);

        // ── Uniforms ──
        let pulseLive = 0;
        for (let i = 0; i < PULSE_SLOTS; i++) {
            if (t - u.pulseA[i].value.x < PULSE_LIVE) pulseLive = 1;
        }
        let strikeLive = 0;
        for (let i = 0; i < STRIKE_SLOTS; i++) {
            if (t - u.strikeA[i].value.w < STRIKE_LIVE) strikeLive = 1;
        }
        let clearLive = 0;
        for (let i = 0; i < CLEAR_SLOTS; i++) {
            if (t - u.clearA[i].value.x < CLEAR_LIVE) clearLive = 1;
        }
        // A fever holds the fracture open: its cracks creep out from the heart as the fever fills
        // (from Medium up: the crack network is a pixel's dearest sum).
        const veins = this.tier.glitter ? fever * 0.55 : 0;
        u.veins.value.set(veins, CAVITY.wHeart + (CAVITY.wMax - CAVITY.wHeart) * smooth(0, 1, fever));
        const shockAge = t - u.shock.value.x;
        const shockBAge = t - u.shockB.value.x;
        const fractured = (shockAge >= 0 && shockAge < FRACTURE_LIVE) || (shockBAge >= 0 && shockBAge < FRACTURE_LIVE)
            || veins > 1e-3;
        u.live.value.set(pulseLive, strikeLive, clearLive, fractured ? 1 : 0);
        u.time.value = t;
        u.power.value = this.power;
        u.surge.value = this.surge;
        u.breath.value = this.breath;
        u.drift.value = this.drift;
        u.twist.value = this.twist;
        u.crown.value = this.crown;
        u.heat.value.set(level, fever, blaze, band);
        // The air: light through the wall's thin places, the stones' inner fire, spectral fire
        // (three lines and a visit flood it), the moonstone sheen; sparkle, dust, how far the thin
        // places have wandered and how far the heart's light carries; the viewer's own lamp.
        const visitFire = visit.kind === 'fire' ? visit.env * 1.3 : 0;
        u.mood.value.set(air.thin, air.inner, air.fire + fireFlood * 1.5 + visitFire, air.sheen);
        u.air.value.set(air.sparkle, air.dust, t * 0.0035, air.reach);
        u.lamp.value.set(air.fill, t * 0.019);
        u.opal.value = opal;
        // A visit: sparkle running over the lining, the heart's slow ring, a cluster ringing by
        // itself, a shower of dust. Each is a function of the clock alone.
        const still = this.reducedMotion;
        const shimmer = u.shimmer.value.set(0, 0, 0, 0);
        u.swell.value.set(0, 0);
        u.chime.value.w = 0;
        let swellLift = 0;
        let visitLive = 0;
        if (visit.kind === 'shimmer' && !still) {
            shimmer.x = visit.seed + (visit.seedB < 0.5 ? -1 : 1) * visit.k * 1.2;
            shimmer.y = visit.env;
            visitLive = 1;
        } else if (visit.kind === 'cascade' && !still) {
            shimmer.z = CAVITY.wBands - 0.25 + visit.k * 1.25;
            shimmer.w = visit.env;
            visitLive = 1;
        } else if (visit.kind === 'swell') {
            u.swell.value.set(0.25 + visit.k * 1.9, visit.env * 0.9);
            swellLift = visit.env * (1 - visit.k);
            visitLive = 1;
        } else if (visit.kind === 'chime') {
            const cluster = this.plan.clusters[Math.floor(visit.seed * this.plan.clusters.length)];
            const tone = this._palette[`m${cluster.mineral}`];
            const tonePeak = Math.max(tone[0], tone[1], tone[2], 1e-4);
            u.chime.value.set(
                cluster.root[0],
                cluster.root[1],
                cluster.root[2],
                visit.env * (0.85 + 0.15 * Math.sin(visit.age * 7)),
            );
            u.chimeC.value.set(tone[0] / tonePeak, tone[1] / tonePeak, tone[2] / tonePeak);
        }
        if (this.glitterFall) {
            // (slot 0 is the visits': poured from the clock every frame, so a seek shows it too)
            if (visit.kind === 'fall' && !still) {
                this.glitterFall.pour(0, t - visit.age, 0.9, this._palette.heart, visit.seed);
            } else this.glitterFall.uniforms.rows[0].value.y = 0;
        }
        const whirlAge = t - u.whirl.value.x;
        u.live2.value.set(
            whirlAge >= 0 && whirlAge < WHIRL_LIVE && u.whirl.value.y > 0 ? 1 : 0,
            opal > 2e-3 ? 1 : 0,
            visitLive,
            u.chime.value.w > 0 ? 1 : 0,
        );
        const p = this._palette;
        const pB = this._paletteB;
        // A level-up's front: the materials show the first palette ahead of it and the second behind.
        u.sweep.value.set(this.sweepAt, this.sweepOn ? 1 : 0);
        const turned = this.sweepOn ? smooth(0, 1, (t - this.sweepAt) / CLEAR_TRAVEL) : 0;
        // The heart turns to geodefire in a four-line clear's surge, and its window flares white for
        // a perfect clear. (Its light lights everything: the heat of play is spent elsewhere, so
        // the lining keeps its dark.)
        const fire = clamp01(this.surge * 0.5);
        const white = Math.min(1, flare) * 0.4;
        // The heart breathes, slowly.
        // …and the air sets how hard it burns, how white, how cool; a visit can swell it.
        const lift = (1 + this.power * 0.25 + Math.min(this.storm, 0.8) * 0.12 + flare * 0.35 + swellLift * 0.4)
            * (1 + Math.sin(t * 0.8) * 0.045 * motion) * air.heart;
        const fillPeak = Math.max(p.fill[0], p.fill[1], p.fill[2], 1e-4);
        for (let c = 0; c < 3; c++) {
            const own = p.heart[c] + (pB.heart[c] - p.heart[c]) * turned;
            const hot = own + (GEODEFIRE[c] - own) * fire;
            const pale = hot + (1 - hot) * air.white;
            const aired = pale + ((p.fill[c] / fillPeak) * 0.9 - pale) * air.cool;
            u.heart.value.setComponent(c, (aired + (1 - aired) * white) * lift);
        }
        u.fill.value.set(p.fill[0], p.fill[1], p.fill[2]);
        u.rock.value.set(p.rock[0], p.rock[1], p.rock[2]);
        u.druzy.value.set(p.druzy[0], p.druzy[1], p.druzy[2]);
        u.fillB.value.set(pB.fill[0], pB.fill[1], pB.fill[2]);
        u.rockB.value.set(pB.rock[0], pB.rock[1], pB.rock[2]);
        u.druzyB.value.set(pB.druzy[0], pB.druzy[1], pB.druzy[2]);
        for (let i = 0; i < 4; i++) {
            const c = p[`band${i}`];
            u.bands[i].value.set(c[0], c[1], c[2]);
            const d = pB[`band${i}`];
            u.bandsB[i].value.set(d[0], d[1], d[2]);
        }
        for (let i = 0; i < MINERALS; i++) {
            const c = p[`m${i}`];
            u.minerals[i].value.set(c[0], c[1], c[2]);
            const d = pB[`m${i}`];
            u.mineralsB[i].value.set(d[0], d[1], d[2]);
        }

        // ── Post ──
        const post = this._post;
        post.flash = this.flash;
        post.kick = this.kick;
        const shafts = 0.3 + this.power * 0.16 + glow * 0.22 + level * 0.06 + fever * 0.1 + flare * 0.3;
        post.shafts = hush ? shafts + (0.05 - shafts) * this.hushDepth : shafts;
        post.bloomBoost = this.surge * 0.1 + glow * 0.1 + flare * 0.12;
        // The iris closes as the geode flares, so its colours survive the surge — and a little as
        // play heats, so the lining's colours stay deep while everything in it burns brighter.
        post.exposure = (1 - level * 0.1 - fever * 0.06)
            / (1 + this.surge * 1.15 + glow * 0.4 + this.power * 0.12 + Math.min(this.storm, 1.2) * 0.12);
        // …and the grade saturates the colours and deepens the dark between them.
        post.grade = clamp01(level * 0.55 + fever * 0.6);
        // The heart's rays stand in the dust and turn slowly; a clear floods them.
        post.rays.a = t * 0.047 * motion;
        post.rays.b = t * 0.031 * motion;
        const rays = (0.09 + swellLift * 0.1) * air.rays + this.power * 0.05 + glow * 0.16 + level * 0.03 + fever * 0.05
            + flare * 0.2;
        post.rays.gain = hush ? rays * (1 - 0.9 * this.hushDepth) : rays;
        // The air's own iris and grade.
        post.airExposure = air.exposure;
        post.airGrade.warmth = air.warmth;
        post.airGrade.saturation = air.saturation;
        post.airGrade.depth = air.depth;
        const heart = u.heart.value;
        const heartPeak = Math.max(heart.x, heart.y, heart.z, 1e-4);
        post.heartColor[0] = heart.x / heartPeak;
        post.heartColor[1] = heart.y / heartPeak;
        post.heartColor[2] = heart.z / heartPeak;
        // The prism ring leaves the heart with the fracture.
        const ringAge = t - this.ring.time;
        const ringOn = ringAge >= 0 && ringAge < RING_LIFE;
        post.prism.radius = ringOn ? ringAge * 1.25 + 0.02 : 0;
        post.prism.strength = ringOn
            ? this.ring.strength * Math.exp(-ringAge / RING_FADE) * (1 - smooth(RING_LIFE - 0.45, RING_LIFE, ringAge))
            : 0;
    }

    /** The visit under way at `t` (geode-airs.js), or the moment of one a capture holds. */
    readVisit(t) {
        const visit = this._visit;
        if (this.visitHold) return visitHeld(this.visitHold.kind, this.visitHold.age, visit);
        if (this.visits) return visitAt(t, visit);
        visit.kind = null;
        visit.env = 0;
        return visit;
    }

    /** What the post stack reads each frame (a reused object). */
    getPostState() {
        return this._post;
    }

    getState() {
        return {
            quality: this.quality,
            time: this.time,
            combo: this.combo,
            power: this.power,
            surge: this.surge,
            storm: this.storm,
            breath: this.breath,
            crown: this.crown,
            twist: this.twist,
            level: this.level,
            // (the mineral it is heading for, and where in the cycle it is showing now)
            palette: GEODE_PALETTES[Math.round(this.mineralPhase()) % GEODE_PALETTES.length].name,
            mineral: this.mineralStep + (this.sweepTo - this.mineralStep) * this.sweepProgress()
                + mineralDrift(this.time),
            counts: { ...this.counts },
            // the air it stands in (geode-airs.js) and the visit under way, if any
            air: airName(this.airHold ?? airDrift(this.time)),
            visit: this._visit.kind,
            // how hot play runs (src/themes/shared/gameplay-surge.js) and the act it stages
            heat: { level: this.heat.level, fever: this.heat.fever, stage: this.heat.stage },
            held: this.crystals ? this.crystals.totalHeld(this.time) : 0,
            crystals: this.crystals ? this.crystals.count : 0,
            heroes: this.crystals ? this.crystals.heroes : 0,
            druzy: this.parts.druzy ? this.parts.druzy.count : 0,
            targets: { left: this.targets.left.length, right: this.targets.right.length },
            motes: this.parts.air ? this.parts.air.motes : 0,
            stars: this.parts.air ? this.parts.air.stars : 0,
            shards: this.shards ? this.shards.count : 0,
            layoutLive: this.layoutLive,
            heart: { ...this.heart },
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
        this.textures.forEach((t) => t.dispose());
        this.disposables = [];
        this.textures = [];
        this.parts = {};
        this.crystals = null;
        this.shards = null;
        this.wisps = null;
        this.rowBeams = null;
        this.glitterFall = null;
        this.u = null;
        this._camera = null;
    }
}

export { PARTS as GEODE_PARTS, CAVITY };
