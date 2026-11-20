/**
 * Painted Ages' bearded vultures — where and when they fly (painted-ages-vulture-routes.js, run
 * here in plain numbers) and the part that draws them (painted-ages-vultures.js).
 *
 * Every visit of the timetable is walked through the rest lens of the frames the theme is shown
 * in: it comes in over an edge and leaves over an edge (of the widest frame of its framing too),
 * and no bird's span ever reaches over the board card or the HUD. The flight is a closed form of
 * the clock (a seek lands on the same rows), a bird's pace and heading never jump, and they fly
 * only by day.
 */
import { readFileSync } from 'node:fs';
import {
    afterAll, beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    EYE, FIELDS, FIELD_ORDER, RIG, rigFor,
} from '../../src/themes/painted-ages/painted-ages-core.js';
import { decodeField, groundHeight } from '../../src/themes/painted-ages/painted-ages-field.js';
import { HOURS, lightAt } from '../../src/themes/painted-ages/painted-ages-hours.js';
import { frameNdc } from '../../src/themes/painted-ages/painted-ages-life.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/painted-ages/painted-ages-quality.js';
import { createNoiseTexture, createUniforms } from '../../src/themes/painted-ages/painted-ages-tsl.js';
import { PAINTED_AGES_VULTURE } from '../../src/themes/painted-ages/painted-ages-vulture-model.js';
import {
    VULTURE_FLIGHT, VULTURE_FRAMES, VULTURE_MOST, VULTURE_PASSES, VULTURE_ROWS, VULTURE_SEED, VULTURE_SPAN,
    VULTURE_THERMALS, VULTURE_TIMES, createVultureVisit, layVulturePass, layVultureThermal, vultureChance,
    vultureDaylight, vultureFraming, vultureKeepOut, vultureLens, vultureOnArc, vulturePassAt, vulturePassEpoch,
    vulturePlace, vultureRows, vultureThermalAt, vultureThermalEpoch, vultureWings, watchVultureVisit,
} from '../../src/themes/painted-ages/painted-ages-vulture-routes.js';
import { VULTURE_LIGHT, createVultures, vultureModel } from '../../src/themes/painted-ages/painted-ages-vultures.js';
import { decodePng } from '../../scripts/painted-ages/png.mjs';
import { build, unassignedReads } from './helpers/tsl-node-build.js';

const TAU = Math.PI * 2;
const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
/** The frames a visit is walked through, per framing: the usual one first, then others it is shown in. */
const FRAMES = {
    landscape: [[1600, 900], [1920, 1080], [1024, 768], [1280, 800], [1890, 900]],
    wide: [[2560, 1080], [3440, 1440], [3840, 1080]],
    portrait: [[390, 844], [360, 800], [414, 736], [600, 844]],
};
/** The cycles of the timetable walked (five hours of play). */
const CYCLES = 100;
let fields;
const owned = [];

beforeAll(() => {
    fields = {};
    for (const name of FIELD_ORDER) {
        const file = new URL(`../../src/themes/painted-ages/assets/badlands-${name}.png`, import.meta.url);
        const { rgba } = decodePng(readFileSync(file));
        fields[name] = { ...decodeField(rgba, FIELDS[name]), size: FIELDS[name].size, source: 'asset' };
    }
});

afterAll(() => {
    owned.forEach((part) => part.dispose());
});

/** Every visit worth walking: each framing, the timetable's own choices and every side and way by hand. */
function visits(kind, framing, cycles = CYCLES) {
    const out = [];
    for (let number = 0; number < cycles; number += 1) {
        for (const side of number < 12 ? [0, -1, 1] : [0]) {
            for (const way of kind === 'pass' && number < 12 ? [1, -1] : [0]) {
                const visit = createVultureVisit();
                if (kind === 'thermal') layVultureThermal(visit, number, framing, VULTURE_MOST, side);
                else layVulturePass(visit, number, framing, side, way);
                out.push({ visit, name: `${kind} ${number} ${framing} side ${side} way ${way}` });
            }
        }
    }
    return out;
}

function makePart(quality = 'High', light = {}) {
    const u = createUniforms();
    u.aspect.value = light.aspect ?? 16 / 9;
    u.sunUp.value = light.sunUp ?? 1;
    u.dusk.value = light.dusk ?? 0;
    const part = createVultures(u, { noise: createNoiseTexture() }, tierFor(quality), fields);
    owned.push(part);
    return { part, u };
}

const rowsOf = (part) => part.table.map((row) => row.toArray());

describe('Painted Ages vulture lens and keep-out', () => {
    it('projects as the theme\'s own rest pose does, in every framing', () => {
        for (const aspect of [16 / 9, 4 / 3, 21 / 9, 32 / 9, 390 / 844, 0.6]) {
            const lens = vultureLens(aspect);
            const rig = rigFor(aspect);
            for (const [x, y, z] of [[-212, 240, -486], [356, 280, -690], [-40, 178, -60], [20, 318, -560], [900, 20, -3000]]) {
                const mine = lens.project(x, y, z);
                const ndc = frameNdc(x, y, z, rig, aspect);
                expect(mine.x).toBeCloseTo(0.5 + ndc.x / 2, 9);
                expect(mine.y).toBeCloseTo(0.5 - ndc.y / 2, 9);
                expect(mine.depth > 1).toBe(ndc.ahead);
            }
            // ... and as three's own camera does, posed as the world poses it.
            const camera = new THREE.PerspectiveCamera(rig.fov, aspect, RIG.near, RIG.far);
            camera.position.set(EYE.x, EYE.y, EYE.z);
            camera.rotation.set((rig.pitch * Math.PI) / 180, (-rig.yaw * Math.PI) / 180, 0, 'YXZ');
            camera.updateProjectionMatrix();
            camera.updateMatrixWorld();
            const p = new THREE.Vector3(-212, 240, -486).project(camera);
            const mine = lens.project(-212, 240, -486);
            expect(mine.x).toBeCloseTo(0.5 + p.x / 2, 6);
            expect(mine.y).toBeCloseTo(0.5 - p.y / 2, 6);
        }
        expect(vultureFraming(16 / 9)).toBe('landscape');
        expect(vultureFraming(21 / 9)).toBe('wide');
        expect(vultureFraming(390 / 844)).toBe('portrait');
        // Each framing's widest frame is still that framing's lens.
        for (const [framing, frame] of Object.entries(VULTURE_FRAMES)) {
            expect(vultureFraming(frame.aspect)).toBe(framing);
            expect(vultureFraming(frame.widest)).toBe(framing);
            expect(frame.widest).toBeGreaterThan(frame.aspect);
        }
    });

    it('keeps off the board card and the HUD as the solo layout stands them', () => {
        const [card, hud] = vultureKeepOut(1600, 900);
        // (The brief's numbers: the card about x 0.39 to 0.61, full height; the HUD 0.65 to 0.735, y 0.25 to 0.75.)
        expect(card.x0).toBeCloseTo(0.39, 2);
        expect(card.x1).toBeCloseTo(0.61, 2);
        expect([card.y0, card.y1]).toEqual([0, 1]);
        expect(hud.x0).toBeCloseTo(0.65, 2);
        expect(hud.x1).toBeCloseTo(0.735, 2);
        expect(hud.y0).toBeLessThanOrEqual(0.25);
        expect(hud.y1).toBeGreaterThanOrEqual(0.75);
        // An upright phone: the card alone, with the strips of picture above and below it left open.
        const phone = vultureKeepOut(390, 844);
        expect(phone).toHaveLength(1);
        expect(phone[0].y0).toBeGreaterThan(0.1);
        expect(phone[0].y1).toBeLessThan(0.9);
        expect(phone[0].x0).toBeLessThan(0.2);
        expect(vultureKeepOut(2560, 1080)).toHaveLength(2);
    });
});

describe('Painted Ages vulture timetable', () => {
    it('is the clock\'s alone: the same visit for the same second, whatever was asked before', () => {
        const T = VULTURE_TIMES;
        const asked = [];
        for (let t = 0; t < T.cycle * 12; t += 3.7) asked.push(t);
        const forward = asked.map((t) => [vultureThermalAt(t), vulturePassAt(t)]);
        const backward = asked.slice().reverse().map((t) => [vultureThermalAt(t), vulturePassAt(t)]).reverse();
        expect(backward).toEqual(forward);
        expect(source('src/themes/painted-ages/painted-ages-vulture-routes.js')).not.toMatch(/Math\.random|Date\.now|performance\./);
        expect(source('src/themes/painted-ages/painted-ages-vultures.js')).not.toMatch(/Math\.random|Date\.now|performance\./);
        // A chance is a hash: in 0..1, the same for the same counters, spread evenly.
        let sum = 0;
        for (let k = 0; k < 2000; k += 1) {
            const c = vultureChance(VULTURE_SEED, k, 7);
            expect(c).toBeGreaterThanOrEqual(0);
            expect(c).toBeLessThan(1);
            expect(vultureChance(VULTURE_SEED, k, 7)).toBe(c);
            sum += c;
        }
        expect(sum / 2000).toBeGreaterThan(0.45);
        expect(sum / 2000).toBeLessThan(0.55);
    });

    it('flies a thermal every two to three minutes, and a pass in most of those cycles', () => {
        const T = VULTURE_TIMES;
        expect(T.cycle).toBeGreaterThanOrEqual(120);
        expect(T.cycle).toBeLessThanOrEqual(180);
        let passes = 0;
        for (let n = 0; n < CYCLES; n += 1) {
            const thermal = vultureThermalEpoch(n);
            expect(thermal).toBeGreaterThanOrEqual(n * T.cycle + T.thermal[0]);
            expect(thermal).toBeLessThanOrEqual(n * T.cycle + T.thermal[0] + T.thermal[1]);
            expect(vultureThermalAt(thermal)).toBe(n);
            expect(vultureThermalAt(thermal - T.thermalWindow[0] + 0.01)).toBe(n);
            expect(vultureThermalAt(thermal + T.thermalWindow[1] - 0.01)).toBe(n);
            const pass = vulturePassEpoch(n);
            if (pass < 0) {
                expect(vulturePassAt(n * T.cycle + T.pass[0] + T.pass[1] / 2)).toBe(-1);
                continue;
            }
            passes += 1;
            expect(pass).toBeGreaterThanOrEqual(n * T.cycle + T.pass[0]);
            expect(pass).toBeLessThanOrEqual(n * T.cycle + T.pass[0] + T.pass[1]);
            expect(vulturePassAt(pass)).toBe(n);
        }
        expect(passes / CYCLES).toBeGreaterThan(T.passShare - 0.15);
        expect(passes / CYCLES).toBeLessThan(T.passShare + 0.15);
        // The windows of two cycles never meet (so one table of rows serves each kind), and the
        // first thermal leaves the opening seconds of a session to the land.
        expect(T.thermalWindow[0] + T.thermalWindow[1] + T.thermal[1]).toBeLessThan(T.cycle);
        expect(T.passWindow[0] + T.passWindow[1] + T.pass[1]).toBeLessThan(T.cycle);
        expect(vultureThermalEpoch(0)).toBeGreaterThan(30);
        expect(vultureThermalAt(-5)).toBe(-1);
    });

    it('is seen only while the sun is up', () => {
        expect(vultureDaylight(1, 0)).toBe(1);
        expect(vultureDaylight(0, 0)).toBe(0);
        expect(vultureDaylight(1, 1)).toBe(0);
        expect(vultureDaylight(1, 0.5)).toBe(0);
        expect(vultureDaylight(0.4, 0)).toBe(0);
        let last = 0;
        for (let s = 0; s <= 1.0001; s += 0.05) {
            const day = vultureDaylight(s, 0);
            expect(day).toBeGreaterThanOrEqual(last);
            last = day;
            expect(vultureDaylight(1, s)).toBeLessThanOrEqual(vultureDaylight(1, Math.max(0, s - 0.05)));
        }
        // By the theme's own hours: every hour of sun flies them, the blue hour none.
        HOURS.forEach((hour, k) => {
            const light = lightAt(k);
            expect(vultureDaylight(light.sunUp, 0), hour.name).toBe(hour.name === 'blue hour' ? 0 : 1);
        });
    });
});

describe('Painted Ages vulture routes', () => {
    it('lays a thermal as two to four birds, each on its own circle, height, phase and pace', () => {
        const seen = { sides: new Set(), counts: new Set(), turns: new Set() };
        for (const { visit, name } of visits('thermal', 'landscape')) {
            seen.sides.add(visit.side);
            seen.counts.add(visit.count);
            expect(visit.kind).toBe('thermal');
            expect(visit.count, name).toBeGreaterThanOrEqual(2);
            expect(visit.count, name).toBeLessThanOrEqual(VULTURE_MOST);
            const birds = visit.birds.slice(0, visit.count);
            birds.forEach((bird, i) => {
                seen.turns.add(Math.sign(bird.omega));
                // Wide slow circles: 50 to 140 m across the radius, 20 to 32 s a turn, banked into it.
                expect(bird.radius, name).toBeGreaterThan(50);
                expect(bird.radius, name).toBeLessThan(140);
                const period = TAU / Math.abs(bird.omega);
                expect(period, name).toBeGreaterThan(20);
                expect(period, name).toBeLessThan(32);
                expect(bird.bank).toBeGreaterThan(0.35);
                expect(bird.bank).toBeLessThan(0.65);
                // A turn and a half or so on the circle (the first now and then one more), climbing.
                const turns = (bird.tOut - bird.tIn) / period;
                expect(turns, name).toBeGreaterThan(1.2);
                expect(turns, name).toBeLessThan(i === 0 ? 2.9 : 1.9);
                expect(bird.climb).toBeGreaterThan(0);
                expect(bird.driftX).toBeGreaterThan(0); // downwind, as the cloud deck drifts
                expect(bird.driftZ).toBeLessThan(0);
                expect(Math.hypot(bird.driftX, bird.driftZ)).toBeLessThan(1);
                // Each joins a few seconds after the one before, a little higher up the column.
                if (i) {
                    expect(bird.tIn - birds[i - 1].tIn).toBeGreaterThanOrEqual(4);
                    expect(bird.tIn - birds[i - 1].tIn).toBeLessThanOrEqual(6.5);
                    expect(bird.y).toBeGreaterThan(birds[i - 1].y);
                    expect(bird.seed).not.toBe(birds[i - 1].seed);
                    expect(Math.abs(bird.radius - birds[i - 1].radius)).toBeGreaterThan(1e-6);
                }
                // Drawn larger than life, as far birds are; a burst of flaps coming in and one setting off.
                expect(bird.size).toBeGreaterThan(4);
                expect(bird.size).toBeLessThan(9);
                expect(bird.flapA).toBeLessThan(bird.tIn);
                expect(bird.flapB).toBeGreaterThan(bird.tOut);
                expect(bird.flapB).toBeLessThan(bird.tOut + 2.5);
            });
            expect(birds.every((bird) => Math.sign(bird.omega) === Math.sign(birds[0].omega))).toBe(true);
        }
        expect([...seen.sides].sort()).toEqual([-1, 1]);
        expect([...seen.counts].sort()).toEqual([2, 3, 4]);
        expect([...seen.turns].sort()).toEqual([-1, 1]);
        // A tier with two birds flies two.
        const two = layVultureThermal(createVultureVisit(), 3, 'landscape', 2);
        expect(two.count).toBe(2);
        // The sites: the left third and the right third in landscape, the top strip upright.
        expect(VULTURE_THERMALS.landscape.map((s) => s.side).sort()).toEqual([-1, -1, 1, 1]);
        const lens = vultureLens(16 / 9);
        for (const site of VULTURE_THERMALS.landscape) {
            const at = lens.project(site.x, site.base + 30, site.z);
            if (site.side < 0) expect(at.x).toBeLessThan(0.3);
            else expect(at.x).toBeGreaterThan(0.8);
            expect(at.y).toBeLessThan(0.3); // in the sky, or against the far ranges
            expect(Math.hypot(site.x, site.z)).toBeGreaterThan(400);
            expect(Math.hypot(site.x, site.z)).toBeLessThan(1200);
        }
        const upright = vultureLens(390 / 844);
        const [card] = vultureKeepOut(390, 844);
        for (const site of VULTURE_THERMALS.portrait) expect(upright.project(site.x, site.base, site.z).y).toBeLessThan(card.y0);
    });

    it('lays a pass as one bird on one arc, either way along it, on either side', () => {
        const ways = new Set();
        for (const { visit, name } of visits('pass', 'landscape')) {
            expect(visit.kind).toBe('pass');
            expect(visit.count).toBe(1);
            const [bird] = visit.birds;
            ways.add(`${visit.side}:${Math.sign(bird.omega)}`);
            expect(bird.tIn).toBe(0);
            // Six to twelve seconds on the arc, banking gently, at a glide's pace for its size.
            expect(bird.tOut, name).toBeGreaterThan(6);
            expect(bird.tOut, name).toBeLessThan(18);
            expect(bird.bank).toBeLessThan(0.6);
            const pace = Math.abs(bird.omega) * bird.radius;
            expect(pace / (bird.size * VULTURE_SPAN)).toBeGreaterThan(0.7); // spans a second
            expect(pace / (bird.size * VULTURE_SPAN)).toBeLessThan(2);
            expect(bird.driftX).toBe(0);
        }
        expect([...ways].sort()).toEqual(['-1:-1', '-1:1', '1:-1', '1:1']);
        expect(VULTURE_PASSES.landscape.map((r) => r.side).sort()).toEqual([-1, 1]);
        // Back along the route is the same arc: where one way ends the other begins.
        const there = layVulturePass(createVultureVisit(), 0, 'landscape', -1, 1).birds[0];
        const back = layVulturePass(createVultureVisit(), 0, 'landscape', -1, -1).birds[0];
        const a = vulturePlace(there, there.tOut);
        const b = vulturePlace(back, 0);
        // (The slow roll and nothing else differs: the place is the same to the metre.)
        [0, 1, 2].forEach((k) => expect(a[k]).toBeCloseTo(b[k], 6));
        expect(a[3]).toBeCloseTo(-b[3], 6);
        expect(a[5]).toBeCloseTo(-b[5], 6);
    });

    it.each(Object.keys(FRAMES))('brings every %s visit in over an edge and out over an edge, clear of the card and the HUD', (framing) => {
        const problems = [];
        for (const kind of ['thermal', 'pass']) {
            for (const { visit, name } of visits(kind, framing)) {
                // A visit fits the timetable's window.
                const [before, after] = VULTURE_TIMES[`${kind}Window`];
                if (visit.from < -before - 1e-9 || visit.until > after + 1e-9) problems.push(`${name}: outside its window`);
                FRAMES[framing].forEach(([width, height], k) => {
                    const seen = watchVultureVisit(visit, width, height);
                    const where = `${name} at ${width}x${height}`;
                    if (!seen.begins) problems.push(`${where}: begins in the frame`);
                    if (!seen.ends) problems.push(`${where}: ends in the frame`);
                    if (seen.over > 0) problems.push(`${where}: over the card or the HUD at ${seen.where.age.toFixed(1)} s`);
                    // In the frame it is laid for it is really seen.
                    if (k === 0 && !(seen.seen > 4)) problems.push(`${where}: seen ${seen.seen} s`);
                });
                // The widest frame of the framing too.
                const widest = watchVultureVisit(visit, Math.round(1000 * VULTURE_FRAMES[framing].widest), 1000);
                if (!widest.begins || !widest.ends) problems.push(`${name}: in the widest frame at its ${widest.begins ? 'end' : 'start'}`);
            }
        }
        expect(problems).toEqual([]);
    });

    it('shows a thermal for most of a minute at 20 to 60 px, and a pass large for six to ten seconds', () => {
        for (const { visit, name } of visits('thermal', 'landscape')) {
            const seen = watchVultureVisit(visit, 1600, 900);
            expect(seen.seen, name).toBeGreaterThan(35);
            expect(seen.seen, name).toBeLessThan(90);
            expect(seen.least, name).toBeGreaterThanOrEqual(20);
            expect(seen.most, name).toBeLessThanOrEqual(60);
        }
        for (const { visit, name } of visits('pass', 'landscape')) {
            const seen = watchVultureVisit(visit, 1600, 900);
            expect(seen.seen, name).toBeGreaterThanOrEqual(5.5);
            expect(seen.seen, name).toBeLessThanOrEqual(10);
            // Large: never under 120 px while its middle is in the frame, 320 px and more as it goes by.
            expect(seen.least, name).toBeGreaterThan(120);
            expect(seen.most, name).toBeGreaterThan(320);
        }
        // An upright phone: small birds in a narrow frame, a pass a seventh of its width.
        for (const { visit, name } of visits('thermal', 'portrait', 24)) {
            const seen = watchVultureVisit(visit, 390, 844);
            expect(seen.seen, name).toBeGreaterThan(35);
            expect(seen.least, name).toBeGreaterThanOrEqual(16);
        }
        for (const { visit, name } of visits('pass', 'portrait', 24)) {
            const seen = watchVultureVisit(visit, 390, 844);
            expect(seen.seen, name).toBeGreaterThanOrEqual(5);
            expect(seen.most / 390, name).toBeGreaterThan(0.1);
        }
    });

    it('flies well clear of the land', () => {
        const place = [0, 0, 0, 0, 0, 0, 0];
        for (const framing of ['landscape', 'portrait']) {
            for (const kind of ['thermal', 'pass']) {
                for (const { visit, name } of visits(kind, framing, 30)) {
                    for (let i = 0; i < visit.count; i += 1) {
                        const bird = visit.birds[i];
                        for (let age = bird.from; age <= bird.until; age += 0.5) {
                            vulturePlace(bird, age, place);
                            const over = place[1] - groundHeight(fields, place[0], place[2]);
                            // A thermal's birds soar a good sixty metres up; a passing bird clears the spur by its own span.
                            expect(over, `${name} bird ${i} at ${age.toFixed(1)} s`).toBeGreaterThan(kind === 'thermal' ? 60 : 12);
                            // No nearer the eye than a wing's length and more.
                            expect(Math.hypot(place[0] - EYE.x, place[1] - EYE.y, place[2] - EYE.z)).toBeGreaterThan(1.5 * bird.size * VULTURE_SPAN * 0.5);
                        }
                    }
                }
            }
        }
    });

    it('is a closed form of the age: one pace, a heading that never jumps, a bank eased in and out', () => {
        const dt = 1 / 60;
        const a = [0, 0, 0, 0, 0, 0, 0];
        const b = [0, 0, 0, 0, 0, 0, 0];
        for (const kind of ['thermal', 'pass']) {
            for (const { visit, name } of visits(kind, 'landscape', 16)) {
                for (let i = 0; i < visit.count; i += 1) {
                    const bird = visit.birds[i];
                    const pace = Math.abs(bird.omega) * bird.radius;
                    for (let age = bird.from; age < bird.until; age += 0.37) {
                        vulturePlace(bird, age, a);
                        vulturePlace(bird, age + dt, b);
                        expect(a.every(Number.isFinite), name).toBe(true);
                        // Its pace through the air is the same on the glides and on the arc (the
                        // column's slow drift and a flap's heave ride on top).
                        const moved = Math.hypot(b[0] - a[0] - bird.driftX * dt, b[2] - a[2] - bird.driftZ * dt) / dt;
                        expect(moved, `${name} bird ${i} at ${age.toFixed(2)}`).toBeCloseTo(pace, 1);
                        // The heading is a unit vector along the flight, and turns no faster than the arc does.
                        expect(Math.hypot(a[3], a[4], a[5])).toBeCloseTo(1, 9);
                        const turned = Math.acos(Math.min(1, a[3] * b[3] + a[4] * b[4] + a[5] * b[5])) / dt;
                        expect(turned).toBeLessThan(Math.abs(bird.omega) + 0.02);
                        // The roll never snaps: a frame changes it by a degree at most.
                        expect(Math.abs(b[6] - a[6])).toBeLessThan(0.018);
                    }
                    // On the arc it banks into the turn; on the glides it flies level but for its rocking.
                    const mid = (bird.tIn + bird.tOut) / 2;
                    expect(vultureOnArc(bird, mid)).toBeCloseTo(1, 6);
                    expect(vulturePlace(bird, mid, a)[6] * Math.sign(bird.omega)).toBeGreaterThan(bird.bank - 0.09);
                    expect(vultureOnArc(bird, bird.tIn - 4)).toBe(0);
                    expect(Math.abs(vulturePlace(bird, bird.tIn - 4, a)[6])).toBeLessThan(0.09);
                    expect(Math.abs(vulturePlace(bird, bird.tOut + 4, a)[6])).toBeLessThan(0.09);
                }
            }
        }
    });

    it('soars on set wings, flexing; flaps slowly and deeply as it sets off; steers with its tail', () => {
        const F = VULTURE_FLIGHT;
        const wing = [0, 0, 0, 0];
        const visit = layVultureThermal(createVultureVisit(), 2, 'landscape');
        const [bird] = visit.birds;
        // Mid-circle, out of any burst: near the soaring pose, the tail fanned.
        for (let age = bird.tIn + 4; age < bird.tOut - 2; age += 0.9) {
            vultureWings(bird, age, wing);
            expect(Math.abs(wing[0] - F.arm)).toBeLessThanOrEqual(F.lift[0] + 1e-9);
            expect(Math.abs(wing[1] - F.hand)).toBeLessThanOrEqual(F.flex[0] + F.flex[2] + 1e-9);
            expect(wing[1]).toBeLessThan(0); // the hand stays lowered: wings a little bowed
            expect(wing[2]).toBeGreaterThan(0.5);
        }
        // Gliding, the tail is closed.
        expect(vultureWings(bird, bird.tOut + 8, wing)[2]).toBeLessThan(-0.3);
        // The burst as it leaves: three beats at 1.25 a second, the shoulder swinging 0.4 rad each way.
        expect(F.beat).toBeGreaterThan(0.9);
        expect(F.beat).toBeLessThan(1.6);
        let top = -Infinity;
        let bottom = Infinity;
        let crossings = 0;
        let before = 0;
        for (let age = bird.flapB - 0.2; age < bird.flapB + F.beats / F.beat + 0.2; age += 1 / 120) {
            const arm = vultureWings(bird, age, wing)[0] - F.arm;
            top = Math.max(top, arm);
            bottom = Math.min(bottom, arm);
            if (before <= 0.1 && arm > 0.1) crossings += 1;
            before = arm;
        }
        expect(crossings).toBe(F.beats);
        expect(top).toBeGreaterThan(0.3);
        expect(bottom).toBeLessThan(-0.3);
        // The tail twists against the roll it rocks with.
        const place = [0, 0, 0, 0, 0, 0, 0];
        let against = 0;
        let n = 0;
        for (let age = bird.tIn - 12; age < bird.tIn - 3; age += 0.25) {
            const roll = vulturePlace(bird, age, place)[6];
            const twist = vultureWings(bird, age, wing)[3];
            if (Math.abs(roll) > 0.01) {
                n += 1;
                if (Math.sign(twist) === -Math.sign(roll)) against += 1;
            }
        }
        expect(against / n).toBeGreaterThan(0.95);
    });
});

describe('Painted Ages vultures part', () => {
    const BUILDERS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];

    it('has a tier column: two birds in a thermal at the bottom, four at the top, the pass\'s own besides', () => {
        expect(QUALITY_NAMES.map((quality) => QUALITY[quality].vultures)).toEqual([2, 2, 3, 3, 4, 4]);
        for (const quality of QUALITY_NAMES) {
            const { part } = makePart(quality);
            expect(part.most).toBe(QUALITY[quality].vultures);
            expect(part.slots).toBe(QUALITY[quality].vultures + 1);
            expect(part.mesh.geometry.instanceCount).toBe(part.slots);
            expect(part.table).toHaveLength(part.slots * VULTURE_ROWS);
        }
        expect(Math.max(...QUALITY_NAMES.map((quality) => QUALITY[quality].vultures))).toBe(VULTURE_MOST);
    });

    it('builds one instanced draw of a self-shaded node material, every bird dormant at no size', () => {
        const { part } = makePart('High');
        const model = vultureModel();
        const { mesh } = part;
        expect(part.meshes).toEqual([mesh]);
        expect(mesh.name).toBe('PaintedAgesVultures');
        expect(mesh.isMesh).toBe(true);
        expect(mesh.isInstancedMesh).not.toBe(true);
        expect(mesh.geometry.isInstancedBufferGeometry).toBe(true);
        expect(mesh.material.isMeshBasicNodeMaterial).toBe(true);
        expect(mesh.material.fog).toBe(false);
        // Both faces: a far wing is drawn no thinner than a pixel, and from behind the eye looks
        // in between its two sheets (the back faces take the turned normal).
        expect(mesh.material.side).toBe(THREE.DoubleSide);
        // Blended (the hour's light dissolves it) yet solid: it writes its depth.
        expect(mesh.material.transparent).toBe(true);
        expect(mesh.material.depthWrite).toBe(true);
        expect(mesh.material.blending).toBe(THREE.NormalBlending);
        expect(mesh.frustumCulled).toBe(false);
        expect(mesh.visible).toBe(true);
        // After the cumulus banks, before the lamps' halos and the motes.
        expect(mesh.renderOrder).toBeGreaterThan(11);
        expect(mesh.renderOrder).toBeLessThan(20);
        expect(mesh.geometry.index.count).toBe(model.triangleCount * 3);
        expect(mesh.geometry.getAttribute('position').array).toBe(model.positions);
        // Five vertex buffers (a pipeline has eight).
        expect(Object.keys(mesh.geometry.attributes)).toHaveLength(5);
        // Dormant: drawn from 1 until 0 is never, so every bird is of no size.
        for (let i = 0; i < part.slots; i += 1) {
            const span = part.table[i * VULTURE_ROWS + 4];
            expect(span.x).toBeGreaterThan(span.y);
        }
        expect(part.show.value.toArray()).toEqual([0, 0]);
        // Triangles a frame at the most: a few hundred a bird.
        expect(model.triangleCount * part.slots).toBeLessThan(2100);
        // The world builds it, names it and drives it with its other parts.
        const world = source('src/themes/painted-ages/painted-ages-world.js');
        expect(world).toMatch(/this\.addPart\('vultures', createVultures\(this\.u, this\.textures, tier, this\.fields\)\)/);
        expect(world).toMatch(/PAINTED_AGES_PARTS = Object\.freeze\(\[[^\]]*'vultures'/);
        expect(world).toMatch(/for \(const part of this\.partList\) part\.update\?\.\(time, dt\)/);
    });

    it.each(BUILDERS)('builds its shaders to %s, on the default tier and the leanest', (name, Builder) => {
        for (const quality of ['High', 'Minimal']) {
            const { part } = makePart(quality);
            part.stage({ kind: 'thermal', age: 12, time: 60 });
            part.update(60, 1 / 60);
            const result = build(Builder, part.mesh);
            expect(result.thrown, `${quality}: ${result.thrown?.stack}`).toBeUndefined();
            expect(result.heard, quality).toEqual([]);
            expect(result.vertex.length).toBeGreaterThan(1500);
            expect(result.fragment.length).toBeGreaterThan(800);
            expect(result.vertex).not.toMatch(/NaN|Infinity|undefined/);
            expect(result.fragment).not.toMatch(/NaN|Infinity|undefined/);
            // The flight is in the vertex stage: the table of rows read by the instance's number.
            expect(result.vertex).toMatch(name === 'WGSL' ? /instance_index|instanceIndex/ : /gl_InstanceID/);
            expect(Buffer.byteLength(result.fragment)).toBeLessThan(24 * 1024);
            expect(Buffer.byteLength(result.vertex)).toBeLessThan(24 * 1024);
            if (name === 'WGSL') {
                expect(unassignedReads(result.vertex)).toEqual([]);
                expect(unassignedReads(result.fragment)).toEqual([]);
            }
        }
        expect(VULTURE_LIGHT.stout).toBeGreaterThan(0.3);
        expect(VULTURE_LIGHT.stout).toBeLessThan(0.75);
    });

    it('asks only the timetable each frame: the rows are the clock\'s, however the clock got there', () => {
        const { part } = makePart('High');
        const epoch = vultureThermalEpoch(2);
        // Before the visit's window: nothing in the air.
        part.update(epoch - VULTURE_TIMES.thermalWindow[0] - 2, 1 / 60);
        const thermalRows = (rows) => rows.slice(0, part.most * VULTURE_ROWS);
        expect(part.state().thermal === 2).toBe(false);
        // Into it: the visit is laid, its rows written once.
        part.update(epoch + 10, 1 / 60);
        expect(part.state()).toMatchObject({ thermal: 2, framing: 'landscape' });
        expect(part.show.value.x).toBe(1);
        const laid = rowsOf(part);
        const visit = layVultureThermal(createVultureVisit(), 2, 'landscape', part.most);
        const expected = new Float64Array(VULTURE_ROWS * 4);
        for (let i = 0; i < part.most; i += 1) {
            vultureRows(visit, i, expected);
            for (let k = 0; k < VULTURE_ROWS; k += 1) {
                expect(laid[i * VULTURE_ROWS + k]).toEqual(Array.from(expected.slice(k * 4, k * 4 + 4)));
            }
        }
        // The visit's start is on the theme's clock; the birds beyond its count lie dormant.
        expect(laid[3][0]).toBeCloseTo(epoch, 3);
        for (let i = visit.count; i < part.most; i += 1) expect(laid[i * VULTURE_ROWS + 4][0]).toBeGreaterThan(laid[i * VULTURE_ROWS + 4][1]);
        // Frames later in the same visit write nothing new.
        const tableBefore = part.table.map((row) => row.clone());
        for (let t = epoch + 10; t < epoch + 30; t += 1 / 30) part.update(t, 1 / 30);
        part.table.forEach((row, k) => expect(row.equals(tableBefore[k])).toBe(true));
        // A seek away and back (and a fresh part asked cold) lands on the same rows.
        part.update(epoch + 400, 1 / 60);
        part.update(epoch + 10, 1 / 60);
        expect(thermalRows(rowsOf(part))).toEqual(thermalRows(laid));
        const cold = makePart('High').part;
        cold.update(epoch + 10, 0);
        expect(thermalRows(rowsOf(cold))).toEqual(thermalRows(laid));
        expect(cold.state().thermal).toBe(2);
        // Across five hours the same buffers serve: thermals come and go, passes in most cycles.
        const long = makePart('Ultra').part;
        const { table } = long;
        const flown = { thermal: new Set(), pass: new Set() };
        for (let t = 0; t < VULTURE_TIMES.cycle * 20; t += 0.5) {
            long.update(t, 0.5);
            const state = long.state();
            if (state.thermal >= 0) flown.thermal.add(state.thermal);
            if (state.pass >= 0) flown.pass.add(state.pass);
            expect(state.birds).toBeLessThanOrEqual(4);
        }
        expect(long.table).toBe(table);
        expect(flown.thermal.size).toBe(20);
        expect(flown.pass.size).toBeGreaterThan(8);
        expect(flown.pass.size).toBeLessThan(20);
        expect(table.every((row) => row.toArray().every(Number.isFinite))).toBe(true);
    });

    it('flies only by day: none in the blue hour or under a game-over dusk, and nothing fades in mid-flight', () => {
        const epoch = vultureThermalEpoch(1);
        // The blue hour: the visit is the clock's, but nothing is shown.
        const night = makePart('High', { sunUp: 0 });
        night.part.update(epoch + 10, 1 / 60);
        expect(night.part.state().thermal).toBe(1);
        expect(night.part.show.value.toArray()).toEqual([0, 0]);
        // The sun comes up while that visit is in the air: it stays down (no bird fades in in view)...
        night.u.sunUp.value = 1;
        night.part.update(epoch + 12, 1 / 60);
        expect(night.part.show.value.x).toBe(0);
        // ...and the next visit flies.
        night.part.update(vultureThermalEpoch(2) + 5, 1 / 60);
        expect(night.part.show.value.x).toBe(1);
        // A game over: dusk falls, the birds in the air dissolve with the light and do not come back
        // with the morning; the next visit does.
        const day = makePart('High');
        day.part.update(epoch + 10, 1 / 60);
        expect(day.part.show.value.x).toBe(1);
        let last = 1;
        for (let k = 1; k <= 30; k += 1) {
            day.u.dusk.value = k / 30;
            day.part.update(epoch + 10 + k * 0.2, 0.2);
            expect(day.part.show.value.x).toBeLessThanOrEqual(last);
            last = day.part.show.value.x;
        }
        expect(last).toBe(0);
        day.u.dusk.value = 0;
        day.part.update(epoch + 18, 1 / 60);
        expect(day.part.show.value.x).toBe(0);
        day.part.update(vultureThermalEpoch(2) + 5, 1 / 60);
        expect(day.part.show.value.x).toBe(1);
        // A seek back into the dissolved visit is a fresh look at it: by day, it flies.
        day.part.update(epoch + 10, 1 / 60);
        expect(day.part.show.value.x).toBe(1);
    });

    it('lays its visits for the frame it is shown in', () => {
        const { part, u } = makePart('High');
        const epoch = vultureThermalEpoch(4);
        part.update(epoch + 5, 1 / 60);
        expect(part.state().framing).toBe('landscape');
        const landscape = rowsOf(part);
        u.aspect.value = 390 / 844;
        part.update(epoch + 5.1, 1 / 60);
        expect(part.state().framing).toBe('portrait');
        expect(rowsOf(part)).not.toEqual(landscape);
        // Upright, a thermal stands in the strip of sky above the card.
        const [bird] = part.state().visits.thermal.birds;
        const at = vultureLens(390 / 844).project(...vulturePlace(bird, 10).slice(0, 3));
        expect(at.y).toBeLessThan(vultureKeepOut(390, 844)[0].y0);
        u.aspect.value = 21 / 9;
        part.update(epoch + 5.2, 1 / 60);
        expect(part.state().framing).toBe('wide');
    });

    it('stages a visit by hand for a capture: either kind, any age, either side, or none', () => {
        const { part } = makePart('High');
        part.update(10, 1 / 60);
        part.stage({
            kind: 'thermal', age: 15, side: -1, visit: 2, time: 10,
        });
        part.update(10, 0);
        expect(part.state()).toMatchObject({ thermal: 2, pass: -1, staged: 'thermal' });
        expect(part.state().visits.thermal.side).toBe(-1);
        expect(part.table[3].x).toBeCloseTo(10 - 15, 6); // the visit began `age` seconds before
        expect(part.show.value.toArray()).toEqual([1, 0]);
        part.stage({
            kind: 'pass', age: 4, side: 1, way: -1, time: 10,
        });
        part.update(10, 0);
        expect(part.state()).toMatchObject({ thermal: -1, pass: 0, staged: 'pass' });
        expect(part.state().visits.pass.side).toBe(1);
        expect(part.table[part.most * VULTURE_ROWS + 3].x).toBeCloseTo(6, 6);
        expect(part.show.value.toArray()).toEqual([0, 1]);
        // The staged visit plays on from there, as the clock runs.
        part.update(14, 4);
        expect(part.table[part.most * VULTURE_ROWS + 3].x).toBeCloseTo(6, 6);
        part.stage({ kind: 'off' });
        part.update(vultureThermalEpoch(0) + 5, 1);
        expect(part.state()).toMatchObject({ thermal: -1, pass: -1, staged: 'off' });
        expect(part.show.value.toArray()).toEqual([0, 0]);
        // Back to the timetable.
        part.stage();
        part.update(vultureThermalEpoch(0) + 5, 0);
        expect(part.state()).toMatchObject({ thermal: 0, staged: null });
        // The playground reads the capture's parameters and stages by them.
        const effect = source('src/playground/effects/painted-ages.effect.js');
        for (const name of ['vultures', 'vultureAge', 'vultureSide', 'vultureVisit', 'vultureWay']) expect(effect).toContain(`'${name}'`);
        expect(effect).toMatch(/world\.parts\.vultures\?\.stage\(\{ \.\.\.vultures, time \}\)/);
        expect(PAINTED_AGES_VULTURE.span).toBeCloseTo(VULTURE_SPAN, 3);
    });
});
