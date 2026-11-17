/**
 * Synthwave Sunset — the people on the pier (scripts/blender/synthwave_strollers.py →
 * src/themes/synthwave-sunset/assets/strollers.glb; posed by synthwave-sunset-strollers.js, drawn
 * by synthwave-sunset-people.js). The model must be the file the manifest records, each figure a
 * person on the shared skeleton, light enough for one draw; the poser must keep everyone on the
 * deck with their feet planted, walk the same way at the same time, and turn heads to a burst.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    DECK, STROLLER_BONES, STROLLER_PARENTS, STROLLER_PARTIES, STROLLER_ROW, STROLL_ROUTES, StrollerLife, cycleCurve,
    loopPoint, pierPlane, strollLoop, strollerCast, strollTimeline, strollAt, swingOf,
} from '../../src/themes/synthwave-sunset/synthwave-sunset-strollers.js';
import {
    SynthwavePeople, buildCastGeometry, strollerFiguresFromGltf,
} from '../../src/themes/synthwave-sunset/synthwave-sunset-people.js';
import { PAVILIONS } from '../../src/themes/synthwave-sunset/synthwave-sunset-pier.js';
import { PIER, PIER_HEAD, pierFrame } from '../../src/themes/synthwave-sunset/synthwave-sunset-layout.js';
import { WORLD_QUALITY, createWorldUniforms } from '../../src/themes/synthwave-sunset/synthwave-sunset-world.js';
import { qRotate } from '../../src/themes/shared/fox-rig.js';

const assets = new URL('../../src/themes/synthwave-sunset/assets/', import.meta.url);
const read = (file) => readFileSync(new URL(file, assets));
const manifest = JSON.parse(read('asset-manifest.json').toString('utf8'));
const entry = manifest.assets.find((a) => a.file === 'strollers.glb');

let cached = null;
async function figures() {
    if (cached) return cached;
    const bytes = read('strollers.glb');
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    cached = strollerFiguresFromGltf(await new GLTFLoader().parseAsync(buffer, ''));
    return cached;
}
async function lifeOf(count) {
    const f = await figures();
    const rigs = Object.fromEntries(Object.entries(f).map(([name, fig]) => [name, fig.rig]));
    return new StrollerLife({ plane: pierPlane(pierFrame()), count, rigs });
}
const FIGURES = ['boater', 'boy', 'chinos', 'girl', 'midi', 'shorts', 'slacks', 'sundress'];

describe('synthwave-sunset strollers: the model', () => {
    it('is the file the manifest records, light enough for one draw of everyone', () => {
        const bytes = read('strollers.glb');
        expect(entry).toBeTruthy();
        expect(bytes.length).toBe(entry.bytes);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
        expect(bytes.length).toBeLessThan(600_000);
        expect(entry.figures.map((f) => f.name).sort()).toEqual(FIGURES);
        for (const f of entry.figures) {
            expect(f.triangles).toBeGreaterThan(800);
            expect(f.triangles).toBeLessThan(2400);
        }
        expect(entry.bones).toEqual([...STROLLER_BONES]);
        expect(entry.parents).toEqual([...STROLLER_PARENTS]);
        expect(read('ATTRIBUTION.md').toString('utf8')).toMatch(/synthwave_strollers\.py/);
        // The gull keeps its entry (and stays first: its own test reads it so).
        expect(manifest.assets[0].file).toBe('gull.glb');
    });

    it('holds eight people on the skeleton: standing on y = 0, facing +z, their bones and dress in reach', async () => {
        const f = await figures();
        expect(Object.keys(f).sort()).toEqual(FIGURES);
        for (const [name, { geometry, rig }] of Object.entries(f)) {
            geometry.computeBoundingBox();
            const { min, max } = geometry.boundingBox;
            expect(min.y, name).toBeCloseTo(0, 2);
            const child = name === 'boy' || name === 'girl';
            expect(max.y, name).toBeGreaterThan(child ? 1.1 : 1.6);
            expect(max.y, name).toBeLessThan(child ? 1.3 : 1.9);
            expect(rig.height, name).toBeGreaterThan(child ? 1.1 : 1.6);
            // Left and right mirror; the toes lead.
            expect(max.x + min.x, name).toBeCloseTo(0, 1);
            expect(max.z, name).toBeGreaterThan(0.1);
            const bones = geometry.getAttribute('_bones');
            const paint = geometry.getAttribute('_paint');
            for (let i = 0; i < bones.count; i += 1) {
                expect(Number.isInteger(bones.getX(i)) && bones.getX(i) >= 0 && bones.getX(i) < 13).toBe(true);
                expect(Number.isInteger(bones.getY(i)) && bones.getY(i) >= 0 && bones.getY(i) < 13).toBe(true);
                expect(bones.getZ(i)).toBeGreaterThanOrEqual(0);
                expect(bones.getZ(i)).toBeLessThanOrEqual(1);
                expect(Number.isInteger(paint.getX(i)) && paint.getX(i) >= 0 && paint.getX(i) <= 6).toBe(true);
                expect(paint.getY(i)).toBeGreaterThanOrEqual(0.5);
                expect(paint.getY(i)).toBeLessThanOrEqual(1);
            }
            // The rig sits in the figure: hips over the knees over the ankles, arms at the sides.
            const [hips, , head, thighL, shinL, footL, , , , armL] = rig.rest;
            expect(head[1]).toBeGreaterThan(hips[1]);
            expect(thighL[1]).toBeGreaterThan(shinL[1]);
            expect(shinL[1]).toBeGreaterThan(footL[1]);
            expect(armL[0]).toBeGreaterThan(thighL[0]);
        }
    });
});

describe('synthwave-sunset strollers: the cast and its walks', () => {
    it('puts out each tier\'s count of people, dressed the same at the same count', () => {
        for (const tier of Object.values(WORLD_QUALITY)) {
            const { people } = strollerCast(tier.strollers);
            expect(people).toHaveLength(tier.strollers);
        }
        expect(WORLD_QUALITY.High.strollers).toBeLessThanOrEqual(12);
        // Most of them walk, and some on the stretches nearest the eye.
        const high = strollerCast(WORLD_QUALITY.High.strollers);
        const walking = high.people.filter((p) => high.parties[p.party].route);
        expect(walking.length).toBeGreaterThanOrEqual(8);
        expect(new Set(high.parties.filter((p) => p.route).map((p) => p.route))).toEqual(new Set(['full', 'gate', 'mid', 'far', 'door']));
        expect(strollerCast(10)).toEqual(strollerCast(10));
        // Every member is a figure the model holds, coloured in every slot.
        const { people } = strollerCast(14);
        for (const person of people) {
            expect(FIGURES).toContain(person.figure);
            expect(person.colours).toHaveLength(7);
            person.colours.forEach((c) => c.forEach((v) => expect(v).toBeGreaterThanOrEqual(0)));
        }
    });

    it('walks loops on the deck that pass the pavilions through their doors, never their walls', () => {
        const pavilionAt = (s) => PAVILIONS.find((pv) => Math.abs(s - pv.s) < pv.along / 2);
        for (const party of STROLLER_PARTIES.filter((p) => p.route)) {
            const loop = strollLoop(party);
            expect(loop.r).toBeGreaterThan(0.4);
            for (let u = 0; u < loop.length; u += 0.25) {
                const pt = loopPoint(loop, u);
                expect(Math.hypot(pt.ds, pt.dc)).toBeCloseTo(1, 5);
                // Between the pier head and the land end (turning there past the view's edge).
                expect(pt.s).toBeGreaterThan(PIER_HEAD.s1);
                expect(pt.s).toBeLessThan(pierFrame().length - 0.3);
                const widest = Math.max(...party.members.map((m) => Math.abs(m.offset ?? 0)));
                expect(Math.abs(pt.c) + widest).toBeLessThan(DECK.rail - 0.25);
                // Through a pavilion only by its end walls: the lane inside its width all the way.
                const pv = pavilionAt(pt.s);
                if (pv) expect(Math.abs(pt.c) + widest, `${party.name} at s ${pt.s.toFixed(1)}`).toBeLessThan(pv.across / 2 - 0.2);
            }
            // The loop closes on itself.
            const a = loopPoint(loop, 0);
            const b = loopPoint(loop, loop.length - 1e-6);
            expect(Math.hypot(a.s - b.s, a.c - b.c)).toBeLessThan(1e-3);
        }
        expect(Object.keys(STROLL_ROUTES).sort()).toEqual(['door', 'far', 'full', 'gate', 'mid']);
    });

    it('stops where it says, eases in and out of a stop, and keeps going round', () => {
        for (const party of STROLLER_PARTIES.filter((p) => p.route)) {
            const timeline = strollTimeline(party);
            let last = null;
            for (let t = 0; t < timeline.period * 2; t += 0.1) {
                const at = strollAt(timeline, party, t);
                expect(at.pace).toBeGreaterThanOrEqual(0);
                expect(at.pace).toBeLessThanOrEqual(1);
                if (last) {
                    // Never faster than its pace, never back.
                    const step = at.walked - last.walked;
                    expect(step).toBeGreaterThanOrEqual(-1e-9);
                    expect(step).toBeLessThanOrEqual(party.speed * 0.1 + 1e-6);
                }
                last = at;
            }
            // A whole period walks the whole loop once.
            const a = strollAt(timeline, party, 3);
            const b = strollAt(timeline, party, 3 + timeline.period);
            expect(b.walked - a.walked).toBeCloseTo(timeline.loop.length, 6);
        }
    });
});

describe('synthwave-sunset strollers: the poses', () => {
    it('sets everyone down on the deck with their feet planted, on every tier, for minutes', async () => {
        const life = await lifeOf(WORLD_QUALITY.Extreme.strollers);
        const data = new Float32Array(STROLLER_ROW * life.people.length * 4);
        for (let t = 0; t < 240; t += 0.37) {
            life.write(t, data);
            for (let i = 0; i < data.length; i += 1) expect(Number.isFinite(data[i])).toBe(true);
            // Every rotation a unit quaternion.
            for (let r = 0; r < life.people.length * 13; r += 1) {
                const o = r * 8;
                expect(Math.hypot(data[o], data[o + 1], data[o + 2], data[o + 3])).toBeCloseTo(1, 4);
            }
            life.state.forEach((st) => {
                // The lowest heel or toe on the deck: the root lifted to it, within a step's rise.
                expect(st.lift).toBeGreaterThan(DECK.y - 0.12);
                expect(st.lift).toBeLessThan(DECK.y + 0.04);
                // On the pier: inside its rails, between the head and the land.
                const P = life.plane;
                const s = (st.x - P.fx) * P.ax + (st.z - P.fz) * P.az;
                const c = (st.x - P.fx) * P.cx + (st.z - P.fz) * P.cz;
                expect(s).toBeGreaterThan(PIER_HEAD.s0);
                expect(s).toBeLessThan(pierFrame().length);
                expect(Math.abs(c)).toBeLessThan(Math.max(PIER.width / 2, s < PIER_HEAD.s1 ? PIER_HEAD.halfAcross : 0));
            });
        }
    });

    it('has someone walking near the eye most of the time, not only far out', async () => {
        // Pier metres the 16:9 game view sees (the camera's projection): left of the board, and
        // nearer, between the board and the HUD, beside the first pavilion, at the right edge.
        const far = [-9, 88];
        const near = [[120, 125.5], [133, 140.5], [151.5, 158]];
        const life = await lifeOf(WORLD_QUALITY.High.strollers);
        const data = new Float32Array(STROLLER_ROW * life.people.length * 4);
        const P = life.plane;
        let seenNear = 0;
        let seenFar = 0;
        const frames = 1200;
        for (let t = 0; t < frames; t += 1) {
            life.write(t, data);
            let n = 0;
            let f = 0;
            life.state.forEach((st) => {
                if (!st.walking || st.pace < 0.3) return;
                const s = (st.x - P.fx) * P.ax + (st.z - P.fz) * P.az;
                if (near.some(([lo, hi]) => s >= lo && s <= hi)) n += 1;
                if (s >= far[0] && s <= far[1]) f += 1;
            });
            if (n > 0) seenNear += 1;
            if (f > 0) seenFar += 1;
        }
        expect(seenNear / frames).toBeGreaterThan(0.8);
        expect(seenFar / frames).toBeGreaterThan(0.9);
    });

    it('keeps a walker\'s foot still on the deck while it bears the weight', async () => {
        const life = await lifeOf(4);
        const data = new Float32Array(STROLLER_ROW * life.people.length * 4);
        const w = life.people.findIndex((p) => life.parties[p.party].name === 'capped');
        const party = life.parties[life.people[w].party];
        expect(party.stops).toEqual([]);
        let first = null;
        let last = null;
        for (let t = 40; t < 42; t += 1 / 120) {
            life.pose(w, t, data, w * STROLLER_ROW * 4);
            const st = life.state[w];
            const phase = (((st.walked / st.stride + life.people[w].seed * 0.37) % 1) + 1) % 1;
            const ankle = life._wj[8];
            const along = ankle[0] * Math.sin(st.heading) + ankle[2] * Math.cos(st.heading);
            if (phase > 0.08 && phase < 0.45) {
                if (first === null) first = along;
                last = along;
            } else if (first !== null && phase > 0.45) break;
        }
        expect(first).not.toBeNull();
        expect(Math.abs(last - first)).toBeLessThan(0.05);
    });

    it('builds the gait from curves that close on themselves and a swing that fits the stride', () => {
        const keys = [[0, 1], [0.3, -0.5], [0.7, 0.4]];
        expect(cycleCurve(keys, 0)).toBeCloseTo(1, 6);
        expect(cycleCurve(keys, 1)).toBeCloseTo(1, 6);
        expect(cycleCurve(keys, 0.3)).toBeCloseTo(-0.5, 6);
        expect(cycleCurve(keys, -0.7)).toBeCloseTo(cycleCurve(keys, 0.3), 6);
        // The thigh's swing grows with the stride and stays a person's.
        const short = swingOf(1.0, 0.8);
        const long = swingOf(1.4, 0.8);
        expect(long).toBeGreaterThan(short);
        expect(long).toBeLessThan(0.6);
        expect(0.8 * (Math.sin(short) + Math.sin(0.62 * short))).toBeCloseTo(0.5, 3);
    });

    it('poses the same at the same time, and turns heads up to a burst', async () => {
        const a = await lifeOf(10);
        const b = await lifeOf(10);
        const da = new Float32Array(STROLLER_ROW * 10 * 4);
        const db = new Float32Array(STROLLER_ROW * 10 * 4);
        b.write(80, db);
        a.write(12, da);
        a.write(80, da);
        expect(Array.from(da)).toEqual(Array.from(db));

        const life = await lifeOf(10);
        const data = new Float32Array(STROLLER_ROW * 10 * 4);
        const i = life.people.findIndex((p) => life.parties[p.party].name === 'couple');
        const burst = [-14, 80, -182];
        life.pose(i, 30, data, i * STROLLER_ROW * 4);
        const before = qRotate(life._wq[2], [0, 0, 1]);
        life.notice(...burst, 30, 1.5);
        life.pose(i, 31.6, data, i * STROLLER_ROW * 4);
        const after = qRotate(life._wq[2], [0, 0, 1]);
        const st = life.state[i];
        const to = [burst[0] - st.x, burst[1] - DECK.y - 1.6, burst[2] - st.z];
        const n = Math.hypot(...to);
        const dot = (v) => (v[0] * to[0] + v[1] * to[1] + v[2] * to[2]) / n;
        expect(dot(after)).toBeGreaterThan(0.9);
        expect(dot(after)).toBeGreaterThan(dot(before));
        // It passes: a few seconds on they look about them again.
        life.pose(i, 40, data, i * STROLLER_ROW * 4);
        expect(dot(qRotate(life._wq[2], [0, 0, 1]))).toBeLessThan(0.9);
        life.reset();
        expect(life.looks.every((l) => l.weight === 0)).toBe(true);
    });
});

describe('synthwave-sunset strollers: the draw', () => {
    it('dresses the cast into one mesh on the mirror layer, skinned from a row each, and lets it go', async () => {
        const f = await figures();
        const u = createWorldUniforms();
        const people = new SynthwavePeople(u, { count: 10, mirrorLayer: 3 });
        expect(people.group.children).toHaveLength(0);
        expect(people.attach(f)).toBe(true);
        expect(people.attach(f)).toBe(false);
        const { mesh, table } = people;
        expect(mesh.layers.isEnabled(3)).toBe(true);
        expect(table.image.width).toBe(STROLLER_ROW);
        expect(table.image.height).toBe(10);
        const skin = mesh.geometry.getAttribute('aSkin');
        const rows = new Set();
        for (let k = 0; k < skin.count; k += 1) rows.add(skin.getW(k));
        expect([...rows].sort((x, y) => x - y)).toEqual([...Array(10).keys()]);
        // Its vertices are the people's figures, and nothing more.
        const expected = people.life.people.reduce((sum, p) => sum + f[p.figure].geometry.getAttribute('position').count, 0);
        expect(mesh.geometry.getAttribute('position').count).toBe(expected);
        const geometry = buildCastGeometry(people.life, f);
        expect(geometry.index.count % 3).toBe(0);
        people.update(12);
        expect(people.data.some((v) => v !== 0)).toBe(true);
        people.dispose();
        expect(people.mesh).toBeNull();
        // None at all: nothing is built.
        const none = new SynthwavePeople(u, { count: 0 });
        expect(none.attach(f)).toBe(false);
        expect(new THREE.Group().add(none.group).children).toHaveLength(1);
    });
});
