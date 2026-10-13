import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import {
    BAND_TRUNKS, BOARD_GRID, BOARD_SELECTOR, HUD_AIR, HUD_SELECTOR, LANE_LEAST, LANE_MARGIN, LANE_WIDTH, PLAYER_SLOTS, SISTER_BAND,
    SISTER_GAP, SOLO_CANVAS_SELECTORS, boardFor, boardPoint, cardUnion, createBand, fallbackLayout, hudBeside,
    layoutsDiffer, playerCanvasSelector, readLayoutRects, trunkBand,
} from '../../src/themes/rainbark/rainbark-composition.js';
import {
    HERO_TRUNKS, HUD_ROW_WIDTH, TRUNK_STRIDE, TWIN_SEEDS, aspectWeights, eyeRow, fallbackCard, fallbackHud, planGrove,
    restLens, trunkRecord, trunkSpan,
} from '../../src/themes/rainbark/rainbark-core.js';
import { QUALITY } from '../../src/themes/rainbark/rainbark-quality.js';
import { fovForAspect, pitchForAspect } from '../../src/themes/rainbark/rainbark-world.js';
import { trunkSurface } from '../../src/themes/rainbark/rainbark-trunks.js';

const rect = (left, top, width, height) => ({
    left, top, right: left + width, bottom: top + height, width, height,
});
const el = (r) => ({ getBoundingClientRect: () => r });
const visible = { display: 'block', visibility: 'visible', opacity: '1' };
const source = readFileSync(path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'rainbark',
    'rainbark-composition.js',
), 'utf8');

describe('rainbark composition: the board before it is on screen', () => {
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

describe('rainbark composition: board columns and rows on screen', () => {
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

describe('rainbark composition: reading the page', () => {
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

    it('finds online play\'s board, which reports its events as the solo slot', () => {
        expect(SOLO_CANVAS_SELECTORS).toContain('#online-main-board canvas');
        const card = el(rect(600, 50, 400, 800));
        const online = el(rect(640, 180, 320, 640));
        const solo = el(rect(10, 10, 100, 200));
        const page = (canvases) => ({
            querySelectorAll: () => [card],
            querySelector: (selector) => canvases[selector] || null,
        });
        const win = { innerWidth: 1600, innerHeight: 900, getComputedStyle: () => visible };
        const layout = readLayoutRects(page({ '#online-main-board canvas': online }), win);
        expect(layout.boards[0]).toEqual({
            x0: 0.4, y0: 0.2, x1: 0.6, y1: 820 / 900,
        });
        expect(boardFor(layout, 0)).toBe(layout.boards[0]);
        // A solo board on screen still comes first: the online board is the last one asked for.
        expect(SOLO_CANVAS_SELECTORS[SOLO_CANVAS_SELECTORS.length - 1]).toBe('#online-main-board canvas');
        const both = readLayoutRects(page({ '#online-main-board canvas': online, '#main-game-canvas': solo }), win);
        expect(both.boards[0].x0).toBeCloseTo(10 / 1600, 9);
    });

    it('stays three-free and reads only the document and window it is handed', () => {
        const imports = [...source.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm)]
            .map((m) => m[1]);
        expect(imports.every((name) => name.startsWith('./rainbark-')), imports.join()).toBe(true);
        expect(source).not.toMatch(/\bdocument\.|\bwindow\./);
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

// ── The composition solver ──────────────────────────────────────────────────────

const SEEDS = planGrove(0x6364, QUALITY.High).heroes.map(({ seed }) => seed);
/**
 * The frames the solver must hold (fallback layouts): a tall phone, a narrow tablet (its HUD a row
 * under the card), upright tablets and monitors 821–1100 CSS px wide (the stats bar still beside
 * the board: iPad Pro 11 and 12.9 portrait, a vertical 1080p screen), a square, 16:9 and 21:9.
 */
const FRAMES = [
    [388, 844], [768, 1024], [821, 1180], [834, 1194], [900, 1200], [960, 1280], [1024, 1366], [1080, 1920],
    [1100, 1500], [1000, 1000], [1920, 1080], [2560, 1080],
];
const STOREYS = [20, 56, 152];

/** The rig's rest camera for an aspect at an eye height (built from the world's own lens). */
function rigCamera(aspect, eyeY) {
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, 0.3, 3000);
    camera.position.set(0, eyeY, 0);
    camera.rotation.set(pitchForAspect(aspect) * (Math.PI / 180), 0, 0);
    camera.updateMatrixWorld();
    return camera;
}

/** The record a placement stands as (the world's own: the table trunk at the solved x, z, lean). */
function placedRecord(place, camY) {
    const index = HERO_TRUNKS.findIndex((t) => t.name === place.name);
    const seed = index >= 0 ? SEEDS[index] : TWIN_SEEDS[BAND_TRUNKS.indexOf(place.name) - 5];
    return trunkRecord({
        ...place.trunk, x: place.x, z: place.z, lean: place.lean,
    }, seed, new Float32Array(TRUNK_STRIDE), 0, camY);
}

/**
 * The bole's screen-x extent on a row, through a real camera: for each line up the bark, the
 * height where it crosses the row (bisection), projected.
 */
function silhouetteOnRow(record, camera, sy) {
    const v = new THREE.Vector3();
    const rowOf = (a, h) => {
        const p = trunkSurface(record, a, h).position;
        v.set(p[0], p[1], p[2]).project(camera);
        return (1 - v.y) / 2;
    };
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 120; i++) {
        const a = i / 120;
        if (!(rowOf(a, 0) >= sy && rowOf(a, 1) <= sy)) continue;
        let h0 = 0;
        let h1 = 1;
        for (let k = 0; k < 26; k++) {
            const mid = (h0 + h1) / 2;
            if (rowOf(a, mid) > sy) h0 = mid;
            else h1 = mid;
        }
        rowOf(a, (h0 + h1) / 2);
        if (v.z >= 1) continue;
        lo = Math.min(lo, (v.x + 1) / 2);
        hi = Math.max(hi, (v.x + 1) / 2);
    }
    return [lo, hi];
}

const onScreen = (r) => r && r.x1 > 0 && r.x0 < 1 && r.y1 > 0 && r.y0 < 1;
/** The rects the heroes stand round: every card, and the HUD when it stands beside them. */
const standRects = (layout) => {
    const cards = layout.cards.filter(onScreen);
    return hudBeside(layout.hud, cardUnion(layout)) ? [...cards, layout.hud] : cards;
};

describe('rainbark composition: the hero trunks round the live rects (trunkBand)', () => {
    it('never stands the Elder, a Sister or an R1 on the card or the HUD, a tall phone to 21:9, any storey', () => {
        for (const [W, H] of FRAMES) {
            const aspect = W / H;
            const layout = fallbackLayout(W, H);
            const rects = standRects(layout);
            // Upright frames over the stylesheet's 820 px keep the stats bar beside the board.
            if (W > HUD_ROW_WIDTH && W <= 1100) expect(rects.length, `${W}×${H}`).toBe(2);
            for (const camY of STOREYS) {
                const band = trunkBand(layout, aspect, { camY, seeds: SEEDS });
                const camera = rigCamera(aspect, camY);
                band.placements.filter((p) => p.show).forEach((place) => {
                    const record = placedRecord(place, camY);
                    rects.forEach((r) => {
                        for (let j = 0; j <= 6; j++) {
                            const sy = Math.min(0.999, Math.max(0.001, r.y0 + ((r.y1 - r.y0) * j) / 6));
                            const [x0, x1] = silhouetteOnRow(record, camera, sy);
                            if (!(x1 > x0)) continue;
                            const clear = x1 < r.x0 || x0 > r.x1;
                            const seen = `[${x0.toFixed(3)}, ${x1.toFixed(3)}] vs [${r.x0.toFixed(3)}, `
                                + `${r.x1.toFixed(3)}]`;
                            expect(clear, `${place.name} @${aspect.toFixed(2)} y${camY} row ${sy.toFixed(3)}: ${seen}`)
                                .toBe(true);
                        }
                    });
                });
            }
        }
    });

    it('crops the Elder on the left at card.x0 − card.x0·(0.08 + 0.26k) and sets the Sisters deep on the right', () => {
        for (const [W, H] of FRAMES) {
            const aspect = W / H;
            const layout = fallbackLayout(W, H);
            const card = layout.cards[0];
            const { k, w } = aspectWeights(aspect);
            const band = trunkBand(layout, aspect, { camY: 56, seeds: SEEDS });
            const [elder, one, two, r1a, , twinA, twinB] = band.placements;
            expect(elder.show).toBe(true);
            expect(elder.x0).toBeLessThan(0);
            const goal = card.x0 - card.x0 * (0.08 + 0.26 * k);
            // On the formula, or pushed further out where it would touch.
            expect(elder.x1).toBeLessThanOrEqual(goal + 1e-3);
            expect(elder.x1).toBeGreaterThan(goal - 0.03);
            expect(elder.z).toBeCloseTo(-(9 - w), 9);
            // Sister One just right of the HUD when it stands beside the card, else of the card; deep.
            const hud = hudBeside(layout.hud, card) ? layout.hud : null;
            // (Hidden only where the frame leaves her less than her band right of the HUD.)
            expect(one.show).toBe(one.x0 <= 1 - SISTER_BAND);
            if (W / H > 0.75) expect(one.show).toBe(true);
            expect(one.x0).toBeGreaterThanOrEqual(Math.max(card.x1, hud ? hud.x1 : 0) + 0.012 + 0.063 * k - 1e-3);
            expect(one.z).toBe(-24);
            // Sister Two deep and slim (§2.3 as the A2 review amends it).
            expect(two.z).toBe(-62);
            expect(two.trunk.radius).toBeLessThan(one.trunk.radius);
            // Upright: no Sister Two and no R1a (the left lane cannot hold her); the Twin only at 21:9.
            expect(two.show).toBe(aspect > 1.5);
            if (aspect < 1) expect(r1a.show).toBe(false);
            if (aspect > 1.5) expect(r1a.show).toBe(true);
            if (two.show) expect(two.x0).toBeGreaterThan(one.x0);
            expect(twinA.show).toBe(aspect > 2.2);
            expect(twinB.show).toBe(aspect > 2.2);
        }
        // The 16:9 reference: the Elder's right silhouette at about 0.27, Sister One from 0.78.
        const ref = trunkBand(fallbackLayout(1920, 1080), 16 / 9, { camY: 56, seeds: SEEDS });
        expect(ref.placements[0].x1).toBeCloseTo(0.27, 2);
        expect(ref.placements[1].x0).toBeCloseTo(0.783, 2);
    });

    it('follows a live layout: a card moved left, a wide HUD', () => {
        const layout = {
            cardCount: 1,
            cards: [{
                x0: 0.3, y0: 0.1, x1: 0.48, y1: 0.9,
            }],
            hud: {
                x0: 0.52, y0: 0.3, x1: 0.7, y1: 0.7,
            },
            boards: [],
        };
        const band = trunkBand(layout, 16 / 9, { camY: 56, seeds: SEEDS });
        const [elder, one] = band.placements;
        expect(elder.x1).toBeLessThan(0.3);
        expect(one.x0).toBeGreaterThan(0.7);
        // No layout at all: the solo fallback the world stands in for one.
        const none = trunkBand(null, 16 / 9, { camY: 56, seeds: SEEDS });
        const same = trunkBand(fallbackLayout(1920, 1080), 16 / 9, { camY: 56, seeds: SEEDS });
        expect(JSON.stringify(none)).toBe(JSON.stringify(same));
        // …at the frame's CSS size when it is known.
        const sized = trunkBand(null, 16 / 9, { camY: 56, seeds: SEEDS, css: { width: 1280, height: 720 } });
        const at720 = trunkBand(fallbackLayout(1280, 720), 16 / 9, { camY: 56, seeds: SEEDS });
        expect(JSON.stringify(sized)).toBe(JSON.stringify(at720));
    });

    it('keeps the right open, sunlit air: a few slim, deep silhouettes with air between them (16:9, 21:9)', () => {
        const plan = planGrove(0x6364, QUALITY.High);
        for (const [W, H] of [[1920, 1080], [2560, 1080]]) {
            const aspect = W / H;
            const layout = fallbackLayout(W, H);
            const { hud } = layout;
            const lens = restLens(aspect);
            const band = trunkBand(layout, aspect, { camY: 56, seeds: SEEDS });
            // Every silhouette on the eye's row right of the HUD: the shown heroes and the plan's
            // R1 and R2 (the near ranks; deeper ones are ghosts in the haze).
            const spans = [];
            const span = [0, 0];
            band.placements.filter((p) => p.show).forEach((p) => {
                trunkSpan(placedRecord(p, 56), lens, eyeRow(lens), 56, 0, span);
                if (span[1] > hud.x1 && span[0] < 1) spans.push([span[0], span[1], p.name]);
            });
            plan.trunks.filter((t) => t.rank <= 2).forEach((t) => {
                const record = trunkRecord(t, t.seed, new Float32Array(TRUNK_STRIDE), 0, 56);
                trunkSpan(record, lens, eyeRow(lens), 56, 0, span);
                if (span[1] > hud.x1 && span[0] < 1) spans.push([span[0], span[1], t.name]);
            });
            spans.sort((a, b) => a[0] - b[0]);
            // Overlapping boles are one silhouette (the fused Twin).
            for (let i = spans.length - 1; i > 0; i--) {
                if (spans[i][0] <= spans[i - 1][1]) {
                    spans[i - 1][1] = Math.max(spans[i - 1][1], spans[i][1]);
                    spans.splice(i, 1);
                }
            }
            const width = spans.reduce((sum, [a, b]) => sum + Math.min(b, 1) - Math.max(a, hud.x1), 0);
            expect(width, `${aspect.toFixed(2)}: ${JSON.stringify(spans)}`).toBeLessThanOrEqual(0.45 * (1 - hud.x1));
            expect(spans.length).toBeLessThanOrEqual(3);
            // Clear air beside the HUD, and between each pair of neighbours.
            expect(spans[0][0]).toBeGreaterThanOrEqual(hud.x1 + HUD_AIR - 1e-6);
            for (let i = 1; i < spans.length; i++) {
                const air = spans[i][0] - spans[i - 1][1];
                expect(air, `${spans[i - 1][2]} | ${spans[i][2]}`).toBeGreaterThanOrEqual(0.03);
            }
            // Sister Two (and the Twin beyond her) keeps her band of air on every row, top to bottom.
            const [, one, two, , r1b, twinA] = band.placements;
            expect(r1b.show).toBe(false);
            const pairs = [[one, two]];
            if (twinA.show) pairs.push([two, twinA]);
            pairs.forEach(([a, b]) => {
                [0.02, eyeRow(lens), 0.98].forEach((sy) => {
                    const right = trunkSpan(placedRecord(a, 56), lens, sy, 56, 0, [0, 0])[1];
                    const left = trunkSpan(placedRecord(b, 56), lens, sy, 56, 0, [0, 0])[0];
                    const air = left - right;
                    expect(air, `${a.name} | ${b.name} row ${sy.toFixed(2)}`).toBeGreaterThanOrEqual(SISTER_GAP - 1e-3);
                });
            });
        }
        // The Sisters barely lean, and never toward each other: no arch closes over the open air.
        const one = HERO_TRUNKS.find((t) => t.name === 'Sister One');
        const two = HERO_TRUNKS.find((t) => t.name === 'Sister Two');
        expect(one.lean).toBeLessThanOrEqual(1);
        expect(two.lean).toBeLessThanOrEqual(1);
        expect(Math.cos((two.leanTo * Math.PI) / 180)).toBeGreaterThan(0);
    });

    it('stands Sister One\'s band at the right edge of an upright screen with no layout yet', () => {
        for (const aspect of [0.46, 0.56, 0.75]) {
            // The world's own fallback (a 1080-line frame), and a 1000-line one whose HUD would
            // hang mostly off the right edge: a HUD the frame barely shows is not stood round.
            for (const layout of [null, fallbackLayout(aspect * 1000, 1000)]) {
                const one = trunkBand(layout, aspect, { camY: 56, seeds: SEEDS }).placements[1];
                const card = (layout || fallbackLayout(aspect * 1080, 1080)).cards[0];
                expect(one.show).toBe(true);
                expect(one.x0, `${aspect} ${layout ? 'layout' : 'none'}`).toBeLessThanOrEqual(0.92);
                expect(one.x0).toBeGreaterThan(card.x1);
            }
        }
    });

    it('follows the stylesheet\'s 820 px rule: the stats bar a row under the card, else beside it', () => {
        for (const [W, H] of [[388, 844], [768, 1024], [820, 1180]]) {
            const hud = fallbackHud(W, H);
            const card = fallbackCard(W, H);
            expect(hud.x0).toBeLessThan(card.x0);
            expect(hud.x1).toBeGreaterThan(card.x1);
            expect(hud.y0).toBeGreaterThan(card.y1);
            expect(hudBeside(hud, card)).toBe(false);
        }
        for (const [W, H] of [[821, 1180], [1024, 1366], [1080, 1920], [1920, 1080], [2560, 1080]]) {
            const hud = fallbackHud(W, H);
            const card = fallbackCard(W, H);
            expect(hud.x0).toBeGreaterThan(card.x1);
            expect(hud.x1, `${W}×${H}`).toBeLessThan(1);
            expect(hudBeside(hud, card)).toBe(true);
        }
        // A HUD mostly off the frame, or under the card, is not one the heroes stand round.
        const card = fallbackCard(1920, 1080);
        expect(hudBeside({
            x0: 0.9, y0: 0.3, x1: 1.3, y1: 0.7,
        }, card)).toBe(false);
        expect(hudBeside(null, card)).toBe(false);
    });

    it('never stands Sister One behind a HUD beside the card on an upright frame 820–1100 px wide', () => {
        for (let W = 821; W <= 1100; W += 31) {
            for (const H of [Math.round(W * 1.2), Math.round(W * 1.42), Math.round(W * 1.78)]) {
                const layout = fallbackLayout(W, H);
                const { hud } = layout;
                expect(hudBeside(hud, layout.cards[0])).toBe(true);
                for (const camY of [56, 152]) {
                    const band = trunkBand(layout, W / H, { camY, seeds: SEEDS });
                    const one = band.placements[1];
                    const record = placedRecord(one, camY);
                    const camera = rigCamera(W / H, camY);
                    const frame = `${W}×${H} y${camY}`;
                    if (!one.show) {
                        // Hidden only when the frame leaves her less than her band.
                        expect(one.x0, frame).toBeGreaterThan(1 - SISTER_BAND);
                        continue;
                    }
                    for (let j = 0; j <= 8; j++) {
                        const sy = Math.min(0.999, Math.max(0.001, hud.y0 + ((hud.y1 - hud.y0) * j) / 8));
                        const [x0, x1] = silhouetteOnRow(record, camera, sy);
                        if (!(x1 > x0)) continue;
                        expect(x0, `${frame} row ${sy.toFixed(3)}: ${x0.toFixed(3)} vs HUD ${hud.x1.toFixed(3)}`)
                            .toBeGreaterThan(hud.x1);
                    }
                    // Her card side the lane (her outer side is off the frame).
                    expect(band.lanes[1].side).toBe(one.x1 < 0.985 ? 'sun' : 'card');
                }
            }
        }
    });

    it('lays the peel lanes on the Elder\'s card side and Sister One\'s sunlit side (her card side upright)', () => {
        for (const [W, H] of FRAMES) {
            const aspect = W / H;
            const band = trunkBand(fallbackLayout(W, H), aspect, { camY: 56, seeds: SEEDS });
            const [elder, one] = band.placements;
            const [laneE, laneS] = band.lanes;
            expect(laneE.code).toBe(1);
            expect(laneS.code).toBe(2);
            // (The Elder's lane narrows on a narrow frame until it stands on screen.)
            expect(laneE.theta1 - laneE.theta0).toBeLessThanOrEqual(LANE_WIDTH.elder + 1e-9);
            expect(laneE.theta1 - laneE.theta0).toBeGreaterThanOrEqual(LANE_LEAST - 1e-9);
            expect(laneS.theta1 - laneS.theta0).toBeCloseTo(LANE_WIDTH.sister, 9);
            expect(laneE.theta0).toBeGreaterThanOrEqual(0);
            expect(laneE.theta0).toBeLessThan(Math.PI * 2);
            // Each lane on its trunk's face, inside its silhouette, on screen.
            expect(laneE.x0).toBeGreaterThan(Math.max(elder.x0, 0));
            expect(laneE.x1).toBeLessThan(elder.x1);
            expect(laneS.x0).toBeGreaterThan(one.x0 - 1e-3);
            expect(laneS.x1).toBeLessThan(one.x1 + 1e-3);
            expect(laneS.x0).toBeLessThan(1);
            expect(laneS.side).toBe(one.x1 < 0.985 ? 'sun' : 'card');
        }
        expect(trunkBand(fallbackLayout(388, 844), 388 / 844, { seeds: SEEDS }).lanes[1].side).toBe('card');
        expect(ref169().lanes[1].side).toBe('sun');
    });

    it('hands back the cards and the HUD widened by LANE_MARGIN as keep-out rects', () => {
        for (const [W, H] of FRAMES) {
            const layout = fallbackLayout(W, H);
            const band = trunkBand(layout, W / H, { seeds: SEEDS });
            const rects = [...layout.cards, layout.hud].filter(onScreen);
            expect(band.keepOutCount).toBe(rects.length);
            rects.forEach((r, i) => {
                const o = band.keepOut[i];
                expect(o.x0).toBeCloseTo(r.x0 - LANE_MARGIN, 9);
                expect(o.y1).toBeCloseTo(r.y1 + LANE_MARGIN, 9);
            });
        }
    });

    it('fills a result it is handed back without allocating a new one, and gives the same answer twice', () => {
        const out = createBand();
        const { placements } = out;
        const layout = fallbackLayout(1920, 1080);
        const a = trunkBand(layout, 16 / 9, { camY: 92, seeds: SEEDS }, out);
        expect(a).toBe(out);
        expect(a.placements).toBe(placements);
        const first = JSON.stringify(a);
        trunkBand(fallbackLayout(388, 844), 388 / 844, { camY: 20, seeds: SEEDS }, out);
        expect(JSON.stringify(trunkBand(layout, 16 / 9, { camY: 92, seeds: SEEDS }, out))).toBe(first);
        expect(BAND_TRUNKS).toEqual(out.placements.map((p) => p.name));
    });
});

function ref169() {
    return trunkBand(fallbackLayout(1920, 1080), 16 / 9, { camY: 56, seeds: SEEDS });
}
