import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    AIR_HOLD, AIR_KEYS, AIR_PERIOD, GEODE_AIRS, VISIT_KINDS, VISIT_LIFE, VISIT_PERIOD, airAt, airDrift, airName,
    visitAt, visitEnvelope, visitHeld,
} from '../../src/themes/geode/geode-airs.js';
import { GeodeWorld, REST_RIG, SWEEP_LIFE } from '../../src/themes/geode/geode-world.js';
import {
    CAVITY, FIRE_OPAL, GEODE_PALETTES, MINERAL_PERIOD,
} from '../../src/themes/geode/geode-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/geode/geode-quality.js';
import { FALL_LIFE, FALL_SLOTS, FALL_STAGGER } from '../../src/themes/geode/geode-fx.js';
import { fallbackLayout } from '../../src/themes/geode/geode-composition.js';

// Every world test builds a whole world (a noise field, a plan, ten node materials).
vi.setConfig({ testTimeout: 30000 });

function makeWorld(quality = 'Low', { reduced = false, time = 10 } = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, REST_RIG.near, REST_RIG.far);
    const world = new GeodeWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setReducedMotion(reduced);
    world.setViewport(1600, 900, 16 / 9);
    world.setLayout(fallbackLayout(1600, 900), 16 / 9);
    world.seek(time);
    world.updateCamera(camera, { time, delta: 0 });
    world.update({ time, delta: 0 }, camera);
    return { camera, world };
}

function run(world, camera, seconds, steps = Math.max(1, Math.round(seconds * 60))) {
    const t0 = world.time;
    for (let i = 1; i <= steps; i++) {
        const sim = { time: t0 + (seconds * i) / steps, delta: seconds / steps };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    }
}

describe('geode airs: the clock that turns its light', () => {
    it('defines five airs of the same numbers, the first the geode as it has always stood', () => {
        expect(GEODE_AIRS.map((air) => air.name)).toEqual(['radiance', 'blaze', 'prism', 'embers', 'moonstone']);
        for (const air of GEODE_AIRS) {
            expect(Object.keys(air).filter((key) => key !== 'name')).toEqual(AIR_KEYS);
            for (const key of AIR_KEYS) expect(Number.isFinite(air[key]), `${air.name}.${key}`).toBe(true);
            expect(air.heart).toBeGreaterThan(0);
            expect(air.exposure).toBeGreaterThan(0.5);
            expect(air.exposure).toBeLessThan(1.5);
        }
        // Radiance lays nothing of its own over the picture.
        expect(GEODE_AIRS[0]).toMatchObject({
            heart: 1,
            white: 0,
            cool: 0,
            fill: 1,
            inner: 0,
            sheen: 0,
            sparkle: 1,
            dust: 1,
            reach: 1,
            rays: 1,
            exposure: 1,
            warmth: 0,
            saturation: 0,
            depth: 0,
        });
        // Each of the others is its own light, not a dimmer on the first.
        expect(GEODE_AIRS[1].heart).toBeGreaterThan(1.2); // blaze
        expect(GEODE_AIRS[2].fire).toBeGreaterThan(1); // prism
        expect(GEODE_AIRS[3].heart).toBeLessThan(0.5); // embers: the heart sunk to a coal...
        expect(GEODE_AIRS[3].inner).toBe(1); // ...and the stones burning from within
        expect(GEODE_AIRS[4].sheen).toBe(1); // moonstone
        expect(GEODE_AIRS[4].fill).toBeGreaterThan(1.5);
    });

    it('rests on an air, then melts into the next, and never falls in step with the minerals', () => {
        const hold = AIR_PERIOD * AIR_HOLD;
        expect(airDrift(0)).toBe(0);
        expect(airDrift(hold * 0.99)).toBe(0);
        const half = airDrift(hold + (AIR_PERIOD - hold) / 2);
        expect(half).toBeCloseTo(0.5, 9);
        expect(airDrift(AIR_PERIOD)).toBe(1);
        expect(airDrift(AIR_PERIOD * GEODE_AIRS.length + 1)).toBe(GEODE_AIRS.length);
        // It never runs backward.
        let last = 0;
        for (let t = 0; t < AIR_PERIOD * 6; t += 0.37) {
            const now = airDrift(t);
            expect(now).toBeGreaterThanOrEqual(last);
            last = now;
        }
        // The same mineral in the same air is hours apart: the two periods share no small multiple.
        const wheelA = AIR_PERIOD * GEODE_AIRS.length;
        const wheelM = MINERAL_PERIOD * GEODE_PALETTES.length;
        const gcd = (a, b) => (b ? gcd(b, a % b) : a);
        expect((wheelA * wheelM) / gcd(wheelA, wheelM)).toBeGreaterThan(3600 * 6);
    });

    it('is exactly an air on a whole phase and a straight mix between two, round the wheel', () => {
        GEODE_AIRS.forEach((air, i) => {
            const at = airAt(i);
            for (const key of AIR_KEYS) expect(at[key], `${air.name}.${key}`).toBe(air[key]);
            expect(airName(i)).toBe(air.name);
        });
        const mid = airAt(0.5);
        for (const key of AIR_KEYS) expect(mid[key]).toBeCloseTo((GEODE_AIRS[0][key] + GEODE_AIRS[1][key]) / 2, 12);
        // The last melts back into the first.
        const wrap = airAt(GEODE_AIRS.length - 0.25);
        const last = GEODE_AIRS[GEODE_AIRS.length - 1];
        expect(wrap.heart).toBeCloseTo(last.heart + (GEODE_AIRS[0].heart - last.heart) * 0.75, 12);
        expect(airName(GEODE_AIRS.length)).toBe('radiance');
        // It writes into the object it is given.
        const out = {};
        expect(airAt(2, out)).toBe(out);
    });
});

describe('geode visits: what happens in it unasked', () => {
    it('keeps a schedule that is a function of the clock: one visit a slot, none in the first seconds', () => {
        expect(visitAt(0).kind).toBe(null);
        expect(visitAt(10).kind).toBe(null);
        const seen = [];
        let current = null;
        for (let t = 0; t < VISIT_PERIOD * 40; t += 0.05) {
            const visit = visitAt(t);
            if (visit.kind && (!current || current.index !== visit.index)) {
                current = { index: visit.index, kind: visit.kind, start: t };
                seen.push(current);
            }
            if (visit.kind) {
                expect(VISIT_KINDS).toContain(visit.kind);
                expect(visit.life).toBe(VISIT_LIFE[visit.kind]);
                expect(visit.age).toBeGreaterThanOrEqual(0);
                expect(visit.age).toBeLessThan(visit.life);
                expect(visit.env).toBeGreaterThanOrEqual(0);
                expect(visit.env).toBeLessThanOrEqual(1);
                expect(visit.seed).toBeGreaterThanOrEqual(0);
                expect(visit.seed).toBeLessThan(1);
            }
        }
        // About one a slot, every kind among them, and never the same kind twice running.
        expect(seen.length).toBeGreaterThan(35);
        expect(new Set(seen.map((visit) => visit.kind)).size).toBe(VISIT_KINDS.length);
        for (let i = 1; i < seen.length; i++) {
            expect(seen[i].index).toBe(seen[i - 1].index + 1);
            expect(seen[i].kind, `visit ${i}`).not.toBe(seen[i - 1].kind);
            // One ends before the next begins.
            expect(seen[i].start).toBeGreaterThan(seen[i - 1].start + VISIT_LIFE[seen[i - 1].kind] - 0.06);
        }
        // The same moment is the same visit, whenever it is asked.
        const again = visitAt(seen[7].start + 1);
        expect(visitAt(seen[7].start + 1)).toEqual(again);
        expect(again.kind).toBe(seen[7].kind);
    });

    it('swells in and dies away: no visit starts or ends at full strength', () => {
        expect(visitEnvelope(0)).toBe(0);
        expect(visitEnvelope(1)).toBe(0);
        expect(visitEnvelope(0.5)).toBe(1);
        expect(visitEnvelope(0.02)).toBeLessThan(0.1);
        expect(visitEnvelope(0.99)).toBeLessThan(0.01);
        for (let k = 0; k < 1; k += 0.01) {
            expect(visitEnvelope(k)).toBeGreaterThanOrEqual(0);
            expect(visitEnvelope(k)).toBeLessThanOrEqual(1);
        }
        // A capture holds one moment of one visit; an age outside its life is no visit.
        expect(visitHeld('chime', 2)).toMatchObject({ kind: 'chime', age: 2, life: VISIT_LIFE.chime });
        expect(visitHeld('chime', 99).kind).toBe(null);
        expect(visitHeld('no-such-visit', 1).kind).toBe(null);
        // A shower's grains are all down before its visit is over (its row is cleared then).
        expect(FALL_LIFE + FALL_STAGGER).toBeLessThanOrEqual(VISIT_LIFE.fall);
    });
});

describe('geode world: airs and visits', () => {
    it('stands in the first air at rest and tells the shaders and the post each air\'s numbers', () => {
        const { camera, world } = makeWorld('Low');
        expect(world.getState()).toMatchObject({ air: 'radiance', visit: null });
        const rest = GEODE_AIRS[0];
        expect(world.u.mood.value.toArray()).toEqual([rest.thin, rest.inner, rest.fire, rest.sheen]);
        expect(world.u.air.value.x).toBe(rest.sparkle);
        expect(world.u.air.value.y).toBe(rest.dust);
        expect(world.u.air.value.w).toBe(rest.reach);
        expect(world.u.lamp.value.x).toBe(rest.fill);
        const heartAtRest = world.u.heart.value.clone();
        // Held on the embers the heart is a coal and the stones burn from within.
        world.airHold = 3;
        world.update({ time: world.time, delta: 0 }, camera);
        const embers = GEODE_AIRS[3];
        expect(world.getState().air).toBe('embers');
        expect(world.u.mood.value.y).toBe(embers.inner);
        expect(world.u.air.value.x).toBe(embers.sparkle);
        expect(world.u.heart.value.length()).toBeCloseTo(heartAtRest.length() * embers.heart, 6);
        expect(world.getPostState()).toMatchObject({
            airExposure: embers.exposure,
            airGrade: { warmth: embers.warmth, saturation: embers.saturation, depth: embers.depth },
        });
        // The palette is the mineral's own in every air: an air turns the light, never the stone.
        GEODE_PALETTES[0].fill.forEach((channel, k) => {
            expect(world.u.fill.value.getComponent(k)).toBeCloseTo(channel, 9);
        });
        // In moonstone the heart's light leans to the cool of the fill.
        world.airHold = 4;
        world.update({ time: world.time, delta: 0 }, camera);
        const cool = world.u.heart.value;
        expect(cool.z / cool.x).toBeGreaterThan(heartAtRest.z / heartAtRest.x);
        world.dispose();
    });

    it('turns through the airs by the clock, the same whether it ran there or was set there', () => {
        const time = AIR_PERIOD * (1 + AIR_HOLD + (1 - AIR_HOLD) * 0.4);
        const ran = makeWorld('Low');
        run(ran.world, ran.camera, time - ran.world.time, 300);
        const set = makeWorld('Low', { time });
        expect(airDrift(time)).toBeGreaterThan(1.1);
        expect(airDrift(time)).toBeLessThan(1.9);
        ['mood', 'air', 'lamp', 'heart', 'heartPos'].forEach((name) => {
            ran.world.u[name].value.toArray().forEach((value, k) => {
                expect(value, `${name}[${k}]`).toBeCloseTo(set.world.u[name].value.getComponent(k), 9);
            });
        });
        expect(ran.world.getPostState().airExposure).toBeCloseTo(set.world.getPostState().airExposure, 12);
        // Reduced motion does not slow it: a slow change of light is not motion.
        const still = makeWorld('Low', { reduced: true, time });
        expect(still.world.u.mood.value.toArray()).toEqual(set.world.u.mood.value.toArray());
        ran.world.dispose();
        set.world.dispose();
        still.world.dispose();
    });

    it('plays each visit through uniforms of its own, touching nothing gameplay keeps', () => {
        const { camera, world } = makeWorld('Low');
        const quiet = () => {
            expect(world.u.live.value.toArray()).toEqual([0, 0, 0, 0]);
            expect(world.getState().held).toBe(0);
            expect(world.counts).toMatchObject({
                locks: 0, clears: 0, wisps: 0, falls: 0,
            });
        };
        const hold = (kind, age) => {
            world.visitHold = { kind, age };
            world.update({ time: world.time, delta: 0 }, camera);
            expect(world.getState().visit).toBe(kind);
            quiet();
        };
        // A meridian of sparkle running round the lining...
        hold('shimmer', 3);
        expect(world.u.shimmer.value.y).toBeGreaterThan(0.9);
        expect(world.u.shimmer.value.w).toBe(0);
        expect(world.u.live2.value.z).toBe(1);
        const meridian = world.u.shimmer.value.x;
        hold('shimmer', 4);
        expect(world.u.shimmer.value.x).not.toBe(meridian);
        // ...a ring of it running down the wall from the agate's rim...
        hold('cascade', 2);
        expect(world.u.shimmer.value.y).toBe(0);
        expect(world.u.shimmer.value.w).toBeGreaterThan(0.9);
        expect(world.u.shimmer.value.z).toBeGreaterThan(CAVITY.wBands - 0.3);
        expect(world.u.shimmer.value.z).toBeLessThan(CAVITY.wMax);
        // ...the heart's slow ring, and the heart swelling with it...
        const calm = world.u.heart.value.length();
        hold('swell', 1.5);
        expect(world.u.swell.value.y).toBeGreaterThan(0.5);
        expect(world.u.heart.value.length()).toBeGreaterThan(calm);
        // ...a cluster ringing by itself in its own mineral's colour...
        hold('chime', 2.5);
        const chime = world.u.chime.value;
        expect(chime.w).toBeGreaterThan(0.5);
        const cluster = world.plan.clusters.find((c) => c.root[0] === chime.x && c.root[1] === chime.y);
        expect(cluster).toBeTruthy();
        expect(world.u.live2.value.w).toBe(1);
        const tone = GEODE_PALETTES[0][`m${cluster.mineral}`];
        expect(world.u.chimeC.value.y / world.u.chimeC.value.x).toBeCloseTo(tone[1] / tone[0], 6);
        // ...a shower of dust in the visits' own slot...
        hold('fall', 3);
        const row = world.glitterFall.uniforms.rows[0].value;
        expect(row.y).toBeGreaterThan(0);
        expect(row.x).toBeCloseTo(world.time - 3, 9);
        // ...and the fire on the lining flaring.
        const fire = world.u.mood.value.z;
        hold('fire', 4);
        expect(world.u.mood.value.z).toBeGreaterThan(fire + 0.5);
        expect(world.glitterFall.uniforms.rows[0].value.y).toBe(0);
        // With none under way every one of them is at rest.
        world.visitHold = null;
        world.visits = false;
        world.update({ time: world.time, delta: 0 }, camera);
        expect(world.getState().visit).toBe(null);
        expect(world.u.shimmer.value.toArray()).toEqual([0, 0, 0, 0]);
        expect(world.u.swell.value.y).toBe(0);
        expect(world.u.chime.value.w).toBe(0);
        expect(world.u.live2.value.toArray()).toEqual([0, 0, 0, 0]);
        world.dispose();
    });

    it('keeps the lights of a visit under reduced motion and leaves out what runs or falls', () => {
        const { camera, world } = makeWorld('Low', { reduced: true });
        for (const kind of ['shimmer', 'cascade', 'fall']) {
            world.visitHold = { kind, age: 2.5 };
            world.update({ time: world.time, delta: 0 }, camera);
            expect(world.u.shimmer.value.toArray(), kind).toEqual([0, 0, 0, 0]);
            expect(world.glitterFall.uniforms.rows[0].value.y, kind).toBe(0);
        }
        world.visitHold = { kind: 'chime', age: 2.5 };
        world.update({ time: world.time, delta: 0 }, camera);
        expect(world.u.chime.value.w).toBeGreaterThan(0.5);
        world.dispose();
    });
});

describe('geode world: the shapes the board\'s own events take', () => {
    it('winds a pinwheel out of the heart on a twist, a fainter one on a twist that clears nothing', () => {
        const { camera, world } = makeWorld('Low');
        expect(world.u.whirl.value.y).toBe(0);
        world.onSpin();
        const spin = world.u.whirl.value.clone();
        expect(spin.x).toBe(world.time);
        expect(spin.y).toBeGreaterThan(0);
        expect(spin.z).toBe(2);
        run(world, camera, 1 / 60, 1);
        expect(world.u.live2.value.x).toBe(1);
        // A twist that clears is the stronger: it takes the pinwheel over, three arms, turning the other way.
        run(world, camera, 3);
        world.onClear({ lines: 2, twist: true });
        const twist = world.u.whirl.value.clone();
        expect(twist.x).toBe(world.time);
        expect(twist.y).toBeGreaterThan(spin.y);
        expect(twist.z).toBe(3);
        expect(twist.w).toBe(-spin.w);
        // A second twist while the first still turns adds to it: nothing restarts, nothing dims.
        run(world, camera, 0.4);
        world.onClear({ lines: 1, twist: true });
        expect(world.u.whirl.value.x).toBe(twist.x);
        expect(world.u.whirl.value.y).toBeGreaterThan(twist.y);
        expect(world.counts.whirls).toBe(2);
        // Long after, the shaders skip it.
        run(world, camera, 12, 240);
        expect(world.u.live2.value.x).toBe(0);
        world.dispose();
    });

    it('gives one, two, three and four lines each a shape more than the last', () => {
        const pours = (world) => world.glitterFall.uniforms.rows.slice(1).filter((row) => row.value.y > 0).length;
        const fireAfter = (lines) => {
            const { camera, world } = makeWorld('Low');
            world.onClear({ lines });
            const poured = pours(world);
            run(world, camera, 0.8);
            const out = { poured, fire: world.u.mood.value.z - GEODE_AIRS[0].fire, falls: world.counts.falls };
            world.dispose();
            return out;
        };
        // One line: the wave alone. Two: dust shaken loose from the vault. Three: fire over the lining as well.
        expect(fireAfter(1)).toEqual({ poured: 0, fire: 0, falls: 0 });
        const two = fireAfter(2);
        expect(two).toMatchObject({ poured: 1, falls: 1 });
        expect(two.fire).toBe(0);
        const three = fireAfter(3);
        expect(three).toMatchObject({ poured: 1, falls: 1 });
        expect(three.fire).toBeGreaterThan(0.5);
        const four = fireAfter(4);
        expect(four.poured).toBe(1);
        expect(four.fire).toBeGreaterThan(three.fire);
    });

    it('pours a second shower beside the first, and lets a young one take the next clear\'s dust', () => {
        const { camera, world } = makeWorld('Low');
        const { rows } = world.glitterFall.uniforms;
        world.onClear({ lines: 2 });
        const first = rows.findIndex((row, i) => i > 0 && row.value.y > 0);
        expect(first).toBeGreaterThan(0);
        expect(rows[0].value.y).toBe(0); // (slot 0 is the visits')
        const strength = rows[first].value.y;
        const began = rows[first].value.x;
        // A clear a second later joins the shower in the air: it thickens, it does not start again.
        run(world, camera, 1);
        world.onClear({ lines: 2 });
        expect(rows[first].value.x).toBe(began);
        expect(rows[first].value.y).toBeGreaterThan(strength);
        expect(world.counts.falls).toBe(1);
        // Once that one is well under way the next clear pours the other slot.
        run(world, camera, 3);
        world.onClear({ lines: 3 });
        const second = first === 1 ? 2 : 1;
        expect(rows[second].value.x).toBe(world.time);
        expect(rows[first].value.x).toBe(began);
        expect(world.counts.falls).toBe(2);
        // Reduced motion pours nothing.
        const still = makeWorld('Low', { reduced: true });
        still.world.onClear({ lines: 3 });
        expect(still.world.glitterFall.uniforms.rows.every((row) => row.value.y === 0)).toBe(true);
        still.world.dispose();
        // A new run clears the air.
        world.resetSession();
        expect(rows.every((row) => row.value.y === 0)).toBe(true);
        expect(world.u.whirl.value.y).toBe(0);
        world.dispose();
    });

    it('sets every facet playing its own colour for a perfect clear, and lets it die away', () => {
        const { camera, world } = makeWorld('Low');
        expect(world.u.opal.value).toBe(0);
        world.onClear({ lines: 4 });
        run(world, camera, 0.36);
        expect(world.u.opal.value).toBe(0); // a four alone has no opal fire
        const { rows, colors } = world.glitterFall.uniforms;
        const slot = rows.findIndex((row, i) => i > 0 && row.value.y > 0);
        const dust = { strength: rows[slot].value.y, began: rows[slot].value.x, green: colors[slot].value.y };
        world.onPerfect();
        run(world, camera, 0.6);
        expect(world.u.opal.value).toBeGreaterThan(0.5);
        expect(world.u.live2.value.y).toBe(1);
        // The four's dust is still young: it thickens and takes half the fire opal's colour (no restart).
        expect(rows[slot].value.x).toBe(dust.began);
        expect(rows[slot].value.y).toBeGreaterThan(dust.strength);
        expect(colors[slot].value.y).toBeCloseTo((dust.green + FIRE_OPAL[1]) / 2, 6);
        const peak = world.u.opal.value;
        run(world, camera, 4);
        expect(world.u.opal.value).toBeLessThan(peak);
        run(world, camera, 30, 300);
        expect(world.u.opal.value).toBeLessThan(2e-3);
        expect(world.u.live2.value.y).toBe(0);
        world.dispose();
    });

    it('builds the glitter-fall pool at every tier, a third of it to each shower', () => {
        expect(FALL_SLOTS).toBe(3);
        let last = 0;
        for (const quality of QUALITY_NAMES) {
            const { world } = makeWorld(quality);
            const pool = world.parts.glitterFall;
            expect(pool, quality).toBe(world.glitterFall);
            expect(pool.count % FALL_SLOTS, quality).toBe(0);
            expect(pool.count, quality).toBeLessThanOrEqual(QUALITY[quality].fall);
            expect(pool.count, quality).toBeGreaterThan(QUALITY[quality].fall - FALL_SLOTS);
            expect(pool.geometry.instanceCount, quality).toBe(pool.count);
            expect(QUALITY[quality].fall, quality).toBeGreaterThan(last);
            last = QUALITY[quality].fall;
            const slots = Array.from(pool.geometry.getAttribute('aSlot').array);
            for (let slot = 0; slot < FALL_SLOTS; slot++) {
                expect(slots.filter((value) => value === slot).length, `${quality} slot ${slot}`).toBe(pool.count / 3);
            }
            world.dispose();
        }
    });

    it('carries a level-up through a second one that comes before the first front has run', () => {
        const { camera, world } = makeWorld('Low');
        world.levelUp(2);
        run(world, camera, SWEEP_LIFE * 0.4);
        expect(world.sweepProgress()).toBeGreaterThan(0.3);
        // The front still running lands at once, and the new one starts from the mineral it carried.
        world.levelUp(3);
        run(world, camera, 1 / 60, 1);
        expect(world.getState().level).toBe(3);
        expect(world.u.sweep.value.y).toBe(1);
        GEODE_PALETTES[1].druzy.forEach((channel, k) => {
            expect(world.u.druzy.value.getComponent(k)).toBeCloseTo(channel, 9);
        });
        GEODE_PALETTES[2].druzy.forEach((channel, k) => {
            expect(world.u.druzyB.value.getComponent(k)).toBeCloseTo(channel, 9);
        });
        run(world, camera, SWEEP_LIFE + 0.1);
        expect(world.u.sweep.value.y).toBe(0);
        expect(world.getState().mineral).toBe(2);
        // A seek drops a front in flight: the geode is whole on its level's mineral.
        world.levelUp(4);
        world.seek(world.time);
        world.update({ time: world.time, delta: 0 }, camera);
        expect(world.u.sweep.value.y).toBe(0);
        world.dispose();
    });
});
