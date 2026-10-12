#!/usr/bin/env node
/**
 * Painted Ages — a top-down hillshade of a baked field (bake-script helper): low sun from the
 * north-west, drainage in blue, the eye and the pavilion marked. For judging the gully network.
 *
 *   node scripts/painted-ages/hillshade.mjs --field=near --out=<png> [--crop=x0,z0,span]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIELDS, clamp } from '../../src/themes/painted-ages/painted-ages-core.js';
import { decodeField } from '../../src/themes/painted-ages/painted-ages-field.js';
import { decodePng, encodePng } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const opts = Object.fromEntries(process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : [a, true];
}));
const name = opts.field || 'near';
const field = FIELDS[name];
const { rgba, width } = decodePng(fs.readFileSync(path.join(ROOT, `src/themes/painted-ages/assets/badlands-${name}.png`)));
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
        const gx = (heights[o + 1] - heights[o - 1]) / (2 * cell);
        const gz = (heights[o + size] - heights[o - size]) / (2 * cell);
        const n = [-gx, 1, -gz];
        const nl = Math.hypot(...n);
        const lit = clamp((n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / (nl * ll), 0, 1);
        const s = sky[o] / 255;
        const f = clamp((flow[o] / 255 - 0.45) / 0.25, 0, 1);
        const v = (0.15 + 0.85 * lit) * (0.6 + 0.4 * s);
        const p = (j * out + i) * 4;
        bytes[p] = clamp(v * 235 * (1 - f * 0.6), 0, 255);
        bytes[p + 1] = clamp(v * 225 * (1 - f * 0.3), 0, 255);
        bytes[p + 2] = clamp(v * 210 + f * 90, 0, 255);
        bytes[p + 3] = 255;
    }
}
const mark = (x, z, rgb) => {
    const i = Math.round(((x - cx0) / cspan) * (out - 1));
    const j = Math.round(((z - cz0) / cspan) * (out - 1));
    for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
            const a = i + dx;
            const b = j + dy;
            if (a >= 0 && b >= 0 && a < out && b < out) bytes.set([...rgb, 255], (b * out + a) * 4);
        }
    }
};
mark(0, 0, [255, 40, 40]);
mark(-150, -360, [255, 220, 40]);
fs.writeFileSync(path.resolve(String(opts.out || '.cache/painted/bake/hillshade.png')), encodePng(bytes, out, out));
console.log('hillshade written');
