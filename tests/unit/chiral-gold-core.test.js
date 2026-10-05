import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    ALLOYS,
    HELIX,
    RIPPLE_REACH,
    STAGE,
    TAU,
    alloyForLevel,
    bandsForCombo,
    heatForCombo,
    helixHeight,
    helixParam,
    linRGB,
    mulberry32,
    ribbonPoint,
    rippleRadius,
    wirePoint,
} from '../../src/themes/chiral-gold/chiral-gold-core.js';
import {
    STUDIO_LIGHTS,
    createNoiseTexture,
    createStudioEquirect,
} from '../../src/themes/chiral-gold/chiral-gold-tsl.js';
import {
    BOARD_GRID,
    PLAYER_SLOTS,
    TOWER_NDC,
    boardFor,
    boardPoint,
    cardFor,
    cardUnion,
    fallbackLayout,
    readLayoutRects,
    towerPlacement,
} from '../../src/themes/chiral-gold/chiral-gold-composition.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/chiral-gold/chiral-gold-quality.js';

describe('Chiral Gold core: the two hands of one form', () => {
    it('makes the left tower the exact mirror image of the right', () => {
        for (let k = 0; k < HELIX.ribbons; k++) {
            for (let i = 0; i <= 20; i++) {
                const s = i / 20;
                const right = ribbonPoint(s, k, 1);
                const left = ribbonPoint(s, k, -1);
                expect(left[0]).toBeCloseTo(-right[0], 12);
                expect(left[1]).toBe(right[1]);
                expect(left[2]).toBe(right[2]);
            }
        }
        const right = wirePoint(0.37, 2, 6, 1);
        const left = wirePoint(0.37, 2, 6, -1);
        expect(left[0]).toBeCloseTo(-right[0], 12);
        expect(left.slice(1)).toEqual(right.slice(1));
    });

    it('winds the wire cage against the ribbons', () => {
        const turned = (point, s) => {
            const a = point(s);
            const b = point(s + 0.002);
            return Math.atan2(b[2], b[0]) - Math.atan2(a[2], a[0]);
        };
        // Sampled where neither curve crosses the atan2 seam.
        const ribbon = turned((s) => ribbonPoint(s, 0, 1), 0.05);
        const wire = turned((s) => wirePoint(s, 0, 6, 1), 0.05);
        expect(Math.sign(ribbon)).toBe(1);
        expect(Math.sign(wire)).toBe(-1);
    });

    it('stands each tower in the water and carries it past the top of the frame', () => {
        expect(helixHeight(0)).toBeLessThan(0);
        // The frame's top edge at the towers' plane.
        const frameTop = STAGE.camera.y + STAGE.camera.z * Math.tan((60 * Math.PI) / 360);
        expect(helixHeight(1)).toBeGreaterThan(frameTop);
        expect(helixParam(helixHeight(0.3))).toBeCloseTo(0.3, 12);
    });

    it('keeps every ribbon clear of the core and inside the wires', () => {
        for (let k = 0; k < HELIX.ribbons; k++) {
            for (let i = 0; i <= 50; i++) {
                const [x, , z] = ribbonPoint(i / 50, k, 1);
                const r = Math.hypot(x, z);
                expect(r).toBeGreaterThan(0.4);
                expect(r).toBeLessThan(HELIX.wireRadius);
            }
        }
    });

    it('heats with the chain, never past white', () => {
        expect(heatForCombo(0)).toBe(0);
        expect(heatForCombo(1)).toBe(0);
        let last = 0;
        for (let n = 2; n <= 30; n++) {
            const h = heatForCombo(n);
            expect(h).toBeGreaterThan(last);
            expect(h).toBeLessThanOrEqual(1);
            last = h;
        }
        expect(heatForCombo(2)).toBeLessThan(0.4);
        expect(heatForCombo(8)).toBeGreaterThan(0.85);
        expect(heatForCombo(NaN)).toBe(0);
    });

    it('opens the great ring one band at a time', () => {
        expect([0, 1, 2, 3, 4, 5, 6, 12].map(bandsForCombo)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    });

    it('grows a water ring out to its reach and no further', () => {
        expect(rippleRadius(-1)).toBe(0);
        expect(rippleRadius(0)).toBe(0);
        let last = 0;
        for (let t = 0.1; t < 12; t += 0.1) {
            const r = rippleRadius(t);
            expect(r).toBeGreaterThan(last);
            expect(r).toBeLessThan(RIPPLE_REACH);
            last = r;
        }
    });

    it('cycles through its alloys, every one a plausible metal', () => {
        expect(alloyForLevel(1)).toBe(ALLOYS[0]);
        expect(alloyForLevel(ALLOYS.length + 1)).toBe(ALLOYS[0]);
        expect(alloyForLevel(2)).toBe(ALLOYS[1]);
        expect(alloyForLevel(0)).toBe(ALLOYS[0]);
        expect(alloyForLevel(undefined)).toBe(ALLOYS[0]);
        expect(new Set(ALLOYS.map((a) => a.name)).size).toBe(ALLOYS.length);
        for (const alloy of ALLOYS) {
            expect(alloy.ribbons).toHaveLength(HELIX.ribbons);
            for (const rgb of [...alloy.ribbons, alloy.glow]) {
                for (const c of rgb) {
                    expect(c).toBeGreaterThan(0.1);
                    expect(c).toBeLessThanOrEqual(1);
                }
                // Gold and its alloys are warm: red never falls below blue.
                expect(rgb[0]).toBeGreaterThanOrEqual(rgb[2]);
            }
        }
    });

    it('reads sRGB hex as scene-linear', () => {
        expect(linRGB('#000000')).toEqual([0, 0, 0]);
        expect(linRGB(0xffffff)).toEqual([1, 1, 1]);
        const [r, g, b] = linRGB('#FFAC33');
        expect(r).toBe(1);
        expect(g).toBeCloseTo(0.413, 2);
        expect(b).toBeCloseTo(0.033, 2);
    });

    it('seeds reproducibly', () => {
        const a = mulberry32(7);
        const b = mulberry32(7);
        const c = mulberry32(8);
        const first = [a(), a(), a()];
        expect([b(), b(), b()]).toEqual(first);
        expect([c(), c(), c()]).not.toEqual(first);
        first.forEach((v) => {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        });
    });
});

describe('Chiral Gold studio: the only light in the hall', () => {
    const studio = createStudioEquirect(512);
    const { data, width, height } = studio.image;
    const texel = (az, el) => {
        // az from +Z round to +X, el up from the horizon, degrees.
        const a = (az * Math.PI) / 180;
        const e = (el * Math.PI) / 180;
        const dx = Math.sin(a) * Math.cos(e);
        const dz = Math.cos(a) * Math.cos(e);
        const u = Math.atan2(dz, dx) / TAU + 0.5;
        const v = e / Math.PI + 0.5;
        const i = Math.min(width - 1, Math.floor(u * width));
        const j = Math.min(height - 1, Math.floor(v * height));
        const o = (j * width + i) * 4;
        return [0, 1, 2].map((c) => THREE.DataUtils.fromHalfFloat(data[o + c]));
    };

    it('bakes an equirectangular HDR map the renderer can prefilter', () => {
        expect(width).toBe(512);
        expect(height).toBe(256);
        expect(data).toBeInstanceOf(Uint16Array);
        expect(studio.type).toBe(THREE.HalfFloatType);
        expect(studio.mapping).toBe(THREE.EquirectangularReflectionMapping);
        expect(studio.colorSpace).toBe(THREE.LinearSRGBColorSpace);
        studio.dispose();
    });

    it('puts every light where its row says, far brighter than the dark between them', () => {
        for (const light of STUDIO_LIGHTS) {
            const [r, g, b] = texel(light.az, light.el);
            expect(r).toBeGreaterThanOrEqual(light.rgb[0] * 0.95);
            expect(g).toBeGreaterThanOrEqual(light.rgb[1] * 0.95);
            expect(b).toBeGreaterThanOrEqual(light.rgb[2] * 0.95);
        }
        // Dark flags: straight down, and behind and below the camera.
        expect(Math.max(...texel(0, -80))).toBeLessThan(0.08);
        expect(Math.max(...texel(180, -45))).toBeLessThan(0.08);
        // Metal reads as metal from contrast: the strips are hundreds of times the dark.
        const strip = STUDIO_LIGHTS.reduce((m, l) => Math.max(m, l.rgb[0]), 0);
        expect(strip / Math.max(...texel(180, -45))).toBeGreaterThan(100);
    });

    it('is the same studio every time', () => {
        const again = createStudioEquirect(512);
        expect(Array.from(again.image.data.slice(0, 4000))).toEqual(Array.from(data.slice(0, 4000)));
        const other = createStudioEquirect(512, 99);
        expect(Array.from(other.image.data)).not.toEqual(Array.from(data));
        again.dispose();
        other.dispose();
    });

    it('bakes a tileable noise texture that spans its whole range in every channel', () => {
        const noise = createNoiseTexture(1, 64);
        const bytes = noise.image.data;
        expect(noise.wrapS).toBe(THREE.RepeatWrapping);
        expect(noise.wrapT).toBe(THREE.RepeatWrapping);
        for (let c = 0; c < 4; c++) {
            let lo = 255;
            let hi = 0;
            for (let i = c; i < bytes.length; i += 4) {
                lo = Math.min(lo, bytes[i]);
                hi = Math.max(hi, bytes[i]);
            }
            expect(lo).toBe(0);
            expect(hi).toBe(255);
        }
        noise.dispose();
    });
});

describe('Chiral Gold composition: the picture is built round the card', () => {
    it('falls back to the stylesheet layout: a centred card with the playfield at its foot', () => {
        const layout = fallbackLayout(1600, 900);
        const [card] = layout.cards;
        expect((card.x0 + card.x1) / 2).toBeCloseTo(0.5, 6);
        expect((card.y0 + card.y1) / 2).toBeCloseTo(0.5, 6);
        const board = layout.boards[0];
        expect(board.x0).toBeGreaterThan(card.x0);
        expect(board.x1).toBeLessThan(card.x1);
        expect(board.y1).toBeLessThan(card.y1);
        expect(board.y0).toBeGreaterThan(card.y0);
        // The playfield is twice as tall as it is wide, in pixels.
        expect(((board.y1 - board.y0) * 900) / ((board.x1 - board.x0) * 1600)).toBeCloseTo(2, 6);
        expect(layout.hud.x0).toBeGreaterThan(card.x1);
        expect(layout.boards).toHaveLength(PLAYER_SLOTS);
    });

    it('maps board columns and rows onto the screen', () => {
        const board = {
            x0: 0.4, y0: 0.2, x1: 0.6, y1: 0.8,
        };
        const head = boardPoint(board, 0, 0, {});
        expect(head.x).toBeCloseTo(0.4, 12);
        expect(head.y).toBeCloseTo(0.2 + 0.6 * (0.5 / BOARD_GRID.rows), 12);
        const foot = boardPoint(board, 1, 19, {});
        expect(foot.x).toBeCloseTo(0.6, 12);
        expect(foot.y).toBeCloseTo(0.8 - 0.6 * (0.5 / BOARD_GRID.rows), 12);
        // Out-of-range input is clamped onto the board.
        expect(boardPoint(board, 4, 99, {})).toEqual(foot);
    });

    it('stands the towers in the margins the cards leave', () => {
        const solo = towerPlacement(cardUnion(fallbackLayout(1600, 900)));
        expect(solo.ndcX).toBeGreaterThan(0.6);
        expect(solo.ndcX).toBeLessThan(0.72);
        // Wider cards push the towers out and squeeze them.
        const wide = towerPlacement({ x0: 0.1, x1: 0.9 });
        expect(wide.ndcX).toBeGreaterThan(solo.ndcX);
        expect(wide.widthNdc).toBeLessThan(solo.widthNdc);
        // Never off the frame, never over the board.
        const full = towerPlacement({ x0: 0.0, x1: 1.0 });
        expect(full.ndcX).toBeLessThanOrEqual(TOWER_NDC.max);
        expect(full.widthNdc).toBeGreaterThanOrEqual(0.1);
        const none = towerPlacement(null);
        expect(none.ndcX).toBeGreaterThanOrEqual(TOWER_NDC.min);
        // An off-centre card is measured by its further edge.
        expect(towerPlacement({ x0: 0.3, x1: 0.9 }).ndcX).toBe(towerPlacement({ x0: 0.1, x1: 0.9 }).ndcX);
    });

    it('finds the card a board sits in, the union otherwise', () => {
        const layout = {
            cards: [{
                x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.9,
            }, {
                x0: 0.6, y0: 0.1, x1: 0.9, y1: 0.9,
            }],
            boards: [null, {
                x0: 0.15, y0: 0.3, x1: 0.35, y1: 0.85,
            }, {
                x0: 0.65, y0: 0.3, x1: 0.85, y1: 0.85,
            }, null, null],
        };
        expect(boardFor(layout, 2)).toBe(layout.boards[2]);
        expect(boardFor(layout, 0)).toBe(layout.boards[1]); // no solo board: the first on screen
        expect(cardFor(layout, layout.boards[2])).toBe(layout.cards[1]);
        expect(cardFor(layout, null)).toEqual({
            x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9,
        });
        expect(cardUnion(null)).toBeNull();
        expect(boardFor(null)).toBeNull();
    });

    it('reads the live rects from the page and ignores what is hidden', () => {
        const rect = (left, top, width, height) => ({
            left, top, width, height, right: left + width, bottom: top + height,
        });
        const el = (r, style = {}) => ({ getBoundingClientRect: () => r, style });
        const card = el(rect(620, 45, 360, 760));
        const lobby = el(rect(0, 0, 0, 0)); // collapsed: not on screen
        const hidden = el(rect(100, 100, 200, 400), { display: 'none' });
        const canvas = el(rect(650, 180, 300, 600));
        const hud = el(rect(1022, 213, 140, 426));
        const doc = {
            querySelectorAll: (selector) => (selector === '.player-card[data-player]' ? [card, lobby, hidden] : []),
            querySelector: (selector) => {
                if (selector === '#phaser-game-container canvas') return canvas;
                if (selector === '.single-player-stats-bar') return hud;
                return null;
            },
        };
        const win = {
            innerWidth: 1600, innerHeight: 852, getComputedStyle: (node) => ({ display: 'block', opacity: '1', ...node.style }),
        };
        const layout = readLayoutRects(doc, win);
        expect(layout.cardCount).toBe(1);
        expect(layout.cards[0].x0).toBeCloseTo(620 / 1600, 12);
        expect(layout.boards[0].y1).toBeCloseTo(780 / 852, 12);
        expect(layout.hud.x1).toBeCloseTo(1162 / 1600, 12);
        expect(readLayoutRects({ querySelectorAll: () => [], querySelector: () => null }, win)).toBeNull();
        expect(readLayoutRects(null, win)).toBeNull();
    });
});

describe('Chiral Gold tiers', () => {
    it('never asks a cheaper tier for more than a dearer one', () => {
        expect(QUALITY_NAMES).toEqual(['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']);
        const growing = ['segments', 'wires', 'beads', 'ringSegments', 'studio', 'reflection', 'motes', 'leaf',
            'ambientLeaf', 'sparks', 'braid', 'burst'];
        for (let i = 1; i < QUALITY_NAMES.length; i++) {
            const cheap = QUALITY[QUALITY_NAMES[i - 1]];
            const dear = QUALITY[QUALITY_NAMES[i]];
            for (const key of growing) expect(dear[key], `${QUALITY_NAMES[i]}.${key}`).toBeGreaterThanOrEqual(cheap[key]);
        }
    });

    it('keeps the second render off phones and the leaf pool larger than what drifts in it', () => {
        expect(QUALITY.Minimal.reflection).toBe(0);
        expect(QUALITY.Low.reflection).toBe(0);
        expect(QUALITY.Medium.reflection).toBeGreaterThan(0);
        for (const name of QUALITY_NAMES) expect(QUALITY[name].leaf).toBeGreaterThan(QUALITY[name].ambientLeaf * 2);
        expect(tierFor('nonsense')).toBe(QUALITY.High);
    });
});
