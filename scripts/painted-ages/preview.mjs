/**
 * Painted Ages — a CPU ray-cast preview of the baked land from the eye (bake-script helper).
 *
 * Not the theme's renderer: a quick, honest look at shapes, the strata and the composition
 * (sun with soft shadows, sky light by the baked visibility, aerial haze), in 8 worker threads.
 * The board card and HUD of the solo layout are outlined so the composition is judged around them.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
    Worker, isMainThread, parentPort, workerData,
} from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

import {
    COLUMN, DEG, EYE, RIG, bakeColumn, buildBeds, clamp, strataG,
} from '../../src/themes/painted-ages/painted-ages-core.js';
import { groundByte, groundHeight } from '../../src/themes/painted-ages/painted-ages-field.js';
import { encodePng } from './png.mjs';

const HERE = fileURLToPath(import.meta.url);

/** Preview lights: sun azimuth (degrees right of the view axis), elevation, colours. */
export const PREVIEW_HOURS = {
    golden: {
        az: 68, el: 13, sun: [3.2, 2.2, 1.25], sky: [0.32, 0.45, 0.72], haze: [0.78, 0.66, 0.55],
    },
    sunset: {
        az: -27, el: 2.6, sun: [3.0, 1.35, 0.5], sky: [0.3, 0.3, 0.5], haze: [0.85, 0.52, 0.36],
    },
    day: {
        az: 160, el: 46, sun: [3.0, 2.85, 2.6], sky: [0.35, 0.55, 0.95], haze: [0.62, 0.72, 0.86],
    },
    dawn: {
        az: 27, el: 3, sun: [2.6, 1.5, 1.0], sky: [0.32, 0.32, 0.55], haze: [0.8, 0.6, 0.62],
    },
    afternoon: {
        az: -100, el: 24, sun: [3.1, 2.4, 1.6], sky: [0.3, 0.46, 0.8], haze: [0.75, 0.66, 0.58],
    },
};

function render(job) {
    const {
        fields, column, width, height, rows, hour,
    } = job;
    const H = PREVIEW_HOURS[hour];
    const aspect = width / height;
    const rig = RIG.landscape;
    const tanHalf = Math.tan((rig.fov / 2) * DEG);
    const pitch = rig.pitch * DEG;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const sunX = Math.sin(H.az * DEG) * Math.cos(H.el * DEG);
    const sunY = Math.sin(H.el * DEG);
    const sunZ = -Math.cos(H.az * DEG) * Math.cos(H.el * DEG);
    const out = new Float32Array(width * rows.length * 3);
    const ground = (x, z) => groundHeight(fields, x, z);
    const colAt = (g, blur = 0) => {
        const f = ((g - COLUMN.gMin) / (COLUMN.gMax - COLUMN.gMin)) * COLUMN.size;
        const rgb = [0, 0, 0];
        const n = blur > 0 ? 9 : 1;
        for (let k = 0; k < n; k++) {
            const o = n === 1 ? 0 : (k - 4) * blur;
            const i = clamp(Math.floor(f + o), 0, COLUMN.size - 1) * 4;
            rgb[0] += column[i] / n;
            rgb[1] += column[i + 1] / n;
            rgb[2] += column[i + 2] / n;
        }
        return rgb;
    };
    for (let r = 0; r < rows.length; r++) {
        const j = rows[r];
        const ny = 1 - ((j + 0.5) / height) * 2;
        for (let i = 0; i < width; i++) {
            const nx = ((i + 0.5) / width) * 2 - 1;
            let dx = nx * tanHalf * aspect;
            let dy = ny * tanHalf;
            let dz = -1;
            const y2 = dy * cp - dz * sp;
            const z2 = dy * sp + dz * cp;
            dy = y2;
            dz = z2;
            const len = Math.hypot(dx, dy, dz);
            dx /= len;
            dy /= len;
            dz /= len;
            // March.
            let t = 2;
            let prevT = t;
            let hit = -1;
            while (t < 42000) {
                const x = EYE.x + dx * t;
                const y = EYE.y + dy * t;
                const z = EYE.z + dz * t;
                if (y > 4300) break;
                if (y < ground(x, z)) {
                    // Bisect.
                    let a = prevT;
                    let b = t;
                    for (let k = 0; k < 12; k++) {
                        const m = (a + b) / 2;
                        if (EYE.y + dy * m < ground(EYE.x + dx * m, EYE.z + dz * m)) b = m;
                        else a = m;
                    }
                    hit = b;
                    break;
                }
                prevT = t;
                t += Math.max(0.7, t * 0.0065);
            }
            let cr;
            let cg;
            let cb;
            const mu = dx * sunX + dy * sunY + dz * sunZ;
            const skyAt = (elev) => {
                const e = Math.max(0, elev);
                const zen = Math.exp(-e * 2.8);
                return [
                    H.sky[0] * (1 - zen) + H.haze[0] * zen * 1.15,
                    H.sky[1] * (1 - zen) + H.haze[1] * zen * 1.15,
                    H.sky[2] * (1 - zen) + H.haze[2] * zen * 1.15,
                ];
            };
            if (hit < 0) {
                const s = skyAt(dy);
                const glow = Math.max(0, mu) ** 12 * 1.2 + Math.max(0, mu) ** 400 * 40;
                cr = s[0] + H.sun[0] * glow * 0.3;
                cg = s[1] + H.sun[1] * glow * 0.3;
                cb = s[2] + H.sun[2] * glow * 0.3;
            } else {
                const x = EYE.x + dx * hit;
                const z = EYE.z + dz * hit;
                const y = ground(x, z);
                const e = Math.max(0.6, hit * 0.0016);
                const hx = (ground(x + e, z) - ground(x - e, z)) / (2 * e);
                const hz = (ground(x, z + e) - ground(x, z - e)) / (2 * e);
                const nl = Math.hypot(hx, 1, hz);
                const nxv = -hx / nl;
                const nyv = 1 / nl;
                const nzv = -hz / nl;
                const g = strataG(x, y, z);
                let alb = colAt(g);
                // Dust on the gentle slopes, washes in the gullies.
                const flat = clamp((nyv - 0.82) / 0.16, 0, 1);
                const mean = colAt(g, 4);
                const flow = groundByte(fields, 'flow', x, z);
                const dust = flat * 0.65;
                alb = alb.map((c, k) => c * (1 - dust) + (mean[k] * 0.8 + [0.55, 0.42, 0.34][k] * 0.2) * dust);
                if (y > 2300) {
                    const snow = clamp((y - 2300) / 300, 0, 1) * clamp((nyv - 0.45) / 0.3, 0, 1);
                    alb = alb.map((c) => c * (1 - snow) + 0.85 * snow);
                }
                const wash = clamp((flow - 0.42) / 0.2, 0, 1);
                alb = alb.map((c) => c * (1 - wash * 0.35));
                // Sun with a soft shadow march.
                let lit = Math.max(0, nxv * sunX + nyv * sunY + nzv * sunZ);
                if (lit > 0) {
                    let vis = 1;
                    let s = 1.5;
                    const y0 = y + 0.5;
                    while (s < 6000) {
                        const sx = x + sunX * s;
                        const sz = z + sunZ * s;
                        const sy = y0 + sunY * s;
                        const gh = ground(sx, sz);
                        vis = Math.min(vis, clamp(((sy - gh) / s) * 14 + 0.5, 0, 1));
                        if (vis <= 0) break;
                        s *= 1.12;
                    }
                    lit *= vis;
                }
                const sky = groundByte(fields, 'sky', x, z);
                const amb = (0.55 + 0.45 * nyv) * (0.25 + 0.75 * sky);
                const base = [0, 1, 2].map((k) => alb[k] * (H.sun[k] * lit * 0.55 + H.sky[k] * amb * 0.9 + alb[k] * 0.15 * H.sun[k] * 0.12));
                // Aerial perspective, heavier low in the valleys.
                const fog = 1 - Math.exp((-hit / 7500) * (1 + 1.5 * Math.exp(-Math.max(0, y) / 300)));
                const glow = Math.max(0, mu) ** 8;
                const hz2 = [0, 1, 2].map((k) => H.haze[k] * (0.85 + glow * 0.8));
                cr = base[0] * (1 - fog) + hz2[0] * fog;
                cg = base[1] * (1 - fog) + hz2[1] * fog;
                cb = base[2] * (1 - fog) + hz2[2] * fog;
            }
            const o = (r * width + i) * 3;
            out[o] = cr;
            out[o + 1] = cg;
            out[o + 2] = cb;
        }
    }
    return out;
}

if (!isMainThread) {
    const job = workerData;
    const fields = {};
    for (const [name, f] of Object.entries(job.fields)) {
        fields[name] = { heights: new Float32Array(f.heights), sky: new Uint8Array(f.sky), flow: new Uint8Array(f.flow) };
    }
    const out = render({ ...job, fields, column: new Float32Array(job.column) });
    parentPort.postMessage(out, [out.buffer]);
}

const shared = (typed) => {
    const sab = new SharedArrayBuffer(typed.byteLength);
    new Uint8Array(sab).set(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength));
    return sab;
};

/** Filmic-ish tone curve and sRGB encoding to bytes. */
function toBytes(hdr, width, height, exposure = 1) {
    const out = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        for (let k = 0; k < 3; k++) {
            const x = Math.max(0, hdr[i * 3 + k] * exposure);
            const t = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
            const s = t <= 0.0031308 ? t * 12.92 : 1.055 * t ** (1 / 2.4) - 0.055;
            out[i * 4 + k] = Math.round(clamp(s, 0, 1) * 255);
        }
        out[i * 4 + 3] = 255;
    }
    return out;
}

/** Outline the solo layout (card + HUD) at 1920 × 1080 proportions. */
function outlineLayout(bytes, width, height) {
    const W = width;
    const H = height;
    const board = (Math.min(300, (1080 - 250) / 2) / 1080) * H;
    const cw = board * 1.19;
    const ch = board * 2 + (158 / 1080) * H;
    const rects = [
        [W / 2 - cw / 2, H / 2 - ch / 2, W / 2 + cw / 2, H / 2 + ch / 2],
        [W / 2 + ((400 / 1920) * W) / 2 + (60 / 1920) * W, H * 0.25, W / 2 + ((400 / 1920) * W) / 2 + (200 / 1920) * W, H * 0.75],
    ];
    for (const [x0, y0, x1, y1] of rects) {
        for (let x = Math.round(x0); x <= Math.round(x1); x++) {
            for (const y of [Math.round(y0), Math.round(y1)]) {
                if (x < 0 || y < 0 || x >= W || y >= H) continue;
                bytes.set([255, 255, 255, 255], (y * W + x) * 4);
            }
        }
        for (let y = Math.round(y0); y <= Math.round(y1); y++) {
            for (const x of [Math.round(x0), Math.round(x1)]) {
                if (x < 0 || y < 0 || x >= W || y >= H) continue;
                bytes.set([255, 255, 255, 255], (y * W + x) * 4);
            }
        }
    }
}

export async function renderPreviews(fields, beds, dir, {
    hours = ['golden'], width = 960, height = 540, tag = '', threads = 8,
} = {}) {
    const column = bakeColumn(beds ?? buildBeds());
    const sharedFields = Object.fromEntries(Object.entries(fields).map(([name, f]) => [name, {
        heights: shared(f.heights), sky: shared(f.sky), flow: shared(f.flow),
    }]));
    for (const hour of hours) {
        const started = Date.now();
        const hdr = new Float32Array(width * height * 3);
        const jobs = [];
        for (let w = 0; w < threads; w++) {
            const rows = [];
            for (let j = w; j < height; j += threads) rows.push(j);
            jobs.push(new Promise((resolve, reject) => {
                const worker = new Worker(HERE, {
                    workerData: {
                        fields: sharedFields, column: shared(column), width, height, rows, hour,
                    },
                });
                worker.once('message', (data) => {
                    const part = new Float32Array(data.buffer ?? data);
                    rows.forEach((j, r) => hdr.set(part.subarray(r * width * 3, (r + 1) * width * 3), j * width * 3));
                    resolve();
                });
                worker.once('error', reject);
            }));
        }
        // One hour at a time: each already runs on every worker.
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(jobs);
        const bytes = toBytes(hdr, width, height, 0.9);
        outlineLayout(bytes, width, height);
        const file = path.join(dir, `preview-${hour}${tag ? `-${tag}` : ''}.png`);
        fs.writeFileSync(file, encodePng(bytes, width, height));
        console.log(`[preview] ${hour}: ${((Date.now() - started) / 1000).toFixed(1)} s → ${file}`);
    }
}
