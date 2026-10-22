/**
 * Nebula Flow — the world.
 *
 * Owns the shared uniforms, every scene part, the stage and the choreography. Shared by the theme
 * (nebula-flow-theme.js) and the playground effect (src/playground/effects/nebula-flow.effect.js),
 * so what is iterated there ships.
 *
 * A stellar nursery seen face on: pillars of dust stand either side of the board, their heads set
 * alight by a cluster of young stars just above the frame, and the gas the light boils off them
 * flows out through the glowing cavity. The board feeds it:
 *
 *   lock     a spark leaves the card at the piece's height and curves into a pillar; there a
 *            star is kindled, one point per cell of the piece, in the piece's colour, and it
 *            fires a pair of jets out of the dust. It stays, an ember lighting the dust round it
 *            from within, until a clear sets it free. A hard drop: a quicker spark, a bigger star,
 *            longer jets, a kick.
 *   clear    the cluster breathes out: one front of light per line runs down through the
 *            nursery, flaring every lit edge it crosses; the cleared rows leave the card as
 *            blades of light; and as the front reaches each star the board kindled, the dust
 *            round it boils away and it burns free, firing its jets again. In a chain, or under a
 *            quick hand, a clear keeps the stars instead and they burn brighter clear by clear,
 *            so the pillars fill with the colours played; the chain's end, a great star or a
 *            perfect clear frees them all at once. A cascade's waves each go deeper than the
 *            last; a back-to-back sends twin fronts in the cluster's own light.
 *   combo    each step of a chain winds the gas into a vortex round the board, in the colour of
 *            the piece that made it (one arm per step: the vortex keeps the chain's last four
 *            colours), and the flow and the cluster's light quicken with it. When the chain breaks,
 *            or a perfect clear crowns it, the vortex lets go.
 *   four     the nursery holds its breath (as deep as play is cold), then a great star is born
 *            in the head of the tallest pillar: a flash, a front that crosses the frame, jets that
 *            span it, a hole blown in the dust that heals over the next half minute. A great star
 *            while that hole is open is born in it and opens it wider. A perfect clear that
 *            settles after its quad crowns the great star (never a second one).
 *   T-spin   the whole flow twists round the board and springs back (a little, for one that
 *            clears nothing).
 *   heat     how hot play runs (the shared surge) builds the whole nursery up: see `surge`.
 *   level    the nursery moves one palette along its line of six, and a front in the new
 *            colours leaves the cluster.
 *   time     by itself the palette drifts along the same line, one step every PALETTE_STEP
 *            seconds, there and back; a level adds a step.
 *
 * Nothing is created at event time: events write numbers into preallocated slots and a small
 * queue of timed moments, so seek(t) plus a fixed-step replay reproduces any frame. What is
 * integrated (how far the gas has flowed) is integrated because its speed changes; the clock is
 * never multiplied by a rate that moves.
 */

import * as THREE from 'three/webgpu';
import {
    BIRTH_CELL,
    BIRTH_FADE,
    BIRTH_LIFE,
    BIRTH_ROWS,
    BIRTH_SLOTS,
    CONSTELLATION_HOLD,
    CONSTELLATION_MERGE,
    DEG,
    FLIGHT,
    FLIGHT_DROP,
    FLOW_REST,
    FRONT_LIFE,
    FRONT_ROWS,
    LANTERN_ROWS,
    FRONT_SLOTS,
    FRONT_SPEED,
    GREAT_FRONT_SPEED,
    GREAT_HEAL,
    HUSH_HOLD,
    KIND_AMBIENT,
    KIND_DROP,
    KIND_GREAT,
    KIND_LOCK,
    PALETTE_HOME,
    SHAPES,
    SHAPE_KEYS,
    VORTEX_ARMS,
    approach,
    birthDone,
    birthLight,
    cellsFromMatrix,
    clamp01,
    clusterFor,
    dustDistance,
    flowForCombo,
    frontLight,
    holeRadius,
    lerp,
    mulberry32,
    nurseryToScreen,
    packPillars,
    paletteAt,
    paletteName,
    palettePlace,
    pieceColor,
    pillarAxisAt,
    pillarLayout,
    pillarWidthAt,
    screenToNursery,
    smooth,
    vortexForCombo,
} from './nebula-flow-core.js';
import {
    createNebulaUniforms, createNoiseTexture, createReliefTexture, writePalette,
} from './nebula-flow-tsl.js';
import { tierFor } from './nebula-flow-quality.js';
import { createNebula } from './nebula-flow-nebula.js';
import { createBirths, createFieldStars } from './nebula-flow-stars.js';
import { createBlades, createFlights, createJets } from './nebula-flow-fx.js';
import {
    BOARD_GRID, boardFor, boardPoint, cardUnion, fallbackLayout,
} from './nebula-flow-composition.js';
import { NEBULA_FLOW_TETROMINOS } from './nebula-flow-tetrominos.js';
import { cameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';

/** The rest camera (the nursery is drawn in screen space; the camera only frames the sprites' pass). */
export const REST_RIG = Object.freeze({
    minFov: 30,
    maxFov: 78,
    near: 0.05,
    far: 100,
});

/** Vertical field of view (degrees) for an aspect ratio. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((72 * DEG) / 2) / a)) / DEG;
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, v));
}

const PARTS = ['nebula', 'stars', 'births', 'jets', 'flights', 'blades'];

/** The piece colours, for ambient stars and fallbacks. */
const PIECE_RGB = Object.freeze(SHAPE_KEYS.map((key) => pieceColor(NEBULA_FLOW_TETROMINOS.colors[key])));

/** How fast the T-spin twist springs back. */
const TWIST_STIFFNESS = 14;
const TWIST_DAMPING = 3.4;
/** Nursery units a star's place keeps inside the frame's edge (about 5 px of an upright phone). */
const FRAME_MARGIN = 0.012;
/** The fastest the palette walks along its line (places a second): a jump of levels walks, never strobes. */
const PALETTE_WALK = 0.8;
/**
 * How hot play must run (the surge's level) for a clear outside a chain to keep the stars it
 * would free: a quick, steady hand (casual play sits near 0.1–0.2 and frees them as it always has).
 */
const KEEP_HEAT = 0.35;
/** A great star's hole that still shows this wide (nursery units) is fed by the next great star, not closed. */
const HOLE_FEED = 0.012;
/** The widest a great star's hole grows, fed quad after quad (nursery units). */
const HOLE_MAX = 0.42;
/** A great star this young is crowned by a perfect clear that settles after its quad. */
const CROWN_WINDOW = 2.5;
/** The most the vortex may turn (radians at the board): a chain's steps plus a cascade's waves. */
const VORTEX_MAX = 7.5;

/**
 * How hot play runs, from the shared surge's level: 0 through casual play (a level under ~0.12
 * changes nothing, so the nursery at rest and under an easy hand is what it always was), 1 at
 * full heat.
 */
const warmth = (level) => Math.max(0, level - 0.12) / 0.88;

function emptyBirth() {
    return {
        power: 0,
        born: -1e5,
        x: 0,
        y: -10,
        rgb: [1, 1, 1],
        kind: KIND_LOCK,
        angle: 0,
        released: -1,
        size: 1,
        seed: 0,
        cells: [0, 0, 0, 0, 0, 0, 0, 0],
        from: [0, 0],
        flight: 0,
        bow: 0,
        /** Where in its pillar it was kindled ({ pillar, hh, lateral }), so a new stage keeps it in the dust. */
        anchor: null,
    };
}

export class NebulaFlowWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {THREE.WebGPURenderer} [params.renderer]
     * @param {boolean} [params.capture=false]  deterministic captures: no easing shortcuts
     * @param {number} [params.seed]
     */
    constructor({
        scene, quality = 'High', renderer = null, capture = false, seed = 0x4e46, debug = '',
    } = {}) {
        this.debug = debug;
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.renderer = renderer;
        this.capture = capture;
        this.seed = seed;
        this.root = new THREE.Group();
        this.root.name = 'NebulaFlow';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        this.pillars = pillarLayout(this.aspect, 0.39);
        /** What the stage was last laid out for (aspect, card, stats bar). */
        this.stageKey = '';
        this.cluster = clusterFor(this.aspect);
        /** The board's heart in nursery space (the vortex's centre). */
        this.heart = { x: 0, y: 0 };
        this.vortexRadius = 0.95;
        this.pointer = { x: 0, y: 0 };
        this._breath = { x: 0, y: 0, z: 0 };
        this._camera = null;
        this._rest = new THREE.PerspectiveCamera(50, 16 / 9, REST_RIG.near, REST_RIG.far);
        this._point = { x: 0.5, y: 0.5 };
        this._n = [0, 0];
        this._m = [0, 0];
        this._palette = paletteAt(0);
        this._hole = [0, 0];
        this._crown = [1, 1, 1];
        /** The great star last born (a perfect clear that settles after its quad crowns it). */
        this.lastGreat = null;
        this._post = {
            flash: 0,
            flashTint: [1, 1, 1],
            kick: 0,
            bloomBoost: 0,
            exposure: 1,
            /** The cluster on screen (fractions, y down): where the post's shafts come from. */
            sun: { x: 0.53, y: -0.38 },
            rays: 0.35,
        };
        this.births = Array.from({ length: BIRTH_SLOTS }, emptyBirth);
        this.fronts = Array.from({ length: FRONT_SLOTS }, () => ({
            born: -1e5, x: 0, y: 0, speed: FRONT_SPEED, width: 0.06, rgb: [1, 1, 1], strength: 0, life: FRONT_LIFE,
        }));
        /**
         * Every event's light ACCUMULATES (src/themes/shared/swell.js): a new hit adds to what is
         * still lit and never restarts it, so a single after a great star only lifts its flash,
         * and a chain's steps hold the vortex's glow instead of pulsing it.
         *   flash, kick   the post's frame-wide flash and its fringe and camera nudge
         *   bloom         the bloom's swell on a clear, a step and a great star
         *   breath        the cluster breathing out on a clear: its light, the gas's speed, the shafts
         *   kindle        the stars a chain keeps in the dust, brightening clear by clear
         *   glow          the vortex's glow, one hit per step of the chain
         *   wind          a cascade's waves winding the gas round the board, wave on wave
         *   twin          back-to-back: the cluster's twin fronts and the shafts they pour
         */
        this.swell = {
            flash: new Swell({ release: 0.3, ceiling: 1, knee: 0.6 }),
            kick: new Swell({ release: 0.25, ceiling: 1.2, knee: 0.8 }),
            bloom: new Swell({ release: 1.4, ceiling: 0.6, knee: 0.4 }),
            breath: new Swell({ release: 2.2, ceiling: 1.6, knee: 1 }),
            kindle: new Swell({
                attack: 0.2, release: 2.6, ceiling: 1.4, knee: 0.9,
            }),
            glow: new Swell({
                attack: 0.12, release: 2.4, ceiling: 0.6, knee: 0.4,
            }),
            wind: new Swell({
                attack: 0.25, release: 1.8, ceiling: 2.4, knee: 1.4,
            }),
            twin: new Swell({
                attack: 0.1, release: 3, ceiling: 1.6, knee: 1,
            }),
        };
        /**
         * How hot play runs (src/themes/shared/gameplay-surge.js), sampled once a frame: the
         * nursery leans in the longer the hands stay quick. Warm: the stars the board kindles are
         * kept in the dust, glowing brighter clear by clear, and the pillars' rims begin to burn.
         * Hot: the rims burn, the gas boils off faster, the shafts pour down. Fever: the chain's
         * vortex wears every colour played and spreads over the cavity while the cluster's light
         * holds its place (arms of colour over a deep cavity), the kept stars blaze in their
         * colours, until a great star, a perfect clear or the chain's end sets them all free.
         */
        this.surge = new GameplaySurge();
        this.heat = this.surge.sample(-1e5);
        /** The vortex's arms: the colours of the chain's last steps, each easing to where it is aimed. */
        this.arms = Array.from({ length: VORTEX_ARMS }, () => [1, 1, 1]);
        this.armAims = Array.from({ length: VORTEX_ARMS }, () => [1, 1, 1]);
        this.resetState(0);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.combo = 0;
        this.level = 1;
        /**
         * The level's place on the palettes' line (levelBase + level − 1), eased when a level
         * changes. A new run keeps the place it reached: levelBase carries it.
         */
        this.levelBase = 0;
        this.levelPlace = 0;
        /** The swells as of the last frame (the post state and the tests read these). */
        this.flash = 0;
        this.flashTint = [1, 1, 1];
        this.kick = 0;
        this.shine = 1;
        Object.values(this.swell).forEach((s) => s.reset());
        this.surge.reset();
        this.heat = this.surge.sample(-1e5);
        /** What the kept stars burn at, over what they burn at alone (1 at rest). */
        this.emberGain = 1;
        this.vortex = 0;
        this.vortexGlow = 0;
        /** The colour of the chain's newest step (its arm is aimed at it). */
        this.vortexTint = [1, 1, 1];
        this.armCursor = 0;
        this.armTurn = 0;
        this.arms.forEach((a) => a.fill(1));
        this.armAims.forEach((a) => a.fill(1));
        /** A perfect clear lets the chain's whirl go into its light, until the chain steps on. */
        this.unwound = false;
        this.twist = 0;
        this.twistVelocity = 0;
        this.hushStart = -100;
        /** How deep the hush runs: as deep as play is cold (a quad mid-fever only inhales). */
        this.hushDepth = 1;
        /**
         * The great star's hole: it opens from `from` (what was open when it was last fed) to
         * `radius`, then heals. A second great star while it is open feeds it.
         */
        this.hole = {
            x: 0, y: -10, radius: 0, from: 0, born: -1e5, anchor: null,
        };
        this.lastGreat = null;
        this.siteAnchor = null;
        this.lastRgb = [...PIECE_RGB[2]];
        this.birthCursor = 0;
        this.frontCursor = 0;
        this.sideCounter = [0, 0];
        this.queue = [];
        this.counts = {
            locks: 0, clears: 0, quads: 0, releases: 0,
        };
        const motion = this.reducedMotion ? 0.5 : 1;
        this.flow = time * FLOW_REST * motion;
        this.births.forEach((b) => Object.assign(b, emptyBirth()));
        this.fronts.forEach((f) => {
            f.born = -1e5;
            f.strength = 0;
        });
        this.parts.blades?.reset();
        this.placeAmbient();
    }

    build() {
        const { tier } = this;
        const noise = createNoiseTexture();
        const relief = createReliefTexture();
        this.textures.push(noise, relief);
        const u = createNebulaUniforms();
        this.u = u;
        this.addPart('nebula', createNebula(u, noise, relief, {
            lightTaps: tier.lightTaps, detail: tier.detail, veils: tier.veils, stars: tier.starLayers, debug: this.debug,
        }));
        this.addPart('stars', createFieldStars(u, { count: tier.stars, seed: this.seed + 11 }));
        this.addPart('births', createBirths(u));
        this.addPart('jets', createJets(u));
        this.addPart('flights', createFlights(u));
        this.addPart('blades', createBlades(u));
        this.compose();
        this.resetState(this.time);
        this.applyPalette(1);
        this.writeBirths();
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
        if (this.u && bufferWidth > 0 && bufferHeight > 0) {
            this.u.viewport.value.set(bufferWidth, bufferHeight);
            this.u.texel.value = (2 / bufferHeight) * this.u.view.value.z;
        }
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) {
            this.aspect = aspect;
            // the solo card's fallback for the new aspect first: the stage stands round it
            if (!this.layoutLive) this.layout = fallbackLayout(this.aspect * 1000, 1000);
            this.compose();
        }
        if (!this.layoutLive) this.layout = fallbackLayout(this.aspect * 1000, 1000);
    }

    /**
     * The live board / card / HUD rects (screen fractions), or null when no board is on screen:
     * events then aim at where the solo board would be.
     */
    setLayout(rects, aspect) {
        if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
        this.layoutLive = Boolean(rects);
        this.layout = rects || fallbackLayout(this.aspect * 1000, 1000);
        // the stage stands round the live card when there is one (a change of mode moves it
        // once, as the card itself appears); else round where the solo card would be
        this.compose();
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Jump the clock (captures): drops every event in flight. */
    seek(time) {
        this.resetState(Math.max(0, time));
        this.applyPalette(1);
    }

    /** A new run: back to rest (the gas keeps flowing, the palette keeps its place on the clock). */
    resetSession() {
        const { time, flow, levelPlace } = this;
        const held = this.births.map((b) => ({
            ...b, cells: [...b.cells], rgb: [...b.rgb], from: [...b.from],
        }));
        this.resetState(time);
        // the palette stays where the last run left it (level 1 of the new run is that place)
        Object.assign(this, { flow, levelPlace, levelBase: levelPlace });
        // the stars already kindled stay where they are; the next clear frees them
        for (let i = 0; i < this.births.length; i += 1) Object.assign(this.births[i], held[i]);
        // and the young stars come back to the slots whose borrowed stars are done
        this.placeAmbient();
    }

    /**
     * Frame a part of nursery space (the theme icon): `y` and `x` its centre, `halfHeight` half
     * its height. zoomTo() with no arguments returns to the screen.
     */
    zoomTo(x = 0, y = 0, halfHeight = 1) {
        if (!this.u) return;
        this.u.view.value.set(x, y, halfHeight);
        this.placeSun();
        this.u.texel.value = (2 / Math.max(1, this.u.viewport.value.y)) * halfHeight;
        this.u.design.value = (2 / 1080) * halfHeight;
    }

    /** Kept so the theme and the playground bind every world alike. */
    bindCamera(camera) {
        this._camera = camera;
    }

    /** The rest camera for the current aspect. */
    restCamera() {
        const cam = this._rest;
        cam.fov = fovForAspect(this.aspect);
        cam.aspect = this.aspect;
        cam.near = REST_RIG.near;
        cam.far = REST_RIG.far;
        cam.updateProjectionMatrix();
        cam.position.set(0, 0, 0);
        cam.quaternion.identity();
        cam.updateMatrixWorld();
        return cam;
    }

    // ── The stage ───────────────────────────────────────────────────────────────

    /** Lay the stage out for the aspect: the pillars beside the card, the cluster above. */
    compose() {
        const fb = fallbackLayout(this.aspect * 1000, 1000);
        const live = this.layoutLive ? cardUnion(this.layout) : null;
        const card = live || fb.cards[0];
        const hud = live ? this.layout.hud : fb.hud;
        // the card's half-width about the frame's centre (a card off centre counts its far edge)
        const cardHalf = Math.max(Math.abs(card.x0 * 2 - 1), Math.abs(card.x1 * 2 - 1)) * this.aspect;
        const cardTop = 1 - card.y0 * 2;
        const hudRight = hud ? (hud.x1 * 2 - 1) * this.aspect : null;
        const key = `${this.aspect.toFixed(3)}|${cardHalf.toFixed(3)}|${cardTop.toFixed(3)}|${hudRight?.toFixed(3)}`;
        if (key === this.stageKey && this.u) {
            this.placeHeart();
            return;
        }
        this.stageKey = key;
        this.pillars = pillarLayout(this.aspect, cardHalf, cardTop, hudRight);
        this.cluster = clusterFor(this.aspect);
        this.vortexRadius = Math.max(0.85, Math.min(1.4, cardHalf * 2.4));
        if (this.u) {
            packPillars(this.pillars, this.u.tables.pillars);
            this.u.cluster.value.set(this.cluster.x, this.cluster.y);
            this.u.aspect.value = this.aspect;
            this.parts.stars?.cover(this.pillars, this.aspect);
        }
        this.reanchor();
        this.placeSun();
        this.placeHeart();
        this.placeAmbient();
    }

    /** Where the post's shafts come from: the cluster, as the frame sees it (the icon zooms). */
    placeSun() {
        const view = this.u ? this.u.view.value : { x: 0, y: 0, z: 1 };
        nurseryToScreen((this.cluster.x - view.x) / view.z, (this.cluster.y - view.y) / view.z, this.aspect, this._post.sun);
    }

    placeHeart() {
        const card = cardUnion(this.layout) || fallbackLayout(this.aspect * 1000, 1000).cards[0];
        const [x, y] = screenToNursery((card.x0 + card.x1) / 2, (card.y0 + card.y1) / 2, this.aspect, this._n);
        this.heart.x = x;
        this.heart.y = y;
    }

    /** True when a nursery point is hidden by the card or the stats bar. */
    hidden(x, y, margin = 0.01) {
        const s = nurseryToScreen(x, y, this.aspect, this._point);
        const inside = (r) => r && s.x > r.x0 - margin && s.x < r.x1 + margin && s.y > r.y0 - margin && s.y < r.y1 + margin;
        if ((this.layout.cards || []).some(inside)) return true;
        return Boolean(inside(this.layout.hud));
    }

    /** True when a nursery point is inside the frame and hidden by neither the card nor the stats bar. */
    inView(x, y, margin = FRAME_MARGIN) {
        return Math.abs(x) < this.aspect - margin && Math.abs(y) < 1 - margin && !this.hidden(x, y);
    }

    /**
     * An anchor's place, brought in off the frame's edge: on an upright phone the pillars hug the
     * edges and only a strip of them shows beside the card, so a place past the edge moves across
     * its pillar into that strip (the anchor's lateral share follows, for a new stage).
     */
    fitAnchor(anchor, out) {
        this.resolveAnchor(anchor, out);
        const edge = this.aspect - FRAME_MARGIN * 1.2;
        if (Math.abs(out[0]) <= edge) return out;
        const p = this.pillars[anchor.pillar];
        const axisX = out[0] - anchor.lateral * pillarWidthAt(p, anchor.hh);
        out[0] = Math.sign(out[0]) * edge;
        anchor.lateral = (out[0] - axisX) / pillarWidthAt(p, anchor.hh);
        return out;
    }

    /**
     * A pillar's place for an anchor: `hh` a share of the axis (foot … head centre), `lateral` a
     * share of the half-width across it, `rise` a share of the head's radius up into its cap.
     */
    resolveAnchor({
        pillar, hh, lateral = 0, rise = 0,
    }, out = [0, 0]) {
        const p = this.pillars[Math.min(pillar, this.pillars.length - 1)];
        pillarAxisAt(p, hh, out);
        out[0] += lateral * pillarWidthAt(p, hh);
        out[1] += rise * p.w1;
        return out;
    }

    /**
     * The first place in view down each of `pillars`' axes at `heights`, then up in its head's cap
     * (all a crowded versus screen leaves showing), or null.
     */
    axisInView(pillars, heights, out) {
        const places = [...heights.map((hh) => ({ hh, rise: 0 })), { hh: 1, rise: 0.35 }, { hh: 1, rise: 0.65 }];
        for (const p of pillars) {
            for (const { hh, rise } of places) {
                const anchor = {
                    pillar: this.pillars.indexOf(p), hh, lateral: 0, rise,
                };
                this.fitAnchor(anchor, out);
                if (dustDistance(this.pillars, out[0], out[1]) < -0.01 && this.inView(out[0], out[1])) return anchor;
            }
        }
        return null;
    }

    /**
     * A place for a star in a pillar on one side (−1 left, +1 right), `h` the share of the
     * pillar's height (0 foot … 1 head), `lateral` −1..1 across its width. Moves along the pillar
     * until the place is both in the dust and in view; `siteAnchor` keeps where it is in its
     * pillar, so a new stage can put it back in the dust.
     */
    siteOn(side, h, lateral, out = [0, 0]) {
        const own = this.pillars.filter((p) => p.side === side);
        const counter = side < 0 ? 0 : 1;
        const order = own.length > 1 && this.sideCounter[counter] % 3 === 2 ? [own[1], own[0]] : own;
        this.sideCounter[counter] += 1;
        for (let attempt = 0; attempt < 12; attempt += 1) {
            const p = order[attempt % order.length];
            const share = clamp01(h + (attempt >> 1) * (attempt % 2 ? -0.09 : 0.09));
            // the visible part of a pillar starts where it leaves the ridge
            const anchor = { pillar: this.pillars.indexOf(p), hh: lerp(0.42, 0.96, share), lateral: lateral * 0.5 };
            this.fitAnchor(anchor, out);
            if (dustDistance(this.pillars, out[0], out[1]) < -0.03 && this.inView(out[0], out[1])) {
                this.siteAnchor = anchor;
                return out;
            }
        }
        // nothing in view on that side: any pillar's axis that is (a crowded versus screen), else
        // the head of the tallest pillar there
        const heights = [0.9, 0.8, 0.7, 0.6, 0.5];
        const others = this.pillars.filter((p) => p.side !== side);
        const tall = own.reduce((a, b) => (b.top > a.top ? b : a), own[0]);
        this.siteAnchor = this.axisInView([...own, ...others], heights, out)
            || { pillar: this.pillars.indexOf(tall), hh: 0.92, lateral: 0 };
        return this.resolveAnchor(this.siteAnchor, out);
    }

    /** Put every kindled star (and the great star's hole) back in its pillar after a new stage. */
    reanchor() {
        this.births.forEach((b) => {
            if (!b.anchor || !(b.power > 0) || b.kind === KIND_AMBIENT) return;
            // fitted in from the frame's edge, as a star is kindled (a stage turned upright); a
            // copy, so a stage that widens again gives the star back its own place
            this.fitAnchor({ ...b.anchor }, this._m);
            [b.x, b.y] = this._m;
        });
        if (this.hole.anchor) {
            // the great star's hole goes where its star does
            this.fitAnchor({ ...this.hole.anchor }, this._m);
            [this.hole.x, this.hole.y] = this._m;
        }
        this.writeBirths();
    }

    /** Young stars already in the pillars with no play (their jets breathe). */
    placeAmbient() {
        if (!this.births) return;
        const rand = mulberry32(this.seed ^ 0x9e37);
        const n = Math.min(this.tier.ambient, BIRTH_SLOTS);
        const sides = [-1, 1, -1, 1];
        for (let i = 0; i < n; i += 1) {
            const b = this.births[BIRTH_SLOTS - 1 - i];
            // every slot draws its own numbers, used or not, so a slot that is skipped never moves
            // the young stars after it
            const [start, across, turn, seed] = [rand(), rand(), rand(), rand()];
            // a lock's star that borrowed the slot keeps it until it is done
            if (b.power > 0 && b.kind !== KIND_AMBIENT && !birthDone(b, this.time)) continue;
            const side = sides[i % sides.length];
            const own = this.pillars.filter((p) => p.side === side);
            const p = own[(i >> 1) % own.length];
            const lateral = (across - 0.5) * 0.6;
            // a place that shows, stepping along the pillar from a random height (else where it fell)
            let anchor = null;
            for (let k = 0; k < 8 && !anchor; k += 1) {
                const tryAnchor = { pillar: this.pillars.indexOf(p), hh: lerp(0.55, 0.88, (start + k * 0.37) % 1), lateral };
                this.fitAnchor(tryAnchor, this._m);
                if (dustDistance(this.pillars, this._m[0], this._m[1]) < -0.02 && this.inView(this._m[0], this._m[1])) anchor = tryAnchor;
            }
            if (!anchor) {
                anchor = { pillar: this.pillars.indexOf(p), hh: lerp(0.55, 0.88, start), lateral };
                this.fitAnchor(anchor, this._m);
            }
            const shape = SHAPES[SHAPE_KEYS[(i * 3 + 1) % SHAPE_KEYS.length]];
            Object.assign(b, {
                power: 0.45,
                born: -1e4,
                x: this._m[0],
                y: this._m[1],
                rgb: [...PIECE_RGB[(i * 2 + 3) % PIECE_RGB.length]],
                kind: KIND_AMBIENT,
                angle: (turn - 0.5) * 0.9 + (side < 0 ? 0.25 : -0.25),
                released: -1,
                size: 0.8,
                seed,
                cells: cellsFromMatrix(shape),
                from: [0, 0],
                flight: 0,
                bow: 0,
            });
        }
    }

    // ── Gameplay ────────────────────────────────────────────────────────────────

    /**
     * A free birth slot. When every slot still burns (quick play outruns a freed star's fade),
     * the one the picture misses least: the dimmest star, counting the hole it holds open. An
     * ambient star never burns out, so it is only ever taken that way.
     */
    freeBirth(t) {
        let best = -1;
        let least = Infinity;
        for (let k = 0; k < BIRTH_SLOTS; k += 1) {
            const i = (this.birthCursor + k) % BIRTH_SLOTS;
            const b = this.births[i];
            if (b.kind !== KIND_AMBIENT && birthDone(b, t)) {
                this.birthCursor = (i + 1) % BIRTH_SLOTS;
                return b;
            }
            const age = t - b.born;
            // a spark still in flight is never taken from under itself; a young star of the
            // pillars' own goes after the fading ones (its slot comes back to it, writeBirths)
            const seen = age < 0 ? 1e3 : b.power * this.gainOf(b, age) * birthLight(age, b.released, b.kind)
                + (b.released >= 0 ? holeRadius(age - b.released, b.size) * 12 : 0)
                + (b.kind === KIND_AMBIENT ? 0.5 : 0);
            if (seen < least) {
                least = seen;
                best = i;
            }
        }
        this.birthCursor = (best + 1) % BIRTH_SLOTS;
        return this.births[best];
    }

    /**
     * What a star burns at, over what it burns at alone, `age` seconds after it lit: one still
     * held in the dust burns as hot as play runs (emberGain: its sprite and its lantern); a freed
     * one and the pillars' own young stars take part of it; a great star and a spark in flight
     * none. A new star takes it as its piece's shape draws together into it (the shape itself
     * lights as it always does).
     */
    gainOf(b, age) {
        if (this.emberGain === 1 || age < 0 || b.kind === KIND_GREAT) return 1;
        let share = smooth(CONSTELLATION_HOLD, CONSTELLATION_MERGE, age);
        if (b.kind === KIND_AMBIENT) share = 0.4;
        else if (b.released >= 0 && age >= b.released) share *= 0.5;
        return 1 + (this.emberGain - 1) * share;
    }

    /** A board point → nursery space, and the card's edge on a side at that height. */
    boardSite(player, u, row) {
        const board = boardFor(this.layout, player) || fallbackLayout(this.aspect * 1000, 1000).boards[0];
        const pt = boardPoint(board, u, row, this._point);
        const [x, y] = screenToNursery(pt.x, pt.y, this.aspect, this._n);
        const card = (this.layout.cards || []).find((c) => pt.x >= c.x0 && pt.x <= c.x1 && pt.y >= c.y0 && pt.y <= c.y1)
            || cardUnion(this.layout) || board;
        const left = (card.x0 * 2 - 1) * this.aspect;
        const right = (card.x1 * 2 - 1) * this.aspect;
        return {
            x, y, left, right,
        };
    }

    onLock({
        u = 0.5, rows, hardDrop = false, color, cells, player = 0,
    } = {}) {
        const t = this.time;
        const list = Array.isArray(rows) && rows.length ? rows : [BOARD_GRID.rows - 1];
        const mid = list.reduce((a, b) => a + b, 0) / list.length;
        const at = this.boardSite(player, u, mid);
        const side = u < 0.5 ? -1 : 1;
        const rgb = pieceColor(color, 0x9b7bff);
        this.lastRgb = rgb;
        // upper rows kindle higher in the pillar
        const h = smooth(BOARD_GRID.rows - 1, 0, mid) * 0.85 + 0.08;
        const rand = mulberry32((this.seed + this.counts.locks * 7919) >>> 0);
        const site = this.siteOn(side, h, (rand() - 0.5) * 1.2, this._m);
        const b = this.freeBirth(t);
        const flight = hardDrop ? FLIGHT_DROP : FLIGHT;
        const fromX = side < 0 ? at.left : at.right;
        Object.assign(b, {
            power: hardDrop ? 1.25 : 1,
            born: t + flight,
            x: site[0],
            y: site[1],
            rgb: [...rgb],
            kind: hardDrop ? KIND_DROP : KIND_LOCK,
            angle: (rand() - 0.5) * 1.1 + side * 0.18,
            released: -1,
            size: hardDrop ? 1.25 : 1,
            seed: rand(),
            cells: Array.isArray(cells) && cells.length >= 8 ? cells.slice(0, 8) : cellsFromMatrix(SHAPES.T),
            from: [fromX, at.y],
            flight,
            bow: (rand() < 0.5 ? -1 : 1) * (0.18 + rand() * 0.14),
            anchor: this.siteAnchor ? { ...this.siteAnchor } : null,
        });
        // a ripple runs out through the dust as the star lights
        this.addFront(b.born, site[0], site[1], {
            speed: hardDrop ? 0.42 : 0.3, width: 0.022, rgb, strength: hardDrop ? 0.6 : 0.38, life: 1.3,
        });
        // the kick lands with the star (a swell takes a hit a little ahead)
        if (hardDrop) this.swell.kick.hit(0.8, b.born);
        this.surge.lock({ hardDrop }, t);
        this.counts.locks += 1;
    }

    /**
     * A clear: the cluster breathes out. What it builds on:
     *   cascade  each wave past the first goes deeper than the last: quicker, wider, brighter
     *            fronts, brighter blades, and the gas winds a little further round the board;
     *   b2b      the cluster answers a back-to-back with twin fronts in its own hot light, and
     *            its shafts pour down (a second back-to-back answers bigger than the first);
     *   stars    a clear in casual play frees every star the board kindled, as it always has. A
     *            clear in a chain, or under a quick hand, KEEPS them and brightens them, so the
     *            pillars fill with the colours played; they go free together on the payoff — a
     *            great star, a perfect clear, or the chain's end (onCombo(0)).
     */
    onClear({
        rows, lines = 1, tspin = false, perfect = false, b2b = false, cascade = 1, combo = 1, player = 0, screen = null,
    } = {}) {
        const t = this.time;
        const n = Math.max(1, Math.min(4, lines | 0));
        const grand = n >= 4 || perfect;
        // waves past the first (a cascade), each deeper than the last
        const deeper = Math.max(0, Math.min(9, (Math.floor(cascade) || 1) - 1));
        const depth = 1 + Math.min(1.35, deeper * 0.22);
        const speed = FRONT_SPEED * (1 + Math.min(0.6, deeper * 0.12));
        const { front } = this._palette;
        if (screen && Number.isFinite(screen.x) && Number.isFinite(screen.y)) {
            // a click with no board (meditation): one blade at the height it was made
            const [, y] = screenToNursery(screen.x, screen.y, this.aspect, this._n);
            const card = cardUnion(this.layout) || fallbackLayout(this.aspect * 1000, 1000).cards[0];
            const [left, right] = [(card.x0 * 2 - 1) * this.aspect, (card.x1 * 2 - 1) * this.aspect];
            this.parts.blades?.fire(y, t, left, right, front, depth);
        } else {
            const list = Array.isArray(rows) && rows.length ? rows.slice(0, 4) : [BOARD_GRID.rows - 1];
            list.forEach((row, i) => {
                const at = this.boardSite(player, 0.5, row);
                this.parts.blades?.fire(at.y, t + i * 0.05, at.left, at.right, front, depth);
            });
        }
        // the cluster's own light, warmed a little by the rims it is about to set burning
        const glow = this._palette.clusterGlow;
        const shell = [0, 1, 2].map((c) => glow[c] * 0.7 + front[c] * 0.3);
        for (let i = 0; i < n; i += 1) {
            this.addFront(t + i * 0.16, this.cluster.x, this.cluster.y, {
                speed,
                width: 0.05 * (1 + Math.min(1.2, deeper * 0.3)),
                rgb: shell,
                strength: (0.7 + n * 0.08) * depth,
                life: FRONT_LIFE,
            });
        }
        if (b2b) {
            // back-to-back: twin fronts in the cluster's own hot light, close behind the clear's,
            // and the shafts pour (each back-to-back adds to the last)
            const twin = 1 + this.swell.twin.valueAt(t) * 0.5;
            const hot = [0, 1, 2].map((c) => glow[c] * 0.55 + 0.45);
            this.addFront(t + 0.12, this.cluster.x, this.cluster.y, {
                speed: speed * 1.25, width: 0.035, rgb: hot, strength: 0.95 * twin, life: FRONT_LIFE,
            });
            this.addFront(t + 0.26, this.cluster.x, this.cluster.y, {
                speed: speed * 1.25, width: 0.025, rgb: hot, strength: 0.7 * twin, life: FRONT_LIFE,
            });
            this.swell.twin.hit(1, t);
        }
        // Casual play frees the stars as it always has; a chain or a quick hand keeps them,
        // brighter clear by clear, for the payoff (a great star frees them as its quad clears).
        const kept = !grand && (combo >= 2 || this.heat.level >= KEEP_HEAT);
        if (kept) this.swell.kindle.hit(0.3 + 0.12 * n + 0.15 * deeper, t);
        else this.releaseAll(t, speed);
        this.swell.breath.hit(0.22 * n * depth, t);
        // four lines hold their flash for the great star
        if (!grand) this.strike(0.12 + n * 0.05 + deeper * 0.03, front, t);
        this.swell.bloom.hit(0.25 * n + 0.1 * deeper, t);
        if (grand) {
            // The nursery holds its breath: as deep as play is cold (a quad mid-fever only
            // inhales), and never twice over one great star.
            if (t - this.hushStart > HUSH_HOLD + 0.1) {
                this.hushStart = t;
                this.hushDepth = 1 - 0.85 * this.heat.level;
            }
            this.schedule(t + HUSH_HOLD, 'great', perfect ? 1.3 : 1);
            // a perfect clear lets the chain's whirl go into the great star's light
            if (perfect) this.unwound = true;
        }
        // each wave of a cascade winds the gas a little further round the board
        if (deeper > 0) this.swell.wind.hit(0.35 * Math.min(4, deeper), t);
        if (tspin) {
            this.twistVelocity += 2.4;
            this.swell.kick.hit(0.5, t);
        }
        // each wave past the first is worth one wave to the surge
        this.surge.clear({
            lines: n, cascade: deeper > 0 ? 2 : 1, combo, tspin, perfect, b2b,
        }, t);
        this.counts.clears += 1;
    }

    /**
     * A perfect clear that settled after its clear (physics sends it ~360 ms after the last wave,
     * in a frame of its own): the crown on the great star its quad kindled — never a second
     * clear, a second hush or a second great star. The chain's whirl lets go into its light.
     */
    onCrown() {
        const t = this.time;
        this.unwound = true;
        this.surge.crown(t);
        // still in the hush: the great star is born a perfect clear's
        const queued = this.queue.find((e) => e.kind === 'great');
        if (queued) {
            queued.data = Math.max(queued.data || 1, 1.3);
            return;
        }
        const great = this.lastGreat;
        if (!great || great.kind !== KIND_GREAT || !(t - great.born >= 0) || t - great.born > CROWN_WINDOW) {
            // a perfect clear with no great star burning: one is born now, with no hush
            this.greatStar(t, 1.3);
            return;
        }
        // it burns as a perfect clear's, a crown of light runs out from it, its hole opens wider
        great.power = Math.max(great.power, 1.6 * 1.3);
        const glow = this._palette.clusterGlow;
        const crown = this._crown;
        const { front } = this._palette;
        for (let c = 0; c < 3; c += 1) crown[c] = glow[c] * 0.5 + front[c] * 0.5;
        this.addFront(t, great.x, great.y, {
            speed: GREAT_FRONT_SPEED * 1.15, width: 0.09, rgb: crown, strength: 0.7, life: FRONT_LIFE * 1.3,
        });
        const [open, healed] = this.holeAt(t);
        const shown = open * (1 - healed);
        Object.assign(this.hole, {
            from: shown, radius: Math.min(HOLE_MAX, Math.max(shown, this.hole.radius) + 0.06), born: t,
        });
        this.releaseAll(t);
        this.strike(0.4, crown, t);
        this.swell.kick.hit(0.6, t);
        this.swell.breath.hit(0.3, t);
        this.swell.bloom.hit(0.3, t);
        this.swell.twin.hit(0.8, t);
    }

    /** A T-spin that cleared nothing: the flow turns a little round the board and springs back. */
    onSpin() {
        this.twistVelocity += 1.1;
        this.swell.kick.hit(0.25, this.time);
        this.surge.spin(this.time);
    }

    /**
     * Free every star still held in the dust as the front from the cluster (running at `speed`)
     * reaches it.
     */
    releaseAll(t, speed = FRONT_SPEED) {
        for (let i = 0; i < BIRTH_SLOTS; i += 1) {
            const b = this.births[i];
            if (!(b.power > 0) || b.kind === KIND_AMBIENT || b.released >= 0 || b.born > t + 0.05) continue;
            const reach = Math.hypot(b.x - this.cluster.x, b.y - this.cluster.y) / speed;
            // a star that has burned out (or will have, by the time the front reaches it) stays out
            if (t + reach - b.born > BIRTH_LIFE + BIRTH_FADE) continue;
            b.released = t + reach - b.born;
            this.counts.releases += 1;
        }
    }

    /** The true combo (0 = broken). */
    onCombo(n) {
        const c = Math.max(0, Math.floor(n) || 0);
        const t = this.time;
        if (c >= 2 && c > this.combo) {
            this.unwound = false;
            const rgb = this.lastRgb;
            if (this.vortex < 0.05 && this.swell.glow.rawAt(t) < 0.02) {
                // a new chain: every arm in the colour of the piece that started it (nothing
                // shows yet, so nothing snaps)
                for (let a = 0; a < VORTEX_ARMS; a += 1) {
                    for (let k = 0; k < 3; k += 1) {
                        this.arms[a][k] = rgb[k];
                        this.armAims[a][k] = rgb[k];
                    }
                }
            } else {
                // each step winds a new arm in, in its piece's colour; the oldest arm takes it
                this.armCursor = (this.armCursor + 1) % VORTEX_ARMS;
                for (let k = 0; k < 3; k += 1) this.armAims[this.armCursor][k] = rgb[k];
            }
            for (let k = 0; k < 3; k += 1) this.vortexTint[k] = rgb[k];
            this.swell.glow.hit(0.36, t);
            this.swell.bloom.hit(0.2, t);
        } else if (c === 0 && this.combo >= 2) {
            // the chain's end: every star it kept goes free together as the cluster breathes out
            const glow = this._palette.clusterGlow;
            this.addFront(t, this.cluster.x, this.cluster.y, {
                speed: FRONT_SPEED, width: 0.07, rgb: glow, strength: 0.55, life: FRONT_LIFE,
            });
            this.releaseAll(t);
        }
        this.combo = c;
    }

    /**
     * A new level. `silent` puts the palette straight on it (a rebuilt scene, no front); `base`
     * the place on the palettes' line the sitting's earlier runs reached (resetSession keeps it).
     */
    levelUp(level, { silent = false, base = null } = {}) {
        const next = Math.max(1, Math.floor(level) || 1);
        const changed = next !== this.level;
        this.level = next;
        if (Number.isFinite(base)) this.levelBase = base;
        if (silent) {
            this.levelPlace = this.levelBase + next - 1;
            this.applyPalette(1);
            return;
        }
        if (changed) {
            const ahead = paletteAt(palettePlace(this.levelBase + next - 1, this.time), {});
            this.addFront(this.time, this.cluster.x, this.cluster.y, {
                speed: FRONT_SPEED * 0.7, width: 0.12, rgb: ahead.cavityNear, strength: 0.9, life: FRONT_LIFE * 1.3,
            });
            this.strike(0.15, ahead.clusterGlow, this.time);
            this.surge.levelUp(this.time);
        }
    }

    /**
     * A frame-wide flash at `at`, added to whatever is still lit (a weak one after a strong one
     * only lifts it); its tint is the mix of the lights in it, by how much each still gives.
     */
    strike(amount, rgb, at) {
        const lit = this.swell.flash.valueAt(at);
        const sum = lit + amount;
        if (sum > 1e-6) {
            for (let c = 0; c < 3; c += 1) this.flashTint[c] = (this.flashTint[c] * lit + rgb[c] * amount) / sum;
        }
        this.swell.flash.hit(amount, at);
    }

    // ── Moments ─────────────────────────────────────────────────────────────────

    schedule(time, kind, data) {
        let i = this.queue.length;
        while (i > 0 && this.queue[i - 1].time > time) i -= 1;
        this.queue.splice(i, 0, { time, kind, data });
    }

    drain(t) {
        while (this.queue.length && this.queue[0].time <= t) {
            const e = this.queue.shift();
            this.fire(e.time, e.kind, e.data);
        }
    }

    fire(time, kind, data) {
        if (kind === 'great') this.greatStar(time, data || 1);
    }

    /** The great star's hole at `t`: [radius open before healing, healed 0..1]. */
    holeAt(t, out = this._hole) {
        const age = t - this.hole.born;
        out[0] = lerp(this.hole.from, this.hole.radius, smooth(0, 0.6, age));
        out[1] = smooth(0, GREAT_HEAL, age);
        return out;
    }

    /**
     * Four lines: a great star is born in the head of the tallest pillar. While the last great
     * star's hole is still open, the new one is born in it and feeds it (it opens wider from what
     * shows) rather than shutting it and blowing another elsewhere.
     */
    greatStar(t, power) {
        const [open, healed] = this.holeAt(t);
        const shown = open * (1 - healed);
        const feed = Boolean(this.hole.anchor) && shown > HOLE_FEED;
        const site = [0, 0];
        let anchor = null;
        if (feed) {
            anchor = { ...this.hole.anchor };
            site[0] = this.hole.x;
            site[1] = this.hole.y;
        } else {
            // the head of the tallest pillar that shows (versus screens hide some behind the cards)
            const byTop = [...this.pillars].sort((a, b) => b.top - a.top);
            anchor = this.axisInView(byTop, [0.9, 0.84, 0.78, 0.72, 0.66, 0.6], site)
                || { pillar: this.pillars.indexOf(byTop[0]), hh: 0.9, lateral: 0 };
            this.resolveAnchor(anchor, site);
        }
        const tall = this.pillars[Math.min(anchor.pillar, this.pillars.length - 1)];
        // a great star born into a live hole burns bigger; its front is a little gentler in a fever
        // (the cavity already burns: a full one would only wash it out)
        const grow = feed ? 1.15 : 1;
        const blast = 1.6 * power * grow * (1 - 0.35 * this.heat.fever);
        const b = this.freeBirth(t);
        Object.assign(b, {
            power: 1.6 * power * grow,
            born: t,
            x: site[0],
            y: site[1],
            rgb: [...this._palette.clusterGlow],
            kind: KIND_GREAT,
            angle: tall.side < 0 ? 0.22 : -0.22,
            released: 0.6,
            size: 1,
            seed: 0.5,
            cells: [0, 0, 0, 0, 0, 0, 0, 0],
            from: [site[0], site[1]],
            flight: 0,
            bow: 0,
            anchor: { ...anchor },
        });
        this.lastGreat = b;
        this.addFront(t, site[0], site[1], {
            speed: GREAT_FRONT_SPEED,
            width: 0.1 * grow,
            rgb: this._palette.front,
            strength: blast,
            life: FRONT_LIFE * 1.3,
        });
        const base = 0.17 * (tall.w0 / 0.36) + 0.05;
        Object.assign(this.hole, {
            x: site[0],
            y: site[1],
            from: feed ? shown : 0,
            radius: feed ? Math.min(HOLE_MAX, Math.max(shown, base) + 0.07) : base,
            born: t,
            anchor: { ...anchor },
        });
        this.releaseAll(t);
        this.strike(0.85, this._palette.clusterGlow, t);
        this.swell.kick.hit(1, t);
        this.swell.breath.hit(0.6, t);
        this.swell.bloom.hit(0.5, t);
        this.counts.quads += 1;
    }

    addFront(born, x, y, {
        speed = FRONT_SPEED, width = 0.07, rgb = [1, 1, 1], strength = 1, life = FRONT_LIFE,
    } = {}) {
        // a spent slot first; else the front with the least life left to give (one not yet born
        // keeps its slot: a lock's ripple is claimed as the spark leaves; a newborn one, whose
        // light is still rising, has all of its life left)
        let f = null;
        let least = Infinity;
        for (let k = 0; k < FRONT_SLOTS; k += 1) {
            const slot = this.fronts[(this.frontCursor + k) % FRONT_SLOTS];
            const age = this.time - slot.born;
            if (age > slot.life || !(slot.strength > 0)) {
                f = slot;
                break;
            }
            const left = age < 0 ? 1e3 : slot.strength * (1 - age / slot.life);
            if (left < least) {
                least = left;
                f = slot;
            }
        }
        this.frontCursor += 1;
        Object.assign(f, {
            born, x, y, speed, width, rgb: [...rgb], strength, life,
        });
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        // The staged gameplay is flushed between this and update(): it must carry this frame's time.
        this.time = sim.time;
        this.pointer.x = sim.pointerX || 0;
        this.pointer.y = sim.pointerY || 0;
        const fov = fovForAspect(this.aspect);
        if (camera && (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far)) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        if (camera) {
            camera.position.set(0, 0, 0);
            camera.quaternion.identity();
            camera.updateMatrixWorld();
        }
        this._camera = camera;
    }

    // ── The frame ───────────────────────────────────────────────────────────────

    applyPalette(k, dt = Infinity) {
        const step = (this.levelBase + this.level - 1 - this.levelPlace) * Math.min(1, k);
        const walk = PALETTE_WALK * dt;
        this.levelPlace += Math.max(-walk, Math.min(walk, step));
        paletteAt(palettePlace(this.levelPlace, this.time), this._palette);
        if (this.u) writePalette(this.u, this._palette);
    }

    update(sim, camera = this._camera) {
        const { u } = this;
        if (!u) return;
        const dt = Math.max(0, sim.delta || 0);
        const t = sim.time;
        this.time = t;
        const calm = this.reducedMotion ? 0.5 : 1;

        this.drain(t);
        const { swell } = this;
        // How hot play runs: the surge, once a frame on the world's clock.
        const heat = this.surge.sample(t);
        this.heat = heat;
        const warm = warmth(heat.level);
        const { fever } = heat;
        this.flash = swell.flash.valueAt(t);
        this.kick = swell.kick.valueAt(t);
        const breathOut = swell.breath.valueAt(t);
        const kindle = swell.kindle.valueAt(t);
        const twin = swell.twin.valueAt(t);

        // The chain's vortex winds up a step at a time (a cascade's waves wind it further) and
        // lets go when the chain breaks, or into a perfect clear's light.
        const chain = this.unwound ? 0 : vortexForCombo(this.combo);
        const target = Math.min(VORTEX_MAX, chain + swell.wind.valueAt(t));
        const k = dt === 0 ? 1 : approach(target > this.vortex ? 1.5 : 0.7, dt);
        this.vortex += (target - this.vortex) * k;
        // its glow holds while the chain lives (each step adds to it), burning brighter with the heat
        this.vortexGlow = Math.min(0.32, this.vortex * 0.09) * (1 + warm * 0.3 + fever * 0.7) + swell.glow.valueAt(t);
        // each arm eases to the colour its step was in, and the arms turn with the whirl
        const ease = dt === 0 ? 0 : approach(2.5, dt);
        for (let a = 0; a < VORTEX_ARMS; a += 1) {
            for (let c = 0; c < 3; c += 1) this.arms[a][c] += (this.armAims[a][c] - this.arms[a][c]) * ease;
        }
        this.armTurn = (this.armTurn + dt * calm * this.vortex * 0.05 * (1 + fever)) % (Math.PI * 2);
        // a T-spin's twist springs back
        let left = dt;
        while (left > 1e-6) {
            const h = Math.min(left, 1 / 120);
            const acc = -TWIST_STIFFNESS * this.twist - TWIST_DAMPING * this.twistVelocity;
            this.twistVelocity += acc * h;
            this.twist += this.twistVelocity * h;
            left -= h;
        }
        // the gas boils off faster the hotter play runs; the cluster's light rises with its breath
        // and the chain only (a brighter cluster turns the cavity pale: the heat is spent in colour)
        const boil = 1 + breathOut * 0.5 + warm * 0.35 + fever * 0.35;
        this.flow += dt * FLOW_REST * flowForCombo(this.combo) * boil * calm;
        this.shine = 1 + breathOut * 0.3 + Math.min(0.3, this.vortex * 0.045);
        // the stars a chain keeps in the dust burn brighter clear by clear, and blaze in a fever
        this.emberGain = 1 + kindle * 0.5 + warm * 0.35 + fever * 0.45;
        this.applyPalette(dt === 0 ? 0 : approach(1.1, dt), dt);

        const hush = smooth(this.hushStart, this.hushStart + 0.08, t) * (1 - smooth(this.hushStart + HUSH_HOLD - 0.03, this.hushStart + HUSH_HOLD + 0.04, t));
        u.time.value = t;
        u.flow.value = this.flow % 1000;
        u.shine.value = this.shine;
        // the pillars' rims burn (ionization fronts) and boil hotter with the heat
        u.burn.value = 1 + warm * 0.35 + fever * 0.4 + kindle * 0.08;
        // in a fever the cluster's light holds its place while the whirl winds the gas through it
        u.lightHold.value = fever * 0.6;
        u.hush.value = hush * this.hushDepth;
        // a fever widens the whirl over the whole cavity
        u.vortex.value.set(this.heart.x, this.heart.y, this.vortex * calm, this.vortexRadius * (1 + fever * 0.3));
        for (let a = 0; a < VORTEX_ARMS; a += 1) {
            const [r, g, b] = this.arms[a];
            u.vortexArms[a].value.set(r, g, b);
        }
        u.vortexSpin.value.set(Math.cos(this.armTurn), Math.sin(this.armTurn));
        u.vortexGlow.value = this.vortexGlow;
        u.twist.value = this.twist * calm;
        const [open, heal] = this.holeAt(t);
        u.hole.value.set(this.hole.x, this.hole.y, open, heal);
        // a slow sway and the pointer lean the near layers against the far ones
        const px = this.pointer.x * calm;
        const py = this.pointer.y * calm;
        u.cam.value.set(
            (Math.sin(t * 0.041) * 0.012 + Math.sin(t * 0.017 + 1.3) * 0.008 + px * 0.025) * calm,
            (Math.sin(t * 0.033 + 0.7) * 0.008 - py * 0.018 + this.kick * 0.006) * calm,
        );
        // The shared breath (shared/camera-breath.js) on top, off under reduced motion. Its x/y are
        // fractions of viewport height; the frame is 2·view.z nursery units tall and the nearest
        // layer (the dust, the sprites) moves 1·cam, so ×2·view.z moves it by that fraction and the
        // gas (0.6) and far stars (0.3) slide less behind it.
        const breath = cameraBreath(t, this.reducedMotion ? 0 : 1, this._breath);
        const breathToCam = 2 * u.view.value.z;
        u.cam.value.x += breath.x * breathToCam;
        u.cam.value.y += breath.y * breathToCam;

        this.writeBirths();
        this.writeFronts(t);

        const post = this._post;
        post.flash = this.flash;
        post.flashTint = this.flashTint;
        // the fringe rides on the surge's punch: under rapid locks it holds a floor, never flickers
        post.kick = this.kick + heat.punch * 0.18 * calm;
        // the bloom's swell is a frame-wide brightening: Reduce flashing holds it back (ADR-0021);
        // the heat adds only a little (the gas's own emission carries the build, not a haze)
        post.bloomBoost = swell.bloom.valueAt(t) * flashScale() + this.vortexGlow * 0.1 + warm * 0.03 + fever * 0.05;
        // the iris closes for a flash, and a little with the heat: the gas dims a touch while every
        // light the play sends (fronts, the stars, the vortex's arms, the blades) is lifted by the
        // iris, so the build reads in colour and the deep stays deep
        post.exposure = 1 / (1 + this.flash * 0.35) - warm * 0.06 - fever * 0.12;
        // the cluster's shafts thicken with its breath, the chain, the heat and a back-to-back
        post.rays = 0.35 + breathOut * 0.35 + Math.min(0.3, this.vortex * 0.04)
            + warm * 0.25 + fever * 0.25 + twin * 0.3;
        u.iris.value = (1 / post.exposure) ** 0.8;
        if (camera) this._camera = camera;
    }

    writeBirths() {
        if (!this.u) return;
        const t = this.time;
        // a young star's slot that a lock borrowed comes back to it once that star is done
        for (let i = 0; i < Math.min(this.tier.ambient, BIRTH_SLOTS); i += 1) {
            const b = this.births[BIRTH_SLOTS - 1 - i];
            if (b.kind !== KIND_AMBIENT && birthDone(b, t)) {
                this.placeAmbient();
                break;
            }
        }
        const rows = this.u.tables.births;
        const lamps = this.u.tables.lanterns;
        let lamp = 0;
        for (let i = 0; i < BIRTH_SLOTS; i += 1) {
            const b = this.births[i];
            const o = i * BIRTH_ROWS;
            // a star that is done is dark to every part: its sprites collapse
            const age = t - b.born;
            const power = b.kind !== KIND_AMBIENT && birthDone(b, t) ? 0 : b.power * this.gainOf(b, age);
            // the nursery's lantern and hole for it, once here rather than per pixel
            if (power > 0 && age > 0) {
                const light = birthLight(age, b.released, b.kind) * power;
                const hole = b.released >= 0 ? holeRadius(age - b.released, b.size) : 0;
                if (light > 1e-3 || hole > 0.004) {
                    lamps[lamp * LANTERN_ROWS].set(b.x, b.y, light, hole);
                    lamps[lamp * LANTERN_ROWS + 1].set(b.rgb[0], b.rgb[1], b.rgb[2], b.size * 0.075);
                    lamp += 1;
                }
            }
            rows[o].set(b.x, b.y, b.born, power);
            rows[o + 1].set(b.rgb[0], b.rgb[1], b.rgb[2], b.kind);
            rows[o + 2].set(b.angle, b.released, b.size, b.seed);
            rows[o + 3].set(b.cells[0], b.cells[1], b.cells[2], b.cells[3]);
            rows[o + 4].set(b.cells[4], b.cells[5], b.cells[6], b.cells[7]);
            rows[o + 5].set(b.from[0], b.from[1], b.flight, b.bow);
        }
        this.u.lanternCount.value = lamp;
    }

    /** Pack the fronts in flight at `t` (closed form), live ones first. */
    writeFronts(t) {
        const rows = this.u.tables.fronts;
        let live = 0;
        for (let i = 0; i < FRONT_SLOTS; i += 1) {
            const f = this.fronts[i];
            const age = t - f.born;
            const light = frontLight(age, f.life) * f.strength;
            if (light > 0.004) {
                const o = live * FRONT_ROWS;
                rows[o].set(f.x, f.y, age * f.speed, f.width * (1 + age * 0.2));
                rows[o + 1].set(f.rgb[0], f.rgb[1], f.rgb[2], light);
                live += 1;
            }
        }
        this.u.frontCount.value = live;
    }

    getPostState() {
        return this._post;
    }

    getState() {
        const t = this.time;
        let held = 0;
        let free = 0;
        this.births.forEach((b) => {
            // lit: ignited and not yet done (the ignition flash's tail never quite reaches zero)
            if (!(b.power > 0) || b.kind === KIND_AMBIENT || t < b.born || birthDone(b, t)) return;
            if (b.released >= 0 && t - b.born >= b.released) free += 1;
            else held += 1;
        });
        return {
            time: t,
            quality: this.quality,
            combo: this.combo,
            level: this.level,
            palette: paletteName(palettePlace(this.levelPlace, t)),
            vortex: this.vortex,
            twist: this.twist,
            /** How hot play runs (the shared surge): its level, fever and act (0 calm … 3 fever). */
            heat: { level: this.heat.level, fever: this.heat.fever, stage: this.heat.stage },
            held,
            free,
            fronts: this.u ? this.u.frontCount.value : 0,
            counts: { ...this.counts },
            aspect: this.aspect,
            pillars: this.pillars.map((p) => p.name),
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.scene?.remove(this.root);
        this.disposables.forEach((part) => {
            part.dispose?.();
            part.geometry?.dispose?.();
            part.material?.dispose?.();
        });
        this.textures.forEach((tex) => tex.dispose());
        this.disposables = [];
        this.textures = [];
        this.parts = {};
        this.u = null;
    }
}

export const NEBULA_FLOW_PARTS = Object.freeze([...PARTS]);
export { BIRTH_CELL, KIND_GREAT, PALETTE_HOME };
