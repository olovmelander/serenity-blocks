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
 * Plain arithmetic on the CPU: no pass, no pipeline, one fetch where it is read.
 */

export const CLOUD_SHADOWS = Object.freeze({
    x: -140,
    z: -700,
    extent: 9000,
    res: 192,
    /** The height the picture is of: the meadows'. */
    level: ODYSSEY_SEA_LEVEL + 30,
    /** Seconds between two redraws. */
    every: 0.12,
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
    let sculpted = false;
    let drawnAt = -Infinity;
    const cell = C.extent / C.res;
    const x0 = C.x - (C.extent / 2);
    const z0 = C.z - (C.extent / 2);

    const printOf = (shape, turn) => {
        const key = (shape * C.turns) + turn;
        if (!prints.has(key)) prints.set(key, cloudFootprint(shape, turn, field()));
        return prints.get(key);
    };
    const read = (print, u, v) => {
        if (u < 0 || v < 0 || u > C.along - 1 || v > C.across - 1) return 0;
        const i = Math.min(C.along - 2, Math.floor(u));
        const j = Math.min(C.across - 2, Math.floor(v));
        const p = u - i;
        const q = v - j;
        const k = (j * C.along) + i;
        return (((print[k] * (1 - p)) + (print[k + 1] * p)) * (1 - q)) + (((print[k + C.along] * (1 - p)) + (print[k + C.along + 1] * p)) * q);
    };

    /** Lay one cloud's shadow. */
    const stamp = (s) => {
        const b = footprintBounds(s.shape);
        const turns = ((s.yaw / (Math.PI * 2)) * C.turns) % C.turns;
        const at = (turns + C.turns) % C.turns;
        const t0 = Math.floor(at) % C.turns;
        const f = at - Math.floor(at);
        const A = printOf(s.shape, t0);
        const B = printOf(s.shape, (t0 + 1) % C.turns);
        const keep = s.cover * Math.max(0, 1 - s.eaten) ** 1.2;
        if (keep < 0.02) return;
        // Its foot's own shadow on the picture's level; taller clouds throw further.
        const drop = Math.max(0, s.y - C.level) * COT;
        const fx = s.x + (AWAY[0] * drop);
        const fz = s.z + (AWAY[1] * drop);
        const from = b.from * s.w;
        const to = b.from * s.w + ((b.to - b.from) * s.w * (0.5 + (0.5 * s.tall)));
        const half = b.half * s.w;
        const reach = Math.max(Math.abs(from), to) + half;
        const i0 = Math.max(0, Math.floor((fx - reach - x0) / cell));
        const i1 = Math.min(C.res - 1, Math.ceil((fx + reach - x0) / cell));
        const j0 = Math.max(0, Math.floor((fz - reach - z0) / cell));
        const j1 = Math.min(C.res - 1, Math.ceil((fz + reach - z0) / cell));
        for (let j = j0; j <= j1; j += 1) {
            const dz = (z0 + ((j + 0.5) * cell)) - fz;
            for (let i = i0; i <= i1; i += 1) {
                const dx = (x0 + ((i + 0.5) * cell)) - fx;
                const a = (dx * AWAY[0]) + (dz * AWAY[1]);
                const c = (dz * AWAY[0]) - (dx * AWAY[1]);
                if (a < from || a > to || c < -half || c > half) continue;
                const u = (((a - from) / (to - from)) * C.along) - 0.5;
                const v = (((c / half) * 0.5) + 0.5) * C.across - 0.5;
                const d = (read(A, u, v) * (1 - f)) + (read(B, u, v) * f);
                if (d > 0.004) light[(j * C.res) + i] *= 1 - (d * keep);
            }
        }
    };

    return {
        tex,
        data,
        /**
         * @param {Array<object>} states the sky's clouds this frame
         * @param {number} time seconds
         */
        update(states, time) {
            if (Math.abs(time - drawnAt) < C.every) return false;
            drawnAt = time;
            if (!sculpted && field()) {
                // The shapes have landed: what stood in for them goes.
                sculpted = true;
                prints.clear();
            }
            light.fill(1);
            for (let k = 0; k < states.length; k += 1) if (THROWS.has(states[k].role)) stamp(states[k]);
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
