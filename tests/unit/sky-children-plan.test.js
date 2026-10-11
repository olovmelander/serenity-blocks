/**
 * Sky Children — the authored world, placed per layout (sky-children-plan.js, three-free).
 *
 * Each set piece is given a screen anchor and a distance and unprojected through the solved
 * camera, so the realm turns as one with the layout. Pinned as relations over the same screens and
 * rows the frame test solves: everything stands in front of the eye, the isles keep to their free
 * zones (the Spring Isle left of the leftmost card, the Twin Isle right of the stats bar), every isle
 * faces the eye, and the children have their thermals.
 */
import { describe, expect, it } from 'vitest';
import { frameFor, nominalLayout, project } from '../../src/themes/sky-children/sky-children-frame.js';
import {
    PLAN, bearingOf, faceYaw, placePlan,
} from '../../src/themes/sky-children/sky-children-plan.js';
import { fallbackLayout } from '../../src/themes/sky-children/sky-children-composition.js';

const SCREENS = [['16:9', 1600, 900], ['16:10', 1680, 1050], ['21:9', 2560, 1080], ['4:3', 1024, 768],
    ['390×844', 390, 844], ['412×915', 412, 915]];
const card = (x0, x1, y0, y1) => ({
    x0, x1, y0, y1,
});
const TWO_BOARDS = {
    cardCount: 2, cards: [card(0.27, 0.49, 0.11, 0.89), card(0.51, 0.73, 0.11, 0.89)], hud: null, boards: [],
};
const FOUR_BOARDS = {
    cardCount: 4,
    cards: [
        card(0.07, 0.27, 0.11, 0.89), card(0.29, 0.49, 0.11, 0.89),
        card(0.51, 0.71, 0.11, 0.89), card(0.73, 0.93, 0.11, 0.89),
    ],
    hud: null,
    boards: [],
};
const CASES = [
    ...SCREENS.flatMap(([name, W, H]) => [
        [`${name} nominal`, W / H, nominalLayout(W / H)],
        [`${name} stylesheet`, W / H, fallbackLayout(W, H)],
    ]),
    ['16:9 two boards', 16 / 9, TWO_BOARDS],
    ['16:9 four boards', 16 / 9, FOUR_BOARDS],
].map(([name, aspect, layout]) => {
    const frame = frameFor(aspect, layout, {});
    return {
        name, aspect, layout, frame, placed: placePlan(frame, {}),
    };
});

/** The single set pieces placePlan returns (the archipelago and the thermals are lists). */
const PIECES = ['spring', 'twin', 'gate', 'cornerL', 'cornerR'];

const unit = (p) => {
    const d = Math.hypot(p[0], p[1], p[2]);
    return [p[0] / d, p[1] / d, p[2] / d];
};
const ahead = (frame, pos) => {
    const { f } = frame.cam.basis;
    return pos[0] * f[0] + pos[1] * f[1] + pos[2] * f[2];
};
const screenOf = (frame, pos) => project(unit(pos), frame.cam);
const leftX0 = (layout) => Math.min(...layout.cards.map((c) => c.x0));
/** Right edge of what the Twin Isle must clear: the cards, and in landscape the stats bar (a phone has none on screen). */
const rightX1 = (layout, plan) => Math.max(
    ...layout.cards.map((c) => c.x1),
    plan === 'leg' && layout.hud ? layout.hud.x1 : 0,
);

describe('sky children plan: placing the realm', () => {
    it('places every set piece, far isle and thermal in front of the eye', () => {
        for (const { name, frame, placed } of CASES) {
            for (const piece of PIECES) {
                expect(placed[piece], `${name} ${piece}`).toBeTruthy();
                expect(placed[piece].pos.every(Number.isFinite), `${name} ${piece}`).toBe(true);
                expect(ahead(frame, placed[piece].pos), `${name} ${piece}`).toBeGreaterThan(0);
                expect(screenOf(frame, placed[piece].pos).front, `${name} ${piece}`).toBe(true);
            }
            placed.archipelago.forEach((e, i) => {
                expect(ahead(frame, e.pos), `${name} far isle ${i}`).toBeGreaterThan(0);
                expect(e.scale, `${name} far isle ${i}`).toBeGreaterThan(0);
            });
            placed.thermals.forEach((e, i) => {
                expect(ahead(frame, e.pos), `${name} thermal ${i}`).toBeGreaterThan(0);
                expect(e.radius, `${name} thermal ${i}`).toBeGreaterThan(0);
            });
        }
    });

    it('authors depth: corners close by, the Spring Isle nearest, the Twin Isle behind, the Far Gate far off', () => {
        for (const { name, placed } of CASES) {
            const dist = (e) => Math.hypot(e.pos[0], e.pos[1], e.pos[2]);
            expect(dist(placed.cornerL), name).toBeLessThan(100);
            expect(dist(placed.cornerR), name).toBeLessThan(100);
            expect(dist(placed.spring), name).toBeLessThan(dist(placed.twin));
            expect(dist(placed.twin), name).toBeLessThan(dist(placed.gate));
            expect(dist(placed.gate), name).toBeGreaterThan(PLAN.gate.dist * 0.9);
            // The isles lean their crowns toward the eye; nothing else does.
            expect(placed.spring.pitch, name).toBeGreaterThan(0.1);
            expect(placed.twin.pitch, name).toBeGreaterThan(0.1);
            expect(placed.gate.pitch, name).toBe(0);
        }
    });

    it('keeps the Spring Isle left of the cards, the Twin Isle right of the stats bar (of the card on a phone)', () => {
        for (const {
            name, frame, layout, placed,
        } of CASES) {
            const spring = screenOf(frame, placed.spring.pos);
            const twin = screenOf(frame, placed.twin.pos);
            if (layout.cards.length === 1) {
                expect(spring.x, `${name} Spring Isle`).toBeLessThan(leftX0(layout));
                expect(twin.x, `${name} Twin Isle`).toBeGreaterThan(rightX1(layout, frame.plan));
            }
            // The Far Gate stands on the far left in landscape, toward the middle in a smile frame.
            const gate = screenOf(frame, placed.gate.pos);
            if (frame.plan === 'leg') expect(gate.x, `${name} Far Gate`).toBeLessThan(leftX0(layout));
            // The corners are pinned to the frame's bottom corners.
            const left = screenOf(frame, placed.cornerL.pos);
            const right = screenOf(frame, placed.cornerR.pos);
            expect(left.x, name).toBeLessThan(0.1);
            expect(right.x, name).toBeGreaterThan(0.9);
            expect(Math.min(left.y, right.y), name).toBeGreaterThan(0.9);
        }
    });

    // A row of boards takes the smile plan; the isles stand in the free margins beside it (with four
    // boards only a sliver is left: they stand half out of the frame).
    it('keeps both isles beside a row of two or four boards too', () => {
        const rows = CASES.filter((c) => c.layout.cards.length > 1);
        expect(rows).toHaveLength(2);
        const over = [];
        for (const {
            name, frame, layout, placed,
        } of rows) {
            const spring = screenOf(frame, placed.spring.pos).x;
            const twin = screenOf(frame, placed.twin.pos).x;
            if (spring >= leftX0(layout)) over.push(`${name}: Spring Isle at x ${spring.toFixed(3)}`);
            if (twin <= rightX1(layout, frame.plan)) over.push(`${name}: Twin Isle at x ${twin.toFixed(3)}`);
        }
        expect(over).toEqual([]);
    });

    it('hangs the left group off the bow\'s leg: the Spring Isle stands left of the foot', () => {
        for (const { name, frame, placed } of CASES.filter((c) => c.frame.plan === 'leg')) {
            const spring = screenOf(frame, placed.spring.pos);
            expect(spring.x, name).toBeLessThan(frame.foot.x);
            expect(placed.spring.bearing, name).toBeLessThan(bearingOf(placed.twin.pos));
        }
    });

    it('turns every isle to face the eye: its local +z points at the origin', () => {
        for (const { name, placed } of CASES) {
            for (const piece of PIECES) {
                const e = placed[piece];
                // The local +z turned by the isle's yaw about y (as the isles and the world turn it).
                const face = [Math.sin(e.yaw), Math.cos(e.yaw)];
                const back = unit([-e.pos[0], 0, -e.pos[2]]);
                expect(face[0] * back[0] + face[1] * back[2], `${name} ${piece}`).toBeCloseTo(1, 9);
                expect(e.yaw, `${name} ${piece}`).toBeCloseTo(faceYaw(bearingOf(e.pos)), 9);
            }
        }
        // faceYaw is exactly the turn that does it, for any bearing.
        for (const b of [-2, -0.7, 0, 0.3, 1.4, 3]) {
            const pos = [Math.sin(b) * 100, 0, -Math.cos(b) * 100];
            const yaw = faceYaw(bearingOf(pos));
            expect(Math.sin(yaw) * (-pos[0] / 100) + Math.cos(yaw) * (-pos[2] / 100)).toBeCloseTo(1, 12);
        }
    });

    it('gives the children five thermals beside a landscape card and four round a phone\'s', () => {
        for (const { name, frame, placed } of CASES) {
            expect(placed.thermals, name).toHaveLength(frame.plan === 'leg' ? 5 : 4);
            placed.thermals.forEach((t, i) => {
                const d = Math.hypot(...t.pos);
                expect(d, `${name} thermal ${i}`).toBeGreaterThanOrEqual(260);
                expect(d, `${name} thermal ${i}`).toBeLessThanOrEqual(450);
            });
        }
        // Re-placing into the same `out` reuses it and trims the thermals to the plan.
        const out = placePlan(CASES[0].frame, {});
        const { thermals } = out;
        placePlan(CASES.find((c) => c.frame.plan === 'smile').frame, out);
        expect(out.thermals).toBe(thermals);
        expect(out.thermals).toHaveLength(4);
    });

    it('is a pure function of the frame', () => {
        for (const { name, frame, placed } of CASES) {
            expect(placePlan(frame, {}), name).toEqual(placed);
        }
    });
});
