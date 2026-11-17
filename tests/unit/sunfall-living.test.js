/**
 * Sunfall's living doline (2026-11): the weathers as five different airs, the cloud that crosses
 * the sun, the chain's shafts, the beats the world's life answers, and what play lets loose
 * (a blossom per lock, petals at the rows a clear takes, beads off a snapped strand, a whirl, a
 * rain of petals, birds). The shaders themselves are gated in sunfall-shaders.test.js.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import { SunfallWorld } from '../../src/themes/sunfall/sunfall-world.js';
import { SunfallDirector } from '../../src/themes/sunfall/sunfall-director.js';
import {
    SUNFALL_LAYOUT, SUNFALL_SHAFTS, SUNFALL_TIMINGS, SUNFALL_WEATHERS, WEATHER_FIELDS, sampleWeather,
} from '../../src/themes/sunfall/sunfall-core.js';
import { BOARD_VIEWPORT, cameraRigFor, projectWorldToNdc } from '../../src/themes/sunfall/sunfall-composition.js';
import { SUNFALL_QUALITY_ORDER, SUNFALL_QUALITY_PRESETS } from '../../src/themes/sunfall/sunfall-quality.js';
import { SUNFALL_FALLS } from '../../src/themes/sunfall/sunfall-water.js';
import { BLOSSOM_LIFE } from '../../src/themes/sunfall/sunfall-strands.js';
import { FLORA_CODE, FLORA_KIND } from '../../src/themes/sunfall/sunfall-flora.js';
import { loadSunfallAssetsFromDisk } from './helpers/sunfall-assets-disk.js';

vi.setConfig({ testTimeout: 60_000 });

const DT = 1 / 60;
const run = (dir, seconds, each) => {
    let snap = dir.getSnapshot();
    const frames = Math.round(seconds / DT);
    for (let i = 0; i < frames; i += 1) {
        snap = dir.step(DT);
        each?.(snap);
    }
    return snap;
};

describe('sunfall weathers', () => {
    it('are five airs that differ where it shows', () => {
        expect(SUNFALL_WEATHERS.map((w) => w.id)).toEqual(['clear', 'mist', 'shower', 'steam', 'cloud']);
        for (const weather of SUNFALL_WEATHERS) {
            for (const field of WEATHER_FIELDS) {
                expect(Number.isFinite(weather[field]), `${weather.id}.${field}`).toBe(true);
            }
        }
        const by = Object.fromEntries(SUNFALL_WEATHERS.map((w) => [w.id, w]));
        // A clear hour leaves the vault open (the deck hangs past 0.35); the cloud's is the full deck.
        expect(by.clear.cloudOpacity).toBeLessThan(0.35);
        expect(by.cloud.cloudOpacity).toBe(1);
        // Mist is the thickest air, rain falls only in the shower, steam rises only after it.
        expect(by.mist.mistScale).toBeGreaterThan(by.clear.mistScale * 1.8);
        expect(SUNFALL_WEATHERS.filter((w) => w.rain > 0).map((w) => w.id)).toEqual(['shower']);
        expect(by.steam.steam).toBe(1);
        // The clear hour combs the column deepest; the sun is never dimmer than three quarters.
        expect(by.clear.shafts).toBe(1);
        SUNFALL_WEATHERS.forEach((w) => expect(w.sun).toBeGreaterThan(0.75));
    });

    it('blend every field as one crosses into the next', () => {
        const mid = sampleWeather('clear', 'shower', 0.5);
        for (const field of WEATHER_FIELDS) {
            const a = SUNFALL_WEATHERS[0][field];
            const b = SUNFALL_WEATHERS[2][field];
            expect(mid[field]).toBeCloseTo((a + b) / 2, 6);
        }
    });

    it('raise the steam only while the weather steams', () => {
        const dir = new SunfallDirector({ level: 1 });
        dir.setWeather('clear');
        expect(run(dir, 3).steamClock).toBe(0);
        dir.setWeather('steam');
        const snap = run(dir, 2);
        expect(snap.steamClock).toBeGreaterThan(5);
        expect(snap.weather.steam).toBe(1);
    });
});

describe('the cloud that crosses the sun', () => {
    it('comes on its own clock, shades the opening and leaves', () => {
        const dir = new SunfallDirector({ level: 1 });
        expect(dir.getSnapshot().sunShade).toBe(0);
        let peak = 0;
        let passes = 0;
        let shaded = false;
        run(dir, SUNFALL_TIMINGS.cloudPassMax * 2 + 40, (snap) => {
            peak = Math.max(peak, snap.sunShade);
            const now = snap.sunShade > 0.5;
            if (now && !shaded) passes += 1;
            shaded = now;
            expect(snap.sunShade).toBeGreaterThanOrEqual(0);
            expect(snap.sunShade).toBeLessThanOrEqual(1);
            // The shader's band: its leading edge ahead of its trailing one.
            expect(snap.cloudPass[2]).toBeGreaterThan(snap.cloudPass[3]);
        });
        expect(peak).toBeGreaterThan(0.95);
        expect(passes).toBeGreaterThanOrEqual(2);
        expect(passes).toBeLessThanOrEqual(4);
    });

    it('is the same in every run of a session, whatever the weather drew', () => {
        const trace = () => {
            const dir = new SunfallDirector({ level: 1 });
            const out = [];
            run(dir, 80, (snap) => out.push(snap.sunShade));
            return out;
        };
        expect(trace()).toEqual(trace());
    });

    it('brings a level-up\'s new light back under a cloud', () => {
        const dir = new SunfallDirector({ level: 1 });
        dir.onLevelUp(2);
        let peak = 0;
        const snap = run(dir, 8, (s) => { peak = Math.max(peak, s.sunShade); });
        expect(peak).toBeGreaterThan(0.9);
        expect(snap.sunShade).toBeLessThan(0.05);
        expect(snap.beats.some((beat) => beat.kind === 'levelUp')).toBe(true);
    });

    it('stays away once the light has left (game over)', () => {
        const dir = new SunfallDirector({ level: 1 });
        dir.onGameOver();
        let peak = 0;
        run(dir, SUNFALL_TIMINGS.cloudPassMax + 30, (s) => { peak = Math.max(peak, s.sunShade); });
        expect(peak).toBe(0);
    });
});

describe('the chain\'s shafts', () => {
    it('stand clear of the card and inside the chamber', () => {
        const rig = cameraRigFor(16 / 9);
        const { chamber } = SUNFALL_LAYOUT;
        SUNFALL_SHAFTS.forEach((shaft, k) => {
            const inside = ((shaft.x - chamber.center[0]) / chamber.radii[0]) ** 2
                + ((shaft.z - chamber.center[1]) / chamber.radii[1]) ** 2;
            expect(inside, `shaft ${k}`).toBeLessThan(0.85);
            const ndc = projectWorldToNdc([shaft.x, -108, shaft.z], rig, 16 / 9);
            expect(Math.abs(ndc.x), `shaft ${k}`).toBeGreaterThan(BOARD_VIEWPORT.ndcRight + 0.2);
            expect(Math.abs(ndc.x), `shaft ${k}`).toBeLessThan(1);
            expect(shaft.radius).toBeGreaterThan(5);
        });
        // Counted on both sides of the board: the second link's stands left of it.
        expect(SUNFALL_SHAFTS[1].x).toBeLessThan(0);
        expect(SUNFALL_SHAFTS.filter((s) => s.x > 0).length).toBeGreaterThanOrEqual(4);
    });

    it('open one for each link in a fixed order, and close from the last opened back', () => {
        const dir = new SunfallDirector({ level: 1 });
        const openCount = (snap) => [...snap.shaftOpen].filter((v) => v > 0.5).length;
        expect(openCount(run(dir, 1))).toBe(0);
        for (const [chain, shafts] of [[2, 1], [3, 2], [5, 4], [7, 6]]) {
            dir.onCombo(chain);
            const snap = run(dir, 1.2);
            expect(openCount(snap), `chain ${chain}`).toBe(shafts);
            // The open ones are the first of the order: none skipped.
            for (let k = 0; k < shafts; k += 1) expect(snap.shaftOpen[k]).toBeGreaterThan(0.9);
        }
        // The chain lets go: the last opened closes first.
        dir.releaseCombo(7);
        const closing = run(dir, 0.6);
        expect(closing.shaftOpen[5]).toBeLessThan(closing.shaftOpen[0]);
        expect(openCount(run(dir, 6))).toBe(0);
    });

    it('all open at a perfect clear, with a breath of the pieces\' pigments', () => {
        const dir = new SunfallDirector({ level: 1 });
        dir.onPerfectClear();
        const snap = run(dir, 1.0);
        expect([...snap.shaftOpen].every((v) => v > 0.6)).toBe(true);
        expect(snap.shaftPigment).toBeGreaterThan(0.5);
        const after = run(dir, 14);
        expect([...after.shaftOpen].every((v) => v < 0.05)).toBe(true);
        expect(after.shaftPigment).toBeLessThan(0.05);
    });
});

describe('the beats the world\'s life answers', () => {
    it('records each one-off moment once, with what it needs', () => {
        const dir = new SunfallDirector({ level: 1 });
        dir.onLineClear({ lines: 4, rows: [16, 17, 18, 19], codes: ['I', 'O', 'T', 'S'] });
        dir.onTwist({ lines: 2 });
        dir.onPerfectClear();
        dir.onLevelUp(2);
        dir.onCombo(5);
        dir.releaseCombo(5);
        dir.onGameOver();
        dir.onGameOver();
        const { beats, clearEvents } = dir.step(DT);
        expect(beats.map((beat) => beat.kind)).toEqual(['quad', 'twist', 'perfect', 'levelUp', 'release', 'over']);
        expect(beats.map((beat) => beat.serial)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(beats[1].lines).toBe(2);
        expect(beats[4].peak).toBe(5);
        // A clear carries the pigments of the pieces it was made of (the petals' colours).
        expect(clearEvents[0].codes).toEqual(['I', 'O', 'T', 'S']);
        dir.startRun();
        expect(dir.getSnapshot().beats).toHaveLength(0);
    });
});

describe('what play lets loose', () => {
    let world;
    beforeAll(async () => {
        world = new SunfallWorld({ quality: 'High', assets: await loadSunfallAssetsFromDisk() });
    });
    afterAll(() => world?.dispose());

    const fresh = () => {
        const director = new SunfallDirector({ level: 1 });
        director.resetSession();
        world.applySnapshot(director.step(0));
        return director;
    };
    /** The flora records born at or after `since` (the ring holds the ambient ones too). */
    const born = (since) => {
        const { geometry } = world.life.flora.mesh;
        const A = geometry.attributes.aFloraA.array;
        const C = geometry.attributes.aFloraC.array;
        const out = [];
        for (let i = 0; i < A.length / 4; i += 1) {
            if (A[i * 4 + 3] >= since) out.push({ code: C[i * 4], size: C[i * 4 + 1], kind: C[i * 4 + 3] });
        }
        return out;
    };

    it('opens one blossom of the piece\'s pigment on its side, and bursts it when its row clears', () => {
        const director = fresh();
        director.onPieceLock({ code: 'L', u: 0.9, row: 12 });
        world.applySnapshot(director.step(DT));
        const { bloomMesh } = world.life.strands;
        const A = bloomMesh.geometry.attributes.aBloomA.array;
        const B = bloomMesh.geometry.attributes.aBloomB.array;
        const C = bloomMesh.geometry.attributes.aBloomC.array;
        const open = [];
        for (let i = 0; i < C.length / 4; i += 1) if (A[i * 4 + 3] > 0) open.push(i);
        expect(open).toHaveLength(1);
        const [slot] = open;
        expect(C[slot * 4]).toBe(6);
        expect(B[slot * 4 + 2]).toBe(1);
        // Left alone it wilts in its own time.
        expect(C[slot * 4 + 2] - C[slot * 4 + 1]).toBeCloseTo(BLOSSOM_LIFE, 0);
        const now = director.time;
        director.onLineClear({ lines: 1, rows: [12], codes: ['L'] });
        world.applySnapshot(director.step(DT));
        expect(C[slot * 4 + 2]).toBeCloseTo(now, 5);
        // Its petals fall on both sides of the card, in the pigment of what was cleared.
        const petals = born(now).filter((r) => r.kind === FLORA_KIND.petal);
        expect(petals.length).toBeGreaterThanOrEqual(10);
        petals.forEach((r) => expect(r.code).toBe(6));
    });

    it('hangs where a board row is seen, on either side of the card', () => {
        const left = world.life.strands.anchorAt(-1, 4);
        const right = world.life.strands.anchorAt(1, 16);
        expect(left[0]).toBeLessThan(0);
        expect(right[0]).toBeGreaterThan(0);
        // A higher row hangs higher.
        expect(world.life.strands.anchorAt(-1, 2)[1]).toBeGreaterThan(world.life.strands.anchorAt(-1, 18)[1]);
    });

    it('flings beads off the strand a hard drop snaps, and only then', () => {
        const director = fresh();
        director.onPieceLock({ code: 'T', u: 0.2, row: 9 });
        world.applySnapshot(director.step(DT));
        expect(born(0).filter((r) => r.kind === FLORA_KIND.bead)).toHaveLength(0);
        director.onHardDrop({
            code: 'S', u: 0.2, row: 11, distance: 14,
        });
        world.applySnapshot(director.step(DT));
        const beads = born(0).filter((r) => r.kind === FLORA_KIND.bead);
        expect(beads.length).toBeGreaterThanOrEqual(20);
        beads.forEach((r) => expect(r.code).toBe(FLORA_CODE.white));
    });

    it('answers a twist with a whirl, a perfect clear with a rain of petals, a level with birds', () => {
        const director = fresh();
        director.onTwist({ lines: 2 });
        world.applySnapshot(director.step(DT));
        const whirl = born(0).filter((r) => r.kind === FLORA_KIND.whirl);
        expect(whirl.length).toBeGreaterThanOrEqual(60);

        const second = fresh();
        second.onPerfectClear();
        world.applySnapshot(second.step(DT));
        const rain = born(0).filter((r) => r.kind === FLORA_KIND.petal && r.size > 1);
        expect(rain.length).toBeGreaterThanOrEqual(200);
        // Every piece's pigment is in it.
        expect(new Set(rain.map((r) => r.code)).size).toBe(7);

        const third = fresh();
        third.onLevelUp(2);
        world.applySnapshot(third.step(DT));
        const birds = born(0).filter((r) => r.kind === FLORA_KIND.bird);
        expect(birds).toHaveLength(22);
    });

    it('packs the chain\'s live shafts at the front for the shaders', () => {
        const director = fresh();
        expect(world.u.shaftCount.value).toBe(0);
        director.onCombo(4);
        for (let i = 0; i < 90; i += 1) world.applySnapshot(director.step(DT));
        expect(world.u.shaftCount.value).toBe(3);
        const rows = world.u.shaftRows.array;
        for (let k = 0; k < 3; k += 1) {
            expect(rows[k * 2].x).toBe(SUNFALL_SHAFTS[k].x);
            expect(rows[k * 2].z).toBeGreaterThan(0.9);
            // Sunlight: no pigment in a chain's shafts.
            expect(rows[k * 2 + 1].x).toBeCloseTo(1, 5);
        }
    });

    it('stands the cataract\'s spray while the water pours and the bow is held', () => {
        const director = fresh();
        expect(world.u.spray.value).toBe(0);
        director.onLineClear({ lines: 4, rows: [16, 17, 18, 19] });
        for (let i = 0; i < 60; i += 1) world.applySnapshot(director.step(DT));
        expect(world.u.spray.value).toBeGreaterThan(0.8);
    });
});

describe('the falls and the tiers', () => {
    it('hang the water from the rim\'s left, where it falls beside the column', () => {
        SUNFALL_FALLS.forEach((fall) => {
            expect(fall.q[0]).toBeLessThan(-0.5);
            expect(Math.hypot(fall.q[0], fall.q[1])).toBeLessThan(1);
        });
        expect(SUNFALL_FALLS[0].width).toBeGreaterThan(SUNFALL_FALLS[1].width * 4);
    });

    it('scale the flora, the vapour and the blossoms by tier', () => {
        const slots = (key) => SUNFALL_QUALITY_ORDER.map((tier) => SUNFALL_QUALITY_PRESETS[tier][key]);
        for (const key of ['floraSlots', 'vapourSlots', 'blossomSlots', 'leafSlots']) {
            const list = slots(key);
            for (let i = 1; i < list.length; i += 1) expect(list[i], key).toBeGreaterThanOrEqual(list[i - 1]);
        }
        // The lowest tier keeps the petals and the blossoms (they are the events) and drops the vapour.
        expect(SUNFALL_QUALITY_PRESETS.Minimal.floraSlots).toBeGreaterThan(100);
        expect(SUNFALL_QUALITY_PRESETS.Minimal.vapourSlots).toBe(0);
    });
});
