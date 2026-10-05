import { describe, expect, it } from 'vitest';
import {
    AuroraDirector, clearedRowHeight, pieceColumn,
} from '../../src/themes/aurora/aurora-director.js';
import {
    AURORA_ARCS, AURORA_GEOMETRY, BILLOW, CORONA_ARC_INDEX, EXCITATION, ExcitationMap,
    arcCoordinateForAzimuth, arcRateForAzimuth, arcViewSpan, billowShift, evaluateArcField,
} from '../../src/themes/aurora/aurora-field.js';
import { parseColor, vivid } from '../../src/themes/aurora/aurora-palette.js';

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
const clear = (lineCount = 1) => ({
    lineCount, clearedRows: Array.from({ length: lineCount }, (_, i) => 23 - i), cascadeCount: 1,
});
const activePulses = (director) => director.pulses.filter((pulse) => pulse.active);
const tintIn = (excitation, row) => {
    let sum = 0;
    for (let texel = 0; texel < excitation.width; texel += 1) {
        const i = (row * excitation.width + texel) * 4;
        sum += excitation.data[i] + excitation.data[i + 1] + excitation.data[i + 2];
    }
    return sum;
};

function clearingLock(director, lines = 1) {
    director.onPieceLock(lock());
    director.onLineClear(clear(lines));
    director.update(1 / 60);
}

describe('Aurora director — gameplay to sky', () => {
    it('a lock plucks the two leading arcs in the piece colour and raises no storm', () => {
        const { director, excitation } = create();
        director.onPieceLock(lock(3, '#ff0000'));
        director.update(1 / 60);

        expect(director.rippleCount).toBe(1);
        expect(director.shakeAmount).toBeCloseTo(0.0046, 6);
        expect(director.meteorCount).toBe(0);
        expect(activePulses(director).map((pulse) => pulse.row).sort()).toEqual([0, 0, 1, 1]);
        for (const pulse of activePulses(director)) {
            expect([pulse.red, pulse.green, pulse.blue]).toEqual([1, 0, 0]);
            expect(pulse.shift).toBe(0);
        }
        advance(director, 0.3);
        excitation.commit();
        expect(tintIn(excitation, 0)).toBeGreaterThan(0);
        expect(tintIn(excitation, 2)).toBe(0);
        expect(director.activity).toBeLessThan(0.05);
        expect(director.corona).toBe(0);
        expect(director.sweepGain).toBe(0);
    });

    it('launches a pluck from the edges of the board, outward, leaning toward the piece', () => {
        const { director } = create();
        director.setBoard(0, 0, 0.2);
        director.onPieceLock(lock(8));
        director.update(0);
        const main = activePulses(director).filter((pulse) => pulse.row === 0);
        const leftward = main.find((pulse) => pulse.velocity < 0);
        const rightward = main.find((pulse) => pulse.velocity > 0);
        expect(leftward.centre).toBeLessThan(arcCoordinateForAzimuth(AURORA_ARCS[0], -0.2));
        expect(rightward.centre).toBeGreaterThan(arcCoordinateForAzimuth(AURORA_ARCS[0], 0.2));
        expect(rightward.amp).toBeGreaterThan(leftward.amp);
    });

    it('resolves a lock and its clear as one cue, the clear', () => {
        const { director } = create();
        director.onPieceLock(lock());
        director.onLineClear(clear(2));
        director.update(1 / 60);

        expect(director.eventCount).toBe(1);
        expect(director.sweepGain).toBeGreaterThan(0);
        expect(director.surge).toBeGreaterThan(0.2);
        expect(director.rippleCount).toBe(2);
        // The strum reaches every resting arc and moves the fabric itself.
        expect(new Set(activePulses(director).map((pulse) => pulse.row)).size).toBe(AURORA_ARCS.length - 1);
        expect(activePulses(director).some((pulse) => pulse.shift !== 0)).toBe(true);
    });

    it('counts a streak from consecutive clearing locks and breaks it on a dry lock', () => {
        const { director } = create();
        clearingLock(director);
        expect(director.lastCombo).toBe(0);
        clearingLock(director);
        clearingLock(director);
        expect(director.lastCombo).toBe(3);
        const stormy = director.activityTarget;

        director.onPieceLock(lock());
        director.update(1 / 60);
        clearingLock(director);
        expect(director.boards[0].tracker.combo).toBe(1);
        expect(director.lastCombo).toBe(3);
        expect(stormy).toBeGreaterThan(0.3);
    });

    it('treats the bus COMBO as cascade depth: it deepens a clear but is no cue alone', () => {
        const alone = create().director;
        expect(alone.onCascade({ comboCount: 3 })).toBe(true);
        alone.update(1 / 60);
        expect(alone.eventCount).toBe(0);
        expect(alone.onCascade({ comboCount: 1 })).toBe(false);

        const plain = create().director;
        clearingLock(plain);
        const deep = create().director;
        deep.onPieceLock(lock());
        deep.onCascade({ comboCount: 3 });
        deep.onLineClear(clear(1));
        deep.update(1 / 60);
        expect(deep.activityTarget).toBeGreaterThan(plain.activityTarget);
        expect(deep.meteorCount).toBeGreaterThan(plain.meteorCount);
    });

    it('opens the corona on four lines and on a long streak, never on a small clear', () => {
        const small = create().director;
        clearingLock(small, 2);
        advance(small, 0.6);
        expect(small.corona).toBe(0);
        expect(small.arcGain[CORONA_ARC_INDEX]).toBe(0);

        const quad = create().director;
        clearingLock(quad, 4);
        advance(quad, 0.6);
        expect(quad.corona).toBeGreaterThan(0.8);
        expect(quad.arcGain[CORONA_ARC_INDEX]).toBeGreaterThan(0.4);

        const streak = create().director;
        for (let i = 0; i < 5; i += 1) clearingLock(streak);
        advance(streak, 0.6);
        expect(streak.corona).toBeGreaterThan(0.15);
    });

    it('keeps event brightness bounded: colour and shape carry the cue, not a flash', () => {
        const { director } = create();
        for (let i = 0; i < 12; i += 1) {
            clearingLock(director, 4);
            director.onPerfectClear({});
            director.update(1 / 60);
        }
        expect(director.surge).toBeLessThanOrEqual(0.8);
        expect(director.crown).toBeLessThanOrEqual(0.8);
        expect(director.fringe).toBeLessThanOrEqual(0.7);
        expect(director.height).toBeLessThanOrEqual(2.3);
        expect(director.sway).toBeLessThanOrEqual(1.25);
        for (const pulse of activePulses(director)) {
            expect(pulse.amp).toBeLessThanOrEqual(1.0001);
            expect(Math.abs(pulse.shift)).toBeLessThanOrEqual(BILLOW.maxAmplitude);
        }
    });

    it('settles back to an exactly calm sky', () => {
        const { director, excitation } = create();
        for (let i = 0; i < 8; i += 1) clearingLock(director, 4);
        director.onPerfectClear({});
        advance(director, 90);
        expect(director.activity).toBe(0);
        expect(director.corona).toBe(0);
        expect(director.surge).toBe(0);
        expect(activePulses(director)).toHaveLength(0);
        expect(Array.from(director.billows).filter((_, i) => i % 4 === 1).every((value) => value === 0)).toBe(true);
        excitation.commit();
        expect(tintIn(excitation, 0) + tintIn(excitation, 1) + tintIn(excitation, 2)).toBe(0);
        expect(excitation.commit()).toBe(false);
    });

    it('reuses fixed pools through an event storm', () => {
        const { director } = create(3);
        const pulses = director.pulses.slice();
        const ripples = director.ripples.slice();
        const meteors = director.meteors.slice();
        for (let i = 0; i < 600; i += 1) {
            director.onHardDrop({ distance: i % 20 });
            director.onPieceLock({ ...lock(i % 10), player: (i % 5) || undefined });
            if (i % 2 === 0) director.onLineClear({ ...clear(1 + (i % 4)), player: (i % 5) || undefined });
            if (i % 7 === 0) director.onTSpin({});
            if (i % 11 === 0) director.onPerfectClear({});
            if (i % 13 === 0) director.onLevelUp({ level: 3 });
            director.update(1 / 120);
            expect(director.rippleCount).toBeLessThanOrEqual(ripples.length);
            expect(director.meteorCount).toBeLessThanOrEqual(meteors.length);
        }
        expect(director.pulses).toHaveLength(pulses.length);
        director.pulses.forEach((pulse, i) => expect(pulse).toBe(pulses[i]));
        director.ripples.forEach((ripple, i) => expect(ripple).toBe(ripples[i]));
        director.meteors.forEach((meteor, i) => expect(meteor).toBe(meteors[i]));
        const outputs = [director.activity, director.height, director.sway, director.crown, director.fringe,
            director.violet, director.tau, director.rayPhase, ...director.light, ...director.tint, ...director.arcGain,
            ...director.billows];
        expect(outputs.every(Number.isFinite)).toBe(true);
    });

    it('replays exactly from reset', () => {
        const { director, excitation } = create(5);
        const play = () => {
            director.reset();
            for (let i = 0; i < 40; i += 1) {
                if (i % 3 === 0) director.onPieceLock(lock(i % 10, '#c18bff'));
                if (i % 6 === 0) director.onLineClear(clear(1 + (i % 4)));
                director.update(1 / 60);
            }
            excitation.commit();
            return {
                data: Array.from(excitation.data),
                state: [director.activity, director.corona, director.tau, director.rayPhase, director.meteorCount],
                meteors: director.meteors.map((meteor) => ({ ...meteor })),
            };
        };
        expect(play()).toEqual(play());
    });

    it('decays independently of the frame rate', () => {
        const run = (hz) => {
            const { director } = create();
            clearingLock(director, 3);
            advance(director, 4, hz);
            return director;
        };
        const slow = run(30);
        const fast = run(144);
        expect(slow.activity).toBeCloseTo(fast.activity, 2);
        expect(slow.corona).toBeCloseTo(fast.corona, 3);
        expect(slow.heightKick).toBeCloseTo(fast.heightKick, 3);
        expect(slow.tau).toBeCloseTo(fast.tau, 1);
    });

    it('keeps every event under reduced motion but drops the shake and softens the fabric', () => {
        const full = create().director;
        clearingLock(full, 4);
        const reduced = create().director;
        reduced.setReducedMotion(true);
        clearingLock(reduced, 4);

        expect(reduced.shakeAmount).toBe(0);
        expect(full.shakeAmount).toBeGreaterThan(0);
        expect(reduced.meteorCount).toBeLessThanOrEqual(1);
        const widest = (director) => Math.max(...activePulses(director).map((pulse) => Math.abs(pulse.shift)));
        expect(widest(reduced)).toBeLessThan(widest(full));
        advance(reduced, 0.6);
        expect(reduced.corona).toBeLessThanOrEqual(0.5);
        expect(activePulses(reduced).length).toBeGreaterThan(0);
    });

    it('keeps the streak when the visible lock is switched off', () => {
        const { director } = create();
        director.onPieceLock(lock(), false);
        director.update(1 / 60);
        expect(activePulses(director)).toHaveLength(0);
        expect(director.rippleCount).toBe(0);

        director.onPieceLock(lock(3, '#00ff00'), false);
        director.onLineClear(clear(1));
        director.update(1 / 60);
        director.onPieceLock(lock(), false);
        director.onLineClear(clear(1));
        director.update(1 / 60);
        expect(director.lastCombo).toBe(2);
        expect(activePulses(director).some((pulse) => pulse.green === 1 && pulse.red === 0)).toBe(true);
    });

    it('answers each multiplayer board above its own place in the view', () => {
        const { director } = create();
        director.setBoard(1, -0.4, 0.1);
        director.setBoard(2, 0.4, 0.1);
        director.onPieceLock({ ...lock(), player: 1 });
        director.update(0);
        const left = activePulses(director).filter((pulse) => pulse.row === 1).map((pulse) => pulse.centre);
        director.reset();
        director.setBoard(2, 0.4, 0.1);
        director.onPieceLock({ ...lock(), player: 2 });
        director.update(0);
        const right = activePulses(director).filter((pulse) => pulse.row === 1).map((pulse) => pulse.centre);
        expect(Math.max(...left)).toBeLessThan(Math.min(...right));
    });

    it('ignores malformed payloads without poisoning the state', () => {
        const { director } = create();
        for (const payload of [undefined, null, 7, 'x', {}, { piece: null }, { piece: { x: NaN } },
            { lineCount: NaN }, { lineCount: -3 }, { lineCount: 'two' }, { clearedRows: 'no' }, { distance: Infinity }]) {
            expect(() => {
                director.onHardDrop(payload);
                director.onPieceLock(payload);
                director.onLineClear(payload);
                director.onCascade(payload);
                director.update(1 / 60);
            }).not.toThrow();
        }
        director.update(NaN);
        director.update(-1);
        expect(Number.isFinite(director.activity)).toBe(true);
        expect(Number.isFinite(director.time)).toBe(true);
        expect(director.onLineClear({ lineCount: 0 })).toBe(false);
        expect(() => new AuroraDirector({})).toThrow(TypeError);
    });

    it('calms on game over and forgets the streak', () => {
        const { director } = create();
        for (let i = 0; i < 4; i += 1) clearingLock(director, 2);
        director.calm();
        expect(director.activityTarget).toBe(0);
        expect(director.boards[0].tracker.combo).toBe(0);
        advance(director, 40);
        expect(director.activity).toBe(0);
    });
});

describe('Aurora payload readers', () => {
    it('reads the piece column from the shape centroid, preferring a viewport origin', () => {
        expect(pieceColumn({ piece: { x: 0, shape: [[1, 1, 1, 1]] } })).toBeCloseTo(0.2, 6);
        expect(pieceColumn({ piece: { x: 6, shape: [[0, 1], [1, 1]] } })).toBeCloseTo(0.7167, 3);
        expect(pieceColumn({ piece: { x: 4 } })).toBeCloseTo(0.45, 6);
        expect(pieceColumn({ piece: { x: 4, shape: [[1]] }, viewportOrigin: { x: 0.9, y: 0.1 } })).toBe(0.9);
        expect(pieceColumn({})).toBeNull();
        expect(pieceColumn({ piece: { x: 40, shape: [[1]] } })).toBe(1);
    });

    it('reads the height of cleared rows past the hidden rows', () => {
        expect(clearedRowHeight({ clearedRows: [23] })).toBeCloseTo(0.975, 6);
        expect(clearedRowHeight({ clearedRows: [4, 5] })).toBeCloseTo(0.05, 6);
        expect(clearedRowHeight({ clearedRows: [] })).toBeNull();
        expect(clearedRowHeight({})).toBeNull();
    });
});

describe('Aurora curtain field', () => {
    it('keeps the storm corona last and every arc frame orthonormal', () => {
        expect(CORONA_ARC_INDEX).toBe(AURORA_ARCS.length - 1);
        for (const arc of AURORA_ARCS) {
            expect(arc.tangentX * arc.normalX + arc.tangentZ * arc.normalZ).toBeCloseTo(0, 12);
            expect(Math.hypot(arc.tangentX, arc.tangentZ)).toBeCloseTo(1, 12);
            // The resting line lies `distance` km out along the normal.
            const field = evaluateArcField(arc, arc.normalX * arc.distance, arc.normalZ * arc.distance, 0, 0);
            expect(field.level).toBeCloseTo(0, 9);
            expect(field.along).toBeCloseTo(0, 9);
        }
    });

    it('maps view azimuth to arc coordinate monotonically, with a matching rate', () => {
        for (const arc of AURORA_ARCS) {
            let previous = -Infinity;
            for (let azimuth = arc.angle - 1.2; azimuth <= arc.angle + 1.2; azimuth += 0.1) {
                const along = arcCoordinateForAzimuth(arc, azimuth);
                expect(along).toBeGreaterThan(previous);
                previous = along;
                const step = 1e-5;
                const slope = (arcCoordinateForAzimuth(arc, azimuth + step) - along) / step;
                expect(arcRateForAzimuth(arc, azimuth) / slope).toBeCloseTo(1, 3);
            }
            expect(arcCoordinateForAzimuth(arc, arc.angle + Math.PI / 2)).toBeNull();
            expect(arcRateForAzimuth(arc, arc.angle + Math.PI)).toBeNull();
            const [left, right] = arcViewSpan(arc);
            expect(left).toBeLessThan(right);
            expect(Math.abs(left)).toBeLessThan(AURORA_GEOMETRY.spanKm / 2);
            expect(Math.abs(right)).toBeLessThan(AURORA_GEOMETRY.spanKm / 2);
        }
    });

    it('folds the sheet about its resting line and flips sign across it', () => {
        const arc = AURORA_ARCS[0];
        const far = evaluateArcField(arc, arc.normalX * (arc.distance + 400), arc.normalZ * (arc.distance + 400), 3, 1);
        const near = evaluateArcField(arc, arc.normalX * (arc.distance - 400), arc.normalZ * (arc.distance - 400), 3, 1);
        expect(far.distance).toBeGreaterThan(0);
        expect(near.distance).toBeLessThan(0);
        expect(Number.isFinite(far.distance) && Number.isFinite(near.distance)).toBe(true);
    });

    it('shapes a billow as one crest and one trough with no net shift', () => {
        expect(billowShift(10, 10, 20, 0.05)).toBeCloseTo(0, 12);
        expect(billowShift(10 - Math.SQRT1_2 * 20, 10, 20, 0.05)).toBeCloseTo(20, 6);
        expect(billowShift(40, 10, 20, 0.05)).toBeCloseTo(-billowShift(-20, 10, 20, 0.05), 9);
        let net = 0;
        for (let along = -400; along <= 420; along += 1) net += billowShift(along, 10, 20, 0.05);
        expect(Math.abs(net)).toBeLessThan(1e-6);
    });

    it('paints, clamps and clears the excitation map, re-uploading only when it changes', () => {
        const map = new ExcitationMap(3);
        expect(map.commit()).toBe(true);
        expect(map.commit()).toBe(false);

        map.begin();
        map.accumulate(1, 0, 40, 9, 0.5, 0);
        expect(map.commit()).toBe(true);
        // Committing the same painted frame again changes nothing.
        expect(map.commit()).toBe(false);
        const centre = (1 * map.width + map.width / 2) * 4;
        expect(map.data[centre]).toBe(255);
        expect(map.data[centre + 1]).toBeGreaterThan(40);
        expect(map.data[centre + 1]).toBeLessThanOrEqual(Math.round((0.5 / EXCITATION.maxGlow) * 255));
        expect(map.data[centre + 2]).toBe(0);
        // Other rows and the clamped edge texels stay dark.
        expect(map.data[(0 * map.width + map.width / 2) * 4]).toBe(0);
        expect(map.data[(1 * map.width) * 4]).toBe(0);
        expect(map.data[(1 * map.width + map.width - 1) * 4]).toBe(0);

        // The step after the last pulse returns the map to rest exactly once.
        map.begin();
        expect(map.commit()).toBe(true);
        expect(map.data[centre]).toBe(0);
        map.begin();
        expect(map.commit()).toBe(false);
        map.accumulate(9, 0, 40, 1, 1, 1);
        map.accumulate(1, 0, 0, 1, 1, 1);
        expect(map.commit()).toBe(false);
    });
});

describe('Aurora pulse colour', () => {
    it('parses piece colours to linear light and rejects anything else', () => {
        const out = [0, 0, 0];
        expect(parseColor('#ffffff', out)).toBe(true);
        expect(out).toEqual([1, 1, 1]);
        expect(parseColor('f00', out)).toBe(true);
        expect(out).toEqual([1, 0, 0]);
        expect(parseColor(0x000000, out)).toBe(true);
        expect(out).toEqual([0, 0, 0]);
        expect(parseColor('#808080', out)).toBe(true);
        expect(out[0]).toBeCloseTo(0.2158, 3);
        for (const bad of [undefined, null, '', 'teal', '#12', {}, NaN]) expect(parseColor(bad, out)).toBe(false);
    });

    it('drives a pale colour to full value without changing its hue order', () => {
        const pale = vivid([0.67, 1.0, 0.43], [0, 0, 0]);
        expect(Math.max(...pale)).toBeCloseTo(1, 9);
        expect(pale[1]).toBeGreaterThan(pale[0]);
        expect(pale[0]).toBeGreaterThan(pale[2]);
        expect(pale[2]).toBeLessThan(0.2);
        expect(vivid([0.2, 0.2, 0.2], [0, 0, 0])).toEqual([1, 1, 1]);
        expect(vivid([0, 0, 0], [0, 0, 0]).every(Number.isFinite)).toBe(true);
    });
});
