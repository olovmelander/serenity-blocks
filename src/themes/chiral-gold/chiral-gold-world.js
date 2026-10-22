/**
 * Chiral Gold — the world: the hall, its camera and its choreography.
 *
 * Owns the shared uniforms, every part (backdrop, water, the two towers, the great ring, shafts,
 * motes, leaf, sparks, blades, flares, the braid) and the state gameplay drives. Shared with the
 * playground effect (src/playground/effects/chiral-gold.effect.js), so what is iterated there
 * ships.
 *
 * The one idea: the board is an anvil standing between two towers of gold, and everything struck
 * on it becomes gold that the towers take up. The towers are mirror images of each other, and so
 * is everything that happens to them: what turns one way on the left turns the other way on the
 * right.
 *
 *   lock      sparks leave the board at the height the piece landed and corkscrew into the nearer
 *             tower; where they land a pulse runs up and down its ribbons; a ring spreads on the
 *             water from under the piece's column.
 *   hard drop the same, harder, with a splash and a dip of the camera.
 *   clear     each cleared row leaves the board as a blade of light and strikes both towers at
 *             its own height: a star, a spiral of gold leaf torn loose, a pulse; the towers spin
 *             up and hold a glow; a front of light runs out across the water; a pair of comets
 *             cross over the great ring.
 *   combo     the hall takes heat: the towers' cores come up to white, the gold glows from
 *             within, everything turns faster, and the great ring opens band by band into an
 *             armillary sphere. The chain's count is struck in gold beside the board. When the
 *             chain breaks the heat drains from the top down and the count falls as leaf.
 *   four lines / perfect clear
 *             a hush, then the ring ignites from its crown, the water is gilded outward from the
 *             board, and two sets of spiral arms of gold leaf climb around the board through one
 *             another. Then it rains gold.
 *   T-spin    both towers turn once on the spot (half a turn for one that clears nothing).
 *   back-to-back
 *             the great ring's crown lights and a pair of comets runs DOWN from it to both feet
 *             (a clear's comets climb up from them); it stays lit while the back-to-backs come.
 *   perfect clear (late, after the clear's last wave)
 *             the crown on the strike still burning: the towers brim over at the top, the ring's
 *             crown blazes, comets leave it. Never a second hush.
 *   level up  the next alloy is poured up the towers.
 *
 * And it BUILDS (src/themes/shared/gameplay-surge.js): nothing restarts what is still lit. The
 * heat of play fills the towers with molten gold from the water up (calm: nothing; warm: a molten
 * foot; hot: half-full, the ring winding up, the water working; fever: full to the crowns, the
 * light running molten red-gold, the crowns shedding leaf and the ring an open armillary sphere),
 * and when the hands rest the gold runs back down into the water.
 *
 * Nothing is created at event time: events write numbers into ring-buffered uniform slots and
 * preallocated pools, often dated a moment ahead (a tower's pulse is dated for when the sparks
 * reach it). seek(t) plus a fixed-step replay reproduces any frame.
 */

import * as THREE from 'three/webgpu';
import {
    ALLOYS,
    AURUM,
    COMET_FADE,
    COMET_SLOTS,
    HELIX,
    PULSE_FADE,
    PULSE_SLOTS,
    RIPPLE_FADE,
    RIPPLE_SLOTS,
    SPARK_FLIGHT,
    STAGE,
    SURGE_FADE,
    SURGE_SLOTS,
    TAU,
    alloyForLevel,
    approach,
    bandsForCombo,
    clamp01,
    createHallUniforms,
    createNoiseTexture,
    createStudioEquirect,
    heatForCombo,
    lerp,
    linRGB,
    pickSlot,
    smooth,
} from './chiral-gold-tsl.js';
import { tierFor } from './chiral-gold-quality.js';
import { createTower } from './chiral-gold-helix.js';
import { BANDS, createRing, poseRing } from './chiral-gold-ring.js';
import { createWater } from './chiral-gold-water.js';
import { createBackdrop, createMotes, createShafts } from './chiral-gold-atmosphere.js';
import {
    BLADE_TRAVEL,
    bakeTallyAtlas,
    createBlades,
    createBraid,
    createFlares,
    createLeaf,
    createSparks,
    createTally,
} from './chiral-gold-fx.js';
import {
    boardFor,
    boardPoint,
    cardFor,
    cardUnion,
    fallbackLayout,
    towerPlacement,
} from './chiral-gold-composition.js';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, Swell, softCeiling } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';

export const REST_RIG = Object.freeze({ near: STAGE.camera.near, far: STAGE.camera.far });

/** Vertical field of view for a frame shape: the lens widens as the frame narrows. */
export function fovForAspect(aspect) {
    const base = Math.tan((STAGE.camera.fov * Math.PI) / 360);
    const deg = (2 * Math.atan((base * 1.55) / Math.max(0.2, aspect)) * 180) / Math.PI;
    return Math.min(60, Math.max(STAGE.camera.fov, deg));
}

/** Radians a second each tower turns at rest, and the great ring's bands. */
export const TOWER_TURN = 0.105;
export const RING_TURN = 0.042;
/** How wide a tower is (to its wires), for fitting it to its margin. */
const TOWER_SPAN = HELIX.wireRadius * 2 - 0.5;
/** Depth (world z) of the plane the sparks leave the board on. */
const STRIKE_Z = 2.4;
/** Depth (world z) the tally hangs at. */
const TALLY_Z = 2;
/** A tower squeezed into a narrow margin keeps at least this much of its height. */
const TOWER_MIN_HEIGHT = 0.8;
/** The lowest a row of the board lands on a tower (metres above the water). */
const STRIKE_FOOT = 0.9;
/** Angle the great ring leaves the water at on its right side (radians from +X). */
const RING_FOOT = Math.asin(-STAGE.ring.y / STAGE.ring.radius);

const GOLD = Object.freeze([1.0, 0.72, 0.3]);
const IVORY = Object.freeze([1.0, 0.92, 0.76]);

/**
 * A strike's blaze, gilt and braid stay up this long (the braid's last flakes rain out by then):
 * another strike inside it feeds the one burning instead of lighting it again.
 */
const STRIKE_SPAN = 13;
/** The most the ring's blaze may burn when strikes pile up. */
const BLAZE_MAX = 1.35;
/** The held flare a tower may store, and the glow it shows: soft over `FLARE_KNEE`. */
const FLARE_STORE = 1.6;
const FLARE_KNEE = 0.5;
/** The molten fill line's top (tower units: just over the frame at full scale). */
const FILL_TOP = 9.2;
/** Seconds a pour takes to reach past the top of the towers. */
const POUR_SPAN = (HELIX.top + 0.5 - HELIX.bottom) / 5.5;

export class ChiralGoldWorld {
    /**
     * @param {object} options
     * @param {THREE.Scene} options.scene
     * @param {string} [options.quality='High']
     * @param {boolean} [options.capture=false]  deterministic captures: audio is ignored
     */
    constructor({ scene, quality = 'High', capture = false } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture;
        this.root = new THREE.Group();
        this.root.name = 'ChiralGoldWorld';
        this.u = null;
        this.textures = {};
        this.groups = {};
        this.parts = [];
        this.towers = [];
        this.ring = null;
        this.reflection = null;
        this.camera = null;
        this.savedEnvironment = undefined;
        this.reducedMotion = false;

        this.aspect = 16 / 9;
        this.fov = STAGE.camera.fov;
        this.cssWidth = 1600;
        this.cssHeight = 900;
        this.layout = null;
        this.layoutLive = false;
        this.place = {
            helixX: 6.8, scale: 1, scaleY: 1, targetX: 6.8, targetScale: 1, snapped: false,
        };

        this.time = 0;
        this.level = 1;
        this.combo = 0;
        /** The chain's own heat (eased toward heatForCombo); what the hall wears is u.heat. */
        this.heat = 0;
        /** The glow each tower holds (left, right) as shown, and what it has stored (soft-capped). */
        this.flare = [0, 0];
        this.flareStore = [0, 0];
        this.spin = 0;
        this.spinKick = 0;
        this.ringSpin = 0;
        this.ringKick = 0;
        this.open = [0, 0, 0];
        /** The tally beside the board: the count it shows, how present it is, its stamp. */
        this.tallyState = { count: 0, shown: 0, punch: 0 };
        /** The strike burning (its blaze, gilt and braid are dated from here). */
        this.aurumAt = -100;
        this.aurumStrength = 0;
        /** The hush before a strike from cold: when, and how deep (shallower the hotter play runs). */
        this.hushAt = -100;
        this.hushDepth = 0;
        /** T-spins: the towers turn from `from` to `to` (radians), eased from `tspinAt`. */
        this.tspinAt = -100;
        this.pirouette = { from: 0, to: 0 };
        this.pourAt = -100;
        /** A level reached while the last pour still climbs: poured once it is done. */
        this.queuedLevel = 0;
        this.dip = 0;
        this.dolly = 0;
        // Everything an event lights ADDS to what is still lit (src/themes/shared/swell.js): a weak
        // hit after a strong one can only lift it.
        /** The post's flash and impact. */
        this.flash = new Swell({ release: 1 / 4.2, ceiling: 0.5, knee: 0.3 });
        this.kick = new Swell({ release: 0.2, ceiling: 1, knee: 0.7 });
        /** The strike's overdrive, the hall's lift after the hush, the camera's pull, the ignition. */
        this.over = new Swell({ release: AURUM.hold, ceiling: 1.6, knee: 1.25 });
        this.lift = new Swell({ release: 1 / 1.4, ceiling: 0.14, knee: 0.1 });
        this.pull = new Swell({
            attack: 0.06, release: 1 / 1.1, ceiling: 0.8, knee: 0.6,
        });
        this.ignition = new Swell({ release: 1 / 3, ceiling: 0.45, knee: 0.35 });
        this.rayLight = new Swell({ release: 1 / 0.9, ceiling: 0.14, knee: 0.1 });
        /** The great ring's crown (back-to-backs, perfect clears) and the towers brimming over. */
        this.crownGlow = new Swell({
            attack: 0.08, release: 3.2, ceiling: 1.6, knee: 1,
        });
        this.brim = new Swell({
            attack: 0.25, release: 2.2, ceiling: 1, knee: 0.8,
        });
        /** How hot play runs, sampled once a frame (src/themes/shared/gameplay-surge.js). */
        this.surge = new GameplaySurge();
        this.play = this.surge.sample(-100);
        /** The molten gold in the towers: 0 below the water, 1 at their crowns (eased). */
        this.fill = 0;
        /** Leaf the crowns shed in a fever, as a running count. */
        this.shed = 0;
        this.glowBase = [...ALLOYS[0].glow];
        this.counts = {
            locks: 0, clears: 0, strikes: 0, crowns: 0, spins: 0, b2b: 0,
        };
        this._post = {
            heart: { x: 0.5, y: 0.5 }, flash: 0, kick: 0, bloomBoost: 0, exposure: 1, rays: 0, streak: 1,
        };
        this._pt = { x: 0.5, y: 0.5 };
        this._ray = { origin: new THREE.Vector3(), dir: new THREE.Vector3() };
        this._v = new THREE.Vector3();
        this._w = new THREE.Vector3();
        this._ys = [];
        this._heights = [];
        this._ends = [];
    }

    // ── build ───────────────────────────────────────────────────────────────────

    build() {
        const { tier } = this;
        this.textures.noise = createNoiseTexture();
        this.textures.studio = createStudioEquirect(tier.studio);
        const u = createHallUniforms({ noise: this.textures.noise, studio: this.textures.studio });
        this.u = u;

        // The studio the gold reflects. The scene's own environment is put back on dispose.
        this.savedEnvironment = this.scene.environment ?? null;
        this.savedEnvironmentIntensity = this.scene.environmentIntensity ?? 1;
        this.scene.environment = this.textures.studio;

        const add = (name, part, reflected = part.reflected) => {
            if (!this.groups[name]) this.groups[name] = [];
            this.groups[name].push(part.mesh);
            this.parts.push(part);
            if (!reflected) part.mesh.layers.set(1);
            if (!part.mesh.parent) this.root.add(part.mesh);
            return part;
        };

        add('sky', createBackdrop(u));
        const water = add('water', createWater(u, {
            reflectionScale: tier.reflection, reflectionTaps: tier.reflectionTaps, beams: !!tier.shafts,
        }));
        if (water.reflectorTarget) this.root.add(water.reflectorTarget);
        this.reflection = water.reflection;

        this.ring = createRing(u, tier);
        this.root.add(this.ring.group);
        this.groups.ring = [this.ring.group];
        this.ring.parts.forEach((part) => this.parts.push(part));

        this.groups.towers = [];
        [-1, 1].forEach((hand) => {
            const tower = createTower(u, hand, tier);
            this.towers.push(tower);
            this.root.add(tower.group);
            this.groups.towers.push(tower.group);
            tower.parts.forEach((part) => this.parts.push(part));
        });

        if (tier.shafts) add('shafts', createShafts(u));
        add('motes', createMotes(u, tier.motes));
        this.leaf = add('leaf', createLeaf(u, tier.leaf, tier.ambientLeaf));
        this.sparks = add('sparks', createSparks(u, tier.sparks));
        this.blades = add('blades', createBlades(u));
        this.flares = add('flares', createFlares(u));
        this.braid = tier.braid > 0 ? add('braid', createBraid(u, tier.braid)) : null;
        // The tally is drawn with the page's canvas; where there is none it is simply absent.
        const atlas = bakeTallyAtlas();
        this.tally = atlas ? add('tally', createTally(u, atlas)) : null;

        this.scene.add(this.root);
        this.applyAlloy(alloyForLevel(1), true);
        this.applyLayout(true);
        this.pose(0);
        return this;
    }

    /** The mirror renders layer 0 only; everything that is not reflected lives on layer 1. */
    bindCamera(camera) {
        this.camera = camera;
        camera.layers.enable(1);
        if (this.reflection) {
            const mirror = this.reflection.reflector.getVirtualCamera(camera);
            mirror.layers.set(0);
        }
    }

    /** Debug: draw only the named parts (sky, water, towers, ring, shafts, motes, leaf, ...). */
    showOnlyParts(names) {
        const keep = new Set(names);
        Object.keys(this.groups).forEach((name) => {
            this.groups[name].forEach((object) => {
                object.visible = keep.has(name);
            });
        });
    }

    // ── frame shape and layout ──────────────────────────────────────────────────

    /** Buffer size in pixels, the frame's aspect, and its CSS size (for the fallback layout). */
    setViewport(bufferWidth, bufferHeight, aspect, cssWidth = bufferWidth, cssHeight = bufferHeight) {
        if (bufferWidth > 0 && bufferHeight > 0) this.u.viewport.value.set(bufferWidth, bufferHeight);
        if (aspect > 0) this.aspect = aspect;
        if (cssWidth > 0 && cssHeight > 0) {
            this.cssWidth = cssWidth;
            this.cssHeight = cssHeight;
        }
        this.fov = fovForAspect(this.aspect);
        this.u.lens.value = 0.5 / Math.tan((this.fov * Math.PI) / 360);
        if (this.camera) {
            this.camera.fov = this.fov;
            this.camera.aspect = this.aspect;
            this.camera.updateProjectionMatrix();
        }
        this.applyLayout(!this.place.snapped);
    }

    /** The live card/board/HUD rects (screen fractions), or null when no board is on screen. */
    setLayout(rects) {
        this.layoutLive = Boolean(rects);
        this.layout = rects || null;
        this.applyLayout(!this.place.snapped);
    }

    currentLayout() {
        return this.layout || fallbackLayout(this.cssWidth, this.cssHeight);
    }

    /** Half the frame's width in metres at the plane the towers stand in. */
    halfWidth() {
        return STAGE.camera.z * Math.tan((this.fov * Math.PI) / 360) * this.aspect;
    }

    applyLayout(snap = false) {
        const placement = towerPlacement(cardUnion(this.currentLayout()));
        const halfW = this.halfWidth();
        this.place.targetX = placement.ndcX * halfW;
        this.place.targetScale = Math.min(1.04, Math.max(0.3, (placement.widthNdc * halfW) / TOWER_SPAN));
        if (snap) {
            this.place.helixX = this.place.targetX;
            this.place.scale = this.place.targetScale;
            this.place.scaleY = Math.max(TOWER_MIN_HEIGHT, this.place.scale);
            this.place.snapped = true;
        }
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Audio levels, each 0..1 (ignored in captures). */
    setAudio(bass = 0, mid = 0, treble = 0, beat = 0) {
        if (this.capture) return;
        this.u.audio.value.set(clamp01(bass), clamp01(mid), clamp01(treble), clamp01(beat));
    }

    // ── screen ↔ world ──────────────────────────────────────────────────────────

    /** The ray through a screen point (fractions, y down) from the bound camera. */
    rayThrough(sx, sy) {
        const { origin, dir } = this._ray;
        const { camera } = this;
        if (camera) {
            origin.copy(camera.position);
            dir.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(origin).normalize();
        } else {
            const th = Math.tan((this.fov * Math.PI) / 360);
            origin.set(0, STAGE.camera.y, STAGE.camera.z);
            dir.set((sx * 2 - 1) * th * this.aspect, (1 - sy * 2) * th, -1).normalize();
        }
        return this._ray;
    }

    /** Where the ray through a screen point meets the plane z = `z`. */
    worldAtDepth(sx, sy, z, out = this._v) {
        const { origin, dir } = this.rayThrough(sx, sy);
        const t = (z - origin.z) / Math.min(-1e-4, dir.z);
        return out.copy(dir).multiplyScalar(t).add(origin);
    }

    /** Where the ray through a screen point meets the water; null above the horizon. */
    waterAt(sx, sy, out = this._w) {
        const { origin, dir } = this.rayThrough(sx, sy);
        if (dir.y > -0.02) return null;
        const t = -origin.y / dir.y;
        if (!(t > 0) || t > 60) return null;
        return out.copy(dir).multiplyScalar(t).add(origin);
    }

    /**
     * The height on the towers a screen height inside `board` holds. The towers are a gauge of
     * the board: its floor is just above the water, its top row near the top of the frame.
     * (The board's lower rows sit below the waterline on screen, where a tower is only its
     * own reflection; nothing could strike it there.)
     */
    strikeHeight(sy, board) {
        const span = Math.max(1e-3, board.y1 - board.y0);
        const v = clamp01((sy - board.y0) / span);
        const frameTop = STAGE.camera.y + STAGE.camera.z * Math.tan((this.fov * Math.PI) / 360);
        const top = Math.min(frameTop - 0.7, HELIX.top * this.place.scaleY * 0.74);
        return lerp(top, STRIKE_FOOT, v);
    }

    /** Screen point (fractions, y down) of a world point through the bound camera. */
    screenOf(x, y, z, out = this._pt) {
        const v = this._w.set(x, y, z);
        if (this.camera) {
            v.project(this.camera);
            out.x = v.x * 0.5 + 0.5;
            out.y = 0.5 - v.y * 0.5;
        } else {
            const th = Math.tan((this.fov * Math.PI) / 360);
            const d = Math.max(0.1, STAGE.camera.z - z);
            out.x = 0.5 + (0.5 * x) / (d * th * this.aspect);
            out.y = 0.5 - (0.5 * (y - STAGE.camera.y)) / (d * th);
        }
        return out;
    }

    /** Screen x (fraction) of a world x at the towers' plane, for the rest camera. */
    screenXOf(worldX) {
        return 0.5 + (0.5 * worldX) / this.halfWidth();
    }

    // ── slots ───────────────────────────────────────────────────────────────────

    // Every ring of slots is written where the least light is left (pickSlot): an event never
    // cuts off a brighter one still running, however fast they come.

    /** A pulse through the towers from world height `y`. `side`: −1 left, +1 right, 0 both. */
    pulse(y, time, strength, side = 0) {
        const i = pickSlot(this.u.pulseA, 1, 2, PULSE_FADE, this.time);
        this.u.pulseA[i].value.set(y / Math.max(0.2, this.place.scaleY), time, strength, side);
    }

    ripple(x, z, time, strength, rgb = GOLD) {
        const i = pickSlot(this.u.rippleA, 2, 3, RIPPLE_FADE, this.time);
        this.u.rippleA[i].value.set(x, z, time, strength);
        this.u.rippleC[i].value.set(rgb[0], rgb[1], rgb[2]);
    }

    /** One comet on the great ring from angle `from`, `speed` radians a second (signed). */
    comet(time, speed, strength, from) {
        const i = pickSlot(this.u.cometA, 0, 2, COMET_FADE, this.time);
        this.u.cometA[i].value.set(time, speed, strength, from);
    }

    /** `pairs` pairs of comets leave the ring's two feet and cross at its crown. */
    comets(time, strength, pairs = 1) {
        for (let p = 0; p < pairs; p++) {
            const speed = 2.3 + p * 0.9;
            const at = time + p * 0.2;
            this.comet(at, speed, strength, RING_FOOT);
            this.comet(at, -speed, strength, Math.PI - RING_FOOT);
        }
    }

    /** A pair of comets leaves the ring's crown and runs down to both feet: the way a clear's come. */
    crownComets(time, strength) {
        this.comet(time, -2.1, strength, Math.PI / 2);
        this.comet(time, 2.1, strength, Math.PI / 2);
    }

    /** A clear's front across the water, one crest per line; `speed` 1 = the usual pace. */
    surgeFront(time, strength, lines, speed = 1) {
        const i = pickSlot(this.u.surgeA, 0, 1, SURGE_FADE, this.time);
        this.u.surgeA[i].value.set(time, strength, lines, speed);
    }

    /** Store glow in a tower (0 left, 1 right): it adds to what it holds. */
    holdFlare(side, amount) {
        this.flareStore[side] = Math.min(FLARE_STORE, this.flareStore[side] + amount);
        this.showFlare();
    }

    /**
     * The glow the towers show: what they store, under a soft ceiling that rises with the heat of
     * play, so a chain's first clears warm them and only a long one brings them to full glow.
     */
    showFlare() {
        const ceiling = 0.75 + 0.45 * this.play.level;
        for (let i = 0; i < 2; i++) this.flare[i] = softCeiling(this.flareStore[i], FLARE_KNEE, ceiling);
    }

    /** A piece's colour, pulled toward the alloy: the hall is gold whatever lands in it. */
    eventColor(hex) {
        if (!hex) return GOLD;
        const [r, g, b] = linRGB(hex);
        const { glow } = alloyForLevel(this.level);
        return [lerp(r, glow[0], 0.4) * 1.1, lerp(g, glow[1], 0.4) * 1.1, lerp(b, glow[2], 0.4) * 1.1];
    }

    // ── gameplay ────────────────────────────────────────────────────────────────

    /** @param {{ player?: number, rows?: number[], u?: number, hardDrop?: boolean, color?: string|null }} c */
    onLock(c = {}) {
        const t = this.time;
        const layout = this.currentLayout();
        const board = boardFor(layout, c.player ?? 0);
        const card = cardFor(layout, board);
        if (!board || !card) return;
        this.counts.locks += 1;
        const hard = c.hardDrop === true;
        this.surge.lock(c, t);
        const rows = c.rows?.length ? c.rows : [19];
        let rowMid = 0;
        for (let i = 0; i < rows.length; i++) rowMid += rows[i];
        rowMid /= rows.length;
        const column = Number.isFinite(c.u) ? c.u : 0.5;
        const pt = boardPoint(board, column, rowMid, this._pt);
        const near = column < 0.5 ? -1 : 1;
        const rgb = this.eventColor(c.color);
        const { burst } = this.tier;
        const { helixX, scale } = this.place;
        const arrive = t + SPARK_FLIGHT * 0.92;
        const lockX = pt.x;
        const lockY = pt.y;
        const aimY = this.strikeHeight(lockY, board);
        for (let side = -1; side <= 1; side += 2) {
            const main = side === near;
            const o = this.worldAtDepth(side < 0 ? card.x0 : card.x1, lockY, STRIKE_Z);
            let n = 12;
            if (main) n = hard ? 46 : 30;
            else if (hard) n = 18;
            this.sparks.emit({
                x: o.x,
                y: Math.max(0.2, o.y),
                z: o.z,
                n: Math.max(3, Math.round(n * burst)),
                time: t,
                rgb,
                dir: [side, 0.5, -0.12],
                cone: 0.55,
                speed: hard ? [5, 13] : [3.5, 9],
                life: [0.5, 1.0],
                size: 0.04,
                homing: 0.74,
                aimX: side * helixX,
                aimY,
                aimZ: 0.2,
                aimSpread: 0.45,
                hand: side,
                flight: SPARK_FLIGHT,
            });
            const weight = (main ? 1 : 0.42) * (hard ? 1 : 0.62);
            this.pulse(aimY, arrive, weight, side);
            this.flares.fire(side * (helixX - 0.7 * scale), aimY, 0.9 * scale, arrive, weight * 0.5, 0.9, 0.42);
            this.holdFlare(side < 0 ? 0 : 1, weight * 0.08);
        }
        // The water under the board, at the piece's own column.
        const w = this.waterAt(lockX, Math.min(0.985, card.y1)) || this._w.set((lockX - 0.5) * 4, 0, STAGE.boardZ);
        this.ripple(w.x, w.z, t, hard ? 1 : 0.55, rgb);
        if (hard) {
            this.sparks.emit({
                x: w.x,
                y: 0.05,
                z: w.z,
                n: Math.max(3, Math.round(16 * burst)),
                time: t,
                rgb,
                dir: [0, 1, 0],
                cone: 0.5,
                speed: [2, 5.5],
                life: [0.45, 0.95],
                size: 0.024,
            });
            if (!this.reducedMotion) this.dip = Math.min(0.12, this.dip + 0.05);
            this.kick.hit(0.35, t);
        }
    }

    /**
     * @param {{ player?: number, rows?: number[], lines?: number, combo?: number, cascade?: number,
     *   tspin?: boolean, b2b?: boolean, perfect?: boolean, crown?: boolean,
     *   screen?: {x:number,y:number}|null }} c
     */
    onClear(c = {}) {
        const t = this.time;
        // The late perfect clear, alone in its frame: the crown on the clear already shown.
        if (c.crown) {
            this.crown();
            return;
        }
        const layout = this.currentLayout();
        const board = boardFor(layout, c.player ?? 0);
        const card = cardFor(layout, board);
        if (!board || !card) return;
        this.counts.clears += 1;
        const lines = Math.max(1, Math.min(4, Math.round(c.lines || 1)));
        const combo = Math.max(1, Math.round(c.combo || 1));
        // A cascade's waves arrive one by one; each builds on the last (deeper, brighter, faster).
        const deeper = Math.max(0, Math.min(4, Math.round(c.cascade || 1) - 1));
        if (deeper > 0) {
            // One more wave of a clear already counted.
            this.surge.wave(t);
            if (c.tspin) this.surge.tspin(t);
            if (c.b2b) this.surge.b2b(t);
            if (c.perfect) this.surge.crown(t);
        } else {
            this.surge.clear(c, t);
        }
        const { burst } = this.tier;
        const { helixX, scale } = this.place;
        const ys = this._ys;
        const heights = this._heights;
        const ends = this._ends;
        ys.length = 0;
        heights.length = 0;
        ends.length = 0;
        let { x0 } = card;
        let { x1 } = card;
        if (c.screen) {
            // A click with no board (the meditation mode): the blade leaves the click itself.
            ys.push(c.screen.y);
            heights.push(this.strikeHeight(c.screen.y, { y0: 0.1, y1: 0.95 }));
            x0 = c.screen.x - 0.01;
            x1 = c.screen.x + 0.01;
        } else {
            const rows = c.rows?.length ? c.rows : Array.from({ length: lines }, (_, i) => 19 - i);
            for (let i = 0; i < rows.length && i < 4; i++) {
                const sy = boardPoint(board, 0.5, rows[i], this._pt).y;
                ys.push(sy);
                heights.push(this.strikeHeight(sy, board));
            }
        }
        const inner = helixX - 0.75 * scale;
        for (let i = 0; i < ys.length; i++) ends.push(this.screenOf(inner, heights[i], 0).y);
        const reachR = this.screenOf(inner, heights[0], 0).x;
        const reachL = this.screenOf(-inner, heights[0], 0).x;
        this.blades.fire(ys, ends, x0, x1, reachL, reachR, t, 0.8 + 0.15 * lines + 0.1 * deeper);
        const hit = t + BLADE_TRAVEL;
        // Several rows tear less each, so one quad's leaf does not take the whole pool.
        const leafEach = Math.round(((70 + 14 * Math.min(combo, 6) + 8 * deeper) * burst) / ys.length ** 0.35);
        for (let i = 0; i < ys.length; i++) {
            const y = heights[i];
            const at = hit + i * 0.035;
            // Several rows land close together: each gives less, so the towers stay gold.
            this.pulse(y, at, (0.6 + 0.2 * lines) / lines ** 0.75, 0);
            for (let side = -1; side <= 1; side += 2) {
                this.flares.fire(side * inner, y, 0.9 * scale, at, (0.5 + 0.12 * lines) / lines ** 0.7, 1.3, 0.6);
                this.leaf.emit({
                    x: side * (helixX - 0.6 * scale),
                    y,
                    z: 0.5 * scale,
                    n: leafEach,
                    time: at,
                    dir: [side * 0.55, 0.5, 0.45],
                    cone: 0.75,
                    speed: [1.2, 4.6],
                    life: [3.2, 6.2],
                    size: [0.05, 0.13],
                    swirl: side * 2.6,
                    axisX: side * helixX,
                    axisZ: 0,
                    flutter: [0.15, 0.45],
                    jitter: 0.6 * scale,
                    stagger: 0.12,
                });
                this.sparks.emit({
                    x: side * inner,
                    y,
                    z: 0.7 * scale,
                    n: Math.max(2, Math.round(12 * burst)),
                    time: at,
                    rgb: GOLD,
                    dir: [-side * 0.25, 0.55, 0.6],
                    cone: 0.9,
                    speed: [2, 7],
                    life: [0.4, 0.9],
                    size: 0.024,
                });
            }
        }
        // Each wave past the first also drives a pulse up both towers out of the water, harder
        // the deeper the cascade runs.
        if (deeper > 0) this.pulse(0.1, hit, Math.min(1.2, 0.35 + 0.15 * deeper), 0);
        const held = 0.3 + 0.15 * lines + 0.05 * deeper;
        this.holdFlare(0, held);
        this.holdFlare(1, held);
        this.spinKick = Math.min(8, this.spinKick + 0.7 + 0.45 * lines + 0.3 * deeper);
        this.ringKick = Math.min(4, this.ringKick + 0.25 * lines + 0.35 * deeper);
        // A front across the water: a cascade's waves run out one after another, each faster.
        this.surgeFront(t + 0.04, 0.55 + 0.2 * lines + 0.12 * deeper, lines, 1 + 0.15 * deeper);
        const strikes = lines >= 4 || c.perfect === true;
        // (A strike sends its own comets: two sets for one quad would crowd the ring's slots.)
        if (!strikes) this.comets(hit + 0.12, 0.65 + 0.2 * lines + 0.1 * deeper, lines >= 3 || deeper >= 2 ? 2 : 1);
        if (!this.reducedMotion) this.dolly = Math.min(0.7, this.dolly + 0.1 * lines + 0.05 * deeper);
        this.flash.hit(0.06 + 0.04 * lines + 0.02 * deeper, t);
        this.kick.hit(0.2 + 0.1 * lines, t);
        if (c.tspin) this.turn(t, TAU);
        if (c.b2b) this.backToBack(t);
        if (strikes) this.strike(t, c.perfect ? 1.25 : 1);
    }

    /** A T-spin that cleared nothing: half a turn, and a breath of light up both towers. */
    onSpin() {
        const t = this.time;
        this.counts.spins += 1;
        this.surge.spin(t);
        this.turn(t, TAU * 0.5);
        this.pulse(0.1, t + 0.05, 0.45, 0);
        this.holdFlare(0, 0.12);
        this.holdFlare(1, 0.12);
        this.spinKick = Math.min(8, this.spinKick + 0.6);
    }

    /**
     * Turn both towers on the spot by `amount` radians, eased over 0.9 s. A turn asked for while
     * one is still turning carries on from where the towers are: it never snaps back.
     */
    turn(t, amount) {
        const now = this.pirouetteAt(t);
        this.pirouette.from = now;
        this.pirouette.to = Math.max(this.pirouette.to, now) + amount;
        this.tspinAt = t;
    }

    /** How far the towers have turned on the spot at `t` (radians). */
    pirouetteAt(t) {
        const { from, to } = this.pirouette;
        const k = clamp01((t - this.tspinAt) / 0.9);
        return from + (to - from) * k * k * (3 - 2 * k);
    }

    /**
     * A back-to-back: the great ring's crown lights in the alloy's colour and a pair of comets
     * runs down from it to both feet, the reverse of a clear's. The crown stays lit while the
     * back-to-backs keep coming: each lifts it higher.
     */
    backToBack(t) {
        this.counts.b2b += 1;
        this.crownGlow.hit(0.75, t + 0.1);
        this.crownComets(t + 0.12, 1.15);
        const scale = this.ringScale();
        this.flares.fire(0, STAGE.ring.y + STAGE.ring.radius * scale, STAGE.ring.z, t + 0.1, 0.9, 2.4, 1.0);
        this.ringKick = Math.min(6, this.ringKick + 1.2);
    }

    /**
     * The strike's light: the ring's blaze, the gilt on the water, the braid, the overdrive. From
     * cold it is lit afresh after a hush (shallower the hotter play runs: a strike in a fever
     * inhales, it does not black the hall out). Inside one still burning it feeds the blaze and
     * the gilt instead, with no second hush, and the braid climbs on.
     * @returns {number} when the light goes up
     */
    ignite(t, strength, { hush = true } = {}) {
        const go = t + AURUM.hush;
        const a = this.u.aurum.value;
        let depth = 0;
        if (this.aurumAt > -50 && t - this.aurumAt < STRIKE_SPAN && a.y > 0) {
            const age = Math.max(0, go - this.aurumAt - AURUM.hush);
            const burning = a.z * Math.exp(-0.5 * age);
            a.z = Math.min(BLAZE_MAX, burning + strength) * Math.exp(0.5 * age);
        } else {
            this.aurumAt = t;
            this.aurumStrength = strength;
            a.set(t, strength, strength, a.w);
            if (hush && !this.reducedMotion) {
                depth = Math.max(0, 1 - 0.85 * this.play.level);
                this.hushAt = t;
                this.hushDepth = depth;
            }
        }
        this.over.hit(strength, go);
        this.lift.hit(0.08 * strength, go);
        this.ignition.hit(0.3 * strength, go);
        this.rayLight.hit(0.08 * strength, go);
        // The strike draws the camera back for the hush, less the less it hushes.
        if (!this.reducedMotion) this.pull.hit(0.5 * strength * (0.4 + 0.6 * depth), t);
        return go;
    }

    /** The four-line strike. */
    strike(t, strength = 1) {
        this.counts.strikes += 1;
        const go = this.ignite(t, strength);
        this.ripple(0, STAGE.boardZ, go, 1.4, IVORY);
        this.ripple(0, STAGE.boardZ, go + 0.4, 0.9, GOLD);
        for (let k = 0; k < 3; k++) this.pulse(0.2, go + k * 0.24, 0.7 - k * 0.16, 0);
        this.spinKick = Math.min(10, this.spinKick + 4.5);
        this.ringKick = Math.min(6, this.ringKick + 2.4);
        // Added to what the towers hold: a strike never dims a glow already burning.
        this.holdFlare(0, 0.9);
        this.holdFlare(1, 0.9);
        this.comets(go, 1.2, 2);
        const scale = this.ringScale();
        this.flares.fire(0, STAGE.ring.y + STAGE.ring.radius * scale, STAGE.ring.z, go, 1.2 * strength, 3.2, 1.3);
        this.sparks.emit({
            x: 0,
            y: 0.05,
            z: STAGE.boardZ - 2,
            n: Math.round(70 * this.tier.burst),
            time: go,
            rgb: IVORY,
            dir: [0, 1, -0.1],
            cone: 0.85,
            speed: [4, 12],
            life: [0.7, 1.5],
            size: 0.034,
            jitter: 3.5,
        });
    }

    /**
     * The late perfect clear: the crown on the clear still playing. The towers brim over (the
     * molten gold runs to their crowns and spills as leaf), the great ring's crown blazes and
     * sends comets down both sides, and the strike burning takes it up. Never a second hush.
     */
    crown() {
        const t = this.time;
        this.counts.crowns += 1;
        this.surge.crown(t);
        this.ignite(t, 0.8, { hush: false });
        this.crownGlow.hit(1.2, t + 0.05);
        this.brim.hit(1, t);
        this.crownComets(t + 0.08, 1.4);
        const scale = this.ringScale();
        this.flares.fire(0, STAGE.ring.y + STAGE.ring.radius * scale, STAGE.ring.z, t + 0.05, 1.3, 3.6, 1.6);
        this.holdFlare(0, 0.4);
        this.holdFlare(1, 0.4);
        this.spinKick = Math.min(10, this.spinKick + 2);
        const { helixX } = this.place;
        const top = this.fillTop();
        for (let side = -1; side <= 1; side += 2) {
            this.pulse(0.1, t + 0.05, 0.9, side);
            this.leaf.emit({
                x: side * helixX,
                y: top,
                z: 0,
                n: Math.round(60 * this.tier.burst),
                time: t + 0.35,
                dir: [-side * 0.35, 0.35, 0.3],
                cone: 0.8,
                speed: [0.8, 3.2],
                life: [3, 5.5],
                size: [0.05, 0.12],
                swirl: side * 2.2,
                axisX: side * helixX,
                axisZ: 0,
                flutter: [0.2, 0.5],
                jitter: 0.8 * scale,
                stagger: 0.4,
            });
        }
    }

    /** World height of the towers' crowns, where the molten gold brims over. */
    fillTop() {
        const frameTop = STAGE.camera.y + STAGE.camera.z * Math.tan((this.fov * Math.PI) / 360);
        return Math.min(frameTop - 0.4, FILL_TOP * this.place.scaleY);
    }

    /** The true consecutive-clear combo (0 = the chain broke). */
    onCombo(n) {
        const prev = this.combo;
        this.combo = Math.max(0, Math.round(n || 0));
        const t = this.time;
        if (this.combo > prev && this.combo >= 2) {
            // Each step of the chain: a pulse climbs both towers out of the water, and the
            // tally is struck again.
            this.pulse(0.1, t + 0.05, Math.min(1.2, 0.35 + 0.1 * this.combo), 0);
            this.ringKick = Math.min(4, this.ringKick + 0.3);
            this.tallyState.count = Math.min(99, this.combo);
            this.tallyState.punch = 1;
        } else if (this.combo === 0 && prev >= 2) {
            // The chain broke: the heat leaves from the top down, the ring sheds a little leaf
            // and the tally falls to pieces.
            this.pulse(10.5, t, 0.45, 0);
            if (this.tally && this.tallyState.shown > 0.2) {
                const place = this.tally.uniforms.place.value;
                this.leaf.emit({
                    x: place.x,
                    y: place.y,
                    z: place.z,
                    n: Math.round(46 * this.tier.burst),
                    time: t,
                    speed: [0.4, 2.2],
                    life: [2.6, 4.6],
                    size: [0.04, 0.09],
                    flutter: [0.15, 0.4],
                    jitter: 0.9,
                });
            }
            const scale = this.ringScale();
            this.leaf.emit({
                x: 0,
                y: STAGE.ring.y + STAGE.ring.radius * scale * 0.9,
                z: STAGE.ring.z,
                n: Math.round(40 * this.tier.burst),
                time: t,
                speed: [0.3, 1.6],
                life: [4, 7],
                size: [0.05, 0.11],
                flutter: [0.3, 0.7],
                jitter: 6 * scale,
            });
        }
    }

    /**
     * Pour the alloy for `level` up the towers. `silent` = it is simply there. A level reached
     * while the last pour still climbs waits for it (the towers never jump to an alloy half way).
     */
    levelUp(level, { silent = false } = {}) {
        const next = Math.max(1, Math.round(level || 1));
        if (next === this.level && !silent) return;
        this.level = next;
        if (silent) {
            this.queuedLevel = 0;
            this.applyAlloy(alloyForLevel(next), true);
            return;
        }
        this.surge.levelUp(this.time);
        const pouring = this.time - this.pourAt < POUR_SPAN;
        if (pouring) this.queuedLevel = next;
        else this.pour(next);
        this.comets(this.time, 0.8, 1);
        this.holdFlare(0, 0.4);
        this.holdFlare(1, 0.4);
    }

    /** Start pouring `level`'s alloy up the towers now. */
    pour(level) {
        this.applyAlloy(alloyForLevel(level), false);
        this.pourAt = this.time;
    }

    applyAlloy(alloy, instantly) {
        const { u } = this;
        if (instantly) {
            this.pourAt = -100;
        } else {
            u.prevA.value.copy(u.alloyA.value);
            u.prevB.value.copy(u.alloyB.value);
            u.prevC.value.copy(u.alloyC.value);
        }
        u.alloyA.value.set(...alloy.ribbons[0]);
        u.alloyB.value.set(...alloy.ribbons[1]);
        u.alloyC.value.set(...alloy.ribbons[2]);
        for (let i = 0; i < 3; i++) this.glowBase[i] = alloy.glow[i];
        this.showGlow();
        if (instantly) {
            u.prevA.value.copy(u.alloyA.value);
            u.prevB.value.copy(u.alloyB.value);
            u.prevC.value.copy(u.alloyC.value);
        }
    }

    /** The alloy's glow as the hall wears it: a fever runs it molten, deeper and redder. */
    showGlow() {
        const f = this.play.fever;
        const g = this.glowBase;
        this.u.glow.value.set(g[0], g[1] * (1 - 0.2 * f), g[2] * (1 - 0.55 * f));
    }

    /** A new run: the hall back at rest, no chain in flight. */
    resetSession() {
        const { u } = this;
        this.combo = 0;
        this.heat = 0;
        this.flare.fill(0);
        this.flareStore.fill(0);
        this.spinKick = 0;
        this.ringKick = 0;
        this.open.fill(0);
        this.tallyState.count = 0;
        this.tallyState.shown = 0;
        this.tallyState.punch = 0;
        this.aurumAt = -100;
        this.aurumStrength = 0;
        this.hushAt = -100;
        this.hushDepth = 0;
        this.tspinAt = -100;
        this.pirouette.from = 0;
        this.pirouette.to = 0;
        this.queuedLevel = 0;
        this.dip = 0;
        this.dolly = 0;
        const swells = [
            this.flash, this.kick, this.over, this.lift, this.pull,
            this.ignition, this.rayLight, this.crownGlow, this.brim,
        ];
        swells.forEach((swell) => swell.reset());
        this.surge.reset();
        this.play = this.surge.sample(this.time);
        this.fill = 0;
        this.shed = 0;
        for (let i = 0; i < PULSE_SLOTS; i++) u.pulseA[i].value.set(0, -100, 0, 0);
        for (let i = 0; i < RIPPLE_SLOTS; i++) u.rippleA[i].value.set(0, 0, -100, 0);
        for (let i = 0; i < COMET_SLOTS; i++) u.cometA[i].value.set(-100, 0, 0, 0);
        for (let i = 0; i < SURGE_SLOTS; i++) u.surgeA[i].value.set(-100, 0, 1, 1);
        u.aurum.value.set(-100, 0, 0, 0);
        u.play.value.set(0, 0, -100, 0);
        this.leaf?.reset();
        this.sparks?.reset();
        this.blades?.reset();
        this.flares?.reset();
        this.level = 1;
        this.applyAlloy(ALLOYS[0], true);
    }

    /** Jump to `time` with the hall at rest (captures replay events from here). */
    seek(time) {
        this.time = Math.max(0, time || 0);
        this.resetSession();
        this.spin = TOWER_TURN * this.time;
        this.ringSpin = RING_TURN * this.time;
        this.applyLayout(true);
        this.pose(0);
    }

    // ── frame ───────────────────────────────────────────────────────────────────

    ringScale() {
        return Math.min(1.15, Math.max(0.35, this.place.helixX / 6.8));
    }

    /** How far into its overdrive the strikes are: 0 before and long after, 1 at one's ignition. */
    overdrive() {
        return this.over.valueAt(this.time);
    }

    /**
     * The camera: a slow drift, pointer parallax, and the kicks gameplay gives it. The heat of
     * play leans it in toward the anvil; a strike draws it back for the hush.
     * @param {THREE.PerspectiveCamera} camera
     * @param {{ time: number, delta: number, pointerX?: number, pointerY?: number }} sim
     */
    updateCamera(camera, sim) {
        const t = sim.time;
        const dt = sim.delta || 0;
        this.dip *= Math.exp(-7 * dt);
        this.dolly *= Math.exp(-2.6 * dt);
        const calm = this.reducedMotion ? 0.3 : 1;
        const px = sim.pointerX || 0;
        const py = sim.pointerY || 0;
        const pull = this.reducedMotion ? 0 : this.pull.valueAt(t);
        const lean = this.reducedMotion ? 0 : this.play.level * 0.45 + this.play.punch * 0.1;
        const x = (Math.sin(t * 0.047) * 0.42 + Math.sin(t * 0.031 + 1.3) * 0.2) * calm + px * 0.55;
        const y = STAGE.camera.y + Math.sin(t * 0.039 + 0.7) * 0.1 * calm - py * 0.18 - this.dip;
        const z = STAGE.camera.z + Math.sin(t * 0.023) * 0.3 * calm - this.dolly - lean + pull;
        camera.position.set(x, y, z);
        if (camera.fov !== this.fov) {
            camera.fov = this.fov;
            camera.updateProjectionMatrix();
        }
        const lookY = STAGE.camera.y + 0.2 + (y - STAGE.camera.y) * 0.3;
        camera.lookAt(x * 0.25, lookY, 0);
        camera.rotateZ(Math.sin(t * 0.05) * 0.004 * calm);
        // The shared breath (shared/camera-breath.js) on top of the drift above, pivoting on the
        // towers' plane it looks at: off under reduced motion (which keeps some of the drift).
        applyCameraBreath(camera, t, {
            distance: Math.hypot(x * 0.75, y - lookY, z),
            scale: this.reducedMotion ? 0 : 1,
        });
        camera.updateMatrixWorld();
    }

    /**
     * @param {{ time: number, delta: number }} sim
     */
    update(sim) {
        const { u } = this;
        const t = sim.time;
        const dt = Math.max(0, sim.delta || 0);
        this.time = t;
        u.time.value = t;

        // How hot play runs: one reading a frame on the hall's own clock.
        const play = this.surge.sample(t);
        this.play = play;
        const { level, fever } = play;

        // Where the towers stand.
        const { place } = this;
        const ease = approach(3, dt);
        place.helixX += (place.targetX - place.helixX) * ease;
        place.scale += (place.targetScale - place.scale) * ease;
        // In a narrow margin a tower grows slender, not short.
        place.scaleY = Math.max(TOWER_MIN_HEIGHT, place.scale);

        // The chain's heat, and the strike's overdrive on top of it. What the hall wears is the
        // chain's heat tempered by how long play has run hot (a chain's first clears warm it, its
        // tenth blazes), with a little warmth from the pace alone; its motion takes the chain's
        // own heat.
        const over = this.overdrive();
        const target = heatForCombo(this.combo);
        this.heat += (target - this.heat) * approach(target > this.heat ? 3.2 : 0.8, dt);
        const worn = this.heat * (0.6 + 0.4 * level) + level * (1 - this.heat) * 0.22;
        u.heat.value = Math.min(1.15, worn + over * 0.7);
        const moving = Math.min(1.15, this.heat + over * 0.7);

        // The hush before a strike from cold (as deep as play was cold), and the lift after it
        // (in what the hall gives off, never in the studio the gold reflects).
        let hush = 1;
        const hushAge = t - this.hushAt;
        if (hushAge >= 0 && hushAge < AURUM.hush && this.hushDepth > 0) {
            hush = lerp(1, 0.16, smooth(0, AURUM.hush * 0.55, hushAge) * this.hushDepth);
        }
        u.emit.value = hush + this.lift.valueAt(t) * flashScale();

        const fade = Math.exp(-1.45 * dt);
        this.flareStore[0] *= fade;
        this.flareStore[1] *= fade;
        this.showFlare();
        u.flare.value.set(this.flare[0], this.flare[1]);

        // Turning. A hot hand winds the hall up: its kicks run down slower.
        const slow = this.reducedMotion ? 0.5 : 1;
        this.spinKick *= Math.exp(-0.85 * (1 - 0.55 * level) * dt);
        this.ringKick *= Math.exp(-0.6 * (1 - 0.6 * level) * dt);
        this.spin += (TOWER_TURN * (1 + moving * 2) + (this.spinKick + over * 2.5) * slow) * dt;
        this.ringSpin += (RING_TURN * (1 + moving * 5) + (this.ringKick + over * 1.8) * slow) * dt;
        // The ring opens with the chain, with a strike, and with sustained heat: hot play opens a
        // band, a fever the whole armillary sphere.
        let bands = 0;
        if (level >= 0.55) bands = 1;
        if (level >= 0.8) bands = 2;
        if (fever >= 0.5) bands = 3;
        const wanted = Math.max(bandsForCombo(this.combo), over > 0.12 ? 3 : 0, bands);
        for (let i = 0; i < this.open.length; i++) {
            const goal = i < wanted ? 1 : 0;
            this.open[i] += (goal - this.open[i]) * approach(goal > this.open[i] ? 1.6 : 0.9, dt);
        }

        this.placeTally(dt);

        // The level-up's pour climbs the towers; a level reached during it pours next.
        const pourAge = t - this.pourAt;
        if (this.queuedLevel > 0 && pourAge >= POUR_SPAN) {
            const next = this.queuedLevel;
            this.queuedLevel = 0;
            this.pour(next);
        }
        const pourNow = t - this.pourAt;
        u.pour.value = pourNow >= 0 && pourNow < 4 ? HELIX.bottom + pourNow * 5.5 : 100;

        // The gold the towers take up: the heat of play fills them from the water toward their
        // crowns (casual play barely wets their feet), a fever or a perfect clear brims them over,
        // and when the hands rest it runs back down into the water.
        // (The last fifth, to the crowns, only a fever fills.)
        const filled = clamp01((level - 0.12) / 0.78) ** 0.85 * 0.8 + fever * 0.2;
        const goal = Math.max(filled, this.brim.valueAt(t));
        this.fill += (goal - this.fill) * approach(goal > this.fill ? 2.4 : 0.9, dt);
        const fillY = this.fill > 0.004 ? HELIX.bottom + 0.3 + this.fill * (FILL_TOP - HELIX.bottom - 0.3) : -100;
        const calmWater = this.reducedMotion ? 0.4 : 1;
        u.play.value.set(level, fever, fillY, (level * 0.55 + fever * 0.5) * calmWater);
        this.showGlow();
        // The great ring's crown, lit by back-to-backs and perfect clears.
        u.aurum.value.w = this.crownGlow.valueAt(t);
        // Brimming over, the crowns shed leaf into the hall.
        const spill = Math.max(fever - 0.25, 0) / 0.75;
        if (spill > 0 && dt > 0) {
            this.shed += dt * spill * 6;
            if (this.shed >= 1) {
                this.shed -= Math.floor(this.shed);
                this.shedLeaf(t, spill);
            }
        } else {
            this.shed = 0;
        }

        this.pose(t);

        // The studio: its lights drift a little, so the gold is never quite still; the hush takes
        // them down with everything else.
        this.scene.environmentIntensity = hush * (1 + u.heat.value * 0.12);
        this.scene.environmentRotation.y = Math.sin(t * 0.043) * 0.3 + Math.cos(t * 0.029) * 0.12;
    }

    /** A breath of leaf off both towers' crowns, carried down round each in its own hand. */
    shedLeaf(t, amount) {
        const { helixX, scale } = this.place;
        const top = this.fillTop();
        for (let side = -1; side <= 1; side += 2) {
            this.leaf.emit({
                x: side * helixX,
                y: top,
                z: 0,
                n: Math.max(2, Math.round(9 * amount * this.tier.burst)),
                time: t,
                dir: [-side * 0.3, 0.15, 0.25],
                cone: 0.9,
                speed: [0.4, 1.8],
                life: [3, 5],
                size: [0.05, 0.11],
                swirl: side * 1.8,
                axisX: side * helixX,
                axisZ: 0,
                flutter: [0.2, 0.5],
                jitter: 1.1 * scale,
                stagger: 0.15,
            });
        }
    }

    /**
     * The tally stands in the gap between the board and the left tower, level with the top of
     * the card (above the card when there is no gap, as on a phone held upright).
     */
    placeTally(dt) {
        const { tally, tallyState: state } = this;
        const goal = this.combo >= 2 ? 1 : 0;
        state.shown += (goal - state.shown) * approach(goal > state.shown ? 9 : 3.5, dt);
        state.punch *= Math.exp(-5.5 * dt);
        if (!tally) return;
        tally.uniforms.state.value.set(state.count, state.shown, state.punch, 0);
        if (state.shown < 0.004) return;
        const union = cardUnion(this.currentLayout());
        if (!union) return;
        const towerX = this.screenXOf(-(this.place.helixX - 1.2 * this.place.scale));
        const gap = union.x0 - towerX;
        const sx = gap > 0.07 ? union.x0 - Math.min(0.075, gap * 0.5) : (union.x0 + union.x1) * 0.5;
        const sy = gap > 0.07 ? union.y0 + 0.085 : Math.max(0.035, union.y0 - 0.04);
        const at = this.worldAtDepth(sx, sy, TALLY_Z);
        // A fixed fraction of the frame's height, whatever the lens.
        const metres = (0.085 * (STAGE.camera.z - TALLY_Z)) / this.u.lens.value;
        tally.uniforms.place.value.set(at.x, at.y, at.z, metres);
    }

    /** Place the towers and the ring for the current state. */
    pose(t) {
        const { u, place } = this;
        u.helixX.value = place.helixX;
        u.helixScale.value = place.scale;
        // A T-spin: one whole turn on the spot, eased (turns asked for mid-turn carry on).
        const pirouette = this.pirouetteAt(t);
        for (let i = 0; i < this.towers.length; i++) {
            const tower = this.towers[i];
            tower.group.position.set(tower.hand * place.helixX, 0, 0);
            tower.group.scale.set(place.scale, place.scaleY, place.scale);
            // Mirror images turn in opposite senses: both braids climb.
            tower.group.rotation.y = tower.hand * (this.spin + pirouette);
        }
        if (this.ring) {
            const scale = this.ringScale();
            this.ring.group.scale.setScalar(scale);
            this.ring.group.position.set(0, STAGE.ring.y, STAGE.ring.z);
            poseRing(this.ring, this.ringSpin, this.open, t);
        }
    }

    /** What the post stack needs this frame. The returned object is reused. */
    getPostState() {
        const p = this._post;
        const union = cardUnion(this.currentLayout());
        p.heart.x = union ? (union.x0 + union.x1) * 0.5 : 0.5;
        p.heart.y = union ? (union.y0 + union.y1) * 0.5 : 0.5;
        const now = this.time;
        const heat = this.u.heat.value;
        const { level, punch } = this.play;
        const ignite = this.ignition.valueAt(now);
        const flash = this.flash.valueAt(now);
        p.flash = this.reducedMotion ? Math.min(0.15, flash) : Math.min(1.2, flash + ignite);
        // Impacts ride on the punch of play: under rapid locks the lens never quite settles.
        p.kick = this.reducedMotion ? 0 : Math.min(1, this.kick.valueAt(now) + ignite + punch * 0.2);
        // While a strike blazes the bloom draws in: its light stays in the ring, the braid and the
        // gilt, in colour, instead of hazing the hall.
        const over = this.over.valueAt(now);
        p.bloomBoost = Math.max(-0.8, heat * 0.15 + (this.flare[0] + this.flare[1]) * 0.06 - over * 0.6);
        p.rays = this.rayLight.valueAt(now) + heat * 0.03;
        p.streak = Math.max(0.5, 1 + heat * 0.5 - over * 0.5);
        // The iris closes as the hall flares and as play runs hot, so its blacks and its colour
        // survive the surge: the light stays in the gold, the hall stays dark.
        p.exposure = 1 / (1 + heat * 0.3 + (this.flare[0] + this.flare[1]) * 0.12 + level * 0.12 + over * 0.2);
        return p;
    }

    getState() {
        return {
            quality: this.quality,
            time: this.time,
            level: this.level,
            combo: this.combo,
            heat: this.u.heat.value,
            emit: this.u.emit.value,
            flare: [this.flare[0], this.flare[1]],
            spin: this.spin,
            spinKick: this.spinKick,
            ringSpin: this.ringSpin,
            open: this.open.slice(),
            tally: { ...this.tallyState },
            helixX: this.place.helixX,
            scale: this.place.scale,
            scaleY: this.place.scaleY,
            layoutLive: this.layoutLive,
            strike: this.time - this.aurumAt,
            blaze: this.u.aurum.value.z * Math.exp(-0.5 * Math.max(0, this.time - this.aurumAt - AURUM.hush)),
            crown: this.crownGlow.valueAt(this.time),
            fill: this.fill,
            surge: {
                punch: this.play.punch, level: this.play.level, fever: this.play.fever, stage: this.play.stage,
            },
            counts: { ...this.counts },
            reflection: this.tier.reflection,
            bands: BANDS.length,
        };
    }

    dispose() {
        if (this.root.parent) this.root.parent.remove(this.root);
        // Parts share materials (one gold per kind for both towers, one for the ring's bands):
        // each resource is disposed once.
        const done = new Set();
        this.parts.forEach((part) => {
            part.dispose?.();
            for (const resource of [part.geometry, part.material]) {
                if (resource && !done.has(resource)) {
                    done.add(resource);
                    resource.dispose();
                }
            }
        });
        this.parts.length = 0;
        this.reflection?.dispose?.();
        this.reflection = null;
        if (this.scene) {
            if (this.scene.environment === this.textures.studio) this.scene.environment = this.savedEnvironment ?? null;
            this.scene.environmentIntensity = this.savedEnvironmentIntensity ?? 1;
            this.scene.environmentRotation?.set(0, 0, 0);
        }
        Object.keys(this.textures).forEach((name) => this.textures[name]?.dispose());
        this.textures = {};
        this.towers.length = 0;
        this.ring = null;
        this.groups = {};
        this.root.clear();
        this.camera = null;
    }
}
