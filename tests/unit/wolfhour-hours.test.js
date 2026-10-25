import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    WOLFHOUR_HOURS, WOLFHOUR_HOUR_COLOURS, WOLFHOUR_HOUR_HOLD, WOLFHOUR_HOUR_SCALARS, WOLFHOUR_HOUR_SECONDS,
    WolfhourNightClock, wolfhourHourAt, wolfhourHourDrift, wolfhourHourName,
} from '../../src/themes/wolfhour/wolfhour-hours.js';
import { createWolfhourNightLight, createWolfhourSky } from '../../src/themes/wolfhour/wolfhour-sky.js';
import { createWolfhourLandscape } from '../../src/themes/wolfhour/wolfhour-landscape.js';
import { createWolfhourMist } from '../../src/themes/wolfhour/wolfhour-mist.js';
import { createWolfhourForest } from '../../src/themes/wolfhour/wolfhour-forest.js';
import { createWolfhourPack } from '../../src/themes/wolfhour/wolfhour-wolves.js';
import { createWolfhourHut } from '../../src/themes/wolfhour/wolfhour-hut.js';
import { createWolfhourSpindrift } from '../../src/themes/wolfhour/wolfhour-spindrift.js';
import { WolfhourGrade } from '../../src/themes/wolfhour/wolfhour-grade.js';
import WolfhourTheme from '../../src/themes/wolfhour/wolfhour-theme.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const N = WOLFHOUR_HOURS.length;
const P = WOLFHOUR_HOUR_SECONDS;
const REST_END = P * WOLFHOUR_HOUR_HOLD;
const owned = [];

function distance(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Does `material`'s colour graph read the uniform `node`? */
function reads(material, node) {
    let found = false;
    material.colorNode.traverse((child) => { if (child === node) found = true; });
    return found;
}

describe('Wolfhour hours of the night', () => {
    it('keeps a house pace: 80 s or more an hour, with a rest before each melt', () => {
        expect(N).toBeGreaterThanOrEqual(4);
        expect(N).toBeLessThanOrEqual(6);
        expect(P).toBeGreaterThanOrEqual(80);
        expect(WOLFHOUR_HOUR_HOLD).toBeGreaterThanOrEqual(0.3);
        expect(WOLFHOUR_HOUR_HOLD).toBeLessThanOrEqual(0.4);
        expect(new Set(WOLFHOUR_HOURS.map((hour) => hour.name)).size).toBe(N);
        for (const hour of WOLFHOUR_HOURS) {
            for (const key of WOLFHOUR_HOUR_COLOURS) {
                expect(hour[key], `${hour.name} ${key}`).toHaveLength(3);
                expect(hour[key].every((c) => Number.isFinite(c) && c >= 0), `${hour.name} ${key}`).toBe(true);
            }
            for (const key of WOLFHOUR_HOUR_SCALARS) expect(hour[key] > 0, `${hour.name} ${key}`).toBe(true);
        }
    });

    it('opens on the night as it always was: every tint 1, the sky its authored colours', () => {
        const [first] = WOLFHOUR_HOURS;
        for (const key of ['moon', 'shade', 'air', 'glow', 'cloud', 'disc']) expect(first[key]).toEqual([1, 1, 1]);
        const light = createWolfhourNightLight();
        expect(light.uSkyLow.value.toArray()).toEqual([...first.skyLow]);
        expect(light.uSkyHigh.value.toArray()).toEqual([...first.skyHigh]);
        expect(light.uMoon.value.toArray()).toEqual([1, 1, 1]);
        expect(light.uStars.value).toBe(first.stars);
        expect([first.exposure, first.cool]).toEqual([1, 1]);
    });

    it('turns by the clock alone: each hour rests, then melts into the next, and never runs back', () => {
        expect(wolfhourHourDrift(0)).toBe(0);
        expect(wolfhourHourDrift(REST_END - 0.5)).toBe(0);
        expect(wolfhourHourDrift(P)).toBe(1);
        expect(wolfhourHourDrift(4 * P + 2)).toBe(4);
        let last = 0;
        for (let t = 0; t <= 2 * N * P; t += 0.5) {
            const phase = wolfhourHourDrift(t);
            expect(phase).toBeGreaterThanOrEqual(last);
            expect(phase - last).toBeLessThan(0.05);
            last = phase;
        }
    });

    it('is each hour exactly on a whole phase, and every hour clearly its own', () => {
        WOLFHOUR_HOURS.forEach((hour, index) => {
            const at = wolfhourHourAt(index + N);
            for (const key of WOLFHOUR_HOUR_COLOURS) expect(at[key]).toEqual([...hour[key]]);
            for (const key of WOLFHOUR_HOUR_SCALARS) expect(at[key]).toBe(hour[key]);
            expect(wolfhourHourName(index - 0.2)).toBe(hour.name);
            const next = WOLFHOUR_HOURS[(index + 1) % N];
            const apart = distance(hour.moon, next.moon) + distance(hour.skyLow, next.skyLow) * 10
                + distance(hour.air, next.air) + Math.abs(hour.stars - next.stars);
            expect(apart, `${hour.name} -> ${next.name}`).toBeGreaterThan(0.3);
        });
    });

    it('steps a level an hour on top of the clock, eased the short way round, and lands on it', () => {
        const clock = new WolfhourNightClock();
        expect(clock.update(5, 1 / 60)).toBe(0);
        clock.setLevel(2);
        const first = clock.update(5, 1 / 60);
        expect(first).toBeGreaterThan(0);
        expect(first).toBeLessThan(0.05);
        for (let i = 0; i < 60 * 30; i += 1) clock.update(5, 1 / 60);
        expect(clock.phase).toBe(1);
        // On top of the clock: an hour of the clock later it is two on.
        expect(clock.update(5 + P, 0)).toBe(2);
        // The night is a circle: from level 2 to level N the short way is back one hour.
        clock.setLevel(N);
        for (let i = 0; i < 60 * 30; i += 1) clock.update(5, 1 / 60);
        expect(clock.step).toBe(-1);
        // Silent is there at once; nonsense keeps the level; a bad time keeps the phase.
        clock.setLevel(1, { silent: true });
        expect(clock.step).toBe(0);
        expect(clock.setLevel('x')).toBe(1);
        const kept = clock.update(5, 0);
        expect(clock.update(NaN, 0)).toBe(kept);
    });
});

describe('Wolfhour night light in the valley', () => {
    beforeEach(() => {
        vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(() => new THREE.Texture());
    });
    afterEach(() => {
        for (const part of owned.splice(0)) part.dispose();
        vi.restoreAllMocks();
    });

    it('lets every part of the valley wear the sky\'s hour', () => {
        const sky = createWolfhourSky({ scene: new THREE.Scene(), quality: 'High' });
        const { nightLight, noiseMap } = sky;
        const landscape = createWolfhourLandscape({ quality: 'Low', seed: 73013, nightLight });
        const mist = createWolfhourMist({ quality: 'High', noiseMap, nightLight });
        const forest = createWolfhourForest({ quality: 'High', nightLight });
        const pack = createWolfhourPack({ quality: 'High', noiseMap, nightLight });
        const hut = createWolfhourHut({ quality: 'High', noiseMap, nightLight });
        const spindrift = createWolfhourSpindrift({ quality: 'High', noiseMap, nightLight });
        owned.push(spindrift, hut, pack, forest, mist, landscape, sky);
        // (The ranges' colour is one Fn, built late: the light it was made with is what it reads.)
        expect(landscape.nightLight).toBe(nightLight);
        expect(reads(mist.banks[0].material, nightLight.uAir)).toBe(true);
        forest.stand(landscape);
        expect(reads(forest.meshes[0].material, nightLight.uMoon)).toBe(true);
        expect(reads(spindrift.plumes[0].material, nightLight.uMoon)).toBe(true);
        expect(reads(hut.group.getObjectByName('Wolfhour hut roof snow').material, nightLight.uMoon)).toBe(true);
        expect(reads(sky.group.getObjectByName('Wolfhour sky plane').material, nightLight.uSkyLow)).toBe(true);
        // An hour into the uniforms, exactly.
        const alpenglow = WOLFHOUR_HOURS.findIndex((hour) => hour.name === 'alpenglow');
        sky.setHour(wolfhourHourAt(alpenglow));
        expect(nightLight.uMoon.value.toArray()).toEqual([...WOLFHOUR_HOURS[alpenglow].moon]);
        expect(nightLight.uSkyLow.value.toArray()).toEqual([...WOLFHOUR_HOURS[alpenglow].skyLow]);
        expect(nightLight.uStars.value).toBe(WOLFHOUR_HOURS[alpenglow].stars);
        sky.setHour(null);
        expect(nightLight.uStars.value).toBe(WOLFHOUR_HOURS[alpenglow].stars);
    });

    it('sets the grade\'s iris and its lean to blue from the hour', () => {
        const grade = { uHourExposure: { value: 1 }, uHourCool: { value: 1 } };
        const deep = WOLFHOUR_HOURS.findIndex((hour) => hour.name === 'deep midnight');
        WolfhourGrade.prototype.setHour.call(grade, wolfhourHourAt(deep));
        expect(grade.uHourExposure.value).toBe(WOLFHOUR_HOURS[deep].exposure);
        expect(grade.uHourCool.value).toBe(WOLFHOUR_HOURS[deep].cool);
        WolfhourGrade.prototype.setHour.call(grade, {});
        expect(grade.uHourExposure.value).toBe(WOLFHOUR_HOURS[deep].exposure);
    });
});

describe('Wolfhour theme hours', () => {
    let unsubscribers = [];
    beforeEach(() => {
        vi.stubGlobal('window', {
            settings: { backgroundComboEffects: false },
            location: { search: '' },
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
    });
    afterEach(() => {
        unsubscribers.forEach((off) => off());
        unsubscribers = [];
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    function listening() {
        const theme = new WolfhourTheme();
        theme.isActive = true;
        theme.celestialSky = { setHour: vi.fn() };
        theme.postProcessing = { setHour: vi.fn() };
        vi.spyOn(theme, 'onLevelUp').mockImplementation(() => {});
        theme.setupEventListeners();
        unsubscribers = theme.eventUnsubscribers;
        return theme;
    }

    it('turns its night by the clock alone in every mode, with no level-up', () => {
        const theme = listening();
        theme.time = 5;
        theme.updateNightHour(1 / 60);
        expect(theme.celestialSky.setHour).toHaveBeenLastCalledWith(theme.nightHour);
        expect(theme.nightHour.moon).toEqual([...WOLFHOUR_HOURS[0].moon]);
        theme.time = 2 * P + 5;
        expect(theme.updateNightHour(1 / 60)).toBe(2);
        expect(theme.nightHour.skyLow).toEqual([...WOLFHOUR_HOURS[2].skyLow]);
        expect(theme.postProcessing.setHour).toHaveBeenLastCalledWith(theme.nightHour);
    });

    it('steps the night an hour on at every level-up whatever the effects setting, and keeps the reaction', () => {
        const theme = listening();
        theme.time = 5;
        eventBus.emit(EVENTS.LEVEL_UP, { level: 2 });
        // Effects off: the reaction is held, the night still turns.
        expect(theme.onLevelUp).not.toHaveBeenCalled();
        expect(theme.level).toBe(2);
        for (let i = 0; i < 60 * 30; i += 1) theme.updateNightHour(1 / 60);
        expect(theme.nightClock.phase).toBe(1);
        expect(theme.nightHour.moon).toEqual([...WOLFHOUR_HOURS[1].moon]);
        window.settings.backgroundComboEffects = true;
        eventBus.emit(EVENTS.LEVEL_UP, { detail: { level: 3 } });
        expect(theme.onLevelUp).toHaveBeenCalledOnce();
        expect(theme.level).toBe(3);
        // A level-up naming no level is the next; a rebuild carries the level.
        eventBus.emit(EVENTS.LEVEL_UP, {});
        expect(theme.level).toBe(4);
        expect(theme.captureRestartRun().level).toBe(4);
        // The run over, the next begins at the first level's hour.
        const gameOver = window.addEventListener.mock.calls.find(([name]) => name === 'gameOver')[1];
        gameOver();
        expect(theme.level).toBe(1);
        expect(theme.nightClock.level).toBe(1);
    });
});
