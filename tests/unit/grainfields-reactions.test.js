/**
 * Grainfields — the event language (CPU, three-free): what each gameplay event does to the sky, the
 * light and the wind in the grain, as numbers the world writes into its uniforms.
 *
 * Run without a world: the layout is the stylesheet's own (fallbackLayout), the aim is the world's
 * camera-less one (a screen column at the rig's rest yaw, a distance along it, the ground there), the
 * deck a fixed drift and sun. The look is still being tuned, so the beats are held as relations: a
 * lower row lands nearer, a hard drop tears wider, more lines blow a wider lane.
 */
import { describe, expect, it } from 'vitest';
import {
    DECK, DEG, EYE, PIECE_COLORS, TIMING, hexToLinear, rigFor, smooth,
} from '../../src/themes/grainfields/grainfields-core.js';
import { cardUnion, fallbackLayout } from '../../src/themes/grainfields/grainfields-composition.js';
import { groundHeight } from '../../src/themes/grainfields/grainfields-plan.js';
import {
    FADE, FRONT, GrainfieldsReactions, LIVE, MAX_GAPS, MAX_PULSES, MAX_TRAILS, PULSE, STILL, TEAR, beamDistance,
    beamRadius, breakFor, freeColumn,
} from '../../src/themes/grainfields/grainfields-reactions.js';
import {
    GAPS, PULSES, TRAILS, createUniforms,
} from '../../src/themes/grainfields/grainfields-tsl.js';

const ASPECT = 16 / 9;
/** The solo layout: the card, and the stats bar right of it. */
const SOLO = fallbackLayout(1600, 900);
/** The board alone on screen (no stats bar: local multiplayer, a menu's preview). */
const BOARD_ONLY = { ...SOLO, hud: null };
const CARD = cardUnion(SOLO);
const sunDir = (() => {
    const v = [-0.42, 0.38, -0.82];
    const n = Math.hypot(...v);
    return v.map((c) => c / n);
})();
const DECK_STATE = Object.freeze({ drift: [120, -40], sunDir });

/**
 * The world's camera-less aim (grainfields-world.js aim()): the ground point `distance` metres out
 * along the screen column through x. Records what it was asked; `screenX` turns a ground point
 * back into its screen column.
 */
function makeAim(aspect = ASPECT) {
    const rig = rigFor(aspect);
    const tanH = Math.tan(rig.fov * DEG * 0.5) * aspect;
    const calls = [];
    const aim = (x, y, distance) => {
        calls.push({ x, y, distance });
        const bearing = rig.yaw * DEG + Math.atan((x * 2 - 1) * tanH);
        const gx = EYE.x + Math.sin(bearing) * distance;
        const gz = EYE.z - Math.cos(bearing) * distance;
        return [gx, groundHeight(gx, gz), gz];
    };
    aim.calls = calls;
    aim.last = () => calls[calls.length - 1];
    aim.screenX = (gx, gz) => {
        const bearing = Math.atan2(gx - EYE.x, -(gz - EYE.z));
        return (Math.tan(bearing - rig.yaw * DEG) / tanH + 1) / 2;
    };
    return aim;
}

const lockAt = (reactions, c, time = 10, { layout = BOARD_ONLY, aim = makeAim() } = {}) => reactions.lock(c, time, {
    layout, aim, deck: DECK_STATE,
});
const clearAt = (reactions, c, time = 10, { layout = BOARD_ONLY, aim = makeAim() } = {}) => reactions.clear(c, time, { layout, aim });
/** What is left of a fade begun at `item.fadeAt` over `span` seconds (1 while it stands). */
const left = (item, t, span) => (Number.isFinite(item.fadeAt) ? 1 - smooth(item.fadeAt, item.fadeAt + span, t) : 1);

describe('Grainfields reactions: a lock\'s beam', () => {
    it('lands beside the card on its own side (left of it for u < 0.5, right for u > 0.5), the board alone on screen', () => {
        const reactions = new GrainfieldsReactions();
        const aim = makeAim();
        for (const u of [0, 0.1, 0.2, 0.3, 0.4, 0.45, 0.49]) {
            const gap = lockAt(reactions, { u, rows: [14], color: PIECE_COLORS[1] }, 10, { aim });
            expect(aim.last().x, `u ${u}: its column`).toBeLessThan(CARD.x0);
            expect(aim.last().x, `u ${u}`).toBeGreaterThan(0);
            expect(aim.screenX(gap.footX, gap.footZ), `u ${u}: its foot`).toBeLessThan(CARD.x0);
        }
        for (const u of [0.51, 0.55, 0.6, 0.7, 0.8, 0.9, 1]) {
            const gap = lockAt(reactions, { u, rows: [14], color: PIECE_COLORS[2] }, 10, { aim });
            expect(aim.last().x, `u ${u}: its column`).toBeGreaterThan(CARD.x1);
            expect(aim.last().x, `u ${u}`).toBeLessThan(1);
            expect(aim.screenX(gap.footX, gap.footZ), `u ${u}: its foot`).toBeGreaterThan(CARD.x1);
        }
        // Column 0 lands farthest out on the left, column 10 farthest out on the right.
        const xs = [0, 0.15, 0.3, 0.45].map((u) => freeColumn(BOARD_ONLY, 0, u));
        for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
        const right = [0.55, 0.7, 0.85, 1].map((u) => freeColumn(BOARD_ONLY, 0, u));
        for (let i = 1; i < right.length; i++) expect(right[i]).toBeGreaterThan(right[i - 1]);
        // Nonsense lands right of the card rather than through it; no layout aims at the middle's sides.
        expect(freeColumn(BOARD_ONLY, 0, Number.NaN)).toBeGreaterThan(CARD.x1);
        expect(freeColumn(null, 0, 0.2)).toBeLessThan(0.4);
        expect(freeColumn(null, 0, 0.8)).toBeGreaterThan(0.6);
    });

    // Found by this test (2026-10-18): the right half was squeezed between the card and a stats bar
    // standing close beside it, and fell back to hud.x0 − 0.06, inside the card (0.587–0.617 at
    // 1600×900 against a card edge at 0.612): every solo right-half beam stood behind the card.
    it('lands right of the card for u > 0.5 in the solo layout too, never behind the card or the stats bar', () => {
        for (const layout of [SOLO, fallbackLayout(1920, 1080), fallbackLayout(2560, 1440), fallbackLayout(1280, 720)]) {
            const card = cardUnion(layout);
            const { hud } = layout;
            for (const u of [0.51, 0.55, 0.7, 0.85, 1]) {
                const x = freeColumn(layout, 0, u);
                const label = `u ${u}: ${x.toFixed(3)} (card ${card.x0.toFixed(3)}..${card.x1.toFixed(3)}, bar ${hud.x0.toFixed(3)}..${hud.x1.toFixed(3)})`;
                expect(x, label).toBeGreaterThan(card.x1);
                expect(x > hud.x1 || x < hud.x0, label).toBe(true);
                expect(x, label).toBeLessThan(1);
            }
            for (const u of [0, 0.25, 0.49]) expect(freeColumn(layout, 0, u), `u ${u}`).toBeLessThan(card.x0);
        }
    });

    it('lands nearer for a lower row: the floor near, the top far (the piece\'s lowest row decides)', () => {
        let previous = Infinity;
        for (let row = 0; row <= 19; row++) {
            const d = beamDistance(row);
            expect(d, `row ${row}`).toBeLessThan(previous);
            expect(d, `row ${row}`).toBeGreaterThan(0);
            previous = d;
        }
        expect(beamDistance(-5)).toBe(beamDistance(0));
        expect(beamDistance(40)).toBe(beamDistance(19));
        expect(beamDistance(Number.NaN)).toBe(beamDistance(15));
        const reactions = new GrainfieldsReactions();
        const aim = makeAim();
        const away = (rows) => {
            const gap = lockAt(reactions, { u: 0.2, rows }, 10, { aim });
            return Math.hypot(gap.footX - EYE.x, gap.footZ - EYE.z);
        };
        const floor = away([19]);
        const middle = away([10]);
        const top = away([2]);
        expect(floor).toBeLessThan(middle);
        expect(middle).toBeLessThan(top);
        expect(floor).toBeCloseTo(beamDistance(19), 6);
        expect(away([2, 10, 19])).toBeCloseTo(floor, 6); // its lowest row
        expect(away([])).toBeCloseTo(beamDistance(15), 6);
        expect(aim.calls.every((call) => call.y > 0 && call.y < 1)).toBe(true);
    });

    it('tears a wider gap for a hard drop, which also presses a ring of wind out from where its beam lands', () => {
        const reactions = new GrainfieldsReactions();
        const soft = lockAt(reactions, { u: 0.3, rows: [12], color: PIECE_COLORS[0] });
        expect(reactions.pulses).toHaveLength(0);
        const hard = lockAt(reactions, {
            u: 0.3, rows: [12], color: PIECE_COLORS[0], hardDrop: true, distance: 16,
        });
        expect(hard.hard).toBe(true);
        expect(soft.hard).toBe(false);
        expect(hard.radius).toBeGreaterThan(soft.radius);
        expect(hard.radius / soft.radius).toBeCloseTo(beamRadius(30, true) / beamRadius(30), 9);
        expect(hard.power).toBeGreaterThan(soft.power);
        expect(reactions.pulses).toHaveLength(1);
        const [ring] = reactions.pulses;
        expect(ring.kind).toBe(PULSE.ring);
        expect(ring.x).toBe(hard.footX);
        expect(ring.z).toBe(hard.footZ);
        expect(ring.at).toBe(10);
        expect(ring.speed).toBeGreaterThan(0);
        expect(ring.width).toBeGreaterThan(0);
        // The farther the piece fell, the stronger the ring, within bounds.
        const power = (distance) => {
            const r = new GrainfieldsReactions();
            lockAt(r, {
                u: 0.3, rows: [12], hardDrop: true, distance,
            });
            return r.pulses[0].power;
        };
        expect(power(4)).toBeLessThan(power(12));
        expect(power(12)).toBeLessThan(power(20));
        expect(power(200)).toBe(power(400));
        expect(power(0.1)).toBeGreaterThan(0);
        // A back-to-back run widens every beam.
        expect(beamRadius(40, false, 2)).toBeGreaterThan(beamRadius(40));
        reactions.setB2B(2);
        expect(lockAt(reactions, { u: 0.3, rows: [12] }).radius).toBeGreaterThan(soft.radius);
        expect(beamRadius(100)).toBeGreaterThan(beamRadius(20)); // wider the farther it lands
    });

    it('tears its gap where the sun\'s ray through the beam\'s foot meets the deck, and walks it slowly with the wind', () => {
        const reactions = new GrainfieldsReactions();
        const color = PIECE_COLORS[3];
        const gap = lockAt(reactions, { u: 0.25, rows: [16], color }, 12.5);
        const lift = (DECK.base - gap.footY) / sunDir[1];
        expect(gap.x - gap.footX).toBeCloseTo(sunDir[0] * lift, 6);
        expect(gap.z - gap.footZ).toBeCloseTo(sunDir[2] * lift, 6);
        // The beam walks at walking pace, not the deck's ten metres a second: in ten seconds it has
        // gone a few metres, and its gap with it.
        const [dx, dz] = GrainfieldsReactions.gapShift(gap, 22.5);
        expect(Math.hypot(dx, dz)).toBeGreaterThan(2);
        expect(Math.hypot(dx, dz)).toBeLessThan(10);
        GrainfieldsReactions.gapShift(gap, 12.5).forEach((v) => expect(Math.abs(v)).toBe(0));
        expect([gap.driftX, gap.driftZ]).toEqual(DECK_STATE.drift);
        expect(gap.footY).toBeCloseTo(groundHeight(gap.footX, gap.footZ), 9);
        gap.rgb.forEach((v, k) => expect(v).toBeCloseTo(hexToLinear(color)[k], 12));
        expect(gap.at).toBe(12.5);
        expect(reactions.lastLockAt).toBe(12.5);
        expect(reactions.gaps).toEqual([gap]);
        // A lock without a colour still gets a warm beam; one the aim cannot place tears nothing.
        expect(lockAt(reactions, { u: 0.25, rows: [16] }).rgb).toEqual([1, 0.86, 0.6]);
        const nowhere = reactions.lock({ u: 0.7, rows: [3] }, 13, { layout: BOARD_ONLY, aim: () => null, deck: DECK_STATE });
        expect(nowhere).toBeNull();
        expect(reactions.gaps).toHaveLength(2);
        expect(reactions.lastLockAt).toBe(13);
    });

    it('opens a gap over TIMING.gapOpen, holds it, and closes it by TIMING.gapLife', () => {
        const gap = { at: 20, power: 0.85 };
        const strength = (age) => GrainfieldsReactions.gapStrength(gap, 20 + age);
        expect(strength(-1)).toBe(0);
        expect(strength(0)).toBe(0);
        let previous = 0;
        for (let age = 0.05; age <= TIMING.gapOpen + 1e-9; age += 0.05) {
            expect(strength(age), `opening at ${age.toFixed(2)}`).toBeGreaterThan(previous);
            previous = strength(age);
        }
        expect(strength(TIMING.gapOpen)).toBeCloseTo(gap.power, 9);
        expect(strength(TIMING.gapLife * 0.45)).toBeCloseTo(gap.power, 9);
        previous = gap.power;
        for (let age = TIMING.gapLife * 0.45 + 0.25; age < TIMING.gapLife; age += 0.25) {
            expect(strength(age), `closing at ${age.toFixed(2)}`).toBeLessThan(previous);
            previous = strength(age);
        }
        expect(strength(TIMING.gapLife)).toBe(0);
        expect(strength(TIMING.gapLife + 60)).toBe(0);
        // Through the uniforms: none at the instant of the lock, one while open, none once closed.
        const reactions = new GrainfieldsReactions();
        const u = createUniforms();
        lockAt(reactions, { u: 0.3, rows: [12] }, 20);
        reactions.writeUniforms(u, 20);
        expect(u.gapCount.value).toBe(0);
        reactions.writeUniforms(u, 20 + TIMING.gapOpen / 2);
        expect(u.gapCount.value).toBe(1);
        reactions.writeUniforms(u, 20 + TIMING.gapLife * 0.9);
        expect(u.gapCount.value).toBe(1);
        reactions.writeUniforms(u, 20 + TIMING.gapLife);
        expect(u.gapCount.value).toBe(0);
        expect(reactions.gaps).toHaveLength(0);
    });
});

describe('Grainfields reactions: clears', () => {
    it('sends a lane of wind out across the field from beside the card, alternating sides; two lanes for four lines', () => {
        const reactions = new GrainfieldsReactions();
        const aim = makeAim();
        clearAt(reactions, { lines: 1 }, 10, { aim });
        clearAt(reactions, { lines: 2 }, 11, { aim });
        expect(reactions.trails).toHaveLength(2);
        const [first, second] = reactions.trails;
        expect(Math.abs(first.side)).toBe(1);
        expect(second.side).toBe(-first.side);
        clearAt(reactions, { lines: 3 }, 12, { aim });
        expect(reactions.trails).toHaveLength(3);
        clearAt(reactions, { lines: 4 }, 13, { aim });
        expect(reactions.trails).toHaveLength(5);
        const [a, b] = reactions.trails.slice(3);
        expect(a.side).toBe(-b.side);
        expect(a.at).toBe(13);
        expect(b.at).toBeGreaterThan(13);
        expect(b.at).toBeLessThan(14);
        reactions.trails.forEach((trail, i) => {
            const label = `trail ${i}`;
            // It starts at the eye's feet, beside the card on its side, and runs out away from the eye.
            const out = Math.hypot(trail.x - EYE.x, trail.z - EYE.z);
            expect(out, label).toBeLessThan(15);
            expect(Math.hypot(trail.hx, trail.hz), label).toBeCloseTo(1, 9);
            expect(trail.hx * (trail.x - EYE.x) + trail.hz * (trail.z - EYE.z), label).toBeGreaterThan(0);
            const x = aim.screenX(trail.x, trail.z);
            if (trail.side < 0) expect(x, label).toBeLessThan(CARD.x0);
            else expect(x, label).toBeGreaterThan(CARD.x1);
            expect(Math.sign(trail.curl), label).toBe(trail.side);
        });
        // More lines, a stronger and wider lane.
        const lane = (lines, b2b = 0) => {
            const r = new GrainfieldsReactions();
            r.setB2B(b2b);
            clearAt(r, { lines });
            return r.trails[0];
        };
        for (let lines = 1; lines < 4; lines++) {
            expect(lane(lines + 1).power, `${lines + 1} lines`).toBeGreaterThan(lane(lines).power);
            expect(lane(lines + 1).width, `${lines + 1} lines`).toBeGreaterThan(lane(lines).width);
        }
        expect(lane(2, 3).width).toBeGreaterThan(lane(2).width);
        expect(lane(9).power).toBe(lane(4).power);
        expect(lane(0).power).toBe(lane(1).power);
    });

    it('carries the cleared rows\' colours in its chaff', () => {
        const palette = PIECE_COLORS.map((c) => hexToLinear(c));
        const reactions = new GrainfieldsReactions();
        clearAt(reactions, { lines: 1, rowCodes: [0, 0, 6, 6], palette });
        const want = [0, 1, 2].map((k) => (palette[0][k] * 2 + palette[6][k] * 2) / 4);
        reactions.trails[0].rgb.forEach((v, k) => expect(v).toBeCloseTo(want[k], 12));
        // Without the rows, or a palette, a warm gold.
        clearAt(reactions, { lines: 1 });
        expect(reactions.trails[1].rgb).toEqual([1, 0.86, 0.6]);
        clearAt(reactions, { lines: 1, rowCodes: [99, 98], palette });
        expect(reactions.trails[2].rgb).toEqual([1, 0.86, 0.6]);
    });

    it('wheels the wind in the stand on a T-spin, and only on one', () => {
        const reactions = new GrainfieldsReactions();
        clearAt(reactions, { lines: 2 });
        expect(reactions.pulses).toHaveLength(0);
        clearAt(reactions, { lines: 2, tspin: true }, 11);
        expect(reactions.pulses).toHaveLength(1);
        const [whirl] = reactions.pulses;
        expect(whirl.kind).toBe(PULSE.whirl);
        expect(whirl.at).toBe(11);
        expect(whirl.power).toBeGreaterThan(0);
        expect(whirl.width).toBeGreaterThan(0);
        // In the stand beside the card, out in the field.
        const away = Math.hypot(whirl.x - EYE.x, whirl.z - EYE.z);
        expect(away).toBeGreaterThan(10);
        expect(away).toBeLessThan(150);
    });

    it('tears the sky open over the gate on four lines and runs a front of light out of it toward the eye', () => {
        const reactions = new GrainfieldsReactions();
        clearAt(reactions, { lines: 3 }, 10);
        for (const t of [10, 11, 12, 20]) {
            expect(reactions.tear(t), `three lines, ${t}`).toBe(0);
            expect(reactions.flare(t)[0], `three lines, ${t}`).toBe(0);
        }
        clearAt(reactions, { lines: 4 }, 30);
        expect(reactions.tearAt).toBe(30);
        expect(reactions.tear(30)).toBe(0);
        let previous = 0;
        for (let t = 30.1; t <= 30 + TIMING.tearIn + 1e-9; t += 0.1) {
            expect(reactions.tear(t), `tearing at ${t.toFixed(1)}`).toBeGreaterThan(previous);
            previous = reactions.tear(t);
        }
        expect(reactions.tear(30 + TIMING.tearIn)).toBeCloseTo(1, 9);
        expect(reactions.tear(30 + TIMING.tearLife * 0.5)).toBeCloseTo(1, 9);
        expect(reactions.tear(30 + TIMING.tearLife)).toBe(0);
        // The flare follows the tear: a front of light running out at a steady pace, gone after a while.
        expect(reactions.flare(30)[0]).toBe(0);
        const lit = [31.2, 32, 34].map((t) => reactions.flare(t));
        lit.forEach(([strength]) => expect(strength).toBeGreaterThan(0.5));
        expect(lit[1][1]).toBeGreaterThan(lit[0][1]);
        expect(lit[2][1] - lit[1][1]).toBeCloseTo((lit[1][1] - lit[0][1]) * (2 / 0.8), 6);
        expect(reactions.flare(45)).toEqual([0, 0]);
    });

    it('clears the whole sky on a perfect clear and stills the wind, then lets the deck return', () => {
        const reactions = new GrainfieldsReactions();
        expect(reactions.clearSky(5)).toEqual([0, 0]);
        clearAt(reactions, { lines: 2, perfect: true }, 50);
        expect(reactions.clearSky(50)).toEqual([0, 0]);
        const [sky, still] = reactions.clearSky(53);
        expect(sky).toBeCloseTo(1, 9);
        expect(still).toBeCloseTo(1, 9);
        expect(reactions.clearSky(50 + TIMING.clearHold)[0]).toBeCloseTo(1, 9);
        let previous = 1;
        for (let t = 50 + TIMING.clearHold + 0.5; t < 50 + TIMING.clearHold + TIMING.clearReturn; t += 0.5) {
            const [s] = reactions.clearSky(t);
            expect(s, `returning at ${t}`).toBeLessThan(previous);
            previous = s;
        }
        expect(reactions.clearSky(50 + TIMING.clearHold + TIMING.clearReturn)).toEqual([0, 0]);
    });
});

describe('Grainfields reactions: the chain', () => {
    it('breaks the storm open as the chain grows, and eases it closed, more slowly, when it ends', () => {
        const reactions = new GrainfieldsReactions();
        reactions.setCombo(1, 10);
        expect(reactions.breaking(20)).toBe(0); // a single clear is no chain
        const levels = [];
        let t = 20;
        for (let n = 2; n <= 9; n++) {
            const before = reactions.breaking(t);
            reactions.setCombo(n, t);
            expect(reactions.breaking(t), `combo ${n}: no jump`).toBeCloseTo(before, 12);
            t += TIMING.breakIn;
            levels.push(reactions.breaking(t));
            t += 1;
        }
        for (let i = 1; i < levels.length; i++) expect(levels[i], `combo ${i + 2}`).toBeGreaterThanOrEqual(levels[i - 1]);
        expect(levels[1]).toBeGreaterThan(levels[0]);
        expect(levels[0]).toBeGreaterThan(0.1);
        expect(levels[levels.length - 1]).toBeLessThanOrEqual(1);
        // The same combo again changes nothing.
        reactions.setCombo(9, t);
        expect(reactions.breaking(t)).toBeCloseTo(levels[levels.length - 1], 12);
        // It ends: the deck closes over TIMING.breakOut, slower than it broke.
        const held = reactions.breaking(t);
        reactions.setCombo(0, t);
        expect(reactions.breaking(t)).toBeCloseTo(held, 12);
        expect(reactions.breaking(t + TIMING.breakIn)).toBeGreaterThan(held * 0.5);
        let previous = held;
        for (let s = t + 1; s < t + TIMING.breakOut; s += 1) {
            expect(reactions.breaking(s), `closing at ${s - t} s`).toBeLessThan(previous);
            previous = reactions.breaking(s);
        }
        expect(reactions.breaking(t + TIMING.breakOut)).toBe(0);
        // A shorter chain after a long one eases down too, never in a step.
        reactions.setCombo(6, 200);
        reactions.setCombo(2, 200 + TIMING.breakIn);
        expect(reactions.breaking(200 + TIMING.breakIn + 0.01)).toBeGreaterThan(reactions.breaking(200 + TIMING.breakIn + TIMING.breakOut));
        expect(reactions.breaking(200 + TIMING.breakIn + TIMING.breakOut)).toBeCloseTo(levels[0], 9);
    });

    it('holds a back-to-back level of 0..4', () => {
        const reactions = new GrainfieldsReactions();
        for (const [level, want] of [[2, 2], [9, 4], [-3, 0], [Number.NaN, 0], [2.6, 3]]) {
            reactions.setB2B(level);
            expect(reactions.b2b, String(level)).toBe(want);
        }
    });

    it('sends a wave of wind across the whole field on a level-up', () => {
        const reactions = new GrainfieldsReactions();
        reactions.levelUp(40);
        expect(reactions.pulses).toHaveLength(1);
        expect(reactions.pulses[0]).toMatchObject({ kind: PULSE.wave, at: 40 });
        expect(reactions.pulses[0].z).toBeLessThan(EYE.z);
    });
});

describe('Grainfields reactions: building, never restarting', () => {
    it('feeds the tear over the gate and the front of light on a second quad instead of restarting them', () => {
        const reactions = new GrainfieldsReactions();
        clearAt(reactions, { lines: 4 }, 30);
        const radius = reactions.tearRadius;
        expect(radius).toBe(TEAR.radius);
        // A second quad while the first's front is still on its way to the eye, and a third as
        // the tear is closing: nothing on screen ever steps down.
        let previous = { tear: 0, front: 0, glow: 0 };
        let fed = 0;
        for (let t = 30; t < 60; t += 1 / 30) {
            if (fed === 0 && t >= 32) {
                clearAt(reactions, { lines: 4 }, t);
                // The front still running out from the gate is fed: brighter, held longer.
                expect(reactions.flareGain).toBeGreaterThan(1);
                expect(reactions.flareGain).toBeLessThanOrEqual(FRONT.gain);
                fed = 1;
            } else if (fed === 1 && t >= 44) {
                const closing = reactions.tear(t);
                expect(closing).toBeLessThan(1);
                expect(closing).toBeGreaterThan(0.3);
                clearAt(reactions, { lines: 4 }, t);
                expect(reactions.tear(t)).toBeCloseTo(closing, 9);
                expect(reactions.tear(t + TIMING.tearIn)).toBeCloseTo(1, 9);
                fed = 2;
            }
            const tear = reactions.tear(t);
            const [, front] = reactions.flare(t);
            const glow = reactions.flareGlow(t);
            // The tear steps down only as fast as it closes on its own (a closing tear fed again
            // opens from where it stands); a restart would drop it to nothing in a frame.
            expect(previous.tear - tear, `tear at ${t.toFixed(2)}`).toBeLessThan(0.01);
            // The front keeps running out from the gate while it is lit; it is never sent back.
            if (t > 32 && t < 36) expect(front, `front at ${t.toFixed(2)}`).toBeGreaterThan(previous.front);
            // (The light it lifts only ever fades as slowly as a front fades: never a step.)
            if (t > 31) expect(previous.glow - glow, `glow at ${t.toFixed(2)}`).toBeLessThan(0.03);
            previous = { tear, front, glow };
        }
        // Each quad that found the tear open widened it.
        expect(reactions.tearRadius).toBeGreaterThan(radius);
        expect(reactions.tearRadius).toBeLessThanOrEqual(TEAR.widest);
        // A quad after the front has passed the eye sends a new one out of the gate, and the light of
        // the old one fades out under it instead of dropping.
        const late = new GrainfieldsReactions();
        clearAt(late, { lines: 4 }, 10);
        const t2 = 10 + FRONT.delay + FRONT.pass + 1;
        const before = late.flareGlow(t2);
        expect(before).toBeGreaterThan(0.3);
        clearAt(late, { lines: 4 }, t2);
        expect(late.flareGlow(t2)).toBeCloseTo(before, 9);
        expect(late.flare(t2 + FRONT.delay + 0.5)[1]).toBeLessThan(2000); // a new front, near the gate
    });

    it('answers back-to-back at the gate: each difficult clear of a run tears the sky over Lapporten, wider', () => {
        const reactions = new GrainfieldsReactions();
        reactions.setB2B(1, 0);
        clearAt(reactions, { lines: 2, tspin: true, b2b: true }, 10);
        expect(reactions.tear(10 + TIMING.tearIn)).toBeCloseTo(1, 9);
        const one = reactions.tearRadius;
        reactions.setB2B(3, 12);
        clearAt(reactions, { lines: 2, tspin: true, b2b: true }, 12);
        expect(reactions.tearRadius).toBeGreaterThan(one);
        // No B2B, no tear: a T-spin alone wheels the wind only.
        const plain = new GrainfieldsReactions();
        clearAt(plain, { lines: 2, tspin: true }, 10);
        expect(plain.tear(12)).toBe(0);
    });

    it('holds the clear sky through a second perfect clear (no cloud, then clear again); the wind returns', () => {
        const reactions = new GrainfieldsReactions();
        reactions.perfect(50);
        let previous = 0;
        for (let t = 50; t < 50 + TIMING.clearHold; t += 0.1) {
            if (Math.abs(t - 55) < 0.05) reactions.perfect(t);
            const [sky] = reactions.clearSky(t);
            expect(sky, `sky at ${t.toFixed(1)}`).toBeGreaterThanOrEqual(previous - 1e-9);
            previous = sky;
        }
        // The stillness lets go first: the breeze returns under the clear sky.
        const [sky, still] = reactions.clearSky(55 + STILL.hold + STILL.back + 0.5);
        expect(sky).toBeCloseTo(1, 9);
        expect(still).toBe(0);
    });

    it('keeps opening the storm past a chain of six, a little each step', () => {
        expect(breakFor(0)).toBe(0);
        expect(breakFor(1)).toBe(0);
        expect(breakFor(2)).toBeCloseTo(0.3, 9);
        expect(breakFor(6)).toBeCloseTo(0.9, 9);
        for (let n = 7; n <= 11; n++) expect(breakFor(n), `combo ${n}`).toBeGreaterThan(breakFor(n - 1));
        expect(breakFor(11)).toBeCloseTo(1, 9);
        expect(breakFor(40)).toBe(1);
    });

    it('eases the back-to-back wind in and out instead of stepping it', () => {
        const reactions = new GrainfieldsReactions();
        reactions.setB2B(4, 10);
        expect(reactions.b2bShown(10)).toBe(0);
        expect(reactions.b2bShown(11)).toBeCloseTo(4, 9);
        reactions.setB2B(0, 20);
        expect(reactions.b2bShown(20)).toBeCloseTo(4, 9);
        expect(reactions.b2bShown(22)).toBeGreaterThan(0.5);
        expect(reactions.b2bShown(24)).toBe(0);
        // Settled at once (a rebuild in place carries the run over as it stands).
        reactions.setB2B(3);
        expect(reactions.b2bShown(0)).toBe(3);
    });

    it('blows each cascade wave a stronger, wider lane than the last, and the gale rises with them', () => {
        const reactions = new GrainfieldsReactions();
        for (let wave = 1; wave <= 4; wave++) clearAt(reactions, { lines: 1, cascade: wave }, 10 + wave * 0.36);
        const lanes = reactions.trails;
        for (let i = 1; i < lanes.length; i++) {
            expect(lanes[i].power, `wave ${i + 1}`).toBeGreaterThan(lanes[i - 1].power);
            expect(lanes[i].width, `wave ${i + 1}`).toBeGreaterThan(lanes[i - 1].width);
        }
        const single = new GrainfieldsReactions();
        clearAt(single, { lines: 1 }, 10.36);
        expect(reactions.gale(12)).toBeGreaterThan(single.gale(12));
        // At rest the gale falls away.
        expect(reactions.gale(40)).toBeLessThan(0.01);
    });

    it('turns a small whirl for a T-spin that cleared nothing, where the piece fell', () => {
        const reactions = new GrainfieldsReactions();
        const whirl = reactions.spin({ u: 0.2 }, 10, { layout: BOARD_ONLY, aim: makeAim() });
        expect(whirl).toMatchObject({ kind: PULSE.whirl, at: 10 });
        expect(reactions.pulses).toEqual([whirl]);
        const full = new GrainfieldsReactions();
        clearAt(full, { lines: 2, tspin: true }, 10);
        expect(whirl.power).toBeLessThan(full.pulses[0].power);
        expect(whirl.width).toBeLessThan(full.pulses[0].width);
        expect(reactions.spin({ u: 0.2 }, 11, { layout: BOARD_ONLY, aim: () => null })).toBeNull();
    });
});

describe('Grainfields reactions: the tables', () => {
    it('sizes its tables as the shaders do', () => {
        expect(MAX_GAPS).toBe(GAPS);
        expect(MAX_TRAILS).toBe(TRAILS);
        expect(MAX_PULSES).toBe(PULSES);
        const u = createUniforms();
        expect(u.tables.gaps).toHaveLength(GAPS * 2);
        expect(u.tables.trails).toHaveLength(TRAILS * 3);
        expect(u.tables.pulses).toHaveLength(PULSES * 2);
    });

    it('never holds more gaps, trails or pulses than the tables: the faintest fades out, the newest is kept', () => {
        const reactions = new GrainfieldsReactions();
        for (let k = 0; k < MAX_GAPS * 3; k++) {
            const gap = lockAt(reactions, {
                u: (k % 10) / 10, rows: [k % 20], hardDrop: k % 2 === 0, distance: 8,
            }, 10 + k * 0.1);
            expect(reactions.gaps.length).toBeLessThanOrEqual(MAX_GAPS);
            expect(reactions.pulses.length).toBeLessThanOrEqual(MAX_PULSES);
            expect(reactions.gaps[reactions.gaps.length - 1]).toBe(gap);
            const standing = reactions.gaps.filter((g) => !Number.isFinite(g.fadeAt));
            expect(standing.length).toBeLessThanOrEqual(LIVE.gaps);
        }
        expect(reactions.gaps).toHaveLength(MAX_GAPS);
        // The beams that gave up their place were soft locks' (the faintest) before hard drops'.
        const fading = reactions.gaps.filter((g) => Number.isFinite(g.fadeAt));
        expect(fading.length).toBeGreaterThan(0);
        expect(reactions.pulses.length).toBeLessThanOrEqual(MAX_PULSES);
        for (let k = 0; k < MAX_TRAILS * 3; k++) {
            clearAt(reactions, { lines: 1 + (k % 4), tspin: k % 3 === 0 }, 20 + k);
            reactions.levelUp(20 + k);
            expect(reactions.trails.length).toBeLessThanOrEqual(MAX_TRAILS);
            expect(reactions.pulses.length).toBeLessThanOrEqual(MAX_PULSES);
        }
        expect(reactions.trails.length).toBeLessThanOrEqual(MAX_TRAILS);
        expect(reactions.trails[reactions.trails.length - 1].at).toBeGreaterThanOrEqual(20 + MAX_TRAILS * 3 - 1);
        const newest = reactions.pulses[reactions.pulses.length - 1];
        expect(newest).toMatchObject({ kind: PULSE.wave, at: 20 + MAX_TRAILS * 3 - 1 });
        // The uniforms never count past their tables either.
        const u = createUniforms();
        reactions.writeUniforms(u, 20 + MAX_TRAILS * 3);
        expect(u.gapCount.value).toBeLessThanOrEqual(GAPS);
        expect(u.trailCount.value).toBeLessThanOrEqual(TRAILS);
        expect(u.pulseCount.value).toBeLessThanOrEqual(PULSES);
    });

    // The worst pop this theme had (2026-10-22 audit): twelve gaps, the oldest shifted out, while a
    // gap lives 34 s, so at two locks a second every sunbeam stood ~6 s and winked out at full
    // strength. Now a beam that gives up its place fades out over FADE.gaps.
    it('never winks a beam, a lane or a pulse out under rapid play: what gives up its place fades', () => {
        const reactions = new GrainfieldsReactions();
        const u = createUniforms();
        const dt = 1 / 60;
        /** What each of a table's things shows, by the thing (gone: 0). */
        const shown = (list, strength) => new Map(list.map((item) => [item, strength(item)]));
        let gaps = new Map();
        let trails = new Map();
        let pulses = new Map();
        let worst = { gaps: 0, trails: 0, pulses: 0 };
        let lock = 0;
        for (let t = 0; t < 40; t += dt) {
            // A quick hand: a hard drop every 0.3 s, a clear every other lock, a cascade's waves now
            // and then, a T-spin and a level now and then.
            if (t >= lock * 0.3) {
                lockAt(reactions, {
                    u: (lock * 0.37) % 1, rows: [19 - (lock % 12)], hardDrop: true, distance: 10,
                }, t);
                if (lock % 2 === 0) {
                    clearAt(reactions, {
                        lines: 1 + (lock % 4), cascade: 1 + (lock % 3), tspin: lock % 9 === 0,
                    }, t);
                }
                if (lock % 15 === 0) reactions.levelUp(t);
                lock += 1;
            }
            reactions.writeUniforms(u, t);
            const nowGaps = shown(reactions.gaps, (g) => GrainfieldsReactions.gapStrength(g, t));
            // (As the shaders draw them: a lane full for four seconds, out by 7.5; a ring or wave out
            // by six, a whirl by seven; times what is left of a fade.)
            const nowTrails = shown(reactions.trails, (tr) => tr.power * left(tr, t, FADE.trails)
                * smooth(0, 0.25, t - tr.at) * (1 - smooth(4, 7.5, t - tr.at)));
            const nowPulses = shown(reactions.pulses, (p) => {
                const age = t - p.at;
                const life = p.kind === PULSE.whirl
                    ? smooth(0, 0.6, age) * (1 - smooth(3.5, 7, age))
                    : smooth(0, 0.15, age) * (1 - smooth(2.5, 6, age));
                return p.power * left(p, t, FADE.pulses) * life;
            });
            const drop = (was, now) => {
                let most = 0;
                for (const [item, before] of was) most = Math.max(most, before - (now.get(item) ?? 0));
                return most;
            };
            worst.gaps = Math.max(worst.gaps, drop(gaps, nowGaps));
            worst.trails = Math.max(worst.trails, drop(trails, nowTrails));
            worst.pulses = Math.max(worst.pulses, drop(pulses, nowPulses));
            gaps = nowGaps;
            trails = nowTrails;
            pulses = nowPulses;
        }
        expect(lock).toBeGreaterThan(100);
        // A frame's step down is a fade's (well under a tenth), never a beam cut at full strength.
        expect(worst.gaps).toBeLessThan(0.05);
        expect(worst.trails).toBeLessThan(0.1);
        expect(worst.pulses).toBeLessThan(0.1);
        worst = null;
    });
    it('forgets what has run its course', () => {
        const reactions = new GrainfieldsReactions();
        lockAt(reactions, {
            u: 0.2, rows: [10], hardDrop: true, distance: 9,
        }, 0);
        clearAt(reactions, { lines: 2, tspin: true }, 0);
        reactions.prune(1);
        expect([reactions.gaps.length, reactions.trails.length, reactions.pulses.length]).toEqual([1, 1, 2]);
        reactions.prune(12);
        expect(reactions.trails).toHaveLength(0);
        expect(reactions.pulses).toHaveLength(0);
        expect(reactions.gaps).toHaveLength(1);
        reactions.prune(TIMING.gapLife);
        expect(reactions.gaps).toHaveLength(0);
    });
});

describe('Grainfields reactions: the uniforms', () => {
    it('writes the counts and the rows the shaders read into the real uniforms, and hands back the scalars', () => {
        const reactions = new GrainfieldsReactions();
        const u = createUniforms();
        const t0 = 40;
        const soft = lockAt(reactions, { u: 0.2, rows: [17], color: PIECE_COLORS[4] }, t0);
        const hard = lockAt(reactions, {
            u: 0.8, rows: [9], color: PIECE_COLORS[6], hardDrop: true, distance: 14,
        }, t0 + 0.5);
        clearAt(reactions, { lines: 4, tspin: true }, t0 + 0.5);
        reactions.tearX = -4100;
        reactions.tearZ = -10800;
        reactions.setCombo(3, t0);
        reactions.levelUp(t0 + 0.5);
        const t = t0 + 2;
        const fx = reactions.writeUniforms(u, t);
        // The gaps, in order, each two rows: (deck x, deck z, radius, strength) + (rgb, open time),
        // the deck point being the gap's world point (walked on) plus the deck's drift now.
        expect(u.gapCount.value).toBe(2);
        [soft, hard].forEach((gap, n) => {
            const [dx, dz] = GrainfieldsReactions.gapShift(gap, t);
            const row = u.tables.gaps[n * 2].toArray();
            expect(row[0], `gap ${n}`).toBeCloseTo(gap.x + dx + u.drift.value.x, 6);
            expect(row[1], `gap ${n}`).toBeCloseTo(gap.z + dz + u.drift.value.y, 6);
            expect(row.slice(2), `gap ${n}`).toEqual([gap.radius, GrainfieldsReactions.gapStrength(gap, t)]);
            expect(u.tables.gaps[n * 2 + 1].toArray(), `gap ${n}`).toEqual([...gap.rgb, gap.at]);
        });
        // The trails, each three rows: (start, start time, power) + (heading, curl, width) + (rgb, side).
        expect(u.trailCount.value).toBe(2);
        reactions.trails.forEach((tr, n) => {
            expect(u.tables.trails[n * 3].toArray()).toEqual([tr.x, tr.z, tr.at, tr.power]);
            expect(u.tables.trails[n * 3 + 1].toArray()).toEqual([tr.hx, tr.hz, tr.curl, tr.width]);
            expect(u.tables.trails[n * 3 + 2].toArray()).toEqual([...tr.rgb, tr.side]);
        });
        // The pulses: the hard drop's ring, the T-spin's whirl, the level's wave.
        expect(u.pulseCount.value).toBe(3);
        expect(reactions.pulses.map((p) => p.kind)).toEqual([PULSE.ring, PULSE.whirl, PULSE.wave]);
        reactions.pulses.forEach((p, n) => {
            expect(u.tables.pulses[n * 2].toArray()).toEqual([p.x, p.z, p.at, p.power]);
            expect(u.tables.pulses[n * 2 + 1].toArray()).toEqual([p.kind, p.speed, p.width, 0]);
        });
        // The scalars, as returned and as written.
        expect(fx).toEqual({
            breaking: reactions.breaking(t), tear: reactions.tear(t), flare: reactions.flare(t)[0], clearSky: 0, still: 0,
        });
        expect(fx.breaking).toBeGreaterThan(0);
        expect(fx.tear).toBeGreaterThan(0);
        expect(fx.flare).toBeGreaterThan(0);
        expect(u.breaking.value).toBe(fx.breaking);
        expect(u.tear.value.toArray()).toEqual([-4100, -10800, u.tear.value.z, fx.tear]);
        expect(u.tear.value.z).toBeGreaterThan(0);
        expect(u.flare.value).toBe(fx.flare);
        expect(u.flareFront.value).toBe(reactions.flare(t)[1]);
        expect(u.clearSky.value).toBe(0);
        expect(u.still.value).toBe(0);
        // A gap not yet open is skipped, and the rows stay packed from the first.
        const fresh = new GrainfieldsReactions();
        lockAt(fresh, { u: 0.2, rows: [12] }, 100);
        lockAt(fresh, { u: 0.3, rows: [12] }, 99);
        fresh.writeUniforms(u, 100);
        expect(u.gapCount.value).toBe(1);
        expect(u.tables.gaps[1].w).toBe(99);
        // A perfect clear's sky and stillness reach the uniforms too.
        clearAt(fresh, { lines: 1, perfect: true }, 100);
        fresh.writeUniforms(u, 104);
        expect(u.clearSky.value).toBeCloseTo(1, 9);
        expect(u.still.value).toBeCloseTo(1, 9);
    });

    it('forgets everything on a reset', () => {
        const reactions = new GrainfieldsReactions();
        lockAt(reactions, {
            u: 0.2, rows: [12], hardDrop: true, distance: 9,
        });
        clearAt(reactions, { lines: 4, perfect: true, tspin: true });
        reactions.setCombo(5, 10);
        reactions.setB2B(3);
        reactions.reset();
        expect([reactions.gaps, reactions.trails, reactions.pulses]).toEqual([[], [], []]);
        expect([reactions.combo, reactions.b2b]).toEqual([0, 0]);
        const u = createUniforms();
        expect(reactions.writeUniforms(u, 12)).toEqual({
            breaking: 0, tear: 0, flare: 0, clearSky: 0, still: 0,
        });
        expect([u.gapCount.value, u.trailCount.value, u.pulseCount.value]).toEqual([0, 0, 0]);
    });
});
