/**
 * Tornado — the storm's own life and the events that play on it (docs/TORNADO_VISUAL_OVERHAUL_2026-10.md,
 * "The living storm"): the funnel's kinds by the clock, the weather round it, the funnel that lets
 * go of the ground and comes down again, the twin of a twist, the straw at the card's feet, the
 * crawlers under the deck. Run without a renderer, as tests/unit/tornado-world.test.js does.
 *
 * Nothing here pins a gain, a width or a colour: the look is still being tuned.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    REST_RIG, TORNADO_PARTS, TornadoWorld, fovForAspect,
} from '../../src/themes/tornado/tornado-world.js';
import {
    PALETTES, STAGES, STAGE_REST, STAGE_SECONDS, WORLD, crawlerPath, funnelRadius, mulberry32, stageAt, weatherAt,
} from '../../src/themes/tornado/tornado-core.js';
import {
    AIR_BOX, BURSTS, DRIFT_WRAP, RAIN_BOX,
} from '../../src/themes/tornado/tornado-tsl.js';
import { QUALITY } from '../../src/themes/tornado/tornado-quality.js';
import { PUFF_POWER } from '../../src/themes/tornado/tornado-air.js';
import { cardUnion, fallbackLayout } from '../../src/themes/tornado/tornado-composition.js';

vi.setConfig({ testTimeout: 60_000 }); // every test builds a storm, on a machine that may be busy

// Every world bakes the same noise: bake it once for the whole file.
vi.mock('../../src/themes/tornado/tornado-tsl.js', async (importOriginal) => {
    const actual = await importOriginal();
    let baked = null;
    return {
        ...actual,
        bakeNoise: (...args) => {
            if (!baked) baked = actual.bakeNoise(...args);
            return baked;
        },
    };
});

const START = 10;
const worlds = [];

function step(world, camera, from, to, dt = 1 / 30) {
    const steps = Math.max(1, Math.round((to - from) / dt));
    const h = (to - from) / steps;
    for (let i = 1; i <= steps; i += 1) {
        const sim = {
            time: from + i * h, delta: h, pointerX: 0, pointerY: 0,
        };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    }
}

function makeWorld(quality = 'Low', { width = 1600, height = 900, at = START } = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new TornadoWorld({ scene, quality, capture: true }).build();
    worlds.push(world);
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    world.setLayout(fallbackLayout(width, height), aspect);
    world.seek(at);
    step(world, camera, at, at + 0.1);
    return { scene, camera, world };
}

const burstsSince = (world, since) => {
    const rows = world.u.tables.bursts;
    const found = [];
    for (let i = 0; i < BURSTS; i += 1) {
        if (rows[i * 2].w >= since) found.push({ power: rows[i * 2 + 1].w, x: rows[i * 2].x, z: rows[i * 2].z });
    }
    return found;
};

afterEach(() => {
    worlds.splice(0).forEach((w) => w.dispose());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('tornado: the funnel\'s kinds and the weather (numbers)', () => {
    it('opens on the cone as authored, rests on each kind and turns into the next', () => {
        expect(STAGES[0]).toMatchObject({
            girth: 1, taper: 1, flare: 1, rope: 1, touch: 1,
        });
        const first = stageAt(STAGE_SECONDS * STAGE_REST * 0.5);
        expect(first).toMatchObject({
            index: 0, turn: 0, name: STAGES[0].name, girth: 1, taper: 1, touch: 1,
        });
        // Half-way through the turn it is half-way between the two kinds.
        const mid = stageAt(STAGE_SECONDS * (STAGE_REST + (1 - STAGE_REST) / 2));
        expect(mid.turn).toBeCloseTo(0.5, 6);
        expect(mid.girth).toBeCloseTo((STAGES[0].girth + STAGES[1].girth) / 2, 6);
        // Every kind has its rest, in order, and the wheel wraps.
        STAGES.forEach((stage, i) => {
            expect(stageAt(STAGE_SECONDS * (i + STAGE_REST * 0.5)).name).toBe(stage.name);
        });
        expect(stageAt(STAGE_SECONDS * (STAGES.length + 0.1)).index).toBe(0);
        expect(new Set(STAGES.map((stage) => stage.name)).size).toBe(STAGES.length);
    });

    it('has one kind that hangs off the ground, and it is followed by the cone coming down', () => {
        const aloft = STAGES.filter((stage) => stage.touch < 0.9);
        expect(aloft).toHaveLength(1);
        expect(STAGES.indexOf(aloft[0])).toBe(STAGES.length - 1);
        STAGES.forEach((stage) => {
            expect(stage.touch).toBeGreaterThan(0.2);
            expect(stage.touch).toBeLessThanOrEqual(1);
            expect(stage.girth).toBeGreaterThan(0.3);
        });
    });

    it('makes a stovepipe, a cone and a wedge out of the one profile', () => {
        const aloftRatio = (stage) => funnelRadius(0.6, stage.girth, stage.flare, stage.taper)
            / funnelRadius(0.05, stage.girth, stage.flare, stage.taper);
        const byName = Object.fromEntries(STAGES.map((stage) => [stage.name, stage]));
        expect(aloftRatio(byName.stovepipe)).toBeLessThan(aloftRatio(byName.cone));
        // The wedge is the widest thing the storm puts down; the rope the thinnest.
        const foot = (stage) => funnelRadius(0.1, stage.girth, stage.flare, stage.taper);
        STAGES.forEach((stage) => {
            expect(foot(byName.wedge)).toBeGreaterThanOrEqual(foot(stage));
            expect(foot(byName.rope)).toBeLessThanOrEqual(foot(stage));
        });
        // The default taper is the profile the theme shipped with.
        expect(funnelRadius(0.5, 1, 1)).toBe(funnelRadius(0.5, 1, 1, 1));
    });

    it('keeps the weather inside its bounds for an hour, and brings a squall every few minutes', () => {
        let squalls = 0;
        let wet = false;
        let driest = 1;
        for (let t = 0; t < 3600; t += 0.5) {
            const w = weatherAt(t);
            [w.rainAt, w.rain, w.edge, w.mammatus, w.squall].forEach((v) => expect(Number.isFinite(v)).toBe(true));
            expect(Math.abs(w.rainAt)).toBeLessThan(0.5);
            expect(w.rain).toBeGreaterThan(0.4);
            expect(w.edge).toBeGreaterThan(0.85);
            expect(w.edge).toBeLessThan(1.15);
            expect(w.mammatus).toBeGreaterThanOrEqual(0);
            expect(w.mammatus).toBeLessThanOrEqual(1);
            expect(w.squall).toBeGreaterThanOrEqual(0);
            expect(w.squall).toBeLessThanOrEqual(1);
            if (w.squall > 0.5 && !wet) squalls += 1;
            wet = w.squall > 0.5;
            driest = Math.min(driest, w.squall);
        }
        expect(squalls).toBeGreaterThan(10);
        expect(driest).toBe(0);
        // A session does not open in the rain.
        for (let t = 0; t < 60; t += 1) expect(weatherAt(t).squall).toBe(0);
    });

    it('shares no period between the hours, the kinds and the squalls', () => {
        // The three clocks line up the same way again only after a long session.
        const hour = 100;
        const round = (STAGES.length * STAGE_SECONDS);
        expect(round % hour).not.toBe(0);
        expect((PALETTES.length * hour) % round).not.toBe(0);
        expect(167 % STAGE_SECONDS).not.toBe(0);
        expect(PALETTES.length).toBeGreaterThanOrEqual(6);
        expect(new Set(PALETTES.map((p) => p.name)).size).toBe(PALETTES.length);
    });

    it('runs a crawler along under the base: the same path for the same seed', () => {
        const count = 30;
        const from = [10, WORLD.cloudBase * 0.985, -600];
        const a = crawlerPath(mulberry32(7), from, 0.4, 800, 0.55, count, new Float32Array(count * 3));
        const b = crawlerPath(mulberry32(7), from, 0.4, 800, 0.55, count, new Float32Array(count * 3));
        expect(Array.from(a)).toEqual(Array.from(b));
        expect(a[0]).toBe(from[0]);
        expect(a[2]).toBe(from[2]);
        let run = 0;
        for (let i = 0; i < count; i += 1) {
            // Under the deck all the way: it sags a little, it never comes down.
            expect(a[i * 3 + 1]).toBeLessThan(WORLD.cloudBase);
            expect(a[i * 3 + 1]).toBeGreaterThan(WORLD.cloudBase * 0.9);
            if (i > 0) run += Math.hypot(a[i * 3] - a[i * 3 - 3], a[i * 3 + 2] - a[i * 3 - 1]);
        }
        expect(run).toBeCloseTo(800, 3);
    });

    it('gives every tier the air: chaff, straw and rain, more of each as the tier rises', () => {
        const names = Object.keys(QUALITY);
        names.forEach((name, i) => {
            const tier = QUALITY[name];
            ['chaff', 'burst', 'rain'].forEach((key) => {
                expect(tier[key], `${name}.${key}`).toBeGreaterThan(0);
                if (i > 0) expect(tier[key]).toBeGreaterThanOrEqual(QUALITY[names[i - 1]][key]);
            });
        });
        // The drift wraps at a whole number of both boxes, so the chaff and the rain never jump.
        expect((DRIFT_WRAP * AIR_BOX.wide) % RAIN_BOX.wide).toBe(0);
        expect((DRIFT_WRAP * AIR_BOX.deep) % RAIN_BOX.deep).toBe(0);
        expect(TORNADO_PARTS).toContain('air');
    });
});

describe('tornado: the storm\'s own life (world)', () => {
    it('opens a session on the scene as composed: the cone, on the ground, where it was stood', () => {
        const { world } = makeWorld();
        const state = world.getState();
        expect(state.kind).toBe('cone');
        expect(state.touch).toBe(1);
        expect(world.u.taper.value).toBe(1);
        expect(world.u.contact.value).toBe(1);
        expect(world.u.squall.value).toBe(0);
        expect(world.u.open.value).toBe(0);
        const axis = world.u.axis.value;
        expect(Math.hypot(axis.x, axis.z)).toBeCloseTo(WORLD.distance, 6);
        expect(world.funnelScreenX).toBe(world.funnelHomeX);
    });

    it('turns the funnel through its kinds by the clock alone, and lets it go and brings it down', () => {
        const seen = [];
        STAGES.forEach((stage, i) => {
            const at = STAGE_SECONDS * (i + STAGE_REST * 0.5);
            const { world } = makeWorld('Low', { at });
            const state = world.getState();
            seen.push(state.kind);
            expect(state.kind).toBe(stage.name);
            expect(world.u.taper.value).toBeCloseTo(stage.taper, 5);
            expect(world.u.touch.value).toBeCloseTo(stage.touch, 5);
            // Only a funnel on the ground stands in its dust.
            expect(world.u.contact.value).toBe(stage.touch >= 1 ? 1 : 0);
        });
        expect(new Set(seen).size).toBe(STAGES.length);

        // Aloft, then down again with the next cone: a touchdown, with its ring through the wheat.
        const aloftAt = STAGE_SECONDS * (STAGES.length - 1 + STAGE_REST * 0.5);
        const { world, camera } = makeWorld('Low', { at: aloftAt });
        const touchdown = vi.spyOn(world, 'touchdown');
        step(world, camera, world.time, STAGE_SECONDS * STAGES.length + 2, 0.1);
        expect(touchdown).toHaveBeenCalledTimes(1);
        expect(world.getState().touch).toBe(1);
    });

    it('plants a funnel that hangs in the air as soon as a chain winds the storm up', () => {
        const aloftAt = STAGE_SECONDS * (STAGES.length - 1 + STAGE_REST * 0.5);
        const { world, camera } = makeWorld('Low', { at: aloftAt });
        expect(world.getState().touch).toBeLessThan(0.6);
        world.onCombo(6);
        step(world, camera, world.time, world.time + 4, 0.05);
        expect(world.getState().touch).toBeGreaterThan(0.97);
    });

    it('roams within the room beside the card, and holds still under a hold', () => {
        const { world, camera } = makeWorld('Low', { at: 200 });
        const card = cardUnion(fallbackLayout(1600, 900));
        let nearest = Infinity;
        let furthest = 0;
        for (let t = 200; t < 900; t += 7) {
            world.seek(t);
            step(world, camera, t, t + 0.1);
            expect(world.funnelScreenX).toBeGreaterThan(0.06);
            expect(world.funnelScreenX).toBeLessThan(card.x0 - 0.03);
            const out = Math.hypot(world.u.axis.value.x, world.u.axis.value.z);
            nearest = Math.min(nearest, out);
            furthest = Math.max(furthest, out);
        }
        // It really travels: nearer and further off by a fair share of its range.
        expect(furthest - nearest).toBeGreaterThan(WORLD.distance * 0.2);
        expect(nearest).toBeGreaterThan(WORLD.distance * 0.6);
        world.holds.roam = 0;
        world.seek(500);
        step(world, camera, 500, 500.1);
        expect(Math.hypot(world.u.axis.value.x, world.u.axis.value.z)).toBeCloseTo(WORLD.distance, 6);
    });

    it('keeps the air\'s drift and the rain\'s fall inside their wrap, however long the storm blows', () => {
        const { world, camera } = makeWorld();
        world.onCombo(9);
        let last = world.time;
        for (let i = 0; i < 400; i += 1) {
            step(world, camera, last, last + 0.5, 0.05);
            last += 0.5;
            const drift = world.u.airDrift.value;
            expect(drift.x).toBeGreaterThanOrEqual(0);
            expect(drift.x).toBeLessThan(DRIFT_WRAP * AIR_BOX.wide);
            expect(drift.y).toBeGreaterThanOrEqual(0);
            expect(drift.y).toBeLessThan(DRIFT_WRAP * AIR_BOX.tall);
            expect(drift.z).toBeGreaterThanOrEqual(0);
            expect(drift.z).toBeLessThan(DRIFT_WRAP * AIR_BOX.deep);
            expect(world.u.rainFall.value).toBeLessThan(DRIFT_WRAP * RAIN_BOX.tall);
        }
        // The storm wound up: more of the chaff flies.
        expect(world.u.air.value.x).toBeGreaterThan(0.5);
    });

    it('draws the rain only while a squall is over the lens', () => {
        const { world, camera } = makeWorld();
        expect(world.air.rain.visible).toBe(false);
        world.holds.squall = 1;
        step(world, camera, world.time, world.time + 0.1);
        expect(world.air.rain.visible).toBe(true);
        expect(world.u.squall.value).toBeGreaterThan(0.9);
        world.holds.squall = 0;
        step(world, camera, world.time, world.time + 0.1);
        expect(world.air.rain.visible).toBe(false);
    });
});

describe('tornado: the events on the living storm (world)', () => {
    it('throws straw from the card\'s foot on the piece\'s side for a lock, from both feet for a hard drop', () => {
        const { world, camera } = makeWorld();
        const t0 = world.time;
        world.onLock({ rows: [18], u: 0.2, color: '#38f08c' });
        let thrown = burstsSince(world, t0);
        expect(thrown).toHaveLength(1);
        expect(thrown[0].power).toBeLessThan(0); // the left foot throws to the left
        step(world, camera, world.time, world.time + 0.5);
        const t1 = world.time;
        world.onLock({
            rows: [18], u: 0.2, hardDrop: true, color: '#38f08c',
        });
        thrown = burstsSince(world, t1);
        expect(thrown).toHaveLength(2);
        expect(Math.sign(thrown[0].power)).toBe(-Math.sign(thrown[1].power));
        expect(Math.abs(thrown[0].power)).toBeGreaterThan(1);
        // Out in front of the lens, either side of it: never under it, never far off.
        thrown.forEach((b) => {
            const out = Math.hypot(b.x, b.z);
            expect(out).toBeGreaterThan(2);
            expect(out).toBeLessThan(41);
            expect(b.z).toBeLessThan(0);
        });
        expect(thrown[0].x * thrown[1].x).toBeLessThan(0);
        // The gust at the lens: more chaff in the air for a moment.
        const calm = world.u.air.value.x;
        step(world, camera, world.time, world.time + 0.3);
        expect(world.u.air.value.x).toBeGreaterThan(calm);
    });

    it('throws less and less under a quick hand, and dust only for a slam after a pause', () => {
        const { world, camera } = makeWorld();
        const drop = () => {
            const at = world.time;
            world.onLock({
                rows: [18], u: 0.5, hardDrop: true, color: '#3aa0ff',
            });
            return Math.abs(burstsSince(world, at)[0].power);
        };
        const first = drop();
        expect(first).toBeGreaterThanOrEqual(PUFF_POWER);
        const powers = [];
        for (let i = 0; i < 6; i += 1) {
            step(world, camera, world.time, world.time + 0.5);
            powers.push(drop());
        }
        // Every one of the quick drops throws less than the slam, below the power that raises dust.
        powers.forEach((p) => {
            expect(p).toBeLessThan(PUFF_POWER);
            expect(p).toBeGreaterThan(0.25);
        });
        // The hands rest: the next one slams again.
        step(world, camera, world.time, world.time + 3);
        expect(drop()).toBe(first);
    });

    it('never holds more bursts than its table', () => {
        const { world, camera } = makeWorld();
        for (let i = 0; i < 12; i += 1) {
            world.onLock({
                rows: [18], u: (i % 5) / 5, hardDrop: i % 2 === 0, color: '#ff4d6d',
            });
            step(world, camera, world.time, world.time + 0.08);
        }
        expect(world.u.tables.bursts).toHaveLength(BURSTS * 2);
        expect(world.cursor.burst).toBe(18);
    });

    it('runs a crawler through the deck for three lines, a fan of them for four, and none for fewer', () => {
        const count = (lines, reduce = false) => {
            if (reduce) vi.stubGlobal('window', { settings: { reduceFlashing: true }, innerWidth: 1600, innerHeight: 900 });
            const { world, camera } = makeWorld();
            const crawl = vi.spyOn(world.fx, 'crawl');
            world.onClear({ lines, combo: 1 });
            step(world, camera, world.time, world.time + 1.2);
            vi.unstubAllGlobals();
            return crawl.mock.calls.length;
        };
        expect(count(1)).toBe(0);
        expect(count(2)).toBe(0);
        expect(count(3)).toBe(1);
        expect(count(4)).toBe(4);
        // Fewer flashes under Reduce flashing.
        expect(count(4, true)).toBe(2);
    });

    it('sends a ring of light out through the deck on four lines, and it runs out and dies', () => {
        const { world, camera } = makeWorld();
        world.onClear({ lines: 3, combo: 1 });
        step(world, camera, world.time, world.time + 0.5);
        expect(world.u.pulse.value.y).toBe(0);
        world.onClear({ lines: 4, combo: 2 });
        step(world, camera, world.time, world.time + 0.5);
        const early = world.u.pulse.value.clone();
        expect(early.y).toBeGreaterThan(0.1);
        step(world, camera, world.time, world.time + 1);
        expect(world.u.pulse.value.x).toBeGreaterThan(early.x + 300);
        expect(world.u.pulse.value.y).toBeLessThan(early.y);
        step(world, camera, world.time, world.time + 3);
        expect(world.u.pulse.value.y).toBe(0);
    });

    it('calls a twin down for a twist, out in open sky, and draws it back up', () => {
        const { world, camera } = makeWorld();
        expect(world.funnel.twin.visible).toBe(false);
        world.onClear({ lines: 2, combo: 1, twist: true });
        step(world, camera, world.time, world.time + 1.2);
        expect(world.funnel.twin.visible).toBe(true);
        expect(world.getState().twin).toBeGreaterThan(0.95);
        // Clear of the card, the HUD and the funnel, and never on the sun.
        const layout = fallbackLayout(1600, 900);
        const card = cardUnion(layout);
        const twin = world.u.twin.value;
        const az = Math.atan2(twin.x, -twin.y);
        const tan = Math.tan((world.fov() * Math.PI) / 360) * world.aspect;
        const sx = (Math.tan(az) / tan + 1) / 2;
        expect(world.openSky(sx, card, layout.hud)).toBe(true);
        expect(Math.abs(sx - WORLD.sunScreenX)).toBeGreaterThan(0.05);
        // A second twist while it is down holds it and fattens it: never a second rope.
        const at = { x: twin.x, z: twin.y, girth: twin.w };
        world.onTwist();
        step(world, camera, world.time, world.time + 0.2);
        expect(world.u.twin.value.x).toBe(at.x);
        expect(world.u.twin.value.w).toBeGreaterThan(at.girth);
        step(world, camera, world.time, world.time + 9);
        expect(world.getState().twin).toBe(0);
        expect(world.funnel.twin.visible).toBe(false);
    });

    it('breaks the storm on a perfect clear: the funnel lifts, the deck parts, then a new funnel touches down', () => {
        const { world, camera } = makeWorld();
        for (let i = 0; i < 4; i += 1) {
            world.onLock({ rows: [19], u: 0.5, color: '#ffc21a' });
            step(world, camera, world.time, world.time + 0.4);
        }
        step(world, camera, world.time, world.time + 2);
        const touchdown = vi.spyOn(world, 'touchdown');
        const wind = () => world.u.wind.value;
        world.onClear({ lines: 2, combo: 1, perfect: true });
        step(world, camera, world.time, world.time + 2.4);
        // Off the ground, out of its dust, the deck parted; and no dust front (this is the calm).
        expect(world.getState().touch).toBeLessThan(0.3);
        expect(world.u.contact.value).toBe(0);
        expect(world.getState().open).toBeGreaterThan(0.9);
        expect(world.u.shock.value.y).toBe(0);
        expect(world.funnel.children.every((c) => !c.visible)).toBe(true);
        // The wind has dropped: its clock runs slower than at rest.
        const w0 = wind();
        step(world, camera, world.time, world.time + 1);
        expect(wind() - w0).toBeLessThan(0.6);
        expect(touchdown).not.toHaveBeenCalled();
        // Then the storm comes back: the funnel down again, the deck closed over.
        step(world, camera, world.time, world.time + 12, 0.05);
        expect(touchdown).toHaveBeenCalledTimes(1);
        expect(world.getState().touch).toBe(1);
        expect(world.getState().open).toBe(0);
    });

    it('winds the hour on for a new level: the deck races and a band of sun runs in to the lens', () => {
        const rest = makeWorld();
        const lapsed = makeWorld();
        lapsed.world.levelUp(2);
        const deck = [rest.world.u.deck.value, lapsed.world.u.deck.value];
        expect(deck[0]).toBe(deck[1]);
        step(rest.world, rest.camera, rest.world.time, rest.world.time + 1.5);
        step(lapsed.world, lapsed.camera, lapsed.world.time, lapsed.world.time + 1.5);
        // Faster, never a jump: the same clock, run on further.
        expect(lapsed.world.u.deck.value - deck[1]).toBeGreaterThan((rest.world.u.deck.value - deck[0]) * 2);
        const far = lapsed.world.u.sweep.value.x;
        expect(lapsed.world.u.sweep.value.y).toBeGreaterThan(0.5);
        expect(rest.world.u.sweep.value.y).toBe(0);
        step(lapsed.world, lapsed.camera, lapsed.world.time, lapsed.world.time + 1.5);
        expect(lapsed.world.u.sweep.value.x).toBeLessThan(far * 0.2);
        step(lapsed.world, lapsed.camera, lapsed.world.time, lapsed.world.time + 4);
        expect(lapsed.world.u.sweep.value.y).toBe(0);
    });

    it('runs light up the funnel on a back-to-back', () => {
        const { world, camera } = makeWorld();
        world.onClear({ lines: 4, combo: 1 });
        step(world, camera, world.time, world.time + 1);
        expect(world.u.surge.value.y).toBe(0);
        world.onClear({ lines: 4, combo: 2, b2b: true });
        step(world, camera, world.time, world.time + 0.4);
        const low = world.u.surge.value.x;
        expect(world.u.surge.value.y).toBeGreaterThan(0.3);
        step(world, camera, world.time, world.time + 0.6);
        expect(world.u.surge.value.x).toBeGreaterThan(low);
        step(world, camera, world.time, world.time + 2);
        expect(world.u.surge.value.y).toBe(0);
    });

    it('draws the funnel up when a run ends and brings it down when the next begins', () => {
        const { world, camera } = makeWorld();
        const touchdown = vi.spyOn(world, 'touchdown');
        world.onCombo(4);
        step(world, camera, world.time, world.time + 2);
        world.endRun();
        step(world, camera, world.time, world.time + 6, 0.05);
        expect(world.getState().over).toBe(true);
        expect(world.getState().touch).toBeLessThan(0.2);
        expect(world.level).toBe(1);
        // It waits: still up a long while later.
        step(world, camera, world.time, world.time + 30, 0.1);
        expect(world.getState().touch).toBeLessThan(0.2);
        expect(touchdown).not.toHaveBeenCalled();
        // The first piece of the next run brings it down.
        world.onLock({ rows: [19], u: 0.5, color: '#ffc21a' });
        expect(world.getState().over).toBe(false);
        step(world, camera, world.time, world.time + 5, 0.05);
        expect(world.getState().touch).toBe(1);
        expect(touchdown).toHaveBeenCalledTimes(1);
    });
});
