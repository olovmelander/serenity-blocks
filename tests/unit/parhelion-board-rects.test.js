import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    PARHELION_RECT_MIN_HEIGHT_PX,
    PARHELION_RECT_MIN_WIDTH_PX,
    PARHELION_RECT_SELECTORS,
    ParhelionBoardRects,
} from '../../src/themes/parhelion/composition/parhelion-board-rects.js';
import {
    FALLBACK_RECT,
    MEASURED_VIEWPORTS,
    cardFromBoard,
} from '../../src/playground/effects/parhelion-composition.js';
import { PARHELION_PLAYER_SLOTS } from '../../src/themes/parhelion/sim/parhelion-reaction-director.js';
import { ParhelionOpticsState } from '../../src/themes/parhelion/sim/parhelion-optics-state.js';

const W = 1920;
const H = 1080;
const SOLO = MEASURED_VIEWPORTS[0]; // the measured 1920×1080 single-player layout

/** A DOM element whose bounding rect is the given normalised rect at W×H (CSS px). */
function elementAt(r, width = W, height = H) {
    return {
        getBoundingClientRect: () => ({
            left: r.x0 * width,
            top: r.y0 * height,
            width: (r.x1 - r.x0) * width,
            height: (r.y1 - r.y0) * height,
        }),
    };
}

function elementPx(left, top, width, height) {
    return {
        getBoundingClientRect: () => ({
            left, top, width, height,
        }),
    };
}

function createDom(elements = {}) {
    const map = { ...elements };
    return {
        map,
        document: {
            querySelector: vi.fn((selector) => map[selector] || null),
        },
    };
}

function createReader(elements, { mode = 'single', width = W, height = H } = {}) {
    const dom = createDom(elements);
    const win = { innerWidth: width, innerHeight: height };
    const state = { mode };
    const reader = new ParhelionBoardRects({
        window: win,
        document: dom.document,
        getModeId: () => state.mode,
    });
    return {
        reader, dom, win, state,
    };
}

function soloElements() {
    return {
        '.single-player-card': elementAt(SOLO.card),
        '#phaser-game-container canvas': elementAt(SOLO.board),
        '.single-player-card .player-next-pieces': elementAt(SOLO.next),
        '.single-player-stats-bar': elementAt(SOLO.hud),
    };
}

function expectRect(actual, expected, digits = 6) {
    expect(actual).not.toBeNull();
    expect(actual.x0).toBeCloseTo(expected.x0, digits);
    expect(actual.y0).toBeCloseTo(expected.y0, digits);
    expect(actual.x1).toBeCloseTo(expected.x1, digits);
    expect(actual.y1).toBeCloseTo(expected.y1, digits);
}

const MP_BOARDS = [
    null,
    {
        x0: 0.04, y0: 0.12, x1: 0.22, y1: 0.9,
    },
    {
        x0: 0.28, y0: 0.12, x1: 0.46, y1: 0.9,
    },
    {
        x0: 0.54, y0: 0.12, x1: 0.72, y1: 0.9,
    },
    {
        x0: 0.78, y0: 0.12, x1: 0.96, y1: 0.9,
    },
];

describe('ParhelionBoardRects (spec §7.8 + §15)', () => {
    it('is import-safe and falls back without any DOM in Node', () => {
        expect(typeof globalThis.document).toBe('undefined');
        const reader = new ParhelionBoardRects();
        const layout = reader.read();
        expect(layout.fallback).toBe(true);
        expectRect(layout.card, FALLBACK_RECT);
        expectRect(layout.board, FALLBACK_RECT);
        expect(layout.boards).toHaveLength(PARHELION_PLAYER_SLOTS);
        expect(layout.boards.every((entry) => entry === null)).toBe(true);
    });

    it('reads the measured solo card, board, queue and HUD, normalised y-down', () => {
        const { reader } = createReader(soloElements());
        const layout = reader.read();

        expectRect(layout.card, SOLO.card);
        expectRect(layout.board, SOLO.board);
        expectRect(layout.queue, SOLO.next);
        expect(layout.next).toBe(layout.queue);
        expectRect(layout.hud, SOLO.hud);
        expect(layout.cardDerived).toBe(false);
        expect(layout.fallback).toBe(false);
        expect(layout.serenity).toBe(false);
        expect(layout.mode).toBe('single');
        expect(layout.aspect).toBeCloseTo(W / H, 9);
        expect(layout.width).toBe(W);
        expect(layout.height).toBe(H);

        expect(layout.boardCount).toBe(1);
        const solo = layout.boards[0];
        expectRect(solo, SOLO.board); // the entry is itself a rect (optics-state reads boards[i])
        expectRect(solo.rect, SOLO.board);
        expect(solo.player).toBe(0);
        expect(solo.stoneBacked).toBe(true);
        expect(layout.boards.slice(1).every((entry) => entry === null)).toBe(true);
    });

    it('derives the card from the board canvas when .single-player-card is absent', () => {
        const elements = soloElements();
        delete elements['.single-player-card'];
        const { reader } = createReader(elements);
        const layout = reader.read();

        expect(layout.cardDerived).toBe(true);
        expect(layout.fallback).toBe(false);
        expectRect(layout.card, cardFromBoard(SOLO.board, {}));
        expectRect(layout.board, SOLO.board);
    });

    it('uses FALLBACK_RECT (copied, not aliased) when no card and no canvas exist outside Serenity', () => {
        const { reader } = createReader({
            '.single-player-stats-bar': elementAt(SOLO.hud),
        });
        const layout = reader.read();

        expect(layout.fallback).toBe(true);
        expect(layout.cardDerived).toBe(false);
        expectRect(layout.card, FALLBACK_RECT);
        expectRect(layout.board, FALLBACK_RECT);
        expect(layout.card).not.toBe(FALLBACK_RECT);
        expect(layout.board).not.toBe(FALLBACK_RECT);
        expect(layout.boardCount).toBe(0);
        expect(layout.boards.every((entry) => entry === null)).toBe(true);
        expectRect(layout.hud, SOLO.hud);
    });

    it('walks the solo selector chain in order', () => {
        const { soloBoards } = PARHELION_RECT_SELECTORS;
        expect(soloBoards).toEqual([
            '#phaser-game-container canvas',
            '#main-game-canvas',
            '#single-player-game-canvas',
        ]);
        const last = {
            x0: 0.4, y0: 0.2, x1: 0.6, y1: 0.9,
        };
        const { reader } = createReader({ '#single-player-game-canvas': elementAt(last) });
        const layout = reader.read();
        expectRect(layout.boards[0], last);
        expectRect(layout.board, last);
        expect(layout.cardDerived).toBe(true);
    });

    it('reads local-MP boards into player slots 1..4 and never marks them stone-backed', () => {
        const elements = {
            // A lingering solo canvas must not become a fifth board while MP boards are live.
            '#phaser-game-container canvas': elementAt(SOLO.board),
        };
        for (let player = 1; player <= 4; player += 1) {
            elements[`#p${player}-phaser-container canvas`] = elementAt(MP_BOARDS[player]);
        }
        const { reader } = createReader(elements, { mode: 'local-multiplayer' });
        const layout = reader.read();

        expect(layout.boardCount).toBe(4);
        expect(layout.boards[0]).toBeNull();
        for (let player = 1; player <= 4; player += 1) {
            const entry = layout.boards[player];
            expectRect(entry, MP_BOARDS[player]);
            expectRect(entry.rect, MP_BOARDS[player]);
            expect(entry.player).toBe(player);
            expect(entry.stoneBacked).toBe(false);
        }
        expectRect(layout.board, MP_BOARDS[1]);
        expect(layout.cardDerived).toBe(true);
        expectRect(layout.card, cardFromBoard(MP_BOARDS[1], {}));

        // The layout drives the optics state as-is: every MP board becomes a player rect.
        const state = new ParhelionOpticsState('High');
        state.setLayout(layout);
        expect(state.multiBoard).toBe(true);
        for (let player = 1; player <= 4; player += 1) {
            expect(state.playerRectValid[player]).toBe(1);
            expectRect(state.playerRects[player], MP_BOARDS[player]);
        }
        expect(state.playerRectValid[0]).toBe(0);
    });

    it('marks a two-player layout as not stone-backed either', () => {
        const { reader } = createReader({
            '#p1-phaser-container canvas': elementAt(MP_BOARDS[1]),
            '#p2-phaser-container canvas': elementAt(MP_BOARDS[2]),
        }, { mode: 'local-multiplayer' });
        const layout = reader.read();
        expect(layout.boardCount).toBe(2);
        expect(layout.boards[1].stoneBacked).toBe(false);
        expect(layout.boards[2].stoneBacked).toBe(false);
    });

    it('keeps no calm rects in Serenity mode, even with the DOM present', () => {
        const { reader, dom } = createReader(soloElements(), { mode: 'serenity' });
        const layout = reader.read();

        expect(layout.serenity).toBe(true);
        expect(layout.mode).toBe('serenity');
        expect(layout.fallback).toBe(false);
        expect(layout.card).toBeNull();
        expect(layout.board).toBeNull();
        expect(layout.queue).toBeNull();
        expect(layout.hud).toBeNull();
        expect(layout.boardCount).toBe(0);
        expect(layout.boards.every((entry) => entry === null)).toBe(true);
        expect(dom.document.querySelector).not.toHaveBeenCalled();
    });

    const floor = `${PARHELION_RECT_MIN_WIDTH_PX}×${PARHELION_RECT_MIN_HEIGHT_PX} px`;

    it(`ignores rects under ${floor} and off-screen rects`, () => {
        const main = {
            x0: 0.42, y0: 0.28, x1: 0.58, y1: 0.84,
        };
        const { reader } = createReader({
            // Collapsed canvases: too narrow, then too short → the chain moves on.
            '#phaser-game-container canvas': elementPx(800, 300, PARHELION_RECT_MIN_WIDTH_PX - 1, 600),
            '#main-game-canvas': elementAt(main),
            '#p1-phaser-container canvas': elementPx(100, 100, 300, PARHELION_RECT_MIN_HEIGHT_PX - 1),
            // Entirely off screen to the right.
            '#p2-phaser-container canvas': elementPx(W + 10, 100, 300, 600),
            '.single-player-card': elementPx(900, 400, 20, 20),
            '.single-player-stats-bar': elementPx(1200, 300, 140, PARHELION_RECT_MIN_HEIGHT_PX - 1),
            '.single-player-card .player-next-pieces': elementPx(810, 200, PARHELION_RECT_MIN_WIDTH_PX - 1, 90),
        });
        const layout = reader.read();

        expect(layout.boardCount).toBe(1);
        expect(layout.boards[1]).toBeNull();
        expect(layout.boards[2]).toBeNull();
        expectRect(layout.boards[0], main);
        expectRect(layout.board, main);
        expect(layout.cardDerived).toBe(true); // the 20×20 card counts as absent
        expect(layout.hud).toBeNull();
        expect(layout.queue).toBeNull();
    });

    it('accepts a rect exactly at the size floor', () => {
        const { reader } = createReader({
            '#phaser-game-container canvas': elementPx(
                900,
                300,
                PARHELION_RECT_MIN_WIDTH_PX,
                PARHELION_RECT_MIN_HEIGHT_PX,
            ),
        });
        expect(reader.read().boardCount).toBe(1);
    });

    it('caches until invalidated and reuses every object (no allocation on repeat reads)', () => {
        const {
            reader, dom, win, state,
        } = createReader(soloElements());
        const first = reader.read();
        const {
            card, board, queue, hud, boards,
        } = first;
        const soloEntry = boards[0];
        const soloRect = soloEntry.rect;
        const queries = dom.document.querySelector.mock.calls.length;
        const { version } = first;

        for (let i = 0; i < 50; i += 1) {
            const again = reader.read();
            expect(again).toBe(first);
        }
        expect(dom.document.querySelector.mock.calls.length).toBe(queries); // cached: no DOM reads
        expect(first.version).toBe(version);

        // Invalidate + a moved board: fresh values in the SAME objects.
        const moved = {
            x0: 0.40, y0: 0.30, x1: 0.60, y1: 0.86,
        };
        dom.map['#phaser-game-container canvas'] = elementAt(moved);
        reader.invalidate();
        const second = reader.read();
        expect(second).toBe(first);
        expect(second.card).toBe(card);
        expect(second.board).toBe(board);
        expect(second.queue).toBe(queue);
        expect(second.hud).toBe(hud);
        expect(second.boards).toBe(boards);
        expect(second.boards[0]).toBe(soloEntry);
        expect(second.boards[0].rect).toBe(soloRect);
        expectRect(second.board, moved);
        expectRect(second.boards[0].rect, moved);
        expect(second.version).toBe(version + 1);
        expect(dom.document.querySelector.mock.calls.length).toBeGreaterThan(queries);

        // A window resize or a mode change re-reads without an explicit invalidate().
        const beforeResize = dom.document.querySelector.mock.calls.length;
        win.innerWidth = 1680;
        win.innerHeight = 1050;
        expect(reader.read()).toBe(first);
        expect(dom.document.querySelector.mock.calls.length).toBeGreaterThan(beforeResize);
        expect(first.aspect).toBeCloseTo(1680 / 1050, 9);

        state.mode = 'serenity';
        expect(reader.read().serenity).toBe(true);
        state.mode = 'single';
        const back = reader.read();
        expect(back.serenity).toBe(false);
        expect(back.card).toBe(card); // the same rect object comes back into use
    });

    it('treats a throwing mode lookup as no mode', () => {
        const reader = new ParhelionBoardRects({
            window: { innerWidth: W, innerHeight: H },
            document: createDom(soloElements()).document,
            getModeId: () => { throw new Error('manager not ready'); },
        });
        const layout = reader.read();
        expect(layout.mode).toBe('');
        expectRect(layout.card, SOLO.card);
    });
});
