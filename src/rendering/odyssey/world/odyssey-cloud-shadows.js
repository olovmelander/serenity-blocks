import * as THREE from 'three/webgpu';
import {
    float, smoothstep, texture, vec2,
} from 'three/tsl';
import { ODYSSEY_WORLD_SUN } from '../chapter-environments/shared/chapter-profile.js';
import { ODYSSEY_SEA_LEVEL } from './odyssey-world-height.js';
import { CLOUD_SHAPES, CLOUD_VOLUMES } from './odyssey-cloud-data.js';

/**
 * THE CLOUDS' SHADOWS (2026-11-24): the shadows on the land and the sea are the sky's own clouds', each where its
 * cloud stands, its own outline drawn out along the low sun, growing and thinning as the cloud does.
 *
 * A small picture of the light over the journey's ground (one byte a cell), redrawn a few times a second: every
 * cloud that throws a shadow stamps its FOOTPRINT, the shadow of its sculpted shape on the level of its own foot,
 * worked out once for each shape and facing from the shape's distance field. The clouds move a few units a second
 * and a cell is far larger, so a stamp is laid between cells and the shadows slide, they never step.
 *
 * Plain arithmetic on the CPU: no pass, no pipeline, one fetch where it is read. A redraw is laid a few clouds a frame,
 * so no frame carries all of it.
 */

export const CLOUD_SHADOWS = Object.freeze({
    x: -140,
    z: -700,
    extent: 9000,
    res: 192,
    /** The height the picture is of: the meadows'. */
    level: ODYSSEY_SEA_LEVEL + 30,
    /** Seconds between two redraws, and the cells one frame lays of it before it leaves the rest to the next. */
    every: 0.12,
    slice: 6000,
    /** Further apart in time than this (a jump, the first frame), and the whole picture is drawn at once. */
    jump: 1,
    /** A footprint: cells along the shadow and across it, how many facings it is kept for, samples toward the sun. */
    along: 40,
    across: 20,
    turns: 24,
    steps: 14,
    /** How much light the thickest cloud takes (the world scales it again), and how fast it takes it. */
    thick: 9,
});

const LEN = Math.hypot(...ODYSSEY_WORLD_SUN);
const SUN = Object.freeze(ODYSSEY_WORLD_SUN.map((v) => v / LEN));
const FLAT = Math.hypot(SUN[0], SUN[2]);
/** The way a shadow falls (unit x, z), and how far for each unit of height. */
const AWAY = Object.freeze([-SUN[0] / FLAT, -SUN[2] / FLAT]);
const COT = FLAT / SUN[1];

/** Who throws one: the wall stands beyond the picture, the floor lies under the light, the cap is small. */
const THROWS = new Set(['fair', 'giant']);

/** The reach of a shape's footprint in its own widths: [from, to] along the shadow, half across. */
export function footprintBounds(shape) {
    const s = CLOUD_SHAPES[shape];
    const half = Math.hypot(s.box[0], s.box[2]) * 0.5;
    return { from: -half, to: half + (s.box[1] * s.hi[1] * COT), half };
}

/**
 * The light a shape takes, for one facing: `along` x `across` values 0..1.
 * @param {number} shape
 * @param {number} turn 0..turns-1
 * @param {Uint8Array|null} sdf the stacked distance field, or null (an ellipse, until it lands)
 */
export function cloudFootprint(shape, turn, sdf) {
    const C = CLOUD_SHADOWS;
    const s = CLOUD_SHAPES[shape];
    const b = footprintBounds(shape);
    const out = new Float32Array(C.along * C.across);
    const yaw = (turn / C.turns) * Math.PI * 2;
    const c = Math.cos(yaw);
    const n = Math.sin(yaw);
    const [nx, ny, nz] = CLOUD_VOLUMES.sdf;
    const total = ny * CLOUD_SHAPES.length;
    const top = s.box[1] * s.hi[1];
    for (let j = 0; j < C.across; j += 1) {
        const t = (((j + 0.5) / C.across) - 0.5) * 2 * b.half;
        for (let i = 0; i < C.along; i += 1) {
            const a = b.from + (((i + 0.5) / C.along) * (b.to - b.from));
            // The ground place, then up toward the sun through the cloud.
            let depth = 0;
            for (let k = 0; k < C.steps; k += 1) {
                const h = ((k + 0.5) / C.steps) * top;
                const back = a - (h * COT);
                const wx = (AWAY[0] * back) - (AWAY[1] * t);
                const wz = (AWAY[1] * back) + (AWAY[0] * t);
                // Into the shape's own facing (as the tracer turns a world place).
                const lx = ((wx * c) - (wz * n)) / s.box[0] + 0.5;
                const lz = ((wz * c) + (wx * n)) / s.box[2] + 0.5;
                if (lx < 0 || lx >= 1 || lz < 0 || lz >= 1) continue;
                let inside;
                if (sdf) {
                    const x = Math.floor(lx * nx);
                    const y = Math.min(ny - 1, Math.floor((h / s.box[1]) * ny));
                    const z = Math.floor(lz * nz);
                    inside = sdf[(((z * total) + (shape * ny) + y) * nx) + x] < 128;
                } else {
                    inside = Math.hypot((lx - 0.5) * 2.4, (lz - 0.5) * 2.4, ((h / top) * 2) - 1) < 1;
                }
                if (inside) depth += 1 / C.steps;
            }
            out[(j * C.along) + i] = 1 - Math.exp(-depth * C.thick);
        }
    }
    return out;
}

/**
 * @param {object} [opts]
 * @param {() => (Uint8Array|null)} [opts.field] the stacked distance field once it has landed
 */
export function createCloudShadows({ field = () => null } = {}) {
    const C = CLOUD_SHADOWS;
    const data = new Uint8Array(C.res * C.res);
    const light = new Float32Array(C.res * C.res);
    const tex = new THREE.DataTexture(data, C.res, C.res, THREE.RedFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    const prints = new Map();
    // The footprint of the cloud being laid: its two nearest facings, blended.
    const print = new Float32Array(C.along * C.across);
    let sculpted = false;
    let drawnAt = -Infinity;
    let begunAt = -Infinity;
    // The next cloud of the redraw under way, or -1.
    let next = -1;
    let spent = 0;
    const cell = C.extent / C.res;
    const x0 = C.x - (C.extent / 2);
    const z0 = C.z - (C.extent / 2);

    const printOf = (shape, turn) => {
        const key = (shape * C.turns) + turn;
        if (!prints.has(key)) prints.set(key, cloudFootprint(shape, turn, field()));
        return prints.get(key);
    };
    /** Lay one cloud's shadow. */
    const stamp = (s) => {
        const keep = s.cover * Math.max(0, 1 - s.eaten) ** 1.2;
        if (keep < 0.02) return;
        const b = footprintBounds(s.shape);
        // Its foot's own shadow on the picture's level; taller clouds throw further.
        const drop = Math.max(0, s.y - C.level) * COT;
        const fx = s.x + (AWAY[0] * drop);
        const fz = s.z + (AWAY[1] * drop);
        const from = b.from * s.w;
        const long = (b.to - b.from) * s.w * (0.5 + (0.5 * s.tall));
        const half = b.half * s.w;
        // The rows its rectangle reaches (from..from + long along AWAY, -half..half across it).
        const mid = fz + (AWAY[1] * (from + (long / 2)));
        const span = (Math.abs(AWAY[1]) * (long / 2)) + (Math.abs(AWAY[0]) * half);
        const j0 = Math.max(0, Math.ceil(((mid - span - z0) / cell) - 0.5));
        const j1 = Math.min(C.res - 1, Math.floor(((mid + span - z0) / cell) - 0.5));
        const midX = fx + (AWAY[0] * (from + (long / 2)));
        const spanX = (Math.abs(AWAY[0]) * (long / 2)) + (Math.abs(AWAY[1]) * half);
        if (j1 < j0 || midX + spanX < x0 || midX - spanX > x0 + C.extent) return;

        const turns = ((s.yaw / (Math.PI * 2)) * C.turns) % C.turns;
        const at = (turns + C.turns) % C.turns;
        const t0 = Math.floor(at) % C.turns;
        const f = at - Math.floor(at);
        const A = printOf(s.shape, t0);
        const B = printOf(s.shape, (t0 + 1) % C.turns);
        for (let k = 0; k < print.length; k += 1) print[k] = ((A[k] * (1 - f)) + (B[k] * f)) * keep;

        const perAlong = C.along / long;
        const perAcross = (C.across * 0.5) / half;
        const left = x0 + (0.5 * cell) - fx;
        // One cell east, in the footprint's cells.
        const du = AWAY[0] * cell * perAlong;
        const dv = -AWAY[1] * cell * perAcross;
        for (let j = j0; j <= j1; j += 1) {
            const dz = (z0 + ((j + 0.5) * cell)) - fz;
            // The row's first cell in the footprint, and the cells of the row that lie inside it.
            const u0 = ((((left * AWAY[0]) + (dz * AWAY[1])) - from) * perAlong) - 0.5;
            const v0 = (((dz * AWAY[0]) - (left * AWAY[1])) * perAcross) + (C.across * 0.5) - 0.5;
            const ua = -u0 / du;
            const ub = ((C.along - 1) - u0) / du;
            const va = -v0 / dv;
            const vb = ((C.across - 1) - v0) / dv;
            const i0 = Math.max(0, Math.ceil(Math.max(Math.min(ua, ub), Math.min(va, vb))));
            const i1 = Math.min(C.res - 1, Math.floor(Math.min(Math.max(ua, ub), Math.max(va, vb))));
            if (i1 < i0) continue;
            spent += (i1 - i0) + 1;
            const row = j * C.res;
            for (let i = i0; i <= i1; i += 1) {
                const u = u0 + (du * i);
                const v = v0 + (dv * i);
                const pu = Math.max(0, Math.min(C.along - 2, Math.floor(u)));
                const pv = Math.max(0, Math.min(C.across - 2, Math.floor(v)));
                const p = u - pu;
                const q = v - pv;
                const k = (pv * C.along) + pu;
                const d = (((print[k] * (1 - p)) + (print[k + 1] * p)) * (1 - q))
                    + (((print[k + C.along] * (1 - p)) + (print[k + C.along + 1] * p)) * q);
                light[row + i] *= 1 - d;
            }
        }
    };

    return {
        tex,
        data,
        /** The cells the last update laid. */
        get spent() { return spent; },
        /**
         * @param {Array<object>} states the sky's clouds this frame
         * @param {number} time seconds
         * @returns {boolean} whether the picture is a new one
         */
        update(states, time) {
            spent = 0;
            const whole = Math.abs(time - drawnAt) > C.jump;
            if (whole || (next < 0 && Math.abs(time - begunAt) >= C.every)) {
                begunAt = time;
                next = 0;
                light.fill(1);
                if (!sculpted && field()) {
                    // The shapes have landed: what stood in for them goes.
                    sculpted = true;
                    prints.clear();
                }
            }
            if (next < 0) return false;
            while (next < states.length && (whole || spent < C.slice)) {
                if (THROWS.has(states[next].role)) stamp(states[next]);
                next += 1;
            }
            if (next < states.length) return false;
            next = -1;
            drawnAt = time;
            for (let k = 0; k < data.length; k += 1) data[k] = Math.round((1 - light[k]) * 255);
            tex.needsUpdate = true;
            return true;
        },
        /** The share of the sun the clouds take at world `place` (0 open .. 1), for any stage. */
        at: (place) => {
            const cloudUv = place.sub(vec2(C.x, C.z)).div(C.extent).add(0.5).toVar();
            const rim = cloudUv.sub(0.5).abs();
            return texture(tex, cloudUv).level(0).r.mul(
                float(1).sub(smoothstep(float(0.42), float(0.495), rim.x.max(rim.y))),
            );
        },
        dispose() { tex.dispose(); },
    };
}
