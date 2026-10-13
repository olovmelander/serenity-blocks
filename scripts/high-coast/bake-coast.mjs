#!/usr/bin/env node
/**
 * High Coast — bake the coast.
 *
 *   node scripts/high-coast/bake-coast.mjs [--preview=<dir>] [--hours=golden,morning] [--no-write]
 *                                          [--from-asset] [--quick]
 *
 * Evaluates the plan (src/themes/high-coast/high-coast-plan.js) on the three nested field grids,
 * cuts the granite's joints into the bare rock near the eye, steps the shingle fields into beach
 * ridges, lets the steep faces settle a little, nests each field into the next one out, measures
 * sky visibility and the forest cover, and writes
 *
 *   src/themes/high-coast/assets/coast-{near,mid,far}.png
 *   src/themes/high-coast/assets/coast-manifest.json
 *
 * `--preview=<dir>` ray-casts the result from the eye on the CPU (8 worker threads) so shapes and
 * composition can be judged without a GPU. `--from-asset` previews what is already baked.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    FIELDS, FIELD_ORDER, clamp, mulberry32,
} from '../../src/themes/high-coast/high-coast-core.js';
import {
    earthDrop, fbm, planCover, planHeight, shingleMask, shingleRelief, simplex,
} from '../../src/themes/high-coast/high-coast-plan.js';
import {
    decodeField, encodeField, fieldInset, postX, postZ,
} from '../../src/themes/high-coast/high-coast-field.js';
import { decodePng, encodePng } from './png.mjs';
import { renderPreviews } from './preview.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ASSETS = path.join(ROOT, 'src/themes/high-coast/assets');
export const COAST_SCHEMA = 1;

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

function planField(field) {
    const { size } = field;
    const h = new Float32Array(size * size);
    for (let j = 0; j < size; j++) {
        const z = postZ(field, j);
        for (let i = 0; i < size; i++) h[j * size + i] = planHeight(postX(field, i), z);
    }
    return h;
}

// ── Granite ─────────────────────────────────────────────────────────────────────

/**
 * Joints: rapakivi granite splits along two near-vertical sets and a sheeting set parallel to
 * the surface. On bare rock above the sea the two vertical sets are cut as narrow grooves (a
 * metre or two deep, wider where weathered), and on the steep faces as stepped ledges, so the
 * cliff reads as blocks and the slabs as a cracked pavement.
 */
function joints(heights, field, { depth = 1.6 } = {}) {
    const { size } = field;
    const cell = field.span / (size - 1);
    const sets = [
        { a: 0.42, spacing: 23, width: 1.6 },
        { a: 0.42 + Math.PI / 2 + 0.18, spacing: 31, width: 1.9 },
    ];
    const out = heights.slice();
    for (let j = 1; j < size - 1; j++) {
        const z = postZ(field, j);
        for (let i = 1; i < size - 1; i++) {
            const o = j * size + i;
            const h = heights[o];
            if (h < 1.5) continue;
            const x = postX(field, i);
            const gx = (heights[o + 1] - heights[o - 1]) / (2 * cell);
            const gz = (heights[o + size] - heights[o - size]) / (2 * cell);
            const slope = Math.hypot(gx, gz);
            let cut = 0;
            for (const s of sets) {
                const u = (x * Math.cos(s.a) + z * Math.sin(s.a)) / s.spacing + 0.35 * fbm(x / 90, z / 90, 2);
                const f = Math.abs(u - Math.round(u)) * s.spacing;
                const w = s.width * (0.7 + 0.6 * (0.5 + 0.5 * simplex(x / 40 + s.a, z / 40)));
                cut = Math.max(cut, Math.exp(-((f / w) ** 2)));
            }
            // Steep faces step back at each joint (ledges); slabs carry grooves.
            const steep = clamp((slope - 0.8) / 1.2, 0, 1);
            out[o] = h - cut * depth * (1 - steep) - cut * depth * 2.4 * steep;
        }
    }
    heights.set(out);
}

/** The shingle fields: beach ridges stepped into the slope where the plan's mask says. */
function shingle(heights, field) {
    const { size } = field;
    for (let j = 0; j < size; j++) {
        const z = postZ(field, j);
        for (let i = 0; i < size; i++) {
            const o = j * size + i;
            const x = postX(field, i);
            const m = shingleMask(x, z, heights[o]);
            if (m > 0) heights[o] += m * shingleRelief(x, z, heights[o]);
        }
    }
}

/**
 * Let the slopes settle where they are steeper than the rock holds (the near field only lightly:
 * the cliff must stay a cliff). Material slides from a post to a lower neighbour.
 */
function settle(heights, field, { talus = 2.6, passes = 4 } = {}) {
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

/** A light 3 × 3 blur, `passes` times. */
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

/** Keep the plan where things stand on it: the summit under the eye, the knoll, the hamlet's yard. */
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

/** Write a finer field into the next one out where it covers it (area-averaged), feathered. */
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

// ── Sky and cover ───────────────────────────────────────────────────────────────

function skyVisibility(heights, field) {
    const { size } = field;
    const cell = field.span / (size - 1);
    const out = new Float32Array(size * size);
    const steps = [1, 2, 3, 5, 8, 12, 18, 27, 40, 60, 90];
    const dirs = [];
    for (let k = 0; k < 8; k++) dirs.push([Math.cos((k / 8) * Math.PI * 2 + 0.3), Math.sin((k / 8) * Math.PI * 2 + 0.3)]);
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            const h = Math.max(heights[j * size + i], 0);
            let blocked = 0;
            for (let k = 0; k < 8; k++) {
                let top = 0;
                for (let s = 0; s < steps.length; s++) {
                    const a = Math.round(i + dirs[k][0] * steps[s]);
                    const b = Math.round(j + dirs[k][1] * steps[s]);
                    if (a < 0 || b < 0 || a >= size || b >= size) break;
                    const t = ((Math.max(heights[b * size + a], 0) - h) / (steps[s] * cell)) * (s < 7 ? 1 : 0.75);
                    if (t > top) top = t;
                }
                blocked += top / Math.sqrt(1 + top * top);
            }
            out[j * size + i] = 1 - blocked / 8;
        }
    }
    return out;
}

/** Forest density from the final heights (the plan's rules on the real slopes), lightly blurred. */
function coverField(heights, field) {
    const { size } = field;
    const cell = field.span / (size - 1);
    const out = new Float32Array(size * size);
    const c = { forest: 0, heath: 0 };
    for (let j = 0; j < size; j++) {
        const z = postZ(field, j);
        for (let i = 0; i < size; i++) {
            const o = j * size + i;
            const a = Math.max(0, i - 1);
            const b = Math.min(size - 1, i + 1);
            const d = Math.max(0, j - 1);
            const e = Math.min(size - 1, j + 1);
            const gx = (heights[j * size + b] - heights[j * size + a]) / ((b - a) * cell);
            const gz = (heights[e * size + i] - heights[d * size + i]) / ((e - d) * cell);
            planCover(postX(field, i), z, heights[o], Math.hypot(gx, gz), c);
            out[o] = c.forest;
        }
    }
    soften(out, field, 1);
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
    const fields = {};
    if (opts['from-asset']) {
        for (const name of FIELD_ORDER) {
            const { width, rgba } = decodePng(fs.readFileSync(path.join(ASSETS, `coast-${name}.png`)));
            if (width !== FIELDS[name].size) throw new Error(`${name} is ${width} wide`);
            fields[name] = decodeField(rgba, FIELDS[name]);
        }
        log('read the baked fields');
    } else {
        const plans = {};
        for (const name of FIELD_ORDER) {
            plans[name] = planField(FIELDS[name]);
            log(`plan ${name}: range ${range(plans[name]).map((v) => v.toFixed(0)).join('..')} m`);
        }
        const heights = {};
        for (const name of FIELD_ORDER) heights[name] = plans[name].slice();
        joints(heights.near, FIELDS.near, { depth: 1.5 });
        joints(heights.mid, FIELDS.mid, { depth: 2.2 });
        shingle(heights.near, FIELDS.near);
        settle(heights.near, FIELDS.near, { talus: 3.2, passes: 3 });
        soften(heights.near, FIELDS.near, 1);
        soften(heights.mid, FIELDS.mid, 1);
        const spots = [
            {
                x: 0, z: 0, r: 9, feather: 14,
            },
            {
                x: -8.5, z: -19, r: 4, feather: 6,
            },
            {
                x: 178, z: -512, r: 38, feather: 20,
            },
        ];
        keepPlanned(heights.near, plans.near, FIELDS.near, spots);
        nest(heights.near, FIELDS.near, heights.mid, FIELDS.mid, 180);
        nest(heights.mid, FIELDS.mid, heights.far, FIELDS.far, 800);
        const covers = {};
        for (const name of FIELD_ORDER) covers[name] = coverField(heights[name], FIELDS[name]);
        for (const name of FIELD_ORDER) dropEarth(heights[name], FIELDS[name]);
        for (const name of FIELD_ORDER) {
            const field = FIELDS[name];
            const [lo, hi] = range(heights[name]);
            if (lo < field.lo || hi > field.hi) log(`WARNING ${name} heights ${lo.toFixed(0)}..${hi.toFixed(0)} exceed ${field.lo}..${field.hi}`);
            const sky = skyVisibility(heights[name], field);
            const rgba = encodeField(heights[name], sky, covers[name], field);
            fields[name] = decodeField(rgba, field);
            if (!opts['no-write']) {
                fs.mkdirSync(ASSETS, { recursive: true });
                fs.writeFileSync(path.join(ASSETS, `coast-${name}.png`), encodePng(rgba, field.size, field.size));
            }
            log(`${name}: ${lo.toFixed(0)}..${hi.toFixed(0)} m${opts['no-write'] ? ' (not written)' : ' written'}`);
        }
        if (!opts['no-write']) {
            const manifest = {
                schema: COAST_SCHEMA,
                fields: Object.fromEntries(FIELD_ORDER.map((name) => {
                    const bytes = fs.readFileSync(path.join(ASSETS, `coast-${name}.png`));
                    return [name, {
                        size: FIELDS[name].size,
                        bytes: bytes.length,
                        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
                    }];
                })),
            };
            fs.writeFileSync(path.join(ASSETS, 'coast-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
        }
    }
    if (opts.preview) {
        const dir = path.resolve(process.cwd(), String(opts.preview));
        fs.mkdirSync(dir, { recursive: true });
        const hours = String(opts.hours ?? 'golden').split(',');
        await renderPreviews(fields, dir, {
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

export { mulberry32 };
