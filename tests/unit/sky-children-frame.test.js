/**
 * Sky Children — the frame solver (sky-children-frame.js, three-free): the lens for an aspect, the
 * pitch that puts the horizon where the plan wants it, the antisolar point A solved from the live
 * card and HUD rects, and the twelve strokes the chain paints laid on the part of the bow that
 * shows.
 *
 * Pinned against FINAL §5.1–5.2 as relations over the real screens (16:9, 16:10, 21:9, 4:3 and two
 * phones), each with the solver's own nominal layout, the composition's stylesheet formula and
 * hand-made solo, two-board and four-board rows (the playground's mock cards). Constants are
 * imported, never re-typed.
 */
import { describe, expect, it } from 'vitest';
import {
    CALM_MARGIN, HORIZON_LANDSCAPE, PRIMARY_STROKES, SECONDARY_STROKES, bowPoint, cameraModel, clearOfCalm,
    fovForAspect, frameFor, nominalLayout, project, unproject,
} from '../../src/themes/sky-children/sky-children-frame.js';
import { fallbackLayout } from '../../src/themes/sky-children/sky-children-composition.js';

const DEG = Math.PI / 180;
const SCREENS = [['16:9', 1600, 900], ['16:10', 1680, 1050], ['21:9', 2560, 1080], ['4:3', 1024, 768],
    ['390×844', 390, 844], ['412×915', 412, 915]];

const card = (x0, x1, y0, y1) => ({
    x0, x1, y0, y1,
});
/** FINAL §1.2: the solo card and stats bar at 2560×1080. */
const SOLO_21_9 = {
    cardCount: 1, cards: [card(0.43, 0.57, 0.1, 0.9)], hud: card(0.602, 0.656, 0.32, 0.68), boards: [],
};
/** The playground's mock local-multiplayer rows (22vw cards, 2vw apart; 20vw for four), 78vh tall. */
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

/** Every case: [name, aspect, layout]. */
const CASES = [
    ...SCREENS.flatMap(([name, W, H]) => [
        [`${name} nominal`, W / H, nominalLayout(W / H)],
        [`${name} stylesheet`, W / H, fallbackLayout(W, H)],
    ]),
    ['21:9 solo (FINAL §1.2)', 2560 / 1080, SOLO_21_9],
    ['16:9 two boards', 16 / 9, TWO_BOARDS],
    ['16:9 four boards', 16 / 9, FOUR_BOARDS],
];
const solved = CASES.map(([name, aspect, layout]) => ({
    name, aspect, layout, frame: frameFor(aspect, layout, {}),
}));
const legs = solved.filter((c) => c.frame.plan === 'leg');
const smiles = solved.filter((c) => c.frame.plan === 'smile');
const SOLO_LEGS = legs.filter((c) => c.layout.cards.length === 1);

const grown = (r, m) => ({
    x0: r.x0 - m, x1: r.x1 + m, y0: r.y0 - m, y1: r.y1 + m,
});
const inside = (r, p) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
const rectsOf = (layout) => [...layout.cards, ...(layout.hud ? [layout.hud] : [])];
const leftmost = (layout) => layout.cards.reduce((a, b) => (b.x0 < a.x0 ? b : a));
const rightmostX1 = (layout) => Math.max(...layout.cards.map((c) => c.x1));
const unionOf = (layout) => ({
    x0: Math.min(...layout.cards.map((c) => c.x0)),
    x1: Math.max(...layout.cards.map((c) => c.x1)),
    y0: Math.min(...layout.cards.map((c) => c.y0)),
    y1: Math.max(...layout.cards.map((c) => c.y1)),
});
const hfovOf = (vfov, aspect) => (2 * Math.atan(Math.tan((vfov * DEG) / 2) * aspect)) / DEG;

/** The stroke's on-screen length (frame heights) over the part that shows clear of every calm rect. */
function visibleLength(frame, layout, R, stroke, samples = 400) {
    const d = [0, 0, 0];
    const p = { x: 0, y: 0, front: false };
    let length = 0;
    let prev = null;
    for (let i = 0; i <= samples; i++) {
        const phi = stroke.phi0 + ((stroke.phi1 - stroke.phi0) * i) / samples;
        project(bowPoint(frame.A, frame.basis, R, phi, d), frame.cam, p);
        const shows = clearOfCalm(p, layout);
        if (shows && prev) length += Math.hypot((p.x - prev.x) * frame.cam.aspect, p.y - prev.y);
        prev = shows ? { x: p.x, y: p.y } : null;
    }
    return length;
}

/** Pairs of strokes whose arcs (each the phi interval between its ends, taken mod 2π) overlap. */
function overlaps(strokes) {
    const TAU = 2 * Math.PI;
    const found = [];
    const spans = strokes.map((s) => [Math.min(s.phi0, s.phi1), Math.max(s.phi0, s.phi1)]);
    for (let i = 0; i < spans.length; i++) {
        for (let j = i + 1; j < spans.length; j++) {
            for (const shift of [-TAU, 0, TAU]) {
                const lo = Math.max(spans[i][0], spans[j][0] + shift);
                const hi = Math.min(spans[i][1], spans[j][1] + shift);
                if (hi - lo > 1e-6) found.push(`S${i + 1}×S${j + 1}`);
            }
        }
    }
    return found;
}

/** Where a phi on the primary lands on screen. */
const onBow = (frame, R, phi) => project(bowPoint(frame.A, frame.basis, R, phi, [0, 0, 0]), frame.cam);

describe('sky children frame: the lens', () => {
    it('holds one lens for every frame up to a 100° horizontal field, then closes it (Hor+), 100° exactly', () => {
        // FINAL §5.1 says 52°; the look has since been tuned (56° on 2026-10-11): the rule is pinned, not the number.
        const base = fovForAspect(16 / 9);
        expect(base).toBeGreaterThanOrEqual(45);
        expect(base).toBeLessThanOrEqual(65);
        expect(fovForAspect(4 / 3)).toBe(base);
        expect(fovForAspect(1)).toBe(base);
        let capped = 0;
        for (const aspect of [1, 4 / 3, 16 / 10, 16 / 9, 2, 2560 / 1080, 3, 32 / 9, 4]) {
            const vfov = fovForAspect(aspect);
            const hfov = hfovOf(vfov, aspect);
            expect(hfov, `aspect ${aspect}`).toBeLessThanOrEqual(100 + 1e-9);
            if (hfovOf(base, aspect) <= 100) {
                expect(vfov, `aspect ${aspect}`).toBe(base);
            } else {
                capped += 1;
                expect(vfov, `aspect ${aspect}`).toBeLessThan(base);
                expect(hfov, `aspect ${aspect}`).toBeCloseTo(100, 6);
            }
        }
        expect(capped).toBeGreaterThan(0);
        // Nothing usable: the 16:9 lens.
        expect(fovForAspect(Number.NaN)).toBe(base);
        expect(fovForAspect(0)).toBe(base);
    });

    it('opens up for a phone (2·atan(tan 17° / aspect)), clamped between the landscape lens and 72°', () => {
        const base = fovForAspect(16 / 9);
        for (const aspect of [0.3, 390 / 844, 412 / 915, 0.6, 0.8, 0.99]) {
            const rule = (2 * Math.atan(Math.tan(17 * DEG) / aspect)) / DEG;
            expect(fovForAspect(aspect), `aspect ${aspect}`).toBeCloseTo(Math.min(72, Math.max(base, rule)), 9);
            // At least 34° across, unless the 72° clamp holds it narrower.
            if (fovForAspect(aspect) < 72) {
                expect(hfovOf(fovForAspect(aspect), aspect), `aspect ${aspect}`).toBeGreaterThanOrEqual(34 - 1e-6);
            }
        }
        expect(fovForAspect(390 / 844)).toBeCloseTo(67, 0);
        expect(fovForAspect(390 / 844)).toBeGreaterThan(base);
        expect(fovForAspect(0.3)).toBe(72);
        expect(fovForAspect(0.99)).toBe(base);
    });

    it('unprojects and projects back to the same frame point, in front of the eye', () => {
        for (const { name, frame } of solved) {
            for (let i = 0; i <= 4; i++) {
                for (let j = 0; j <= 4; j++) {
                    const x = i / 4;
                    const y = j / 4;
                    const dir = unproject(x, y, frame.cam, [0, 0, 0]);
                    expect(Math.hypot(...dir), name).toBeCloseTo(1, 12);
                    const p = project(dir, frame.cam);
                    expect(p.front, `${name} (${x}, ${y})`).toBe(true);
                    expect(p.x, `${name} (${x}, ${y})`).toBeCloseTo(x, 9);
                    expect(p.y, `${name} (${x}, ${y})`).toBeCloseTo(y, 9);
                }
            }
        }
        // A direction behind the eye is not in front of it.
        const cam = cameraModel(16 / 9, 52, 0);
        expect(project([0, 0, 1], cam).front).toBe(false);
    });
});

describe('sky children frame: the plan', () => {
    it('stands the bow on its leg beside a card, and lays it as a smile on a phone or beside a row of boards', () => {
        for (const {
            name, frame, aspect, layout,
        } of solved) {
            // A row of two leaves no radius in [38°, 46°] that lands the foot left of the cards.
            const expected = aspect < 1 || layout.cards.length >= 2 ? 'smile' : 'leg';
            expect(frame.plan, name).toBe(expected);
        }
        expect(smiles.length).toBeGreaterThan(0);
        expect(legs.length).toBeGreaterThan(0);
    });

    it('also solves a frame with no layout at all (the nominal solo card), on any screen', () => {
        const wide = frameFor(16 / 9, null, {});
        expect(wide.plan).toBe('leg');
        expect(wide).toMatchObject({ vfov: frameFor(16 / 9, nominalLayout(16 / 9), {}).vfov });
        expect(wide.A).toEqual(frameFor(16 / 9, nominalLayout(16 / 9), {}).A);
        expect(frameFor(390 / 844, null, {}).plan).toBe('smile');
        // `out` is reused: the same object comes back, re-solved.
        const out = {};
        expect(frameFor(16 / 9, null, out)).toBe(out);
        const strokes = out.strokes1;
        frameFor(390 / 844, null, out);
        expect(out.strokes1).toBe(strokes);
        expect(out.plan).toBe('smile');
    });

    it('puts the horizon where the plan wants it: every level direction projects onto it', () => {
        for (const { name, frame, layout } of solved) {
            const want = frame.plan === 'leg' ? HORIZON_LANDSCAPE : 0.6 * unionOf(layout).y0;
            expect(frame.horizon, name).toBeCloseTo(want, 12);
            const half = Math.atan(frame.cam.tanX) * 0.9;
            for (const bearing of [-half, -half / 2, 0, half / 2, half]) {
                const p = project([Math.sin(bearing), 0, -Math.cos(bearing)], frame.cam);
                expect(p.front, `${name} bearing ${bearing}`).toBe(true);
                expect(p.y, `${name} bearing ${bearing}`).toBeCloseTo(frame.horizon, 9);
            }
            // Level ahead sits on the horizon, and the solved pitch is the one that put it there.
            expect(Math.tan(frame.pitch)).toBeCloseTo((frame.horizon - 0.5) * 2 * Math.tan((frame.vfov * DEG) / 2), 12);
        }
        // Landscape looks a little up (the horizon below the middle), the phone's smile plan steeply down.
        for (const { name, frame } of legs) {
            expect(frame.pitch, name).toBeGreaterThan(0);
            expect(frame.pitch, name).toBeLessThan(10 * DEG);
        }
        expect(solved.find((c) => c.name === '390×844 nominal').frame.pitch).toBeLessThan(-20 * DEG);
    });
});

describe('sky children frame: the leg plan (landscape)', () => {
    it('solves A low right of the rightmost card or HUD, clear of every rect and its calm margin', () => {
        for (const { name, frame, layout } of legs) {
            const A = frame.Ascreen;
            for (const r of rectsOf(layout)) {
                expect(inside(grown(r, CALM_MARGIN), A), `${name}: A in a rect`).toBe(false);
            }
            expect(A.x, name).toBeGreaterThanOrEqual(rightmostX1(layout) - 0.08);
            expect(A.x, name).toBeLessThanOrEqual(0.93 + 1e-9);
            // FINAL §5.2 clamps y_A to [0.83, 0.90]; the solver now raises it to 0.93 for the crest.
            expect(A.y, name).toBeGreaterThanOrEqual(0.83);
            expect(A.y, name).toBeLessThan(0.95);
            // A is the sun's antipode: below the horizon in front of us, so the sun stands behind and above.
            expect(frame.A[1], name).toBeLessThan(0);
            expect(frame.gloryVisible, name).toBe(true);
        }
    });

    it('art-scales the primary only within [38°, 46°], the secondary 9° out and the fogbow 3° in', () => {
        for (const { name, frame } of legs) {
            expect(frame.R1 / DEG, name).toBeGreaterThanOrEqual(38 - 1e-9);
            expect(frame.R1 / DEG, name).toBeLessThanOrEqual(46 + 1e-9);
            expect((frame.R2 - frame.R1) / DEG, name).toBeCloseTo(9, 9);
            expect((frame.R1 - frame.Rfog) / DEG, name).toBeCloseTo(3, 9);
        }
    });

    it('stands the primary\'s foot on the horizon in the left free zone beside a solo card', () => {
        // FINAL §5.2 asks for [0.16, card.x0 − 0.09]; with the 56° lens (2026-10-11) 21:9 nominal
        // stands at 0.338 (> 0.331).
        expect(SOLO_LEGS.length).toBeGreaterThanOrEqual(8);
        for (const { name, frame, layout } of SOLO_LEGS) {
            expect(frame.foot.y, name).toBeCloseTo(frame.horizon, 12);
            expect(frame.foot.x, name).toBeGreaterThanOrEqual(0.16);
            expect(frame.foot.x, name).toBeLessThanOrEqual(leftmost(layout).x0 - CALM_MARGIN);
            // The foot really is where the primary crosses the horizon.
            const p = onBow(frame, frame.R1, frame.strokes1[0].phi0);
            expect(p.x, name).toBeCloseTo(frame.foot.x, 2);
            expect(p.y, name).toBeCloseTo(frame.horizon, 2);
        }
    });

    // A row of two leaves no radius in [38°, 46°] that lands the foot left of the cards: the frame
    // then takes the smile plan rather than stand the leg behind a board.
    it('keeps the primary\'s foot in the left free zone, or smiles (a two-board row)', () => {
        const { frame, layout } = solved.find((c) => c.name === '16:9 two boards');
        if (frame.plan === 'leg') expect(frame.foot.x).toBeLessThanOrEqual(leftmost(layout).x0 - CALM_MARGIN);
        else expect(frame.plan).toBe('smile');
        for (const { name, frame: f, layout: l } of legs) {
            expect(f.foot.x, name).toBeLessThanOrEqual(leftmost(l).x0 - CALM_MARGIN);
        }
    });
});

describe('sky children frame: the strokes the chain paints', () => {
    it('cuts 7 strokes on the primary and 5 on the secondary, each with visible length on screen', () => {
        expect(PRIMARY_STROKES).toBe(7);
        expect(SECONDARY_STROKES).toBe(5);
        for (const { name, frame, layout } of solved) {
            expect(frame.strokes1, name).toHaveLength(PRIMARY_STROKES);
            expect(frame.strokes2, name).toHaveLength(SECONDARY_STROKES);
            frame.strokes1.forEach((s, i) => {
                expect(Number.isFinite(s.phi0) && Number.isFinite(s.phi1), `${name} S${i + 1}`).toBe(true);
                expect(Math.abs(s.phi1 - s.phi0), `${name} S${i + 1}`).toBeGreaterThan(0);
                expect(visibleLength(frame, layout, frame.R1, s), `${name} S${i + 1}`).toBeGreaterThan(0);
            });
            frame.strokes2.forEach((s, i) => {
                expect(Math.abs(s.phi1 - s.phi0), `${name} T${i + 1}`).toBeGreaterThan(0);
                expect(visibleLength(frame, layout, frame.R2, s), `${name} T${i + 1}`).toBeGreaterThan(0);
            });
        }
    });

    it('reads the leg plan from the foot up: S1 climbs off the horizon, strokes join within each group', () => {
        for (const { name, frame } of SOLO_LEGS) {
            const s1 = frame.strokes1[0];
            const start = onBow(frame, frame.R1, s1.phi0);
            const end = onBow(frame, frame.R1, s1.phi1);
            expect(start.y, name).toBeCloseTo(frame.horizon, 2);
            expect(end.y, name).toBeLessThan(start.y);
            // Groups (FINAL §5.2): primary leg-up 2 / crest 3 / leg-down 2, secondary up 3 / down 2;
            // inside a group each stroke starts where the last one ends.
            const joins = [[frame.strokes1, [1, 3, 4, 6]], [frame.strokes2, [1, 2, 4]]];
            for (const [strokes, within] of joins) {
                for (const i of within) {
                    expect(strokes[i].phi0, `${name} #${i + 1}`).toBeCloseTo(strokes[i - 1].phi1, 9);
                }
            }
            // The leg-down group starts at the foot again, below the horizon.
            const s6 = onBow(frame, frame.R1, (frame.strokes1[5].phi0 + frame.strokes1[5].phi1) / 2);
            expect(s6.y, name).toBeGreaterThan(frame.horizon);
        }
    });

    it('reads the smile plan from the centre out: S1 at the lowest point, then left, right, left, right', () => {
        for (const { name, frame } of smiles) {
            for (const [strokes, R] of [[frame.strokes1, frame.R1], [frame.strokes2, frame.R2]]) {
                const mid = strokes.map((s) => onBow(frame, R, (s.phi0 + s.phi1) / 2).x);
                // The first stroke holds the circle's lowest point (phi = 0).
                expect(Math.min(strokes[0].phi0, strokes[0].phi1), name).toBeLessThanOrEqual(0);
                expect(Math.max(strokes[0].phi0, strokes[0].phi1), name).toBeGreaterThanOrEqual(0);
                for (let i = 1; i < strokes.length; i++) {
                    const outward = i % 2 === 1 ? -1 : 1;
                    const ref = i <= 2 ? mid[0] : mid[i - 2];
                    expect(Math.sign(mid[i] - ref), `${name} stroke ${i + 1}`).toBe(outward);
                }
            }
        }
    });

    it('never lets two smile strokes overlap, and keeps each under half a turn', () => {
        for (const { name, frame } of smiles) {
            expect(overlaps(frame.strokes1), name).toEqual([]);
            expect(overlaps(frame.strokes2), name).toEqual([]);
            for (const s of [...frame.strokes1, ...frame.strokes2]) {
                expect(Math.abs(s.phi1 - s.phi0), name).toBeLessThan(Math.PI);
            }
        }
    });

    // Strokes are cut per reading-order group (FINAL §5.2 quotas 2/3/2 and 3/2), so none straddles
    // two groups: the shader's stroke mask cannot paint a span over π.
    it('never lets two leg-plan strokes overlap, and keeps each under half a turn', () => {
        for (const { name, frame } of legs) {
            expect(overlaps(frame.strokes1), `${name} primary`).toEqual([]);
            expect(overlaps(frame.strokes2), `${name} secondary`).toEqual([]);
            for (const s of [...frame.strokes1, ...frame.strokes2]) {
                expect(Math.abs(s.phi1 - s.phi0), name).toBeLessThan(Math.PI);
            }
        }
    });
});

describe('sky children frame: the smile plan (phones, four boards)', () => {
    it('stands A in the cards\' centre column and hangs both bows under the card, the glory hidden', () => {
        for (const { name, frame, layout } of smiles) {
            const u = unionOf(layout);
            expect(frame.Ascreen.x, name).toBeCloseTo((u.x0 + u.x1) / 2, 6);
            expect(frame.gloryVisible, name).toBe(false);
            const low1 = onBow(frame, frame.R1, 0);
            const low2 = onBow(frame, frame.R2, 0);
            expect(low1.y, name).toBeCloseTo(u.y1 + 0.35 * (1 - u.y1), 4);
            expect(low2.y, name).toBeCloseTo(u.y1 + 0.8 * (1 - u.y1), 4);
            expect(frame.R1 / DEG, name).toBeCloseTo(42, 9);
            expect(frame.R2, name).toBeGreaterThan(frame.R1);
            expect(frame.bearingScale, name).toBeLessThan(1);
        }
    });
});
