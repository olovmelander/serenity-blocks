/**
 * Pyrestorm — the living pass (2026-11): the eruption's phases, the mountain's own happenings, the
 * moon, the snags, and the events that got a shape of their own (a flank vent for a level-up, a
 * fire whirl for a twist, blue fire for a back-to-back run, the thermal and the flows for four
 * lines, the wave of fire for a perfect clear, spatter for a hard drop, the fissure for three lines,
 * a last breath and a waking burst for a run's end and the next one's start).
 *
 * As in pyrestorm-world.test.js the world runs without a renderer and what each thing does is held
 * as a property (what it moves, in which order, within which bounds), not as a tuned number.
 */
import {
    afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    PYRESTORM_PARTS, PyrestormWorld, REST_RIG, fovForAspect,
} from '../../src/themes/pyrestorm/pyrestorm-world.js';
import {
    EYE, PIECE_COLORS, TIMING, VOLCANO, landHeight,
} from '../../src/themes/pyrestorm/pyrestorm-core.js';
import {
    HAPPENINGS, HAPPEN_SECONDS, PHASES, PHASE_KEYS, PHASE_REST, PHASE_SECONDS, happeningAt, phaseAt, phaseIndexOf, phasePlace,
} from '../../src/themes/pyrestorm/pyrestorm-phases.js';
import { WATCHES, watchAt } from '../../src/themes/pyrestorm/pyrestorm-hours.js';
import { FLANK_VENTS } from '../../src/themes/pyrestorm/pyrestorm-tsl.js';
import { PUFF } from '../../src/themes/pyrestorm/pyrestorm-smoke.js';
import { BOMB } from '../../src/themes/pyrestorm/pyrestorm-fire.js';
import { SNAG_PLACES, snagGeometry, snagRoot } from '../../src/themes/pyrestorm/pyrestorm-snags.js';
import { PYRESTORM_SNAG_MODELS } from '../../src/themes/pyrestorm/pyrestorm-snag-models.js';
import {
    WHIRL_LIFE, WHIRL_SLOTS, whirlEnvelope,
} from '../../src/themes/pyrestorm/pyrestorm-whirl.js';
import { fallbackLayout, outsideKeepOut } from '../../src/themes/pyrestorm/pyrestorm-composition.js';
import { FANS_PER_VENT, FAN_SLOTS } from '../../src/themes/pyrestorm/pyrestorm-fans.js';
import { BOLT } from '../../src/themes/pyrestorm/pyrestorm-bolts.js';
import { REDUCED_FLASH_SCALE } from '../../src/utils/photosensitivity.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const START = 10;
let prepared;
const worlds = [];

beforeAll(() => {
    prepared = PyrestormWorld.prepareSync('Minimal');
});

afterEach(() => {
    worlds.splice(0).forEach((world) => world.dispose());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

const sim = (time, delta) => ({
    time, delta, pointerX: 0, pointerY: 0,
});

/** A world: by default held on the first phase with the happenings off; `living` leaves it to itself. */
function makeWorld({
    width = 1600, height = 900, start = START, living = false, phase = 0,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new PyrestormWorld({
        scene, quality: 'Minimal', capture: true, prepared,
    }).build();
    worlds.push(world);
    if (!living) world.setCaptureOverrides({ phase, happenings: false });
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    world.seek(start);
    world.updateCamera(camera, sim(start, 0));
    world.update(sim(start, 0), camera);
    return { world, camera };
}

function stepTo(world, camera, to, dt = 1 / 30, each = null) {
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

const clockPhase = (time) => phaseIndexOf(phasePlace(time));

// ── The phases ───────────────────────────────────────────────────────────────────

describe('Pyrestorm phases: the wheel', () => {
    it('starts on the mountain as it always was: every number of the first phase is one, its lake still', () => {
        const first = PHASES[0];
        for (const key of PHASE_KEYS) {
            if (key === 'storm' || key === 'fall' || key === 'lake') continue;
            expect(first[key], key).toBe(1);
        }
        expect(first.lake).toBe(0);
        expect(new Set(PHASES.map((p) => p.name)).size).toBe(PHASES.length);
        expect(PHASES.length).toBeGreaterThanOrEqual(4);
    });

    it('gives every phase a look of its own: each differs from the next in what the eye reads first', () => {
        const seen = ['fountain', 'body', 'cover', 'flux', 'fissure'];
        PHASES.forEach((phase, i) => {
            const next = PHASES[(i + 1) % PHASES.length];
            const change = Math.max(...seen.map((key) => Math.abs(next[key] - phase[key]) / Math.max(phase[key], next[key])));
            expect(change, `${phase.name} → ${next.name}`).toBeGreaterThan(0.3);
        });
        // The wheel holds a height of fire, a darkness of ash, a flood of lava and a quiet.
        expect(Math.max(...PHASES.map((p) => p.fountain))).toBeGreaterThan(1.8);
        expect(Math.max(...PHASES.map((p) => p.body))).toBeGreaterThan(1.3);
        expect(Math.max(...PHASES.map((p) => p.flux))).toBeGreaterThan(1.3);
        expect(Math.min(...PHASES.map((p) => p.cover))).toBeLessThan(0.5);
    });

    it('rests on a phase at each end of its step, mixes plainly between, and goes round', () => {
        const out = phaseAt(0);
        for (const key of PHASE_KEYS) expect(out[key]).toBe(PHASES[0][key]);
        for (let k = 0; k < PHASES.length * 2; k++) {
            const A = PHASES[k % PHASES.length];
            const B = PHASES[(k + 1) % PHASES.length];
            for (const key of PHASE_KEYS) {
                expect(phaseAt(k + PHASE_REST * 0.5)[key], `${A.name} rests`).toBeCloseTo(A[key], 12);
                expect(phaseAt(k + 1 - PHASE_REST * 0.5)[key], `${B.name} rests`).toBeCloseTo(B[key], 12);
                expect(phaseAt(k + 0.5)[key], `${A.name} → ${B.name}`).toBeCloseTo((A[key] + B[key]) / 2, 9);
            }
        }
        // Every value stays between its two phases all the way: no overshoot.
        for (let p = 0; p <= PHASES.length; p += 0.01) {
            const E = phaseAt(p);
            const A = PHASES[E.from];
            const B = PHASES[E.to];
            for (const key of PHASE_KEYS) {
                expect(E[key]).toBeGreaterThanOrEqual(Math.min(A[key], B[key]) - 1e-9);
                expect(E[key]).toBeLessThanOrEqual(Math.max(A[key], B[key]) + 1e-9);
            }
        }
    });

    it('is turned by the clock alone, a phase every PHASE_SECONDS, and a level steps it one on', () => {
        expect(phasePlace(0)).toBe(0);
        expect(phasePlace(PHASE_SECONDS * 3)).toBeCloseTo(3, 12);
        expect(phasePlace(PHASE_SECONDS * 3, 2)).toBeCloseTo(5, 12);
        // A mood in the 80-150 s band the house rule asks for, and not the watches' own pace (so
        // the same phase meets a different night each time round).
        expect(PHASE_SECONDS).toBeGreaterThanOrEqual(80);
        expect(PHASE_SECONDS).toBeLessThanOrEqual(150);
        expect(PHASE_SECONDS).not.toBe(TIMING.watch);
        expect(phaseIndexOf(0.4)).toBe(0);
        expect(phaseIndexOf(0.6)).toBe(1);
        expect(phaseIndexOf(PHASES.length - 0.4)).toBe(0);
    });
});

// ── The happenings ───────────────────────────────────────────────────────────────

describe('Pyrestorm happenings: the schedule', () => {
    it('is the clock\'s alone: the same slot is the same happening, and its moment falls inside its slot', () => {
        for (let k = 0; k < 400; k++) {
            const a = happeningAt(k, clockPhase);
            const b = happeningAt(k, clockPhase);
            expect(a).toEqual(b);
            expect(a.at).toBeGreaterThanOrEqual(k * HAPPEN_SECONDS);
            expect(a.at).toBeLessThan((k + 1) * HAPPEN_SECONDS);
            for (const n of [a.a, a.b, a.c]) {
                expect(n).toBeGreaterThanOrEqual(0);
                expect(n).toBeLessThan(1);
            }
            if (k > 0) expect(HAPPENINGS).toContain(a.kind);
        }
        // A theme just picked shows the rest picture first.
        expect(happeningAt(0, clockPhase).kind).toBeNull();
    });

    it('never does the same thing twice running, and does all of them', () => {
        const count = {};
        let last = null;
        for (let k = 1; k < 3000; k++) {
            const { kind } = happeningAt(k, clockPhase);
            expect(kind, `slot ${k}`).not.toBe(last);
            last = kind;
            count[kind] = (count[kind] || 0) + 1;
        }
        for (const kind of HAPPENINGS) expect(count[kind], kind).toBeGreaterThan(100);
    });

    it('suits the phase it falls in: the storm strikes in the ash, never in the glow; stars fall on a clear sky', () => {
        const ash = PHASES.findIndex((p) => p.name === 'ash storm');
        const glow = PHASES.findIndex((p) => p.name === 'the glow');
        const tally = (index) => {
            const count = {};
            for (let k = 1; k < 2500; k++) {
                const { kind } = happeningAt(k, () => index);
                count[kind] = (count[kind] || 0) + 1;
            }
            return count;
        };
        const inAsh = tally(ash);
        const inGlow = tally(glow);
        expect(inAsh.stroke).toBeGreaterThan(inAsh.bomb);
        expect(inAsh.meteor || 0).toBe(0);
        expect(inGlow.stroke || 0).toBe(0);
        expect(inGlow.meteor).toBeGreaterThan(inGlow.bomb);
        expect(inGlow.lake).toBeGreaterThan(inGlow.bomb);
    });
});

describe('Pyrestorm happenings: the world', () => {
    it('fires each at its moment, by itself, without counting it as play or shaking the ridge', () => {
        const { world, camera } = makeWorld({ living: true, start: 0 });
        const before = { ...world.counts };
        const fired = [];
        const happen = world.happen.bind(world);
        vi.spyOn(world, 'happen').mockImplementation((h) => {
            fired.push({ kind: h.kind, at: h.at, time: world.time });
            return happen(h);
        });
        let shaken = 0;
        stepTo(world, camera, HAPPEN_SECONDS * 9, 1 / 30, (w) => {
            const s = w.getState().shake;
            shaken = Math.max(shaken, Math.abs(s.x), Math.abs(s.y), Math.abs(s.roll));
        });
        // Slot 0 holds none; slots 1..8 each fired once, in order, on the frame their moment came.
        expect(fired.map((f) => f.kind)).toEqual(Array.from({ length: 8 }, (_, i) => happeningAt(i + 1, clockPhase).kind));
        for (const f of fired) {
            expect(f.time).toBeGreaterThanOrEqual(f.at);
            expect(f.time - f.at).toBeLessThan(1 / 30 + 1e-6);
        }
        expect(world.counts.happenings).toBe(8);
        for (const key of ['locks', 'hardDrops', 'clears', 'lines', 'bolts', 'quads', 'twists', 'perfects', 'levelUps', 'vents', 'whirls']) {
            expect(world.counts[key], key).toBe(before[key]);
        }
        expect(shaken).toBe(0);
    });

    it('does not replay what came before a seek, and keeps quiet while held off or asleep', () => {
        const late = HAPPEN_SECONDS * 6.5;
        const { world, camera } = makeWorld({ living: true, start: late });
        const spy = vi.spyOn(world, 'happen');
        stepTo(world, camera, late + 0.5);
        // Whatever slot 6's moment was, at most that one is still to come: none of slots 1..5.
        for (const call of spy.mock.calls) expect(call[0].at).toBeGreaterThan(late);
        const held = makeWorld({ start: 0 });
        const heldSpy = vi.spyOn(held.world, 'happen');
        stepTo(held.world, held.camera, HAPPEN_SECONDS * 4);
        expect(heldSpy).not.toHaveBeenCalled();
        const asleep = makeWorld({ living: true, start: 0 });
        asleep.world.onGameOver();
        const asleepSpy = vi.spyOn(asleep.world, 'happen');
        stepTo(asleep.world, asleep.camera, HAPPEN_SECONDS * 4);
        expect(asleepSpy).not.toHaveBeenCalled();
    });

    it.each(HAPPENINGS)('does a %s without a throw, a NaN or a counter of play moved', (kind) => {
        const { world, camera } = makeWorld();
        const { locks, bolts, clears } = world.counts;
        world.happen({
            kind, at: world.time, a: 0.4, b: 0.6, c: 0.3,
        });
        stepTo(world, camera, world.time + 3);
        expect(world.counts).toMatchObject({ locks, bolts, clears });
        for (const [key, node] of Object.entries(world.u)) {
            if (key === 'tables' || !node || !('value' in node)) continue;
            const values = typeof node.value === 'number' ? [node.value] : node.value?.toArray?.() || [];
            for (const v of values) expect(Number.isFinite(v), key).toBe(true);
        }
    });
});

// ── The world follows the phases ─────────────────────────────────────────────────

describe('Pyrestorm phases: the world', () => {
    it('follows the wheel with the clock: the column, the anvil, the lava and the fountain turn with the phase', () => {
        const { world, camera } = makeWorld({ living: true, start: 0 });
        const read = () => ({
            body: world.u.plume.value.x, cover: world.u.cover.value, flux: world.u.lavaFlux.value, fountain: world.u.fountain.value,
        });
        const at = {};
        // The middle of each phase's rest (its step's start), a little after the fountain has settled.
        for (let k = 0; k < PHASES.length; k++) {
            stepTo(world, camera, PHASE_SECONDS * (k + PHASE_REST * 0.75), 1 / 10);
            at[k] = read();
            expect(world.getState().phase.from, PHASES[k].name).toBe(k);
            expect(at[k].body).toBeCloseTo(PHASES[k].body, 6);
            expect(at[k].cover).toBeCloseTo(PHASES[k].cover, 6);
            expect(at[k].flux).toBeCloseTo(PHASES[k].flux, 6);
        }
        const tallest = PHASES.reduce((best, p, i) => (p.fountain > PHASES[best].fountain ? i : best), 0);
        const lowest = PHASES.reduce((best, p, i) => (p.fountain < PHASES[best].fountain ? i : best), 0);
        expect(at[tallest].fountain).toBeGreaterThan(at[lowest].fountain * 2.5);
        // Round the wheel and back on the first phase.
        stepTo(world, camera, PHASE_SECONDS * (PHASES.length + PHASE_REST * 0.75), 1 / 10);
        expect(world.getState().phase.from).toBe(0);
        expect(read().body).toBeCloseTo(PHASES[0].body, 6);
    });

    it('never jumps: every frame of two hundred seconds moves each phase value by a hair', () => {
        const { world, camera } = makeWorld({ living: true, start: 0 });
        world.setCaptureOverrides({ happenings: false });
        const read = () => [world.u.plume.value.x, world.u.plume.value.y, world.u.plume.value.z, world.u.cover.value,
            world.u.lavaFlux.value, world.u.fountain.value, world.u.fissure.value, world.u.embers.value, world.u.ashFall.value,
            world.u.lavaHeat.value, world.u.burst.value];
        let last = read();
        let worst = 0;
        stepTo(world, camera, 200, 1 / 60, () => {
            const now = read();
            for (let i = 0; i < now.length; i++) worst = Math.max(worst, Math.abs(now[i] - last[i]));
            last = now;
        });
        expect(worst).toBeLessThan(0.012);
    });

    it('moves one phase on with a level, eased, with the night', () => {
        const { world, camera } = makeWorld({ living: true });
        const place = () => world.getState().phase.place;
        const before = place();
        world.levelUp(2);
        stepTo(world, camera, world.time + 0.1);
        // Eased: a tenth of a second on it has barely begun.
        expect(place() - before).toBeLessThan(0.1);
        stepTo(world, camera, world.time + TIMING.levelTurn);
        const turned = (TIMING.levelTurn + 0.1) / PHASE_SECONDS;
        expect(place() - before).toBeCloseTo(1 + turned, 3);
        // A restored level (a rebuild in place) moves it at once and opens no vent.
        const { world: rebuilt, camera: cam2 } = makeWorld({ living: true });
        rebuilt.levelUp(3, { silent: true });
        stepTo(rebuilt, cam2, rebuilt.time + 1 / 30);
        expect(rebuilt.getState().phase.place).toBeCloseTo(2 + (START + 1 / 30) / PHASE_SECONDS, 6);
        expect(rebuilt.counts.vents).toBe(0);
    });

    it('lets the storm strike by itself in the ash, and never in a lull', () => {
        const ash = PHASES.findIndex((p) => p.name === 'ash storm');
        const glow = PHASES.findIndex((p) => p.name === 'the glow');
        const run = (phase) => {
            const { world, camera } = makeWorld({ phase });
            const strike = vi.spyOn(world, 'strikeFrom');
            const { spiders } = world.counts;
            stepTo(world, camera, world.time + 40);
            return { strokes: strike.mock.calls.length, spiders: world.counts.spiders - spiders, bolts: world.counts.bolts };
        };
        const inAsh = run(ash);
        const inGlow = run(glow);
        expect(inAsh.strokes).toBeGreaterThan(2);
        expect(inGlow.strokes).toBe(0);
        expect(inAsh.spiders).toBeGreaterThan(inGlow.spiders * 3);
        // Its own strokes are not play's: the bolt counter stands.
        expect(inAsh.bolts).toBe(0);
    });

    it('breathes the lake\'s glow in the lull, through what a burst\'s glow lights', () => {
        const glow = PHASES.findIndex((p) => p.name === 'the glow');
        const { world, camera } = makeWorld({ phase: glow });
        let lo = Infinity;
        let hi = -Infinity;
        stepTo(world, camera, world.time + 30, 1 / 30, (w) => {
            lo = Math.min(lo, w.u.burst.value);
            hi = Math.max(hi, w.u.burst.value);
        });
        expect(lo).toBeGreaterThan(0.1);
        expect(hi).toBeGreaterThan(lo * 2);
        const { world: rest } = makeWorld();
        expect(rest.u.burst.value).toBe(0);
    });
});

// ── The moon ─────────────────────────────────────────────────────────────────────

describe('Pyrestorm moon', () => {
    it('is under the horizon at dusk and climbs through the night; every watch has a key light', () => {
        const dusk = WATCHES.findIndex((w) => w.name === 'ember dusk');
        const deep = WATCHES.findIndex((w) => w.name === 'indigo deep night');
        expect(WATCHES[dusk].moonEl).toBeLessThan(0);
        expect(WATCHES[deep].moonEl).toBeGreaterThan(8);
        for (let i = 1; i < WATCHES.length; i++) expect(WATCHES[i].moonEl).toBeGreaterThan(WATCHES[i - 1].moonEl);
        // The land is never left without a light to give it a shape: the afterglow's at dusk.
        for (const watch of WATCHES) expect(Math.max(...watch.moon), watch.name).toBeGreaterThan(0.1);
        // The moon's light is cool, the afterglow's warm.
        expect(WATCHES[deep].moon[2]).toBeGreaterThan(WATCHES[deep].moon[0]);
        expect(WATCHES[dusk].moon[0]).toBeGreaterThan(WATCHES[dusk].moon[2]);
    });

    it('stands on the sky where the watch puts it, with a unit frame and a raking light from its side', () => {
        for (let place = 0; place <= 4; place += 0.25) {
            const { world, camera } = makeWorld();
            world.setCaptureOverrides({ watch: place });
            stepTo(world, camera, world.time + 1 / 30);
            const L = watchAt(place);
            const d = world.u.moonDir.value;
            const r = world.u.moonRight.value;
            const up = world.u.moonUp.value;
            expect(d.length()).toBeCloseTo(1, 6);
            expect(r.length()).toBeCloseTo(1, 6);
            expect(up.length()).toBeCloseTo(1, 6);
            expect(Math.abs(d.dot(r))).toBeLessThan(1e-6);
            expect(Math.abs(d.dot(up))).toBeLessThan(1e-6);
            expect(Math.asin(d.y) * (180 / Math.PI)).toBeCloseTo(L.moonEl, 4);
            // The disc shows only once it has cleared the horizon.
            expect(world.u.moonShow.value).toBe(L.moonEl <= -1.5 ? 0 : world.u.moonShow.value);
            if (L.moonEl >= 2.5) expect(world.u.moonShow.value).toBe(1);
            // The key light comes from above the land, from the moon's side of the view (the left).
            const rake = world.u.rake.value;
            expect(rake.length()).toBeCloseTo(1, 6);
            expect(rake.y).toBeGreaterThan(0.15);
            expect(rake.x).toBeLessThan(0);
            world.dispose();
            worlds.splice(worlds.indexOf(world), 1);
        }
    });
});

// ── The events ───────────────────────────────────────────────────────────────────

describe('Pyrestorm events: a shape for each', () => {
    it('opens a flank vent on a level-up: its stream runs out from its head, stops, and cools', () => {
        const { world, camera } = makeWorld();
        expect(world.getState().vents.every((v) => v.heat === 0)).toBe(true);
        world.levelUp(2);
        expect(world.counts.vents).toBe(1);
        const fronts = [];
        const sparks = [];
        const spawn = world.bombs.spawn.bind(world.bombs);
        vi.spyOn(world.bombs, 'spawn').mockImplementation((b) => {
            if (b.kind === BOMB.spark) sparks.push(b);
            return spawn(b);
        });
        stepTo(world, camera, world.time + 20, 1 / 30, (w) => fronts.push(w.getState().vents[0]));
        const first = fronts[0];
        const last = fronts[fronts.length - 1];
        // On the cone, clear of the crater, and running downhill (out from the axis).
        expect(first.head).toBeGreaterThan(VOLCANO.crater * 2);
        expect(last.front).toBeGreaterThan(first.head + 2000);
        expect(last.front).toBeLessThan(VOLCANO.radius);
        for (let i = 1; i < fronts.length; i++) expect(fronts[i].front).toBeGreaterThanOrEqual(fronts[i - 1].front);
        // It has nearly stopped by now.
        expect(last.front - fronts[fronts.length - 30].front).toBeLessThan(30);
        expect(first.heat).toBe(1);
        expect(last.heat).toBeLessThan(first.heat);
        expect(last.heat).toBeGreaterThan(0.3);
        // Its fountains played along its head, on the land.
        expect(sparks.length).toBeGreaterThan(20);
        for (const b of sparks) {
            expect(Math.abs(b.y - 4 - landHeight(b.x, b.z))).toBeLessThan(1e-6);
            const out = Math.hypot(b.x - VOLCANO.x, b.z - VOLCANO.z);
            expect(out).toBeGreaterThanOrEqual(first.head - 1);
            expect(out).toBeLessThan(first.head + 700);
        }
        // In the end it goes out.
        stepTo(world, camera, world.time + 150, 1 / 5);
        expect(world.getState().vents[0].heat).toBe(0);
    });

    it('keeps two vents at most, each on a bearing of its own, facing the eye', () => {
        const { world, camera } = makeWorld();
        const bearings = [];
        for (let level = 2; level <= 6; level++) {
            world.levelUp(level);
            stepTo(world, camera, world.time + 1);
            const lit = world.u.tables.flank.filter((_, i) => i % 2 === 1).filter((row) => row.y > 0);
            expect(lit.length).toBe(Math.min(FLANK_VENTS, level - 1));
            const newest = world.vents[(world.ventCursor + FLANK_VENTS - 1) % FLANK_VENTS];
            bearings.push(Math.atan2(newest.sin, newest.cos));
            // On the half of the cone the eye sees.
            const toEye = [EYE.x - VOLCANO.x, EYE.z - VOLCANO.z];
            expect(newest.cos * toEye[0] + newest.sin * toEye[1]).toBeGreaterThan(0);
        }
        for (let i = 1; i < bearings.length; i++) expect(Math.abs(bearings[i] - bearings[i - 1])).toBeGreaterThan(0.15);
        expect(world.counts.vents).toBe(5);
    });

    it('raises a fire whirl off a near river on a twist, on the side the piece turned in on', () => {
        const { world, camera } = makeWorld();
        world.onLock({ u: 0.15, rows: [19], color: PIECE_COLORS[1] });
        world.onClear({
            lines: 1, rows: [19], twist: true, combo: 1,
        });
        expect(world.counts.whirls).toBe(1);
        const live = world.whirls.tables.filter((_, i) => i % 2 === 1).filter((row) => row.z > 0);
        expect(live.length).toBe(1);
        const place = world.whirls.tables[0];
        // On the left river (the piece turned in on the left), near the eye, on the land, and seen.
        expect(place.x).toBeLessThan(EYE.x);
        expect(Math.hypot(place.x - EYE.x, place.z - EYE.z)).toBeLessThan(2600);
        expect(Math.abs(place.y - 3 - landHeight(place.x, place.z))).toBeLessThan(1e-3);
        expect(world.seen([place.x, place.y, place.z])).toBe(true);
        // It lights the land round it while it stands, and is gone after its life.
        stepTo(world, camera, world.time + 1.5);
        expect(world.u.lightCount.value).toBeGreaterThan(0);
        expect(whirlEnvelope(1.5)).toBeGreaterThan(0.8);
        expect(whirlEnvelope(WHIRL_LIFE)).toBe(0);
        expect(whirlEnvelope(-1)).toBe(0);
        // The right side for a piece on the right.
        const right = makeWorld();
        right.world.onLock({ u: 0.9, rows: [19], color: PIECE_COLORS[1] });
        right.world.onClear({
            lines: 1, rows: [19], twist: true, combo: 1,
        });
        expect(right.world.whirls.tables[0].x).toBeGreaterThan(EYE.x);
    });

    it('raises a whirl on both rivers for a twist of two lines, a small one for a twist that cleared nothing', () => {
        const big = makeWorld();
        big.world.onLock({ u: 0.2, rows: [19, 18], color: PIECE_COLORS[1] });
        big.world.onClear({
            lines: 2, rows: [19, 18], twist: true, combo: 1,
        });
        expect(big.world.counts.whirls).toBe(2);
        const xs = [big.world.whirls.tables[0].x, big.world.whirls.tables[2].x];
        expect(Math.min(...xs)).toBeLessThan(EYE.x);
        expect(Math.max(...xs)).toBeGreaterThan(EYE.x);
        const heights = [big.world.whirls.tables[1].x, big.world.whirls.tables[3].x];
        const small = makeWorld();
        small.world.onLock({
            u: 0.2, rows: [19], color: PIECE_COLORS[1], twist: true,
        });
        expect(small.world.counts.whirls).toBe(1);
        expect(small.world.whirls.tables[1].x).toBeLessThan(Math.max(...heights));
        // Hammered, the slots turn over and nothing overflows.
        for (let n = 0; n < WHIRL_SLOTS * 3; n++) {
            small.world.onLock({
                u: (n * 0.37) % 1, rows: [19], color: PIECE_COLORS[1], twist: true,
            });
            stepTo(small.world, small.camera, small.world.time + 0.2);
        }
        expect(small.world.whirls.tables.length).toBe(WHIRL_SLOTS * 2);
    });

    it('burns blue with a back-to-back run, higher with each step, and dies down when the run ends', () => {
        const { world, camera } = makeWorld();
        expect(world.u.blue.value).toBe(0);
        const levels = [];
        for (let n = 1; n <= 4; n++) {
            world.onB2B(n);
            stepTo(world, camera, world.time + 3);
            levels.push(world.u.blue.value);
        }
        for (let n = 1; n < 4; n++) expect(levels[n]).toBeGreaterThan(levels[n - 1] + 0.1);
        expect(levels[3]).toBeGreaterThan(0.9);
        expect(levels[3]).toBeLessThanOrEqual(1.3);
        world.onB2B(0);
        stepTo(world, camera, world.time + 0.5);
        // It dies down, it is not cut.
        expect(world.u.blue.value).toBeGreaterThan(levels[3] * 0.5);
        stepTo(world, camera, world.time + 10);
        expect(world.u.blue.value).toBeLessThan(0.02);
    });

    it('sends a thermal up the column and flows down the cone on four lines', () => {
        const { world, camera } = makeWorld();
        const spawned = [];
        const spawn = world.smoke.spawn.bind(world.smoke);
        vi.spyOn(world.smoke, 'spawn').mockImplementation((p) => {
            spawned.push(p);
            return spawn(p);
        });
        world.onClear({ lines: 4, rows: [19, 18, 17, 16], combo: 1 });
        const climb = [];
        stepTo(world, camera, world.time + 6, 1 / 30, (w) => climb.push([w.u.thermal.value.x, w.u.thermal.value.y]));
        // It swells in, climbs all the while, and fades.
        expect(climb[0][1]).toBeLessThan(0.3);
        expect(Math.max(...climb.map((c) => c[1]))).toBeGreaterThan(0.8);
        expect(climb[climb.length - 1][1]).toBeLessThan(0.35);
        for (let i = 1; i < climb.length; i++) expect(climb[i][0]).toBeGreaterThanOrEqual(climb[i - 1][0]);
        expect(climb[climb.length - 1][0]).toBeGreaterThan(0.4);
        expect(climb[climb.length - 1][0]).toBeLessThan(0.7);
        // The flows: strings of heaps leaving the crater outward on three bearings.
        const flows = spawned.filter((p) => p.kind === PUFF.flow);
        expect(world.counts.flows).toBe(1);
        expect(flows.length).toBeGreaterThanOrEqual(18);
        for (const p of flows) {
            const out = [p.x - VOLCANO.x, p.z - VOLCANO.z];
            expect(p.vx * out[0] + p.vz * out[1]).toBeGreaterThan(0);
            expect(p.vy).toBe(0);
        }
        const bearings = new Set(flows.map((p) => Math.round(Math.atan2(p.vz, p.vx) * 2)));
        expect(bearings.size).toBeGreaterThanOrEqual(2);
        // A second blast while it climbs feeds it instead of starting it over.
        const fresh = makeWorld();
        fresh.world.onClear({ lines: 4, rows: [19, 18, 17, 16], combo: 1 });
        stepTo(fresh.world, fresh.camera, fresh.world.time + 2);
        const at = fresh.world.u.thermal.value.x;
        fresh.world.onClear({ lines: 4, rows: [19, 18, 17, 16], combo: 2 });
        stepTo(fresh.world, fresh.camera, fresh.world.time + 1 / 30);
        expect(fresh.world.u.thermal.value.x).toBeGreaterThanOrEqual(at);
        expect(fresh.world.thermalPower).toBeGreaterThan(1);
    });

    it('rides its flows on the ground: every heap sits on the land under it', () => {
        const { world, camera } = makeWorld();
        world.onClear({ lines: 4, rows: [19, 18, 17, 16], combo: 1 });
        stepTo(world, camera, world.time + 4);
        const { events } = world.smoke;
        let checked = 0;
        for (let i = 0; i < world.smoke.eventCount; i++) {
            const e = i * 12;
            const age = world.time - events[e + 3];
            if (events[e + 10] !== PUFF.flow || age < 0.5 || age > events[e + 7]) continue;
            // Where the frame placed it (drag: v·τ·(1 − e^(−age/τ)), τ = 6.5).
            const k = 6.5 * (1 - Math.exp(-age / 6.5));
            const x = events[e] + events[e + 4] * k;
            const z = events[e + 2] + events[e + 6] * k;
            const radius = events[e + 8] + events[e + 9] * k;
            const drawn = [...world.smoke.puff].findIndex((_, n) => n % 4 === 0
                && Math.abs(world.smoke.puff[n] - x) < 0.5 && Math.abs(world.smoke.puff[n + 2] - z) < 0.5);
            expect(drawn).toBeGreaterThanOrEqual(0);
            expect(world.smoke.puff[drawn + 1]).toBeCloseTo(landHeight(x, z) + radius * 0.45, 0);
            // It has run out from the crater.
            expect(Math.hypot(x - VOLCANO.x, z - VOLCANO.z)).toBeGreaterThan(600);
            checked++;
        }
        expect(checked).toBeGreaterThan(10);
    });

    it('runs a wave of fire down both rivers on a perfect clear and gilds the lava behind it', () => {
        const { world, camera } = makeWorld();
        const sparks = [];
        const spawn = world.bombs.spawn.bind(world.bombs);
        vi.spyOn(world.bombs, 'spawn').mockImplementation((b) => {
            sparks.push({ ...b, at: world.time });
            return spawn(b);
        });
        world.onClear({ lines: 1, perfect: true });
        const gild = [];
        stepTo(world, camera, world.time + 7, 1 / 30, (w) => gild.push([w.u.gild.value.x, w.u.gild.value.y]));
        expect(Math.max(...gild.map((g) => g[1]))).toBeGreaterThan(0.9);
        expect(gild[gild.length - 1][1]).toBe(0);
        for (let i = 1; i < gild.length; i++) expect(gild[i][0]).toBeGreaterThanOrEqual(gild[i - 1][0]);
        // Fountains on both rivers, further down them as the wave runs: later sparks nearer the eye.
        const river = sparks.filter((b) => b.kind === BOMB.spark && Math.abs(b.y - 2 - landHeight(b.x, b.z)) < 60
            && Math.hypot(b.x - VOLCANO.x, b.z - VOLCANO.z) > 2500);
        expect(river.length).toBeGreaterThan(40);
        expect(river.some((b) => b.x < EYE.x - 300)).toBe(true);
        expect(river.some((b) => b.x > EYE.x + 300)).toBe(true);
        const far = river.filter((b) => Math.hypot(b.x - EYE.x, b.z - EYE.z) > 6000);
        const near = river.filter((b) => Math.hypot(b.x - EYE.x, b.z - EYE.z) < 2500);
        expect(far.length).toBeGreaterThan(0);
        expect(near.length).toBeGreaterThan(0);
        const mean = (list) => list.reduce((sum, b) => sum + b.at, 0) / list.length;
        expect(mean(near)).toBeGreaterThan(mean(far));
    });

    it('throws spatter off the near rivers on a hard drop, more the further the piece fell, none on a soft lock', () => {
        const count = (lock) => {
            const { world } = makeWorld();
            const splashes = [];
            const spawn = world.bombs.spawn.bind(world.bombs);
            vi.spyOn(world.bombs, 'spawn').mockImplementation((b) => {
                if (b.kind === BOMB.splash) splashes.push(b);
                return spawn(b);
            });
            world.onLock({
                u: 0.3, rows: [19], color: PIECE_COLORS[0], ...lock,
            });
            return splashes;
        };
        expect(count({}).length).toBe(0);
        const short = count({ hardDrop: true, distance: 3 });
        const long = count({ hardDrop: true, distance: 18 });
        expect(short.length).toBeGreaterThan(0);
        expect(long.length).toBeGreaterThan(short.length * 1.5);
        // On the lava by the eye: both rivers for a long fall.
        for (const b of long) expect(Math.hypot(b.x - EYE.x, b.z - EYE.z)).toBeLessThan(2500);
        expect(long.some((b) => b.x < EYE.x)).toBe(true);
        expect(long.some((b) => b.x > EYE.x)).toBe(true);
    });

    it('jets the fissure\'s curtain on three lines, higher than on one', () => {
        const peak = (lines) => {
            const { world, camera } = makeWorld();
            const rest = world.u.fissure.value;
            world.onClear({ lines, rows: Array.from({ length: lines }, (_, k) => 19 - k), combo: 1 });
            let hi = 0;
            stepTo(world, camera, world.time + 3, 1 / 30, (w) => { hi = Math.max(hi, w.u.fissure.value); });
            return hi - rest;
        };
        const one = peak(1);
        const three = peak(3);
        expect(three).toBeGreaterThan(one + 0.5);
        expect(three).toBeGreaterThan(0.8);
    });

    it('sinks with a last breath at a run\'s end and wakes with a burst at the next one\'s start', () => {
        const { world, camera } = makeWorld();
        const awake = { body: world.u.plume.value.x, flux: world.u.lavaFlux.value, fall: world.u.ashFall.value };
        const puffs = world.smoke.liveEvents(world.time);
        world.onGameOver();
        stepTo(world, camera, world.time + 0.3);
        expect(world.smoke.liveEvents(world.time)).toBeGreaterThan(puffs);
        stepTo(world, camera, world.time + TIMING.sink * 2);
        expect(world.u.plume.value.x).toBeLessThan(awake.body * 0.75);
        expect(world.u.lavaFlux.value).toBeLessThan(awake.flux);
        expect(world.u.ashFall.value).toBeGreaterThan(awake.fall + 0.4);
        // A second game over is no second breath.
        const spawn = vi.spyOn(world.smoke, 'spawn');
        world.onGameOver();
        expect(spawn).not.toHaveBeenCalled();
        world.onSessionStart();
        expect(world.counts.wakes).toBe(1);
        expect(spawn).toHaveBeenCalled();
        stepTo(world, camera, world.time + 0.3);
        expect(world.u.burst.value).toBeGreaterThan(0.1);
        stepTo(world, camera, world.time + TIMING.wake * 3);
        expect(world.u.plume.value.x).toBeCloseTo(awake.body, 2);
        expect(world.u.ashFall.value).toBeCloseTo(awake.fall, 2);
    });
});

describe('Pyrestorm events: what is seen, and where', () => {
    it('keeps its lightning out from behind the board and the HUD', () => {
        const { world, camera } = makeWorld({ phase: PHASES.findIndex((p) => p.name === 'ash storm') });
        const drawn = [];
        const strike = world.strike.bind(world);
        vi.spyOn(world, 'strike').mockImplementation((time, kind, A, B, ...rest) => {
            drawn.push({ kind, behind: world.boltBehindBoard(A, B) });
            return strike(time, kind, A, B, ...rest);
        });
        // A long chain (the storm crawls with spiders) and clears on every row.
        for (let n = 1; n <= 8; n++) {
            world.onCombo(n);
            world.onClear({ lines: 2, rows: [19 - n, 18 - n], combo: n });
            stepTo(world, camera, world.time + 2.5);
        }
        const spiders = drawn.filter((d) => d.kind === BOLT.spider);
        const strokes = drawn.filter((d) => d.kind === BOLT.ground);
        expect(spiders.length).toBeGreaterThan(20);
        expect(strokes.length).toBeGreaterThan(12);
        // Every crawler along the anvil is clear of both; a stroke to the ground nearly always.
        expect(spiders.filter((d) => d.behind === 0).length / spiders.length).toBeGreaterThan(0.95);
        expect(strokes.filter((d) => d.behind === 0).length / strokes.length).toBeGreaterThan(0.9);
        // The measure itself: a bolt across the card's middle is behind it, one off the frame's side is not.
        const through = (x) => {
            const dir = new THREE.Vector3(x * 2 - 1, 0, 0.5).unproject(camera).sub(camera.position).normalize();
            return [camera.position.x + dir.x * 9000, camera.position.y + dir.y * 9000, camera.position.z + dir.z * 9000];
        };
        expect(world.boltBehindBoard(through(0.45), through(0.55))).toBeGreaterThan(2);
        expect(world.boltBehindBoard(through(0.03), through(0.2))).toBe(0);
    });

    it('stands fans of fire along a new vent while it is fresh', () => {
        const { world, camera } = makeWorld();
        const lit = () => world.fans.tables.filter((_, i) => i % 2 === 1).filter((row) => row.x > 0.002).length;
        expect(world.fans.tables.length).toBe(FAN_SLOTS * 2);
        expect(lit()).toBe(0);
        world.levelUp(2);
        stepTo(world, camera, world.time + 1.5);
        expect(lit()).toBe(FANS_PER_VENT);
        const vent = world.getState().vents[0];
        for (let k = 0; k < FANS_PER_VENT; k++) {
            const foot = world.fans.tables[k * 2];
            // On the land, along the vent from its head down, each a fountain of some hundreds of metres.
            expect(Math.abs(foot.y - landHeight(foot.x, foot.z))).toBeLessThan(1e-3);
            const out = Math.hypot(foot.x - VOLCANO.x, foot.z - VOLCANO.z);
            expect(out).toBeGreaterThanOrEqual(vent.head);
            expect(out).toBeLessThan(vent.head + 700);
            expect(foot.w).toBeGreaterThan(200);
            expect(foot.w).toBeLessThan(800);
        }
        // The tallest at the head.
        expect(world.fans.tables[0].w).toBeGreaterThan(world.fans.tables[(FANS_PER_VENT - 1) * 2].w);
        // They die down and go out; the stream burns on.
        stepTo(world, camera, world.time + 14);
        expect(lit()).toBe(0);
        expect(world.getState().vents[0].heat).toBeGreaterThan(0.3);
        // A second vent takes the other slots.
        world.levelUp(3);
        stepTo(world, camera, world.time + 1.5);
        expect(world.fans.tables.slice(FANS_PER_VENT * 2).filter((_, i) => i % 2 === 1).every((row) => row.x > 0.002)).toBe(true);
    });

    it('lets wisps of blue fire rise for as long as a back-to-back run lasts', () => {
        const { world, camera } = makeWorld();
        const wisps = [];
        const spawn = world.bombs.spawn.bind(world.bombs);
        vi.spyOn(world.bombs, 'spawn').mockImplementation((b) => {
            if (b.kind === BOMB.wisp) wisps.push(b);
            return spawn(b);
        });
        stepTo(world, camera, world.time + 3);
        expect(wisps.length).toBe(0);
        world.onB2B(1);
        stepTo(world, camera, world.time + 4);
        const low = wisps.length;
        world.onB2B(4);
        stepTo(world, camera, world.time + 4);
        const high = wisps.length - low;
        expect(low).toBeGreaterThan(4);
        expect(high).toBeGreaterThan(low * 2);
        for (const b of wisps) {
            // Blue, not incandescent; buoyant; from the near rivers, the fissure or the crater's rim.
            expect(b.tint[2]).toBeGreaterThan(b.tint[0] * 5);
            expect(b.g).toBeLessThan(0);
            expect(b.vy).toBeGreaterThan(0);
        }
        expect(wisps.some((b) => Math.hypot(b.x - EYE.x, b.z - EYE.z) < 2900)).toBe(true);
        expect(wisps.some((b) => Math.hypot(b.x - VOLCANO.x, b.z - VOLCANO.z) < VOLCANO.crater * 1.2)).toBe(true);
        // The run ends: they stop coming once the fire has died down.
        world.onB2B(0);
        stepTo(world, camera, world.time + 12);
        const after = wisps.length;
        stepTo(world, camera, world.time + 4);
        expect(wisps.length).toBe(after);
    });

    it('lights the whole land in the storm\'s light on a perfect clear: a swell, never a strobe, held back by Reduce flashing', () => {
        const run = (reduce) => {
            vi.stubGlobal('window', { settings: { reduceFlashing: reduce } });
            const { world, camera } = makeWorld();
            expect(world.u.stormLight.value.length()).toBe(0);
            world.onClear({ lines: 1, perfect: true });
            const light = [];
            stepTo(world, camera, world.time + 9, 1 / 60, (w) => light.push(w.u.stormLight.value.length()));
            return { light, bolt: Math.hypot(...world.light.bolt) };
        };
        const full = run(false);
        const peak = Math.max(...full.light);
        expect(peak).toBeGreaterThan(full.bolt * 0.5);
        expect(full.light[full.light.length - 1]).toBeLessThan(peak * 0.02);
        // One rise to one peak and one fall: it never brightens again once it has begun to sink.
        const top = full.light.indexOf(peak);
        expect(top / 60).toBeGreaterThan(0.15);
        for (let i = top + 1; i < full.light.length; i++) expect(full.light[i]).toBeLessThanOrEqual(full.light[i - 1] + 1e-9);
        for (let i = 1; i < full.light.length; i++) expect(Math.abs(full.light[i] - full.light[i - 1])).toBeLessThan(peak * 0.12);
        const held = run(true);
        expect(Math.max(...held.light)).toBeCloseTo(peak * REDUCED_FLASH_SCALE, 6);
    });

    it('keeps the order of things: a soft lock throws fewer bombs than a hard drop, a hard drop fewer than the blast', () => {
        const thrown = (act) => {
            const { world } = makeWorld();
            let bombs = 0;
            const spawn = world.bombs.spawn.bind(world.bombs);
            vi.spyOn(world.bombs, 'spawn').mockImplementation((b) => {
                if (b.kind === BOMB.bomb) bombs++;
                return spawn(b);
            });
            act(world);
            return bombs;
        };
        const soft = thrown((w) => w.onLock({ u: 0.4, rows: [19], color: PIECE_COLORS[0] }));
        const hard = thrown((w) => w.onLock({
            u: 0.4, rows: [19], color: PIECE_COLORS[0], hardDrop: true, distance: 18,
        }));
        const blast = thrown((w) => w.onClear({ lines: 4, rows: [19, 18, 17, 16], combo: 1 }));
        expect(hard).toBeGreaterThan(soft);
        expect(blast).toBeGreaterThan(hard * 1.2);
    });
});

// ── The snags ────────────────────────────────────────────────────────────────────

describe('Pyrestorm snags', () => {
    it('are six designs out of Blender, each a closed, outward-wound mesh standing on the origin', () => {
        expect(PYRESTORM_SNAG_MODELS.designs.length).toBe(6);
        const decode = (text, Type) => new Type(Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0)).buffer);
        for (const model of PYRESTORM_SNAG_MODELS.models) {
            const p = decode(model.positions, Int16Array);
            const n = decode(model.normals, Int8Array);
            const tip = decode(model.tip, Uint8Array);
            const index = decode(model.index, Uint16Array);
            expect(p.length, model.design).toBe(model.vertexCount * 3);
            expect(n.length).toBe(model.vertexCount * 3);
            expect(tip.length).toBe(model.vertexCount);
            expect(index.length).toBe(model.triangleCount * 3);
            expect(Math.max(...index)).toBeLessThan(model.vertexCount);
            const q = PYRESTORM_SNAG_MODELS.quant;
            let top = -Infinity;
            let bottom = Infinity;
            for (let i = 0; i < model.vertexCount; i++) {
                top = Math.max(top, p[i * 3 + 1] * q);
                bottom = Math.min(bottom, p[i * 3 + 1] * q);
                expect(Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]) / 127).toBeGreaterThan(0.9);
            }
            expect(top).toBeCloseTo(model.height, 2);
            expect(top).toBeGreaterThan(3);
            expect(top).toBeLessThan(17);
            // Its foot is in the ground, never above it.
            expect(bottom).toBeLessThan(-0.3);
            // Wound outward: a face's own normal agrees with its vertices' (nearly every face: a
            // decimated limb a few centimetres thick folds a triangle here and there).
            let outward = 0;
            for (let t = 0; t < index.length; t += 3) {
                const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
                const A = new THREE.Vector3(p[a * 3], p[a * 3 + 1], p[a * 3 + 2]);
                const B = new THREE.Vector3(p[b * 3], p[b * 3 + 1], p[b * 3 + 2]);
                const C = new THREE.Vector3(p[c * 3], p[c * 3 + 1], p[c * 3 + 2]);
                const face = B.sub(A).cross(C.sub(A));
                const mean = new THREE.Vector3(n[a * 3] + n[b * 3] + n[c * 3], n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1], n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2]);
                if (face.dot(mean) > 0) outward++;
            }
            expect(outward / model.triangleCount, model.design).toBeGreaterThan(0.94);
            // Only its broken ends smoulder.
            expect(Math.max(...tip)).toBeGreaterThan(240);
            expect(tip.filter((v) => v === 0).length / tip.length).toBeGreaterThan(0.3);
        }
    });

    it('are one mesh rooted on the land, every design standing somewhere', () => {
        const geometry = snagGeometry();
        const position = geometry.getAttribute('position');
        const normal = geometry.getAttribute('normal');
        const look = geometry.getAttribute('aSnag');
        expect(position.count).toBe(normal.count);
        expect(look.count).toBe(position.count);
        expect(geometry.getIndex().count % 3).toBe(0);
        for (let i = 0; i < position.count; i++) {
            expect(Number.isFinite(position.getX(i) + position.getY(i) + position.getZ(i))).toBe(true);
            expect(look.getX(i)).toBeGreaterThanOrEqual(0);
            expect(look.getX(i)).toBeLessThanOrEqual(1);
        }
        expect(new Set(SNAG_PLACES.map((place) => place[2]))).toEqual(new Set(PYRESTORM_SNAG_MODELS.designs));
        for (const place of SNAG_PLACES) {
            const root = snagRoot(place);
            expect(Math.abs(root[1] + 0.15 - landHeight(root[0], root[2]))).toBeLessThan(1e-9);
            // On the eye's own slope, ahead of it and below it.
            expect(root[2]).toBeLessThan(EYE.z);
            expect(root[1]).toBeLessThan(EYE.y);
            expect(Math.hypot(root[0] - EYE.x, root[2] - EYE.z)).toBeLessThan(400);
        }
        geometry.dispose();
    });

    it.each([[1920, 1080], [2560, 1080], [1600, 900]])('stand clear of the card and the HUD at %i × %i', (width, height) => {
        const { world, camera } = makeWorld({ width, height });
        world.restCamera(camera);
        const layout = fallbackLayout(width, height);
        const heights = Object.fromEntries(PYRESTORM_SNAG_MODELS.models.map((m) => [m.design, m.height]));
        for (const place of SNAG_PLACES) {
            const root = snagRoot(place);
            const top = [root[0], root[1] + heights[place[2]] * place[3], root[2]];
            for (const point of [root, top]) {
                const v = new THREE.Vector3(point[0], point[1], point[2]).project(camera);
                const screen = { x: v.x * 0.5 + 0.5, y: 0.5 - v.y * 0.5 };
                // Off the frame's side is clear too; on it, outside the card and the HUD.
                if (screen.x < 0 || screen.x > 1) continue;
                expect(outsideKeepOut(layout, screen, 0.004), `${place[2]} at ${place[0]}°`).toBe(true);
            }
        }
    });

    it('are a part of the world like any other', () => {
        const { world } = makeWorld();
        expect(PYRESTORM_PARTS).toContain('snags');
        expect(PYRESTORM_PARTS).toContain('whirls');
        expect(PYRESTORM_PARTS).toContain('fans');
        expect(world.parts.snags.mesh.geometry.getIndex().count).toBeGreaterThan(1000);
        world.showOnlyParts(['land']);
        expect(world.parts.snags.mesh.visible).toBe(false);
        expect(world.parts.whirls.mesh.visible).toBe(false);
        world.showOnlyParts(PYRESTORM_PARTS);
        expect(world.parts.snags.mesh.visible).toBe(true);
    });
});
