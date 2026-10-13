#!/usr/bin/env node
/**
 * High Coast — a top-down hillshade of a baked field (bake-script helper): low sun from the
 * north-west, the sea in blue by depth, forest in green, the eye and the landmarks marked, and the
 * frame's edges (landscape, 16:9) drawn from the eye. For judging the plan.
 *
 *   node scripts/high-coast/hillshade.mjs --field=near --out=<png> [--crop=x0,z0,span] [--size=1024]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    DEG, EYE, FIELDS, PLACES, RIG, clamp,
} from '../../src/themes/high-coast/high-coast-core.js';
import { decodeField } from '../../src/themes/high-coast/high-coast-field.js';
import { decodePng, encodePng } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const opts = Object.fromEntries(process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : [a, true];
}));
const name = opts.field || 'near';
const field = FIELDS[name];
const { rgba, width } = decodePng(fs.readFileSync(path.join(ROOT, `src/themes/high-coast/assets/coast-${name}.png`)));
const { heights, flow, sky } = decodeField(rgba, field);
const size = width;
const cell = field.span / (size - 1);
let [cx0, cz0, cspan] = [field.x0, field.z0, field.span];
if (opts.crop) [cx0, cz0, cspan] = String(opts.crop).split(',').map(Number);
const out = Number(opts.size || 1024);
const bytes = new Uint8Array(out * out * 4);
const L = [-0.55, 0.62, -0.55];
const ll = Math.hypot(...L);
for (let j = 0; j < out; j++) {
    for (let i = 0; i < out; i++) {
        const x = cx0 + (i / (out - 1)) * cspan;
        const z = cz0 + (j / (out - 1)) * cspan;
        const fi = clamp(Math.round((x - field.x0) / cell), 1, size - 2);
        const fj = clamp(Math.round((z - field.z0) / cell), 1, size - 2);
        const o = fj * size + fi;
        const h = heights[o];
        const p = (j * out + i) * 4;
        if (h < 0) {
            const d = clamp(-h / 50, 0, 1);
            bytes[p] = 40 + 60 * (1 - d);
            bytes[p + 1] = 80 + 80 * (1 - d);
            bytes[p + 2] = 140 + 80 * (1 - d);
            bytes[p + 3] = 255;
            continue;
        }
        const gx = (heights[o + 1] - heights[o - 1]) / (2 * cell);
        const gz = (heights[o + size] - heights[o - size]) / (2 * cell);
        const n = [-gx, 1, -gz];
        const nl = Math.hypot(...n);
        const lit = clamp((n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / (nl * ll), 0, 1);
        const s = sky[o] / 255;
        const f = flow[o] / 255;
        const v = (0.15 + 0.85 * lit) * (0.6 + 0.4 * s);
        bytes[p] = clamp(v * (235 - f * 170), 0, 255);
        bytes[p + 1] = clamp(v * (215 - f * 60), 0, 255);
        bytes[p + 2] = clamp(v * (200 - f * 150), 0, 255);
        bytes[p + 3] = 255;
    }
}
const plot = (x, z, rgb, r = 4) => {
    const i = Math.round(((x - cx0) / cspan) * (out - 1));
    const j = Math.round(((z - cz0) / cspan) * (out - 1));
    for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
            const a = i + dx;
            const b = j + dy;
            if (a >= 0 && b >= 0 && a < out && b < out) bytes.set([...rgb, 255], (b * out + a) * 4);
        }
    }
};
// The frame's edges from the eye, and the card's (about ±9° at 16:9).
const half = Math.atan(Math.tan((RIG.landscape.fov / 2) * DEG) * (16 / 9));
for (const [a, rgb] of [[-half, [255, 255, 0]], [half, [255, 255, 0]], [-9 * DEG, [255, 255, 255]], [9 * DEG, [255, 255, 255]]]) {
    for (let d = 0; d < cspan * 1.5; d += cspan / 600) plot(EYE.x + Math.sin(a) * d, EYE.z - Math.cos(a) * d, rgb, 0);
}
plot(EYE.x, EYE.z, [255, 40, 40]);
for (const [k, p] of Object.entries(PLACES)) plot(p.x, p.z, k === 'hamlet' ? [255, 60, 200] : [255, 200, 40], 3);
fs.writeFileSync(path.resolve(String(opts.out || '.cache/hc/hillshade.png')), encodePng(bytes, out, out));
console.log('hillshade written');
