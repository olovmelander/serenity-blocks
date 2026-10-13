import { describe, expect, it } from 'vitest';
import {
    BOARD_GRID, BOARD_SELECTOR, HUD_SELECTOR, PLAYER_SLOTS, REST_RIG, SOLO_CANVAS_SELECTORS,
    aimLanding, aimLeave, boardFor, boardPoint, cardFor, cardUnion, fallbackLayout, fovForAspect, frameFor,
    layoutsDiffer, playerCanvasSelector, readLayoutRects,
} from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-composition.js';

const rect = (left, top, width, height) => ({
    left, top, right: left + width, bottom: top + height, width, height,
});
const el = (r) => ({ getBoundingClientRect: () => r });
const visible = { display: 'block', visibility: 'visible', opacity: '1' };

describe('moonlit greenhouse composition: the board before it is on screen', () => {
    it('lays the solo board out from the stylesheet\'s formulas before a card exists', () => {
        const layout = fallbackLayout(1600, 900);
        expect(layout.cardCount).toBe(0);
        const card = layout.cards[0];
        const board = layout.boards[0];
        expect((card.x0 + card.x1) / 2).toBeCloseTo(0.5, 6);
        expect(board.x0).toBeGreaterThan(card.x0);
        expect(board.x1).toBeLessThan(card.x1);
        expect(board.y1).toBeLessThan(card.y1);
        // The playfield is two cells tall for each cell wide.
        expect(((board.y1 - board.y0) * 900) / ((board.x1 - board.x0) * 1600)).toBeCloseTo(2, 6);
        expect(layout.hud.x0).toBeGreaterThan(card.x1);
        expect(cardUnion(layout)).toEqual(card);
        expect(boardFor(layout, 0)).toBe(board);
        expect(boardFor(layout, 3)).toBe(board); // a missing board falls back to the first on screen
        expect(boardFor(null)).toBeNull();
    });

    it('lays out the solo board from the stylesheet\'s formulas, for any frame', () => {
        for (const [width, height] of [[1600, 900], [1920, 1080], [2560, 1080], [1024, 768], [430, 932]]) {
            const layout = fallbackLayout(width, height);
            const card = layout.cards[0];
            const board = layout.boards[0];
            expect(layout.cardCount).toBe(0); // nothing was read from the page
            expect(layout.cards).toHaveLength(1);
            expect(layout.boards).toHaveLength(PLAYER_SLOTS);
            expect(layout.boards.slice(1).every((b) => b === null)).toBe(true);
            expect((card.x0 + card.x1) / 2).toBeCloseTo(0.5, 9);
            expect((board.x0 + board.x1) / 2).toBeCloseTo(0.5, 9);
            expect(board.x0).toBeGreaterThan(card.x0);
            expect(board.x1).toBeLessThan(card.x1);
            expect(board.y0).toBeGreaterThan(card.y0);
            expect(board.y1).toBeLessThan(card.y1);
            // Ten columns by twenty rows of square cells.
            const cell = ((board.x1 - board.x0) * width) / BOARD_GRID.columns;
            expect(((board.y1 - board.y0) * height) / BOARD_GRID.rows).toBeCloseTo(cell, 6);
            // The playfield sits nearer the card's foot than its head.
            expect(card.y1 - board.y1).toBeLessThan(board.y0 - card.y0);
        }
        // Nonsense is a one-pixel window, not a division by zero.
        const tiny = fallbackLayout(0, NaN);
        expect(Object.values(tiny.cards[0]).every((v) => Number.isFinite(v))).toBe(true);
    });
});

describe('moonlit greenhouse composition: board columns and rows on screen', () => {
    it('maps a column and a row onto the screen through the board rect', () => {
        const board = {
            x0: 0.4, y0: 0.2, x1: 0.6, y1: 0.9,
        };
        expect(boardPoint(board, 0, 0)).toEqual({ x: 0.4, y: 0.2 + 0.7 * (0.5 / BOARD_GRID.rows) });
        const foot = boardPoint(board, 1, 19);
        expect(foot.x).toBeCloseTo(0.6, 9);
        expect(foot.y).toBeCloseTo(0.9 - 0.7 * (0.5 / BOARD_GRID.rows), 9);
        // Out-of-range input is clamped onto the board.
        expect(boardPoint(board, 7, 99).x).toBeCloseTo(0.6, 9);
    });

    it('maps columns and rows onto a board without allocating', () => {
        const board = {
            x0: 0.25, y0: 0.1, x1: 0.75, y1: 0.9,
        };
        const out = { x: 0, y: 0 };
        expect(boardPoint(board, 0.5, 9, out)).toBe(out);
        expect(out.x).toBeCloseTo(0.5, 9);
        // Rows are measured to their centre line, one board-height / rows apart.
        const row = (board.y1 - board.y0) / BOARD_GRID.rows;
        expect(out.y).toBeCloseTo(board.y0 + row * 9.5, 9);
        const next = boardPoint(board, 0.5, 10);
        expect(next.y - out.y).toBeCloseTo(row, 9);
        // The floor row is the last one; anything past the grid is clamped onto it.
        const floor = boardPoint(board, 0.5, BOARD_GRID.rows - 1);
        expect(boardPoint(board, -3, 400)).toEqual({ x: board.x0, y: floor.y });
        expect(boardPoint(board, 0, -7).y).toBeCloseTo(board.y0 + row * 0.5, 9);
    });

    it('joins every card on screen into one rect', () => {
        const a = {
            x0: 0.05, y0: 0.2, x1: 0.3, y1: 0.8,
        };
        const b = {
            x0: 0.35, y0: 0.1, x1: 0.6, y1: 0.7,
        };
        const c = {
            x0: 0.65, y0: 0.25, x1: 0.95, y1: 0.9,
        };
        const layout = {
            cardCount: 3, cards: [a, b, c], hud: null, boards: new Array(PLAYER_SLOTS).fill(null),
        };
        const union = cardUnion(layout);
        expect(union).toEqual({
            x0: 0.05, y0: 0.1, x1: 0.95, y1: 0.9,
        });
        // A copy: the first card is not widened in place.
        expect(union).not.toBe(a);
        expect(a.x1).toBe(0.3);
        expect(cardUnion({ cards: [] })).toBeNull();
        expect(cardUnion(null)).toBeNull();
        // A board for a player who has none is the first board on screen.
        layout.boards[2] = b;
        expect(boardFor(layout, 2)).toBe(b);
        expect(boardFor(layout, 0)).toBe(b);
        layout.boards[2] = null;
        expect(boardFor(layout, 0)).toBeNull();
    });
});

describe('moonlit greenhouse composition: reading the page', () => {
    it('reads the live card, board and HUD rects, and nothing when no board is on screen', () => {
        const card = el(rect(600, 50, 400, 800));
        const canvas = el(rect(650, 200, 300, 600));
        const hud = el(rect(1050, 250, 140, 400));
        const hidden = el(rect(0, 0, 0, 0));
        const doc = {
            querySelectorAll: (selector) => (selector.includes('player-card') ? [card, hidden] : []),
            querySelector: (selector) => {
                if (selector === '#phaser-game-container canvas') return canvas;
                if (selector === '.single-player-stats-bar') return hud;
                return null;
            },
        };
        const win = { innerWidth: 1600, innerHeight: 900, getComputedStyle: () => visible };
        const layout = readLayoutRects(doc, win);
        expect(layout.cardCount).toBe(1);
        expect(layout.cards[0]).toEqual({
            x0: 0.375, y0: 50 / 900, x1: 0.625, y1: 850 / 900,
        });
        expect(layout.boards[0].x0).toBeCloseTo(650 / 1600, 9);
        expect(layout.hud.x1).toBeCloseTo(1190 / 1600, 9);
        expect(layoutsDiffer(layout, readLayoutRects(doc, win))).toBe(false);
        expect(layoutsDiffer(layout, fallbackLayout(1600, 900))).toBe(true);

        const empty = { querySelectorAll: () => [], querySelector: () => null };
        expect(readLayoutRects(empty, win)).toBeNull();
        expect(readLayoutRects(null, win)).toBeNull();
    });

    it('asks the page for the gameplay boards, never the lobby\'s avatar cards', () => {
        const asked = [];
        const doc = {
            querySelectorAll: (selector) => {
                asked.push(selector);
                return [];
            },
            querySelector: () => null,
        };
        readLayoutRects(doc, { innerWidth: 800, innerHeight: 600 });
        expect(asked).toEqual([BOARD_SELECTOR]);
        expect(BOARD_SELECTOR).toBe('.player-card[data-player]');
        expect(HUD_SELECTOR).toBe('.single-player-stats-bar');
        expect(SOLO_CANVAS_SELECTORS).toContain('#phaser-game-container canvas');
        expect(playerCanvasSelector(3)).toBe('#p3-phaser-container canvas');
    });

    it('gives each local-multiplayer board its own slot and takes the first solo canvas it finds', () => {
        const cards = [el(rect(40, 100, 300, 600)), el(rect(360, 100, 300, 600)), el(rect(680, 100, 300, 600))];
        const canvases = {
            '#main-game-canvas': el(rect(10, 10, 100, 200)),
            '#single-player-game-canvas': el(rect(500, 10, 100, 200)),
            [playerCanvasSelector(1)]: el(rect(60, 200, 250, 500)),
            [playerCanvasSelector(3)]: el(rect(700, 200, 250, 500)),
        };
        const doc = {
            querySelectorAll: () => cards,
            querySelector: (selector) => canvases[selector] || null,
        };
        const win = { innerWidth: 1000, innerHeight: 800, getComputedStyle: () => visible };
        const layout = readLayoutRects(doc, win);
        expect(layout.cardCount).toBe(3);
        expect(layout.hud).toBeNull();
        // The first solo selector that has a visible canvas wins.
        expect(layout.boards[0].x0).toBeCloseTo(0.01, 9);
        expect(layout.boards[1].x0).toBeCloseTo(0.06, 9);
        expect(layout.boards[2]).toBeNull();
        expect(layout.boards[3].x0).toBeCloseTo(0.7, 9);
        expect(layout.boards[4]).toBeNull();
        expect(boardFor(layout, 3)).toBe(layout.boards[3]);
        expect(boardFor(layout, 2)).toBe(layout.boards[0]);
    });

    it('does not count a card that is hidden, see-through, tiny or off screen', () => {
        const win = (style) => ({ innerWidth: 1000, innerHeight: 800, getComputedStyle: () => style });
        const one = (r) => ({ querySelectorAll: () => [el(r)], querySelector: () => null });
        const on = rect(100, 100, 300, 600);
        expect(readLayoutRects(one(on), win(visible))).not.toBeNull();
        expect(readLayoutRects(one(on), win({ ...visible, display: 'none' }))).toBeNull();
        expect(readLayoutRects(one(on), win({ ...visible, visibility: 'hidden' }))).toBeNull();
        expect(readLayoutRects(one(on), win({ ...visible, opacity: '0.01' }))).toBeNull();
        expect(readLayoutRects(one(rect(100, 100, 6, 600)), win(visible))).toBeNull();
        expect(readLayoutRects(one(rect(-400, 100, 300, 600)), win(visible))).toBeNull();
        expect(readLayoutRects(one(rect(100, 900, 300, 600)), win(visible))).toBeNull();
        // A window that cannot report styles is taken at its word about the rect.
        expect(readLayoutRects(one(on), { innerWidth: 1000, innerHeight: 800 })).not.toBeNull();
    });

    it('tells two layout reads apart only when a rect has really moved', () => {
        const base = fallbackLayout(1600, 900);
        const copy = () => JSON.parse(JSON.stringify(base));
        expect(layoutsDiffer(base, copy())).toBe(false);
        expect(layoutsDiffer(null, null)).toBe(false);
        expect(layoutsDiffer(base, null)).toBe(true);
        expect(layoutsDiffer(null, base)).toBe(true);

        // Sub-pixel jitter is the same layout; a real move is not.
        const jitter = copy();
        jitter.cards[0].x0 += 0.001;
        jitter.boards[0].y1 -= 0.001;
        expect(layoutsDiffer(base, jitter)).toBe(false);
        expect(layoutsDiffer(base, jitter, 0.0005)).toBe(true);
        const moved = copy();
        moved.cards[0].x0 += 0.02;
        expect(layoutsDiffer(base, moved)).toBe(true);

        const boardMoved = copy();
        boardMoved.boards[0].y0 += 0.05;
        expect(layoutsDiffer(base, boardMoved)).toBe(true);
        const secondBoard = copy();
        secondBoard.boards[3] = { ...base.boards[0] };
        expect(layoutsDiffer(base, secondBoard)).toBe(true);
        const noHud = copy();
        noHud.hud = null;
        expect(layoutsDiffer(base, noHud)).toBe(true);
        const counted = copy();
        counted.cardCount = 1;
        expect(layoutsDiffer(base, counted)).toBe(true);
        const twoCards = copy();
        twoCards.cards.push({ ...base.cards[0] });
        expect(layoutsDiffer(base, twoCards)).toBe(true);
    });
});

/** True when a screen point lies inside a rect (screen fractions). */
const inside = (p, r) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
/** Where a locked piece lands and where it leaves the card, aimed as the world aims it. */
function aim(layout, u, row, jitter = null) {
    const board = boardFor(layout, 0);
    const card = cardFor(layout, board);
    const piece = boardPoint(board, u, row);
    const landing = aimLanding(layout, card, piece, u, row, jitter);
    return {
        board, card, piece, landing, leave: aimLeave(card, piece, landing),
    };
}
/** An upright phone with the card across its width (main.css's ≤ 820 px board), the water under it. */
const phoneLayout = () => ({
    cardCount: 1,
    cards: [{
        x0: 24 / 430, y0: 40 / 932, x1: 406 / 430, y1: 800 / 932,
    }],
    hud: null,
    boards: [{
        x0: 44 / 430, y0: 120 / 932, x1: 386 / 430, y1: 776 / 932,
    }, null, null, null, null],
});

describe('moonlit greenhouse composition: the greenhouse\'s framing', () => {
    it('holds the rest lens\'s horizontal field and clamps the vertical one', () => {
        expect(REST_RIG.near).toBeGreaterThan(0);
        expect(REST_RIG.far).toBeGreaterThan(REST_RIG.near);
        expect(REST_RIG.minFov).toBeLessThan(REST_RIG.maxFov);
        const aspects = [0.2, 0.3, 0.46, 0.6, 0.8, 1, 1.2, 4 / 3, 16 / 10, 16 / 9, 2, 21 / 9, 3, 5];
        const fovs = aspects.map((aspect) => fovForAspect(aspect));
        for (let i = 0; i < fovs.length; i++) {
            expect(fovs[i], `fovForAspect(${aspects[i]})`).toBeGreaterThanOrEqual(REST_RIG.minFov);
            expect(fovs[i], `fovForAspect(${aspects[i]})`).toBeLessThanOrEqual(REST_RIG.maxFov);
            // A wider frame never asks for a taller lens.
            if (i > 0) expect(fovs[i], `fovForAspect(${aspects[i]})`).toBeLessThanOrEqual(fovs[i - 1]);
        }
        // Both clamps are reached: an upright phone on the widest, an ultrawide on the narrowest.
        expect(fovForAspect(0.46)).toBe(REST_RIG.maxFov);
        expect(fovForAspect(21 / 9)).toBe(REST_RIG.minFov);
        // Between them the horizontal field is the rig's.
        const vertical = fovForAspect(16 / 9);
        expect(vertical).toBeGreaterThan(REST_RIG.minFov);
        expect(vertical).toBeLessThan(REST_RIG.maxFov);
        const horizontal = (2 * Math.atan(Math.tan((vertical * Math.PI) / 360) * (16 / 9)) * 180) / Math.PI;
        expect(horizontal).toBeCloseTo(REST_RIG.hFov, 6);
        // Nonsense is a 16:9 frame.
        expect(fovForAspect(NaN)).toBeCloseTo(vertical, 9);
        expect(fovForAspect(undefined)).toBeCloseTo(vertical, 9);
        expect(Number.isFinite(fovForAspect(0))).toBe(true);
    });

    it('finds the card a board sits in, else the first card', () => {
        const a = {
            x0: 0.05, y0: 0.2, x1: 0.3, y1: 0.8,
        };
        const b = {
            x0: 0.35, y0: 0.1, x1: 0.6, y1: 0.7,
        };
        const layout = { cardCount: 2, cards: [a, b], hud: null };
        expect(cardFor(layout, {
            x0: 0.4, y0: 0.2, x1: 0.55, y1: 0.6,
        })).toBe(b);
        expect(cardFor(layout, {
            x0: 0.1, y0: 0.3, x1: 0.25, y1: 0.7,
        })).toBe(a);
        // A board in no card, or no board at all, takes the first.
        expect(cardFor(layout, {
            x0: 0.7, y0: 0.3, x1: 0.9, y1: 0.7,
        })).toBe(a);
        expect(cardFor(layout, null)).toBe(a);
        expect(cardFor({ cards: [] }, null)).toBeNull();
        expect(cardFor(null, null)).toBeNull();
        // The solo fallback board sits in the solo fallback card.
        const solo = fallbackLayout(1920, 1080);
        expect(cardFor(solo, solo.boards[0])).toBe(solo.cards[0]);
    });

    it('stands the moon in the free margin left of the card and high on a 16:9 screen', () => {
        const layout = fallbackLayout(1920, 1080);
        const card = layout.cards[0];
        const frame = frameFor(16 / 9, layout);
        expect(frame.tall).toBe(0);
        expect(frame.moonX).toBeGreaterThan(0);
        expect(frame.moonX).toBeLessThan(card.x0);
        expect(frame.moonY).toBeGreaterThan(0);
        expect(frame.moonY).toBeLessThan(0.3);
        expect(frame.pitch).toBeGreaterThan(0);
        // Into the object it is handed, when it is handed one.
        const out = {};
        expect(frameFor(16 / 9, layout, out)).toBe(out);
        expect(out).toEqual(frame);
        // With nothing on screen it frames for where the solo card would stand.
        const blind = frameFor(16 / 9, null);
        expect(blind.moonX).toBeLessThan(card.x0);
        expect(blind.moonY).toBeLessThan(0.3);
        expect(frameFor(NaN, null)).toEqual(blind);
    });

    it('stands the moon above the card on an upright phone, with the lens lifted further', () => {
        const layout = fallbackLayout(430, 932);
        const card = layout.cards[0];
        const frame = frameFor(430 / 932, layout);
        expect(frame.tall).toBeCloseTo(1, 6);
        expect(frame.moonY).toBeGreaterThan(0);
        expect(frame.moonY).toBeLessThan(card.y0);
        expect(frame.moonX).toBeGreaterThan(0);
        expect(frame.moonX).toBeLessThan(1);
        expect(frame.pitch).toBeGreaterThan(frameFor(16 / 9, fallbackLayout(1920, 1080)).pitch);
        // A square frame is part way between the two.
        const square = frameFor(1, fallbackLayout(1000, 1000));
        expect(square.tall).toBeGreaterThan(0);
        expect(square.tall).toBeLessThan(1);
    });

    it('opens a bloom beside the card on a 16:9 screen, on its column\'s side, never on the card or the HUD', () => {
        const layout = fallbackLayout(1920, 1080);
        const { hud } = layout;
        for (const u of [0, 0.1, 0.25, 0.4, 0.49]) {
            for (const row of [0, 2, 10, 19]) {
                const { card, landing } = aim(layout, u, row);
                expect(landing.x, `u=${u} row=${row}`).toBeLessThan(card.x0);
                expect(landing.x, `u=${u} row=${row}`).toBeGreaterThan(0);
                expect(inside(landing, card), `u=${u} row=${row}`).toBe(false);
            }
        }
        for (const u of [0.51, 0.6, 0.75, 0.9, 1]) {
            for (const row of [0, 2, 10, 19]) {
                const { card, landing } = aim(layout, u, row);
                // Right of the stats bar, not merely right of the card.
                expect(landing.x, `u=${u} row=${row}`).toBeGreaterThan(hud.x1);
                expect(landing.x, `u=${u} row=${row}`).toBeLessThan(1);
                expect(inside(landing, card), `u=${u} row=${row}`).toBe(false);
                expect(inside(landing, hud), `u=${u} row=${row}`).toBe(false);
            }
        }
        // The further a column is from the middle, the further out its bloom opens.
        expect(aim(layout, 0, 10).landing.x).toBeLessThan(aim(layout, 0.4, 10).landing.x);
        expect(aim(layout, 1, 10).landing.x).toBeGreaterThan(aim(layout, 0.6, 10).landing.x);
        // Jitter moves it a little, never onto the card.
        for (const jitter of [[-1, -1], [1, 1], [1, -1], [-1, 1]]) {
            const { card, landing } = aim(layout, 0.45, 0, jitter);
            expect(inside(landing, card), String(jitter)).toBe(false);
            expect(landing.x).toBeLessThan(card.x0);
        }
    });

    it('opens a lower piece\'s bloom lower on screen, nearer the eye', () => {
        const layout = fallbackLayout(1920, 1080);
        for (const u of [0.1, 0.9]) {
            const high = aim(layout, u, 2).landing;
            const low = aim(layout, u, 19).landing;
            expect(low.y, `u=${u}`).toBeGreaterThan(high.y);
            // In the lower part of the frame, where the beds and the water show.
            expect(high.y, `u=${u}`).toBeGreaterThan(0.5);
            expect(low.y, `u=${u}`).toBeLessThanOrEqual(1);
            let last = -Infinity;
            for (let row = 0; row < BOARD_GRID.rows; row++) {
                const { y } = aim(layout, u, row).landing;
                expect(y, `u=${u} row=${row}`).toBeGreaterThanOrEqual(last);
                last = y;
            }
        }
    });

    it('opens a bloom under the card, on the water, on an upright phone', () => {
        const layout = phoneLayout();
        for (const u of [0, 0.25, 0.5, 0.75, 1]) {
            for (const row of [0, 2, 10, 19]) {
                const { card, landing } = aim(layout, u, row);
                expect(landing.y, `u=${u} row=${row}`).toBeGreaterThan(card.y1);
                expect(landing.y, `u=${u} row=${row}`).toBeLessThan(1);
                expect(landing.x, `u=${u} row=${row}`).toBeGreaterThan(0);
                expect(landing.x, `u=${u} row=${row}`).toBeLessThan(1);
            }
        }
        // The column picks the place across the water, the row its depth.
        expect(aim(layout, 0, 10).landing.x).toBeLessThan(aim(layout, 1, 10).landing.x);
        expect(aim(layout, 0.5, 19).landing.y).toBeGreaterThan(aim(layout, 0.5, 2).landing.y);
        // Before the card is on screen the phone's stand-in card is never landed on either.
        const fallback = fallbackLayout(430, 932);
        for (const u of [0, 0.5, 1]) {
            for (const row of [2, 19]) {
                const { card, landing } = aim(fallback, u, row);
                expect(inside(landing, card), `fallback u=${u} row=${row}`).toBe(false);
                expect(landing.x, `fallback u=${u} row=${row}`).toBeGreaterThan(0);
                expect(landing.x, `fallback u=${u} row=${row}`).toBeLessThan(1);
                expect(landing.y, `fallback u=${u} row=${row}`).toBeLessThan(1);
            }
        }
    });

    it('lets a seed of light leave the card by its edge on the landing\'s side', () => {
        const wide = fallbackLayout(1920, 1080);
        const left = aim(wide, 0.2, 6);
        expect(left.leave.x).toBe(left.card.x0);
        expect(left.leave.y).toBe(left.piece.y); // at the piece's own height
        const right = aim(wide, 0.8, 14);
        expect(right.leave.x).toBe(right.card.x1);
        expect(right.leave.y).toBe(right.piece.y);
        // Under the card: from its foot, at the piece's column.
        const under = aim(phoneLayout(), 0.3, 12);
        expect(under.leave.x).toBe(under.piece.x);
        expect(under.leave.y).toBe(under.card.y1);
        // Into the object it is handed.
        const out = { x: 0, y: 0 };
        expect(aimLeave(left.card, left.piece, left.landing, out)).toBe(out);
        expect(out).toEqual(left.leave);
    });

    it('keeps a bloom off every card when boards stand side by side', () => {
        const left = {
            x0: 0.08, y0: 0.15, x1: 0.46, y1: 0.85,
        };
        const right = {
            x0: 0.54, y0: 0.15, x1: 0.92, y1: 0.85,
        };
        const layout = {
            cardCount: 2, cards: [left, right], hud: null, boards: [null, left, right, null, null],
        };
        const out = { x: 0, y: 0 };
        const off = (p) => [left, right].every((c) => !(p.x > c.x0 && p.x < c.x1 && p.y > c.y0 && p.y < c.y1));
        [left, right].forEach((card) => {
            for (let u = 0; u <= 1; u += 0.05) {
                for (const row of [2, 10, 19]) {
                    aimLanding(layout, card, { x: (card.x0 + card.x1) / 2, y: 0.6 }, u, row, [0.9, -0.9], out);
                    expect(off(out), `card ${card.x0} u ${u.toFixed(2)} row ${row}: ${out.x.toFixed(3)}`).toBe(true);
                    expect(out.x).toBeGreaterThan(0);
                    expect(out.x).toBeLessThan(1);
                }
            }
        });
    });
});
