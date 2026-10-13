/**
 * Painted Ages — the land: the field codec, the baked heightfields as they ship, the plan they
 * were baked from, and the things that stand on the land (the poplars, the boardwalk's crest
 * line). Everything here is CPU only and reads the real baked PNGs (their hashes are read from
 * the manifest, so a re-bake needs no edit here).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    EYE, FIELDS, FIELD_ORDER, mulberry32,
} from '../../src/themes/painted-ages/painted-ages-core.js';
import {
    bicubic, bilinear, decodeField, encodeField, fieldCoords, fieldInset, groundByte, groundHeight, inField, postX,
    postZ,
} from '../../src/themes/painted-ages/painted-ages-field.js';
import {
    BADLANDS_SCHEMA, BADLANDS_URLS, planBadlands, planField,
} from '../../src/themes/painted-ages/painted-ages-assets.js';
import {
    PAVILION, RIVER, RIVER_ALONG, RIVER_LENGTH, SPUR, planHeight, riverDistance, riverFloor, softMax,
} from '../../src/themes/painted-ages/painted-ages-plan.js';
import { poplarSites } from '../../src/themes/painted-ages/painted-ages-life.js';
import { findCrest } from '../../src/themes/painted-ages/painted-ages-props.js';
import { decodePng } from '../../scripts/painted-ages/png.mjs';

const assetUrl = (name) => new URL(`../../src/themes/painted-ages/assets/${name}`, import.meta.url);
const manifest = JSON.parse(readFileSync(assetUrl('badlands-manifest.json'), 'utf8'));

/** The three baked fields as the theme reads them (each PNG decoded once for the file). */
const files = {};
const images = {};
const fields = {};
for (const name of FIELD_ORDER) {
    files[name] = readFileSync(assetUrl(`badlands-${name}.png`));
    images[name] = decodePng(files[name]);
    fields[name] = { ...decodeField(images[name].rgba, FIELDS[name]), size: FIELDS[name].size, source: 'asset' };
}
fields.source = 'asset';

const ground = (x, z) => groundHeight(fields, x, z, true);

describe('Painted Ages field codec', () => {
    const small = { ...FIELDS.near, size: 33 };
    const n = small.size * small.size;

    it('round-trips heights to a sixteen-bit step, and sky and drainage to a byte', () => {
        const random = mulberry32(11);
        const heights = new Float32Array(n).map(() => small.lo + random() * (small.hi - small.lo));
        const sky = new Float32Array(n).map(() => random());
        const flow = new Float32Array(n).map(() => random());
        const rgba = encodeField(heights, sky, flow, small);
        expect(rgba).toHaveLength(n * 4);
        const back = decodeField(rgba, small);
        const range = small.hi - small.lo;
        let worst = 0;
        for (let i = 0; i < n; i++) {
            worst = Math.max(worst, Math.abs(back.heights[i] - heights[i]));
            expect(Math.abs(back.sky[i] / 255 - sky[i])).toBeLessThanOrEqual(0.5 / 255 + 1e-9);
            expect(Math.abs(back.flow[i] / 255 - flow[i])).toBeLessThanOrEqual(0.5 / 255 + 1e-9);
        }
        expect(worst).toBeLessThan(range / 65535 + 1e-4);
    });

    it('clamps what the field cannot hold to its bounds', () => {
        const heights = new Float32Array(n).fill(small.hi + 500);
        heights[0] = small.lo - 500;
        const zero = new Float32Array(n);
        const back = decodeField(encodeField(heights, zero.map(() => 2), zero.map(() => -1), small), small);
        expect(back.heights[0]).toBeCloseTo(small.lo, 6);
        expect(back.heights[1]).toBeCloseTo(small.hi, 6);
        expect(back.sky[0]).toBe(255);
        expect(back.flow[0]).toBe(0);
    });

    it('places posts at the field edges and reads them back exactly', () => {
        for (const name of FIELD_ORDER) {
            const f = FIELDS[name];
            expect(postX(f, 0)).toBe(f.x0);
            expect(postX(f, f.size - 1)).toBeCloseTo(f.x0 + f.span, 9);
            expect(postZ(f, f.size - 1)).toBeCloseTo(f.z0 + f.span, 9);
            const c = fieldCoords(f, postX(f, 17), postZ(f, 23));
            expect(c.fx).toBeCloseTo(17, 9);
            expect(c.fz).toBeCloseTo(23, 9);
            expect(inField(f, f.x0, f.z0)).toBe(true);
            expect(inField(f, f.x0 - 1, f.z0)).toBe(false);
            expect(fieldInset(f, f.x0 + 10, f.z0 + f.span / 2)).toBeCloseTo(10, 9);
            expect(fieldInset(f, f.x0 - 10, f.z0 + f.span / 2)).toBeCloseTo(-10, 9);
        }
    });

    it('samples bilinearly and bicubically through the posts, clamped at the grid', () => {
        const size = 8;
        const ramp = new Float32Array(size * size).map((_, i) => 3 * (i % size) + 2 * Math.floor(i / size));
        expect(bilinear(ramp, size, 2, 5)).toBeCloseTo(16, 9);
        expect(bilinear(ramp, size, 2.5, 5.25)).toBeCloseTo(18, 9);
        // A cubic through a ramp is the ramp.
        expect(bicubic(ramp, size, 3.3, 2.7)).toBeCloseTo(3 * 3.3 + 2 * 2.7, 6);
        expect(bilinear(ramp, size, -5, -5)).toBe(0);
        expect(bilinear(ramp, size, 99, 99)).toBeCloseTo(3 * 7 + 2 * 7, 2);
    });
});

describe('Painted Ages baked badlands', () => {
    it('ships the three fields the manifest names, byte for byte', () => {
        expect(manifest.schema).toBe(BADLANDS_SCHEMA);
        expect(Object.keys(manifest.fields).sort()).toEqual([...FIELD_ORDER].sort());
        for (const name of FIELD_ORDER) {
            const entry = manifest.fields[name];
            expect(entry.size, name).toBe(FIELDS[name].size);
            expect(entry.bytes, name).toBe(files[name].length);
            expect(createHash('sha256').update(files[name]).digest('hex'), name).toBe(entry.sha256);
        }
    });

    it('decodes each PNG to its field\'s size, with heights inside the field\'s bounds', () => {
        for (const name of FIELD_ORDER) {
            const f = FIELDS[name];
            expect(images[name].width, name).toBe(f.size);
            expect(images[name].height, name).toBe(f.size);
            let lo = Infinity;
            let hi = -Infinity;
            for (const h of fields[name].heights) {
                lo = Math.min(lo, h);
                hi = Math.max(hi, h);
            }
            expect(lo, name).toBeGreaterThanOrEqual(f.lo);
            expect(hi, name).toBeLessThanOrEqual(f.hi);
            // A real landscape, not a flat or saturated image.
            expect(hi - lo, name).toBeGreaterThan(100);
            expect(lo, name).toBeGreaterThan(f.lo + 1);
            expect(hi, name).toBeLessThan(f.hi - 1);
        }
    });

    it('is loaded by module-relative URLs (packaged builds have no server root)', () => {
        for (const name of FIELD_ORDER) {
            expect(BADLANDS_URLS[name]).toMatch(new RegExp(`/assets/badlands-${name}\\.png$`));
            expect(BADLANDS_URLS[name]).toBe(assetUrl(`badlands-${name}.png`).href);
        }
    });

    it('is one surface: no step where a field hands over to the next one out', () => {
        for (const name of ['near', 'mid']) {
            const f = FIELDS[name];
            let worst = 0;
            for (const [axis, at] of [['x', f.x0], ['x', f.x0 + f.span], ['z', f.z0], ['z', f.z0 + f.span]]) {
                for (let s = 0.05; s < 0.96; s += 0.05) {
                    const across = (axis === 'x' ? f.z0 : f.x0) + s * f.span;
                    const at2 = (d) => (axis === 'x' ? [at + d, across] : [across, at + d]);
                    // Two centimetres across the edge: a continuous surface moves by its slope only.
                    const jump = groundHeight(fields, ...at2(-0.01)) - groundHeight(fields, ...at2(0.01));
                    worst = Math.max(worst, Math.abs(jump));
                    // And a walk across the blend band in metre steps never jumps.
                    let previous = groundHeight(fields, ...at2(-40));
                    for (let d = -39; d <= 40; d += 1) {
                        const h = groundHeight(fields, ...at2(d));
                        expect(Math.abs(h - previous), `${name} ${axis} = ${at}, ${d} m`).toBeLessThan(6);
                        previous = h;
                    }
                }
            }
            expect(worst, name).toBeLessThan(0.1);
        }
    });

    it('stands the eye a few metres above the overlook under it, never inside the land', () => {
        // (The overlook's height is still being tuned: about 10.8 m at the time of writing.)
        const under = ground(EYE.x, EYE.z);
        expect(EYE.y - under).toBeGreaterThan(4);
        expect(EYE.y - under).toBeLessThan(16);
        // Nothing within a few metres of the lens rises to it either.
        for (let a = 0; a < 360; a += 30) {
            for (const r of [2, 5, 10]) {
                const x = EYE.x + r * Math.sin((a * Math.PI) / 180);
                const z = EYE.z - r * Math.cos((a * Math.PI) / 180);
                expect(ground(x, z), `${r} m at ${a}°`).toBeLessThan(EYE.y - 1);
            }
        }
    });

    it('levels the pavilion\'s terrace under its whole base', () => {
        const half = 9.6 / 2;
        const c = Math.cos(PAVILION.yaw);
        const s = Math.sin(PAVILION.yaw);
        const heights = [];
        for (let a = -half; a <= half; a += 0.8) {
            for (let b = -half; b <= half; b += 0.8) {
                heights.push(ground(PAVILION.x + a * c + b * s, PAVILION.z - a * s + b * c));
            }
        }
        expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.35);
        expect(heights[0]).toBeCloseTo(PAVILION.y, 0);
    });

    it('keeps the river\'s bed near the eye at the plan\'s floor', () => {
        let checked = 0;
        for (let i = 0; i < RIVER.length - 1; i++) {
            const [ax, az] = RIVER[i];
            const [bx, bz] = RIVER[i + 1];
            for (let k = 0; k < 10; k++) {
                const x = ax + ((bx - ax) * k) / 10;
                const z = az + ((bz - az) * k) / 10;
                if (!inField(FIELDS.near, x, z) || Math.hypot(x - EYE.x, z - EYE.z) > 1500) continue;
                expect(Math.abs(ground(x, z) - riverFloor(z)), `(${x.toFixed(0)}, ${z.toFixed(0)})`).toBeLessThan(1.5);
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(30);
    });

    it('carries sky visibility and drainage, read from the finest field', () => {
        const crestSky = groundByte(fields, 'sky', EYE.x, EYE.z);
        expect(crestSky).toBeGreaterThan(0.5);
        expect(crestSky).toBeLessThanOrEqual(1);
        // The river drains the valley: its thalweg collects far more than the overlook's crown.
        const [rx, rz] = RIVER[8];
        expect(groundByte(fields, 'flow', rx, rz)).toBeGreaterThan(groundByte(fields, 'flow', EYE.x, EYE.z));
        expect(groundByte(fields, 'sky', 1e6, 1e6)).toBe(0);
    });
});

describe('Painted Ages plan', () => {
    it('is finite everywhere the fields reach, from the river up to the snow peaks', () => {
        let lo = Infinity;
        let hi = -Infinity;
        for (const name of FIELD_ORDER) {
            const f = FIELDS[name];
            for (let j = 0; j <= 24; j++) {
                for (let i = 0; i <= 24; i++) {
                    const h = planHeight(f.x0 + (i / 24) * f.span, f.z0 + (j / 24) * f.span);
                    expect(Number.isFinite(h), `${name} (${i}, ${j})`).toBe(true);
                    lo = Math.min(lo, h);
                    hi = Math.max(hi, h);
                }
            }
        }
        expect(lo).toBeGreaterThanOrEqual(FIELDS.far.lo);
        expect(hi).toBeLessThanOrEqual(FIELDS.far.hi);
        expect(hi).toBeGreaterThan(1500); // the snow range stands on the horizon
    });

    it('holds its hero forms: the pavilion terrace, the overlook under the eye', () => {
        expect(planHeight(PAVILION.x, PAVILION.z)).toBeCloseTo(PAVILION.y, 6);
        expect(planHeight(EYE.x, EYE.z)).toBeLessThan(EYE.y);
        expect(planHeight(EYE.x, EYE.z)).toBeGreaterThan(EYE.y - 40);
        // The spur runs out from the eye toward the pavilion, and down to it.
        expect(SPUR[0].z).toBeGreaterThan(SPUR[SPUR.length - 1].z);
        expect(SPUR.some((post) => post.x === PAVILION.x && post.z === PAVILION.z)).toBe(true);
        expect(softMax(0, 100, 10)).toBeCloseTo(100, 6);
        expect(softMax(5, 5, 10)).toBeGreaterThan(5);
    });

    it('runs the river along its course, falling toward the eye', () => {
        expect(RIVER_ALONG[0]).toBe(0);
        expect(RIVER_LENGTH).toBe(RIVER_ALONG[RIVER_ALONG.length - 1]);
        RIVER.forEach(([x, z], i) => {
            const at = riverDistance(x, z);
            expect(at.d, `point ${i}`).toBeCloseTo(0, 6);
            expect(at.along, `point ${i}`).toBeCloseTo(RIVER_ALONG[i], 3);
        });
        for (let z = 200; z > -9000; z -= 100) expect(riverFloor(z - 100)).toBeGreaterThanOrEqual(riverFloor(z));
        expect(riverFloor(-8000)).toBeGreaterThan(riverFloor(0) + 50);
    });

    it('stands in for the bake on a small grid when the images cannot be read', () => {
        const small = planField('near', 16);
        expect(small).toMatchObject({ size: 16, source: 'plan' });
        expect(small.heights).toHaveLength(256);
        expect(small.heights.every(Number.isFinite)).toBe(true);
        const plan = planBadlands(12);
        expect(plan.source).toBe('plan');
        for (const name of FIELD_ORDER) {
            expect(plan[name].size).toBe(FIELDS[name].size);
            expect(plan[name].heights).toHaveLength(FIELDS[name].size ** 2);
        }
        // The stand-in is the same land, unweathered: the eye still stands on its summit.
        expect(EYE.y - groundHeight(plan, EYE.x, EYE.z)).toBeGreaterThan(0);
    }, 20_000);
});

describe('Painted Ages: what stands on the land', () => {
    it('stands the poplars on level ground just above the river\'s floor', () => {
        const count = 110;
        const sites = poplarSites(fields, count);
        expect(sites.length).toBeGreaterThan(count / 2);
        expect(poplarSites(fields, count)).toEqual(sites);
        sites.forEach((s, i) => {
            expect(inField(FIELDS.near, s.x, s.z), `poplar ${i}`).toBe(true);
            expect(s.y, `poplar ${i}`).toBeCloseTo(ground(s.x, s.z), 6);
            expect(s.y - riverFloor(s.z), `poplar ${i} above the floor`).toBeLessThan(7.5);
            expect(s.y - riverFloor(s.z), `poplar ${i} not in the water`).toBeGreaterThan(-2);
            const slope = Math.max(
                Math.abs(ground(s.x + 3, s.z) - ground(s.x - 3, s.z)),
                Math.abs(ground(s.x, s.z + 3) - ground(s.x, s.z - 3)),
            ) / 6;
            expect(slope, `poplar ${i}`).toBeLessThan(0.15);
            expect(s.height).toBeGreaterThan(5);
        });
        for (let a = 0; a < sites.length; a++) {
            for (let b = a + 1; b < sites.length; b++) {
                expect(Math.hypot(sites[a].x - sites[b].x, sites[a].z - sites[b].z)).toBeGreaterThan(5);
            }
        }
    });

    it('finds the spur\'s crest from beyond the eye\'s platform out to the pavilion, without a jump', () => {
        const crest = findCrest(fields);
        expect(crest.length).toBeGreaterThan(40);
        const first = crest[0];
        const last = crest[crest.length - 1];
        // It starts out beyond the eye's own platform (below the frame), not at the lens.
        expect(Math.hypot(first.x - EYE.x, first.z - EYE.z)).toBeGreaterThan(25);
        expect(Math.hypot(last.x - PAVILION.x, last.z - PAVILION.z)).toBeLessThan(20);
        for (let i = 1; i < crest.length; i++) {
            const a = crest[i - 1];
            const b = crest[i];
            expect(Math.abs(b.y - a.y), `step ${i}`).toBeLessThan(6);
            expect(Math.hypot(b.x - a.x, b.z - a.z), `step ${i}`).toBeLessThan(6);
        }
        crest.forEach((p, i) => expect(p.y, `post ${i}`).toBeCloseTo(ground(p.x, p.z), 6));
    });
});
