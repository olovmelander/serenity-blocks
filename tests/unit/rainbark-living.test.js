/**
 * Rainbark — the living pass (2026-11-18): the beam field, the wheel's six moods and the grove's
 * happenings, the sparks every beat throws, the Sunshower's bow, the foliage and the lorikeets.
 *
 * Relations, not tuning numbers: constants are imported; the assertions are orders, bounds and
 * the things that must never happen (a speck in flight moved by a later beat, a spray going up a
 * storey in view, a light that steps instead of easing, a beat with no effect of its own).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { REST_RIG, RainbarkWorld, fovForAspect } from '../../src/themes/rainbark/rainbark-world.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/rainbark/rainbark-quality.js';
import {
    BEAMS, BOW, FOLIAGE, HAPPENINGS, LIGHT_WHEEL, LORIKEET, SPARKS, STOREY,
    beamField, happeningAt, lensEdges, lightWheelAt, sprayPlace, wheelValue,
} from '../../src/themes/rainbark/rainbark-core.js';
import { BEAM_STRIDE, beamBreath, beamRecords } from '../../src/themes/rainbark/rainbark-beams.js';
import { SPARK_STRIDE, sparkAt } from '../../src/themes/rainbark/rainbark-sparks.js';
import {
    SPRAY_STRIDE, sprayGeometry, sprayRecords, writeBoughs,
} from '../../src/themes/rainbark/rainbark-foliage.js';
import { birdGeometry, wingAt } from '../../src/themes/rainbark/rainbark-birds.js';
import { bowCentre } from '../../src/themes/rainbark/rainbark-bow.js';
import { fallbackLayout } from '../../src/themes/rainbark/rainbark-composition.js';

function makeWorld(quality = 'High', { at = 10, level = 4 } = {}) {
    const width = 1600;
    const height = 900;
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new RainbarkWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, aspect, width, height);
    world.setLayout(fallbackLayout(width, height), aspect);
    world.seek(at);
    if (level > 1) world.levelUp(level, { silent: true });
    step(world, camera, 0);
    return { world, camera, scene };
}

function step(world, camera, dt, during = null) {
    const sim = {
        time: world.time + dt, delta: dt, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    during?.();
    world.update(sim, camera);
}

const run = (world, camera, seconds, dt = 1 / 30, each = null) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) {
        step(world, camera, dt);
        each?.();
    }
};

const lockAt = (u, rows, { hardDrop = false, distance = 12 } = {}) => ({
    player: 0, rows, u, hardDrop, distance, color: null, shape: 'O', cells: null, screen: null,
});
const bottom = (n) => Array.from({ length: n }, (_, k) => 19 - k);
const clearOf = (lines, extra = {}) => ({
    player: 0,
    rows: bottom(lines),
    lines,
    combo: 1,
    cascade: 1,
    twist: false,
    perfect: false,
    b2b: false,
    rowCodes: bottom(lines).flatMap((_, k) => Array.from({ length: 10 }, (__, c) => (c + k) % 7)),
    screen: null,
    ...extra,
});

const finite = (array) => Array.from(array).every(Number.isFinite);

describe('Rainbark living: the beam field', () => {
    it('is one field every tier draws a prefix of, spread in depth and across the lens', () => {
        const all = beamField(22);
        expect(beamField(9)).toEqual(all.slice(0, 9));
        all.forEach((b) => {
            expect(b.depth).toBeGreaterThanOrEqual(BEAMS.depth[0]);
            expect(b.depth).toBeLessThanOrEqual(BEAMS.depth[1]);
            expect(b.across).toBeGreaterThanOrEqual(BEAMS.across[0]);
            expect(b.across).toBeLessThanOrEqual(BEAMS.across[1]);
            expect(b.period).toBeGreaterThanOrEqual(BEAMS.period[0]);
        });
        // Even the shortest prefix (Low's) holds near and far beams, on the sun's side and the shade's.
        const few = beamField(QUALITY.Low.beams);
        expect(Math.min(...few.map((b) => b.depth))).toBeLessThan(60);
        expect(Math.max(...few.map((b) => b.depth))).toBeGreaterThan(80);
        expect(few.some((b) => b.across > 0.12)).toBe(true);
        expect(few.some((b) => b.across < 0.12)).toBe(true);
        // Most stand in the gold air.
        expect(all.filter((b) => b.across > 0.1).length).toBeGreaterThan(all.length / 2);
        const records = beamRecords(14);
        expect(records.data).toHaveLength(14 * BEAM_STRIDE);
        expect(finite(records.data)).toBe(true);
    });

    it('breathes: each beam dark a share of the time, never stepping', () => {
        const field = beamField(14);
        field.forEach((b) => {
            const rate = (Math.PI * 2) / b.period;
            let dark = 0;
            let lit = 0;
            let worst = 0;
            let prev = beamBreath(0, rate, b.phase);
            const n = 60 * 240;
            for (let i = 1; i <= n; i++) {
                const v = beamBreath(i / 60, rate, b.phase);
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(1);
                worst = Math.max(worst, Math.abs(v - prev));
                prev = v;
                if (v < 0.02) dark += 1;
                if (v > 0.5) lit += 1;
            }
            expect(dark / n, 'dark part of the time').toBeGreaterThan(0.05);
            expect(lit / n, 'lit part of the time').toBeGreaterThan(0.1);
            // (A frame's step of a beam's light: far under what the eye reads as a pop.)
            expect(worst).toBeLessThan(0.02);
        });
        // The beams in the frame keep changing: the lit set differs a minute apart.
        const litAt = (t) => field.map((b) => (beamBreath(t, (Math.PI * 2) / b.period, b.phase) > 0.3 ? 1 : 0)).join('');
        expect(new Set([0, 60, 120, 180, 240, 300].map(litAt)).size).toBeGreaterThan(3);
    });

    it('builds the field for the tiers that have it, and shades the air between the beams only there', () => {
        for (const quality of QUALITY_NAMES) {
            const tier = QUALITY[quality];
            const { world } = makeWorld(quality);
            const { fx } = world.parts;
            if (tier.beams > 0) {
                expect(fx.beams.count).toBe(tier.beams);
                expect(fx.beams.geometry.instanceCount).toBe(tier.beams);
                expect(world.u.airShade.value).toBe(BEAMS.gapShade);
                // Under the shafts, the drops and the motes: the first of the additive effects.
                expect(fx.beams.mesh.renderOrder).toBeLessThan(fx.motes.mesh.renderOrder);
            } else {
                expect(fx.beams).toBeNull();
                expect(world.u.airShade.value).toBe(0);
            }
            expect(world.u.beamGain.value).toBeGreaterThan(0.2);
            world.dispose();
        }
    }, 120000);
});

describe('Rainbark living: the wheel and the happenings', () => {
    it('turns through six moods, today\'s look first, the fireflies\' dusk among them', () => {
        const names = LIGHT_WHEEL.moods.map((mood) => mood.name);
        expect(names).toEqual(['morning', 'noon', 'gold', 'ember', 'dusk', 'pearl']);
        // (Mood 0 is the zones as authored: the rule of docs/THEME_MOOD_CLOCKS_2026-10.md.)
        expect(Object.keys(LIGHT_WHEEL.moods[0].tint)).toEqual([]);
        expect(LIGHT_WHEEL.moods.filter((mood) => mood.night > 0).map((mood) => mood.name)).toEqual(['dusk']);
        LIGHT_WHEEL.moods.forEach((mood) => {
            expect(mood.beams).toBeGreaterThan(0);
            expect(mood.flecks).toBeGreaterThan(0.2);
            // Never a dark frame: the bark keeps its colours in every mood.
            expect(mood.exposure).toBeGreaterThan(0.8);
            expect(mood.sun).toHaveLength(2);
        });
        // The whole wheel in ten minutes; every value eases between moods.
        const seen = new Set();
        let prev = wheelValue(lightWheelAt(0), 'beams');
        for (let t = 0; t <= LIGHT_WHEEL.step * LIGHT_WHEEL.moods.length; t += 0.5) {
            const wheel = lightWheelAt(t);
            seen.add(wheel.mix < 0.5 ? wheel.a : wheel.b);
            const v = wheelValue(wheel, 'beams');
            expect(Math.abs(v - prev)).toBeLessThan(0.02);
            prev = v;
        }
        expect(seen.size).toBe(LIGHT_WHEEL.moods.length);
    });

    it('lets something come over the grove now and then, by the clock alone', () => {
        // The reference frames (t = 55, the high tide at 75) stand before the first.
        for (let t = 0; t < HAPPENINGS.first; t += 1) expect(happeningAt(t).kind).toBe(-1);
        const seconds = new Array(HAPPENINGS.kinds.length).fill(0);
        let quiet = 0;
        let prev = 0;
        let prevSlot = -1;
        for (let t = HAPPENINGS.first; t < 3600; t += 1 / 30) {
            const h = happeningAt(t);
            expect(h.k).toBeGreaterThanOrEqual(0);
            expect(h.k).toBeLessThanOrEqual(1);
            // It comes and goes: the envelope never steps (and a new one starts from nothing).
            if (h.slot === prevSlot) expect(Math.abs(h.k - prev)).toBeLessThan(0.05);
            else expect(h.k).toBeLessThan(0.05);
            prev = h.k;
            prevSlot = h.slot;
            if (h.kind >= 0) seconds[h.kind] += 1 / 30;
            else quiet += 1 / 30;
        }
        // Each kind happens within the hour, and the grove also rests.
        seconds.forEach((s) => expect(s).toBeGreaterThan(30));
        expect(quiet).toBeGreaterThan(600);
        // Closed form: the same clock, the same happening.
        expect(happeningAt(1234.5)).toEqual(happeningAt(1234.5));
    });

    it('a held happening changes what it says it does, and the light eases through its start', () => {
        const base = makeWorld('High');
        const held = (kind, age) => {
            const made = makeWorld('High');
            made.world.tune.happen = kind;
            made.world.tune.happenAge = age;
            step(made.world, made.camera, 1 / 30);
            return made.world;
        };
        step(base.world, base.camera, 1 / 30);
        const sunbreak = held(0, 6);
        expect(sunbreak.u.beamGain.value).toBeGreaterThan(base.world.u.beamGain.value * 1.3);
        expect(sunbreak.u.fleckLight.value).toBeGreaterThan(base.world.u.fleckLight.value);
        const gust = held(1, 2.5);
        expect(gust.u.gust.value).toBeGreaterThan(0.5);
        expect(Math.hypot(gust.u.wind.value.x - base.world.u.wind.value.x, gust.u.wind.value.y - base.world.u.wind.value.y))
            .toBeGreaterThan(0.1);
        const bank = held(2, 14);
        expect(bank.u.tide.value).toBeGreaterThan(base.world.u.tide.value + 1);
        expect(bank.u.airGain.value).toBeGreaterThan(base.world.u.airGain.value);
        [sunbreak, gust, bank].forEach((world) => world.dispose());
        base.world.dispose();
        // Through the first happenings of a session, a frame's change of the beams' light is small.
        const { world, camera } = makeWorld('High', { at: HAPPENINGS.first - 2 });
        let before = world.u.beamGain.value;
        let worst = 0;
        run(world, camera, 3 * HAPPENINGS.every, 1 / 30, () => {
            worst = Math.max(worst, Math.abs(world.u.beamGain.value - before) / Math.max(before, 1e-3));
            before = world.u.beamGain.value;
        });
        expect(worst).toBeLessThan(0.06);
        world.dispose();
    }, 60000);

    it('dusk brings the fireflies; a held mood is the wheel\'s own', () => {
        const { world, camera } = makeWorld('High');
        world.tune.mood = LIGHT_WHEEL.moods.findIndex((mood) => mood.name === 'dusk');
        step(world, camera, 1 / 30);
        expect(world.u.night.value).toBe(1);
        expect(world.getState().light).toBe('dusk');
        world.tune.mood = 0;
        step(world, camera, 1 / 30);
        expect(world.u.night.value).toBe(0);
        world.dispose();
    });
});

describe('Rainbark living: the sparks', () => {
    it('a speck\'s flight is closed form, finite and fades in and out', () => {
        const rec = new Float32Array(SPARK_STRIDE);
        rec.set([1, 50, -10, 0, 2, 3, -1, 2.5, 8, 6, 2, 4, 0.5, -9, 4, 0.9]);
        const out = [0, 0, 0, 0];
        let prev = sparkAt(rec, 0, 0, [0, 0, 0, 0]).slice();
        for (let age = 0; age <= 2.5; age += 1 / 60) {
            sparkAt(rec, 0, age, out);
            expect(out.every(Number.isFinite)).toBe(true);
            expect(out[3]).toBeGreaterThanOrEqual(0);
            expect(out[3]).toBeLessThanOrEqual(1);
            // (A speck never jumps: a frame moves it centimetres.)
            expect(Math.hypot(out[0] - prev[0], out[1] - prev[1], out[2] - prev[2])).toBeLessThan(0.25);
            prev = out.slice();
        }
        expect(sparkAt(rec, 0, 0, out)[3]).toBe(0);
        expect(sparkAt(rec, 0, 1.0, out)[3]).toBeGreaterThan(0.9);
        expect(sparkAt(rec, 0, 2.6, out)[3]).toBe(0);
        expect(sparkAt(rec, 0, -1, out)[3]).toBe(0);
    });

    it('every tier has them, and every beat spends its own: the bigger the beat, the more', () => {
        for (const quality of QUALITY_NAMES) {
            const { world } = makeWorld(quality);
            expect(world.parts.fx.sparks.count).toBe(QUALITY[quality].sparks);
            world.dispose();
        }
        const spent = (beat, settle = 0.9) => {
            const { world, camera } = makeWorld('High');
            const { sparks } = world.parts.fx;
            step(world, camera, 1 / 30, () => beat(world));
            let most = 0;
            run(world, camera, settle, 1 / 30, () => { most = Math.max(most, sparks.liveAt(world.time)); });
            expect(finite(sparks.data)).toBe(true);
            world.dispose();
            return most;
        };
        const lock = spent((world) => world.onLock(lockAt(0.2, [18, 19])));
        const knock = spent((world) => world.onLock(lockAt(0.2, [18, 19], { hardDrop: true, distance: 18 })));
        const single = spent((world) => world.onClear(clearOf(1)));
        const triple = spent((world) => world.onClear(clearOf(3)));
        const quad = spent((world) => world.onClear(clearOf(4)), 2.2);
        const twist = spent((world) => {
            world.onLock(lockAt(0.2, [17, 18]));
            world.onClear(clearOf(2, { twist: true }));
        }, 1.6);
        const perfect = spent((world) => world.onClear(clearOf(1, { perfect: true })), 4);
        const climb = spent((world) => {
            world.lastClear.at = -1e6;
            world.levelUp(5);
        }, 2.5);
        const gap = spent((world) => world.onCombo(3), 1.5);
        expect(lock).toBeGreaterThan(0);
        expect(knock).toBeGreaterThan(lock);
        expect(single).toBeGreaterThan(0);
        expect(triple).toBeGreaterThan(single);
        expect(quad).toBeGreaterThan(triple);
        expect(twist).toBeGreaterThan(0);
        expect(perfect).toBeGreaterThan(triple);
        expect(climb).toBeGreaterThan(0);
        expect(gap).toBeGreaterThan(0);
    }, 120000);

    it('a later beat never moves a speck still in flight', () => {
        const { world, camera } = makeWorld('High');
        const { sparks } = world.parts.fx;
        step(world, camera, 1 / 30, () => world.onClear(clearOf(3)));
        run(world, camera, 0.5);
        // Every speck in flight now, by its slot.
        const live = [];
        for (let s = 0; s < sparks.count; s++) {
            const o = s * SPARK_STRIDE;
            if (sparks.data[o + 7] > 0 && world.time < sparks.data[o + 3] + sparks.data[o + 7]) {
                live.push([s, Array.from(sparks.data.subarray(o, o + SPARK_STRIDE))]);
            }
        }
        expect(live.length).toBeGreaterThan(10);
        // A busy second of play on top of it.
        for (let i = 0; i < 6; i++) {
            step(world, camera, 1 / 30, () => {
                world.onLock(lockAt(0.1 + 0.15 * i, [18, 19], { hardDrop: i % 2 === 0 }));
                if (i % 3 === 0) world.onClear(clearOf(1));
            });
            run(world, camera, 0.12);
        }
        live.forEach(([s, was]) => {
            const o = s * SPARK_STRIDE;
            const still = world.time < was[3] + was[7];
            if (still) expect(Array.from(sparks.data.subarray(o, o + SPARK_STRIDE)), `slot ${s}`).toEqual(was);
        });
        world.dispose();
    });

    it('a seek drops them all', () => {
        const { world, camera } = makeWorld('High');
        step(world, camera, 1 / 30, () => world.onClear(clearOf(4)));
        run(world, camera, 1);
        expect(world.parts.fx.sparks.liveAt(world.time)).toBeGreaterThan(0);
        world.seek(30);
        expect(world.parts.fx.sparks.liveAt(30)).toBe(0);
        expect(world.parts.fx.sparks.liveAt(31)).toBe(0);
        world.dispose();
    });
});

describe('Rainbark living: the big moments', () => {
    it('swell the beam field, most for the biggest, and it falls away again', () => {
        const peak = (beat) => {
            const { world, camera } = makeWorld('High');
            const rest = world.u.beamGain.value;
            step(world, camera, 1 / 30, () => beat(world));
            let most = 0;
            run(world, camera, 2.5, 1 / 30, () => { most = Math.max(most, world.u.beamGain.value / rest); });
            run(world, camera, 30, 1 / 10);
            const after = world.u.beamGain.value / rest;
            world.dispose();
            return { most, after };
        };
        const single = peak((world) => world.onClear(clearOf(1)));
        const triple = peak((world) => world.onClear(clearOf(3)));
        const quad = peak((world) => world.onClear(clearOf(4)));
        const b2b = peak((world) => world.onClear(clearOf(4, { b2b: true })));
        expect(triple.most).toBeGreaterThan(single.most);
        expect(quad.most).toBeGreaterThan(triple.most);
        expect(b2b.most).toBeGreaterThan(quad.most);
        // (Back to the light the clock alone gives, within the tide's own drift.)
        [single, triple, quad, b2b].forEach((p) => expect(Math.abs(p.after - 1)).toBeLessThan(0.25));
    }, 60000);

    it('the Sunshower raises its bow with the run and lets it down slowly', () => {
        const { world, camera } = makeWorld('High');
        expect(world.u.bow.value).toBe(0);
        world.onB2B(1);
        run(world, camera, 4 * BOW.rise);
        const one = world.u.bow.value;
        expect(one).toBeGreaterThan(BOW.gain[1] * 0.8);
        world.onB2B(3);
        let worst = 0;
        let before = world.u.bow.value;
        run(world, camera, 4 * BOW.rise, 1 / 30, () => {
            worst = Math.max(worst, Math.abs(world.u.bow.value - before));
            before = world.u.bow.value;
        });
        expect(world.u.bow.value).toBeGreaterThan(one);
        expect(worst).toBeLessThan(0.01);
        world.onB2B(0);
        run(world, camera, 1);
        expect(world.u.bow.value).toBeGreaterThan(0.05);
        run(world, camera, 8 * BOW.fall);
        expect(world.u.bow.value).toBeLessThan(0.01);
        // Its centre is a direction, on the shade side and under the horizon.
        const c = bowCentre();
        expect(Math.hypot(...c)).toBeCloseTo(1, 6);
        expect(c[0]).toBeLessThan(0);
        expect(c[1]).toBeLessThan(0);
        expect(c[2]).toBeLessThan(0);
        world.dispose();
    });

    it('a new level sends the lorikeets up with the walkway', () => {
        const { world, camera } = makeWorld('High');
        expect(world.u.flock.value).toBeLessThan(-1e5);
        world.lastClear.at = -1e6;
        step(world, camera, 1 / 30, () => world.levelUp(5));
        step(world, camera, 1 / 30);
        expect(world.u.flock.value).toBeCloseTo(world.climb.start, 6);
        expect(world.parts.life.birds.count).toBe(QUALITY.High.lorikeets);
        world.dispose();
    });
});

describe('Rainbark living: the foliage', () => {
    it('builds one spray from a seed: finite, indexed, leaves on twigs', () => {
        const a = sprayGeometry();
        const b = sprayGeometry();
        expect(Array.from(a.position)).toEqual(Array.from(b.position));
        expect(finite(a.position) && finite(a.normal) && finite(a.leafA) && finite(a.leafB)).toBe(true);
        const verts = a.position.length / 3;
        expect(a.leafA.length / 4).toBe(verts);
        expect(Math.max(...a.index)).toBeLessThan(verts);
        expect(a.index.length % 3).toBe(0);
        let twig = 0;
        let leaf = 0;
        let lowest = 0;
        for (let v = 0; v < verts; v++) {
            if (a.leafB[v * 4 + 3] > 0.5) twig += 1;
            else leaf += 1;
            lowest = Math.min(lowest, a.position[v * 3 + 1]);
            // Unit normals.
            expect(Math.hypot(a.normal[v * 3], a.normal[v * 3 + 1], a.normal[v * 3 + 2])).toBeCloseTo(1, 4);
        }
        expect(twig).toBeGreaterThan(8);
        expect(leaf).toBeGreaterThan(twig * 4);
        // It hangs: its leaves reach well under where it is hung from.
        expect(lowest).toBeLessThan(-0.3);
        expect(sprayGeometry(7).position).not.toEqual(a.position);
    });

    it('hangs a storey\'s sprays in the frame\'s top corners, and none goes up a storey in view on any frame', () => {
        const N = FOLIAGE.near;
        for (const quality of QUALITY_NAMES) {
            const tier = QUALITY[quality];
            const { data, near } = sprayRecords(tier.sprays, 0);
            expect(near).toBe(tier.sprays);
            let left = 0;
            let right = 0;
            for (let i = 0; i < near; i++) {
                const [across, rise, depth, scale] = data.subarray(i * SPRAY_STRIDE, i * SPRAY_STRIDE + 4);
                if (across < -N.corner[0] + 1e-6) left += 1;
                if (across > N.corner[0] - 1e-6) right += 1;
                // (Over the card only now and then, hung higher than the corners' own.)
                if (Math.abs(across) < N.corner[0] - 1e-6) expect(rise).toBeGreaterThanOrEqual(N.riseEdge - 1e-6);
                for (const aspect of [390 / 844, 3 / 4, 1, 4 / 3, 16 / 9, 21 / 9]) {
                    const [top, foot] = lensEdges(aspect);
                    const place = sprayPlace(rise, depth, scale, top, foot);
                    // When it goes up: it hangs from under the frame's foot...
                    const before = place.rise * place.depth - place.wrapAt;
                    expect(before, `${quality} ${i} at ${aspect.toFixed(2)}: under the foot`).toBeLessThan(-foot * place.depth);
                    // ...and where it lands, all of it is still over the frame's top.
                    const after = before + STOREY - scale * N.wrap.hang;
                    expect(after, `${quality} ${i} at ${aspect.toFixed(2)}: over the top`).toBeGreaterThan(top * place.depth);
                }
            }
            // Both corners framed on every tier.
            expect(left).toBeGreaterThanOrEqual(2);
            expect(right).toBeGreaterThanOrEqual(2);
        }
    });

    it('stands shoots on the boles (never on the painted faces) and tufts under the canopy, wrapped out of view', () => {
        const trunks = [
            { depth: 9, hero: true }, { depth: 24, hero: true }, { depth: 45, hero: false },
            { depth: 80, hero: false }, { depth: 130, hero: false },
        ];
        const places = [[-6, -9, 1.6], [9, -24, 1.0], [-3, -45, 0.9], [20, -80, 0.8], [-30, -130, 0.8]];
        const axisAt = (i, y, out) => {
            [out[0], out[1], out[2]] = places[i];
            return out;
        };
        const boughs = 120;
        const data = new Float32Array(boughs * SPRAY_STRIDE);
        const shoots = Math.round(boughs * FOLIAGE.shoots);
        const standAt = (camY) => {
            writeBoughs(data, 0, boughs, trunks, camY, axisAt);
            return Array.from(data);
        };
        const low = standAt(56);
        expect(finite(low)).toBe(true);
        for (let i = 0; i < boughs; i++) {
            const [x, y, negZ, scale] = low.slice(i * SPRAY_STRIDE, i * SPRAY_STRIDE + 4);
            // Which trunk it stands on: the nearest axis.
            let on = 0;
            let best = Infinity;
            places.forEach(([px, pz], k) => {
                const d = Math.hypot(x - px, -negZ - pz);
                if (d < best) {
                    best = d;
                    on = k;
                }
            });
            if (i < shoots) {
                expect(trunks[on].hero, `shoot ${i}`).toBe(false);
                // On the bark, near the eye's height (within half its trunk's period).
                expect(best).toBeLessThan(places[on][2] + FOLIAGE.shoot.out[1] + 1e-3);
                const period = Math.max(FOLIAGE.shoot.period[0], trunks[on].depth * FOLIAGE.shoot.period[1] + FOLIAGE.shoot.period[2]);
                expect(Math.abs(y - 56)).toBeLessThanOrEqual(period / 2 + 1e-6);
                // Where it would wrap it is outside the lens (the widest of the frames' edges).
                const [top, foot] = lensEdges(390 / 844);
                expect(period / 2).toBeGreaterThan(Math.max(top, foot) * trunks[on].depth * 0.5);
            } else {
                expect(scale).toBeGreaterThan(0);
                expect(y).toBeGreaterThan(172 - FOLIAGE.crown.under[1] - 1e-6);
            }
        }
        // A step of the Climb moves no shoot (it wraps only half a period away from the eye).
        const next = standAt(56.2);
        let moved = 0;
        for (let i = 0; i < shoots; i++) if (Math.abs(next[i * SPRAY_STRIDE + 1] - low[i * SPRAY_STRIDE + 1]) > 1e-6) moved += 1;
        expect(moved).toBeLessThanOrEqual(1);
        // No trunks: every bough collapsed.
        writeBoughs(data, 0, boughs, [], 56, null);
        for (let i = 0; i < boughs; i++) expect(data[i * SPRAY_STRIDE + 3]).toBe(0);
    });

    it('is in the world on every tier, and the scene never changes after it is built', () => {
        for (const quality of QUALITY_NAMES) {
            const tier = QUALITY[quality];
            const { world, camera, scene } = makeWorld(quality);
            const { foliage } = world.parts.life;
            expect(foliage.near).toBe(tier.sprays);
            expect(foliage.crown).toBe(tier.boughs);
            expect(finite(foliage.data)).toBe(true);
            let before = 0;
            scene.traverse(() => { before += 1; });
            step(world, camera, 1 / 30, () => {
                world.onLock(lockAt(0.2, [18, 19], { hardDrop: true }));
                world.onClear(clearOf(4, { b2b: true, perfect: true }));
                world.onCombo(4);
                world.onB2B(2);
                world.levelUp(5);
            });
            run(world, camera, 6, 1 / 15);
            let after = 0;
            scene.traverse(() => { after += 1; });
            expect(after).toBe(before);
            world.dispose();
        }
    }, 120000);
});

describe('Rainbark living: the lorikeets', () => {
    it('are birds: a body, a beak, a tail and two wings that beat from the shoulder and the wrist', () => {
        const bird = birdGeometry();
        expect(finite(bird.position) && finite(bird.normal) && finite(bird.part)).toBe(true);
        const verts = bird.position.length / 3;
        expect(Math.max(...bird.index)).toBeLessThan(verts);
        let wing = 0;
        const sides = new Set();
        for (let v = 0; v < verts; v++) {
            if (bird.part[v * 4] > 0.5) {
                wing += 1;
                sides.add(bird.position[v * 3 + 2]);
                expect(bird.position[v * 3 + 1]).toBeLessThanOrEqual(LORIKEET.span2 + 1e-6);
            }
        }
        expect(wing).toBe(12);
        expect([...sides].sort()).toEqual([-1, 1]);
        // The wingbeat: the tip sweeps up and down, the hand lagging the arm; the wing keeps its length.
        const up = wingAt(LORIKEET.span2, Math.PI / 2);
        const down = wingAt(LORIKEET.span2, -Math.PI / 2);
        expect(up[0]).toBeGreaterThan(0.2);
        expect(down[0]).toBeLessThan(-0.2);
        for (let beat = 0; beat < Math.PI * 2; beat += 0.1) {
            const tip = wingAt(LORIKEET.span2, beat);
            const wrist = wingAt(LORIKEET.wrist, beat);
            expect(Math.hypot(wrist[0], wrist[1])).toBeCloseTo(LORIKEET.wrist, 6);
            expect(Math.hypot(tip[0] - wrist[0], tip[1] - wrist[1])).toBeCloseTo(LORIKEET.span2 - LORIKEET.wrist, 6);
        }
        // Every bird's start up the Climb's lanes fits inside the Climb's own time.
        expect(LORIKEET.climb.stagger * QUALITY.Extreme.lorikeets).toBeLessThan(LORIKEET.climb.time);
        expect(SPARKS.drag).toBeGreaterThan(0);
    });
});
