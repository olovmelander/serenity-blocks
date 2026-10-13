/**
 * High Coast — the baked coast as it ships: the three field PNGs the manifest pins, decoded as the
 * theme decodes them, and the places the world stands things on (the eye on its summit, the pine
 * and the sign on the knoll, the hamlet on its island shore, the fleet's loops of open water, the
 * headland's sheer cliff). CPU only.
 *
 * The bake script (scripts/high-coast/bake-coast.mjs) is read as text, never imported: importing it
 * runs the bake and rewrites the assets. Its PNG codec (png.mjs) is the one read here. Hashes are
 * read from the manifest, so a re-bake needs no edit here.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    EYE, FIELDS, FIELD_ORDER, PLACES,
} from '../../src/themes/high-coast/high-coast-core.js';
import { decodeField, groundHeight, inField } from '../../src/themes/high-coast/high-coast-field.js';
import { COAST_SCHEMA, COAST_URLS } from '../../src/themes/high-coast/high-coast-assets.js';
import { LANES, boatPlace } from '../../src/themes/high-coast/high-coast-fleet.js';
import { decodePng } from '../../scripts/high-coast/png.mjs';

const assetUrl = (name) => new URL(`../../src/themes/high-coast/assets/${name}`, import.meta.url);
const manifest = JSON.parse(readFileSync(assetUrl('coast-manifest.json'), 'utf8'));
const bakeSource = readFileSync(new URL('../../scripts/high-coast/bake-coast.mjs', import.meta.url), 'utf8');

/** The three baked fields as the theme reads them (each PNG decoded once for the file). */
const files = {};
const images = {};
const fields = {};
for (const name of FIELD_ORDER) {
    files[name] = readFileSync(assetUrl(`coast-${name}.png`));
    images[name] = decodePng(files[name]);
    fields[name] = { ...decodeField(images[name].rgba, FIELDS[name]), size: FIELDS[name].size, source: 'asset' };
}
fields.source = 'asset';

/** The land's height as the props read it (bicubic). */
const ground = (x, z) => groundHeight(fields, x, z, true);
/** The rock under the eye by design: the plan's summit stands six metres below the lens. */
const SUMMIT_ROCK = EYE.y - 6;

describe('High Coast baked fields', () => {
    it('ships the three fields the manifest names, byte for byte', () => {
        expect(Object.keys(manifest.fields).sort()).toEqual([...FIELD_ORDER].sort());
        for (const name of FIELD_ORDER) {
            const entry = manifest.fields[name];
            expect(entry.size, name).toBe(FIELDS[name].size);
            expect(entry.bytes, name).toBe(files[name].length);
            expect(createHash('sha256').update(files[name]).digest('hex'), name).toBe(entry.sha256);
        }
    });

    it('is the schema the theme reads, and the one the bake writes', () => {
        expect(manifest.schema).toBe(COAST_SCHEMA);
        const written = /export const COAST_SCHEMA = (\d+);/.exec(bakeSource);
        expect(written, 'the bake declares its schema').not.toBeNull();
        expect(Number(written[1])).toBe(COAST_SCHEMA);
    });

    it('is loaded by module-relative URLs (packaged builds have no server root)', () => {
        for (const name of FIELD_ORDER) {
            expect(COAST_URLS[name]).toMatch(new RegExp(`/assets/coast-${name}\\.png$`));
            expect(COAST_URLS[name]).toBe(assetUrl(`coast-${name}.png`).href);
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
            // A real coast, not a flat or saturated image: sea floor below the sea, land above it.
            expect(lo, name).toBeGreaterThan(f.lo);
            expect(hi, name).toBeLessThan(f.hi);
            expect(lo, name).toBeLessThan(-20);
            expect(hi, name).toBeGreaterThan(100);
        }
    });
});

describe('High Coast baked places', () => {
    it('stands the eye four to eight metres above the summit rock under it, never inside the land', () => {
        const under = ground(EYE.x, EYE.z);
        expect(EYE.y - under).toBeGreaterThan(4);
        expect(EYE.y - under).toBeLessThan(8);
        for (let a = 0; a < 360; a += 30) {
            for (const r of [2, 5]) {
                const x = EYE.x + r * Math.sin((a * Math.PI) / 180);
                const z = EYE.z - r * Math.cos((a * Math.PI) / 180);
                expect(ground(x, z), `${r} m at ${a}°`).toBeLessThan(EYE.y - 2);
            }
        }
    });

    it('roots the old pine and the trail sign on the knoll, at the summit rock\'s height', () => {
        for (const name of ['pine', 'sign']) {
            const { x, z } = PLACES[name];
            expect(inField(FIELDS.near, x, z), name).toBe(true);
            const y = ground(x, z);
            expect(y, name).toBeGreaterThan(0);
            expect(Math.abs(y - SUMMIT_ROCK), `${name} stands at ${y.toFixed(2)} m`).toBeLessThan(2);
            // Below the lens: the eye looks down on the knoll.
            expect(y, name).toBeLessThan(EYE.y);
        }
    });

    it('sits the hamlet on land a little above the sea', () => {
        const { x, z } = PLACES.hamlet;
        const y = ground(x, z);
        expect(y, `the hamlet's yard at ${y.toFixed(2)} m`).toBeGreaterThan(1.5);
        expect(y, `the hamlet's yard at ${y.toFixed(2)} m`).toBeLessThan(15);
    });

    it('sails every fleet loop on water at least a metre and a half deep', () => {
        const shallow = [];
        LANES.forEach((lane, k) => {
            const [cx, cz, rx, rz, yaw] = lane;
            for (let i = 0; i < 64; i++) {
                const a = (i / 64) * Math.PI * 2;
                const lx = Math.cos(a) * rx;
                const lz = Math.sin(a) * rz;
                const x = cx + Math.cos(yaw) * lx - Math.sin(yaw) * lz;
                const z = cz + Math.sin(yaw) * lx + Math.cos(yaw) * lz;
                const y = ground(x, z);
                if (y > -1.5) shallow.push(`lane ${k} at (${x.toFixed(0)}, ${z.toFixed(0)}): ${y.toFixed(2)} m`);
            }
        });
        expect(shallow).toEqual([]);
        // The boats sail those loops: a boat's place is always on its lane's ellipse.
        LANES.forEach((lane, k) => {
            const [cx, cz, rx, rz, yaw] = lane;
            for (const t of [0, 13, 77, 400]) {
                const p = boatPlace(lane, 0.7, t);
                const dx = p.x - cx;
                const dz = p.z - cz;
                const u = (dx * Math.cos(yaw) + dz * Math.sin(yaw)) / rx;
                const v = (-dx * Math.sin(yaw) + dz * Math.cos(yaw)) / rz;
                expect(Math.hypot(u, v), `lane ${k}, t = ${t}`).toBeCloseTo(1, 9);
                expect(ground(p.x, p.z), `lane ${k}, t = ${t}`).toBeLessThan(-1.5);
            }
        });
    });

    it('breaks the headland\'s east face into a sheer cliff', () => {
        const f = FIELDS.near;
        const cell = f.span / (f.size - 1);
        let steepest = 0;
        for (let z = PLACES.cliff.z - 300; z <= PLACES.cliff.z + 300; z += 10) {
            for (let x = PLACES.cliff.x - 40; x <= PLACES.cliff.x + 40; x += 5) {
                const sx = (ground(x + cell, z) - ground(x - cell, z)) / (2 * cell);
                const sz = (ground(x, z + cell) - ground(x, z - cell)) / (2 * cell);
                steepest = Math.max(steepest, Math.hypot(sx, sz));
            }
        }
        expect(steepest).toBeGreaterThan(1.5);
        // A cliff that stands up out of the sea: its crown high above the water.
        expect(ground(PLACES.cliff.x, PLACES.cliff.z)).toBeGreaterThan(50);
    });
});
