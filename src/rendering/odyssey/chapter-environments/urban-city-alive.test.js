/**
 * Chapter 8, the 2026-11-17 masterpiece pass: the city's clock (weather, the sun, the trains,
 * the searchlights), its architecture and far districts, the sky's two palettes, and the journey's
 * ending (its clock, the lanterns, the fireworks). Pure plans and closed forms; the materials are
 * built to WGSL by urban-neon-shaders.test.js, which walks every material of the chapter.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    NEON_SUN_SINK,
    NEON_TRAIN,
    NEON_TRAIN_LINES,
    NEON_WEATHER,
    neonFront,
    resolveNeonSearchlight,
    resolveNeonSunSink,
    resolveNeonTrain,
    resolveNeonWeather,
} from './shared/odyssey-neon-clock.js';
import {
    JOURNEY_ENDING, advanceJourneyEnding, resolveJourneyEnding,
} from './shared/odyssey-journey-ending.js';
import {
    NEON_ARCHITECTURE, NEON_PART, arrivalLife, planNeonArchitecture,
} from './shared/odyssey-neon-architecture.js';
import { NEON_FAR_CITY, dealFarCity } from './shared/odyssey-neon-far-plan.js';
import {
    RETROSUN_CITY_POS, STREET_Y, dealCityTowers, planNeonSigns,
} from './shared/odyssey-neon-city-plan.js';
import {
    NEON_SKY_PALETTES, applyNeonSkyState, createNeonSkyUniforms,
} from './shared/odyssey-neon-sky.tsl.js';
import {
    JOURNEY_COLOURS_FALLBACK, NEON_FIREWORKS, NEON_SKY_LANTERNS, SHELL_KIND, fireworksLightAt, journeyColours,
    planFireworks, planSkyLanterns,
} from './shared/odyssey-neon-celebration.tsl.js';
import {
    NEON_SEARCHLIGHTS, planNeonHologram, planNeonSearchlights, planNeonVents,
} from './shared/odyssey-neon-air-life.tsl.js';
import { NEON_SKYBRIDGES } from './shared/odyssey-neon-skybridges.tsl.js';
import { NEON_LANTERNS } from './shared/odyssey-neon-lanterns.tsl.js';
import { createUrbanDreamsEnvironment, updateUrbanDreamsEnvironment } from './urban-dreams.js';

describe("chapter 8: the city's clock", () => {
    it('brings showers in and lets them pass, and never steps', () => {
        let wetSeconds = 0;
        let drySeconds = 0;
        let showers = 0;
        let previous = resolveNeonWeather(0);
        for (let t = 0.25; t < 1800; t += 0.25) {
            const now = resolveNeonWeather(t);
            for (const key of ['rain', 'cover', 'wet', 'storm']) {
                expect(now[key]).toBeGreaterThanOrEqual(0);
                expect(now[key]).toBeLessThanOrEqual(1);
                // Continuous in time: the fastest shower still takes seconds to come in (never a step).
                expect(Math.abs(now[key] - previous[key])).toBeLessThan(0.1);
            }
            if (now.rain > 0.5) wetSeconds += 0.25;
            if (now.rain < 0.02) drySeconds += 0.25;
            if (now.rain > 0.5 && previous.rain <= 0.5) showers += 1;
            previous = now;
        }
        // Rain is the city's weather, but it comes and goes: both spells are long enough to meet.
        expect(wetSeconds / 1800).toBeGreaterThan(0.12);
        expect(wetSeconds / 1800).toBeLessThan(0.5);
        expect(drySeconds / 1800).toBeGreaterThan(0.25);
        expect(showers).toBeGreaterThan(6);
        expect(neonFront(Number.NaN)).toBe(0.5);
    });

    it('keeps the street wet after a shower and gathers the cloud before one', () => {
        // The moment a shower ends: the wet outlasts the rain.
        let ended = null;
        for (let t = 1; t < 900 && ended === null; t += 0.5) {
            if (resolveNeonWeather(t - 0.5).rain > 0.05 && resolveNeonWeather(t).rain <= 0.05
                && resolveNeonWeather(t - 12).rain > 0.6) ended = t;
        }
        expect(ended).not.toBeNull();
        expect(resolveNeonWeather(ended).wet).toBeGreaterThan(resolveNeonWeather(ended).rain + 0.3);
        // The street never dries.
        for (let t = 0; t < 600; t += 3) expect(resolveNeonWeather(t).wet).toBeGreaterThanOrEqual(NEON_WEATHER.wetFloor);
        // The moment one begins: the cloud had already closed in.
        let began = null;
        for (let t = 1; t < 900 && began === null; t += 0.5) {
            if (resolveNeonWeather(t - 0.5).rain === 0 && resolveNeonWeather(t).rain > 0) began = t;
        }
        expect(began).not.toBeNull();
        expect(resolveNeonWeather(began).cover).toBeGreaterThan(NEON_WEATHER.coverRange[0] + 0.1);
        // Lightning only in the heart of a shower.
        for (let t = 0; t < 900; t += 1) {
            const w = resolveNeonWeather(t);
            if (w.storm > 0) expect(w.rain).toBeGreaterThan(0.9);
        }
    });

    it('sinks the sun through the chapter, after the 7->8 hand-over', () => {
        expect(resolveNeonSunSink(null)).toBe(0);
        expect(resolveNeonSunSink(0)).toBe(0);
        expect(resolveNeonSunSink(NEON_SUN_SINK.from)).toBe(0);
        expect(resolveNeonSunSink(1)).toBeCloseTo(NEON_SUN_SINK.depth, 6);
        let previous = 0;
        for (let local = 0; local <= 1.0001; local += 0.01) {
            const sink = resolveNeonSunSink(local);
            expect(sink).toBeGreaterThanOrEqual(previous - 1e-9);
            expect(sink - previous).toBeLessThan(1.2);
            previous = sink;
        }
        // Its last light: the disc (radius 130) still stands over the street's far roofs.
        expect(RETROSUN_CITY_POS[1] - NEON_SUN_SINK.depth + 130).toBeGreaterThan(100);
    });

    it('runs a train down each line now and then, clear of the strings, the bridges and the rail', () => {
        NEON_TRAIN_LINES.forEach((line) => {
            let on = 0;
            let passes = 0;
            let previous = null;
            for (let t = 0; t < 600; t += 0.1) {
                const train = resolveNeonTrain(line, t);
                if (train) {
                    on += 1;
                    expect(train.z).toBeLessThanOrEqual(NEON_TRAIN.zNear + (line.cars * 16) + 1);
                    expect(train.z).toBeGreaterThanOrEqual(NEON_TRAIN.zFar - (line.cars * 16) - 1);
                    if (previous) {
                        // It runs at its own speed, toward the sun or toward the eye, never a jump.
                        expect((train.z - previous.z) * line.dir).toBeCloseTo(line.speed * 0.1, 3);
                    } else passes += 1;
                }
                previous = train;
            }
            // Now and then: on the line between a fifth and two thirds of the time.
            expect(on / 6000).toBeGreaterThan(0.2);
            expect(on / 6000).toBeLessThan(0.67);
            expect(passes).toBeGreaterThanOrEqual(6);
            // Over the lantern strings, and clear of every skybridge's deck (6 u deep).
            const foot = line.y - (NEON_TRAIN.carHeight * 0.5) - 0.5;
            const roof = line.y + (NEON_TRAIN.carHeight * 0.5);
            expect(foot).toBeGreaterThan(NEON_LANTERNS.yMax);
            NEON_SKYBRIDGES.forEach(([, y]) => {
                expect(foot > y + 3 || roof < y - 3).toBe(true);
            });
            // Under the rail (corridor y -12..0 down the boulevard's middle), off to its side.
            expect(roof).toBeLessThan(-14);
            expect(Math.abs(line.x)).toBeGreaterThan(10);
            // Inside the road, clear of the blade signs that hang off the walls (|x| >= 19).
            expect(Math.abs(line.x) + (NEON_TRAIN.carWidth * 0.5)).toBeLessThan(18.5);
        });
        expect(resolveNeonTrain(NEON_TRAIN_LINES[0], Number.NaN)).toBeNull();
    });

    it('sweeps the searchlights slowly and seats them on tall roofs', () => {
        NEON_SEARCHLIGHTS.forEach((lamp) => {
            let previous = resolveNeonSearchlight(lamp, 0);
            for (let t = 0.1; t < 120; t += 0.1) {
                const now = resolveNeonSearchlight(lamp, t);
                expect(Math.abs(now.bearing - previous.bearing)).toBeLessThan(0.02);
                expect(now.elevation).toBeGreaterThan(0.6); // always up into the sky
                previous = now;
            }
        });
        const towers = dealCityTowers(6);
        planNeonSearchlights(towers).forEach((lamp) => {
            expect(lamp.y - STREET_Y).toBeGreaterThan(60);
            expect(Math.abs(lamp.x)).toBeGreaterThan(40); // off the boulevard
        });
        const globe = planNeonHologram(towers);
        expect(globe.x).toBeGreaterThan(24);
        expect(globe.y - globe.radius).toBeGreaterThan(globe.roofY);
    });
});

describe("chapter 8: the city's architecture", () => {
    const towers = dealCityTowers(6);
    const { signs } = planNeonSigns(towers);
    const plan = planNeonArchitecture(towers, signs);

    it('keeps every dealt tower in its place and steps it in only above its signs', () => {
        expect(plan.bases).toHaveLength(towers.length);
        plan.bases.forEach((base, i) => {
            const tower = towers[i];
            expect([base.x, base.z, base.width, base.depth]).toEqual([tower.x, tower.z, tower.width, tower.depth]);
            expect(base.y - (base.height * 0.5)).toBeCloseTo(STREET_Y, 6);
            expect(base.height).toBeLessThanOrEqual(tower.height + 1e-9);
            expect([0, 1, 2, 3]).toContain(base.style);
        });
        // Every sign fixed to a wall still has its wall behind it: the tower's base reaches over it.
        signs.filter((sign) => !sign.roof).forEach((sign) => {
            const host = plan.bases.find((base) => Math.abs(sign.z - base.z) <= (base.depth * 0.5) + 1
                && Math.abs(sign.x - base.x) <= (base.width * 0.5) + 5);
            expect(host).toBeTruthy();
            expect(STREET_Y + host.height).toBeGreaterThan(sign.y + (sign.h * 0.5));
        });
        // The city has buildings of every style, and many of the tall ones step in.
        const styles = new Set(plan.bases.map((base) => base.style));
        expect(styles.size).toBe(4);
        const stepped = plan.bases.filter((base) => base.height < base.fullHeight - 1);
        expect(stepped.length).toBeGreaterThan(60);
    });

    it('lights more rooms in the towers the arrival stands between, and only there', () => {
        const boosted = towers.filter((tower) => arrivalLife(tower) > 0);
        expect(boosted.length).toBeGreaterThan(20);
        boosted.forEach((tower) => {
            expect(tower.bank).toBeLessThanOrEqual(1);
            expect(tower.z).toBeGreaterThan(-130);
            expect(tower.z).toBeLessThan(150);
        });
        // The walls either side of the eye's first stations (rail z 62 -> 28) carry the most.
        const beside = towers.filter((tower) => tower.bank === 0 && tower.z > 0 && tower.z < 80);
        expect(beside.length).toBeGreaterThanOrEqual(4);
        beside.forEach((tower) => expect(arrivalLife(tower)).toBeCloseTo(0.3, 6));
        plan.bases.forEach((base, i) => {
            expect(base.occupancy).toBeCloseTo(towers[i].occupancy + arrivalLife(towers[i]), 9);
            expect(base.occupancy).toBeLessThan(0.72);
        });
        // The city as a whole stays mostly dark.
        const mean = plan.bases.reduce((sum, base) => sum + base.occupancy, 0) / plan.bases.length;
        expect(mean).toBeLessThan(0.27);
    });

    it('stacks tiers inside their tower, ledges just proud of the wall below', () => {
        const bodies = plan.tiers.filter((tier) => tier.part === NEON_PART.body);
        const ledges = plan.tiers.filter((tier) => tier.part === NEON_PART.ledge);
        expect(bodies.length).toBeGreaterThan(150);
        expect(ledges.length).toBeGreaterThan(80);
        const hostOf = (tier) => plan.bases.find((base) => base.seed === tier.seed
            && Math.abs(base.x - tier.x) < base.width && Math.abs(base.z - tier.z) < base.depth);
        plan.tiers.forEach((tier) => {
            const host = hostOf(tier);
            expect(host).toBeTruthy();
            const slack = tier.part === NEON_PART.ledge ? NEON_ARCHITECTURE.ledgeOut + 1e-6 : 1e-6;
            expect(Math.abs(tier.x - host.x) + (tier.width * 0.5)).toBeLessThanOrEqual((host.width * 0.5) + slack);
            expect(Math.abs(tier.z - host.z) + (tier.depth * 0.5)).toBeLessThanOrEqual((host.depth * 0.5) + slack);
            // Nothing hangs in the air: a tier's foot is at or above its tower's base top.
            expect(tier.base).toBeGreaterThanOrEqual(host.height - NEON_ARCHITECTURE.ledgeThick);
            expect(tier.height).toBeGreaterThan(0);
        });
    });

    it('crowns the tall towers and dresses the roofs, the same city every time', () => {
        const { gear } = plan;
        expect(gear.pyramids.length).toBeGreaterThan(12);
        expect(gear.tanks.length).toBeGreaterThan(20);
        expect(gear.boxes.length).toBeGreaterThan(200);
        // Every tall or hero tower carries a beacon.
        const tall = towers.filter((tower) => tower.height > 110 || tower.hero > 0);
        expect(gear.beacons.length).toBeGreaterThanOrEqual(tall.length);
        [...gear.boxes, ...gear.pyramids, ...gear.tanks].forEach((item) => {
            expect(item.y - (item.height * 0.5)).toBeGreaterThan(STREET_Y + 15); // on a roof, not the street
            [item.x, item.y, item.z, item.width, item.height, item.depth].forEach((v) => expect(Number.isFinite(v)).toBe(true));
        });
        expect(planNeonArchitecture(towers, signs)).toEqual(plan);
        // Steam rises from the street's vents and from some of the roofs' air handlers.
        const vents = planNeonVents(gear);
        expect(vents.filter((vent) => vent.y < STREET_Y + 1).length).toBeGreaterThan(16);
        expect(vents.filter((vent) => vent.y > STREET_Y + 20).length).toBeGreaterThan(8);
    });

    it('deals far districts round the city, none in it and none behind the sun', () => {
        const far = dealFarCity();
        expect(far.length).toBeGreaterThan(900);
        expect(far.length).toBeLessThan(4200);
        const F = NEON_FAR_CITY;
        far.forEach((tower) => {
            const inCity = Math.abs(tower.x) < F.cityHalfWidth && tower.z > F.cityZ[0] && tower.z < F.cityZ[1];
            expect(inCity).toBe(false);
            if (tower.z < RETROSUN_CITY_POS[2]) {
                // The disc is a quad at the sun's place: no tower stands in the wedge behind it.
                expect(Math.abs(tower.x)).toBeGreaterThanOrEqual(F.sunWedge.margin);
            }
            expect(tower.y - (tower.height * 0.5)).toBeCloseTo(STREET_Y, 6);
            expect(Math.hypot(tower.x - F.centre[0], tower.z - F.centre[1])).toBeLessThanOrEqual(F.reach);
        });
        // A thinned tier keeps a subset of the same towers.
        const half = dealFarCity({ stride: 2 });
        expect(half.length).toBeGreaterThan(far.length * 0.4);
        expect(half.length).toBeLessThan(far.length * 0.6);
        const places = new Set(far.map((tower) => `${tower.x.toFixed(2)}:${tower.z.toFixed(2)}`));
        half.forEach((tower) => expect(places.has(`${tower.x.toFixed(2)}:${tower.z.toFixed(2)}`)).toBe(true));
        expect(dealFarCity()).toEqual(far);
    });
});

describe('chapter 8: the sky', () => {
    it('crosses from the night palette to first light, and lets the afterglow die at dusk', () => {
        const S = createNeonSkyUniforms();
        applyNeonSkyState(S, { dawn: 0 });
        expect(S.zenith.value.toArray()).toEqual(NEON_SKY_PALETTES.night.zenith);
        expect(S.horizonSun.value.x).toBeCloseTo(NEON_SKY_PALETTES.night.horizonSun[0], 6);
        applyNeonSkyState(S, { dawn: 1 });
        expect(S.zenith.value.x).toBeCloseTo(NEON_SKY_PALETTES.dawn.zenith[0], 6);
        expect(S.stars.value).toBeCloseTo(NEON_SKY_PALETTES.dawn.stars, 6);
        // Dusk dims what the sun still lights and brings the stars out; the dawn is not dimmed by it.
        applyNeonSkyState(S, { dawn: 0, dusk: 1 });
        expect(S.horizonSun.value.x).toBeLessThan(NEON_SKY_PALETTES.night.horizonSun[0] * 0.5);
        expect(S.zenith.value.toArray()).toEqual(NEON_SKY_PALETTES.night.zenith);
        expect(S.stars.value).toBeGreaterThan(NEON_SKY_PALETTES.night.stars);
        applyNeonSkyState(S, { dawn: 1, dusk: 1 });
        expect(S.horizonSun.value.x).toBeCloseTo(NEON_SKY_PALETTES.dawn.horizonSun[0], 6);
        // The clearing thins the deck but leaves cloud to catch the light.
        applyNeonSkyState(S, { cover: 0.8, clear: 1 });
        expect(S.cover.value).toBeGreaterThan(0.2);
        expect(S.cover.value).toBeLessThan(0.4);
        // First light keeps its colour: no channel of the dawn's zenith or cloud is grey.
        ['zenith', 'mid', 'cloudBody'].forEach((key) => {
            const [r, g, b] = NEON_SKY_PALETTES.dawn[key];
            expect(Math.max(r, g, b) / Math.max(1e-6, Math.min(r, g, b))).toBeGreaterThan(2);
        });
    });
});

describe("chapter 8: the journey's ending", () => {
    it('runs its clock only at the end of a finished journey, holds at the rest, and is taken back', () => {
        const state = { seconds: 0 };
        const step = (journeyEnd, complete, seconds = 1) => {
            for (let i = 0; i < seconds * 10; i += 1) advanceJourneyEnding(state, { journeyEnd, complete, dt: 0.1 });
            return state.seconds;
        };
        expect(step(1, false, 5)).toBe(0); // the journey is not done: the world waits
        expect(step(0.5, true, 5)).toBe(0); // not at the end yet
        expect(step(1, true, 5)).toBeCloseTo(5, 6);
        // Scrolling a little way back holds it; leaving takes it back.
        expect(step(0.6, true, 3)).toBeCloseTo(5, 6);
        expect(step(1, true, 200)).toBe(JOURNEY_ENDING.rest);
        expect(step(0.1, true, 1)).toBe(0);
        expect(advanceJourneyEnding(state, { journeyEnd: 1, complete: true, dt: Number.NaN })).toBe(0);
    });

    it('plays the wave, the night, the lanterns, the fireworks and the dawn in order, without a step', () => {
        const E = JOURNEY_ENDING;
        expect(E.wave[0]).toBeLessThan(E.lanterns);
        expect(E.lanterns).toBeLessThan(E.fireworks[0]);
        expect(E.fireworks[0]).toBeLessThan(E.dawn[0]);
        // The show's finale meets the first light; the sun is up at the rest.
        expect(E.dawn[0]).toBeLessThan(E.fireworks[1]);
        expect(E.sunrise[1]).toBeLessThanOrEqual(E.rest);
        expect(E.fireworks[1] - E.fireworks[0]).toBeCloseTo(NEON_FIREWORKS.seconds, 6);
        let previous = resolveJourneyEnding(0, 1);
        expect(previous).toMatchObject({
            shown: 0, wave: 0, dawn: 0, sunLift: 0,
        });
        for (let t = 0.05; t <= E.rest; t += 0.05) {
            const now = resolveJourneyEnding(t, 1);
            for (const key of ['wave', 'dusk', 'dawn']) {
                expect(now[key]).toBeGreaterThanOrEqual(previous[key] - 1e-9);
                expect(now[key] - previous[key]).toBeLessThan(0.02);
            }
            expect(now.sunLift - previous.sunLift).toBeLessThan(1.2);
            previous = now;
        }
        const rest = resolveJourneyEnding(E.rest, 1);
        expect(rest.wave).toBeCloseTo(1, 6);
        expect(rest.waveRadius).toBeCloseTo(E.waveRadius, 6);
        expect(rest.dawn).toBeCloseTo(1, 6);
        expect(rest.sunLift).toBeCloseTo(E.sunLift, 6);
        expect(rest.fireworks).toBe(-1); // the show is over
        expect(rest.lanterns).toBeGreaterThan(40); // still rising
        // The wave has passed the eye (515 u from the spire) within a few seconds of arriving.
        expect(resolveJourneyEnding(7, 1).waveRadius).toBeGreaterThan(515);
        expect(resolveJourneyEnding(3, 1).waveRadius).toBeLessThan(200);
        // Scrolling away dims everything smoothly.
        const leaving = resolveJourneyEnding(E.rest, 0.7);
        expect(leaving.dawn).toBeGreaterThan(0);
        expect(leaving.dawn).toBeLessThan(1);
        expect(resolveJourneyEnding(E.rest, 0.3).dawn).toBe(0);
    });

    it('lets the lanterns go in drifts, the boulevard first, and fills the upper sky with a show that builds', () => {
        const lanterns = planSkyLanterns(900);
        expect(lanterns).toHaveLength(900);
        // Drifts: fifteen let go from one place within a few seconds of each other.
        const drifts = new Map();
        lanterns.forEach((l) => {
            if (!drifts.has(l.drift)) drifts.set(l.drift, []);
            drifts.get(l.drift).push(l);
            expect(l.speed).toBeGreaterThan(0);
            expect(l.y).toBeGreaterThan(STREET_Y);
            expect(l.colour).toBeGreaterThanOrEqual(0);
            expect(l.colour).toBeLessThan(8);
        });
        expect(drifts.size).toBe(60);
        const mean = (list, key) => list.reduce((sum, l) => sum + l[key], 0) / list.length;
        const middles = [];
        drifts.forEach((drift) => {
            const cx = mean(drift, 'x');
            const cz = mean(drift, 'z');
            const delays = drift.map((l) => l.delay);
            drift.forEach((l) => expect(Math.hypot(l.x - cx, l.z - cz)).toBeLessThan(NEON_SKY_LANTERNS.spread * 2));
            expect(Math.max(...delays) - Math.min(...delays)).toBeLessThan(5.01);
            middles.push({ across: Math.abs(cx), delay: mean(drift, 'delay') });
        });
        // The boulevard's drifts go first; every drift is away within the release.
        const inner = middles.filter((m) => m.across < 60);
        const outer = middles.filter((m) => m.across > 150);
        expect(inner.length).toBeGreaterThan(8);
        expect(outer.length).toBeGreaterThan(3);
        expect(mean(inner, 'delay')).toBeLessThan(mean(outer, 'delay') - 4);
        lanterns.forEach((l) => expect(l.delay).toBeLessThan(NEON_SKY_LANTERNS.release + 5.01));

        const F = NEON_FIREWORKS;
        const shells = planFireworks(44);
        expect(shells).toHaveLength(44);
        const toDeg = 180 / Math.PI;
        shells.forEach((shell) => {
            expect(shell.at).toBeGreaterThanOrEqual(F.climb);
            // Every star is out before the show's curtain.
            expect(shell.at + shell.life).toBeLessThanOrEqual(F.seconds + 0.6 + 1e-9);
            // In the upper sky of the risen eye's view, and large in it.
            const dx = shell.x - F.eye[0];
            const dy = shell.y - F.eye[1];
            const dz = shell.z - F.eye[2];
            const distance = Math.hypot(dx, dy, dz);
            const elevation = Math.asin(dy / distance) * toDeg;
            const azimuth = Math.atan2(dx, -dz) * toDeg;
            expect(elevation).toBeGreaterThanOrEqual(F.elevation[0] - 1e-6);
            expect(elevation).toBeLessThanOrEqual(F.elevation[1] + 1e-6);
            expect(azimuth).toBeGreaterThanOrEqual(F.azimuth[0] - 1e-6);
            expect(azimuth).toBeLessThanOrEqual(F.azimuth[1] + 1e-6);
            expect(Math.atan(shell.radius / distance) * toDeg).toBeGreaterThan(8.9);
            expect(shell.y).toBeGreaterThan(200); // far over the roofs
        });
        // Spread over the sky, not bunched: shells in every third of the azimuth and both halves of the height.
        const third = (s) => Math.min(2, Math.floor((((Math.atan2(s.x - F.eye[0], -(s.z - F.eye[2])) * toDeg)
            - F.azimuth[0]) / (F.azimuth[1] - F.azimuth[0])) * 3));
        [0, 1, 2].forEach((k) => expect(shells.filter((s) => third(s) === k).length).toBeGreaterThan(9));
        // All four kinds fly, in all eight chapters' colours.
        expect(new Set(shells.map((s) => s.kind))).toEqual(new Set([
            SHELL_KIND.chrysanthemum, SHELL_KIND.willow, SHELL_KIND.ring, SHELL_KIND.crossette,
        ]));
        expect(new Set(shells.map((s) => s.colour)).size).toBe(8);
        // Several aloft at once through the opening, and a finale: the most aloft near the end.
        const aloft = (t) => shells.filter((s) => t >= s.at && t < s.at + s.life).length;
        let openingPeak = 0;
        let finalePeak = 0;
        let quiet = 0;
        for (let t = F.climb + 1; t < F.seconds - 2.5; t += 0.25) {
            const n = aloft(t);
            if (t < F.finale[0] * F.seconds) {
                openingPeak = Math.max(openingPeak, n);
                if (n === 0) quiet += 0.25;
            } else finalePeak = Math.max(finalePeak, n);
        }
        expect(openingPeak).toBeGreaterThanOrEqual(3);
        expect(quiet).toBeLessThan(1.6); // the sky is never empty for long
        expect(finalePeak).toBeGreaterThanOrEqual(8);
        expect(finalePeak).toBeGreaterThan(openingPeak + 2);
        expect(shells.filter((s) => s.finale).every((s) => s.radius >= 0)).toBe(true);

        // The light the shells throw: nothing before the show, a bounded wash in it, the strongest in the finale.
        const colours = JOURNEY_COLOURS_FALLBACK;
        expect(fireworksLightAt(shells, -1, colours)).toEqual([0, 0, 0]);
        expect(fireworksLightAt(shells, Number.NaN, colours)).toEqual([0, 0, 0]);
        let peak = 0;
        let finaleLight = 0;
        let previous = fireworksLightAt(shells, 0, colours).slice();
        for (let t = 1 / 60; t < F.seconds; t += 1 / 60) {
            const now = fireworksLightAt(shells, t, colours);
            const level = Math.max(...now);
            peak = Math.max(peak, level);
            if (t > F.finale[0] * F.seconds) finaleLight = Math.max(finaleLight, level);
            // It comes up over frames, never in one: no channel jumps by a quarter in a frame.
            for (let k = 0; k < 3; k += 1) expect(Math.abs(now[k] - previous[k])).toBeLessThan(0.25);
            previous = now.slice();
        }
        expect(peak).toBeGreaterThan(0.6);
        expect(peak).toBeLessThanOrEqual(1.45);
        expect(finaleLight).toBeGreaterThan(0.9);
    });

    it("takes the chapters' colours from the journey's chart", () => {
        const chart = [];
        for (let i = 0; i < 60; i += 1) {
            const chapter = Math.min(7, Math.floor(i / 8));
            chart.push({ colour: [chapter / 8, 0.5, 1 - (chapter / 8)] });
        }
        const colours = journeyColours(chart);
        expect(colours).toHaveLength(8);
        colours.forEach((c) => c.forEach((v) => expect(v).toBeGreaterThanOrEqual(0)));
        // Deepened, never greyed: each keeps its hue's order.
        expect(colours[0][2]).toBeGreaterThan(colours[0][0]);
        expect(colours[7][0]).toBeGreaterThan(colours[7][2]);
        expect(journeyColours(null)).toEqual(JOURNEY_COLOURS_FALLBACK.map((c) => [...c]));
        expect(journeyColours([{ colour: [1, 0, 0] }])).toHaveLength(8);
    });

    it('answers a finished journey at the end of the rail, and only then', () => {
        const group = createUrbanDreamsEnvironment();
        group.updateMatrixWorld(true);
        const { corridor, neon, uniforms } = group.userData;
        const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 9000);
        camera.position.copy(corridor.localToWorld(new THREE.Vector3(2, 150, -40)));
        camera.updateMatrixWorld(true);
        const chart = (done) => Array.from({ length: 60 }, (_, i) => ({
            id: i + 1, position: new THREE.Vector3(i, i * 20, 0), colour: [1, 0.5, 0.2], completed: i < done, stars: 3,
        }));
        const run = (seconds, time0 = 0) => {
            for (let i = 0; i < seconds * 10; i += 1) updateUrbanDreamsEnvironment(group, 0.1, time0 + (i * 0.1), camera, 1.0);
        };
        // 59 orbs done: the last light, no ending.
        group.userData.journeyEnd = 1;
        group.userData.journeyChart = chart(59);
        run(20);
        expect(group.userData.endingNow.seconds).toBe(0);
        expect(neon.endWave.value).toBe(0);
        expect(neon.sky.dawn.value).toBe(0);
        expect(group.userData.skyLanterns.mesh.visible).toBe(false);
        expect(uniforms.uDim.value).toBeGreaterThan(0.3); // the resolve still gutters the city
        const sunkY = neon.sunPos.value.y;
        expect(sunkY).toBeLessThan(RETROSUN_CITY_POS[1] - 40);

        // Every orb done: the wave, the lanterns, the show, the dawn.
        group.userData.journeyChart = chart(60);
        run(9, 20);
        expect(group.userData.endingNow.seconds).toBeCloseTo(9, 1);
        expect(neon.endWave.value).toBeGreaterThan(515);
        expect(uniforms.uDim.value).toBeLessThan(0.05); // every building back on
        expect(group.userData.skyLanterns.mesh.visible).toBe(true);
        expect(neon.sky.dawn.value).toBe(0);
        run(8, 29);
        expect(group.userData.fireworks.mesh.visible).toBe(true); // the eye is over the roofs
        // The shells aloft wash the sky and the city, and the smoke the earlier ones left.
        let washed = 0;
        for (let i = 0; i < 40; i += 1) {
            updateUrbanDreamsEnvironment(group, 0.1, 37 + (i * 0.1), camera, 1.0);
            washed = Math.max(washed, neon.sky.burst.value.x + neon.sky.burst.value.y + neon.sky.burst.value.z);
            expect(group.userData.fireworks.uniforms.burst.value.equals(neon.sky.burst.value)).toBe(true);
        }
        expect(washed).toBeGreaterThan(0.1);
        expect(washed).toBeLessThan(3);
        run(50, 41);
        expect(group.userData.endingNow.seconds).toBe(JOURNEY_ENDING.rest);
        expect(neon.sky.dawn.value).toBeCloseTo(1, 6);
        expect(neon.sunPos.value.y).toBeGreaterThan(sunkY + 150);
        expect(group.userData.sun.position.y).toBe(neon.sunPos.value.y);
        expect(group.userData.fireworks.mesh.visible).toBe(false);
        expect(neon.sky.burst.value.lengthSq()).toBe(0); // no wash once the show is over
        expect(group.userData.skyLanterns.mesh.visible).toBe(true); // the rest: still rising
        expect(uniforms.uRainDensity.value).toBe(0);

        // From the street (reduced motion, the Low tier) there is no show: the shells burst
        // over the skyline, behind the towers.
        camera.position.copy(corridor.localToWorld(new THREE.Vector3(2, 14, -40)));
        camera.updateMatrixWorld(true);
        group.userData.ending.seconds = 20;
        run(1, 100);
        expect(group.userData.fireworks.mesh.visible).toBe(false);

        // Leaving takes it back: the next arrival plays it again.
        group.userData.journeyEnd = 0;
        run(1, 110);
        expect(group.userData.endingNow.seconds).toBe(0);
        expect(neon.sky.dawn.value).toBe(0);
        expect(neon.endWave.value).toBe(0);
        expect(group.userData.skyLanterns.mesh.visible).toBe(false);
    });
});
