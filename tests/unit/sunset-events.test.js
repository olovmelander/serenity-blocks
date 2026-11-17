/**
 * Sunset — what each play does to the sea and the sky, and what the world does by itself: the
 * world built for real in Node (no renderer), stepped like the game steps it.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { NIGHT_BOATS, RELEASE, SunsetWorld } from '../../src/themes/sunset/sunset-world.js';
import { fallbackLayout } from '../../src/themes/sunset/sunset-composition.js';
import { WAVE_LIFE, WHIRL_LIFE, waveReach } from '../../src/themes/sunset/sunset-sea.js';
import { METEOR_TRAIL, createMeteors, meteorAt } from '../../src/themes/sunset/sunset-meteors.js';
import { SKY_PERIOD } from '../../src/themes/sunset/sunset-weather.js';
import {
    DAY_SECONDS, HOUR_COLOURS, MOON_PHASE, MOON_PHASES, MOON_TURN_SECONDS, NOON_WHEEL, dayHourAt, moonHeightAt,
    moonLit, moonPhaseAt,
} from '../../src/themes/sunset/sunset-hours.js';
import {
    SWELL, seaHeight, seaMeshHeight, seaRingGap,
} from '../../src/themes/sunset/sunset-core.js';

const W = 1600;
const H = 852;

function makeWorld(options = {}) {
    const scene = new THREE.Scene();
    const world = new SunsetWorld({ scene, quality: 'Low', ...options }).build();
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.25, 40000);
    world.bindCamera(camera);
    world.setLayout(fallbackLayout(W, H), W / H);
    world.setViewport(W, H, W / H);
    world.seek(options.start ?? 10);
    let t = world.clock;
    const step = (seconds, dt = 1 / 30) => {
        const n = Math.round(seconds / dt);
        for (let i = 0; i < n; i += 1) {
            t += dt;
            const sim = {
                time: t, delta: dt, pointerX: 0, pointerY: 0,
            };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
        }
    };
    step(0.5);
    return { world, camera, step };
}

const lockSome = (world, step, n) => {
    for (let i = 0; i < n; i += 1) {
        world.onLock({ rows: [19 - (i % 6)], u: ((i * 0.37) % 1) * 0.9 + 0.05, color: '#ff4d8f' });
        step(0.2);
    }
    step(1);
};
const waveRow = (world, i) => [world.waveRows[i * 2], world.waveRows[i * 2 + 1]];

describe('sunset events: the wave of light a clear sends over the sea', () => {
    it('runs out from under the board to the far sea, gathering speed, and is gone', () => {
        expect(waveReach(0)).toBe(0);
        let last = 0;
        for (let s = 0.1; s <= WAVE_LIFE; s += 0.1) {
            const reach = waveReach(s);
            expect(reach).toBeGreaterThan(last);
            last = reach;
        }
        expect(waveReach(1)).toBeLessThan(25);
        expect(waveReach(WAVE_LIFE)).toBeGreaterThan(900);
        expect(waveReach(WAVE_LIFE + 5)).toBe(waveReach(WAVE_LIFE));

        const { world, step } = makeWorld({ hour: 17 });
        lockSome(world, step, 4);
        world.onClear({ rows: [19], lines: 1 });
        step(0.1);
        expect(world.getState().waves).toBe(1);
        const [at, tint] = waveRow(world, 0);
        // It starts on the near sea, in front of the eye, and it is a wave, not a whirl.
        expect(Math.hypot(at.x, at.y)).toBeLessThan(31);
        expect(at.y).toBeLessThan(0);
        expect(tint.w).toBe(0);
        expect(world.U.counts.value.y).toBe(1);
        step(WAVE_LIFE + 0.2);
        expect(world.getState().waves).toBe(0);
        world.dispose();
    });

    it('is stronger for more lines and for a chain, and a back-to-back sends two', () => {
        const strength = (clear, combo = 0) => {
            const { world, step } = makeWorld({ hour: 17 });
            lockSome(world, step, 4);
            world.onCombo(combo);
            world.onClear(clear);
            step(0.1);
            const out = { n: world.getState().waves, w: waveRow(world, 0)[0].w };
            world.dispose();
            return out;
        };
        const one = strength({ rows: [19], lines: 1 });
        const three = strength({ rows: [19, 18, 17], lines: 3 });
        expect(three.w).toBeGreaterThan(one.w * 1.4);
        expect(strength({ rows: [19], lines: 1 }, 6).w).toBeGreaterThan(one.w * 1.3);
        expect(one.n).toBe(1);
        expect(strength({ rows: [19, 18], lines: 2, b2b: true }).n).toBe(2);
        // Four lines send a second wave on the heels of the first by themselves.
        expect(strength({ rows: [19, 18, 17, 16], lines: 4 }).n).toBe(2);
    });

    it('takes the hour: gold toward sunset, near white under a high sun, the sea\'s cold fire by night', () => {
        const tintAt = (hour) => {
            const { world } = makeWorld({ hour });
            const rgb = [...world.waveLight()];
            const fire = world.U.seaFire.value;
            world.dispose();
            return { rgb, fire };
        };
        const noon = tintAt(12);
        const dusk = tintAt(18);
        const night = tintAt(0);
        expect(noon.rgb[2]).toBeGreaterThan(dusk.rgb[2] + 0.2);
        expect(dusk.rgb[0]).toBeGreaterThan(dusk.rgb[2] * 1.8);
        expect(night.rgb[2]).toBeGreaterThan(night.rgb[0] * 4);
        expect(noon.fire).toBe(0);
        expect(night.fire).toBe(1);
    });

    it('never overflows its table: the one with least left makes room', () => {
        const { world, step } = makeWorld({ hour: 17 });
        for (let i = 0; i < 9; i += 1) {
            world.onClear({ rows: [19], lines: 1 });
            step(0.15);
        }
        expect(world.getState().waves).toBe(world.waveRows.length / 2);
        world.dispose();
    });
});

describe('sunset events: a twist', () => {
    it('winds a whirl of light round where its lantern rose, in its colour, turning its way', () => {
        const { world, step } = makeWorld({ hour: 17 });
        lockSome(world, step, 5);
        world.onClear({ rows: [19, 18], lines: 2, twist: true });
        step(0.1);
        const rows = [0, 1].map((i) => waveRow(world, i));
        const whirl = rows.find(([, tint]) => tint.w !== 0);
        const wave = rows.find(([, tint]) => tint.w === 0);
        expect(whirl).toBeTruthy();
        expect(wave).toBeTruthy();
        expect(Math.abs(whirl[1].w)).toBe(1);
        // The lantern's own colour (the piece's, magenta), not the hour's gold.
        expect(whirl[1].z).toBeGreaterThan(whirl[1].y);
        step(WAVE_LIFE + 0.3);
        expect(world.getState().waves).toBe(1);
        step(WHIRL_LIFE - WAVE_LIFE + 0.3);
        expect(world.getState().waves).toBe(0);
        world.dispose();
    });

    it('that clears nothing still turns the water, with or without a lantern afloat', () => {
        const { world, step } = makeWorld({ hour: 17 });
        world.onSpin();
        step(0.1);
        expect(world.getState().waves).toBe(1);
        expect(waveRow(world, 0)[1].w).not.toBe(0);
        world.dispose();
    });
});

describe('sunset events: the ladder from one line to the crown', () => {
    it('stands a pillar of light from three lines up, and throws the rays wide for four', () => {
        const after = (clear) => {
            const { world, step } = makeWorld({ hour: 18 });
            lockSome(world, step, 6);
            world.onClear(clear);
            step(0.6);
            const s = world.getState();
            world.dispose();
            return s;
        };
        const two = after({ rows: [19, 18], lines: 2 });
        const three = after({ rows: [19, 18, 17], lines: 3 });
        const four = after({ rows: [19, 18, 17, 16], lines: 4 });
        expect(two.pillar).toBeLessThan(0.02);
        expect(three.pillar).toBeGreaterThan(0.3);
        expect(four.pillar).toBeGreaterThan(three.pillar);
        expect(two.rayBurst).toBeLessThan(0.02);
        expect(four.rayBurst).toBeGreaterThan(0.5);
        expect(two.releases).toBe(0);
        expect(four.releases).toBe(1);
    });

    it('answers four lines from the far shore: lanterns rise all along the horizon and drift away', () => {
        const { world, step } = makeWorld({ hour: 18 });
        step(0.5);
        const before = world.parts.glows.count;
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        step(5);
        const risen = world.parts.glows.count - before;
        expect(risen).toBeGreaterThan(world.tier.release * 0.35);
        expect(risen).toBeLessThanOrEqual(world.tier.release);
        // Each is out on the sea beyond the lanterns the board sets down, and climbing.
        const batch = world.releases.find((b) => b.n > 0);
        for (let i = 0; i < batch.n; i += 1) {
            const far = Math.hypot(batch.rows[i * 8], batch.rows[i * 8 + 1]);
            expect(far).toBeGreaterThanOrEqual(RELEASE.range[0] - 1e-3);
            expect(far).toBeLessThanOrEqual(RELEASE.range[1] + 1e-3);
            expect(batch.rows[i * 8 + 3]).toBeGreaterThanOrEqual(RELEASE.rise[0]);
        }
        expect(world.getState().horizonGlow).toBeGreaterThan(0.01);
        step(RELEASE.life + RELEASE.ripple + 2);
        expect(world.parts.glows.count).toBeLessThanOrEqual(before + 2);
        world.dispose();
    });

    it('crowns a perfect clear with more of them, and by night with a shower of shooting stars', () => {
        const crown = (hour) => {
            const { world, step } = makeWorld({ hour, weather: 'clear' });
            lockSome(world, step, 6);
            world.onClear({ rows: [19, 18, 17, 16], lines: 4, perfect: true });
            step(1.6);
            const s = world.getState();
            const out = {
                releases: s.releases, showers: s.showers, meteors: s.meteors, great: s.greatHalo, pillar: s.pillar,
            };
            world.dispose();
            return out;
        };
        const night = crown(0);
        const day = crown(12);
        expect(night.releases).toBe(2);
        expect(night.showers).toBe(1);
        expect(night.meteors).toBeGreaterThan(0);
        expect(night.great).toBeGreaterThan(0.3);
        expect(night.pillar).toBeGreaterThan(0.5);
        expect(day.releases).toBe(2);
        expect(day.showers).toBe(0);
        expect(day.meteors).toBe(0);
    });

    it('sets a hard drop down with a second ring behind the first, and a jet over its crown', () => {
        const { world, step } = makeWorld({ hour: 18 });
        world.onLock({ rows: [19], u: 0.2, color: '#ffd700' });
        step(0.1);
        expect(world.getState().rings).toBe(1);
        world.onLock({
            rows: [19], u: 0.8, color: '#ffd700', hardDrop: true,
        });
        step(0.1);
        expect(world.getState().rings).toBe(3);
        // Some of its drops go nearly straight up and higher than the crown's.
        let jets = 0;
        let highest = 0;
        for (let k = 0; k < world.drops.length; k += 10) {
            if (world.drops[k + 6] < 0) continue;
            const out = Math.hypot(world.drops[k + 3], world.drops[k + 5]);
            if (out < 0.25) jets += 1;
            highest = Math.max(highest, world.drops[k + 4]);
        }
        expect(jets).toBeGreaterThan(2);
        expect(highest).toBeGreaterThan(3.3);
        world.dispose();
    });

    it('lights the horizon from end to end for a new level, and every flame afloat leaps', () => {
        const { world, step } = makeWorld({ hour: 0 });
        lockSome(world, step, 3);
        const calm = world.lampBoost;
        expect(world.getState().horizonGlow).toBe(0);
        world.levelUp(2);
        step(0.5);
        expect(world.getState().horizonGlow).toBeGreaterThan(0.1);
        expect(world.lampBoost).toBeGreaterThan(calm + 0.2);
        step(12);
        expect(world.getState().horizonGlow).toBeLessThan(0.01);
        world.dispose();
    });

    it('starts a new run, and a seek, with none of it left on the sea or the sky', () => {
        const { world, step } = makeWorld({ hour: 0, weather: 'clear' });
        lockSome(world, step, 5);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4, perfect: true });
        step(1);
        expect(world.getState().waves).toBeGreaterThan(0);
        world.resetSession();
        step(0.1);
        const s = world.getState();
        expect(s.waves).toBe(0);
        expect(s.meteors).toBe(0);
        expect(s.releases).toBe(0);
        expect(world.releases.every((batch) => batch.n === 0)).toBe(true);
        world.dispose();
    });
});

describe('sunset events: the weather in the world', () => {
    it('opens on the sky the theme ships and lets its own clock turn it', () => {
        const { world, step } = makeWorld({ hour: 17, start: 1 });
        expect(world.getState().weather).toBe('trade');
        expect(world.U.cover.value).toBeCloseTo(world.light.cover, 6);
        expect(world.U.towers.value).toBe(0);
        expect(world.U.veil.value).toBe(0);
        expect(world.U.chop.value).toBe(1);
        world.seek(SKY_PERIOD + 1);
        step(0.1);
        expect(world.getState().weather).toBe('towers');
        expect(world.U.towers.value).toBeGreaterThan(0.99);
        world.dispose();
    });

    it('holds a weather a capture asks for, and hands every number of it to the shaders', () => {
        const { world, step } = makeWorld({ hour: 12, weather: 'veil' });
        step(SKY_PERIOD * 1.5, 0.5);
        expect(world.getState().weather).toBe('veil');
        expect(world.U.veil.value).toBe(1);
        expect(world.U.cirrus.value).toBeGreaterThan(1.5);
        expect(world.U.cover.value).toBeLessThan(world.light.cover);
        expect(world.U.hazeReach.value).toBeLessThan(2600);
        expect(world.U.chop.value).toBeLessThan(1);
        // A veil stands a ring round the light by itself.
        expect(world.getState().halo).toBeGreaterThan(0.2);
        world.dispose();
    });

    it('keeps the cover a share of the sky whatever the weather and the hour add up to', () => {
        ['trade', 'towers', 'mackerel', 'clear', 'veil'].forEach((weather) => {
            for (let hour = 0; hour < 24; hour += 1.5) {
                const { world } = makeWorld({ hour, weather });
                expect(world.U.cover.value).toBeGreaterThanOrEqual(0);
                expect(world.U.cover.value).toBeLessThanOrEqual(1);
                world.dispose();
            }
        });
    });
});

describe('sunset events: what happens by itself', () => {
    it('lets a shooting star fall now and then in a dark clear sky, and none by day', () => {
        const fallen = (hour) => {
            const { world, step } = makeWorld({ hour, weather: 'clear' });
            step(150, 0.1);
            const n = world.parts.meteors.sent;
            world.dispose();
            return n;
        };
        expect(fallen(0)).toBeGreaterThanOrEqual(3);
        expect(fallen(0)).toBeLessThan(20);
        expect(fallen(12)).toBe(0);
    });

    it('flickers lightning inside a far tower when the light is low, and not at noon', () => {
        const brightest = (hour, weather) => {
            const { world, step } = makeWorld({ hour, weather });
            let most = 0;
            for (let i = 0; i < 600; i += 1) {
                step(0.05, 0.05);
                most = Math.max(most, world.U.bolt.value.y);
            }
            world.dispose();
            return most;
        };
        expect(brightest(21, 'towers')).toBeGreaterThan(0.4);
        expect(brightest(12, 'towers')).toBe(0);
        expect(brightest(21, 'clear')).toBeLessThan(0.2);
    });

    it('lights the night\'s fishing boats far out, off the places the sky sets and rises', () => {
        const { world, step } = makeWorld({ hour: 0 });
        step(0.2);
        // Nothing else is on the water: a lamp and the haze it lights for each boat, and the
        // lamps of the people who live under the islands.
        const homes = world.parts.islands.lights().length;
        expect(homes).toBeGreaterThan(4);
        expect(world.parts.glows.count).toBe(NIGHT_BOATS.length * 2 + homes);
        NIGHT_BOATS.forEach(([gate, off, range]) => {
            expect(['set', 'rise']).toContain(gate);
            expect(Math.abs(off)).toBeGreaterThan(6);
            expect(range).toBeGreaterThan(2500);
        });
        world.dispose();
        const day = makeWorld({ hour: 12 });
        day.step(0.2);
        expect(day.world.parts.glows.count).toBe(0);
        day.world.dispose();
    });

    it('trails spray astern of the boat while it is on the water', () => {
        const { world, step } = makeWorld({ hour: 12 });
        expect(world.parts.boat.wake()).toBeNull();
        world.sendBoat({
            dir: 1, range: 150, speed: 5.5, slant: 0,
        });
        step(12);
        const wake = world.parts.boat.wake();
        expect(wake).toBeTruthy();
        expect(Math.hypot(wake.hx, wake.hz)).toBeCloseTo(1, 6);
        expect(wake.stern).toBeGreaterThan(5);
        expect(wake.run).toBeGreaterThan(0.8);
        // The puffs and the bow wave are among the soft lights.
        expect(world.parts.glows.count).toBeGreaterThanOrEqual(10);
        world.dispose();
    });
});

describe('sunset events: shooting stars', () => {
    const U = { pixelAngle: { value: 0.001 } };

    it('runs each along its path, a trail behind the head, flaring and burning out', () => {
        const m = {
            x0: 0, y0: 0.5, z0: -0.86, x1: 0.2, y1: 0.3, z1: -0.93,
        };
        const start = meteorAt(m, 0);
        const mid = meteorAt(m, 0.5);
        const end = meteorAt(m, 1);
        [start, mid, end].forEach((p) => expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 6));
        expect(start.glow).toBeLessThan(0.05);
        expect(mid.glow).toBeGreaterThan(0.7);
        expect(end.glow).toBeLessThan(0.05);
        expect(mid.y).toBeLessThan(start.y);
        expect(METEOR_TRAIL).toBeGreaterThan(0.1);
        expect(METEOR_TRAIL).toBeLessThan(0.6);
    });

    it('draws only the ones falling now, takes one sent ahead of time, and reuses its pool', () => {
        const meteors = createMeteors({ capacity: 4, U: { pixelAngle: U.pixelAngle } });
        const from = { x: 0, y: 0.5, z: -0.86 };
        const to = { x: 0.2, y: 0.3, z: -0.93 };
        meteors.send(1, from, to, 0.6, 2);
        meteors.send(3, from, to, 0.6, 2);
        meteors.update(0.5);
        expect(meteors.mesh.count).toBe(0);
        meteors.update(1.3);
        expect(meteors.mesh.count).toBe(1);
        expect(meteors.falling(1.3)).toBe(1);
        meteors.update(2);
        expect(meteors.mesh.count).toBe(0);
        meteors.update(3.2);
        expect(meteors.mesh.count).toBe(1);
        for (let i = 0; i < 9; i += 1) meteors.send(10, from, to, 1, 1);
        meteors.update(10.5);
        expect(meteors.mesh.count).toBe(4);
        expect(meteors.sent).toBe(11);
        meteors.reset();
        expect(meteors.mesh.count).toBe(0);
        meteors.dispose();
    });
});

describe('sunset events: the sea as its mesh draws it', () => {
    it('is the whole swell near the eye and only the long trains far out', () => {
        const gap = seaRingGap(220);
        expect(gap).toBeGreaterThan(0.02);
        expect(gap).toBeLessThan(0.08);
        // Near the eye every train is carried (all but a share of the very shortest, a finger high).
        for (let i = 0; i < 20; i += 1) {
            const x = -12 + i * 1.3;
            const z = -8 - i * 1.1;
            expect(Math.abs(seaMeshHeight(x, z, 3 + i, gap) - seaHeight(x, z, 3 + i))).toBeLessThan(0.02);
        }
        // Far out the short ones are left to the light: what is drawn is lower and smoother.
        const longest = SWELL.slice(0, 2).reduce((sum, train) => sum + train.height, 0);
        let differs = 0;
        for (let i = 0; i < 200; i += 1) {
            const x = -300 + i * 3.1;
            const z = -1500 - i * 2.3;
            const drawn = seaMeshHeight(x, z, i * 0.7, gap);
            expect(Math.abs(drawn)).toBeLessThanOrEqual(longest + 1e-9);
            if (Math.abs(drawn - seaHeight(x, z, i * 0.7)) > 0.03) differs += 1;
        }
        expect(differs).toBeGreaterThan(100);
    });
});

describe('sunset events: the moon from night to night', () => {
    it('opens on the gibbous moon and brings the next phase each noon, while it is under the sea', () => {
        expect(MOON_PHASES[0]).toBe(MOON_PHASE);
        expect(new Set(MOON_PHASES).size).toBe(MOON_PHASES.length);
        expect(moonPhaseAt(0)).toBe(MOON_PHASE);
        expect(moonPhaseAt(NOON_WHEEL - 1)).toBe(MOON_PHASE);
        expect(moonPhaseAt(NOON_WHEEL + MOON_TURN_SECONDS + 1)).toBe(MOON_PHASES[1]);
        expect(moonPhaseAt(NOON_WHEEL + DAY_SECONDS + MOON_TURN_SECONDS + 1)).toBe(MOON_PHASES[2]);
        // After the last of them the first comes round again.
        const round = NOON_WHEEL + DAY_SECONDS * (MOON_PHASES.length - 1) + MOON_TURN_SECONDS + 1;
        expect(moonPhaseAt(round)).toBe(MOON_PHASE);
        // It only ever changes with the moon far under the sea.
        for (let w = 0; w < DAY_SECONDS * 5; w += 1) {
            if (Math.abs(moonPhaseAt(w + 1) - moonPhaseAt(w)) > 1e-9) {
                expect(moonHeightAt(dayHourAt(w))).toBeLessThan(-5);
            }
        }
    });

    it('gives the sea and the air the light of a moon by how much of it is lit', () => {
        const glint = HOUR_COLOURS.indexOf('moonGlint');
        const moon = (moonPhase) => {
            const { world } = makeWorld({ hour: 0, moonPhase });
            const out = { road: world.lightRows[glint].y, earth: world.U.moonPhase.value.z };
            world.dispose();
            return out;
        };
        const gibbous = moon(MOON_PHASE);
        const full = moon(24);
        const crescent = moon(120);
        expect(full.road).toBeGreaterThan(gibbous.road);
        expect(crescent.road).toBeLessThan(gibbous.road * 0.45);
        expect(crescent.earth).toBeGreaterThan(gibbous.earth * 2);
        expect(moonLit(0)).toBe(1);
        expect(moonLit(180)).toBeCloseTo(0, 9);
    });
});
