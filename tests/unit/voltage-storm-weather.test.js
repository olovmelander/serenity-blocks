/**
 * Voltage Storm — the storm's own weather: the tiered vault of its underside, the turn it takes
 * by its own clock (lull, gathering, break, easing), the slow light a bolt throws on it, and how
 * the world reads all three (the weather at rest, pinned for a capture, the eye a perfect clear
 * opens in the vault).
 *
 * Nothing here pins a height, a length of an act or a gain: every expectation is a relation, or
 * is measured against the exported constants.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    EYE_CLOSES, EYE_OPENS, EYE_STANDS, REST_RIG, VoltageStormWorld, fovForAspect,
} from '../../src/themes/voltage-storm/voltage-storm-world.js';
import {
    GLOW_FALL, GLOW_RESTRIKE, GLOW_RISE, STORM, STORM_CYCLE, lerp, squall, stormWeather, strokeGlow, strokeLife,
    strokeLight, strokePlan, vaultBase,
} from '../../src/themes/voltage-storm/voltage-storm-core.js';
import { fallbackLayout } from '../../src/themes/voltage-storm/voltage-storm-composition.js';

vi.setConfig({ testTimeout: 30_000 });

// Every world bakes the same two noise fields: bake each once for the whole file.
vi.mock('../../src/themes/voltage-storm/voltage-storm-tsl.js', async (importOriginal) => {
    const actual = await importOriginal();
    const baked = new Map();
    const once = (name) => (...args) => {
        const key = `${name}(${args.join()})`;
        if (!baked.has(key)) baked.set(key, actual[name](...args));
        return baked.get(key);
    };
    return { ...actual, bakeNoise: once('bakeNoise'), bakeCloudNoise: once('bakeCloudNoise') };
});

afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise((resolve) => { setImmediate(resolve); });
});

/** The lowest tier's base: where the vault's underside hangs at the cell's edge. */
const LOWEST = STORM.cloudBase - STORM.cloudSag;
/** Beyond this distance from the vault's centre every point is under the lowest tier, wobble and all. */
const OUTSIDE = STORM.tiers * STORM.tierRadius + STORM.tierWobble * 1.5 + 1;

/** Points over the plain, from the lens out past the cell's edge. */
function plain() {
    const out = [];
    for (let x = -3000; x <= 3000; x += 125) for (let z = -3200; z <= 400; z += 125) out.push([x, z]);
    return out;
}

/** `count` + 1 moments spread over [from, to]. */
function moments(from, to, count) {
    return Array.from({ length: count + 1 }, (_, i) => from + ((to - from) * i) / count);
}

function makeWorld(quality = 'High', { width = 1600, height = 900 } = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new VoltageStormWorld({ scene, quality, capture: true }).build();
    vi.spyOn(world, 'ambient').mockImplementation(() => {});
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    world.setLayout(fallbackLayout(width, height), aspect);
    return { world, camera };
}

/** Draw the moment `time` with the simulation frozen (the capture's recipe). */
function settle(world, camera, time) {
    world.seek(time);
    world.updateCamera(camera, { time, delta: 0 });
    world.update({ time, delta: 0 }, camera);
}

function run(world, camera, seconds, steps = Math.max(1, Math.round(seconds * 60))) {
    const t0 = world.time;
    for (let i = 1; i <= steps; i++) {
        const sim = { time: i === steps ? t0 + seconds : t0 + (seconds * i) / steps, delta: seconds / steps };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    }
}

describe('voltage storm weather: the vault', () => {
    it('hangs between its lowest tier and its highest, everywhere over the plain', () => {
        const top = LOWEST + STORM.tierHeight * STORM.tiers;
        for (const [x, z] of plain()) {
            const h = vaultBase(x, z);
            expect(Number.isFinite(h)).toBe(true);
            expect(h).toBeGreaterThanOrEqual(LOWEST - 1e-9);
            expect(h).toBeLessThanOrEqual(top + 1e-9);
        }
        // Over its centre it stands highest, near the full height of its tiers.
        const [cx, cz] = STORM.vaultCentre;
        expect(vaultBase(cx, cz)).toBeGreaterThan(LOWEST + STORM.tierHeight * (STORM.tiers - 1));
        // Out past its last tier it is the lowest tier's base, exactly.
        for (const angle of moments(0, Math.PI * 2, 24)) {
            expect(vaultBase(cx + Math.cos(angle) * OUTSIDE, cz + Math.sin(angle) * OUTSIDE)).toBe(LOWEST);
        }
    });

    it('steps down in terraces, never in a cliff', () => {
        const [cx, cz] = STORM.vaultCentre;
        for (const angle of [0.3, 1.9, 3.4, 5.1]) {
            const heights = moments(0, OUTSIDE, 4000)
                .map((r) => vaultBase(cx + Math.cos(angle) * r, cz + Math.sin(angle) * r));
            const step = OUTSIDE / 4000;
            let flat = 0;
            for (let i = 1; i < heights.length; i++) {
                const rise = Math.abs(heights[i] - heights[i - 1]);
                // A riser is steep, not a wall: no more than a few metres up for a metre out.
                expect(rise / step, `angle ${angle}, sample ${i}`).toBeLessThan(4);
                if (rise < 1e-9) flat += 1;
            }
            // Most of the way out it stands on a tier's flat.
            expect(flat / heights.length, `angle ${angle}`).toBeGreaterThan(0.5);
            // Every tier is seen: the underside stands at each of their heights somewhere on the way.
            for (let k = 0; k < STORM.tiers; k++) {
                const level = LOWEST + STORM.tierHeight * k;
                expect(heights.some((h) => Math.abs(h - level) < 1e-6), `tier ${k} at angle ${angle}`).toBe(true);
            }
        }
    });

    it('lifts whole by its lift, and stands taller the deeper its tiers hang', () => {
        for (const [x, z] of plain()) {
            const calm = vaultBase(x, z, STORM.tierHeightCalm, 0);
            const heavy = vaultBase(x, z, STORM.tierHeight, 0);
            expect(vaultBase(x, z, STORM.tierHeightCalm, 37)).toBeCloseTo(calm + 37, 9);
            expect(heavy).toBeGreaterThanOrEqual(calm - 1e-9);
            // Tiers of no height: one flat underside.
            expect(vaultBase(x, z, 0, 12)).toBe(LOWEST + 12);
        }
    });
});

describe('voltage storm weather: the storm\'s own turn', () => {
    it('is a pure function of the clock, into whatever object it is handed', () => {
        for (const time of [0, 3.25, 88, 176, 1000.5, 86_400]) {
            const out = { stale: true };
            expect(stormWeather(time, out)).toBe(out);
            expect(out).toMatchObject(stormWeather(time));
            expect(stormWeather(time)).toEqual(stormWeather(time));
        }
        // A clock that is not a number, or runs before zero, is the storm at its start.
        for (const time of [NaN, undefined, -5, -Infinity]) expect(stormWeather(time)).toEqual(stormWeather(0));
    });

    it('opens gathering, and turns through its four acts in order, once a turn', () => {
        expect(stormWeather(0).act).toBe('gather');
        const order = ['lull', 'gather', 'break', 'ease'];
        let previous = stormWeather(0);
        let changes = 0;
        for (const time of moments(0, STORM_CYCLE * 4, 4 * 1760)) {
            const weather = stormWeather(time);
            expect(order).toContain(weather.act);
            expect(weather.phase).toBeGreaterThanOrEqual(0);
            expect(weather.phase).toBeLessThan(1);
            if (weather.act !== previous.act) {
                changes += 1;
                expect(weather.act, `at ${time}`).toBe(order[(order.indexOf(previous.act) + 1) % order.length]);
            }
            if (weather.turn !== previous.turn) expect(weather.turn).toBe(previous.turn + 1);
            previous = weather;
        }
        expect(changes).toBe(4 * 4);
    });

    it('never jumps: the weight of the storm moves smoothly, across the turns too', () => {
        let previous = stormWeather(0).heavy;
        for (const time of moments(0, STORM_CYCLE * 6, 6 * 3520)) {
            const { heavy, squall: rain } = stormWeather(time);
            expect(heavy).toBeGreaterThanOrEqual(0);
            expect(heavy).toBeLessThanOrEqual(1);
            expect(rain).toBeGreaterThanOrEqual(0);
            expect(rain).toBeLessThanOrEqual(1);
            expect(Math.abs(heavy - previous), `at ${time}`).toBeLessThan(0.01);
            previous = heavy;
        }
    });

    it('lies lightest in its lull and heaviest at its break, a lull and a break of its own every turn', () => {
        const lulls = [];
        const breaks = [];
        for (let turn = 0; turn < 8; turn++) {
            const inTurn = moments(turn * STORM_CYCLE, (turn + 1) * STORM_CYCLE, 1760)
                .map((time) => stormWeather(time));
            const of = (act, pick) => pick(...inTurn.filter((w) => w.act === act).map((w) => w.heavy));
            if (inTurn.some((w) => w.act === 'lull')) lulls.push(of('lull', Math.max));
            if (inTurn.some((w) => w.act === 'break')) breaks.push(of('break', Math.min));
            for (const w of inTurn) {
                if (w.act === 'lull') expect(w.heavy).toBeLessThan(0.35);
                if (w.act === 'break') expect(w.heavy).toBeGreaterThan(0.75);
            }
        }
        expect(lulls.length).toBeGreaterThanOrEqual(7);
        expect(breaks.length).toBeGreaterThanOrEqual(7);
        // No two turns alike.
        expect(new Set(lulls.map((h) => h.toFixed(6))).size).toBeGreaterThan(lulls.length / 2);
        expect(new Set(breaks.map((h) => h.toFixed(6))).size).toBeGreaterThan(breaks.length / 2);
    });

    it('rains in squalls: smooth bursts, some hard and some slack', () => {
        // Steps of 1/200 of a burst: an eased value noise moves at most 1.5 times its span per burst.
        const values = moments(0, 60, 12_000).map((x) => squall(x));
        for (let i = 1; i < values.length; i++) expect(Math.abs(values[i] - values[i - 1])).toBeLessThan(0.0076);
        expect(Math.min(...values)).toBeLessThan(0.2);
        expect(Math.max(...values)).toBeGreaterThan(0.8);
        // On the whole numbers it is the hash's own value: the bursts do not drift with the clock.
        expect(squall(7)).toBe(squall(7));
        expect(squall(7.5)).toBeGreaterThanOrEqual(Math.min(squall(7), squall(8)) - 1e-12);
        expect(squall(7.5)).toBeLessThanOrEqual(Math.max(squall(7), squall(8)) + 1e-12);
    });
});

describe('voltage storm weather: the light a bolt throws', () => {
    const PLANS = [3, 23, 41, 77].map((seed) => strokePlan(seed, { leader: 0.12, strokes: 5, power: 1 }));
    const ages = moments(0, 1.6, 3200);

    it('throws nothing before its first stroke, and nothing at that stroke\'s own instant', () => {
        for (const plan of PLANS) {
            for (const age of [-1, -1e-9, NaN, undefined, 0, plan.leader * 0.5, plan.times[0]]) {
                expect(strokeGlow(plan, age)).toBe(0);
            }
            expect(strokeGlow(plan, plan.times[0] + 0.01)).toBeGreaterThan(0);
        }
    });

    it('swells in over its rise, then falls away slowly, and is all but gone when the bolt is', () => {
        for (const plan of PLANS) {
            const glow = ages.map((age) => strokeGlow(plan, age));
            const peak = Math.max(...glow);
            const at = ages[glow.indexOf(peak)];
            for (const g of glow) {
                expect(Number.isFinite(g)).toBe(true);
                expect(g).toBeGreaterThanOrEqual(0);
            }
            // It peaks some way after its first stroke, never on it.
            expect(at - plan.times[0]).toBeGreaterThan(GLOW_RISE * 0.5);
            // Every later stroke adds a little, never as much as the first.
            expect(peak).toBeLessThanOrEqual(plan.gains[0] * 1.64 * (1 + GLOW_RESTRIKE * (plan.times.length - 1)));
            // Well after the last stroke it has fallen to almost nothing.
            expect(strokeGlow(plan, plan.last + GLOW_FALL * 8)).toBeLessThan(peak * 0.01);
            expect(strokeGlow(plan, strokeLife(plan))).toBeLessThan(peak * 0.05);
        }
    });

    it('never falls as fast as the channel does: the storm swells, the thread flickers', () => {
        for (const plan of PLANS) {
            const glow = ages.map((age) => strokeGlow(plan, age));
            const main = ages.map((age) => strokeLight(plan, age).main);
            const glowPeak = Math.max(...glow);
            const mainPeak = Math.max(...main);
            // The most each falls within 50 ms, as a share of its own peak.
            const window = Math.round(0.05 / (ages[1] - ages[0]));
            let glowFall = 0;
            let mainFall = 0;
            for (let i = 0; i + window < ages.length; i++) {
                glowFall = Math.max(glowFall, (glow[i] - glow[i + window]) / glowPeak);
                mainFall = Math.max(mainFall, (main[i] - main[i + window]) / mainPeak);
            }
            expect(glowFall).toBeLessThan(0.2);
            expect(mainFall).toBeGreaterThan(0.4);
        }
    });

    it('scales with the power, and burns on through a continuing current', () => {
        const once = strokePlan(9, { leader: 0.1, strokes: 2, power: 1 });
        const twice = strokePlan(9, { leader: 0.1, strokes: 2, power: 2 });
        const held = strokePlan(9, {
            leader: 0.1, strokes: 2, power: 1, hold: 0.3,
        });
        for (const age of ages) expect(strokeGlow(twice, age)).toBeCloseTo(strokeGlow(once, age) * 2, 12);
        // Most of the way through the hold it is brighter than the same bolt that let go at once.
        const late = held.times[0] + 0.27;
        expect(strokeGlow(held, late)).toBeGreaterThan(strokeGlow(once, late) * 1.2);
    });
});

describe('voltage storm weather: in the world', () => {
    it('stands at rest as the clock says, and the sky is told so', () => {
        const { world, camera } = makeWorld();
        for (const time of [10, 40, 77.5, 120, 160]) {
            settle(world, camera, time);
            const { heavy } = stormWeather(time);
            expect(world.heavy, `at ${time}`).toBeCloseTo(heavy, 9);
            const [x, lift, tierHeight] = world.u.storm.value.toArray();
            expect(x).toBe(world.heavy);
            // A heavy storm brings the vault down and hangs its tiers deep; a light one lifts it.
            expect(tierHeight).toBeCloseTo(lerp(STORM.tierHeightCalm, STORM.tierHeight, heavy), 9);
            expect(lift).toBeGreaterThanOrEqual(0);
            expect(lift).toBeLessThanOrEqual(STORM.liftCalm);
            // A bolt leaves the cloud where the vault hangs over its start.
            for (const [px, pz] of [[0, -800], [-900, -1400], [700, -500]]) {
                expect(world.cloudUnder(px, pz)).toBeCloseTo(vaultBase(px, pz, tierHeight, lift) + 10, 9);
            }
        }
    });

    it('lifts the vault in a lull and brings it down at the break', () => {
        const { world, camera } = makeWorld();
        world.pinWeather(0);
        settle(world, camera, 30);
        const lull = world.u.storm.value.toArray();
        world.pinWeather(1);
        settle(world, camera, 30);
        const storm = world.u.storm.value.toArray();
        expect(lull[0]).toBe(0);
        expect(storm[0]).toBe(1);
        expect(lull[1]).toBeGreaterThan(storm[1]);
        expect(lull[2]).toBeLessThan(storm[2]);
        // And the scud races in under it as it gathers.
        expect(lull[3]).toBe(0);
        expect(storm[3]).toBeGreaterThan(0.9);
        // The rain falls harder.
        world.pinWeather(0);
        settle(world, camera, 30);
        const drizzle = world.u.rainGain.value;
        world.pinWeather(1);
        settle(world, camera, 30);
        expect(world.u.rainGain.value).toBeGreaterThan(drizzle * 2);
        // Let go, it is the clock's again.
        world.pinWeather(null);
        settle(world, camera, 30);
        expect(world.heavy).toBeCloseTo(stormWeather(30).heavy, 9);
        world.pinWeather(7);
        expect(world.heavy).toBe(1);
        world.pinWeather(-3);
        expect(world.heavy).toBe(0);
    });

    it('turns the vault slowly, and races the scud under it, by the clock', () => {
        const { world, camera } = makeWorld();
        settle(world, camera, 20);
        const before = world.u.vault.value.toArray();
        run(world, camera, 2, 60);
        const after = world.u.vault.value.toArray();
        // A turn: still a unit vector, a little further round.
        expect(Math.hypot(after[0], after[1])).toBeCloseTo(1, 9);
        const turned = Math.atan2(after[1], after[0]) - Math.atan2(before[1], before[0]);
        expect(turned).toBeGreaterThan(0);
        expect(turned).toBeLessThan(0.1);
        // The scud runs with the wind.
        expect(Math.sign(after[2] - before[2])).toBe(Math.sign(STORM.scudDrift[0]));
    });

    it('opens an eye in the vault for a perfect clear, holds it, and closes it again', () => {
        const { world, camera } = makeWorld();
        settle(world, camera, 12);
        expect(world.u.eye.value.w).toBe(0);
        world.onPerfect();
        const opened = [];
        const step = 0.25;
        for (let k = 0; k * step < EYE_OPENS + EYE_STANDS + EYE_CLOSES + 1; k++) {
            run(world, camera, step, 4);
            opened.push(world.u.eye.value.w);
        }
        for (const open of opened) {
            expect(open).toBeGreaterThanOrEqual(0);
            expect(open).toBeLessThanOrEqual(1);
        }
        // It widens, stands fully open, then closes, and is shut at the end.
        const full = opened.findIndex((open) => open > 0.999);
        expect(full).toBeGreaterThan(0);
        for (let i = 1; i <= full; i++) expect(opened[i]).toBeGreaterThanOrEqual(opened[i - 1]);
        const standing = opened.filter((open) => open > 0.999).length;
        expect(standing * step).toBeGreaterThan(EYE_STANDS * 0.8);
        expect(opened.at(-1)).toBe(0);
        // It opens over the field, in front of the card's sky, a few hundred metres across.
        const [x, z, radius] = world.u.eye.value.toArray();
        expect(z).toBeLessThan(0);
        expect(Math.abs(x)).toBeLessThan(STORM.edge);
        expect(radius).toBeGreaterThan(100);
    });

    it('opens the eye after a four-line perfect clear\'s superbolt, not with it', () => {
        const { world, camera } = makeWorld();
        settle(world, camera, 12);
        world.onClear({ lines: 4, perfect: true });
        run(world, camera, 0.4, 24);
        expect(world.u.eye.value.w).toBe(0);
        run(world, camera, 3, 90);
        expect(world.u.eye.value.w).toBeGreaterThan(0);
    });
});
