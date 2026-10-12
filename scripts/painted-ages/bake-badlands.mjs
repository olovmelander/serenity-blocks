#!/usr/bin/env node
/**
 * Painted Ages — bake the badlands.
 *
 *   node scripts/painted-ages/bake-badlands.mjs [--rain=1.4] [--preview=<dir>] [--no-write]
 *                                               [--from-asset] [--quick]
 *
 * Evaluates the plan (src/themes/painted-ages/painted-ages-plan.js) on the three nested field
 * grids, lets rain run down the near and mid fields (droplet erosion; hard beds of the strata
 * column erode less and stand out as ledges), nests each field into the next one out, measures
 * drainage and sky visibility, and writes
 *
 *   src/themes/painted-ages/assets/badlands-{near,mid,far}.png
 *   src/themes/painted-ages/assets/badlands-manifest.json
 *
 * `--preview=<dir>` ray-casts the result from the eye on the CPU (8 worker threads) at a few
 * hours, so shapes and composition can be judged without a GPU. `--from-asset` skips the plan and
 * the rain and previews what is already baked. `--quick` bakes at quarter density (shape checks).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    COLUMN, FIELDS, FIELD_ORDER, buildBeds, bedAt, clamp, mulberry32, strataG,
} from '../../src/themes/painted-ages/painted-ages-core.js';
import {
    earthDrop, planHeight, riverDistance, riverFloor,
} from '../../src/themes/painted-ages/painted-ages-plan.js';
import {
    decodeField, encodeField, fieldInset, postX, postZ,
} from '../../src/themes/painted-ages/painted-ages-field.js';
import { decodePng, encodePng } from './png.mjs';
import { renderPreviews } from './preview.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ASSETS = path.join(ROOT, 'src/themes/painted-ages/assets');
export const BADLANDS_SCHEMA = 1;

function args() {
    const out = {};
    process.argv.slice(2).forEach((arg) => {
        const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
        if (m) out[m[1]] = m[2] ?? true;
    });
    return out;
}

const stamp = () => new Date().toTimeString().slice(0, 8);
const log = (...a) => console.log(`[bake ${stamp()}]`, ...a);

// ── Plan ────────────────────────────────────────────────────────────────────────

function planField(field) {
    const { size } = field;
    const h = new Float32Array(size * size);
    for (let j = 0; j < size; j++) {
        const z = postZ(field, j);
        for (let i = 0; i < size; i++) h[j * size + i] = planHeight(postX(field, i), z);
    }
    return h;
}

// ── Rain ────────────────────────────────────────────────────────────────────────

/**
 * Droplet erosion (Beyer 2015), heights worked in units of the field's range so the per-cell
 * slopes sit in the regime the rates are tuned for. Each step's erosion is scaled by the softness
 * of the bed it cuts (strata column hardness at the point's geological height).
 */
function rain(heights, field, beds, { perCell = 1.4, seed = 20261012, life = 64 } = {}) {
    const { size } = field;
    const unit = field.hi - field.lo;
    const h = new Float32Array(heights.length);
    for (let i = 0; i < h.length; i++) h[i] = (heights[i] - field.lo) / unit;
    const cell = field.span / (size - 1);
    // Hardness by geological height, 0.25 m a slot.
    const HSTEP = 0.25;
    const hardTable = new Float32Array(Math.ceil((COLUMN.gMax - COLUMN.gMin) / HSTEP) + 1);
    for (let k = 0; k < hardTable.length; k++) hardTable[k] = bedAt(beds, COLUMN.gMin + k * HSTEP).hard;
    const softness = (x, y, z) => {
        const g = strataG(x, y, z);
        const k = clamp(Math.round((g - COLUMN.gMin) / HSTEP), 0, hardTable.length - 1);
        return 1 - 0.5 * hardTable[k];
    };
    const rand = mulberry32(seed);
    const INERTIA = 0.06;
    const CAPACITY = 1.1;
    const MIN_CAPACITY = 0.0001;
    const ERODE = 0.09;
    const DEPOSIT = 0.18;
    const EVAPORATE = 0.018;
    const GRAVITY = 4;
    const RADIUS = 2;
    const brush = [];
    let weightSum = 0;
    for (let dy = -RADIUS; dy <= RADIUS; dy++) {
        for (let dx = -RADIUS; dx <= RADIUS; dx++) {
            const d = Math.hypot(dx, dy);
            if (d <= RADIUS) {
                brush.push([dx, dy, 1 - d / (RADIUS + 0.5)]);
                weightSum += 1 - d / (RADIUS + 0.5);
            }
        }
    }
    brush.forEach((b) => { b[2] /= weightSum; });
    const droplets = Math.round(size * size * perCell);
    for (let n = 0; n < droplets; n++) {
        let px = rand() * (size - 3) + 1;
        let py = rand() * (size - 3) + 1;
        let dirX = 0;
        let dirY = 0;
        let speed = 1;
        let water = 1;
        let sediment = 0;
        for (let step = 0; step < life; step++) {
            const nx = Math.floor(px);
            const ny = Math.floor(py);
            const u = px - nx;
            const v = py - ny;
            const o = ny * size + nx;
            const a = h[o];
            const b = h[o + 1];
            const c = h[o + size];
            const d = h[o + size + 1];
            const gx = (b - a) * (1 - v) + (d - c) * v;
            const gy = (c - a) * (1 - u) + (d - b) * u;
            const here = a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
            dirX = dirX * INERTIA - gx * (1 - INERTIA);
            dirY = dirY * INERTIA - gy * (1 - INERTIA);
            const len = Math.hypot(dirX, dirY);
            if (len < 1e-9) break;
            dirX /= len;
            dirY /= len;
            px += dirX;
            py += dirY;
            if (px < 1 || py < 1 || px >= size - 2 || py >= size - 2) break;
            const mx = Math.floor(px);
            const my = Math.floor(py);
            const mu = px - mx;
            const mv = py - my;
            const mo = my * size + mx;
            const there = h[mo] * (1 - mu) * (1 - mv) + h[mo + 1] * mu * (1 - mv)
                + h[mo + size] * (1 - mu) * mv + h[mo + size + 1] * mu * mv;
            const dh = there - here;
            const capacity = Math.max(-dh * speed * water * CAPACITY, MIN_CAPACITY);
            if (sediment > capacity || dh > 0) {
                const drop = dh > 0 ? Math.min(dh, sediment) : (sediment - capacity) * DEPOSIT;
                sediment -= drop;
                h[o] += drop * (1 - u) * (1 - v);
                h[o + 1] += drop * u * (1 - v);
                h[o + size] += drop * (1 - u) * v;
                h[o + size + 1] += drop * u * v;
            } else {
                const soft = softness(field.x0 + nx * cell, field.lo + here * unit, field.z0 + ny * cell);
                const take = Math.min((capacity - sediment) * ERODE * soft, -dh);
                for (let k = 0; k < brush.length; k++) {
                    const bx = nx + brush[k][0];
                    const by = ny + brush[k][1];
                    if (bx < 0 || by < 0 || bx >= size || by >= size) continue;
                    const amount = take * brush[k][2];
                    h[by * size + bx] -= amount;
                    sediment += amount;
                }
            }
            speed = Math.sqrt(Math.max(0, speed * speed - dh * GRAVITY));
            water *= 1 - EVAPORATE;
        }
    }
    let moved = 0;
    let deepest = 0;
    for (let i = 0; i < h.length; i++) {
        const next = h[i] * unit + field.lo;
        const delta = next - heights[i];
        moved += Math.abs(delta);
        if (-delta > deepest) deepest = -delta;
        heights[i] = next;
    }
    return { droplets, meanChange: moved / h.length, deepestCut: deepest };
}

/**
 * Let the slopes settle: wherever a post stands more than the talus angle above a neighbour,
 * material slides down (half the excess per pass). Rounds the needles the rain leaves.
 */
function settle(heights, field, { talus = 1.0, passes = 12 } = {}) {
    const { size } = field;
    const cell = field.span / (size - 1);
    const limit = talus * cell;
    const diag = limit * Math.SQRT2;
    const DX = [1, 0, 1, -1];
    const DY = [0, 1, 1, 1];
    const LIM = [limit, limit, diag, diag];
    for (let pass = 0; pass < passes; pass++) {
        for (let y = 0; y < size - 1; y++) {
            for (let x = 1; x < size - 1; x++) {
                const o = y * size + x;
                for (let k = 0; k < 4; k++) {
                    const p = (y + DY[k]) * size + x + DX[k];
                    const d = heights[o] - heights[p];
                    const excess = Math.abs(d) - LIM[k];
                    if (excess > 0) {
                        const move = excess * 0.25 * Math.sign(d);
                        heights[o] -= move;
                        heights[p] += move;
                    }
                }
            }
        }
    }
}

/** A light 3 × 3 blur, `passes` times: the comb of one-post gullies goes, the real ones stay. */
function soften(heights, field, passes = 1) {
    const { size } = field;
    const tmp = new Float32Array(heights.length);
    for (let pass = 0; pass < passes; pass++) {
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                let sum = 0;
                let w = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const a = Math.min(size - 1, Math.max(0, x + dx));
                        const b = Math.min(size - 1, Math.max(0, y + dy));
                        const k = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
                        sum += heights[b * size + a] * k;
                        w += k;
                    }
                }
                tmp[y * size + x] = sum / w;
            }
        }
        heights.set(tmp);
    }
}

/**
 * The river's bed: inside the valley floor the land may not stand above the planned floor (plus
 * low gravel bars), and a channel a metre deep runs down the thalweg. Sediment the rain dropped
 * on the floor is washed away, as a river would.
 */
function carveRiver(heights, field) {
    const { size } = field;
    const out = { d: 0, along: 0, z: 0 };
    for (let j = 0; j < size; j++) {
        const z = postZ(field, j);
        for (let i = 0; i < size; i++) {
            const x = postX(field, i);
            const r = riverDistance(x, z, out);
            const half = 34 + 22 * clamp((-200 - z) / 2200, 0, 1);
            if (r.d > half + 90) continue;
            const floor = riverFloor(r.z);
            const bars = 0.9 * Math.max(0, Math.sin(x * 0.05 + z * 0.031)) * clamp(r.d / 8, 0, 1);
            const channel = -1.1 * Math.exp(-((r.d / 5) ** 2));
            const bed = floor + 0.35 + bars + channel;
            const k = clamp((r.d - half) / 90, 0, 1);
            const w = 1 - k * k * (3 - 2 * k);
            const o = j * size + i;
            const target = Math.min(heights[o], bed + (heights[o] - bed) * (1 - w));
            heights[o] = target;
        }
    }
}

/** Keep the plan where things stand on it: the eye's platform and the pavilion's terrace. */
function keepPlanned(heights, plan, field, spots) {
    const { size } = field;
    for (let j = 0; j < size; j++) {
        const z = postZ(field, j);
        for (let i = 0; i < size; i++) {
            const x = postX(field, i);
            let w = 0;
            for (const s of spots) {
                const k = clamp(1 - (Math.hypot(x - s.x, z - s.z) - s.r) / s.feather, 0, 1);
                w = Math.max(w, k * k * (3 - 2 * k));
            }
            if (w > 0) {
                const o = j * size + i;
                heights[o] += (plan[o] - heights[o]) * w;
            }
        }
    }
}

/**
 * Write a finer field into the next one out where it covers it (area-averaged), feathered over
 * the inner field's outer band: one surface, whichever field a point is read from.
 */
function nest(inner, innerField, outer, outerField, feather) {
    const { size } = outerField;
    const k = (innerField.size - 1) / innerField.span;
    const radius = Math.max(0, Math.floor((outerField.span / (outerField.size - 1)) * k * 0.5));
    for (let j = 0; j < size; j++) {
        const z = postZ(outerField, j);
        for (let i = 0; i < size; i++) {
            const x = postX(outerField, i);
            const inset = fieldInset(innerField, x, z);
            if (inset <= 0) continue;
            const fi = Math.round((x - innerField.x0) * k);
            const fj = Math.round((z - innerField.z0) * k);
            let sum = 0;
            let count = 0;
            for (let dj = -radius; dj <= radius; dj++) {
                for (let di = -radius; di <= radius; di++) {
                    const a = clamp(fi + di, 0, innerField.size - 1);
                    const b = clamp(fj + dj, 0, innerField.size - 1);
                    sum += inner[b * innerField.size + a];
                    count++;
                }
            }
            const w = clamp(inset / feather, 0, 1);
            const o = j * size + i;
            outer[o] += (sum / count - outer[o]) * w * w * (3 - 2 * w);
        }
    }
}

// ── Drainage and sky ────────────────────────────────────────────────────────────

/** D8 drainage: each post hands its area to its steepest downhill neighbour. Returns log-scaled 0..1. */
function drainage(heights, field) {
    const { size } = field;
    const n = size * size;
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => heights[b] - heights[a]);
    const area = new Float32Array(n).fill(1);
    const cell = field.span / (size - 1);
    const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
    const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
    const DL = DX.map((dx, k) => Math.hypot(dx, DY[k]) * cell);
    for (let q = 0; q < n; q++) {
        const o = order[q];
        const x = o % size;
        const y = (o - x) / size;
        let best = -1;
        let slope = 0;
        for (let k = 0; k < 8; k++) {
            const a = x + DX[k];
            const b = y + DY[k];
            if (a < 0 || b < 0 || a >= size || b >= size) continue;
            const s = (heights[o] - heights[b * size + a]) / DL[k];
            if (s > slope) {
                slope = s;
                best = b * size + a;
            }
        }
        if (best >= 0) area[best] += area[o];
    }
    const out = new Float32Array(n);
    const top = Math.log(n);
    for (let i = 0; i < n; i++) out[i] = clamp(Math.log(area[i]) / top, 0, 1);
    return out;
}

function skyVisibility(heights, field) {
    const { size } = field;
    const cell = field.span / (size - 1);
    const out = new Float32Array(size * size);
    const steps = [1, 2, 3, 5, 8, 12, 18, 27, 40, 60, 90];
    const dirs = [];
    for (let k = 0; k < 8; k++) dirs.push([Math.cos((k / 8) * Math.PI * 2 + 0.3), Math.sin((k / 8) * Math.PI * 2 + 0.3)]);
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            const h = heights[j * size + i];
            let blocked = 0;
            for (let k = 0; k < 8; k++) {
                let top = 0;
                for (let s = 0; s < steps.length; s++) {
                    const a = Math.round(i + dirs[k][0] * steps[s]);
                    const b = Math.round(j + dirs[k][1] * steps[s]);
                    if (a < 0 || b < 0 || a >= size || b >= size) break;
                    const t = ((heights[b * size + a] - h) / (steps[s] * cell)) * (s < 7 ? 1 : 0.75);
                    if (t > top) top = t;
                }
                blocked += top / Math.sqrt(1 + top * top);
            }
            out[j * size + i] = 1 - blocked / 8;
        }
    }
    return out;
}

function dropEarth(heights, field) {
    const { size } = field;
    for (let j = 0; j < size; j++) {
        const z = postZ(field, j);
        for (let i = 0; i < size; i++) heights[j * size + i] -= earthDrop(postX(field, i), z);
    }
}

function range(heights) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < heights.length; i++) {
        if (heights[i] < lo) lo = heights[i];
        if (heights[i] > hi) hi = heights[i];
    }
    return [lo, hi];
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
    const opts = args();
    const started = Date.now();
    const beds = buildBeds();
    const fields = {};
    if (opts['from-asset']) {
        for (const name of FIELD_ORDER) {
            const { width, rgba } = decodePng(fs.readFileSync(path.join(ASSETS, `badlands-${name}.png`)));
            if (width !== FIELDS[name].size) throw new Error(`${name} is ${width} wide`);
            fields[name] = decodeField(rgba, FIELDS[name]);
        }
        log('read the baked fields');
    } else {
        const perCell = Number(opts.rain ?? 1.4) * (opts.quick ? 0.25 : 1);
        const plans = {};
        for (const name of FIELD_ORDER) {
            plans[name] = planField(FIELDS[name]);
            log(`plan ${name}: range ${range(plans[name]).map((v) => v.toFixed(0)).join('..')} m`);
        }
        const heights = {};
        for (const name of FIELD_ORDER) heights[name] = plans[name].slice();
        const spots = [
            {
                x: 0, z: 0, r: 22, feather: 40,
            },
            {
                x: -150, z: -360, r: 14, feather: 18,
            },
        ];
        for (const name of ['mid', 'near']) {
            const r = rain(heights[name], FIELDS[name], beds, { perCell: perCell * (name === 'near' ? 3 : 1.2), seed: name === 'near' ? 20261012 : 20261013, life: name === 'near' ? 90 : 70 });
            log(`rain ${name}: ${r.droplets} droplets, mean change ${r.meanChange.toFixed(2)} m, deepest cut ${r.deepestCut.toFixed(1)} m`);
        }
        settle(heights.near, FIELDS.near, { talus: 0.95, passes: 10 });
        soften(heights.near, FIELDS.near, 2);
        settle(heights.mid, FIELDS.mid, { talus: 0.9, passes: 6 });
        soften(heights.mid, FIELDS.mid, 1);
        carveRiver(heights.near, FIELDS.near);
        carveRiver(heights.mid, FIELDS.mid);
        keepPlanned(heights.near, plans.near, FIELDS.near, spots);
        nest(heights.near, FIELDS.near, heights.mid, FIELDS.mid, 160);
        nest(heights.mid, FIELDS.mid, heights.far, FIELDS.far, 700);
        for (const name of FIELD_ORDER) dropEarth(heights[name], FIELDS[name]);
        for (const name of FIELD_ORDER) {
            const field = FIELDS[name];
            const [lo, hi] = range(heights[name]);
            if (lo < field.lo || hi > field.hi) log(`WARNING ${name} heights ${lo.toFixed(0)}..${hi.toFixed(0)} exceed ${field.lo}..${field.hi}`);
            const sky = skyVisibility(heights[name], field);
            const flow = drainage(heights[name], field);
            const rgba = encodeField(heights[name], sky, flow, field);
            fields[name] = decodeField(rgba, field);
            if (!opts['no-write']) {
                fs.mkdirSync(ASSETS, { recursive: true });
                fs.writeFileSync(path.join(ASSETS, `badlands-${name}.png`), encodePng(rgba, field.size, field.size));
            }
            log(`${name}: ${lo.toFixed(0)}..${hi.toFixed(0)} m${opts['no-write'] ? ' (not written)' : ' written'}`);
        }
        if (!opts['no-write']) {
            const manifest = {
                schema: BADLANDS_SCHEMA,
                fields: Object.fromEntries(FIELD_ORDER.map((name) => {
                    const bytes = fs.readFileSync(path.join(ASSETS, `badlands-${name}.png`));
                    return [name, {
                        size: FIELDS[name].size,
                        bytes: bytes.length,
                        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
                    }];
                })),
                rain: perCell,
            };
            fs.writeFileSync(path.join(ASSETS, 'badlands-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
        }
    }
    if (opts.preview) {
        const dir = path.resolve(process.cwd(), String(opts.preview));
        fs.mkdirSync(dir, { recursive: true });
        const hours = String(opts.hours ?? 'golden').split(',');
        await renderPreviews(fields, beds, dir, {
            hours, width: Number(opts.width ?? 960), height: Number(opts.height ?? 540), tag: opts.tag ?? '',
        });
        log(`previews in ${dir}`);
    }
    log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
