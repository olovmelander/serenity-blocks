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
 *   T-spin    both towers turn once on the spot.
 *   level up  the next alloy is poured up the towers.
 *
 * Nothing is created at event time: events write numbers into ring-buffered uniform slots and
 * preallocated pools, often dated a moment ahead (a tower's pulse is dated for when the sparks
 * reach it). seek(t) plus a fixed-step replay reproduces any frame.
 */

import * as THREE from 'three/webgpu';
import {
    ALLOYS,
    AURUM,
    COMET_SLOTS,
    HELIX,
    PULSE_SLOTS,
    RIPPLE_SLOTS,
    SPARK_FLIGHT,
    STAGE,
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
        this.heat = 0;
        this.flare = [0, 0];
        this.spin = 0;
        this.spinKick = 0;
        this.ringSpin = 0;
        this.ringKick = 0;
        this.open = [0, 0, 0];
        /** The tally beside the board: the count it shows, how present it is, its stamp. */
        this.tallyState = { count: 0, shown: 0, punch: 0 };
        this.aurumAt = -100;
        this.aurumStrength = 0;
        this.tspinAt = -100;
        this.pourAt = -100;
        this.dip = 0;
        this.dolly = 0;
        this.flash = 0;
        this.kick = 0;
        this.cursor = { pulse: 0, ripple: 0, comet: 0 };
        this.counts = {
            locks: 0, clears: 0, strikes: 0,
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
        const u = createHallUniforms({ noise: this.textures.noise });
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
            reflectionScale: tier.reflection, reflectionTaps: tier.reflectionTaps,
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

    /** A pulse through the towers from world height `y`. `side`: −1 left, +1 right, 0 both. */
    pulse(y, time, strength, side = 0) {
        const i = this.cursor.pulse % PULSE_SLOTS;
        this.cursor.pulse += 1;
        this.u.pulseA[i].value.set(y / Math.max(0.2, this.place.scaleY), time, strength, side);
    }

    ripple(x, z, time, strength, rgb = GOLD) {
        const i = this.cursor.ripple % RIPPLE_SLOTS;
        this.cursor.ripple += 1;
        this.u.rippleA[i].value.set(x, z, time, strength);
        this.u.rippleC[i].value.set(rgb[0], rgb[1], rgb[2]);
    }

    /** `pairs` pairs of comets leave the ring's two feet and cross at its crown. */
    comets(time, strength, pairs = 1) {
        for (let p = 0; p < pairs; p++) {
            const speed = 2.3 + p * 0.9;
            const at = time + p * 0.2;
            const right = this.cursor.comet % COMET_SLOTS;
            const left = (this.cursor.comet + 1) % COMET_SLOTS;
            this.cursor.comet += 2;
            this.u.cometA[right].value.set(at, speed, strength, RING_FOOT);
            this.u.cometA[left].value.set(at, -speed, strength, Math.PI - RING_FOOT);
        }
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
            this.flare[side < 0 ? 0 : 1] = Math.min(1.2, this.flare[side < 0 ? 0 : 1] + weight * 0.08);
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
            this.kick = Math.max(this.kick, 0.35);
        }
    }

    /**
     * @param {{ player?: number, rows?: number[], lines?: number, combo?: number, tspin?: boolean,
     *   perfect?: boolean, screen?: {x:number,y:number}|null }} c
     */
    onClear(c = {}) {
        const t = this.time;
        const layout = this.currentLayout();
        const board = boardFor(layout, c.player ?? 0);
        const card = cardFor(layout, board);
        if (!board || !card) return;
        this.counts.clears += 1;
        const lines = Math.max(1, Math.min(4, Math.round(c.lines || 1)));
        const combo = Math.max(1, Math.round(c.combo || 1));
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
        this.blades.fire(ys, ends, x0, x1, reachL, reachR, t, 0.8 + 0.15 * lines);
        const hit = t + BLADE_TRAVEL;
        const leafEach = Math.round((70 + 14 * Math.min(combo, 6)) * burst);
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
        const held = 0.3 + 0.15 * lines;
        this.flare[0] = Math.min(1.2, this.flare[0] + held);
        this.flare[1] = Math.min(1.2, this.flare[1] + held);
        this.spinKick = Math.min(8, this.spinKick + 0.7 + 0.45 * lines);
        this.ringKick = Math.min(4, this.ringKick + 0.25 * lines);
        this.u.surge.value.set(t + 0.04, 0.55 + 0.2 * lines, lines, 0);
        this.comets(hit + 0.12, 0.65 + 0.2 * lines, lines >= 3 ? 2 : 1);
        if (!this.reducedMotion) this.dolly = Math.min(0.7, this.dolly + 0.1 * lines);
        this.flash = Math.max(this.flash, 0.06 + 0.04 * lines);
        this.kick = Math.max(this.kick, 0.2 + 0.1 * lines);
        if (c.tspin) this.tspinAt = t;
        if (lines >= 4 || c.perfect) this.strike(t, c.perfect ? 1.25 : 1);
    }

    /** The four-line strike. */
    strike(t, strength = 1) {
        this.counts.strikes += 1;
        this.aurumAt = t;
        this.aurumStrength = strength;
        this.u.aurum.value.set(t, strength, 0, 0);
        const go = t + AURUM.hush;
        this.ripple(0, STAGE.boardZ, go, 1.4, IVORY);
        this.ripple(0, STAGE.boardZ, go + 0.4, 0.9, GOLD);
        for (let k = 0; k < 3; k++) this.pulse(0.2, go + k * 0.24, 0.7 - k * 0.16, 0);
        this.spinKick = Math.min(10, this.spinKick + 4.5);
        this.ringKick = Math.min(6, this.ringKick + 2.4);
        this.flare[0] = 0.9;
        this.flare[1] = 0.9;
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

    /** Pour the alloy for `level` up the towers. `silent` = it is simply there. */
    levelUp(level, { silent = false } = {}) {
        const next = Math.max(1, Math.round(level || 1));
        if (next === this.level && !silent) return;
        this.level = next;
        this.applyAlloy(alloyForLevel(next), silent);
        if (!silent) {
            this.pourAt = this.time;
            this.comets(this.time, 0.8, 1);
            this.flare[0] = Math.min(1.2, this.flare[0] + 0.4);
            this.flare[1] = Math.min(1.2, this.flare[1] + 0.4);
        }
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
        u.glow.value.set(...alloy.glow);
        if (instantly) {
            u.prevA.value.copy(u.alloyA.value);
            u.prevB.value.copy(u.alloyB.value);
            u.prevC.value.copy(u.alloyC.value);
        }
    }

    /** A new run: the hall back at rest, no chain in flight. */
    resetSession() {
        const { u } = this;
        this.combo = 0;
        this.heat = 0;
        this.flare[0] = 0;
        this.flare[1] = 0;
        this.spinKick = 0;
        this.ringKick = 0;
        this.open.fill(0);
        this.tallyState.count = 0;
        this.tallyState.shown = 0;
        this.tallyState.punch = 0;
        this.aurumAt = -100;
        this.aurumStrength = 0;
        this.tspinAt = -100;
        this.dip = 0;
        this.dolly = 0;
        this.flash = 0;
        this.kick = 0;
        this.cursor.pulse = 0;
        this.cursor.ripple = 0;
        this.cursor.comet = 0;
        for (let i = 0; i < PULSE_SLOTS; i++) u.pulseA[i].value.set(0, -100, 0, 0);
        for (let i = 0; i < RIPPLE_SLOTS; i++) u.rippleA[i].value.set(0, 0, -100, 0);
        for (let i = 0; i < COMET_SLOTS; i++) u.cometA[i].value.set(-100, 0, 0, 0);
        u.surge.value.set(-100, 0, 1, 0);
        u.aurum.value.set(-100, 0, 0, 0);
        this.leaf?.reset();
        this.sparks?.reset();
        this.blades?.reset();
        this.flares?.reset();
        this.level = 1;
        this.applyAlloy(ALLOYS[0], true);
    }

    /** Jump to `time` with the hall at rest (captures replay events from here). */
    seek(time) {
        this.resetSession();
        this.time = Math.max(0, time || 0);
        this.spin = TOWER_TURN * this.time;
        this.ringSpin = RING_TURN * this.time;
        this.applyLayout(true);
        this.pose(0);
    }

    // ── frame ───────────────────────────────────────────────────────────────────

    ringScale() {
        return Math.min(1.15, Math.max(0.35, this.place.helixX / 6.8));
    }

    /** How far into its overdrive the four-line strike is: 0 before and long after, 1 at ignition. */
    overdrive() {
        const age = this.time - this.aurumAt - AURUM.hush;
        if (age < 0 || this.aurumStrength <= 0) return 0;
        return this.aurumStrength * Math.exp(-age / AURUM.hold);
    }

    /**
     * The camera: a slow drift, pointer parallax, and the kicks gameplay gives it.
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
        // The strike draws the camera back for the hush, then lets it go.
        let pull = 0;
        const age = t - this.aurumAt;
        if (!this.reducedMotion && age >= 0 && age < 8) {
            pull = 0.5 * this.aurumStrength * (age < AURUM.hush
                ? smooth(0, AURUM.hush, age)
                : Math.exp(-(age - AURUM.hush) * 1.1));
        }
        const x = (Math.sin(t * 0.047) * 0.42 + Math.sin(t * 0.031 + 1.3) * 0.2) * calm + px * 0.55;
        const y = STAGE.camera.y + Math.sin(t * 0.039 + 0.7) * 0.1 * calm - py * 0.18 - this.dip;
        const z = STAGE.camera.z + Math.sin(t * 0.023) * 0.3 * calm - this.dolly + pull;
        camera.position.set(x, y, z);
        if (camera.fov !== this.fov) {
            camera.fov = this.fov;
            camera.updateProjectionMatrix();
        }
        camera.lookAt(x * 0.25, STAGE.camera.y + 0.2 + (y - STAGE.camera.y) * 0.3, 0);
        camera.rotateZ(Math.sin(t * 0.05) * 0.004 * calm);
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

        // Where the towers stand.
        const { place } = this;
        const ease = approach(3, dt);
        place.helixX += (place.targetX - place.helixX) * ease;
        place.scale += (place.targetScale - place.scale) * ease;
        // In a narrow margin a tower grows slender, not short.
        place.scaleY = Math.max(TOWER_MIN_HEIGHT, place.scale);

        // The chain's heat, and the strike's overdrive on top of it.
        const over = this.overdrive();
        const target = heatForCombo(this.combo);
        this.heat += (target - this.heat) * approach(target > this.heat ? 3.2 : 0.8, dt);
        u.heat.value = Math.min(1.15, this.heat + over * 0.7);

        // The hush before the strike, and the flash after it.
        let emit = 1;
        const age = t - this.aurumAt;
        if (age >= 0 && age < 6 && this.aurumStrength > 0) {
            if (age < AURUM.hush) emit = this.reducedMotion ? 1 : lerp(1, 0.16, smooth(0, AURUM.hush * 0.55, age));
            else emit = 1 + 0.15 * this.aurumStrength * Math.exp(-(age - AURUM.hush) * 1.4);
        }
        u.emit.value = emit;

        const fade = Math.exp(-1.45 * dt);
        this.flare[0] *= fade;
        this.flare[1] *= fade;
        u.flare.value.set(this.flare[0], this.flare[1]);

        // Turning.
        this.spinKick *= Math.exp(-0.85 * dt);
        this.ringKick *= Math.exp(-0.6 * dt);
        const slow = this.reducedMotion ? 0.5 : 1;
        this.spin += (TOWER_TURN * (1 + u.heat.value * 2) + (this.spinKick + over * 2.5) * slow) * dt;
        this.ringSpin += (RING_TURN * (1 + u.heat.value * 5) + (this.ringKick + over * 1.8) * slow) * dt;
        const wanted = Math.max(bandsForCombo(this.combo), over > 0.12 ? 3 : 0);
        for (let i = 0; i < this.open.length; i++) {
            const goal = i < wanted ? 1 : 0;
            this.open[i] += (goal - this.open[i]) * approach(goal > this.open[i] ? 1.6 : 0.9, dt);
        }

        this.placeTally(dt);

        // The level-up's pour climbs the towers.
        const pourAge = t - this.pourAt;
        u.pour.value = pourAge >= 0 && pourAge < 4 ? HELIX.bottom + pourAge * 5.5 : 100;

        this.pose(t);

        // The studio: its lights drift a little, so the gold is never quite still; the hush takes
        // them down with everything else.
        this.scene.environmentIntensity = Math.min(1.2, emit) * (1 + u.heat.value * 0.12);
        this.scene.environmentRotation.y = Math.sin(t * 0.043) * 0.3 + Math.cos(t * 0.029) * 0.12;

        this.flash *= Math.exp(-4.2 * dt);
        this.kick *= Math.exp(-5 * dt);
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
        // A T-spin: one whole turn on the spot, eased.
        const k = clamp01((t - this.tspinAt) / 0.9);
        const pirouette = this.tspinAt > -50 ? TAU * k * k * (3 - 2 * k) : 0;
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
        const age = this.time - this.aurumAt - AURUM.hush;
        const lit = age >= 0 && this.aurumStrength > 0;
        const ignite = lit ? 0.3 * this.aurumStrength * Math.exp(-age * 3) : 0;
        p.flash = this.reducedMotion ? Math.min(0.15, this.flash) : Math.min(1.2, this.flash + ignite);
        p.kick = this.reducedMotion ? 0 : Math.min(1, this.kick + ignite);
        p.bloomBoost = this.u.heat.value * 0.15 + (this.flare[0] + this.flare[1]) * 0.06;
        p.rays = (lit ? 0.22 * this.aurumStrength * Math.exp(-age * 0.9) : 0) + this.u.heat.value * 0.03;
        p.streak = 1 + this.u.heat.value * 0.5;
        // The iris closes as the hall flares, so its blacks and its colour survive the surge.
        p.exposure = 1 / (1 + this.u.heat.value * 0.3 + (this.flare[0] + this.flare[1]) * 0.12);
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
            counts: { ...this.counts },
            reflection: this.tier.reflection,
            bands: BANDS.length,
        };
    }

    dispose() {
        if (this.root.parent) this.root.parent.remove(this.root);
        this.parts.forEach((part) => {
            part.dispose?.();
            part.geometry?.dispose();
            part.material?.dispose();
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
