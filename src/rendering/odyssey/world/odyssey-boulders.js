/**
 * BOULDERS AND OUTCROPS (Act II leftovers, 2026-11-02) — the island's things for scale.
 *
 * Grass, rock and flowers are painted into the ground, so the meadows and slopes had nothing that
 * says how big they are. A few rocks do: a boulder beside a tree, an outcrop breaking a slope.
 *
 * WHERE. Each group stands on an ANCHOR scored on the real rail camera (tests/unit's camera rig,
 * p 0.16-0.50): in frame, in the lower part of it, 80-700 u from the eye, in the line of sight,
 * with no tree within 13 u, off the tarn's open meadow, the rail's track and the deer's glade.
 * The rail sees them from p ~0.16 to ~0.37 (chapters 3 and 4; the climb looks up, past them).
 * - A `field` group is a main boulder with a few smaller ones round it, on the meadow.
 * - An `outcrop` is a run of tilted slabs breaking out of a slope, along its contour.
 *
 * SIZE. The eye flies 47-90 u over the ground, and the act draws its life at about three times
 * life (the deer, the butterflies), so a main boulder is 7-11 u across and an outcrop's slabs up
 * to ~20 u long: ~15-40 px from the rail's usual 200-400 u.
 *
 * SHAPE. Three rocks, made here (no model files): an icosphere cut by a few planes, so each has
 * flat faces with rounded shoulders between them, a little noise, and a flattened underside.
 * The facets carry their plane's normal, the shoulders the sphere's, so the light breaks on the
 * faces as it does on the ground's crisp rock.
 *
 * TIERS. Each rock comes at two levels of detail (`ODYSSEY_BOULDERS.lod`): 320 triangles near,
 * 80 far. Every rock is an instance of one of six instanced meshes (three shapes, two tiers),
 * all sharing one material. The renderer moves an instance between its tiers by its distance
 * from the eye, only when that changes.
 *
 * SEATING. Each rock sits on the drawn ground (`odysseyWorldHeight`): its base is the lowest
 * ground under its footprint, sunk by a share of its height, and it leans a little with the slope.
 */
import * as THREE from 'three';
import { getOdysseyPathPointAt } from '../path-utils.js';

/** The groups' anchors (world x, z), scored on the rail camera; `kind` by the ground's slope. */
export const ODYSSEY_BOULDERS = Object.freeze({
    anchors: Object.freeze([
        Object.freeze({
            x: -168, z: -540, kind: 'outcrop', seed: 1,
        }),
        Object.freeze({
            x: -296, z: -636, kind: 'outcrop', seed: 2,
        }),
        Object.freeze({
            x: -56, z: -700, kind: 'outcrop', seed: 3,
        }),
        Object.freeze({
            x: -216, z: -732, kind: 'outcrop', seed: 4,
        }),
        Object.freeze({
            x: -296, z: -508, kind: 'field', seed: 5,
        }),
        Object.freeze({
            x: -376, z: -380, kind: 'field', seed: 6,
        }),
        Object.freeze({
            x: -424, z: -652, kind: 'outcrop', seed: 7,
        }),
        Object.freeze({
            x: -328, z: -796, kind: 'field', seed: 8,
        }),
        Object.freeze({
            x: -40, z: -572, kind: 'outcrop', seed: 9,
        }),
        Object.freeze({
            x: -408, z: -892, kind: 'field', seed: 10,
        }),
        Object.freeze({
            x: -88, z: -364, kind: 'field', seed: 13,
        }),
        Object.freeze({
            x: -344, z: -252, kind: 'field', seed: 14,
        }),
        Object.freeze({
            x: -472, z: -300, kind: 'field', seed: 15,
        }),
        Object.freeze({
            x: -488, z: -460, kind: 'field', seed: 17,
        }),
        Object.freeze({
            x: -568, z: -572, kind: 'field', seed: 20,
        }),
    ]),
    /** A field group: the main boulder's width (u) and how many smaller ones lie round it. */
    field: Object.freeze({ main: Object.freeze([14, 22]), satellites: Object.freeze([2, 4]), spread: 24 }),
    /** An outcrop: how many slabs, their length (u), and how far the run reaches along the contour. */
    outcrop: Object.freeze({ slabs: Object.freeze([3, 5]), length: Object.freeze([18, 34]), run: 58 }),
    /** No rock nearer a tree's trunk than its own radius plus this (u). */
    treeClear: 5,
    /** No rock nearer the rail's ground track (p 0.12-0.72) than this (u). */
    railClear: 30,
    /** A rock must stand at least this share of its height over the ground at its centre. */
    standsOut: 0.35,
    /** How far the base sinks, as a share of the rock's height, under its lowest ground. */
    sink: 0.15,
    /** The share of the ground's slope a rock leans with. */
    lean: 0.6,
    /** Icosphere detail per tier, and the eye distance (u) a rock moves to the far tier at. */
    lod: Object.freeze({ near: 3, far: 1, switchAt: 360 }),
    /** The three shapes: plane cuts (how many, how deep) and how flat. */
    shapes: Object.freeze([
        Object.freeze({
            seed: 11, cuts: 9, depth: Object.freeze([0.50, 0.78]), flat: 0.74, noise: 0.07,
        }),
        Object.freeze({
            seed: 29, cuts: 7, depth: Object.freeze([0.42, 0.70]), flat: 0.64, noise: 0.05,
        }),
        Object.freeze({
            seed: 47, cuts: 11, depth: Object.freeze([0.55, 0.82]), flat: 0.58, noise: 0.06,
        }),
    ]),
});

/** A small deterministic generator (mulberry32). */
function rng(seed) {
    let s = (seed * 2654435761) >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Smooth value noise on the unit sphere's directions (three sines, cheap and seamless). */
function lumpAt(x, y, z, seed) {
    return (Math.sin((x * 3.1) + seed) * Math.sin((y * 2.7) + (seed * 1.7)) * 0.5)
        + (Math.sin(((x + z) * 4.3) - seed) * 0.3)
        + (Math.sin(((y - z) * 5.1) + (seed * 0.6)) * 0.2);
}

/**
 * One rock: an icosphere cut by planes, a little lumpy, flattened, its underside cut flat.
 * Non-indexed; each vertex's normal is its facet's plane where a cut made it, the sphere's elsewhere.
 * @param {number} shapeIndex index into ODYSSEY_BOULDERS.shapes
 * @param {number} detail icosphere detail (2 = 320 triangles, 1 = 80)
 * @returns {THREE.BufferGeometry}
 */
export function buildBoulderGeometry(shapeIndex, detail) {
    const shape = ODYSSEY_BOULDERS.shapes[shapeIndex];
    const r = rng(shape.seed);
    const cuts = [];
    for (let k = 0; k < shape.cuts; k += 1) {
        // Spread round the rock, never straight down (the underside has its own cut).
        const theta = r() * Math.PI * 2;
        const y = (r() * 1.5) - 0.55;
        const h = Math.sqrt(Math.max(0, 1 - (y * y)));
        const n = new THREE.Vector3(Math.cos(theta) * h, y, Math.sin(theta) * h).normalize();
        cuts.push({ n, d: shape.depth[0] + (r() * (shape.depth[1] - shape.depth[0])) });
    }
    const base = new THREE.IcosahedronGeometry(1, detail);
    const pos = base.attributes.position;
    const positions = new Float32Array(pos.count * 3);
    const normals = new Float32Array(pos.count * 3);
    const dir = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const FLOOR = -0.42;
    for (let i = 0; i < pos.count; i += 1) {
        dir.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
        let rad = 1 + (lumpAt(dir.x, dir.y, dir.z, shape.seed) * shape.noise);
        let plane = null;
        cuts.forEach((c) => {
            const along = dir.dot(c.n);
            if (along > 1e-3 && c.d / along < rad) {
                rad = c.d / along;
                plane = c.n;
            }
        });
        let px = dir.x * rad;
        let py = dir.y * rad;
        let pz = dir.z * rad;
        if (py < FLOOR) {
            py = FLOOR;
            plane = null;
            nrm.set(0, -1, 0);
        } else if (plane) {
            nrm.copy(plane);
        } else {
            nrm.copy(dir);
        }
        // Flattened: the normal takes the inverse of the squash.
        py *= shape.flat;
        nrm.y /= shape.flat;
        nrm.normalize();
        px *= 1;
        pz *= 1;
        positions.set([px, py, pz], i * 3);
        normals.set([nrm.x, nrm.y, nrm.z], i * 3);
    }
    base.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.name = `OdysseyBoulder${shapeIndex}-${detail}`;
    return geo;
}

/** The ground's slope (dy/dx, dy/dz) at (x, z), by central differences over `h` u. */
function slopeAt(heightAt, x, z, h = 3) {
    return [
        (heightAt(x + h, z) - heightAt(x - h, z)) / (2 * h),
        (heightAt(x, z + h) - heightAt(x, z - h)) / (2 * h),
    ];
}

/**
 * Seat one rock on the ground: its lowest ground under the footprint, sunk by `sink` of its height,
 * leaning with the slope.
 */
function seatRock(heightAt, rock) {
    const { x, z } = rock;
    // The footprint is the rock's own ellipse, turned with it (a turn about y by `yaw`).
    const c = Math.cos(rock.yaw);
    const s = Math.sin(rock.yaw);
    let low = heightAt(x, z);
    for (let a = 0; a < 8; a += 1) {
        const th = (a / 8) * Math.PI * 2;
        const lx = Math.cos(th) * rock.sx * 0.6;
        const lz = Math.sin(th) * rock.sz * 0.6;
        low = Math.min(low, heightAt(x + (lx * c) + (lz * s), z - (lx * s) + (lz * c)));
    }
    const [gx, gz] = slopeAt(heightAt, x, z);
    const { lean, sink } = ODYSSEY_BOULDERS;
    return {
        ...rock,
        // The shape's underside sits at -0.42 of its (flattened) radius; its height spans ~1.4.
        y: low - (rock.sy * sink) + (rock.sy * 0.42 * ODYSSEY_BOULDERS.shapes[rock.shape].flat),
        ground: low,
        // Lean: rotate about x by the z-slope and about z by the x-slope (small angles).
        tiltX: Math.atan(gz) * lean,
        tiltZ: -Math.atan(gx) * lean,
    };
}

/**
 * Every rock: world position, size, turn, lean, shape and paint.
 * @param {(x: number, z: number) => number} heightAt the drawn ground
 * @param {{ trees?: Array<{x: number, z: number}> }} [opts] the forest's trunks, to keep clear of
 * @returns {Array<{x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number,
 *   tiltX: number, tiltZ: number, shape: number, tone: number, moss: number, ground: number,
 *   anchor: number, kind: string}>}
 */
export function buildBoulderSites(heightAt, { trees = [] } = {}) {
    const B = ODYSSEY_BOULDERS;
    const rocks = [];
    const clearOfTrees = (x, z, radius) => !trees.some((t) => Math.hypot(t.x - x, t.z - z) < radius + B.treeClear);
    const track = railTrack();
    const clearOfRail = (x, z) => !track.some((p) => Math.hypot(p.x - x, p.z - z) < B.railClear);
    B.anchors.forEach((anchor, ai) => {
        const r = rng(anchor.seed * 7919);
        const push = (rock) => {
            const radius = Math.max(rock.sx, rock.sz);
            // Drawn either way, so the generator's sequence never depends on which rocks are kept.
            const tone = r();
            const moss = rock.moss ?? (0.3 + (r() * 0.7));
            if (!clearOfTrees(rock.x, rock.z, radius) || !clearOfRail(rock.x, rock.z)) return;
            const seated = seatRock(heightAt, {
                ...rock, tone, moss, anchor: ai, kind: anchor.kind,
            });
            const { flat } = B.shapes[rock.shape];
            const top = seated.y + (flat * rock.sy);
            const tall = flat * rock.sy * 1.42;
            if (top - heightAt(rock.x, rock.z) < tall * B.standsOut) return;
            rocks.push(seated);
        };
        if (anchor.kind === 'field') {
            const F = B.field;
            const w = F.main[0] + (r() * (F.main[1] - F.main[0]));
            push({
                x: anchor.x,
                z: anchor.z,
                sx: w * 0.5,
                sz: w * (0.38 + (r() * 0.14)),
                sy: w * (0.55 + (r() * 0.2)),
                yaw: r() * Math.PI * 2,
                shape: Math.floor(r() * 3),
            });
            const n = F.satellites[0] + Math.floor(r() * (F.satellites[1] - F.satellites[0] + 1));
            for (let k = 0; k < n; k += 1) {
                const th = r() * Math.PI * 2;
                const d = (w * 0.65) + (r() * F.spread);
                const s = w * (0.2 + (r() * 0.3));
                push({
                    x: anchor.x + (Math.cos(th) * d),
                    z: anchor.z + (Math.sin(th) * d),
                    sx: s * 0.5,
                    sz: s * (0.36 + (r() * 0.16)),
                    sy: s * (0.5 + (r() * 0.2)),
                    yaw: r() * Math.PI * 2,
                    shape: Math.floor(r() * 3),
                });
            }
        } else {
            // An outcrop: slabs along the contour (across the fall line), turned to it, tilted
            // out of the slope like a ledge breaking the turf.
            const O = B.outcrop;
            const [gx, gz] = slopeAt(heightAt, anchor.x, anchor.z, 6);
            const fall = Math.atan2(gz, gx);
            const along = fall + (Math.PI / 2);
            const n = O.slabs[0] + Math.floor(r() * (O.slabs[1] - O.slabs[0] + 1));
            for (let k = 0; k < n; k += 1) {
                const t = n === 1 ? 0 : (k / (n - 1)) - 0.5;
                const d = t * O.run * (0.8 + (r() * 0.4));
                const off = (r() - 0.5) * 14;
                const len = O.length[0] + (r() * (O.length[1] - O.length[0])) * (1 - (Math.abs(t) * 0.7));
                push({
                    x: anchor.x + (Math.cos(along) * d) + (Math.cos(fall) * off),
                    z: anchor.z + (Math.sin(along) * d) + (Math.sin(fall) * off),
                    sx: len * 0.5,
                    sz: len * (0.22 + (r() * 0.12)),
                    sy: len * (0.32 + (r() * 0.14)),
                    // Long axis along the contour (the shape's x), with a little scatter.
                    yaw: -along + ((r() - 0.5) * 0.5),
                    shape: 1 + Math.floor(r() * 2),
                    moss: 0.15 + (r() * 0.4),
                });
            }
        }
    });
    return rocks;
}

/** The rail's ground track over Act II, densely sampled (once). */
let railTrackCache = null;
function railTrack() {
    if (!railTrackCache) {
        railTrackCache = Array.from({ length: 1500 }, (_, i) => getOdysseyPathPointAt(0.12 + ((0.6 * i) / 1499)));
    }
    return railTrackCache;
}

/** A rock's instance matrix: scale, then lean and turn, then its place. */
export function boulderMatrix(rock, out = new THREE.Matrix4()) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rock.tiltX, rock.yaw, rock.tiltZ, 'XYZ'));
    return out.compose(
        new THREE.Vector3(rock.x, rock.y, rock.z),
        q,
        new THREE.Vector3(rock.sx, rock.sy, rock.sz),
    );
}
