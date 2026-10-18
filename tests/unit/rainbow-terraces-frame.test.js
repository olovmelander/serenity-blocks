/**
 * Rainbow Terraces — the frame solver (rainbow-terraces-frame.js, three-free): the lens for an aspect, the
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
    CALM_MARGIN, GATE_ROOM, HORIZON_LANDSCAPE, PRIMARY_STROKES, SECONDARY_STROKES, SMILE, bowPoint, cameraModel,
    clearOfCalm, fovForAspect, frameFor, nominalLayout, project, recutStrokes, unproject,
} from '../../src/themes/rainbow-terraces/rainbow-terraces-frame.js';
import { fallbackLayout } from '../../src/themes/rainbow-terraces/rainbow-terraces-composition.js';

const DEG = Math.PI / 180;
const SCREENS = [['16:9', 1600, 900], ['16:10', 1680, 1050], ['21:9', 2560, 1080], ['4:3', 1024, 768],
    ['390×844', 390, 844], ['412×915', 412, 915], ['960×540', 960, 540]];

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
    ['16:10 two boards', 16 / 10, TWO_BOARDS],
    ['3:2 two boards', 3 / 2, TWO_BOARDS],
    ['4:3 two boards', 4 / 3, TWO_BOARDS],
    ['16:9 four boards', 16 / 9, FOUR_BOARDS],
    ['2100×900 stylesheet', 2100 / 900, fallbackLayout(2100, 900)],
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

describe('rainbow terraces frame: the lens', () => {
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

describe('rainbow terraces frame: the plan', () => {
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

describe('rainbow terraces frame: the leg plan (landscape)', () => {
    it('solves A low right of the rightmost card or HUD, clear of every rect and its calm margin', () => {
        for (const { name, frame, layout } of legs) {
            const A = frame.Ascreen;
            for (const r of rectsOf(layout)) {
                expect(inside(grown(r, CALM_MARGIN), A), `${name}: A in a rect`).toBe(false);
                // A four-line clear's glory (5.6°) opens clear of every card and the HUD.
                const dx = Math.max(r.x0 - A.x, 0, A.x - r.x1) * frame.aspect;
                const dy = Math.max(r.y0 - A.y, 0, A.y - r.y1);
                expect(Math.hypot(dx, dy), `${name}: the glory on a rect`).toBeGreaterThan(5.6 / frame.vfov + CALM_MARGIN - 0.004);
            }
            expect(A.x, name).toBeGreaterThanOrEqual(rightmostX1(layout) - 0.08);
            expect(A.x, name).toBeLessThanOrEqual(0.93 + 1e-9);
            // FINAL §5.2 clamps y_A to [0.83, 0.90]; the solver may lower it to 0.94 for the crest.
            expect(A.y, name).toBeGreaterThanOrEqual(0.83);
            expect(A.y, name).toBeLessThan(0.95);
            // A is the sun's antipode: below the horizon in front of us, so the sun stands behind and above.
            expect(frame.A[1], name).toBeLessThan(0);
            expect(frame.gloryVisible, name).toBe(true);
        }
    });

    // The crest is a curve the frame shows, never a banner parked along its top edge: right of the
    // cards it stands clearly inside the frame (its top at least 0.1 down), and along the band
    // within 0.08 of the top edge it runs for less than 0.15 of the frame's width.
    it('arches the crest clearly inside the frame, never along its top edge, with room for the glory', () => {
        for (const { name, frame, layout } of SOLO_LEGS) {
            const right = rightmostX1(layout) + CALM_MARGIN;
            let top = Infinity;
            let banner = 0;
            let prev = null;
            for (let deg = 90; deg <= 270; deg += 0.5) {
                const p = onBow(frame, frame.R1, deg * DEG);
                const shows = p.front && p.x > right && p.x <= 1 && p.y < 0.7;
                if (shows) {
                    top = Math.min(top, p.y);
                    if (prev && p.y >= 0 && p.y < 0.08) banner += Math.abs(p.x - prev.x);
                }
                prev = shows ? p : null;
            }
            expect(top, name).toBeGreaterThanOrEqual(0.1 - 1e-6);
            expect(banner, name).toBeLessThan(0.15);
            // The glory's room: A well under the HUD, a four-line clear's rings (5.6°) inside the frame.
            if (layout.hud) expect(frame.Ascreen.y, name).toBeGreaterThan(layout.hud.y1 + CALM_MARGIN + 0.05);
            expect(frame.Ascreen.y + 5.6 / frame.vfov, name).toBeLessThan(1.0);
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

    // A window dragged a pixel at a time, or a HUD whose fonts settle a pixel later, moves the
    // frame a little: never a jump of A or the radius (and so of the isles and the falls).
    it('moves A and the radius only a little when the window changes by a pixel', () => {
        let prev = null;
        for (let H = 860; H <= 940; H += 1) {
            const f = frameFor(1600 / H, fallbackLayout(1600, H), {});
            const cur = { x: f.Ascreen.x, y: f.Ascreen.y, R: f.R1 };
            if (prev) {
                expect(Math.hypot(cur.x - prev.x, cur.y - prev.y), `H ${H}`).toBeLessThan(0.006);
                expect(Math.abs(cur.R - prev.R) / DEG, `H ${H}`).toBeLessThan(0.25);
            }
            prev = cur;
        }
    });

    // The layout is read again a moment after every resize and game start: the same screen and
    // rects keep the solve already made, and a fresh solve stays a few milliseconds of one frame.
    it('solves a frame in a few milliseconds, and keeps the solve for the same screen and rects', () => {
        const layout = fallbackLayout(2560, 1080);
        frameFor(2560 / 1080, layout, {});
        const times = [];
        for (let i = 0; i < 7; i++) {
            const t = performance.now();
            frameFor(2560 / 1080, layout, {});
            times.push(performance.now() - t);
        }
        times.sort((p, q) => p - q);
        // Generous for a loaded test machine (a solve takes 2–5 ms there); the search it replaced took 40–90.
        expect(times[3]).toBeLessThan(25);
        const out = frameFor(16 / 9, fallbackLayout(1600, 900), {});
        const strokes = out.strokes1.map((s) => ({ ...s }));
        out.strokes1[0].phi0 += 1;
        expect(frameFor(16 / 9, { ...fallbackLayout(1600, 900) }, out)).toBe(out);
        expect(out.strokes1[0].phi0).toBe(strokes[0].phi0 + 1);
        frameFor(16 / 9, fallbackLayout(1600, 901), out);
        expect(out.strokes1[0].phi0).not.toBe(strokes[0].phi0 + 1);
    });

    // The Far Gate stands where the primary keeps clear of it: never nested on its arch, the bow
    // well above its crown wherever it passes over it (the plan stands it at frame.gate).
    it('keeps a place for the Far Gate clear of the primary, beyond the HUD', () => {
        for (const { name, frame, layout } of SOLO_LEGS) {
            const right = Math.max(rightmostX1(layout), layout.hud ? layout.hud.x1 : 0);
            const { x, head } = frame.gate;
            expect(head, name).toBe(GATE_ROOM.head);
            const ahead = unproject(x, frame.horizon, frame.cam, [0, 0, -1]);
            const b = Math.atan2(ahead[0], -ahead[2]);
            const at = (bb) => project([Math.sin(bb), 0, -Math.cos(bb)], frame.cam).x;
            const x0 = at(b - GATE_ROOM.half * DEG);
            const x1 = at(b + GATE_ROOM.half * DEG);
            if (x0 < right + 0.02) continue; // a HUD that leaves the gate no room: the plan's own place
            let prev = null;
            for (let deg = 0; deg <= 360; deg += 0.5) {
                const p = onBow(frame, frame.R1, deg * DEG);
                if (!p.front || p.x < right || p.x > 1.05 || p.y < -0.05 || p.y > frame.horizon + 0.05) {
                    prev = null;
                    continue;
                }
                // Clear of its outline…
                const dx = Math.max(x0 - p.x, 0, p.x - x1) * frame.aspect;
                const dy = Math.max(head - p.y, 0, p.y - frame.horizon);
                expect(Math.hypot(dx, dy), `${name} beside the gate`).toBeGreaterThan(GATE_ROOM.clear - 2e-3);
                // …and well above its crown where it passes over the gate's middle.
                if (prev && (prev.x - x) * (p.x - x) <= 0 && p.y < head) {
                    expect(p.y, `${name} over the crown`).toBeLessThanOrEqual(head - GATE_ROOM.crown + 2e-3);
                }
                prev = p;
            }
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

describe('rainbow terraces frame: the strokes the chain paints', () => {
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

    // Each end of a stroke knows what it meets, so the shader can ramp it: a neighbour's end (found
    // by where the ends stand round A, start-to-start at the foot included), else a card or the
    // HUD, the frame's edge, or open sky.
    it('marks every stroke end: joined where two touch (the foot too), else hidden by a card or the frame', () => {
        for (const { name, frame, layout } of solved) {
            for (const [strokes, R] of [[frame.strokes1, frame.R1], [frame.strokes2, frame.R2]]) {
                strokes.forEach((s, k) => {
                    [0, 1].forEach((e) => {
                        const j = s.joins[e];
                        const at = e ? s.phi1 : s.phi0;
                        if (j) {
                            // A join is mutual and the two ends really meet.
                            const o = strokes[j.k];
                            expect(o.joins[j.end], `${name} S${k + 1}/${e}`).toEqual({ k, end: e });
                            const there = j.end ? o.phi1 : o.phi0;
                            const gap = at - there;
                            expect(Math.abs(gap - 2 * Math.PI * Math.round(gap / (2 * Math.PI))), name).toBeLessThan(DEG);
                            expect(s.hides[e], name).toBe(0);
                        } else if (s.hides[e]) {
                            // Just past a hidden end the bow is not on show.
                            const sense = Math.sign(s.phi1 - s.phi0);
                            const p = onBow(frame, R, at + (e ? sense : -sense) * 1.5 * DEG);
                            expect(clearOfCalm(p, layout, CALM_MARGIN, 0), `${name} S${k + 1}/${e}`).toBe(false);
                        }
                    });
                });
            }
        }
        for (const { name, frame } of SOLO_LEGS) {
            const [s1, s2, s3, s4, s5, s6, s7] = frame.strokes1;
            // The foot: the leg climbing and the leg plunging start from the same point.
            expect(s1.joins[0], name).toEqual({ k: 5, end: 0 });
            expect(s6.joins[0], name).toEqual({ k: 0, end: 0 });
            // Inside a group, end to start.
            expect(s1.joins[1], name).toEqual({ k: 1, end: 0 });
            expect(s4.joins[0], name).toEqual({ k: 2, end: 1 });
            expect(s7.joins[0], name).toEqual({ k: 5, end: 1 });
            // The leg goes behind the card and the crest comes out from behind it: the leg's last
            // stroke paints on under the card into the crest's first, so the bow is whole there;
            // the crest and the plunging leg leave the frame.
            expect(s2.joins[1], name).toEqual({ k: 2, end: 0 });
            expect(s3.joins[0], name).toEqual({ k: 1, end: 1 });
            expect(s5.hides[1], name).toBe(2);
            expect(s7.hides[1], name).toBe(2);
        }
    });

    // The cards and the HUD are translucent: a bow cut where they stand shows through them as a
    // gap. Every link still paints the part the player sees (the quotas are cut on it), and every
    // end under a card or the HUD runs on to the next stroke or out of the frame.
    it('keeps the bow whole behind the cards and the HUD: no stroke ends under them', () => {
        for (const { name, frame, layout } of solved) {
            for (const [strokes, R, tag] of [[frame.strokes1, frame.R1, 'S'], [frame.strokes2, frame.R2, 'T']]) {
                strokes.forEach((s, k) => {
                    expect(visibleLength(frame, layout, R, s), `${name} ${tag}${k + 1}`).toBeGreaterThan(0);
                    [0, 1].forEach((e) => {
                        if (s.joins[e]) return;
                        expect(s.hides[e], `${name} ${tag}${k + 1}/${e}`).not.toBe(1);
                    });
                });
            }
        }
    });

    // What else stands in front of the bow (the set pieces, handed in as outlines) takes no quota:
    // the strokes are cut again on what shows, A and the radii untouched, and an end that meets
    // a set piece runs on under it as under a card.
    it('cuts the strokes again round a set piece\'s outline, leaving A and the radii', () => {
        const layout = fallbackLayout(1600, 900);
        const frame = frameFor(16 / 9, layout, {});
        const A = frame.A.slice();
        const R = [frame.R1, frame.R2];
        // A block over the secondary's climb from the horizon (where the Spring Isle stands).
        const t = frame.strokes2[0];
        const at = onBow(frame, frame.R2, t.phi0 + 0.6 * (t.phi1 - t.phi0));
        const block = [[at.x - 0.08, at.y - 0.12], [at.x + 0.08, at.y - 0.12], [at.x + 0.08, 1.2], [at.x - 0.08, 1.2]];
        recutStrokes(frame, layout, [block]);
        expect(frame.A).toEqual(A);
        expect([frame.R1, frame.R2]).toEqual(R);
        const hidden = { ...layout, hides: [block] };
        expect(clearOfCalm(at, hidden)).toBe(false);
        frame.strokes2.forEach((s, i) => {
            expect(visibleLength(frame, hidden, frame.R2, s), `T${i + 1}`).toBeGreaterThan(0.05);
            [0, 1].forEach((e) => {
                if (s.joins[e]) return;
                const sense = Math.sign(s.phi1 - s.phi0);
                const p = onBow(frame, frame.R2, (e ? s.phi1 : s.phi0) + (e ? sense : -sense) * 1.5 * DEG);
                if (!clearOfCalm(p, hidden, CALM_MARGIN, 0)) expect(s.hides[e], `T${i + 1}/${e}`).toBeGreaterThan(0);
            });
        });
        expect(overlaps(frame.strokes2)).toEqual([]);
        // Without the outline the cut is the frame's own again.
        recutStrokes(frame, layout, []);
        expect(frame.strokes2[0].phi0).toBeCloseTo(t.phi0, 12);
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

describe('rainbow terraces frame: the smile plan (phones, four boards)', () => {
    it('stands A in the cards\' centre column and hangs both bows under the card, the glory hidden', () => {
        for (const { name, frame, layout } of smiles) {
            const u = unionOf(layout);
            expect(frame.Ascreen.x, name).toBeCloseTo((u.x0 + u.x1) / 2, 6);
            expect(frame.gloryVisible, name).toBe(false);
            const low1 = onBow(frame, frame.R1, 0);
            const low2 = onBow(frame, frame.R2, 0);
            expect(low1.y, name).toBeCloseTo(u.y1 + SMILE.low * (1 - u.y1), 4);
            // A phone's smile is art-directed smaller, so it curves across the narrow frame.
            expect(frame.R1 / DEG, name).toBeCloseTo(frame.aspect < 1 ? SMILE.R1 : 42, 9);
            // The secondary far enough out for Alexander's band to read (5° on a phone), and still
            // in the frame.
            expect((frame.R2 - frame.R1) / DEG, name).toBeGreaterThanOrEqual((frame.aspect < 1 ? 5 : SMILE.minGap) - 1e-6);
            expect((frame.R2 - frame.R1) / DEG, name).toBeLessThanOrEqual(SMILE.gap + 1e-6);
            expect(low2.y, name).toBeLessThanOrEqual(SMILE.floor + 1e-6);
            expect(low2.y, name).toBeGreaterThan(low1.y);
            expect(frame.bearingScale, name).toBeLessThan(1);
        }
    });
});
