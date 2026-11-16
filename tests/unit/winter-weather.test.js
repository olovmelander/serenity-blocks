/**
 * Winter — what the night does by itself, and what play adds to it since the events pass
 * (winter-weather.js; how winter-world.js spends it; the parts in winter-meteors.js,
 * winter-devil.js and winter-mist.js).
 *
 * The weather and the aurora's form each turn by their own clock beside the hours; small things
 * happen now and then on their own; a twist raises a snow devil and winds the fires into a spiral,
 * a perfect clear breaks them up into a corona and stands pillars along the far land, a new level
 * sends a shower of shooting stars, and when the run ends the night closes in. Timings and
 * tables are read from the modules, never copied.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { WinterWorld } from '../../src/themes/winter/winter-world.js';
import { planGhosts } from '../../src/themes/winter/winter-ghosts.js';
import {
    HOURS, HOUR_PERIOD, REST_RIG, pieceColor,
} from '../../src/themes/winter/winter-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/winter/winter-quality.js';
import { DEVIL_HEIGHT, DEVIL_LASTS, devilAxis } from '../../src/themes/winter/winter-devil.js';
import { METEOR_POOL, meteorRun } from '../../src/themes/winter/winter-meteors.js';
import { MIST_BANKS } from '../../src/themes/winter/winter-mist.js';
import {
    AURORA_FORMS, FORM_KEYS, FORM_PERIOD, FORM_REST, NowAndThen, SNOW_HEADROOM, WEATHERS, WEATHER_KEYS, WEATHER_PERIOD,
    WEATHER_REST, auroraSwell, clockDrift, formAt, formDrift, formName, weatherAt, weatherDrift, weatherName,
} from '../../src/themes/winter/winter-weather.js';

const ghosts = planGhosts();

function makeWorld(quality = 'High', [width, height] = [1600, 900]) {
    const scene = new THREE.Scene();
    const world = new WinterWorld({
        scene, quality, capture: true, ghosts, fox: false, bear: false,
    }).build();
    const camera = new THREE.PerspectiveCamera(50, width / height, REST_RIG.near, REST_RIG.far);
    world.bindCamera(camera);
    world.setViewport(width, height, width / height);
    world.updateCamera(camera, { time: 0, delta: 0 });
    world.update({ time: 0, delta: 0 }, camera);
    return { world, camera };
}

const frame = (world, camera, time, delta) => {
    world.updateCamera(camera, { time, delta });
    world.update({ time, delta }, camera);
};
const step = (world, camera, from, to, dt = 1 / 30) => {
    const steps = Math.max(1, Math.round((to - from) / dt));
    const h = (to - from) / steps;
    for (let i = 1; i <= steps; i++) frame(world, camera, from + i * h, h);
};

describe('winter weather: the clocks', () => {
    it('rests on a step, then melts into the next, a period at a time', () => {
        for (const [period, rest] of [[WEATHER_PERIOD, WEATHER_REST], [FORM_PERIOD, FORM_REST], [50, 0.5]]) {
            for (let k = 0; k < 7; k++) {
                expect(clockDrift(k * period, period, rest)).toBe(k);
                expect(clockDrift((k + rest * 0.5) * period, period, rest)).toBe(k);
                expect(clockDrift((k + rest + (1 - rest) * 0.5) * period, period, rest)).toBeCloseTo(k + 0.5, 9);
            }
        }
        expect(weatherDrift(WEATHER_PERIOD * 3)).toBe(3);
        expect(formDrift(FORM_PERIOD * 4)).toBe(4);
    });

    it('never runs backward and never jumps, and takes nonsense as the start', () => {
        let before = 0;
        for (let t = 0; t < WEATHER_PERIOD * (WEATHERS.length + 1); t += 0.25) {
            const now = weatherDrift(t);
            expect(now).toBeGreaterThanOrEqual(before);
            expect(now - before).toBeLessThan(0.03);
            before = now;
        }
        for (const bad of [-3, NaN, undefined, null, Infinity]) {
            expect(weatherDrift(bad)).toBe(0);
            expect(formDrift(bad)).toBe(0);
        }
    });

    it('opens on the look the theme has always had, and comes round', () => {
        // Mood 0 is the theme's own snowfall and its bands with rays: a player who never waits
        // sees what they always saw.
        expect(WEATHERS[0].name).toBe('snowfall');
        expect(WEATHERS[0].snow).toBe(1);
        expect(WEATHERS[0].flake).toBe(1);
        expect(WEATHERS[0].wind).toBe(1);
        expect(AURORA_FORMS[0].name).toBe('bands');
        expect(AURORA_FORMS[0].folds).toBe(1);
        expect(AURORA_FORMS[0].tall).toBe(1);
        expect(AURORA_FORMS[0].hem).toBe(1);
        expect(AURORA_FORMS[0].gain).toBe(1);
        expect(AURORA_FORMS[0].corona).toBe(0);
        expect(AURORA_FORMS[0].pulse).toBe(0);
        WEATHERS.forEach((weather, i) => {
            for (const phase of [i, i + WEATHERS.length, i - WEATHERS.length]) {
                const at = weatherAt(phase);
                WEATHER_KEYS.forEach((key) => expect(at[key], `${weather.name} ${key}`).toBeCloseTo(weather[key], 12));
                expect(weatherName(phase)).toBe(weather.name);
            }
        });
        AURORA_FORMS.forEach((form, i) => {
            const at = formAt(i + AURORA_FORMS.length * 3);
            FORM_KEYS.forEach((key) => expect(at[key], `${form.name} ${key}`).toBeCloseTo(form[key], 12));
            expect(formName(i)).toBe(form.name);
        });
        // Half-way between two it is half of each.
        const half = weatherAt(1.5);
        WEATHER_KEYS.forEach((key) => expect(half[key]).toBeCloseTo((WEATHERS[1][key] + WEATHERS[2][key]) / 2, 12));
    });

    it('gives every weather and every form a look of its own', () => {
        // No two rows alike in what the eye reads first.
        const apart = (a, b, keys) => Math.max(...keys.map((key) => Math.abs(a[key] - b[key])));
        for (let i = 0; i < WEATHERS.length; i++) {
            for (let k = i + 1; k < WEATHERS.length; k++) {
                expect(apart(WEATHERS[i], WEATHERS[k], WEATHER_KEYS), `${WEATHERS[i].name} / ${WEATHERS[k].name}`).toBeGreaterThan(0.3);
            }
        }
        for (let i = 0; i < AURORA_FORMS.length; i++) {
            for (let k = i + 1; k < AURORA_FORMS.length; k++) {
                expect(apart(AURORA_FORMS[i], AURORA_FORMS[k], FORM_KEYS), `${AURORA_FORMS[i].name} / ${AURORA_FORMS[k].name}`).toBeGreaterThan(0.3);
            }
        }
        // A flurry is the only weather that asks for more than the theme's own snowfall, and the
        // pool holds it.
        WEATHERS.forEach((weather) => expect(weather.snow).toBeLessThanOrEqual(SNOW_HEADROOM));
        expect(Math.max(...WEATHERS.map((weather) => weather.snow))).toBe(SNOW_HEADROOM);
        // The corona stands by itself in one form only; patches pulse in one only.
        expect(AURORA_FORMS.filter((form) => form.corona > 0.3).map((form) => form.name)).toEqual(['corona']);
        expect(AURORA_FORMS.filter((form) => form.pulse > 0.5).map((form) => form.name)).toEqual(['pulsing']);
    });

    it('keeps the three clocks out of step: the same hour meets another weather and another form', () => {
        const day = HOURS.length * HOUR_PERIOD;
        const weathers = WEATHERS.length * WEATHER_PERIOD;
        const forms = AURORA_FORMS.length * FORM_PERIOD;
        expect(new Set([day, weathers, forms]).size).toBe(3);
        // Each time the first hour comes round (for an hour of play), what stands with it.
        const met = new Set();
        for (let round = 0; round * day < 3600; round++) {
            const t = round * day + HOUR_PERIOD * 0.1;
            met.add(`${weatherName(weatherDrift(t))} + ${formName(formDrift(t))}`);
        }
        expect(met.size).toBeGreaterThanOrEqual(6);
        // All three are back at their starts together only after more than an hour.
        const gcd = (a, b) => (b ? gcd(b, a % b) : a);
        const lcm = (a, b) => (a * b) / gcd(a, b);
        expect(lcm(lcm(day, weathers), forms)).toBeGreaterThan(3600);
    });

    it('lets the display breathe at rest, within bounds, never the same swell twice running', () => {
        let lo = Infinity;
        let hi = -Infinity;
        let sum = 0;
        let n = 0;
        for (let t = 0; t < 3600; t += 0.5) {
            const s = auroraSwell(t);
            lo = Math.min(lo, s);
            hi = Math.max(hi, s);
            sum += s;
            n += 1;
        }
        expect(lo).toBeGreaterThan(0.45);
        expect(hi).toBeLessThan(1.6);
        expect(hi - lo).toBeGreaterThan(0.6);
        expect(sum / n).toBeCloseTo(1, 1);
        expect(auroraSwell(NaN)).toBe(auroraSwell(0));
    });
});

describe('winter weather: now and then', () => {
    it('deals its moments from the seed by their number: the same stream every time', () => {
        const a = new NowAndThen(0x57a2, 13, 52, 7);
        const b = new NowAndThen(0x57a2, 13, 52, 7);
        const other = new NowAndThen(0x57a3, 13, 52, 7);
        const read = (stream, until) => {
            const out = [];
            for (let t = 0; t <= until; t += 1 / 30) {
                for (let roll = stream.due(t); roll; roll = stream.due(t)) out.push([stream.at, ...roll]);
            }
            return out;
        };
        const first = read(a, 900);
        expect(read(b, 900)).toEqual(first);
        expect(read(other, 900)).not.toEqual(first);
        // Uneven gaps inside the bounds, and none before the first may fall.
        expect(first.length).toBeGreaterThan(900 / 52);
        expect(first.length).toBeLessThan(900 / 13 + 1);
        expect(first[0][0]).toBeGreaterThanOrEqual(7 + 13);
        for (let i = 1; i < first.length; i++) {
            const gap = first[i][0] - first[i - 1][0];
            expect(gap).toBeGreaterThanOrEqual(13 - 1e-9);
            expect(gap).toBeLessThanOrEqual(52 + 1e-9);
            first[i].slice(1).forEach((roll) => {
                expect(roll).toBeGreaterThanOrEqual(0);
                expect(roll).toBeLessThan(1);
            });
        }
        expect(new Set(first.map((row) => row[0].toFixed(3))).size).toBe(first.length);
    });

    it('finds the same next moment after a seek as by walking there', () => {
        const walked = new NowAndThen(0x10ad, 22, 76, 15);
        for (let t = 0; t <= 400; t += 0.1) while (walked.due(t)) { /* walk past every one */ }
        const sought = new NowAndThen(0x10ad, 22, 76, 15);
        sought.seek(400);
        expect(sought.next).toBeCloseTo(walked.next, 9);
        expect(sought.index).toBe(walked.index);
        // Nothing fires on the seek itself, and what was due before it is not owed after.
        expect(sought.due(400)).toBeNull();
        expect(sought.due(sought.next)).not.toBeNull();
    });
});

describe('WinterWorld: the weather', () => {
    it('stands the sky, the air and the snowfall on the weather its clock has reached', () => {
        const { world, camera } = makeWorld();
        const seen = {};
        WEATHERS.forEach((weather, i) => {
            world.holdWeather(i);
            step(world, camera, world.time, world.time + 0.5);
            const { u } = world;
            seen[weather.name] = {
                snow: u.weather.value.x,
                veil: u.weather.value.y,
                mist: u.weather.value.z,
                dust: u.weather.value.w,
                flake: u.weather2.value.x,
                gale: u.gale.value,
                halo: u.halo.value,
                lake: u.air.value.x,
                haze: u.air.value.y,
            };
            expect(world.getState().weather).toBe(weather.name);
            expect(u.weather.value.x).toBeCloseTo(weather.snow / SNOW_HEADROOM, 6);
            expect(u.weather.value.y).toBeCloseTo(weather.veil, 6);
            expect(u.weather2.value.x).toBeCloseTo(weather.flake, 6);
        });
        // A flurry fills the pool and blows hardest; a clear night has almost no snow in the air.
        expect(seen.flurry.snow).toBe(1);
        expect(seen.clear.snow).toBeLessThan(0.1);
        expect(seen.flurry.gale).toBeGreaterThan(seen.snowfall.gale * 1.8);
        expect(seen['soft-flakes'].gale).toBeLessThan(seen.snowfall.gale * 0.5);
        expect(seen['soft-flakes'].flake).toBeGreaterThan(seen.snowfall.flake * 1.3);
        // Ice in the air is what rings the moon: the ring stands in the ice haze and is all but
        // gone on a clear night. The mist lies thickest then too.
        expect(seen['ice-haze'].halo).toBeGreaterThan(seen.clear.halo * 4);
        expect(seen['ice-haze'].lake).toBeGreaterThan(seen.clear.lake * 2);
        expect(seen['ice-haze'].dust).toBe(1);
        // The air is never thick enough to hide the far shore: under a twentieth lost over 235 m.
        Object.values(seen).forEach((air) => expect(air.haze * 235).toBeLessThan(0.2));
        // Given back to its clock, it is the clock's weather again.
        world.holdWeather(null);
        step(world, camera, world.time, world.time + 0.1);
        expect(world.getState().weather).toBe(weatherName(weatherDrift(world.time)));
        world.dispose();
    });

    it('gives the fires the form their clock has reached, and lets play bend it', () => {
        const { world, camera } = makeWorld();
        const read = () => ({ ...Object.fromEntries(['x', 'y', 'z', 'w'].map((k) => [k, world.u.form.value[k]])), corona: world.u.form2.value.x, pulse: world.u.form2.value.y });
        world.holdForm(AURORA_FORMS.findIndex((form) => form.name === 'arcs'));
        step(world, camera, 0, 1);
        const arcs = read();
        world.holdForm(AURORA_FORMS.findIndex((form) => form.name === 'curtains'));
        step(world, camera, 1, 2);
        const curtains = read();
        world.holdForm(AURORA_FORMS.findIndex((form) => form.name === 'pulsing'));
        step(world, camera, 2, 3);
        const pulsing = read();
        expect(world.getState().form).toBe('pulsing');
        // Arcs are smooth and shallow; curtains fold deep with a bright hem; patches pulse.
        expect(arcs.x).toBeLessThan(0.2);
        expect(curtains.y).toBeGreaterThan(arcs.y * 3);
        expect(curtains.w).toBeGreaterThan(arcs.w);
        expect(pulsing.pulse).toBeGreaterThan(0.8);
        expect(arcs.pulse).toBe(0);
        // A chain makes any form more rayed and taller, and stills the pulsing: the patches
        // pulse only while the night is quiet.
        world.onCombo(9);
        step(world, camera, 3, 12);
        const lit = read();
        expect(lit.x).toBeGreaterThan(pulsing.x);
        expect(lit.z).toBeGreaterThan(pulsing.z);
        expect(lit.pulse).toBeLessThan(pulsing.pulse * 0.5);
        world.dispose();
    });

    it('is the same night after a seek as after playing there, at any frame rate', () => {
        const state = (world) => ({
            weather: world.u.weather.value.toArray(),
            weather2: world.u.weather2.value.toArray(),
            form: world.u.form.value.toArray(),
            form2: world.u.form2.value.toArray(),
            air: world.u.air.value.toArray(),
            stars: world.sometimes.star.next,
            loads: world.sometimes.load.next,
            gusts: world.sometimes.gust.next,
        });
        const at = WEATHER_PERIOD * 1.7;
        const sought = makeWorld();
        sought.world.seek(at);
        frame(sought.world, sought.camera, at, 0);
        const slow = makeWorld();
        step(slow.world, slow.camera, 0, at, 1 / 12);
        const fast = makeWorld();
        step(fast.world, fast.camera, 0, at, 1 / 60);
        const want = state(sought.world);
        for (const run of [slow, fast]) {
            const got = state(run.world);
            Object.keys(want).forEach((key) => {
                [want[key]].flat().forEach((value, i) => expect([got[key]].flat()[i], key).toBeCloseTo(value, 6));
            });
        }
        [sought, slow, fast].forEach((run) => run.world.dispose());
    });

    it('has things happen by themselves: shooting stars, a bough\'s load let go', () => {
        const { world, camera } = makeWorld();
        let loads = 0;
        const { emit } = world.sparks;
        world.sparks.emit = (options) => {
            // (A load coming down is powder thrown from a tree's top.)
            if (options.powder && options.from[1] > 3) loads += 1;
            return emit(options);
        };
        step(world, camera, 0, 300, 1 / 15);
        // In five minutes: several of each, and never a rain of them.
        expect(world.counts.meteors).toBeGreaterThanOrEqual(4);
        expect(world.counts.meteors).toBeLessThanOrEqual(30);
        expect(world.meteors.thrown).toBe(world.counts.meteors);
        expect(loads).toBeGreaterThanOrEqual(3);
        expect(loads).toBeLessThanOrEqual(16);
        world.dispose();
    });

    it('builds the new parts at every tier, within their pools', () => {
        QUALITY_NAMES.forEach((quality) => {
            const { world } = makeWorld(quality);
            const tier = QUALITY[quality];
            expect(world.parts.meteors.count, quality).toBe(METEOR_POOL);
            expect(world.parts.devil.count, quality).toBe(tier.devil);
            expect(world.parts.mist.count, quality).toBe(Math.min(tier.mist, MIST_BANKS.length));
            expect(tier.mist, quality).toBeGreaterThanOrEqual(1);
            world.dispose();
        });
        // Richer tiers never have less.
        for (let i = 1; i < QUALITY_NAMES.length; i++) {
            const lean = QUALITY[QUALITY_NAMES[i - 1]];
            const rich = QUALITY[QUALITY_NAMES[i]];
            expect(rich.devil).toBeGreaterThanOrEqual(lean.devil);
            expect(rich.mist).toBeGreaterThanOrEqual(lean.mist);
            expect(Number(rich.galaxy)).toBeGreaterThanOrEqual(Number(lean.galaxy));
            expect(Number(rich.lumps)).toBeGreaterThanOrEqual(Number(lean.lumps));
        }
    });
});

describe('WinterWorld: what each event alone does', () => {
    it('raises a snow devil on the piece\'s side and winds the fires into a spiral, in its colour', () => {
        for (const [u, side] of [[0.15, -1], [0.85, 1]]) {
            const { world, camera } = makeWorld();
            step(world, camera, 0, 1);
            world.onLock({ rows: [19, 18], u, color: '#ff9ccf' });
            world.onClear({ rows: [19, 18], lines: 2, twist: true });
            const { at, go, color } = world.devil.uniforms;
            // It stands on the snow beside the board, on the side the piece went in, clear of the
            // board's own middle, and walks off outward.
            expect(Math.sign(at.value.x)).toBe(side);
            expect(Math.abs(at.value.x)).toBeGreaterThan(1);
            expect(at.value.y).toBeLessThan(-3);
            expect(at.value.z).toBe(world.time);
            expect(at.value.w).toBeGreaterThan(0.8);
            expect(Math.sign(go.value.x)).toBe(side);
            const rgb = pieceColor('#ff9ccf');
            expect(color.value.toArray()).toEqual(rgb.map((c) => expect.closeTo(c, 6)));
            // The spiral opens in the sky over the same side, well above the horizon.
            const swirl = world.u.swirlA.value;
            expect(Math.sign(swirl.x)).toBe(side);
            expect(swirl.y).toBeGreaterThan(0.2);
            expect(swirl.z).toBe(world.time);
            expect(swirl.w).toBeGreaterThan(0.8);
            expect(world.counts.devils).toBe(1);
            world.dispose();
        }
    });

    it('answers a twist that cleared nothing with a smaller whirl', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        world.onLock({ rows: [19, 18], u: 0.8, color: '#6de0ff' });
        world.onSpin();
        expect(world.counts.devils).toBe(1);
        expect(world.devil.uniforms.at.value.w).toBeGreaterThan(0);
        expect(world.devil.uniforms.at.value.w).toBeLessThan(0.8);
        expect(world.u.swirlA.value.w).toBeLessThan(0.8);
        world.dispose();
    });

    it('leaves the turning funnel out under reduced motion, and still winds the sky', () => {
        const { world, camera } = makeWorld();
        world.setReducedMotion(true);
        step(world, camera, 0, 1);
        world.onLock({ rows: [19, 18], u: 0.2, color: '#b79bff' });
        world.onClear({ rows: [19, 18], lines: 2, twist: true });
        expect(world.devil.uniforms.at.value.w).toBe(0);
        expect(world.u.swirlA.value.w).toBeGreaterThan(0.8);
        world.dispose();
    });

    it('walks the snow devil\'s funnel from its foot to its top, leaning as it climbs', () => {
        const foot = devilAxis(0, 1, [0.85, -0.4]);
        const top = devilAxis(1, 1, [0.85, -0.4]);
        expect(foot[1]).toBe(0);
        expect(top[1]).toBeCloseTo(DEVIL_HEIGHT, 9);
        // It has walked on by then, and its top leans downwind of its foot.
        expect(foot[0]).toBeCloseTo(0.85, 9);
        expect(foot[2]).toBeCloseTo(-0.4, 9);
        expect(top[0]).toBeGreaterThan(foot[0]);
        expect(DEVIL_LASTS).toBeGreaterThan(2);
        expect(DEVIL_LASTS).toBeLessThan(8);
    });

    it('breaks the fires up into a corona and stands pillars along the far land on a perfect clear', () => {
        const { world, camera } = makeWorld();
        world.holdForm(0);
        step(world, camera, 0, 2);
        expect(world.u.form2.value.x).toBeLessThan(0.05);
        expect(world.u.pillars.value.x).toBe(0);
        // As the game sends it: the clear, then the crown that settles a moment after it.
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        step(world, camera, 2, 2.36);
        const four = world.u.form2.value.x;
        world.onClear({ crown: true });
        step(world, camera, 2.36, 4);
        // A four alone lights no corona: that is the perfect clear's own.
        expect(four).toBeLessThan(0.05);
        expect(world.u.form2.value.x).toBeGreaterThan(0.6);
        expect(world.u.pillars.value.x).toBeGreaterThan(0.5);
        // The pillars stand up one after another: the row is still rising a second and a half in.
        expect(world.u.pillars.value.y).toBeGreaterThan(0.5);
        expect(world.u.pillars.value.y).toBeLessThan(1.2);
        // It passes: a quarter of a minute later the sky is the night's own again.
        step(world, camera, 4, 40);
        expect(world.u.form2.value.x).toBeLessThan(0.05);
        expect(world.u.pillars.value.x).toBeLessThan(0.02);
        world.dispose();
    });

    it('lights the same crown when the perfect clear is told in the clear\'s own frame', () => {
        const { world, camera } = makeWorld();
        world.holdForm(0);
        step(world, camera, 0, 2);
        world.onClear({ rows: [19], lines: 1, perfect: true });
        step(world, camera, 2, 4);
        expect(world.u.form2.value.x).toBeGreaterThan(0.6);
        expect(world.u.pillars.value.x).toBeGreaterThan(0.5);
        world.dispose();
    });

    it('sends a shower of shooting stars out of one point on a new level', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        const before = world.counts.meteors;
        world.levelUp(2);
        expect(world.counts.meteors - before).toBe(9);
        const from = world.meteors.geometry.getAttribute('aFrom').array;
        const look = world.meteors.geometry.getAttribute('aLook').array;
        const thrown = [];
        for (let i = 0; i < METEOR_POOL; i++) {
            if (from[i * 4 + 3] >= world.time) {
                thrown.push({
                    dir: [...from.slice(i * 4, i * 4 + 3)], at: from[i * 4 + 3], lasts: look[i * 4], bright: look[i * 4 + 1],
                });
            }
        }
        expect(thrown).toHaveLength(9);
        // They fall over two or three seconds, not all at once, each a visible streak.
        const times = thrown.map((row) => row.at).sort((a, b) => a - b);
        expect(times[8] - times[0]).toBeGreaterThan(1.5);
        expect(times[8] - times[0]).toBeLessThan(3.5);
        thrown.forEach((row) => {
            expect(Math.hypot(...row.dir)).toBeCloseTo(1, 5);
            // In the sky ahead, over one side of the frame (the board has the middle).
            expect(row.dir[2]).toBeLessThan(0);
            expect(row.dir[1]).toBeGreaterThan(0.05);
            expect(row.lasts).toBeGreaterThan(0.5);
            expect(row.bright).toBeGreaterThan(1);
        });
        expect(new Set(thrown.map((row) => Math.sign(row.dir[0]))).size).toBe(1);
        // The next level's falls on the other side.
        world.levelUp(3);
        const next = [];
        for (let i = 0; i < METEOR_POOL; i++) next.push(from[i * 4]);
        expect(next.some((x) => Math.sign(x) !== Math.sign(thrown[0].dir[0]))).toBe(true);
        world.dispose();
    });

    it('runs a shooting star out along its arc fast and slows it, never past its end', () => {
        expect(meteorRun(0)).toBe(0);
        expect(meteorRun(1)).toBe(1);
        expect(meteorRun(2)).toBe(1);
        expect(meteorRun(-1)).toBe(0);
        expect(meteorRun(0.5)).toBeGreaterThan(0.5);
        for (let k = 0.05; k <= 1; k += 0.05) expect(meteorRun(k)).toBeGreaterThan(meteorRun(k - 0.05));
    });

    it('gives a hard drop a second, tighter ring inside the first', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        world.onLock({ rows: [19, 18], u: 0.3, color: '#5df2a6' });
        const soft = world.u.ringA.filter((ring) => ring.value.w > 0).length;
        world.resetState(world.time);
        world.onLock({
            rows: [19, 18], u: 0.3, color: '#5df2a6', hardDrop: true,
        });
        const rings = world.u.ringA.map((ring, i) => ({ at: ring.value.z, strength: ring.value.w, reach: world.u.ringC[i].value.w }))
            .filter((ring) => ring.strength > 0).sort((a, b) => a.at - b.at);
        expect(soft).toBe(1);
        expect(rings).toHaveLength(2);
        expect(rings[1].at).toBeGreaterThan(rings[0].at);
        expect(rings[1].at - rings[0].at).toBeLessThan(0.4);
        expect(rings[1].reach).toBeLessThan(rings[0].reach);
        world.dispose();
    });

    it('closes the night in when the run ends, and opens it again for the next', () => {
        const { world, camera } = makeWorld();
        world.holdWeather(WEATHERS.findIndex((weather) => weather.name === 'clear'));
        step(world, camera, 0, 3);
        const open = {
            snow: world.u.weather.value.x, veil: world.u.weather.value.y, gale: world.u.gale.value, fires: world.getState().curtains[0],
        };
        world.onGameOver();
        // Nothing jumps: a breath later the night has barely begun to close.
        step(world, camera, 3, 3.1);
        expect(world.u.weather.value.x - open.snow).toBeLessThan(0.1);
        step(world, camera, 3.1, 20);
        // Then the snow falls thick, cloud draws over, the wind dies and the fires sink.
        expect(world.getState().closing).toBeGreaterThan(0.95);
        expect(world.u.weather.value.x).toBeGreaterThan(open.snow * 4);
        expect(world.u.weather.value.y).toBeGreaterThan(open.veil + 0.5);
        expect(world.u.gale.value).toBeLessThan(open.gale);
        expect(world.getState().curtains[0]).toBeLessThan(open.fires);
        // A new run: it opens again from where it stands, without a jump.
        world.resetSession();
        expect(world.getState().closing).toBeGreaterThan(0.95);
        step(world, camera, 20, 20.1);
        expect(world.getState().closing).toBeGreaterThan(0.9);
        step(world, camera, 20.1, 40);
        expect(world.getState().closing).toBeLessThan(0.05);
        expect(world.u.weather.value.x).toBeCloseTo(open.snow, 2);
        world.dispose();
    });
});
