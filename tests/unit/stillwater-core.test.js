/**
 * Stillwater — the three-free maths (stillwater-core.js).
 *
 * The tarn is being tuned while these tests stand, so they pin what the picture relies on, not the
 * numbers it is tuned with: every bound is read from the module's own exports.
 */
import { describe, expect, it } from 'vitest';
import {
    APPROACH_STEPS, DEG, DROP_FLIGHT, DROP_SLOTS, EYE, EYE_PAIRS, HEART, HOURS, HOUR_REST, HOUR_SECONDS, HUSH_HOLD,
    MOON, PALETTE_KEYS, PALETTE_SCALARS, RING_LIVE, RING_SLOTS, RING_SLOW, RING_SPEED, SPIRIT, STROKE_GAP,
    STROKE_LIVE, STROKE_SLOTS, STROKE_SPEED, SURGE_COOL, TARNFIRE, TAU, TROLL, WISP_HOLD, WISP_HOME, WISP_RISE,
    WISP_SLOTS, approach, approachForCombo, bell, clamp01, eyesForCombo, fovForAspect, halfWidthTan, heartForCombo,
    hourAt, hourBlend, hourNames, lerp, linRGB, moonFor, mulberry32, paletteAt, pieceColor, powerForCombo,
    ringRadius, skyDirection, smooth, squeezeFor, strokePassTime,
} from '../../src/themes/stillwater/stillwater-core.js';
import { STILLWATER_TETROMINOS } from '../../src/themes/stillwater/stillwater-tetrominos.js';

/** Frames the picture is composed for: desktops, an ultrawide, a square, a tablet, upright phones. */
const ASPECTS = [3440 / 1440, 2560 / 1080, 16 / 9, 16 / 10, 4 / 3, 1, 820 / 1180, 430 / 932, 390 / 844, 0.4];

/** The horizontal field of view (degrees) a frame really has with the rig's lens. */
const hFovAt = (aspect) => (2 * Math.atan(Math.tan((fovForAspect(aspect) * DEG) / 2) * aspect)) / DEG;

/** (max − min) / max of a colour: 0 = grey, 1 = a pure hue. */
const saturation = (c) => (Math.max(...c) - Math.min(...c)) / Math.max(...c);

/** Which channel is largest, which smallest: the hue's order. */
const order = (c) => [0, 1, 2].map((i) => [0, 1, 2].map((j) => Math.sign(c[i] - c[j])));

const COMBO_CURVES = {
    approachForCombo, powerForCombo, eyesForCombo, heartForCombo,
};

describe('stillwater core: small maths', () => {
    it('eases, clamps and blends', () => {
        expect(approach(3, 0)).toBe(0);
        expect(approach(3, 1e9)).toBe(1);
        expect(approach(3, 0.1)).toBeGreaterThan(0);
        expect(approach(3, 0.1)).toBeLessThan(1);
        // Frame-rate independent: two half steps close the same share of the gap as one whole step.
        const half = approach(2.4, 0.05);
        expect(1 - (1 - half) * (1 - half)).toBeCloseTo(approach(2.4, 0.1), 12);
        expect([clamp01(-2), clamp01(0.3), clamp01(7)]).toEqual([0, 0.3, 1]);
        expect(lerp(2, 6, 0.25)).toBe(3);
        expect([0, 1, 2, 3, 9].map((v) => smooth(1, 3, v))).toEqual([0, 0, 0.5, 1, 1]);
        // Equal edges give a step, not a division by zero.
        expect([smooth(2, 2, 1.9), smooth(2, 2, 2), smooth(2, 2, 2.1)]).toEqual([0, 1, 1]);
        expect([bell(0), bell(1), bell(-1), bell(4)]).toEqual([1, 0, 0, 0]);
        expect(bell(0.5)).toBeCloseTo(0.25, 12);
        expect(bell(-0.5)).toBe(bell(0.5));
        expect(TAU).toBeCloseTo(Math.PI * 2, 12);
        expect(DEG * 180).toBeCloseTo(Math.PI, 12);
    });

    it('draws the same numbers from the same seed, each in [0, 1)', () => {
        const a = mulberry32(7);
        const b = mulberry32(7);
        const other = mulberry32(8);
        const drawn = Array.from({ length: 200 }, () => a());
        expect(Array.from({ length: 200 }, () => b())).toEqual(drawn);
        expect(Array.from({ length: 200 }, () => other())).not.toEqual(drawn);
        for (const v of drawn) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
        // They are spread over the range, not stuck in a corner of it.
        const mean = drawn.reduce((sum, v) => sum + v, 0) / drawn.length;
        expect(mean).toBeGreaterThan(0.4);
        expect(mean).toBeLessThan(0.6);
        // A seed of nothing still draws.
        expect(Number.isFinite(mulberry32(0)())).toBe(true);
        expect(Number.isFinite(mulberry32(undefined)())).toBe(true);
    });

    it('turns sRGB hex into scene-linear light', () => {
        expect(linRGB(0x000000)).toEqual([0, 0, 0]);
        expect(linRGB(0xffffff)).toEqual([1, 1, 1]);
        expect(linRGB(0xff0000)).toEqual([1, 0, 0]);
        expect(linRGB(0x0000ff)).toEqual([0, 0, 1]);
        // Mid-grey on the screen is about a fifth of white in light.
        const [grey] = linRGB(0x808080);
        expect(grey).toBeGreaterThan(0.2);
        expect(grey).toBeLessThan(0.23);
        let last = -1;
        for (let v = 0; v < 256; v++) {
            const [r] = linRGB(v << 16);
            expect(r).toBeGreaterThan(last);
            last = r;
        }
    });
});

describe('stillwater core: the rest camera', () => {
    it('describes a lens that can be built', () => {
        expect(Object.isFrozen(EYE)).toBe(true);
        for (const key of ['x', 'y', 'z', 'pitch', 'hFov', 'minFov', 'maxFov', 'near', 'far']) {
            expect(Number.isFinite(EYE[key]), key).toBe(true);
        }
        expect(EYE.minFov).toBeGreaterThan(0);
        expect(EYE.minFov).toBeLessThan(EYE.maxFov);
        expect(EYE.maxFov).toBeLessThan(180);
        expect(EYE.near).toBeGreaterThan(0);
        expect(EYE.near).toBeLessThan(EYE.far);
        // The viewer stands above the water (y = 0) and looks a little below the horizontal.
        expect(EYE.y).toBeGreaterThan(0);
        expect(EYE.pitch).toBeLessThan(0);
        expect(EYE.pitch).toBeGreaterThan(-20 * DEG);
    });

    it('holds the horizontal field of view wherever the vertical one is free, and clamps it elsewhere', () => {
        let held = 0;
        let last = Infinity;
        for (let aspect = 0.3; aspect <= 4; aspect += 0.01) {
            const fov = fovForAspect(aspect);
            expect(fov).toBeGreaterThanOrEqual(EYE.minFov);
            expect(fov).toBeLessThanOrEqual(EYE.maxFov);
            // A wider frame never takes a taller lens.
            expect(fov).toBeLessThanOrEqual(last + 1e-12);
            last = fov;
            if (fov > EYE.minFov && fov < EYE.maxFov) {
                held += 1;
                expect(hFovAt(aspect)).toBeCloseTo(EYE.hFov, 9);
            } else if (fov === EYE.maxFov) {
                // Too narrow a frame for the stage: it sees less of it than the rig asks.
                expect(hFovAt(aspect)).toBeLessThanOrEqual(EYE.hFov + 1e-9);
            } else {
                // Too wide a frame: it sees more.
                expect(hFovAt(aspect)).toBeGreaterThanOrEqual(EYE.hFov - 1e-9);
            }
        }
        expect(held).toBeGreaterThan(20);
        // Both clamps are reached by frames that exist.
        expect(fovForAspect(390 / 844)).toBe(EYE.maxFov);
        expect(fovForAspect(8)).toBe(EYE.minFov);
        // The frame the game is composed for is not clamped.
        expect(fovForAspect(16 / 9)).toBeGreaterThan(EYE.minFov);
        expect(fovForAspect(16 / 9)).toBeLessThan(EYE.maxFov);
    });

    it('takes a frame with no shape for a 16:9 one, and a sliver for the narrowest it knows', () => {
        for (const junk of [NaN, undefined, null, Infinity, -Infinity, 'wide']) {
            expect(fovForAspect(junk), String(junk)).toBe(fovForAspect(16 / 9));
            expect(halfWidthTan(junk), String(junk)).toBe(halfWidthTan(16 / 9));
            expect(squeezeFor(junk), String(junk)).toBe(squeezeFor(16 / 9));
        }
        for (const sliver of [0, -3, 1e-6]) {
            expect(fovForAspect(sliver)).toBe(EYE.maxFov);
            expect(Number.isFinite(halfWidthTan(sliver))).toBe(true);
            expect(halfWidthTan(sliver)).toBeGreaterThan(0);
        }
    });

    it('measures the frame\'s real half width', () => {
        for (const aspect of ASPECTS) {
            expect(halfWidthTan(aspect)).toBeCloseTo(Math.tan((hFovAt(aspect) * DEG) / 2), 12);
        }
        expect(halfWidthTan(16 / 9)).toBeCloseTo(Math.tan((EYE.hFov * DEG) / 2), 9);
    });

    it('draws the stage in on a narrow frame: 1 on wide frames, less on tall ones, never below its floor', () => {
        // The floor: what the narrowest frame there is gets.
        const floor = squeezeFor(0.01);
        expect(floor).toBeGreaterThan(0);
        expect(floor).toBeLessThan(1);
        // The figures keep their width by 1 / max(0.2, squeeze) (stillwater-figures.js): the floor may not go under that.
        expect(floor).toBeGreaterThanOrEqual(0.2);
        let last = 0;
        let fell = 0;
        for (let aspect = 0.05; aspect <= 4; aspect += 0.01) {
            const s = squeezeFor(aspect);
            expect(s).toBeGreaterThanOrEqual(floor);
            expect(s).toBeLessThanOrEqual(1);
            // A wider frame is never drawn in further.
            expect(s).toBeGreaterThanOrEqual(last - 1e-12);
            last = s;
            // Wherever the lens holds the rig's field (or sees more), the stage is as built.
            if (fovForAspect(aspect) < EYE.maxFov) expect(s).toBe(1);
            // It is never drawn in further than the frame is short of the rig's field.
            const short = halfWidthTan(aspect) / Math.tan((EYE.hFov * DEG) / 2);
            expect(s).toBeGreaterThanOrEqual(Math.min(1, short) - 1e-12);
            if (s < 1) fell += 1;
        }
        expect(fell).toBeGreaterThan(10);
        for (const aspect of [16 / 9, 16 / 10, 4 / 3, 2560 / 1080, 3440 / 1440]) expect(squeezeFor(aspect)).toBe(1);
        // An upright phone is too narrow for the stage as built, and the narrower the more.
        for (const aspect of [430 / 932, 390 / 844]) expect(squeezeFor(aspect)).toBeLessThan(1);
        expect(squeezeFor(390 / 844)).toBeLessThanOrEqual(squeezeFor(820 / 1180));
        expect(squeezeFor(9 / 21)).toBeLessThanOrEqual(squeezeFor(390 / 844));
    });

    it('turns an azimuth and an elevation into a unit direction', () => {
        const ahead = skyDirection(0, 0);
        expect(ahead[0]).toBeCloseTo(0, 12);
        expect(ahead[1]).toBeCloseTo(0, 12);
        expect(ahead[2]).toBeCloseTo(-1, 12);
        expect(skyDirection(20 * DEG, 0)[0]).toBeGreaterThan(0); // + to the right
        expect(skyDirection(-20 * DEG, 0)[0]).toBeLessThan(0);
        expect(skyDirection(0, 30 * DEG)[1]).toBeCloseTo(0.5, 12);
        for (const [az, el] of [[0.3, 0.2], [-1.1, 0.7], [2.9, -0.4], [0, 1.5]]) {
            const d = skyDirection(az, el);
            expect(Math.hypot(...d)).toBeCloseTo(1, 12);
            expect(Math.atan2(d[0], -d[2])).toBeCloseTo(az, 9);
            expect(Math.asin(d[1])).toBeCloseTo(el, 9);
        }
        const out = [9, 9, 9];
        expect(skyDirection(0.1, 0.1, out)).toBe(out);
        expect(out).toEqual(skyDirection(0.1, 0.1));
    });
});

describe('stillwater core: the moon', () => {
    it('stands left of the card, above the far wood, on a wide frame', () => {
        expect(Object.isFrozen(MOON)).toBe(true);
        expect(MOON.azimuth).toBeLessThan(0);
        expect(MOON.elevation).toBeGreaterThan(0);
        expect(MOON.radius).toBeGreaterThan(0);
        // Inside the frame the game is composed for.
        expect(Math.abs(Math.tan(MOON.azimuth))).toBeLessThan(halfWidthTan(16 / 9));
        for (const aspect of [16 / 9, 16 / 10, 4 / 3, 3440 / 1440]) {
            expect(moonFor(aspect)).toEqual({ azimuth: MOON.azimuth, elevation: MOON.elevation });
        }
    });

    it('comes in with the stage and climbs on a narrow frame', () => {
        let last = { ...moonFor(4) };
        // (From an ultrawide down to the narrowest upright phone there is.)
        for (let aspect = 4; aspect >= 0.4; aspect -= 0.02) {
            const moon = moonFor(aspect);
            expect(moon.azimuth).toBeLessThan(0); // it never changes sides
            // The narrower the frame, the nearer the middle and the higher.
            expect(Math.abs(moon.azimuth)).toBeLessThanOrEqual(Math.abs(last.azimuth) + 1e-12);
            expect(moon.elevation).toBeGreaterThanOrEqual(last.elevation - 1e-12);
            expect(moon.elevation).toBeLessThan(80 * DEG);
            last = moon;
            // It moves in exactly as the banks do: a stage point on the moon's bearing, drawn in by
            // the frame's squeeze, is still under the moon.
            const far = 50;
            const drawnIn = far * Math.tan(MOON.azimuth) * squeezeFor(aspect);
            expect(Math.atan2(drawnIn, far)).toBeCloseTo(moon.azimuth, 12);
            // And it stays in the frame.
            expect(Math.abs(Math.tan(moon.azimuth))).toBeLessThan(halfWidthTan(aspect));
        }
        const phone = moonFor(390 / 844);
        expect(Math.abs(phone.azimuth)).toBeLessThan(Math.abs(MOON.azimuth));
        expect(phone.elevation).toBeGreaterThan(MOON.elevation);
        // It writes into what it is given.
        const out = { azimuth: 9, elevation: 9 };
        expect(moonFor(1, out)).toBe(out);
        expect(out).toEqual(moonFor(1));
    });
});

describe('stillwater core: who stands where', () => {
    it('puts the spirit on the left bank and the troll on the right, each with a step toward the board', () => {
        for (const who of [SPIRIT, TROLL]) {
            expect(Object.isFrozen(who)).toBe(true);
            expect(Object.isFrozen(who.home)).toBe(true);
            expect(Object.isFrozen(who.reach)).toBe(true);
            expect([...who.home, ...who.reach].every(Number.isFinite)).toBe(true);
            expect(who.height).toBeGreaterThan(0);
            // A chain draws each toward the middle, and toward the viewer's line of sight to the board.
            expect(Math.abs(who.reach[0])).toBeLessThan(Math.abs(who.home[0]));
            expect(Math.sign(who.reach[0])).toBe(Math.sign(who.home[0])); // neither crosses to the other's side
            // Both stand in front of the viewer.
            expect(who.home[2]).toBeLessThan(EYE.z);
            expect(who.reach[2]).toBeLessThan(EYE.z);
        }
        expect(SPIRIT.home[0]).toBeLessThan(0);
        expect(TROLL.home[0]).toBeGreaterThan(0);
        // He is the larger of the two.
        expect(TROLL.height).toBeGreaterThan(SPIRIT.height);
        expect(TROLL.stride).toBeGreaterThan(0);
        // At the end of the longest chain there is still water between them.
        expect(TROLL.reach[0] - SPIRIT.reach[0]).toBeGreaterThan(1);
    });

    it('lays the gold heart on the tarn\'s bed, in front of the viewer', () => {
        expect(Object.isFrozen(HEART)).toBe(true);
        expect(HEART).toHaveLength(3);
        expect(HEART.every(Number.isFinite)).toBe(true);
        expect(HEART[1]).toBeLessThan(0);
        expect(HEART[2]).toBeLessThan(EYE.z);
        // Between the two, not on either's bank.
        expect(HEART[0]).toBeGreaterThan(SPIRIT.reach[0]);
        expect(HEART[0]).toBeLessThan(TROLL.reach[0]);
    });
});

describe('stillwater core: slots and timings', () => {
    it('has room for what the board can start, and time for each to be seen', () => {
        for (const slots of [RING_SLOTS, STROKE_SLOTS, WISP_SLOTS, DROP_SLOTS, EYE_PAIRS]) {
            expect(Number.isInteger(slots)).toBe(true);
            expect(slots).toBeGreaterThan(0);
        }
        for (const seconds of [RING_SPEED, RING_SLOW, RING_LIVE, STROKE_SPEED, STROKE_GAP, STROKE_LIVE, WISP_HOLD,
            WISP_RISE, WISP_HOME, DROP_FLIGHT, HUSH_HOLD, SURGE_COOL, HOUR_SECONDS]) {
            expect(Number.isFinite(seconds)).toBe(true);
            expect(seconds).toBeGreaterThan(0);
        }
        // A hard drop throws three drops and a four-line clear a ring of its own: one lock never fills the table.
        expect(RING_SLOTS).toBeGreaterThanOrEqual(4);
        expect(DROP_SLOTS).toBeGreaterThanOrEqual(3);
        // A wisp stands far longer than it takes to rise or to fly home.
        expect(WISP_HOLD).toBeGreaterThan(WISP_RISE + WISP_HOME);
        // The hush before the tarn answers is a held breath, not a pause in play.
        expect(HUSH_HOLD).toBeLessThan(1);
    });

    it('grows a ring from nothing, ever more slowly, to a bound', () => {
        expect(ringRadius(0)).toBe(0);
        expect(ringRadius(-1)).toBe(0); // a ring that has not begun
        expect(ringRadius(NaN)).toBe(0);
        const bound = RING_SPEED * RING_SLOW;
        let last = 0;
        let lastStep = Infinity;
        for (let age = 0.05; age <= RING_LIVE * 3; age += 0.05) {
            const r = ringRadius(age);
            expect(r).toBeGreaterThan(last);
            expect(r).toBeLessThan(bound);
            // It slows as it goes.
            expect(r - last).toBeLessThan(lastStep + 1e-12);
            lastStep = r - last;
            last = r;
        }
        // It leaves at RING_SPEED metres a second.
        expect(ringRadius(1e-4) / 1e-4).toBeCloseTo(RING_SPEED, 3);
        expect(ringRadius(1e9)).toBeCloseTo(bound, 9);
        // `reach` scales the whole ring.
        expect(ringRadius(2, 2.5)).toBeCloseTo(ringRadius(2) * 2.5, 12);
        expect(ringRadius(2, 0)).toBe(0);
        // In the time it is drawn it has crossed a good part of the tarn.
        expect(ringRadius(RING_LIVE)).toBeGreaterThan(bound * 0.5);
    });

    it('times a swell\'s passing by the distance from the heart', () => {
        expect(strokePassTime(0)).toBe(0);
        expect(strokePassTime(STROKE_SPEED)).toBeCloseTo(1, 12);
        expect(strokePassTime(-12)).toBe(strokePassTime(12));
        let last = -1;
        for (let d = 0; d <= 80; d += 0.5) {
            const t = strokePassTime(d);
            expect(t).toBeGreaterThan(last);
            expect(t).toBeCloseTo(d / STROKE_SPEED, 12);
            last = t;
        }
        // A swell reaches a point twenty-five metres off while it is still drawn.
        expect(strokePassTime(25)).toBeLessThan(STROKE_LIVE);
    });
});

describe('stillwater core: what a chain does', () => {
    it('draws the two a step nearer for every clear of a chain, all the way', () => {
        expect(Object.isFrozen(APPROACH_STEPS)).toBe(true);
        expect(APPROACH_STEPS[0]).toBe(0);
        expect(APPROACH_STEPS[APPROACH_STEPS.length - 1]).toBe(1);
        for (let i = 1; i < APPROACH_STEPS.length; i++) {
            expect(APPROACH_STEPS[i]).toBeGreaterThan(APPROACH_STEPS[i - 1]);
        }
        APPROACH_STEPS.forEach((step, n) => expect(approachForCombo(n)).toBe(step));
        // The first clear of a chain is already a visible step.
        expect(approachForCombo(1)).toBeGreaterThan(0.1);
        // A chain longer than the steps holds them at the board.
        expect(approachForCombo(APPROACH_STEPS.length + 20)).toBe(1);
        // A combo between two whole numbers is the nearer one.
        expect(approachForCombo(2.4)).toBe(approachForCombo(2));
        expect(approachForCombo(2.6)).toBe(approachForCombo(3));
    });

    it.each(Object.keys(COMBO_CURVES))('%s is 0 with no chain, never falls as it grows, stays within 0..1', (name) => {
        const curve = COMBO_CURVES[name];
        expect(curve(0)).toBe(0);
        let last = 0;
        for (let n = 0; n <= 60; n++) {
            const v = curve(n);
            expect(v, `combo ${n}`).toBeGreaterThanOrEqual(last);
            expect(v, `combo ${n}`).toBeGreaterThanOrEqual(0);
            expect(v, `combo ${n}`).toBeLessThanOrEqual(1);
            last = v;
        }
        // A long chain wakes it for real.
        expect(curve(60)).toBeGreaterThan(0.9);
        expect(curve(1e9)).toBeGreaterThan(0.9);
        expect(curve(1e9)).toBeLessThanOrEqual(1);
    });

    it.each(Object.keys(COMBO_CURVES))('%s takes a combo that is not a count for none at all', (name) => {
        const curve = COMBO_CURVES[name];
        for (const junk of [NaN, undefined, null, -1, -1e9, -Infinity, '', 'three', {}, []]) {
            expect(curve(junk), String(junk)).toBe(0);
        }
        expect(curve(Infinity)).toBe(curve(1e9));
        // A number in a string is that number.
        expect(curve('6')).toBe(curve(6));
    });

    it('wakes the wood in order: the charge with the first clear, the eyes later, the heart last', () => {
        expect(powerForCombo(1)).toBeGreaterThan(0);
        const firstEyes = Array.from({ length: 60 }, (_, n) => n).find((n) => eyesForCombo(n) > 0);
        const firstHeart = Array.from({ length: 60 }, (_, n) => n).find((n) => heartForCombo(n) > 0);
        expect(firstEyes).toBeGreaterThan(1);
        expect(firstHeart).toBeGreaterThanOrEqual(firstEyes);
    });
});

describe('stillwater core: a piece\'s colour as light', () => {
    it('reads a number, a hex string with or without its hash, in either case', () => {
        const rose = pieceColor(0xc36f73);
        expect(pieceColor('#C36F73')).toEqual(rose);
        expect(pieceColor('#c36f73')).toEqual(rose);
        expect(pieceColor('c36f73')).toEqual(rose);
        expect(pieceColor('  #C36F73 ')).toEqual(rose);
        expect(pieceColor(0x537e9f)).not.toEqual(rose);
    });

    it('falls back on anything that is not a colour', () => {
        const fallback = pieceColor(undefined);
        const junks = [
            null, '', 'rose', '#12', '#12345', '#1234567', '#gggggg', 'rgb(1,2,3)', NaN, Infinity, {}, [], true,
        ];
        for (const junk of junks) {
            expect(pieceColor(junk), String(junk)).toEqual(fallback);
        }
        // The caller's own fallback, when it gives one.
        expect(pieceColor('rose', 0x00ff00)).toEqual(pieceColor(0x00ff00));
        expect(pieceColor(null, 0x00ff00)).not.toEqual(fallback);
        // And the fallback is a colour, not grey: a piece with no colour still leaves a coloured light.
        expect(saturation(fallback)).toBeGreaterThan(0.2);
    });

    it('gives three finite channels in (0, 1], the strongest at full strength', () => {
        const rand = mulberry32(99);
        const tried = [0x000000, 0xffffff, 0x808080, 0xff0000, 0x00ff00, 0x0000ff, 0x010000, 0xfffffe, -1, 0x1ffffff];
        for (let i = 0; i < 400; i++) tried.push(Math.floor(rand() * 0x1000000));
        for (const hex of tried) {
            const rgb = pieceColor(hex);
            expect(rgb).toHaveLength(3);
            for (const c of rgb) {
                expect(Number.isFinite(c), hex.toString(16)).toBe(true);
                // Every channel keeps a floor, so a pure primary still reaches all three of the bloom's channels.
                expect(c, hex.toString(16)).toBeGreaterThan(0);
                expect(c, hex.toString(16)).toBeLessThanOrEqual(1 + 1e-12);
            }
            if (hex > 0 && hex <= 0xffffff) expect(Math.max(...rgb), hex.toString(16)).toBeCloseTo(1, 9);
        }
        // A new array every time: the world keeps what it is given.
        expect(pieceColor(0x123456)).not.toBe(pieceColor(0x123456));
    });

    it('keeps the hue of what it is given: the order of the channels never changes', () => {
        const rand = mulberry32(4242);
        for (let i = 0; i < 600; i++) {
            const hex = Math.floor(rand() * 0x1000000);
            const given = linRGB(hex);
            expect(order(pieceColor(hex)), hex.toString(16)).toEqual(order(given));
        }
        // Greys stay grey; the primaries keep their own channel on top.
        for (const grey of [0x000000, 0x777777, 0xffffff]) {
            const [r, g, b] = pieceColor(grey);
            expect(r).toBe(g);
            expect(g).toBe(b);
        }
        expect(pieceColor(0xff0000)[0]).toBeGreaterThan(pieceColor(0xff0000)[1]);
        expect(pieceColor(0x00ff00)[1]).toBeGreaterThan(pieceColor(0x00ff00)[2]);
        expect(pieceColor(0x0000ff)[2]).toBeGreaterThan(pieceColor(0x0000ff)[0]);
    });

    it('gives each of the theme\'s seven pieces a light of its own, more its own hue than the paint is', () => {
        const pieces = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
        const lights = pieces.map((key) => pieceColor(STILLWATER_TETROMINOS.colors[key]));
        pieces.forEach((key, i) => {
            const paint = linRGB(Number.parseInt(STILLWATER_TETROMINOS.colors[key].slice(1), 16));
            // A pale colour is pushed toward its own hue.
            expect(saturation(lights[i]), key).toBeGreaterThan(saturation(paint));
            expect(saturation(lights[i]), key).toBeGreaterThan(0.3);
            for (let j = i + 1; j < pieces.length; j++) {
                const apart = Math.hypot(...lights[i].map((c, k) => c - lights[j][k]));
                expect(apart, `${key} and ${pieces[j]}`).toBeGreaterThan(0.1);
            }
        });
    });
});

describe('stillwater core: the hours of the night', () => {
    const n = HOURS.length;

    it('gives every hour a name, every colour and every scalar', () => {
        expect(n).toBeGreaterThanOrEqual(3);
        expect(Object.isFrozen(HOURS)).toBe(true);
        expect(Object.isFrozen(PALETTE_KEYS)).toBe(true);
        expect(Object.isFrozen(PALETTE_SCALARS)).toBe(true);
        expect(new Set(PALETTE_KEYS).size).toBe(PALETTE_KEYS.length);
        expect(new Set(PALETTE_SCALARS).size).toBe(PALETTE_SCALARS.length);
        expect(PALETTE_KEYS.filter((key) => PALETTE_SCALARS.includes(key))).toEqual([]);
        expect(new Set(HOURS.map((hour) => hour.name)).size).toBe(n);
        for (const hour of HOURS) {
            expect(typeof hour.name).toBe('string');
            expect(hour.name.length).toBeGreaterThan(0);
            expect(Object.isFrozen(hour)).toBe(true);
            // Nothing but its name, its colours and its scalars: the world blends every key it finds in the lists.
            expect(Object.keys(hour).sort()).toEqual(['name', ...PALETTE_KEYS, ...PALETTE_SCALARS].sort());
            for (const key of PALETTE_KEYS) {
                const colour = hour[key];
                const label = `${hour.name}.${key}`;
                expect(Array.isArray(colour), label).toBe(true);
                expect(colour, label).toHaveLength(3);
                expect(Object.isFrozen(colour), label).toBe(true);
                for (const c of colour) {
                    expect(Number.isFinite(c), label).toBe(true);
                    expect(c, label).toBeGreaterThanOrEqual(0);
                    expect(c, label).toBeLessThanOrEqual(1); // written as the eye meets them (sRGB), stored linear
                }
            }
            for (const key of PALETTE_SCALARS) {
                expect(Number.isFinite(hour[key]), `${hour.name}.${key}`).toBe(true);
                expect(hour[key], `${hour.name}.${key}`).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it('keeps every hour a night: a dark sky, a pale moon, mist that is lit toward the moon', () => {
        const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        for (const hour of HOURS) {
            expect(luma(hour.zenith), hour.name).toBeLessThan(luma(hour.horizon));
            expect(luma(hour.haze), hour.name).toBeLessThan(luma(hour.hazeLit));
            expect(luma(hour.moon), hour.name).toBeGreaterThan(luma(hour.glow));
            expect(luma(hour.glow), hour.name).toBeGreaterThan(luma(hour.horizon));
            // The far wood is a darker shape against the mist, never a pale one.
            expect(luma(hour.forest), hour.name).toBeLessThan(luma(hour.haze));
            // The water gives back less than anything above it.
            expect(luma(hour.deep), hour.name).toBeLessThan(luma(hour.haze));
            expect(luma(hour.groundAmb), hour.name).toBeLessThan(luma(hour.skyAmb));
            expect(hour.mist, hour.name).toBeGreaterThan(0);
        }
    });

    it('counts the hours by level, one each, and moves on with the clock', () => {
        expect(hourAt(1)).toBe(0);
        for (let level = 1; level < 40; level++) expect(hourAt(level + 1) - hourAt(level)).toBe(1);
        // A level that is not one is the first.
        for (const junk of [0, -4, NaN, undefined, null, 'x', -Infinity]) expect(hourAt(junk), String(junk)).toBe(0);
        expect(hourAt(3.4)).toBe(hourAt(3));
        expect(hourAt('5')).toBe(4);
        // The clock adds a whole hour every HOUR_SECONDS, whatever the level.
        expect(hourAt(1, HOUR_SECONDS)).toBeCloseTo(1, 12);
        for (const level of [1, 2, 9]) {
            for (const time of [0, 1, 37.5, HOUR_SECONDS * 3.25, 86400]) {
                expect(hourAt(level, time)).toBeCloseTo(hourAt(level) + time / HOUR_SECONDS, 9);
                expect(hourAt(level, time, true)).toBe(hourAt(level, time));
                // Held still, it is the level's own hour however long the clock has run.
                expect(hourAt(level, time, false)).toBe(hourAt(level));
            }
        }
        // A clock that has not started, or is not a number, adds nothing.
        expect(hourAt(4, -50)).toBe(hourAt(4));
        expect(hourAt(4, NaN)).toBe(hourAt(4));
        expect(hourAt(4, Infinity)).toBe(hourAt(4));
        expect(hourAt(4)).toBe(hourAt(4, 0));
    });

    it('rests on each hour before it moves on, and never moves back', () => {
        expect(HOUR_REST).toBeGreaterThanOrEqual(0);
        expect(HOUR_REST).toBeLessThan(0.5);
        expect(hourBlend(0)).toBe(0);
        expect(hourBlend(1)).toBe(1);
        expect(hourBlend(0.5)).toBeCloseTo(0.5, 12);
        expect(hourBlend(HOUR_REST)).toBe(0);
        expect(hourBlend(HOUR_REST * 0.5)).toBe(0);
        expect(hourBlend(1 - HOUR_REST)).toBeCloseTo(1, 12);
        expect(hourBlend(1 - HOUR_REST * 0.5)).toBe(1);
        expect(hourBlend(-3)).toBe(0);
        expect(hourBlend(3)).toBe(1);
        let last = 0;
        for (let f = 0; f <= 1.0001; f += 0.002) {
            const w = hourBlend(f);
            expect(w).toBeGreaterThanOrEqual(last);
            expect(w + hourBlend(1 - f)).toBeCloseTo(1, 9); // the same going as coming
            last = w;
        }
    });

    it('is each hour\'s own palette at the whole hours, and all through its rest', () => {
        HOURS.forEach((hour, i) => {
            for (const h of [i, i + HOUR_REST * 0.5, i + HOUR_REST * 0.99, i - HOUR_REST * 0.5, i + n, i - n]) {
                const palette = paletteAt(h);
                for (const key of PALETTE_KEYS) {
                    const label = `${hour.name}.${key} at ${h}`;
                    for (let c = 0; c < 3; c++) expect(palette[key][c], label).toBeCloseTo(hour[key][c], 12);
                }
                for (const key of PALETTE_SCALARS) {
                    expect(palette[key], `${hour.name}.${key} at ${h}`).toBeCloseTo(hour[key], 12);
                }
            }
            // Exactly its own on the hour.
            const exact = paletteAt(i);
            for (const key of PALETTE_KEYS) expect(exact[key]).toEqual([...hour[key]]);
            for (const key of PALETTE_SCALARS) expect(exact[key]).toBe(hour[key]);
        });
    });

    it('comes round again: the same palette every HOURS.length hours, forward or back', () => {
        for (let h = 0; h < n; h += 0.137) {
            const here = paletteAt(h);
            for (const turns of [1, 3, -1, -4]) {
                const there = paletteAt(h + turns * n);
                for (const key of PALETTE_KEYS) {
                    const label = `${key} at ${h} + ${turns} turns`;
                    for (let c = 0; c < 3; c++) expect(there[key][c], label).toBeCloseTo(here[key][c], 9);
                }
                for (const key of PALETTE_SCALARS) expect(there[key]).toBeCloseTo(here[key], 9);
            }
        }
    });

    it('is half of each at the half hour, and takes an hour that is not a number for the first', () => {
        for (let i = 0; i < n; i++) {
            const a = HOURS[i];
            const b = HOURS[(i + 1) % n];
            const mid = paletteAt(i + 0.5);
            for (const key of PALETTE_KEYS) {
                for (let c = 0; c < 3; c++) expect(mid[key][c]).toBeCloseTo((a[key][c] + b[key][c]) / 2, 12);
            }
            for (const key of PALETTE_SCALARS) expect(mid[key]).toBeCloseTo((a[key] + b[key]) / 2, 12);
        }
        for (const junk of [NaN, undefined, Infinity, -Infinity]) {
            const palette = paletteAt(junk);
            for (const key of PALETTE_KEYS) expect(palette[key], String(junk)).toEqual([...HOURS[0][key]]);
        }
    });

    it('never jumps: not between two hours, and not where the last hour turns into the first', () => {
        const step = 0.001;
        // The steepest the blend ever is (a smoothstep over what is left of the hour after its rests).
        const steepest = 1.5 / (1 - 2 * HOUR_REST);
        const spans = PALETTE_SCALARS.map((key) => Math.max(...HOURS.map((hour) => hour[key]))
            - Math.min(...HOURS.map((hour) => hour[key])));
        const flat = (palette) => [
            ...PALETTE_KEYS.flatMap((key) => palette[key]),
            ...PALETTE_SCALARS.map((key) => palette[key]),
        ];
        const colours = PALETTE_KEYS.length * 3;
        const jumps = [];
        let last = flat(paletteAt(-0.25));
        let moved = 0;
        for (let h = -0.25 + step; h <= n + 0.25; h += step) {
            const now = flat(paletteAt(h));
            for (let i = 0; i < now.length; i++) {
                const change = Math.abs(now[i] - last[i]);
                // (Every colour channel lies in 0..1, so none can move faster than the blend itself.)
                const most = (i < colours ? 1 : spans[i - colours]) * steepest * step + 1e-9;
                if (change > most && jumps.length < 8) {
                    const key = i < colours
                        ? `${PALETTE_KEYS[Math.floor(i / 3)]}[${i % 3}]`
                        : PALETTE_SCALARS[i - colours];
                    jumps.push(`${key} moves ${change.toFixed(5)} at hour ${h.toFixed(3)}`);
                }
                moved += change;
            }
            last = now;
        }
        expect(jumps).toEqual([]);
        expect(moved).toBeGreaterThan(0.5); // the night does change
        // Just before the wheel comes round it is all but the first hour again.
        const before = paletteAt(n - 1e-6);
        const after = paletteAt(1e-6);
        for (const key of PALETTE_KEYS) {
            for (let c = 0; c < 3; c++) {
                expect(before[key][c]).toBeCloseTo(HOURS[0][key][c], 9);
                expect(after[key][c]).toBeCloseTo(HOURS[0][key][c], 9);
            }
        }
    });

    it('writes into the palette it is given, without making a new one', () => {
        const out = {};
        expect(paletteAt(2.5, out)).toBe(out);
        expect(Object.keys(out).sort()).toEqual([...PALETTE_KEYS, ...PALETTE_SCALARS].sort());
        const arrays = PALETTE_KEYS.map((key) => out[key]);
        const first = JSON.parse(JSON.stringify(out));
        paletteAt(4.5, out);
        PALETTE_KEYS.forEach((key, i) => expect(out[key]).toBe(arrays[i]));
        expect(JSON.parse(JSON.stringify(out))).not.toEqual(first);
        // And never into the hours themselves.
        paletteAt(0, out);
        out.haze[0] = 99;
        expect(HOURS[0].haze[0]).not.toBe(99);
        expect(paletteAt(0).haze[0]).toBe(HOURS[0].haze[0]);
    });

    // The hours stand on the wheel in the order of their hue so that any two neighbours blend
    // through a colour and never through grey. Half-way between two hours (the greyest moment of
    // a blend in a straight line) the mist and the moon's halo must still have a colour: at
    // least 45 % of the saturation of the paler of the two hours they come from.
    describe.each(['haze', 'hazeLit', 'glow'])('the %s between two neighbouring hours', (key) => {
        it.each(HOURS.map((hour, i) => [hour.name, HOURS[(i + 1) % n].name, i]))(
            'keeps a colour half-way from %s to %s',
            (fromName, toName, i) => {
                const a = HOURS[i][key];
                const b = HOURS[(i + 1) % n][key];
                const mid = paletteAt(i + 0.5)[key];
                const floor = 0.45 * Math.min(saturation(a), saturation(b));
                expect(floor).toBeGreaterThan(0); // both ends have a colour to keep
                const run = [a, mid, b].map((c) => saturation(c).toFixed(3)).join(' → ');
                const label = `${key} ${fromName} → ${toName}: saturation ${run}`;
                expect(saturation(mid), label).toBeGreaterThanOrEqual(floor);
            },
        );
    });

    it('names the hour the night has left, the one it is moving to, and how far it has come', () => {
        HOURS.forEach((hour, i) => {
            const next = HOURS[(i + 1) % n].name;
            expect(hourNames(i)).toEqual({ from: hour.name, to: next, mix: 0 });
            expect(hourNames(i + 0.5)).toMatchObject({ from: hour.name, to: next });
            expect(hourNames(i + 0.5).mix).toBeCloseTo(0.5, 12);
            expect(hourNames(i + n).from).toBe(hour.name);
            expect(hourNames(i - n).from).toBe(hour.name);
            // The blend it reports is the one the palette is mixed with.
            for (const f of [0.1, 0.3, 0.62, 0.9]) {
                expect(hourNames(i + f).mix).toBeCloseTo(hourBlend(f), 9);
                const palette = paletteAt(i + f);
                const a = hour.haze[0];
                const b = HOURS[(i + 1) % n].haze[0];
                expect(palette.haze[0]).toBeCloseTo(a + (b - a) * hourNames(i + f).mix, 9);
            }
        });
        // The last hour moves on to the first.
        expect(hourNames(n - 0.5)).toMatchObject({ from: HOURS[n - 1].name, to: HOURS[0].name });
        expect(hourNames(-0.5)).toMatchObject({ from: HOURS[n - 1].name, to: HOURS[0].name });
        for (const junk of [NaN, undefined, Infinity]) {
            expect(hourNames(junk)).toEqual({ from: HOURS[0].name, to: HOURS[1 % n].name, mix: 0 });
        }
    });

    it('burns a four-line clear and the heart with a warm light', () => {
        expect(Object.isFrozen(TARNFIRE)).toBe(true);
        expect(TARNFIRE).toHaveLength(3);
        for (const c of TARNFIRE) {
            expect(c).toBeGreaterThan(0);
            expect(c).toBeLessThanOrEqual(1);
        }
        // Gold: red over green over blue.
        expect(TARNFIRE[0]).toBeGreaterThan(TARNFIRE[1]);
        expect(TARNFIRE[1]).toBeGreaterThan(TARNFIRE[2]);
    });
});
