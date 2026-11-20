/**
 * Painted Ages — the clock's small happenings as the world plays them (no renderer): a meteor in
 * the dark hours, lightning far inside a cloud bank (the clock's, and a deep chain's), and the
 * dust devil the wind raises by itself.
 *
 * `flashScale()` (Settings > Reduce flashing effects, ADR-0021) is replaced by a dial here, so the
 * lightning can be read at full, reduced and no flash.
 */
import { readFileSync } from 'node:fs';
import {
    afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    PaintedAgesWorld, REST_RIG, fovForAspect,
} from '../../src/themes/painted-ages/painted-ages-world.js';
import {
    FIELDS, FIELD_ORDER, PIECE_COLORS, TIMING,
} from '../../src/themes/painted-ages/painted-ages-core.js';
import { HOUR_COUNT } from '../../src/themes/painted-ages/painted-ages-hours.js';
import {
    AIR_NAMES, HAPPENING_SECONDS, happeningAt,
} from '../../src/themes/painted-ages/painted-ages-weather.js';
import { DEVILS } from '../../src/themes/painted-ages/painted-ages-tsl.js';
import { DEVIL_LIFE } from '../../src/themes/painted-ages/painted-ages-devils.js';
import { decodeField } from '../../src/themes/painted-ages/painted-ages-field.js';
import { decodePng } from '../../scripts/painted-ages/png.mjs';

const flash = vi.hoisted(() => ({ scale: 1 }));
vi.mock('../../src/utils/photosensitivity.js', async (importOriginal) => ({
    ...(await importOriginal()),
    flashScale: () => flash.scale,
}));

const FRAME = 1 / 30;
const worlds = [];
let fields;
let prepared;

beforeAll(() => {
    fields = {};
    for (const name of FIELD_ORDER) {
        const file = new URL(`../../src/themes/painted-ages/assets/badlands-${name}.png`, import.meta.url);
        const { rgba } = decodePng(readFileSync(file));
        fields[name] = { ...decodeField(rgba, FIELDS[name]), size: FIELDS[name].size, source: 'asset' };
    }
    fields.source = 'asset';
    prepared = PaintedAgesWorld.prepareSync('Low', fields);
});

afterEach(() => {
    worlds.splice(0).forEach((world) => world.dispose());
    flash.scale = 1;
});

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

/** A built world at `start`, the clock's happenings ON (as in the game) unless overridden. */
function makeWorld({
    width = 1600, height = 900, start = 10, overrides = null, reduced = false,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new PaintedAgesWorld({
        scene, quality: 'Low', capture: true, prepared,
    }).build();
    worlds.push(world);
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    if (overrides) world.setCaptureOverrides(overrides);
    world.setReducedMotion(reduced);
    world.seek(start);
    world.updateCamera(camera, sim(start, 0));
    world.update(sim(start, 0), camera);
    return { scene, camera, world };
}

const air = (name) => AIR_NAMES.indexOf(name);
const BLUE_HOUR = 5;
const HIGH_DAY = 2;

/** The first `count` slots the clock gives to `kind`, as plain copies. */
function slotsOf(kind, count = 1) {
    const found = [];
    for (let slot = 0; found.length < count && slot < 5000; slot += 1) {
        const h = happeningAt(slot * HAPPENING_SECONDS);
        if (h.kind === kind) found.push({ ...h, from: slot * HAPPENING_SECONDS, to: (slot + 1) * HAPPENING_SECONDS });
    }
    if (found.length < count) throw new Error(`the clock never brings ${count} × ${kind}`);
    return found;
}
/** How many devils the table was handed between two frames: rows whose start changed. */
function countSpawns(world, camera, to) {
    let spawns = 0;
    let last = Array.from(world.devils.start);
    stepTo(world, camera, to, FRAME, (w) => {
        const now = Array.from(w.devils.start);
        spawns += now.filter((start, i) => start !== last[i]).length;
        last = now;
    });
    return spawns;
}
/** The strength of the far lightning over `seconds` from now, sampled finely. */
function flickerTrace(world, camera, seconds, from = world.time) {
    const rows = [];
    stepTo(world, camera, world.time + seconds, 1 / 240, (w) => {
        rows.push({ age: w.time - from, y: w.u.flicker.value.y });
    });
    return rows;
}
/** The strokes in a trace: its separate bumps (a rise after a fall starts a new one). */
function strokes(rows) {
    let count = 0;
    let rising = false;
    for (let i = 1; i < rows.length; i += 1) {
        const up = rows[i].y > rows[i - 1].y + 1e-12;
        if (up && !rising) count += 1;
        if (up) rising = true;
        else if (rows[i].y < rows[i - 1].y - 1e-12) rising = false;
    }
    return count;
}
const peakOf = (rows) => Math.max(...rows.map((row) => row.y));

describe('Painted Ages happenings: a meteor', () => {
    it.each([0, 1, 2, 3, 4, 5])('crosses the sky only while the stars are out (hour %i held)', (hour) => {
        const [meteor] = slotsOf('meteor');
        const { world, camera } = makeWorld({ start: meteor.start - 0.5, overrides: { hour } });
        expect(world.u.meteor.value.w).toBe(0);
        let peak = 0;
        let lastAge = 0;
        stepTo(world, camera, meteor.start + 2, 1 / 120, (w) => {
            const [, , age, strength] = w.u.meteor.value.toArray();
            expect(strength).toBeGreaterThanOrEqual(0);
            expect(strength).toBeLessThanOrEqual(1);
            peak = Math.max(peak, strength);
            // Its age runs with the clock from its start (the head moves down the sky with it).
            expect(age).toBeGreaterThanOrEqual(lastAge);
            lastAge = age;
        });
        if (hour === BLUE_HOUR) expect(peak).toBeGreaterThan(0.5);
        else expect(peak).toBe(0);
        // Gone when its window is over.
        expect(world.u.meteor.value.w).toBe(0);
        world.u.meteor.value.toArray().forEach((v) => expect(Number.isFinite(v)).toBe(true));
    });

    it('by the clock alone shows only when the stars are high, over two days of the wheel', () => {
        const { world, camera } = makeWorld({ start: 0 });
        let shown = 0;
        stepTo(world, camera, TIMING.hour * HOUR_COUNT * 2, FRAME, (w) => {
            if (w.u.meteor.value.w > 0) {
                shown += 1;
                expect(w.u.stars.value, `stars at ${w.time.toFixed(1)} s`).toBeGreaterThan(0.35);
            }
        });
        // It does come (two nights have several meteor slots between them).
        expect(shown).toBeGreaterThan(0);
    });

    it('is silenced with the happenings', () => {
        const [meteor] = slotsOf('meteor');
        const overrides = { hour: BLUE_HOUR, happenings: false };
        const { world, camera } = makeWorld({ start: meteor.start - 0.5, overrides });
        stepTo(world, camera, meteor.start + 2, 1 / 120, (w) => expect(w.u.meteor.value.w).toBe(0));
    });
});

describe('Painted Ages happenings: lightning far inside a bank', () => {
    /** A chain's fourth step: the storm's own stroke, whatever the hour. */
    function chainStroke(scale) {
        flash.scale = scale;
        const { world, camera } = makeWorld({ overrides: { hour: HIGH_DAY, happenings: false } });
        for (let n = 1; n <= 3; n += 1) world.onCombo(n);
        const quiet = flickerTrace(world, camera, 1);
        world.onCombo(4);
        return { quiet, rows: flickerTrace(world, camera, 1.5), world };
    }

    it('answers a chain step at combo 4 and deeper, not a shorter chain', () => {
        const { quiet, rows, world } = chainStroke(1);
        expect(peakOf(quiet)).toBe(0);
        expect(peakOf(rows)).toBeGreaterThan(0.5);
        // It names a bank and carries a seed.
        const [bank, , seed] = world.u.flicker.value.toArray();
        expect(Number.isInteger(bank)).toBe(true);
        expect(bank).toBeGreaterThanOrEqual(0);
        expect(seed).toBeGreaterThanOrEqual(0);
        expect(seed).toBeLessThan(1);
        // Over within a second or so: a flicker, not a lamp left on.
        expect(rows[rows.length - 1].y).toBe(0);
        expect(rows.filter((row) => row.y > 0).pop().age).toBeLessThan(1.1);
    });

    it('at full flash is a stroke and its echo', () => {
        expect(strokes(chainStroke(1).rows)).toBe(2);
    });

    it('is multiplied by flashScale(): nothing at 0', () => {
        const { rows } = chainStroke(0);
        expect(peakOf(rows)).toBe(0);
    });

    it.each([0.5, 0.2, 0.06])('below full flash (scale %f) is one stroke with no echo, scaled down', (scale) => {
        const full = chainStroke(1).rows;
        const { rows } = chainStroke(scale);
        expect(strokes(rows)).toBe(1);
        expect(peakOf(rows)).toBeGreaterThan(0);
        expect(peakOf(rows)).toBeLessThanOrEqual(scale * peakOf(full) + 1e-9);
        // Through the first stroke it is the full one times the scale, frame for frame.
        const firstStroke = full.findIndex((row, i) => i > 0 && row.y < full[i - 1].y);
        expect(firstStroke).toBeGreaterThan(3);
        for (let i = 0; i < firstStroke; i += 1) {
            expect(rows[i].y, `at ${rows[i].age.toFixed(3)}`).toBeCloseTo(scale * full[i].y, 9);
        }
        // It is over sooner (the echo's time stays dark).
        const lastLit = (trace) => trace.filter((row) => row.y > 0).pop().age;
        expect(lastLit(rows)).toBeLessThan(lastLit(full));
    });

    it('the clock\'s own comes in the dim hours over a grown bank, and is scaled and silenced the same', () => {
        const [flicker] = slotsOf('flicker');
        const at = (overrides, scale = 1) => {
            flash.scale = scale;
            const { world, camera } = makeWorld({ start: flicker.start - 0.5, overrides });
            const before = flickerTrace(world, camera, 0.45);
            const rows = flickerTrace(world, camera, 2, flicker.start);
            expect(peakOf(before)).toBe(0); // not before its start
            return rows;
        };
        const night = at({ hour: BLUE_HOUR, air: air('towers') });
        expect(peakOf(night)).toBeGreaterThan(0.5);
        expect(strokes(night)).toBe(2);
        expect(night[night.length - 1].y).toBe(0);
        // Not at high day (the iris is closed: a flicker would not read), nor over banks that have not grown.
        expect(peakOf(at({ hour: HIGH_DAY, air: air('towers') }))).toBe(0);
        expect(peakOf(at({ hour: BLUE_HOUR, air: air('crystal') }))).toBe(0);
        expect(peakOf(at({ hour: BLUE_HOUR, air: air('towers'), happenings: false }))).toBe(0);
        expect(peakOf(at({ hour: BLUE_HOUR, air: air('towers') }, 0))).toBe(0);
        const reduced = at({ hour: BLUE_HOUR, air: air('towers') }, 0.3);
        expect(strokes(reduced)).toBe(1);
        expect(peakOf(reduced)).toBeLessThanOrEqual(0.3 * peakOf(night) + 1e-9);
        expect(peakOf(reduced)).toBeGreaterThan(0);
    });

    // WAS A FAULT (found by this test, fixed in the living pass) (painted-ages-tsl.js: "Lightning inside a far bank: (the bank's index, strength 0..1, a
    // seed)"): the echo (0.7 ×) begins 0.42 s in, while the first stroke (life 0.6 s) is still at
    // 0.47, so the two add up to 1.18 at full flash.
    it('keeps the flicker\'s strength within the 0..1 its uniform is documented to carry', () => {
        expect(peakOf(chainStroke(1).rows)).toBeLessThanOrEqual(1);
    });
});

describe('Painted Ages happenings: the wind\'s own dust devil', () => {
    const [gust] = slotsOf('gust');

    it('comes once in its slot by day, pale, on the side the clock drew', () => {
        const { world, camera } = makeWorld({ start: gust.from, overrides: { hour: HIGH_DAY } });
        expect(world.devils.standing(world.time)).toBe(0);
        // Not before its start ...
        expect(countSpawns(world, camera, gust.start - FRAME)).toBe(0);
        // ... then one, within a moment of it, and no second one however long the slot runs.
        expect(countSpawns(world, camera, gust.start + 0.5)).toBe(1);
        expect(world.devils.standing(world.time)).toBe(1);
        const row = world.u.tables.devils.findIndex((r, i) => i % 3 === 2 && r.w > 0) - 2;
        const [foot, look, turn] = world.u.tables.devils.slice(row, row + 3);
        expect(foot.w).toBeGreaterThanOrEqual(gust.start);
        expect(foot.w).toBeLessThan(gust.start + 2 * FRAME);
        // Fainter than a twist's (which stands at full strength), and dust-pale: no pigment's colour.
        expect(turn.w).toBeGreaterThan(0);
        expect(turn.w).toBeLessThan(1);
        expect(Math.max(look.x, look.y, look.z) - Math.min(look.x, look.y, look.z)).toBeLessThan(0.5);
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const side = (foot.x - camera.position.x) * right.x + (foot.z - camera.position.z) * right.z;
        expect(Math.sign(side)).toBe(gust.side);
        expect(countSpawns(world, camera, gust.to - FRAME)).toBe(0);
    });

    it.each([
        ['at night', { hour: BLUE_HOUR }, false],
        ['under reduced motion', { hour: HIGH_DAY }, true],
        ['with the happenings silenced', { hour: HIGH_DAY, happenings: false }, false],
    ])('does not come %s', (_, overrides, reduced) => {
        const { world, camera } = makeWorld({ start: gust.from, overrides, reduced });
        expect(countSpawns(world, camera, gust.to - FRAME)).toBe(0);
        expect(world.devils.standing(world.time)).toBe(0);
    });

    it('does not come while a devil already stands, nor under a game over\'s dusk', () => {
        const busy = makeWorld({ start: gust.start - 2, overrides: { hour: HIGH_DAY } });
        busy.world.onSpin({ u: 0.8, color: PIECE_COLORS[1] });
        expect(busy.world.devils.standing(busy.world.time)).toBe(1);
        expect(DEVIL_LIFE).toBeGreaterThan(2 + 1.2); // it still stands through the gust's arming
        expect(countSpawns(busy.world, busy.camera, gust.to - FRAME)).toBe(0);
        const dusk = makeWorld({ start: gust.start - TIMING.dusk - 1, overrides: { hour: HIGH_DAY } });
        dusk.world.onGameOver();
        expect(countSpawns(dusk.world, dusk.camera, gust.to - FRAME)).toBe(0);
    });

    it('by the clock alone never comes twice in a slot, never beside a standing devil, and never at night', () => {
        const { world, camera } = makeWorld({ start: 0 });
        const perSlot = new Map();
        let last = Array.from(world.devils.start);
        let standingBefore = 0;
        stepTo(world, camera, TIMING.hour * HOUR_COUNT * 2, FRAME, (w) => {
            const now = Array.from(w.devils.start);
            const born = now.filter((start, i) => start !== last[i]).length;
            if (born) {
                const slot = Math.floor(w.time / HAPPENING_SECONDS);
                perSlot.set(slot, (perSlot.get(slot) || 0) + born);
                expect(happeningAt(w.time).kind, `slot ${slot}`).toBe('gust');
                expect(standingBefore, `standing when slot ${slot}'s gust came`).toBe(0);
                expect(w.u.sunUp.value, `sun at slot ${slot}`).toBeGreaterThan(0.5);
                expect(w.u.dusk.value).toBe(0);
            }
            last = now;
            standingBefore = w.devils.standing(w.time);
            expect(standingBefore).toBeLessThanOrEqual(DEVILS);
        });
        expect(perSlot.size).toBeGreaterThan(5);
        for (const [slot, count] of perSlot) expect(count, `slot ${slot}`).toBe(1);
    });

    // WAS A FAULT (found by this test, fixed in the living pass) (happen()'s comment: "Pure functions of the time"; weather.js: "a seek lands on the same
    // sky"): the gust's devil is spawned by an edge (the first frame inside a 1.2 s arming window),
    // not derived from the clock. A world sought to 3 s after the gust began shows no devil where a
    // live run has one standing (and sought inside the window, it starts the devil at the seek).
    it('stands after a seek into its life as it does in a live run', () => {
        const live = makeWorld({ start: gust.from, overrides: { hour: HIGH_DAY } });
        stepTo(live.world, live.camera, gust.start + 3);
        expect(live.world.devils.standing(live.world.time)).toBe(1);
        const sought = makeWorld({ start: gust.start + 3, overrides: { hour: HIGH_DAY } });
        stepTo(sought.world, sought.camera, gust.start + 3 + FRAME);
        expect(sought.world.devils.standing(sought.world.time)).toBe(1);
    });
});
