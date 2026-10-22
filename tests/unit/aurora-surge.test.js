import * as THREE from 'three/webgpu';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { AuroraDirector } from '../../src/themes/aurora/aurora-director.js';
import {
    CORONA_ARC_INDEX, EXCITATION, ExcitationMap, SWEEP,
} from '../../src/themes/aurora/aurora-field.js';
import { AuroraWorld } from '../../src/themes/aurora/aurora-world.js';

function create(seed = 11) {
    const excitation = new ExcitationMap();
    const director = new AuroraDirector({ excitation, seed });
    return { director, excitation };
}

function advance(director, seconds, hz = 60) {
    let elapsed = 0;
    while (elapsed < seconds - 1e-9) {
        const delta = Math.min(1 / hz, seconds - elapsed);
        director.update(delta);
        elapsed += delta;
    }
}

const lock = (x = 3, color = '#6cf5ff') => ({
    piece: {
        x, y: 18, shape: [[1, 1, 1, 1]], color,
    },
});
const clear = (lineCount = 1, cascadeCount = 1) => ({
    lineCount, clearedRows: Array.from({ length: lineCount }, (_, i) => 23 - i), cascadeCount,
});
const liveBands = (director) => director.sweeps.filter((band) => band.age >= 0 && band.age < band.life);
const youngest = (director) => liveBands(director).reduce((a, b) => (b.age < a.age ? b : a));
/** Pulses the last frame launched (cues resolve at the time before the frame steps). */
const bornNow = (director) => director.pulses.filter((pulse) => pulse.active && pulse.born > director.time - 0.02);

/** A hard-dropped piece that clears `lines`, resolved in one frame. */
function clearingLock(director, lines = 1, { b2b = false, tspin = false } = {}) {
    director.onHardDrop({ distance: 16 });
    director.onPieceLock(lock());
    director.onLineClear(clear(lines));
    if (tspin) director.onTSpin({ lineCount: lines });
    if (b2b) director.onBackToBack({ active: true });
    director.update(1 / 60);
}

/** The tray's Fever, in short: twelve clearing locks 640 ms apart, ending in a quad. */
const CHAIN = [1, 1, 2, 1, 2, 2, 3, 2, 2, 3, 3, 4];

describe('Aurora builds with play instead of popping', () => {
    it('a weak clear right after a quad never cuts the quad\'s band or its light', () => {
        const { director } = create();
        clearingLock(director, 4);
        advance(director, 0.3);
        const quadBand = youngest(director);
        const { sweepGain, corona, activity } = director;
        const altitude = director.sweepAltitude;

        clearingLock(director, 1);
        // The quad's band runs on above where it was; the single climbs below it.
        expect(quadBand.age).toBeGreaterThan(0.3);
        expect(liveBands(director)).toHaveLength(2);
        expect(Math.max(...director.sweepBands.filter((_, i) => i % 4 === 0))).toBeGreaterThan(altitude);
        expect(director.sweepGain).toBeGreaterThan(sweepGain);
        expect(director.corona).toBeGreaterThanOrEqual(corona * 0.99);
        expect(director.activity).toBeGreaterThanOrEqual(activity);
    });

    it('never restarts a band in flight for a weaker one: every slot busy, the faintest is lifted', () => {
        const { director } = create();
        for (let i = 0; i < SWEEP.slots; i += 1) director.launchSweep(0.9);
        director.update(1 / 60);
        const ages = director.sweeps.map((band) => band.age);
        const before = director.sweepGain;
        director.launchSweep(0.2);
        director.update(0);
        expect(director.sweeps.map((band) => band.age)).toEqual(ages);
        expect(director.sweepGain).toBeGreaterThan(before);
    });

    it('eases the storm hue: a streak step never jumps it, and a new chain carries on from what is shown', () => {
        const { director } = create();
        let biggestStep = 0;
        let last = director.stormTint;
        const watch = () => {
            biggestStep = Math.max(biggestStep, Math.abs(director.stormTint - last));
            last = director.stormTint;
        };
        for (let i = 0; i < 9; i += 1) {
            clearingLock(director, 2);
            watch();
            for (let f = 0; f < 30; f += 1) {
                director.update(1 / 60);
                watch();
            }
        }
        const stormy = director.stormTint;
        expect(stormy).toBeGreaterThan(2.5);
        // A dry lock ends the chain; the next chain's first link must not snap the sky back.
        director.onPieceLock(lock());
        director.update(1 / 60);
        clearingLock(director, 1);
        clearingLock(director, 1);
        expect(director.stormTint).toBeGreaterThan(stormy - 0.1);
        expect(biggestStep).toBeLessThan(0.1);
    });

    it('a long chain reads hotter than its first clear, and peaks late', () => {
        const { director } = create();
        const reading = () => ({
            level: director.heatLevel,
            fever: director.heatFever,
            stage: director.heatStage,
            storm: director.tint[3],
            corona: director.corona,
            crown: director.crown,
            compress: director.compress,
        });
        const shots = [];
        CHAIN.forEach((lines) => {
            clearingLock(director, lines);
            advance(director, 0.3);
            shots.push(reading());
            advance(director, 0.34);
        });
        const [first] = shots;
        const last = shots.at(-1);
        expect(first.stage).toBe(0);
        expect(first.fever).toBe(0);
        expect(first.storm).toBeLessThan(0.05);
        expect(last.stage).toBe(3);
        expect(last.fever).toBeGreaterThan(0.6);
        expect(last.level).toBeGreaterThan(first.level + 0.5);
        expect(last.storm).toBeGreaterThan(first.storm + 0.5);
        expect(last.corona).toBeGreaterThan(0.5);
        expect(last.crown).toBeGreaterThan(first.crown);
        expect(last.compress).toBeGreaterThan(first.compress);
        // Gentle first: the fever does not light in the first half of the chain.
        expect(shots[3].fever).toBe(0);
        // The heat only rises through the chain (each reading at least the one before, give or take).
        for (let i = 1; i < shots.length; i += 1) expect(shots[i].level).toBeGreaterThan(shots[i - 1].level - 0.05);
    });

    it('keeps the storm a colour: the body turns round the hue circle, never through grey', () => {
        const { director } = create();
        CHAIN.forEach((lines) => {
            clearingLock(director, lines);
            advance(director, 0.64);
            const [r, g, b] = director.stormColor;
            const high = Math.max(r, g, b);
            expect((high - Math.min(r, g, b)) / high).toBeGreaterThan(0.6);
        });
        // The shader's mix of the average resting green toward the tint lands on that colour.
        const weight = director.tint[3];
        const green = [0.115, 0.94, 0.385];
        green.forEach((value, i) => {
            expect(value + (director.tint[i] - value) * weight).toBeCloseTo(director.stormColor[i], 5);
        });
        expect(weight).toBeGreaterThan(0.5);
    });

    it('breathes back to an exactly calm sky once the hands rest', () => {
        const { director, excitation } = create();
        CHAIN.forEach((lines) => {
            clearingLock(director, lines);
            advance(director, 0.64);
        });
        director.onPerfectClear({});
        director.update(1 / 60);
        expect(director.heatStage).toBe(3);
        advance(director, 12);
        expect(director.heatStage).toBeLessThanOrEqual(1);
        expect(director.heatFever).toBe(0);
        advance(director, 90);
        expect(director.heatLevel).toBe(0);
        expect(director.activity).toBe(0);
        expect(director.corona).toBe(0);
        expect(director.tint[3]).toBe(0);
        expect(director.sweepGain).toBe(0);
        excitation.commit();
        expect(excitation.commit()).toBe(false);
    });

    it('builds each cascade wave on the last: a brighter, faster, wider band and a stronger surge', () => {
        const { director } = create();
        clearingLock(director, 2);
        const bands = [];
        const surges = [];
        for (let depth = 2; depth <= 4; depth += 1) {
            advance(director, 0.36);
            director.onCascade({ comboCount: depth });
            director.onLineClear(clear(1, depth));
            director.update(1 / 60);
            const band = youngest(director);
            bands.push({ strength: band.strength, life: band.life, width: band.width });
            surges.push(Math.max(...bornNow(director).map((pulse) => pulse.amp)));
        }
        for (let i = 1; i < bands.length; i += 1) {
            expect(bands[i].strength).toBeGreaterThan(bands[i - 1].strength);
            expect(bands[i].life).toBeLessThan(bands[i - 1].life);
            expect(bands[i].width).toBeGreaterThan(bands[i - 1].width);
            expect(surges[i]).toBeGreaterThanOrEqual(surges[i - 1]);
        }
        // A later wave is not a new clear in the chain.
        expect(director.boards[0].tracker.combo).toBe(1);
    });

    it('crowns the clear still playing on a late perfect clear: no second strum, amber in the corona', () => {
        const { director } = create();
        clearingLock(director, 4);
        advance(director, 0.36);
        const quadBand = youngest(director);
        const punch = director.heatPunch;
        director.onPerfectClear({ depth: 4 });
        director.update(1 / 60);
        const fresh = bornNow(director);
        expect(fresh.some((pulse) => pulse.shift !== 0)).toBe(false);
        const corona = fresh.filter((pulse) => pulse.row === CORONA_ARC_INDEX);
        expect(corona).toHaveLength(1);
        expect(corona[0].red).toBe(1);
        expect(corona[0].blue).toBeLessThan(0.1);
        expect(quadBand.age).toBeGreaterThan(0.36);
        expect(director.heatPunch).toBeGreaterThan(punch);
        expect(director.boards[0].tracker.combo).toBe(1);
    });

    it('answers a back-to-back with a crimson wave that grows with the run, and a plain clear ends the run', () => {
        const crimson = (director) => bornNow(director)
            .filter((pulse) => pulse.red === 1 && pulse.green < 0.1 && pulse.blue < 0.3)
            .reduce((most, pulse) => Math.max(most, pulse.amp), 0);
        const { director } = create();
        clearingLock(director, 4);
        expect(crimson(director)).toBe(0);
        advance(director, 1.4);
        clearingLock(director, 4, { b2b: true });
        const first = crimson(director);
        advance(director, 1.4);
        clearingLock(director, 2, { b2b: true, tspin: true });
        const second = crimson(director);
        expect(first).toBeGreaterThan(0);
        expect(second).toBeGreaterThan(first);
        expect(director.b2bCount).toBe(2);
        advance(director, 1.4);
        clearingLock(director, 1);
        expect(director.b2bCount).toBe(0);
    });

    it('shows something small for a T-spin that clears nothing', () => {
        const { director } = create();
        director.onPieceLock(lock(4, '#c18bff'));
        director.onTSpin({ lineCount: 0 });
        director.update(1 / 60);
        const twist = bornNow(director).filter((pulse) => pulse.shift !== 0);
        expect(twist.length).toBeGreaterThan(0);
        expect(director.violetKick).toBeGreaterThan(0.3);
        expect(director.rippleCount).toBe(2);

        const plain = create().director;
        plain.onPieceLock(lock(4, '#c18bff'));
        plain.update(1 / 60);
        expect(director.heatPunch).toBeGreaterThan(plain.heatPunch);
    });

    it('warms the storm from locks whose pluck is switched off', () => {
        const { director } = create();
        for (let i = 0; i < 20; i += 1) {
            director.onHardDrop({ distance: 12 });
            director.onPieceLock(lock(i % 7), false);
            advance(director, 0.3);
        }
        expect(director.heatLevel).toBeGreaterThan(0.1);
        expect(director.pulses.some((pulse) => pulse.active)).toBe(false);
    });

    it('pulses the curtains with each lock in hot play, quieted by Reduce flashing', () => {
        const run = (flashing) => {
            const { director } = create();
            director.flashing = flashing;
            CHAIN.slice(0, 6).forEach((lines) => {
                clearingLock(director, lines);
                advance(director, 0.64);
            });
            expect(director.heatStage).toBeGreaterThanOrEqual(2);
            advance(director, 0.9);
            director.onPieceLock(lock());
            director.update(1 / 60);
            return youngest(director).strength;
        };
        expect(run(1)).toBeGreaterThan(0.15);
        expect(run(0.08)).toBeLessThan(0.05);
    });
});

describe('Aurora pools that fill instead of cutting', () => {
    const worlds = [];
    afterEach(() => {
        for (const world of worlds) world.dispose();
        worlds.length = 0;
        vi.restoreAllMocks();
    });
    const createWorld = (quality) => {
        const world = new AuroraWorld({
            scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 12000), quality,
        });
        worlds.push(world);
        return world;
    };

    it('keeps a strong lake ring spreading while weak ones come and go', () => {
        const { landscape } = createWorld('Minimal');
        landscape.ripple(0, 0, -80, 1.4, [1, 0.5, 0.1]);
        for (let i = 1; i <= 8; i += 1) landscape.ripple(i * 0.1, i, -60, 0.3, [0, 1, 1]);
        expect(landscape.rippleData.some((ring) => ring.w === 1.4 && ring.z === 0)).toBe(true);
    });

    it('defers a meteor volley larger than the sky\'s slots into a shower, dropping none', () => {
        const world = createWorld('Minimal');
        const launchMeteor = world.sky.launchMeteor.bind(world.sky);
        const starts = [];
        vi.spyOn(world.sky, 'launchMeteor').mockImplementation((time, ...rest) => {
            starts.push(time);
            return launchMeteor(time, ...rest);
        });
        const meteor = {
            fromAzimuth: 0.4,
            fromElevation: 0.5,
            toAzimuth: 0.6,
            toElevation: 0.3,
            duration: 0.8,
            brightness: 1,
            warmth: 0,
        };
        for (let i = 0; i < 7; i += 1) world.queueMeteor(meteor, 0);
        for (let frame = 1; frame <= 600; frame += 1) world.launchDueMeteors(frame / 60);
        expect(starts).toHaveLength(7);
        // Each waits for a slot to come free (Minimal has two); only a meteor that has waited
        // its full patience takes the one furthest through its flight.
        for (let i = 2; i < 6; i += 1) expect(starts[i] - starts[i - 2]).toBeGreaterThanOrEqual(0.8 - 1e-6);
        expect(starts[6] - starts[4]).toBeGreaterThan(0.6);
    });

    it('re-saturates where pulses of different colours overlap, and leaves a lone pulse alone', () => {
        const map = new ExcitationMap();
        map.begin();
        map.accumulate(0, 0, 80, 0, 0.5, 0.5);
        map.accumulate(0, 0, 80, 0.5, 0.1, 0.4);
        map.commit();
        // The sum there is about [0.5, 0.6, 0.9]: a pale lilac before, a clear blue-violet after.
        const centre = Math.round(map.width / 2) * 4;
        const [r, g, b] = map.data.slice(centre, centre + 3);
        const peak = (0.9 * 255) / EXCITATION.maxGlow;
        expect(Math.abs(Math.max(r, g, b) - peak)).toBeLessThan(3);
        expect(Math.min(r, g, b) / Math.max(r, g, b)).toBeLessThan((0.5 / 0.9) * 0.6);

        const lone = new ExcitationMap();
        lone.begin();
        lone.accumulate(1, 0, 80, 1, 0, 0);
        lone.commit();
        const at = (lone.width + Math.round(lone.width / 2)) * 4;
        expect(lone.data[at]).toBeGreaterThan(120);
        expect([lone.data[at + 1], lone.data[at + 2]]).toEqual([0, 0]);
    });
});
