/**
 * Painted Ages — what gameplay does to the living world, run without a renderer: a twist's dust
 * devil, a back-to-back clear's veins of gold, a level-up's sliding strata and running lamps, a
 * perfect clear's wheeling day, and the sky lanterns of a run's end.
 *
 * Each is held by what must stay true whatever the tuning: once per event, on the land beside
 * the board, never backward, the same light after as before, nothing written outside its table.
 */
import { readFileSync } from 'node:fs';
import {
    afterEach, beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    LEVEL_SHIFT, PaintedAgesWorld, REST_RIG, SPIN_SECONDS, fovForAspect,
} from '../../src/themes/painted-ages/painted-ages-world.js';
import {
    EYE, FIELDS, FIELD_ORDER, PIECE_COLORS, TAU, TIMING, hexToLinear,
} from '../../src/themes/painted-ages/painted-ages-core.js';
import { HOUR_COUNT } from '../../src/themes/painted-ages/painted-ages-hours.js';
import { DEVILS } from '../../src/themes/painted-ages/painted-ages-tsl.js';
import { DEVIL_LIFE } from '../../src/themes/painted-ages/painted-ages-devils.js';
import { MOTE_KIND } from '../../src/themes/painted-ages/painted-ages-fx.js';
import { PAVILION } from '../../src/themes/painted-ages/painted-ages-plan.js';
import { decodeField, groundHeight } from '../../src/themes/painted-ages/painted-ages-field.js';
import { cardUnion, fallbackLayout, outsideKeepOut } from '../../src/themes/painted-ages/painted-ages-composition.js';
import { decodePng } from '../../scripts/painted-ages/png.mjs';

const START = 10;
const FRAME = 1 / 30;
/** A dust devil stands between these distances from the eye (m): a middle distance. */
const DEVIL_NEAR = 430;
const DEVIL_FAR = 1700;
const worlds = [];
const preparedBy = {};
let fields;

beforeAll(() => {
    fields = {};
    for (const name of FIELD_ORDER) {
        const file = new URL(`../../src/themes/painted-ages/assets/badlands-${name}.png`, import.meta.url);
        const { rgba } = decodePng(readFileSync(file));
        fields[name] = { ...decodeField(rgba, FIELDS[name]), size: FIELDS[name].size, source: 'asset' };
    }
    fields.source = 'asset';
});

afterEach(() => {
    worlds.splice(0).forEach((world) => world.dispose());
});

/** One preparation per tier serves every world of that tier in this file. */
const preparedFor = (quality) => {
    preparedBy[quality] ||= PaintedAgesWorld.prepareSync(quality, fields);
    return preparedBy[quality];
};

const sim = (time, delta, pointerX = 0, pointerY = 0) => ({
    time, delta, pointerX, pointerY,
});

/** Run the world from its current time to `to` in steps of dt, as the theme's frames do. */
function stepTo(world, camera, to, dt = FRAME, each = null) {
    const from = world.time;
    const steps = Math.max(1, Math.round((to - from) / dt));
    const h = (to - from) / steps;
    for (let i = 1; i <= steps; i += 1) {
        const s = sim(from + i * h, h);
        world.updateCamera(camera, s);
        world.update(s, camera);
        if (each) each(world);
    }
}

/**
 * A built world at `start`. `settle: false` stops before its first frame (a rebuild in place
 * seeks, restores and only then draws).
 */
function makeWorld({
    width = 1600, height = 900, start = START, quality = 'Low', overrides = null, reduced = false, settle = true,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new PaintedAgesWorld({
        scene, quality, capture: true, prepared: preparedFor(quality),
    }).build();
    worlds.push(world);
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    // The clock's own happenings (a gust's devil, a flicker) have a file of their own.
    world.setCaptureOverrides({ happenings: false, ...overrides });
    world.setReducedMotion(reduced);
    world.seek(start);
    if (settle) {
        world.updateCamera(camera, sim(start, 0));
        world.update(sim(start, 0), camera);
    }
    return {
        scene, camera, world, width, height, layout: fallbackLayout(width, height),
    };
}

const rowsOf = (...codes) => codes.flatMap((code) => new Array(10).fill(code));
/** A twist that clears one line, locked at board column `u`. */
const twist = (world, u, color = PIECE_COLORS[2]) => world.onClear({
    lines: 1, rowCodes: rowsOf(2), combo: 1, twist: true, u, color,
});

// ── Dust devils ───────────────────────────────────────────────────────────────────

/** Devil `i` of the table: its three rows (foot + start, colour + height, seed + drift + strength). */
const devilRows = (world, i) => world.u.tables.devils.slice(i * 3, i * 3 + 3);
const raisedRows = (world) => Array.from({ length: DEVILS }, (_, i) => i).filter((i) => devilRows(world, i)[2].w > 0);
/** The one devil a fresh world shows, as plain numbers. */
function theDevil(world) {
    const raised = raisedRows(world);
    expect(raised, 'devils raised').toHaveLength(1);
    const [a, b, c] = devilRows(world, raised[0]);
    return {
        row: raised[0],
        foot: new THREE.Vector3(a.x, a.y, a.z),
        start: a.w,
        rgb: [b.x, b.y, b.z],
        height: b.w,
        seed: c.x,
        drift: new THREE.Vector3(c.y, 0, c.z),
        strength: c.w,
    };
}
/** Where a world point shows (screen fractions, y down). */
function onScreen(camera, point) {
    const p = point.clone().project(camera);
    return { x: p.x * 0.5 + 0.5, y: 0.5 - p.y * 0.5 };
}
/** Metres right of the view axis (negative: left of it). */
function rightOfAxis(camera, point) {
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    return (point.x - camera.position.x) * right.x + (point.z - camera.position.z) * right.z;
}
const distanceFromEye = (point) => Math.hypot(point.x - EYE.x, point.y - EYE.y, point.z - EYE.z);
/** Live motes of a kind: their slots. */
function motesOf(world, kind) {
    const { motes } = world;
    return Array.from({ length: motes.count }, (_, i) => i)
        .filter((i) => Math.round(motes.kind[i * 4]) === kind && motes.start[i * 4 + 3] > -1e5);
}

describe('Painted Ages events: a twist\'s dust devil', () => {
    it.each([[1600, 900], [2560, 1080], [900, 1600]])(
        'a twist that clears raises exactly one, on the land at a middle distance, on the side it locked (%i × %i)',
        (width, height) => {
            const problems = [];
            for (const u of [0, 0.1, 0.25, 0.4, 0.45, 0.55, 0.6, 0.75, 0.9, 1]) {
                const { world, camera } = makeWorld({ width, height });
                const wrong = (what) => problems.push(`u ${u}: ${what}`);
                expect(raisedRows(world)).toHaveLength(0);
                const color = PIECE_COLORS[Math.round(u * 10) % 7];
                twist(world, u, color);
                expect(world.counts.twists).toBe(1);
                const devil = theDevil(world);
                expect(devil.start).toBe(world.time);
                expect(devil.strength).toBeGreaterThan(0);
                expect(devil.strength).toBeLessThanOrEqual(1);
                expect(devil.height).toBeGreaterThan(0);
                devil.rgb.forEach((v, i) => expect(v, `colour[${i}] at u ${u}`).toBeCloseTo(hexToLinear(color)[i], 9));
                // Its foot is on the land (sunk a little, so no gap shows under it).
                const above = devil.foot.y - groundHeight(fields, devil.foot.x, devil.foot.z);
                if (Math.abs(above) > 2.5) wrong(`foot ${above.toFixed(1)} m off the ground`);
                const distance = distanceFromEye(devil.foot);
                if (distance < DEVIL_NEAR || distance > DEVIL_FAR) wrong(`${distance.toFixed(0)} m from the eye`);
                const side = rightOfAxis(camera, devil.foot);
                // On the side it locked on wherever that side has room beside the card and the HUD.
                // Where it has none (an upright frame whose right side the HUD fills) the devil
                // stands on the other side, where it is seen: seen beats sided (the lead's choice).
                const ownSide = world.devilStage(u < 0.5) !== null;
                const wantLeft = ownSide ? u < 0.5 : u >= 0.5;
                if (wantLeft ? side >= 0 : side <= 0) wrong(`${side.toFixed(0)} m right of the view axis`);
                // In the frame, and a funnel, not a speck or a wall: a few degrees to a third of the view.
                const foot = onScreen(camera, devil.foot);
                const inFrame = foot.x >= 0 && foot.x <= 1 && foot.y >= 0 && foot.y <= 1;
                if (!inFrame) wrong(`foot off screen (${foot.x.toFixed(2)}, ${foot.y.toFixed(2)})`);
                const tall = Math.atan2(devil.height, distance) / (camera.fov * (Math.PI / 180));
                if (tall < 0.05 || tall > 0.5) wrong(`${(tall * 100).toFixed(0)} % of the view's height`);
                world.dispose();
            }
            expect(problems).toEqual([]);
        },
    );

    /** How far from the eye the devils of twists at these columns stand, where that is no middle distance. */
    function misplaced(width, height, us) {
        const problems = [];
        for (const u of us) {
            const { world } = makeWorld({ width, height });
            twist(world, u);
            const distance = distanceFromEye(theDevil(world).foot);
            const middle = distance >= DEVIL_NEAR && distance <= DEVIL_FAR;
            if (!middle) problems.push(`u ${u}: ${distance.toFixed(0)} m from the eye`);
            world.dispose();
        }
        return problems;
    }
    const SQUARER = [[1280, 1024], [1024, 768]];

    it.each(SQUARER)('there is land at a middle distance beside the card on both sides (%i × %i)', (width, height) => {
        const { world, layout } = makeWorld({ width, height });
        const card = cardUnion(layout);
        const hit = {
            x: 0, y: 0, z: 0, distance: 0,
        };
        const sites = { left: 0, right: 0 };
        for (let sx = 0.03; sx <= 0.97; sx += 0.02) {
            for (let sy = 0.4; sy <= 0.97; sy += 0.02) {
                // Beside the card (not under it), clear of the HUD.
                if ((sx > card.x0 && sx < card.x1) || !outsideKeepOut(layout, { x: sx, y: sy }, 0.02)) continue;
                const land = world.landAt(sx, sy, hit);
                if (!land || land.distance < DEVIL_NEAR || land.distance > DEVIL_FAR) continue;
                sites[sx < card.x0 ? 'left' : 'right'] += 1;
            }
        }
        expect(sites.left).toBeGreaterThan(20);
        expect(sites.right).toBeGreaterThan(20);
        // ... and the middle and right-hand columns do find it.
        expect(misplaced(width, height, [0.2, 0.3, 0.7, 0.9])).toEqual([]);
    });

    // WAS A FAULT (found by this test, fixed in the living pass): on a 4:3 or 5:4 screen a twist on the far-left columns finds no level site within its
    // ±0.09 of the screen and falls back to landSite(u, 18.5): 170–180 m from the eye (1024 × 768:
    // u 0, 0.05, 0.1; 1280 × 1024: u 0, 0.05). There the 60 m funnel fills half the view's height
    // and drifts from x = 0.04 to x = 0.33 of the screen in its life.
    it.each(SQUARER)('stands at a middle distance on a squarer screen too (%i × %i)', (width, height) => {
        expect(misplaced(width, height, [0, 0.05, 0.1])).toEqual([]);
    });

    /** Twists across the board: where each devil's foot shows at birth, and how much of its life it is hidden. */
    function placed(width, height, us) {
        return us.map((u) => {
            const { world, camera, layout } = makeWorld({ width, height });
            twist(world, u);
            const devil = theDevil(world);
            const footAt = (age) => devil.foot.clone().addScaledVector(devil.drift, age).setY(devil.foot.y + 1);
            const at = (age) => onScreen(camera, footAt(age));
            let hidden = 0;
            for (let k = 0; k <= 30; k += 1) {
                if (!outsideKeepOut(layout, at((k / 30) * DEVIL_LIFE), 0)) hidden += 1 / 31;
            }
            const born = at(0);
            world.dispose();
            return {
                u, born, bornHidden: !outsideKeepOut(layout, born, 0), hidden,
            };
        });
    }
    const label = (s) => `u ${s.u}: foot at (${s.born.x.toFixed(3)}, ${s.born.y.toFixed(3)}), `
        + `hidden ${(s.hidden * 100).toFixed(0)} % of its life`;

    it('stands beside the card and the HUD on the outer columns, for its whole life (1600 × 900)', () => {
        const outer = placed(1600, 900, [0, 0.1, 0.2, 0.3, 0.75, 0.8, 0.9, 1]);
        expect(outer.filter((s) => s.bornHidden || s.hidden > 0).map(label)).toEqual([]);
    });

    // WAS A FAULT (found by this test, fixed in the living pass) (devilSite: "where a dust devil can stand and be seen whole (… beside the card …)"): its
    // sideways search (±0.09 of the screen) is not kept out of the HUD. At 1600 × 900 a twist locked
    // at u 0.5–0.65 raises its devil with the foot BEHIND the stats bar (x 0.669–0.730, y 0.63–0.68;
    // the bar spans x 0.647–0.734, y 0.286–0.714).
    it('is raised beside the card and the HUD, never behind them (1600 × 900)', () => {
        const all = placed(1600, 900, Array.from({ length: 21 }, (_, i) => i / 20));
        expect(all.filter((s) => s.bornHidden).map(label)).toEqual([]);
    });

    // WAS A FAULT (found by this test, fixed in the living pass): every devil drifts toward +x (driftX 3–6.5 m/s for 7.5 s: 4–5 % of the screen at 600 m).
    // One raised just left of the card (u 0.40, 0.45: foot at x 0.381 and 0.367, card from 0.388) walks
    // behind the card and spends 84 % and 61 % of its life there.
    it('stays where it can be seen for most of its life when it is raised left of the card (1600 × 900)', () => {
        const left = placed(1600, 900, [0.3, 0.35, 0.4, 0.45]);
        expect(left.filter((s) => s.hidden > 1 / 3).map(label)).toEqual([]);
    });

    // WAS A FAULT (found by this test, fixed in the living pass): devilSite scans the screen rows 0.53–0.82 whatever the aspect; in portrait the card
    // covers x 0.355–0.645, y 0.313–0.687, so a twist at u 0.3–0.65 (and, behind the HUD, 0.75–0.95)
    // raises its devil behind it: 13 of 21 columns at 900 × 1600 (sitePoint's own portrait rule,
    // "the land shows below the card", is not used).
    it('is raised beside the card and the HUD, never behind them (portrait, 900 × 1600)', () => {
        const all = placed(900, 1600, Array.from({ length: 21 }, (_, i) => i / 20));
        expect(all.filter((s) => s.bornHidden).map(label)).toEqual([]);
    });

    it('a twist without a clear raises a smaller one: lower and fainter, with fewer grains', () => {
        const cleared = makeWorld();
        const spun = makeWorld();
        twist(cleared.world, 0.2);
        spun.world.onSpin({ u: 0.2, color: PIECE_COLORS[2] });
        expect(spun.world.counts.twists).toBe(1);
        const big = theDevil(cleared.world);
        const small = theDevil(spun.world);
        // The same site (the same column), a smaller funnel.
        expect(small.foot.distanceTo(big.foot)).toBeLessThan(1e-6);
        expect(small.height).toBeLessThan(big.height);
        expect(small.strength).toBeLessThan(big.strength);
        expect(small.strength).toBeGreaterThan(0);
        const grains = (w) => motesOf(w, MOTE_KIND.devil).length;
        expect(grains(spun.world)).toBeGreaterThan(0);
        expect(grains(spun.world)).toBeLessThan(grains(cleared.world));
    });

    it('more twists than DEVILS never write outside the table, and the oldest row is the one reused', () => {
        const { world, camera } = makeWorld();
        const { devils } = world.u.tables;
        expect(devils).toHaveLength(DEVILS * 3);
        const t0 = world.time;
        const startOf = () => Array.from({ length: DEVILS }, (_, i) => devilRows(world, i)[0].w);
        for (let k = 0; k < DEVILS + 3; k += 1) {
            stepTo(world, camera, t0 + (k + 1) * 0.4);
            const before = startOf();
            twist(world, k % 2 ? 0.8 : 0.2, PIECE_COLORS[k % 7]);
            expect(world.u.tables.devils).toBe(devils);
            expect(devils).toHaveLength(DEVILS * 3);
            expect(raisedRows(world).length).toBeLessThanOrEqual(DEVILS);
            expect(world.devils.standing(world.time)).toBeLessThanOrEqual(DEVILS);
            if (k < DEVILS) continue;
            // The table was full: the row that held the oldest devil took the new one, the others kept theirs.
            const oldest = before.indexOf(Math.min(...before));
            const expected = before.map((start, i) => (i === oldest ? world.time : start));
            expect(startOf(), `after twist ${k}`).toEqual(expected);
        }
        expect(world.devils.standing(world.time)).toBe(DEVILS);
        expect(world.counts.twists).toBe(DEVILS + 3);
        devils.forEach((row) => row.toArray().forEach((v) => expect(Number.isFinite(v)).toBe(true)));
        // All in the same instant (a multiplayer frame): still inside the table.
        for (let k = 0; k < DEVILS * 2 + 1; k += 1) twist(world, 0.7);
        expect(devils).toHaveLength(DEVILS * 3);
        expect(world.devils.standing(world.time)).toBeLessThanOrEqual(DEVILS);
    });

    it('stands for DEVIL_LIFE and no longer; a seek and a reset clear the table', () => {
        const { world, camera } = makeWorld();
        expect(world.devils.standing(world.time)).toBe(0);
        twist(world, 0.2);
        const born = world.time;
        expect(world.devils.standing(born)).toBe(1);
        expect(world.devils.standing(born + DEVIL_LIFE - 0.01)).toBe(1);
        expect(world.devils.standing(born + DEVIL_LIFE + 0.01)).toBe(0);
        let last = 1;
        stepTo(world, camera, born + DEVIL_LIFE + 0.5, FRAME, (w) => {
            const n = w.devils.standing(w.time);
            expect(n).toBeLessThanOrEqual(last);
            last = n;
        });
        expect(last).toBe(0);
        const cleared = () => world.u.tables.devils.every((row) => row.toArray().every((v) => v === 0));
        twist(world, 0.8);
        expect(cleared()).toBe(false);
        world.seek(world.time + 1);
        expect(cleared()).toBe(true);
        expect(world.devils.standing(world.time)).toBe(0);
        twist(world, 0.8);
        world.resetState(world.time);
        expect(cleared()).toBe(true);
        expect(world.devils.standing(world.time)).toBe(0);
        expect(motesOf(world, MOTE_KIND.devil)).toHaveLength(0);
    });

    const TIERS = ['Minimal', 'Low', 'High'];

    it.each(TIERS)('at %s a devil\'s grains take at most 8 percent of the pigment slots', (quality) => {
        const { world } = makeWorld({ quality });
        twist(world, 0.2);
        const devil = theDevil(world);
        const grains = motesOf(world, MOTE_KIND.devil);
        expect(grains.length).toBeGreaterThan(0);
        expect(grains.length).toBeLessThanOrEqual(world.motes.pigmentSlots * 0.08);
        for (const i of grains) {
            expect(i).toBeLessThan(world.motes.pigmentSlots); // the rain's ring is the rain's
            const [x, y, z, born] = world.motes.start.subarray(i * 4, i * 4 + 4);
            expect(Math.hypot(x - devil.foot.x, z - devil.foot.z)).toBeLessThan(1);
            expect(y).toBeGreaterThanOrEqual(devil.foot.y);
            expect(born).toBeGreaterThanOrEqual(devil.start);
            expect(born).toBeLessThan(devil.start + DEVIL_LIFE);
            expect(world.motes.move[i * 4 + 1]).toBeGreaterThan(0); // they rise
        }
        // A second devil brings its own grains, again no more than its share.
        twist(world, 0.8);
        expect(motesOf(world, MOTE_KIND.devil).length).toBeGreaterThan(grains.length);
        expect(motesOf(world, MOTE_KIND.devil).length).toBeLessThanOrEqual(2 * world.motes.pigmentSlots * 0.08);
    });
});

// ── Back-to-back: the veins of gold ───────────────────────────────────────────────

describe('Painted Ages events: a back-to-back clear\'s veins', () => {
    const quad = (b2b) => ({
        lines: 4, rowCodes: rowsOf(0, 1, 2, 3), combo: 1, ...(b2b ? { b2b: true } : {}),
    });

    it('leaves the veins dark on a clear that is not back-to-back', () => {
        const { world, camera } = makeWorld();
        expect(world.u.veins.value.x).toBe(0);
        world.onClear(quad(false));
        stepTo(world, camera, world.time + 3, FRAME, (w) => expect(w.u.veins.value.x).toBe(0));
        // Nor does a run that is only held (no clear in it yet) flare them.
        world.onB2B(2);
        stepTo(world, camera, world.time + 3, FRAME, (w) => expect(w.u.veins.value.x).toBe(0));
    });

    it('flares them on a back-to-back clear, the flare\'s front running out from 0, and lets them go', () => {
        const { world, camera } = makeWorld();
        world.onB2B(1);
        world.onClear(quad(true));
        const t0 = world.time;
        const rows = [];
        stepTo(world, camera, t0 + 10, FRAME, (w) => {
            rows.push({ age: w.time - t0, flare: w.u.veins.value.x, run: w.u.veins.value.y });
        });
        // Lit right after (within a few frames), not before it is asked.
        expect(rows[3].flare).toBeGreaterThan(0);
        const peak = Math.max(...rows.map((row) => row.flare));
        const peakAt = rows.find((row) => row.flare === peak).age;
        expect(peak).toBeGreaterThan(0.2);
        expect(peakAt).toBeLessThan(1);
        // It falls from its peak without a second rise, and is as good as gone in a few seconds.
        rows.filter((row) => row.age > peakAt).forEach((row, i, later) => {
            if (i) expect(row.flare, `flare at ${row.age.toFixed(2)}`).toBeLessThanOrEqual(later[i - 1].flare + 1e-12);
        });
        expect(rows.find((row) => row.age >= 6).flare).toBeLessThan(peak * 0.1);
        expect(rows[rows.length - 1].flare).toBeLessThan(0.01);
        // The front: from (about) the eye, further out every frame.
        expect(rows[0].run).toBeGreaterThanOrEqual(0);
        expect(rows[0].run).toBeLessThan(100);
        rows.slice(0, 150).forEach((row, i, head) => {
            if (i) expect(row.run, `run at ${row.age.toFixed(2)}`).toBeGreaterThan(head[i - 1].run);
        });
        expect(rows[149].run).toBeGreaterThan(1500); // it has crossed the valley by then
    });

    it('a second back-to-back clear only adds to a flare still lit, and sends a new front out', () => {
        const { world, camera } = makeWorld();
        world.onB2B(1);
        world.onClear(quad(true));
        stepTo(world, camera, world.time + 0.8);
        const lit = world.u.veins.value.x;
        const run = world.u.veins.value.y;
        world.onB2B(2);
        world.onClear(quad(true));
        const rows = [];
        stepTo(world, camera, world.time + 0.5, FRAME, (w) => {
            rows.push({ flare: w.u.veins.value.x, run: w.u.veins.value.y });
        });
        expect(rows[0].run).toBeLessThan(run);
        expect(Math.max(...rows.map((row) => row.flare))).toBeGreaterThan(lit);
        // Never cut: from where it stood it only falls at its own pace or rises.
        expect(rows[0].flare).toBeGreaterThan(lit * 0.9);
    });

    it('holds the sheen while the run holds, higher for a longer run, and lets it fall when the run ends', () => {
        const { world, camera } = makeWorld();
        world.onB2B(1);
        stepTo(world, camera, world.time + 6);
        const one = world.u.sheen.value;
        expect(one).toBeGreaterThan(0);
        world.onB2B(3);
        stepTo(world, camera, world.time + 6);
        const three = world.u.sheen.value;
        expect(three).toBeGreaterThan(one);
        // Held: ten seconds on it has not sagged.
        stepTo(world, camera, world.time + 10, FRAME, (w) => {
            expect(w.u.sheen.value).toBeGreaterThanOrEqual(three - 1e-6);
        });
        world.onB2B(0);
        let last = world.u.sheen.value;
        stepTo(world, camera, world.time + 6, FRAME, (w) => {
            expect(w.u.sheen.value).toBeLessThanOrEqual(last + 1e-12);
            last = w.u.sheen.value;
        });
        expect(last).toBeLessThan(0.01);
    });
});

// ── A level-up: the strata slide, the lamps run ───────────────────────────────────

describe('Painted Ages events: a level-up slides the strata', () => {
    const shift = (world) => world.u.strataShift.value;

    it('moves the column by LEVEL_SHIFT, never backward, over a few seconds, and it stays', () => {
        expect(LEVEL_SHIFT).toBeGreaterThan(0);
        const { world, camera } = makeWorld();
        expect(shift(world)).toBe(0);
        world.levelUp(2);
        const t0 = world.time;
        const rows = [];
        stepTo(world, camera, t0 + 30, FRAME, (w) => rows.push({ age: w.time - t0, at: shift(w) }));
        rows.forEach((row, i) => {
            if (i) expect(row.at, `at ${row.age.toFixed(2)}`).toBeGreaterThanOrEqual(rows[i - 1].at);
            expect(row.at).toBeLessThanOrEqual(LEVEL_SHIFT + 1e-9);
        });
        // A slide, not a step: barely begun after a frame, under way after a second, done within eight.
        expect(rows[0].at).toBeLessThan(LEVEL_SHIFT * 0.02);
        expect(rows.find((row) => row.age >= 1).at).toBeGreaterThan(0);
        expect(rows.find((row) => row.age >= 1).at).toBeLessThan(LEVEL_SHIFT * 0.5);
        expect(rows.find((row) => row.age >= 8).at).toBeCloseTo(LEVEL_SHIFT, 9);
        expect(rows[rows.length - 1].at).toBeCloseTo(LEVEL_SHIFT, 9);
        // No frame takes more than a few frames' share of it.
        const fastest = Math.max(...rows.map((row, i) => row.at - (i ? rows[i - 1].at : 0)));
        expect(fastest).toBeLessThan(LEVEL_SHIFT * FRAME);
    });

    it('is instant for a silent level-up (a rebuild) and under reduced motion', () => {
        const silent = makeWorld();
        silent.world.levelUp(4, { silent: true });
        silent.world.update(sim(silent.world.time, 0), silent.camera);
        expect(shift(silent.world)).toBeCloseTo(3 * LEVEL_SHIFT, 9);
        expect(silent.world.counts.levelUps).toBe(0);
        const calm = makeWorld({ reduced: true });
        calm.world.levelUp(2);
        calm.world.update(sim(calm.world.time, 0), calm.camera);
        expect(shift(calm.world)).toBeCloseTo(LEVEL_SHIFT, 9);
        expect(calm.world.counts.levelUps).toBe(1);
    });

    it('is not undone by a new run, and the next run\'s level-ups slide on from it', () => {
        const { world, camera } = makeWorld();
        world.levelUp(2);
        world.levelUp(3);
        stepTo(world, camera, world.time + 8);
        expect(shift(world)).toBeCloseTo(2 * LEVEL_SHIFT, 9);
        world.onGameOver();
        world.resetSession();
        world.onSessionStart();
        let back = 0;
        let last = shift(world);
        const watch = (w) => {
            back = Math.min(back, shift(w) - last);
            last = shift(w);
        };
        stepTo(world, camera, world.time + 5, FRAME, watch);
        expect(shift(world)).toBeCloseTo(2 * LEVEL_SHIFT, 9);
        world.levelUp(2);
        stepTo(world, camera, world.time + 8, FRAME, watch);
        expect(shift(world)).toBeCloseTo(3 * LEVEL_SHIFT, 9);
        expect(back).toBe(0);
    });

    it('carries a slide on through a second level-up that comes before it is done', () => {
        const { world, camera } = makeWorld();
        world.levelUp(2);
        stepTo(world, camera, world.time + 1);
        const mid = shift(world);
        expect(mid).toBeGreaterThan(0);
        expect(mid).toBeLessThan(LEVEL_SHIFT);
        world.levelUp(3);
        let last = mid;
        stepTo(world, camera, world.time + 9, FRAME, (w) => {
            expect(shift(w)).toBeGreaterThanOrEqual(last - 1e-9);
            last = shift(w);
        });
        expect(last).toBeCloseTo(2 * LEVEL_SHIFT, 9);
    });

    /** The shift after each level-up from 2 to `top`, taken at once (reduced motion), the clock held. */
    function climb(top) {
        const { world, camera } = makeWorld({ reduced: true });
        const at = [shift(world)];
        for (let level = 2; level <= top; level += 1) {
            world.levelUp(level);
            world.update(sim(world.time, 0), camera);
            at.push(shift(world));
        }
        return at;
    }

    it('walks there and back within 0..400 m for levels up to 200', () => {
        const at = climb(200);
        at.forEach((v, i) => {
            expect(v, `level ${i + 1}`).toBeGreaterThanOrEqual(0);
            expect(v, `level ${i + 1}`).toBeLessThanOrEqual(400);
        });
        // It is a walk, not a wall: it goes out far and comes back near, more than once.
        expect(Math.max(...at)).toBeGreaterThan(300);
        const far = at.indexOf(Math.max(...at));
        const back = far + at.slice(far).findIndex((v) => v < 100);
        expect(back).toBeGreaterThan(far);
        expect(Math.max(...at.slice(back))).toBeGreaterThan(300);
    });

    // WAS A FAULT (found by this test, fixed in the living pass): the shift is (level slides + the clock's new days) × LEVEL_SHIFT, and "days" is read from
    // the HOUR wheel's place, which a level-up also steps by one hour. Every sixth level-up (to level
    // 7, 13, 19 …) pushes the place over a day's end, so that one level-up moves the column 32 m.
    it('changes it by at most LEVEL_SHIFT with each single level-up, up to level 200', () => {
        const at = climb(200);
        const over = [];
        for (let i = 1; i < at.length; i += 1) {
            const moved = Math.abs(at[i] - at[i - 1]);
            if (moved > LEVEL_SHIFT + 1e-9) over.push(`to level ${i + 1}: ${moved.toFixed(1)} m`);
        }
        expect(over).toEqual([]);
    });

    // WAS A FAULT (found by this test, fixed in the living pass) (the same cause, as it plays): the sixth level-up of a run slides 16 m in 4.2 s like the
    // others, and on top of it the "new day" step arrives as the hour wheel's eased turn crosses the
    // day's end: another 16 m in about a quarter of a second (3.5 m in one frame at 30 fps, where the
    // slide's own fastest frame is 0.24 m). Every stripe on every hill lurches.
    it('slides as gently on the sixth level-up of a run as on the first', () => {
        const { world, camera } = makeWorld();
        const fastestOf = (level) => {
            world.levelUp(level);
            let last = shift(world);
            let fastest = 0;
            stepTo(world, camera, world.time + 8, FRAME, (w) => {
                fastest = Math.max(fastest, Math.abs(shift(w) - last));
                last = shift(w);
            });
            return fastest;
        };
        const first = fastestOf(2);
        for (let level = 3; level <= 6; level += 1) expect(fastestOf(level)).toBeLessThan(first * 1.5);
        expect(fastestOf(7)).toBeLessThan(first * 1.5);
    });

    it('by the clock alone stays at 0 through the first day, then lays one step, with no jump', () => {
        const day = TIMING.hour * HOUR_COUNT;
        const { world, camera } = makeWorld({ start: 0 });
        let last = 0;
        let fastest = 0;
        const watch = (w) => {
            fastest = Math.max(fastest, Math.abs(shift(w) - last));
            expect(shift(w)).toBeGreaterThanOrEqual(last);
            last = shift(w);
        };
        stepTo(world, camera, day, FRAME, (w) => expect(shift(w)).toBe(0));
        stepTo(world, camera, day + 40, FRAME, watch);
        expect(shift(world)).toBeCloseTo(LEVEL_SHIFT, 9);
        // One step, and it holds until the next day's end; then the second.
        stepTo(world, camera, 2 * day - 1, FRAME, watch);
        expect(shift(world)).toBeCloseTo(LEVEL_SHIFT, 9);
        stepTo(world, camera, 2 * day + 40, FRAME, watch);
        expect(shift(world)).toBeCloseTo(2 * LEVEL_SHIFT, 9);
        // No frame took more than a frame's share of a step that lasts a second.
        expect(fastest).toBeGreaterThan(0);
        expect(fastest).toBeLessThan(LEVEL_SHIFT * FRAME);
    });
});

describe('Painted Ages events: a level-up runs the lamps up the stair', () => {
    it('runs the flare once per level-up, from before the first lamp to past the last, and leaves none on', () => {
        const { world, camera } = makeWorld();
        const lamp = () => world.u.lampRun.value;
        expect([lamp().x, lamp().y]).toEqual([-1, 0]);
        let runs = 0;
        let lit = false;
        const rows = [];
        const watch = (w) => {
            const { x, y } = w.u.lampRun.value;
            if (y > 0 && !lit) runs += 1;
            lit = y > 0;
            rows.push({ x, y });
        };
        world.levelUp(2);
        stepTo(world, camera, world.time + 8, FRAME, watch);
        expect(runs).toBe(1);
        const running = rows.filter((row) => row.y > 0);
        expect(running[0].x).toBeLessThan(0);
        expect(Math.max(...running.map((row) => row.x))).toBeGreaterThan(1);
        running.forEach((row, i) => {
            if (i) expect(row.x).toBeGreaterThan(running[i - 1].x);
            expect(row.y).toBeLessThanOrEqual(1);
        });
        // It is at full strength while it passes the lamps, and fades only past the last.
        running.filter((row) => row.x >= 0 && row.x <= 1).forEach((row) => expect(row.y).toBe(1));
        expect([lamp().x, lamp().y]).toEqual([-1, 0]);
        // Again on the next, not on a silent one (a rebuild).
        world.levelUp(3);
        stepTo(world, camera, world.time + 8, FRAME, watch);
        expect(runs).toBe(2);
        world.levelUp(4, { silent: true });
        stepTo(world, camera, world.time + 8, FRAME, watch);
        expect(runs).toBe(2);
        expect([lamp().x, lamp().y]).toEqual([-1, 0]);
    });
});

// ── A perfect clear: the day wheels round once ────────────────────────────────────

describe('Painted Ages events: a perfect clear wheels the day round once', () => {
    const perfect = (world) => world.onClear({ lines: 4, perfect: true });
    /** The shortest way between two angles (radians). */
    const turnBetween = (a, b) => {
        const d = Math.abs(a - b) % TAU;
        return Math.min(d, TAU - d);
    };

    it('spins for SPIN_SECONDS and no longer; the sun moves every frame and passes under the horizon', () => {
        const { world, camera } = makeWorld();
        expect(world.spinning).toBe(false);
        perfect(world);
        const t0 = world.time;
        let lastDir = world.u.sunDir.value.clone();
        let lowest = 1;
        const steps = [];
        stepTo(world, camera, t0 + SPIN_SECONDS + 2, FRAME, (w) => {
            const age = w.time - t0;
            expect(w.spinning, `spinning at ${age.toFixed(3)}`).toBe(age < SPIN_SECONDS);
            const moved = w.u.sunDir.value.angleTo(lastDir);
            lastDir = w.u.sunDir.value.clone();
            if (w.spinning) {
                steps.push({ age, moved });
                lowest = Math.min(lowest, w.u.sunUp.value);
                expect(w.u.sunDir.value.length()).toBeCloseTo(1, 9);
            }
        });
        expect(steps.length).toBeGreaterThan(SPIN_SECONDS / FRAME - 3);
        steps.forEach((step) => expect(step.moved, `sun's step at ${step.age.toFixed(3)}`).toBeGreaterThan(0));
        // Swept evenly: it never stalls on an hour on its way round.
        const middle = steps.filter((step) => step.age > 1 && step.age < SPIN_SECONDS - 1).map((step) => step.moved);
        expect(Math.min(...middle)).toBeGreaterThan(Math.max(...middle) * 0.03);
        expect(lowest).toBe(0);
    });

    it('leaves the light of the hour it would have been without it (against a twin with no perfect clear)', () => {
        const spun = makeWorld();
        const twin = makeWorld();
        perfect(spun.world);
        const t0 = spun.world.time;
        const same = (label) => {
            const a = spun.world;
            const b = twin.world;
            expect(a.u.sunDir.value.distanceTo(b.u.sunDir.value), `sunDir ${label}`).toBeLessThan(1e-6);
            expect(a.u.sun.value.distanceTo(b.u.sun.value), `sun ${label}`).toBeLessThan(1e-6);
            expect(a.u.sunUp.value, `sunUp ${label}`).toBeCloseTo(b.u.sunUp.value, 6);
            const exposure = (w) => w.getPostState().exposure;
            expect(Math.abs(exposure(a) - exposure(b)), `exposure ${label}`).toBeLessThan(1e-6);
            for (const key of ['fill', 'bounce', 'zenith', 'horizon', 'cloudLit', 'snow']) {
                expect(a.u[key].value.distanceTo(b.u[key].value), `${key} ${label}`).toBeLessThan(1e-6);
            }
            expect(a.u.stars.value, `stars ${label}`).toBeCloseTo(b.u.stars.value, 6);
            const hour = (w) => w.getState().hour.place % HOUR_COUNT;
            expect(hour(a), `hour ${label}`).toBeCloseTo(hour(b), 6);
        };
        // Mid-spin the two are far apart (it really wheels).
        stepTo(spun.world, spun.camera, t0 + SPIN_SECONDS / 2);
        stepTo(twin.world, twin.camera, t0 + SPIN_SECONDS / 2);
        expect(spun.world.u.sunDir.value.distanceTo(twin.world.u.sunDir.value)).toBeGreaterThan(0.5);
        const later = [[FRAME, 'the frame after'], [1, '1 s after'], [20, '20 s after'], [150, 'an hour or so on']];
        for (const [after, label] of later) {
            stepTo(spun.world, spun.camera, t0 + SPIN_SECONDS + after, after > 30 ? 0.25 : FRAME);
            stepTo(twin.world, twin.camera, t0 + SPIN_SECONDS + after, after > 30 ? 0.25 : FRAME);
            expect(spun.world.spinning).toBe(false);
            same(label);
        }
    });

    it('leaves the hour\'s light as it was when the perfect clear crowns a real clear (the heat of play aside)', () => {
        const spun = makeWorld();
        const twin = makeWorld();
        const quad = { lines: 4, rowCodes: rowsOf(0, 1, 2, 3), combo: 1 };
        for (const w of [spun, twin]) {
            w.world.onClear(quad);
            stepTo(w.world, w.camera, START + 0.36);
        }
        perfect(spun.world);
        for (const w of [spun, twin]) stepTo(w.world, w.camera, START + 0.36 + SPIN_SECONDS + FRAME);
        expect(spun.world.spinning).toBe(false);
        expect(spun.world.u.sunDir.value.distanceTo(twin.world.u.sunDir.value)).toBeLessThan(1e-6);
        expect(spun.world.u.sun.value.distanceTo(twin.world.u.sun.value)).toBeLessThan(1e-6);
        expect(Math.abs(spun.world.light.exposure - twin.world.light.exposure)).toBeLessThan(1e-6);
        // What is left of the crown's own heat still closes the iris a hair; once the hands have
        // rested the frame's exposure is the twin's.
        for (const w of [spun, twin]) stepTo(w.world, w.camera, w.world.time + 4);
        expect(Math.abs(spun.world.getPostState().exposure - twin.world.getPostState().exposure)).toBeLessThan(1e-6);
    });

    it('turns the stars in one sweep and never jumps them, at the spin\'s end least of all', () => {
        const spun = makeWorld();
        const twin = makeWorld();
        perfect(spun.world);
        const t0 = spun.world.time;
        let last = spun.world.u.starTurn.value;
        let largest = 0;
        const end = t0 + SPIN_SECONDS + 3;
        stepTo(spun.world, spun.camera, end, FRAME, (w) => {
            const turn = w.u.starTurn.value;
            expect(turn).toBeGreaterThanOrEqual(0);
            expect(turn).toBeLessThan(TAU);
            largest = Math.max(largest, turnBetween(turn, last));
            last = turn;
        });
        stepTo(twin.world, twin.camera, end);
        // The whole sweep is most of a radian; no frame takes more than a few hundredths of it.
        const swept = turnBetween(spun.world.u.starTurn.value, twin.world.u.starTurn.value);
        expect(swept).toBeGreaterThan(0.3);
        expect(largest).toBeLessThan(swept * 0.03);
        // The stars stay where the sweep left them.
        stepTo(spun.world, spun.camera, end + 30);
        stepTo(twin.world, twin.camera, end + 30);
        expect(turnBetween(spun.world.u.starTurn.value, twin.world.u.starTurn.value)).toBeCloseTo(swept, 9);
    });

    it('does not start over for a second perfect clear during the spin', () => {
        const once = makeWorld();
        const twice = makeWorld();
        perfect(once.world);
        perfect(twice.world);
        const t0 = once.world.time;
        for (const w of [once, twice]) stepTo(w.world, w.camera, t0 + SPIN_SECONDS * 0.6);
        perfect(twice.world);
        expect(twice.world.counts.perfects).toBe(2);
        let ended = null;
        stepTo(twice.world, twice.camera, t0 + SPIN_SECONDS + 4, FRAME, (w) => {
            if (!w.spinning && ended === null) ended = w.time;
        });
        stepTo(once.world, once.camera, t0 + SPIN_SECONDS + 4);
        expect(ended - t0).toBeGreaterThanOrEqual(SPIN_SECONDS);
        expect(ended - t0).toBeLessThan(SPIN_SECONDS + 2 * FRAME);
        // The same sky as after one: the same hour, the stars turned once, the double bow up.
        expect(twice.world.u.sunDir.value.distanceTo(once.world.u.sunDir.value)).toBeLessThan(1e-9);
        expect(turnBetween(twice.world.u.starTurn.value, once.world.u.starTurn.value)).toBeLessThan(1e-9);
        expect(twice.world.u.bow.value.y).toBe(1);
        expect(twice.world.u.bow.value.x).toBeCloseTo(once.world.u.bow.value.x, 6);
    });

    // WAS A FAULT (found by this test, fixed in the living pass): update() counts a finished turn (spinsDone += 1) only while spinAt still names it. A perfect
    // clear that lands in the very frame the spin has run out (the theme sends events between
    // updateCamera and update) sets a new spinAt first, so the finished turn is never counted and the
    // stars jump back the whole sweep in one frame: starTurn 1.081 → 0.031 (−1.05 rad).
    it('does not jump the stars when a second perfect clear lands in the frame the spin ends', () => {
        const { world, camera } = makeWorld();
        perfect(world);
        const t0 = world.time;
        // To the last frame that is still spinning ...
        while (world.time + FRAME < t0 + SPIN_SECONDS) stepTo(world, camera, world.time + FRAME);
        expect(world.spinning).toBe(true);
        const before = world.u.starTurn.value;
        // ... then a frame as the theme runs it: the camera, the event, the world.
        const s = sim(world.time + FRAME, FRAME);
        world.updateCamera(camera, s);
        perfect(world);
        world.update(s, camera);
        expect(turnBetween(world.u.starTurn.value, before)).toBeLessThan(0.05);
    });

    it('shows the double bow only near the spin\'s end', () => {
        const { world, camera } = makeWorld({ overrides: { hour: 2, air: 0 } });
        perfect(world);
        const t0 = world.time;
        let first = null;
        stepTo(world, camera, t0 + SPIN_SECONDS + 3, FRAME, (w) => {
            const age = w.time - t0;
            if (w.u.bow.value.x > 0 && first === null) first = age;
            // No bow while the day is still turning through its night and morning.
            if (age < SPIN_SECONDS * 0.6) expect(w.u.bow.value.x, `bow at ${age.toFixed(2)}`).toBe(0);
        });
        expect(first).toBeGreaterThan(SPIN_SECONDS * 0.6);
        expect(first).toBeLessThanOrEqual(SPIN_SECONDS);
        expect(world.u.bow.value.y).toBe(1);
        expect(world.u.bow.value.x).toBeGreaterThan(0.5);
        expect(Math.abs(world.u.bowLeg.value)).toBe(0);
    });

    it('does not spin under reduced motion: the light holds and the bow rises at once', () => {
        const calm = makeWorld({ reduced: true, overrides: { hour: 2, air: 0 } });
        const twin = makeWorld({ reduced: true, overrides: { hour: 2, air: 0 } });
        perfect(calm.world);
        const t0 = calm.world.time;
        stepTo(calm.world, calm.camera, t0 + SPIN_SECONDS + 1, FRAME, (w) => {
            expect(w.spinning).toBe(false);
            if (w.time - t0 > 0.5) expect(w.u.bow.value.x).toBeGreaterThan(0);
        });
        stepTo(twin.world, twin.camera, t0 + SPIN_SECONDS + 1);
        expect(calm.world.u.bow.value.y).toBe(1);
        expect(calm.world.u.sunDir.value.distanceTo(twin.world.u.sunDir.value)).toBe(0);
        expect(calm.world.u.starTurn.value).toBe(twin.world.u.starTurn.value);
        expect(calm.world.counts.perfects).toBe(1);
    });

    /** A world rebuilt in place from `from`, as the theme does on a quality change. */
    function rebuilt(from, quality) {
        const state = structuredClone(from.world.exportSessionState());
        const next = makeWorld({ quality, start: from.world.time, settle: false });
        if (from.world.level > 1) next.world.levelUp(from.world.level, { silent: true });
        next.world.importSessionState(state);
        next.world.updateCamera(next.camera, sim(from.world.time, 0));
        next.world.update(sim(from.world.time, 0), next.camera);
        return next;
    }

    it.each([
        ['after the spin', SPIN_SECONDS + 3],
        ['in the middle of the spin', SPIN_SECONDS * 0.4],
        ['in the middle of the level-up\'s slide', 1],
    ])('a rebuild in place %s keeps the stars\' turn and the strata\'s shift, and counts the spin once', (_, after) => {
        const a = makeWorld();
        a.world.levelUp(2);
        a.world.levelUp(3);
        perfect(a.world);
        const t0 = a.world.time;
        stepTo(a.world, a.camera, t0 + after);
        const b = rebuilt(a, 'Minimal');
        a.world.update(sim(a.world.time, 0), a.camera);
        const same = (label) => {
            expect(b.world.u.starTurn.value, `starTurn ${label}`).toBeCloseTo(a.world.u.starTurn.value, 9);
            expect(b.world.u.strataShift.value, `strataShift ${label}`).toBeCloseTo(a.world.u.strataShift.value, 9);
            expect(b.world.spinning, `spinning ${label}`).toBe(a.world.spinning);
            expect(b.world.u.sunDir.value.distanceTo(a.world.u.sunDir.value), `sunDir ${label}`).toBeLessThan(1e-9);
            expect(b.world.u.bow.value.x, `bow ${label}`).toBeCloseTo(a.world.u.bow.value.x, 9);
            expect(b.world.u.bow.value.y, `second bow ${label}`).toBeCloseTo(a.world.u.bow.value.y, 9);
        };
        same('at the rebuild');
        for (const more of [FRAME, 1, SPIN_SECONDS, 30]) {
            stepTo(a.world, a.camera, a.world.time + more);
            stepTo(b.world, b.camera, a.world.time);
            same(`${more.toFixed(2)} s on`);
        }
        expect(b.world.counts.perfects).toBe(1);
        expect(b.world.u.strataShift.value).toBeCloseTo(2 * LEVEL_SHIFT, 9);
    });
});

// ── Game over: dusk, and the sky lanterns ─────────────────────────────────────────

describe('Painted Ages events: a run\'s end sends the sky lanterns up', () => {
    const TIERS = ['Minimal', 'Low', 'High'];

    it.each(TIERS)('at %s releases them once, a small share of the pool, rising from the pavilion', (quality) => {
        const { world, camera } = makeWorld({ quality });
        const { motes } = world;
        expect(motesOf(world, MOTE_KIND.lantern)).toHaveLength(0);
        world.onGameOver();
        const t0 = world.time;
        const lanterns = motesOf(world, MOTE_KIND.lantern);
        expect(lanterns.length).toBeGreaterThan(3);
        expect(lanterns.length).toBeLessThanOrEqual(motes.pigmentSlots * 0.06);
        const terrace = groundHeight(fields, PAVILION.x, PAVILION.z, true);
        const births = [];
        for (const i of lanterns) {
            // They ride in the rain's ring: in the pigment ring the next run's first locks wrote
            // over them (this file's helper saw 3 of 18 left after 8 s at Low, none at Minimal).
            expect(i).toBeGreaterThanOrEqual(motes.pigmentSlots);
            const [x, y, z, born] = motes.start.subarray(i * 4, i * 4 + 4);
            const [, vy, , life] = motes.move.subarray(i * 4, i * 4 + 4);
            expect(Math.hypot(x - PAVILION.x, z - PAVILION.z)).toBeLessThan(12);
            // From the terrace, not from under it or from the roof's top.
            expect(y).toBeGreaterThan(terrace);
            expect(y).toBeLessThan(terrace + 12);
            expect(vy).toBeGreaterThan(0);
            // Each leaves after the run has ended, within the next seconds, and flies for a good while.
            expect(born).toBeGreaterThan(t0);
            expect(born).toBeLessThan(t0 + 20);
            expect(life).toBeGreaterThan(10);
            births.push(born);
        }
        // One after another, not all in one frame.
        expect(Math.max(...births) - Math.min(...births)).toBeGreaterThan(2);
        expect(new Set(births.map((b) => b.toFixed(2))).size).toBe(births.length);
        // A second game over soon after (a rematch lost at once) releases none.
        const first = lanterns.map((i) => motes.start[i * 4 + 3]);
        stepTo(world, camera, t0 + 10);
        world.onGameOver();
        expect(world.counts.gameOvers).toBe(2);
        const again = motesOf(world, MOTE_KIND.lantern);
        expect(again).toEqual(lanterns);
        expect(again.map((i) => motes.start[i * 4 + 3])).toEqual(first);
    });

    it('still lets dusk fall, and the next session still brings the morning', () => {
        const { world, camera } = makeWorld();
        world.onGameOver();
        stepTo(world, camera, world.time + TIMING.dusk + 0.5);
        expect(world.u.dusk.value).toBeCloseTo(1, 6);
        expect(world.u.lamps.value).toBeGreaterThan(0.99);
        stepTo(world, camera, world.time + 4);
        world.onGameOver();
        expect(world.u.dusk.value).toBeCloseTo(1, 6);
        world.resetSession();
        world.onSessionStart();
        expect(world.counts.mornings).toBe(1);
        stepTo(world, camera, world.time + TIMING.dawn + 0.5);
        expect(world.u.dusk.value).toBe(0);
        // The lanterns already up fly on into the morning (nothing snatches them from the sky).
        expect(motesOf(world, MOTE_KIND.lantern).length).toBeGreaterThan(0);
    });

    it('forgets them on a seek', () => {
        const { world } = makeWorld();
        world.onGameOver();
        expect(motesOf(world, MOTE_KIND.lantern).length).toBeGreaterThan(0);
        world.seek(world.time + 1);
        expect(motesOf(world, MOTE_KIND.lantern)).toHaveLength(0);
        // ... and a run that ends after the seek has its own.
        world.onGameOver();
        expect(motesOf(world, MOTE_KIND.lantern).length).toBeGreaterThan(0);
    });
});
