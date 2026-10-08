#!/usr/bin/env node
/**
 * Himalayan Peak — bake the amphitheatre.
 *
 *   node scripts/himalayan-peak/bake-massif.mjs [--size=1024] [--rain=1.6] [--preview=<dir>]
 *                                               [--no-write] [--from-asset]
 *
 * Evaluates the plan of ridges (src/themes/himalayan-peak/himalayan-peak-massif.js) on the
 * theme's grid, lets rain run down it (droplet erosion: the gullies and flutings no formula
 * draws), measures how much sky every point sees, and writes
 *
 *   src/themes/himalayan-peak/assets/massif.png          R·256 + G = height, B = sky visibility
 *   src/themes/himalayan-peak/assets/massif-manifest.json
 *
 * `--preview=<dir>` also ray-casts the result from the viewer's eye on the CPU for a few sun
 * elevations (PNG files), so the shapes and the light can be judged without a GPU.
 * `--from-asset` skips the plan and the rain and previews the PNG that is already there.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    DEG, EYE, EYE_HEIGHT, GRID, HEIGHT_RANGE, REST_RIG, SUN_AZIMUTH, SUN_ELEVATION,
    fovForAspect, mulberry32, shadowWeights, sunDirection,
} from '../../src/themes/himalayan-peak/himalayan-peak-core.js';
import { HERO_SUMMIT, buildPlanHeights } from '../../src/themes/himalayan-peak/himalayan-peak-massif.js';
import {
    CLOUD_CUT, buildMassifMesh, decodeMassif, encodeMassif, horizonMap, sampleField, shadowHeight, shadowSlices,
} from '../../src/themes/himalayan-peak/himalayan-peak-field.js';
import { decodePng, encodePng } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ASSETS = path.join(ROOT, 'src/themes/himalayan-peak/assets');
export const MASSIF_SCHEMA = 1;

function args() {
    const out = {};
    process.argv.slice(2).forEach((arg) => {
        const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
        if (m) out[m[1]] = m[2] ?? true;
    });
    return out;
}

// ── Rain ────────────────────────────────────────────────────────────────────────

/**
 * Droplet erosion. Heights are worked in units of the height range, so a wall of fifty-five
 * degrees falls about 0.005 per cell: the regime the rates below are tuned for.
 */
function rain(heights, size, { perCell = 1.6, seed = 20261008 } = {}) {
    const unit = HEIGHT_RANGE.max - HEIGHT_RANGE.min;
    const h = new Float32Array(heights.length);
    for (let i = 0; i < h.length; i++) h[i] = (heights[i] - HEIGHT_RANGE.min) / unit;
    const rand = mulberry32(seed);
    const LIFE = 64;
    const INERTIA = 0.08;
    const CAPACITY = 0.9;
    const MIN_CAPACITY = 0.00012;
    const ERODE = 0.075;
    const DEPOSIT = 0.2;
    const EVAPORATE = 0.02;
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
    const floor = (CLOUD_CUT - 120 - HEIGHT_RANGE.min) / unit;
    const droplets = Math.round(size * size * perCell);
    let run = 0;
    for (let n = 0; n < droplets; n++) {
        let px = rand() * (size - 3) + 1;
        let py = rand() * (size - 3) + 1;
        // Rain that falls on the basin floor does nothing anyone sees.
        if (h[Math.floor(py) * size + Math.floor(px)] < floor) continue;
        run += 1;
        let dirX = 0;
        let dirY = 0;
        let speed = 1;
        let water = 1;
        let sediment = 0;
        for (let life = 0; life < LIFE; life++) {
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
                const take = Math.min((capacity - sediment) * ERODE, -dh);
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
            if (there < floor) break;
        }
    }
    let moved = 0;
    let deepest = 0;
    for (let i = 0; i < h.length; i++) {
        const next = h[i] * unit + HEIGHT_RANGE.min;
        const delta = next - heights[i];
        moved += Math.abs(delta);
        if (-delta > deepest) deepest = -delta;
        heights[i] = next;
    }
    return { droplets: run, meanChange: moved / h.length, deepestCut: deepest };
}

/** Level the snow under the viewer's boots: the eye must stand on the pass, not in a gully. */
function plantTheEye(heights, plan, size) {
    const cell = GRID.span / (size - 1);
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            const r = Math.hypot(GRID.x0 + i * cell - EYE.x, GRID.z0 + j * cell - EYE.z);
            const k = Math.max(0, 1 - r / 520);
            if (k > 0) {
                const o = j * size + i;
                const w = k * k * (3 - 2 * k);
                heights[o] += (plan[o] - heights[o]) * w;
            }
        }
    }
}

// ── Sky visibility ──────────────────────────────────────────────────────────────

function skyVisibility(heights, size) {
    const cell = GRID.span / (size - 1);
    const out = new Float32Array(size * size);
    const steps = [1, 2, 3, 5, 8, 12, 18, 27, 40, 60, 90, 130];
    const dirs = [];
    for (let k = 0; k < 8; k++) dirs.push([Math.cos((k / 8) * Math.PI * 2 + 0.2), Math.sin((k / 8) * Math.PI * 2 + 0.2)]);
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
                    // Far walls close the sky less than the lip of the gully one stands in.
                    const t = ((heights[b * size + a] - h) / (steps[s] * cell)) * (s < 8 ? 1 : 0.75);
                    if (t > top) top = t;
                }
                blocked += top / Math.sqrt(1 + top * top);
            }
            out[j * size + i] = 1 - blocked / 8;
        }
    }
    return out;
}

// ── A CPU look at the result ────────────────────────────────────────────────────

function preview(heights, sky, size, elevation, file, { width = 960, height = 540 } = {}) {
    const cell = GRID.span / (size - 1);
    const slices = shadowSlices(heights, size);
    const horizons = horizonMap(heights, size);
    const tanSun = Math.tan(elevation);
    const weights = shadowWeights(tanSun);
    const sun = sunDirection(elevation);
    const aspect = width / height;
    const tanH = Math.tan((REST_RIG.hFov * DEG) / 2);
    const tanV = Math.tan((fovForAspect(aspect) * DEG) / 2);
    const fy = Math.sin(REST_RIG.pitch);
    const fz = -Math.cos(REST_RIG.pitch);
    // up = right × forward with right = +X
    const uy = -fz;
    const uz = fy;
    const rgba = new Uint8Array(width * height * 4);
    const warm = Math.max(0, Math.min(1, (elevation - SUN_ELEVATION.rest) / (SUN_ELEVATION.full - SUN_ELEVATION.rest)));
    const sunCol = [3.4 + warm, 1.1 + 1.5 * warm, 0.6 + 0.7 * warm];
    const zenith = [0.012 + 0.02 * warm, 0.03 + 0.055 * warm, 0.115 + 0.19 * warm];
    const horizon = [0.22 + 0.4 * warm, 0.16 + 0.26 * warm, 0.3 + 0.04 * warm];
    const shade = [0.11, 0.17, 0.4];
    const skyAt = (dx, dy, dz) => {
        const up = Math.max(0, dy);
        const k = up ** 0.42;
        const cs = Math.max(0, dx * sun[0] + dy * sun[1] + dz * sun[2]);
        const glow = cs ** 6 * 0.5 + cs ** 60 * 1.5;
        return [
            horizon[0] + (zenith[0] - horizon[0]) * k + glow * 1.0,
            horizon[1] + (zenith[1] - horizon[1]) * k + glow * 0.45,
            horizon[2] + (zenith[2] - horizon[2]) * k + glow * 0.25,
        ];
    };
    const shadowAt = (i, j) => {
        const o = (Math.max(0, Math.min(size - 1, j)) * size + Math.max(0, Math.min(size - 1, i))) * 2;
        return Math.max(0, Math.min(1, (tanSun - horizons[o]) / 0.02 + 0.5));
    };
    const cloudLit = (x, z) => {
        const i = Math.max(0, Math.min(size - 1, Math.round((x - GRID.x0) / cell)));
        const j = Math.max(0, Math.min(size - 1, Math.round((z - GRID.z0) / cell)));
        return Math.max(0, Math.min(1, (tanSun - horizons[(j * size + i) * 2 + 1]) / 0.02 + 0.5));
    };
    for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
            const sx = (((px + 0.5) / width) * 2 - 1) * tanH;
            const sy = (1 - ((py + 0.5) / height) * 2) * tanV;
            let dx = sx;
            let dy = fy + uy * sy;
            let dz = fz + uz * sy;
            const inv = 1 / Math.hypot(dx, dy, dz);
            dx *= inv; dy *= inv; dz *= inv;
            let t = 3;
            let hit = -1;
            let last = t;
            while (t < 26000) {
                const x = EYE.x + dx * t;
                const y = EYE.y + dy * t;
                const z = EYE.z + dz * t;
                const h = sampleField(heights, size, x, z);
                if (y < h) {
                    let lo = last;
                    let hi = t;
                    for (let k = 0; k < 8; k++) {
                        const mid = (lo + hi) * 0.5;
                        if (EYE.y + dy * mid < sampleField(heights, size, EYE.x + dx * mid, EYE.z + dz * mid)) hi = mid;
                        else lo = mid;
                    }
                    hit = hi;
                    break;
                }
                if (y > HEIGHT_RANGE.max && dy > 0) break;
                last = t;
                t += Math.max(1.5, Math.min(260, (y - h) * 0.3), t * 0.002);
            }
            // The cloud sea: a level sheet at y = 0.
            const cloudT = dy < -1e-5 ? -EYE.y / dy : Infinity;
            let col;
            const air = skyAt(dx, Math.max(dy, 0), dz);
            if (hit > 0 && hit < cloudT) {
                const x = EYE.x + dx * hit;
                const z = EYE.z + dz * hit;
                const fi = (x - GRID.x0) / cell;
                const fj = (z - GRID.z0) / cell;
                const i = Math.round(fi);
                const j = Math.round(fj);
                const gx = (sampleField(heights, size, x + cell, z) - sampleField(heights, size, x - cell, z)) / (2 * cell);
                const gz = (sampleField(heights, size, x, z + cell) - sampleField(heights, size, x, z - cell)) / (2 * cell);
                const nl = 1 / Math.sqrt(gx * gx + gz * gz + 1);
                const nx = -gx * nl;
                const ny = nl;
                const nz = -gz * nl;
                const y = EYE.y + dy * hit;
                const vis = sky[Math.max(0, Math.min(size - 1, j)) * size + Math.max(0, Math.min(size - 1, i))];
                const snow = Math.max(0, Math.min(1, (ny - 0.5) / 0.16)) * Math.max(0, Math.min(1, (y + 150) / 500));
                const albedo = [0.13 + 0.77 * snow, 0.115 + 0.8 * snow, 0.11 + 0.86 * snow];
                const lit = Math.max(0, nx * sun[0] + ny * sun[1] + nz * sun[2]) * shadowAt(i, j);
                const amb = (0.45 + 0.55 * ny) * vis * vis;
                col = [0, 1, 2].map((c) => albedo[c] * (sunCol[c] * lit + shade[c] * amb * 1.5));
                const fog = 1 - Math.exp(-hit / 26000);
                col = col.map((c, k) => c + (air[k] - c) * fog);
            } else if (cloudT < 60000) {
                const x = EYE.x + dx * cloudT;
                const z = EYE.z + dz * cloudT;
                const top = shadowHeight(slices.volume, slices.lowSize, x, z, weights);
                // Left half of each cloud texel pair: the exact horizon; the slices should agree.
                const lit = (px & 2) ? cloudLit(x, z) : Math.max(0, Math.min(1, (0 - top) / 60 + 1));
                const base = [0.4, 0.42, 0.62];
                col = base.map((c, k) => c * (0.5 + sunCol[k] * 0.3 * lit * Math.max(0.15, sun[1] + 0.1)));
                const fog = 1 - Math.exp(-cloudT / 22000);
                col = col.map((c, k) => c + (air[k] - c) * fog);
            } else {
                col = skyAt(dx, dy, dz);
                const cs = dx * sun[0] + dy * sun[1] + dz * sun[2];
                if (cs > Math.cos(1.1 * DEG)) col = [30, 22, 14];
            }
            const o = (py * width + px) * 4;
            // Where the card and the stats bar stand: a darker pane, to judge what stays visible.
            const u = (px + 0.5) / width;
            const v = (py + 0.5) / height;
            const card = (u > 0.407 && u < 0.593 && v > 0.15 && v < 0.85) || (u > 0.63 && u < 0.72 && v > 0.26 && v < 0.74);
            for (let c = 0; c < 3; c++) {
                const tone = col[c] / (1 + col[c]);
                rgba[o + c] = Math.round(255 * Math.max(0, Math.min(1, tone * 1.5)) ** (1 / 2.2) * (card ? 0.35 : 1));
            }
            rgba[o + 3] = 255;
        }
    }
    fs.writeFileSync(file, encodePng(rgba, width, height));
}

/** A plan view of the heights with the ridges' shading, for a quick look at the erosion. */
function planView(heights, sky, size, file) {
    const n = 768;
    const rgba = new Uint8Array(n * n * 4);
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const a = Math.min(size - 2, Math.floor((i / n) * size));
            const b = Math.min(size - 2, Math.floor((j / n) * size));
            const h = heights[b * size + a];
            const light = 0.5 + (heights[b * size + a] - heights[(b + 1) * size + a + 1]) * 0.02;
            const s = sky[b * size + a];
            const v = Math.max(0, Math.min(1, light * s));
            const o = (j * n + i) * 4;
            const under = h < 0;
            rgba[o] = Math.round(255 * v * (under ? 0.45 : 1));
            rgba[o + 1] = Math.round(255 * v * (under ? 0.55 : 1));
            rgba[o + 2] = Math.round(255 * v * (under ? 0.8 : 1));
            rgba[o + 3] = 255;
        }
    }
    fs.writeFileSync(file, encodePng(rgba, n, n));
}

/** How the light comes down the hero's east face, and when the sun clears the wall. */
function report(heights, size) {
    const horizons = horizonMap(heights, size);
    const cell = GRID.span / (size - 1);
    const lines = [];
    for (let deg = -12; deg <= 22; deg += 2) {
        const t = Math.tan(deg * DEG);
        let lowest = Infinity;
        let lit = 0;
        let all = 0;
        // The east face: east of the crest, north of the summit's foot, above the cloud.
        for (let z = -10200; z <= -6000; z += cell * 2) {
            for (let x = HERO_SUMMIT.x - 150; x < HERO_SUMMIT.x + 3000; x += cell * 2) {
                const i = Math.round((x - GRID.x0) / cell);
                const j = Math.round((z - GRID.z0) / cell);
                const h = heights[j * size + i];
                if (h < 150) continue;
                all += 1;
                if (horizons[(j * size + i) * 2] < t) {
                    lit += 1;
                    lowest = Math.min(lowest, h);
                }
            }
        }
        lines.push(`${String(deg).padStart(4)}°  ${String(Math.round((lit / all) * 100)).padStart(3)}% of the east face lit, down to ${Number.isFinite(lowest) ? Math.round(lowest) : '—'} m`);
    }
    let top = -1;
    for (let r = 200; r < 16000; r += cell * 0.5) {
        const h = sampleField(heights, size, EYE.x + Math.sin(SUN_AZIMUTH) * r, EYE.z - Math.cos(SUN_AZIMUTH) * r);
        top = Math.max(top, (h - EYE.y) / r);
    }
    let summit = -Infinity;
    for (let i = 0; i < heights.length; i++) summit = Math.max(summit, heights[i]);
    const ground = sampleField(heights, size, EYE.x, EYE.z);
    return {
        text: lines.join('\n'),
        sunClears: Math.atan(top) / DEG,
        summit,
        ground,
    };
}

function main() {
    const opt = args();
    const size = Number(opt.size) || GRID.size;
    let heights;
    let sky;
    const started = Date.now();
    if (opt['from-asset']) {
        const png = decodePng(fs.readFileSync(path.join(ASSETS, 'massif.png')));
        const decoded = decodeMassif(png.rgba, png.width);
        ({ heights } = decoded);
        sky = Float32Array.from(decoded.sky, (v) => v / 255);
    } else {
        heights = buildPlanHeights(size);
        console.log(`plan: ${size}² in ${((Date.now() - started) / 1000).toFixed(1)} s`);
        const plan = heights.slice();
        if (!opt['no-rain']) {
            const t0 = Date.now();
            const stats = rain(heights, size, { perCell: Number(opt.rain) || 1.6 });
            plantTheEye(heights, plan, size);
            console.log(`rain: ${stats.droplets} droplets, mean change ${stats.meanChange.toFixed(2)} m, deepest cut ${stats.deepestCut.toFixed(1)} m, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
        }
        const t1 = Date.now();
        sky = skyVisibility(heights, size);
        console.log(`sky: ${((Date.now() - t1) / 1000).toFixed(1)} s`);
    }
    const actualSize = Math.round(Math.sqrt(heights.length));
    const facts = report(heights, actualSize);
    console.log(facts.text);
    console.log(`summit ${facts.summit.toFixed(0)} m; snow under the eye ${facts.ground.toFixed(1)} m (eye ${EYE.y}, boots ${EYE.y - EYE_HEIGHT}); the sun clears the wall at ${facts.sunClears.toFixed(1)}°`);
    for (const stride of [1, 2, 4]) {
        const t = Date.now();
        const mesh = buildMassifMesh(heights, actualSize, { stride });
        console.log(`mesh stride ${stride}: ${mesh.kept} of ${mesh.cells} cells, ${mesh.positions.length / 3} vertices, ${Date.now() - t} ms`);
    }

    if (!opt['no-write'] && !opt['from-asset']) {
        fs.mkdirSync(ASSETS, { recursive: true });
        const png = encodePng(encodeMassif(heights, sky, actualSize), actualSize, actualSize);
        fs.writeFileSync(path.join(ASSETS, 'massif.png'), png);
        const manifest = {
            schema: MASSIF_SCHEMA,
            generator: 'scripts/himalayan-peak/bake-massif.mjs',
            size: actualSize,
            grid: { ...GRID, size: actualSize },
            heightRange: { ...HEIGHT_RANGE },
            bytes: png.length,
            sha256: crypto.createHash('sha256').update(png).digest('hex'),
            summit: Math.round(facts.summit),
            sunClearsDegrees: Number(facts.sunClears.toFixed(2)),
        };
        fs.writeFileSync(path.join(ASSETS, 'massif-manifest.json'), `${JSON.stringify(manifest, null, 4)}\n`);
        console.log(`wrote massif.png (${(png.length / 1024).toFixed(0)} KiB)`);
    }

    if (typeof opt.preview === 'string') {
        fs.mkdirSync(opt.preview, { recursive: true });
        planView(heights, sky, actualSize, path.join(opt.preview, 'plan.png'));
        const list = typeof opt.elevations === 'string' ? opt.elevations.split(',').map(Number) : [SUN_ELEVATION.rest / DEG, 6, SUN_ELEVATION.full / DEG];
        list.forEach((deg) => {
            const t = Date.now();
            const name = `view-${deg < 0 ? 'm' : ''}${Math.abs(deg).toFixed(0)}.png`;
            preview(heights, sky, actualSize, deg * DEG, path.join(opt.preview, name));
            console.log(`preview ${name}: ${((Date.now() - t) / 1000).toFixed(1)} s`);
        });
    }
}

main();
