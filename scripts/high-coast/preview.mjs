/**
 * High Coast — a CPU ray-cast preview of the baked coast from the eye (bake-script helper).
 *
 * Not the theme's renderer: a quick, honest look at shapes and composition (granite, forest,
 * shingle and the sea with its sky reflection and the sun's glitter; sun with soft shadows; air),
 * in 8 worker threads. The solo layout's card and HUD are outlined so the frame is judged around them.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
    Worker, isMainThread, parentPort, workerData,
} from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

import {
    DEG, EYE, RIG, clamp,
} from '../../src/themes/high-coast/high-coast-core.js';
import { groundByte, groundHeight } from '../../src/themes/high-coast/high-coast-field.js';
import { shingleMask } from '../../src/themes/high-coast/high-coast-plan.js';
import { encodePng } from './png.mjs';

const HERE = fileURLToPath(import.meta.url);

/** Preview lights: sun azimuth (degrees right of the view axis), elevation, colours. */
export const PREVIEW_HOURS = {
    golden: {
        az: 22, el: 4, sun: [3.4, 2.1, 1.05], sky: [0.16, 0.32, 0.72], haze: [0.85, 0.66, 0.5],
    },
    sunset: {
        az: 26, el: 0.6, sun: [3.0, 1.2, 0.45], sky: [0.16, 0.18, 0.42], haze: [0.95, 0.5, 0.32],
    },
    morning: {
        az: -95, el: 24, sun: [3.0, 2.8, 2.5], sky: [0.2, 0.42, 0.9], haze: [0.62, 0.72, 0.86],
    },
    afternoon: {
        az: 140, el: 30, sun: [3.1, 2.7, 2.2], sky: [0.2, 0.4, 0.85], haze: [0.7, 0.72, 0.78],
    },
};

const ROCK = [0.38, 0.2, 0.15];
const LICHEN = [0.42, 0.42, 0.38];
const FOREST = [0.05, 0.085, 0.04];
const HEATH = [0.2, 0.15, 0.12];
const SHINGLE = [0.36, 0.36, 0.34];
const DEEP = [0.01, 0.035, 0.07];

function render(job) {
    const {
        fields, width, height, rows, hour,
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
    const skyAt = (dx, dy, dz) => {
        const e = Math.max(0, dy);
        const zen = Math.exp(-e * 3.2);
        const mu = dx * sunX + dy * sunY + dz * sunZ;
        const glow = Math.max(0, mu) ** 10 * 0.9 + Math.max(0, mu) ** 600 * 60;
        return [0, 1, 2].map((k) => H.sky[k] * (1 - zen) + H.haze[k] * zen * 1.1 + H.sun[k] * glow * 0.25);
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
            let t = 0.5;
            let prevT = t;
            let hit = -1;
            let water = false;
            while (t < 60000) {
                const x = EYE.x + dx * t;
                const y = EYE.y + dy * t;
                const z = EYE.z + dz * t;
                if (y > 700) break;
                const g = ground(x, z);
                if (y < Math.max(g, 0)) {
                    let a = prevT;
                    let b = t;
                    for (let k = 0; k < 12; k++) {
                        const m = (a + b) / 2;
                        if (EYE.y + dy * m < Math.max(0, ground(EYE.x + dx * m, EYE.z + dz * m))) b = m;
                        else a = m;
                    }
                    hit = b;
                    water = ground(EYE.x + dx * b, EYE.z + dz * b) < 0;
                    break;
                }
                prevT = t;
                t += Math.max(0.25, t * 0.004);
            }
            let col;
            if (hit < 0) {
                col = skyAt(dx, dy, dz);
            } else {
                const x = EYE.x + dx * hit;
                const z = EYE.z + dz * hit;
                const y = Math.max(0, ground(x, z));
                if (water) {
                    const depth = -ground(x, z);
                    // A ripple normal, then the sky in the mirror direction and the sun's glitter.
                    const rnx = 0.035 * Math.sin(x * 0.9 + z * 0.4) + 0.02 * Math.sin(x * 2.3 - z * 1.7);
                    const rnz = 0.035 * Math.sin(z * 1.1 - x * 0.3) + 0.02 * Math.sin(z * 2.9 + x * 1.3);
                    const rx = dx + 2 * rnx * -dy;
                    const ry = -dy;
                    const rz = dz + 2 * rnz * -dy;
                    const rl = Math.hypot(rx, ry, rz);
                    const refl = skyAt(rx / rl, ry / rl, rz / rl);
                    const cosi = Math.max(0.02, -dy);
                    const fres = 0.02 + 0.98 * (1 - cosi) ** 5;
                    const shallow = Math.exp(-depth / 6);
                    const body = [0, 1, 2].map((k) => DEEP[k] * (1 - shallow) + ROCK[k] * 0.35 * shallow);
                    const mu = (rx / rl) * sunX + (ry / rl) * sunY + (rz / rl) * sunZ;
                    const glint = Math.max(0, mu) ** 220 * 8;
                    col = [0, 1, 2].map((k) => body[k] * (1 - fres) + refl[k] * fres + H.sun[k] * glint * 0.3);
                    if (depth < 0.6) col = col.map((c) => c * 0.4 + 0.5);
                } else {
                    const e = Math.max(0.4, hit * 0.0014);
                    const hx = (ground(x + e, z) - ground(x - e, z)) / (2 * e);
                    const hz = (ground(x, z + e) - ground(x, z - e)) / (2 * e);
                    const nl = Math.hypot(hx, 1, hz);
                    const nxv = -hx / nl;
                    const nyv = 1 / nl;
                    const nzv = -hz / nl;
                    const slope = Math.hypot(hx, hz);
                    const forest = groundByte(fields, 'flow', x, z);
                    const shingle = shingleMask(x, z, y);
                    let alb = ROCK.map((c, k) => c * 0.75 + LICHEN[k] * 0.25 * clamp(1.2 - slope, 0, 1));
                    const heath = clamp((1 - forest) * (1 - slope * 1.4), 0, 1) * clamp((y - 4) / 6, 0, 1) * 0.6;
                    alb = alb.map((c, k) => c * (1 - heath) + HEATH[k] * heath);
                    alb = alb.map((c, k) => c * (1 - shingle) + SHINGLE[k] * shingle);
                    alb = alb.map((c, k) => c * (1 - forest) + FOREST[k] * forest);
                    let lit = Math.max(0, nxv * sunX + nyv * sunY + nzv * sunZ);
                    if (lit > 0) {
                        let vis = 1;
                        let s = 1.0;
                        const y0 = y + 0.4;
                        while (s < 8000) {
                            const sx = x + sunX * s;
                            const sz = z + sunZ * s;
                            const sy = y0 + sunY * s;
                            vis = Math.min(vis, clamp(((sy - Math.max(0, ground(sx, sz))) / s) * 14 + 0.5, 0, 1));
                            if (vis <= 0) break;
                            s *= 1.12;
                        }
                        lit *= vis;
                    }
                    const sky = groundByte(fields, 'sky', x, z);
                    const amb = (0.55 + 0.45 * nyv) * (0.25 + 0.75 * sky);
                    col = [0, 1, 2].map((k) => alb[k] * (H.sun[k] * lit * 0.6 + H.sky[k] * amb * 0.9));
                }
                const fog = 1 - Math.exp(-hit / 14000);
                const mu = dx * sunX + dy * sunY + dz * sunZ;
                const glow = Math.max(0, mu) ** 8;
                col = [0, 1, 2].map((k) => col[k] * (1 - fog) + H.haze[k] * (0.85 + glow * 0.8) * fog);
            }
            const o = (r * width + i) * 3;
            out[o] = col[0];
            out[o + 1] = col[1];
            out[o + 2] = col[2];
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
    const out = render({ ...job, fields });
    parentPort.postMessage(out, [out.buffer]);
}

const shared = (typed) => {
    const sab = new SharedArrayBuffer(typed.byteLength);
    new Uint8Array(sab).set(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength));
    return sab;
};

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

export async function renderPreviews(fields, dir, {
    hours = ['golden'], width = 960, height = 540, tag = '', threads = 8,
} = {}) {
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
                        fields: sharedFields, width, height, rows, hour,
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
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(jobs);
        const bytes = toBytes(hdr, width, height, 0.95);
        outlineLayout(bytes, width, height);
        const file = path.join(dir, `preview-${hour}${tag ? `-${tag}` : ''}.png`);
        fs.writeFileSync(file, encodePng(bytes, width, height));
        console.log(`[preview] ${hour}: ${((Date.now() - started) / 1000).toFixed(1)} s → ${file}`);
    }
}
