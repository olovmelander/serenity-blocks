/**
 * Shifting Sands — the living pass (2026-11): the hours of the evening, the weather of the erg,
 * the happenings that come by the clock, and an effect of its own for every event.
 *
 * No GPU: a real world is built and stepped; what the shaders would draw is read off the
 * uniforms the world writes. The shader gate (shifting-sands-shaders.test.js) builds every
 * material these feed.
 */
import {
    describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    DEVILS, FRONT_RUN, HUSH, ShiftingSandsWorld,
} from '../../src/themes/shifting-sands/shifting-sands-world.js';
import {
    HOURS, HOUR_COLOURS, HOUR_STOPS, hourLook,
} from '../../src/themes/shifting-sands/shifting-sands-hours.js';
import {
    DEVIL_WALKS, METEORS, WALL, WEATHERS, WEATHER_HOLD, WEATHER_KEYS, WEATHER_SECONDS, happeningIndex,
    happeningStart, meteorPath, wallLightning, weatherAt, weatherIndex,
} from '../../src/themes/shifting-sands/shifting-sands-weather.js';
import { MOONS, SUNS } from '../../src/themes/shifting-sands/shifting-sands-composition.js';
import {
    CREST_FIRE, FIRE_SLOTS, FRONT_SLOTS, GUST_FRONT,
} from '../../src/themes/shifting-sands/shifting-sands-terrain.js';
import { DEVIL_SLOTS } from '../../src/themes/shifting-sands/shifting-sands-devils.js';
import {
    BREACH_STYLES, FAR_WORMS, SETTLE, WORM_BODIES, WORM_SLOTS, WORM_TIERS, createWorm,
} from '../../src/themes/shifting-sands/shifting-sands-worm.js';
import { BLOW_SLOTS } from '../../src/themes/shifting-sands/shifting-sands-fx.js';

const DEG = Math.PI / 180;

/** A world in the still, clear dusk unless a test turns the weather loose. */
function makeWorld({ quality = 'Minimal', weather = 0 } = {}) {
    const scene = new THREE.Scene();
    const world = new ShiftingSandsWorld({ scene, quality, capture: true }).build();
    world.weatherHold = weather;
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 2, 26000);
    world.setViewport(900, camera);
    return { scene, world, camera };
}

function advance(world, camera, to, dt = 1 / 30) {
    while (world.time < to - 1e-9) {
        const t = Math.min(to, world.time + dt);
        world.update({ time: t, delta: t - world.time }, camera);
    }
}

const azOf = (x, z) => Math.atan2(x, -z) / DEG;
const luma = (rgb) => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;

describe('shifting sands hours', () => {
    it('opens on golden hour exactly as the theme always stood', () => {
        const gold = hourLook(0);
        expect(gold.elA).toBe(SUNS.a.el);
        expect(gold.elB).toBe(SUNS.b.el);
        expect(gold.ember).toBe(0);
        expect(gold.exposure).toBe(1);
        expect(luma(gold.moonLight)).toBe(0);
        // What a sun does to the air is what it does to the land while it is up.
        expect(gold.glowA).toEqual(gold.sunLightA);
    });

    it('is each station exactly on its stop, and melts between them without a seam', () => {
        HOURS.forEach((hour, k) => {
            const look = hourLook(k / HOUR_STOPS);
            HOUR_COLOURS.forEach((key) => {
                look[key].forEach((v, c) => expect(v, `${hour.name}.${key}`).toBeCloseTo(hour[key][c], 12));
            });
            expect(look.elA).toBeCloseTo(hour.elA, 12);
        });
        const steps = [];
        for (let d = 0; d <= 1.0001; d += 0.002) steps.push(hourLook(Math.min(1, d)));
        steps.slice(1).forEach((now, i) => {
            const last = steps[i];
            HOUR_COLOURS.forEach((key) => {
                for (let c = 0; c < 3; c++) expect(Math.abs(now[key][c] - last[key][c])).toBeLessThan(0.03);
            });
            expect(Math.abs(now.elA - last.elA)).toBeLessThan(0.05);
        });
    });

    it('sets the ember first, then the white sun, and the moons take the land', () => {
        const [gold, ember, blue, night] = HOURS;
        expect(ember.elA).toBeLessThan(gold.elA);
        expect(ember.elA).toBeGreaterThan(0); // still on the Rampart
        expect(blue.elA).toBeLessThan(0); // the first sunset
        expect(blue.elB).toBeGreaterThan(0); // the white sun alone
        expect(night.elB).toBeLessThan(0); // the second
        // A sun that has set lights no land, but the air where it went down keeps burning.
        expect(luma(blue.sunLightA)).toBe(0);
        expect(luma(blue.glowA)).toBeGreaterThan(0.1);
        expect(luma(night.sunLightB)).toBe(0);
        expect(luma(night.glowA)).toBeGreaterThan(0);
        // The moons' light only grows, and is cold.
        const moon = HOURS.map((h) => luma(h.moonLight));
        for (let i = 1; i < moon.length; i++) expect(moon[i]).toBeGreaterThan(moon[i - 1]);
        expect(night.moonLight[2]).toBeGreaterThan(night.moonLight[0]);
        // The stars come out hour by hour.
        for (let i = 1; i < HOURS.length; i++) expect(HOURS[i].stars).toBeGreaterThan(HOURS[i - 1].stars);
        // A night that is still a picture: darker than the day, never black.
        expect(luma(night.zenith)).toBeGreaterThan(0);
        expect(night.exposure).toBeGreaterThan(1);
    });

    it('writes the hour into the world: suns down, no shafts, moonlight from over the Sentinel', () => {
        const { world, camera } = makeWorld();
        world.updateCamera(camera, { time: 0 });
        world.duskHold = 0;
        world.update({ time: 0, delta: 0 }, camera);
        const s = world.shared;
        expect(world.getSunScreen().visible).toBe(1);
        expect(s.uMoonLight.value.b).toBe(0);
        world.duskHold = 1;
        world.update({ time: 0, delta: 0 }, camera);
        expect(s.uSunA.value.y).toBeLessThan(0);
        expect(s.uSunB.value.y).toBeLessThan(0);
        expect(s.uSunLightA.value.r + s.uSunLightB.value.r).toBe(0);
        expect(s.uGlowA.value.r).toBeGreaterThan(0);
        expect(s.uMoonLight.value.b).toBeGreaterThan(0.1);
        expect(s.uNight.value).toBe(1);
        expect(world.getSunScreen().visible).toBe(0); // a sun that has set pours no shafts
        // The moons' light comes from where the greater moon stands.
        const moon = s.uMoonDir.value;
        expect(azOf(moon.x, moon.z)).toBeCloseTo(MOONS.a.az, 6);
        expect(world.exposure).toBeGreaterThan(1);
        world.dispose();
    });

    it("bakes the night's own shadows: a second horizon, toward the greater moon", () => {
        const { world } = makeWorld();
        const { attributes } = world.terrain.mesh.geometry;
        const moon = attributes.aMoon.array;
        const shade = attributes.aShade.array;
        expect(moon.length).toBe(attributes.position.count);
        let differs = 0;
        let lifted = 0;
        for (let i = 0; i < moon.length; i++) {
            expect(Number.isFinite(moon[i])).toBe(true);
            if (Math.abs(moon[i] - shade[i * 4 + 2]) > 0.02) differs += 1;
            if (moon[i] > 0.05) lifted += 1;
        }
        // The suns stand on the left, the moons on the right: not the same shadows.
        expect(differs).toBeGreaterThan(moon.length * 0.1);
        expect(lifted).toBeGreaterThan(0);
        world.dispose();
    });
});

describe('shifting sands weather', () => {
    it('opens clear and rests on every weather in turn', () => {
        expect(WEATHERS[0].name).toBe('clear');
        const opening = weatherAt(0);
        WEATHER_KEYS.forEach((key) => expect(opening[key]).toBe(WEATHERS[0][key]));
        // Through the hold it is still the opening sky.
        const held = weatherAt(WEATHER_SECONDS * WEATHER_HOLD * 0.95);
        WEATHER_KEYS.forEach((key) => expect(held[key]).toBe(WEATHERS[0][key]));
        WEATHERS.forEach((weather, k) => {
            const at = weatherAt(k * WEATHER_SECONDS);
            WEATHER_KEYS.forEach((key) => expect(at[key], `${weather.name}.${key}`).toBeCloseTo(weather[key], 9));
        });
        // And round again.
        const again = weatherAt(WEATHERS.length * WEATHER_SECONDS);
        WEATHER_KEYS.forEach((key) => expect(again[key]).toBeCloseTo(WEATHERS[0][key], 9));
    });

    it('melts from one to the next without a jump', () => {
        const steps = [];
        for (let t = 0; t <= WEATHERS.length * WEATHER_SECONDS; t += 0.25) steps.push({ ...weatherAt(t) });
        steps.slice(1).forEach((now, i) => {
            WEATHER_KEYS.forEach((key) => {
                expect(Math.abs(now[key] - steps[i][key]), `${key} at ${(i + 1) * 0.25}`).toBeLessThan(0.02);
            });
        });
    });

    it('never turns in step with the hours: the same hour comes round under another sky', () => {
        // The hours rest every 100 s, the weather every 76: over the first walk of the evening
        // each station of the hours falls on a different stretch of the weather's wheel.
        const seen = new Set();
        for (let k = 0; k <= 2 * HOUR_STOPS; k++) seen.add(weatherAt(k * 100 + 10).from);
        expect(seen.size).toBeGreaterThanOrEqual(4);
    });

    it('spends the weather on the air: cloud, haze, wind', () => {
        const { world, camera } = makeWorld();
        const read = (name) => {
            world.weatherHold = weatherIndex(name);
            world.update({ time: 5, delta: 0 }, camera);
            const s = world.shared;
            return {
                deck: s.uWeather.value.z,
                haze: s.uWeather.value.w,
                fog: s.uFog.value.x,
                wind: s.uWind.value,
                blow: s.uHeat.value.z,
            };
        };
        const clear = read('clear');
        expect(clear.deck).toBe(0);
        expect(clear.blow).toBe(0);
        expect(read('deck').deck).toBe(1);
        const haze = read('haze');
        expect(haze.haze).toBe(1);
        expect(haze.fog).toBeGreaterThan(clear.fog * 1.8);
        const wind = read('wind');
        expect(wind.wind).toBeGreaterThan(clear.wind + 0.3);
        expect(wind.blow).toBeGreaterThan(0.4); // the crests smoke and the sheets spread
        world.dispose();
    });

    it('stands the front on the horizon only in its own weather, and walks it toward the suns', () => {
        const { world, camera } = makeWorld({ weather: null });
        const wall = world.shared.uWall.value;
        const front = weatherIndex('front');
        const begins = (front - 1 + WEATHER_HOLD) * WEATHER_SECONDS;
        const ends = (front + 1) * WEATHER_SECONDS;
        world.update({ time: begins - 5, delta: 0 }, camera);
        expect(wall.x).toBe(0);
        const az = [];
        for (let t = begins + 2; t < ends - 2; t += 4) {
            world.update({ time: t, delta: 0 }, camera);
            expect(wall.x).toBeGreaterThan(0);
            az.push(wall.y / DEG);
        }
        expect(az[0]).toBeGreaterThan(40); // it comes in from the right
        for (let i = 1; i < az.length; i++) expect(az[i]).toBeLessThan(az[i - 1]);
        expect(az[az.length - 1]).toBeLessThan(WALL.from + WALL.travel + 4);
        world.update({ time: front * WEATHER_SECONDS, delta: 0 }, camera);
        expect(wall.x).toBeCloseTo(1, 9); // at its rest it stands whole
        world.update({ time: ends + 5, delta: 0 }, camera);
        expect(wall.x).toBe(0);
        world.dispose();
    });

    it('flickers its lightning as a soft double beat, never a strobe', () => {
        let lit = 0;
        let peak = 0;
        let rises = 0;
        let last = 0;
        const step = 1 / 120;
        for (let t = 0; t < 120; t += step) {
            const { glow, at } = wallLightning(t);
            expect(glow).toBeGreaterThanOrEqual(0);
            expect(glow).toBeLessThanOrEqual(1);
            expect(Math.abs(at)).toBeLessThanOrEqual(1);
            // No frame-to-frame jump a 120 Hz eye would see as a cut.
            expect(Math.abs(glow - last)).toBeLessThan(0.2);
            if (glow > 0.5 && last <= 0.5) rises += 1;
            if (glow > 0.05) lit += 1;
            peak = Math.max(peak, glow);
            last = glow;
        }
        expect(peak).toBeGreaterThan(0.8);
        expect(lit * step).toBeLessThan(120 * 0.2); // dark most of the time
        expect(rises / 120).toBeLessThan(1); // well under one bright flash a second
    });

    it('lets stars fall only once the stars are out, and never below the land', () => {
        for (let n = 0; n < 200; n++) {
            const path = meteorPath(n);
            expect(Math.abs(path.az)).toBeLessThanOrEqual(52);
            expect(path.el).toBeGreaterThanOrEqual(9);
            expect(Math.abs(path.slant)).toBeGreaterThanOrEqual(22); // never level
            expect(Math.abs(path.slant)).toBeLessThanOrEqual(60); // never straight down
        }
        const { world, camera } = makeWorld({ quality: 'High' });
        const rows = world.sky.uMeteorTo.array;
        const from = world.sky.uMeteorFrom.array;
        world.duskHold = 0;
        advance(world, camera, 30, 0.5);
        rows.forEach((row) => expect(row.w).toBe(0)); // golden hour: none
        world.duskHold = 1;
        advance(world, camera, 60, 0.5);
        expect(rows.some((row) => row.w > 0.3)).toBe(true);
        const n = happeningIndex(METEORS, world.time);
        const slot = n % rows.length;
        expect(from[slot].w).toBeGreaterThanOrEqual(happeningStart(METEORS, n));
        expect(from[slot].w + METEORS.life).toBeLessThan(happeningStart(METEORS, n + 1));
        rows.forEach((row) => expect(row.y).toBeGreaterThan(0)); // each ends above the horizon
        world.dispose();
    });
});

describe('shifting sands events: an effect of its own for each', () => {
    const quiet = () => {
        const made = makeWorld();
        made.world.seek(10);
        made.world.update({ time: 10, delta: 0 }, made.camera);
        return made;
    };
    const liveGeysers = (world) => world.blows.uBlows.array.filter((v) => v.w > 9).length;

    it('answers one line with a gust front that crosses the erg downwind, and no geyser', () => {
        const { world, camera } = quiet();
        world.onLineClear(1);
        const fronts = world.terrain.uniforms.uFronts.array;
        const mine = fronts.filter((row) => row.y === 10);
        expect(mine.length).toBe(1);
        expect(mine[0].x).toBe(GUST_FRONT.from); // it starts behind the eye
        expect(mine[0].w).toBeGreaterThan(300); // and outruns the drum's ring
        expect(liveGeysers(world)).toBe(0);
        // A second and a third front each take a slot; the first is still crossing.
        advance(world, camera, 11);
        world.onLineClear(1);
        expect(fronts.filter((row) => row.z > 0).length).toBe(Math.min(2, FRONT_SLOTS));
        world.dispose();
    });

    it('answers two and three lines with that many geysers of sand', () => {
        [2, 3].forEach((lines) => {
            const { world } = quiet();
            world.onLineClear(lines);
            expect(liveGeysers(world)).toBe(lines);
            expect(world.terrain.uniforms.uFronts.array.every((row) => row.z === 0)).toBe(true);
            world.dispose();
        });
    });

    it('answers a twist with a dust devil beside the board, seated on the sand, walking off', () => {
        const { world, camera } = quiet();
        // The solo layout: the card over the middle, the HUD right of it.
        world.setKeepOutRects([{
            x0: 0.39, y0: 0.08, x1: 0.61, y1: 0.92,
        }, {
            x0: 0.647, y0: 0.25, x1: 0.735, y1: 0.75,
        }]);
        const { bands } = world.director.view;
        const rows = world.devils.uDevils.array;
        for (let turn = 0; turn < 12; turn++) {
            const cleared = turn % 2 === 0;
            world.onTwist(cleared ? 2 : 0);
            const devil = world.devilList.find((d) => d.t0 === world.time);
            expect(devil, `twist ${turn}`).toBeDefined();
            expect(devil.height).toBe(cleared ? DEVILS.twist.height : DEVILS.spin.height);
            const az = azOf(devil.x0, devil.z0);
            // Clear of the boards and the HUD, and never in front of a sun.
            bands.forEach(([from, to]) => expect(az < from || az > to, `devil ${turn} at ${az}`).toBe(true));
            expect(Math.abs(az - SUNS.a.az)).toBeGreaterThan(3);
            expect(Math.abs(az - SUNS.b.az)).toBeGreaterThan(2);
            advance(world, camera, world.time + 1.2);
        }
        // It stands on the sand it has walked to, and it has moved.
        const last = world.devilList.reduce((a, b) => (b.t0 > a.t0 ? b : a));
        const slot = world.devilList.indexOf(last);
        const before = rows[slot].clone();
        advance(world, camera, world.time + 2);
        const now = rows[slot];
        expect(now.w).toBeGreaterThan(0.9);
        expect(Math.hypot(now.x - before.x, now.z - before.z)).toBeGreaterThan(20);
        expect(Math.abs(now.y - world.field.sample(now.x, now.z, {}).h)).toBeLessThan(4);
        // Then it thins away and its slot is empty.
        advance(world, camera, last.t0 + last.life + 0.2);
        expect(rows[slot].w).toBe(0);
        world.dispose();
    });

    it('answers a back-to-back with fire along the crests', () => {
        const { world } = quiet();
        world.onBackToBack();
        const fires = world.terrain.uniforms.uFires.array;
        const lit = fires.filter((row) => row.w > 0);
        expect(lit.length).toBe(1);
        expect(lit[0].z).toBeGreaterThanOrEqual(10);
        expect(lit[0].z).toBeLessThan(10.5);
        expect(CREST_FIRE.speed * CREST_FIRE.life).toBeGreaterThan(1500); // it reaches the far crests
        expect(fires.length).toBe(FIRE_SLOTS);
        world.dispose();
    });

    it('answers a perfect clear with far worms along the horizon, each in its own stretch of it', () => {
        const { world, camera } = quiet();
        const { geometry } = world.worm.mesh;
        expect(geometry.instanceCount).toBe(WORM_SLOTS);
        world.onPerfectClear();
        const { chorus } = world.director;
        expect(chorus.length).toBe(FAR_WORMS);
        const style = BREACH_STYLES.far;
        chorus.forEach((br, i) => {
            expect(br.dist).toBeGreaterThanOrEqual(style.dist[0]);
            expect(br.dist).toBeLessThanOrEqual(style.dist[1]);
            expect(br.R).toBeGreaterThan(60); // giants: they must read out by the horizon
            if (i > 0) expect(br.t0).toBeGreaterThan(chorus[i - 1].t0); // one after another
            expect(br.duration).toBeLessThan(22);
        });
        for (let i = 0; i < chorus.length; i++) {
            for (let j = i + 1; j < chorus.length; j++) {
                expect(Math.abs(chorus[i].az - chorus[j].az)).toBeGreaterThan(8);
            }
        }
        // A geyser where each breaks the surface (and, later, where it strikes).
        const blows = world.blows.uBlows.array;
        chorus.forEach((br) => {
            expect(blows.some((v) => v.x === br.up.x && v.z === br.up.z)).toBe(true);
        });
        // The bodies are drawn only while one of them is up.
        const first = chorus[0];
        advance(world, camera, first.t0 + 2, 1 / 15);
        expect(geometry.instanceCount).toBe(WORM_BODIES);
        const last = chorus[chorus.length - 1];
        advance(world, camera, last.t0 + last.tDown + 0.5, 1 / 15);
        chorus.forEach((br) => {
            expect(blows.some((v) => v.x === br.down.x && v.z === br.down.z), 'the strike').toBe(true);
        });
        advance(world, camera, last.t0 + last.duration + SETTLE + 1, 1 / 10);
        expect(geometry.instanceCount).toBe(WORM_SLOTS);
        // The worms of the erg were not touched: a perfect clear calls no summons of its own.
        expect(world.director.summonCount).toBe(0);
        expect(blows.length).toBe(BLOW_SLOTS);
        world.dispose();
    });

    it('answers a level with the front crossing the whole horizon, taller than it ever stands', () => {
        const { world, camera } = quiet();
        const wall = world.shared.uWall.value;
        expect(wall.x).toBe(0);
        world.onLevelUp(2);
        let tallest = 0;
        let last = wall.x;
        const az = [];
        for (let i = 1; i <= FRONT_RUN.seconds * 60; i++) {
            world.update({ time: 10 + i / 60, delta: 1 / 60 }, camera);
            expect(Math.abs(wall.x - last)).toBeLessThan(0.05); // it rises and sinks, never pops
            last = wall.x;
            tallest = Math.max(tallest, wall.x);
            if (wall.x > 0.5) az.push(wall.y / DEG);
        }
        expect(tallest).toBeGreaterThan(1.2);
        expect(az[0]).toBeGreaterThan(20);
        expect(az[az.length - 1]).toBeLessThan(-20);
        for (let i = 1; i < az.length; i++) expect(az[i]).toBeLessThanOrEqual(az[i - 1] + 1e-9);
        world.update({ time: 10 + FRONT_RUN.seconds + 0.5, delta: 0.5 }, camera);
        expect(wall.x).toBe(0);
        // With the reactions off the light still steps, but no front runs.
        const off = quiet();
        off.world.onLevelUp(2, { react: false });
        off.world.update({ time: 12, delta: 2 }, off.camera);
        expect(off.world.shared.uWall.value.x).toBe(0);
        off.world.dispose();
        world.dispose();
    });

    it('lets the evening move on over a finished run, and brings the day back with the next', () => {
        const { world, camera } = quiet();
        world.duskHold = null;
        advance(world, camera, 12);
        const rest = { sunY: world.shared.uSunA.value.y, wind: world.shared.uWind.value, exposure: world.exposure };
        expect(world.hushAt(world.time)).toBe(0);
        world.endRun();
        const endedAt = world.hush.ended;
        const pulses = world.terrain.uniforms.uPulses.array;
        expect(pulses.some((p) => p.z > endedAt && p.w > 2)).toBe(true); // one last slow ring
        let last = 0;
        for (let i = 1; i <= HUSH.fall * 30 + 30; i++) {
            world.update({ time: 12 + i / 30, delta: 1 / 30 }, camera);
            const h = world.hushAt(world.time);
            expect(h).toBeGreaterThanOrEqual(last);
            expect(h - last).toBeLessThan(0.04);
            last = h;
        }
        expect(last).toBe(1);
        expect(world.shared.uSunA.value.y).toBeLessThan(rest.sunY); // the ember has sunk
        expect(world.shared.uWind.value).toBeLessThan(rest.wind * 0.6); // the wind has died
        expect(world.exposure).toBeLessThan(rest.exposure);
        world.endRun(); // a second game over (the modal's own events) starts nothing again
        expect(world.hush.ended).toBe(endedAt);
        // A new run: the hush lifts, and the wind comes back with a front of sand.
        const t0 = world.time;
        world.onSessionStart();
        const fronts = world.terrain.uniforms.uFronts.array;
        expect(fronts.some((row) => row.y > t0 && row.z > 0)).toBe(true);
        advance(world, camera, t0 + HUSH.lift + 0.2);
        expect(world.hushAt(world.time)).toBe(0);
        expect(world.shared.uSunA.value.y).toBeCloseTo(rest.sunY, 2);
        world.dispose();
    });

    it('starts no hush and no gust when a run begins with none behind it', () => {
        const { world } = quiet();
        world.onSessionStart();
        expect(world.hushAt(world.time)).toBe(0);
        expect(world.terrain.uniforms.uFronts.array.every((row) => row.z === 0)).toBe(true);
        world.dispose();
    });
});

describe('shifting sands happenings', () => {
    it('walks a dust devil over the far erg by the clock, off the suns and the board', () => {
        const { world, camera } = makeWorld();
        world.setKeepOutRects([{
            x0: 0.39, y0: 0.08, x1: 0.61, y1: 0.92,
        }]);
        const start = happeningStart(DEVIL_WALKS, 0);
        advance(world, camera, start - 1, 0.5);
        expect(world.devilList.every((d) => d.t0 === -Infinity)).toBe(true);
        advance(world, camera, start + 3, 0.1);
        const walker = world.devilList.find((d) => d.t0 === start);
        expect(walker).toBeDefined();
        expect(walker.height).toBe(DEVILS.walk.height);
        expect(Math.hypot(walker.x0, walker.z0)).toBeGreaterThanOrEqual(DEVILS.walk.dist[0]);
        const az = azOf(walker.x0, walker.z0);
        world.director.view.bands.forEach(([from, to]) => expect(az < from || az > to).toBe(true));
        expect(world.devils.mesh.geometry.instanceCount).toBe(DEVIL_SLOTS);
        advance(world, camera, start + DEVIL_WALKS.life + 0.5, 0.25);
        expect(world.devils.mesh.geometry.instanceCount).toBe(1); // dormant again
        world.dispose();
    });

    it('sends gust fronts across the erg only when it blows', () => {
        const still = makeWorld();
        advance(still.world, still.camera, 40, 0.25);
        expect(still.world.terrain.uniforms.uFronts.array.every((row) => row.z === 0)).toBe(true);
        still.world.dispose();
        const windy = makeWorld({ weather: weatherIndex('wind') });
        advance(windy.world, windy.camera, 40, 0.25);
        expect(windy.world.terrain.uniforms.uFronts.array.some((row) => row.z > 0.5)).toBe(true);
        windy.world.dispose();
    });

    it('moves nothing in a jump through a perfect clear, a twist and a level at once', () => {
        const { world, camera } = makeWorld();
        world.seek(20);
        world.update({ time: 20, delta: 0 }, camera);
        world.onPerfectClear();
        world.onTwist(2);
        world.onLevelUp(3);
        const devils = world.devils.uDevils.array;
        const wall = world.shared.uWall.value;
        let lastDevil = devils.map((row) => row.w);
        let lastWall = wall.x;
        let lastExposure = world.exposure;
        for (let i = 1; i <= 12 * 60; i++) {
            world.update({ time: 20 + i / 60, delta: 1 / 60 }, camera);
            for (let k = 0; k < devils.length; k++) {
                expect(Math.abs(devils[k].w - lastDevil[k]), `devil ${k} at frame ${i}`).toBeLessThan(0.08);
            }
            expect(Math.abs(wall.x - lastWall)).toBeLessThan(0.05);
            expect(Math.abs(world.exposure - lastExposure)).toBeLessThan(0.02);
            lastDevil = devils.map((row) => row.w);
            lastWall = wall.x;
            lastExposure = world.exposure;
        }
        world.dispose();
    });
});

describe('shifting sands worm body', () => {
    it('has a tier for every quality, finer as it rises, with room for the rim teeth', () => {
        const tiers = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];
        tiers.forEach((tier, i) => {
            const t = WORM_TIERS[tier];
            expect(t, tier).toBeDefined();
            expect(t.segs % 2).toBe(0); // a tooth takes two segments of the rim
            if (i > 0) expect(t.rings).toBeGreaterThanOrEqual(WORM_TIERS[tiers[i - 1]].rings);
        });
    });

    it('builds one tube for every body, the far ones undrawn until they are called', () => {
        const { world } = makeWorld();
        const { geometry } = world.worm.mesh;
        expect(geometry.getAttribute('aSlot').count).toBe(WORM_BODIES);
        expect(geometry.instanceCount).toBe(WORM_SLOTS);
        // The fringe past the lip: every other vertex of the last ring is a tooth's point.
        const tier = WORM_TIERS.Minimal;
        const data = geometry.getAttribute('aWorm').array;
        const ringSize = tier.segs + 1;
        const lastRing = data.length / 4 - ringSize;
        let teeth = 0;
        for (let j = 0; j < ringSize; j++) {
            const alpha = data[(lastRing + j) * 4 + 3];
            expect(alpha).toBeGreaterThanOrEqual(1);
            if (alpha > 1.01) teeth += 1;
        }
        expect(teeth).toBe(tier.segs / 2);
        // An odd segment count is made even rather than leaving half a tooth.
        const odd = createWorm(world.shared, { rings: 16, segs: 9, capRings: 4 });
        expect(odd.mesh.geometry.getAttribute('aWorm').count % 11).toBe(0);
        odd.dispose();
        world.dispose();
    });
});
