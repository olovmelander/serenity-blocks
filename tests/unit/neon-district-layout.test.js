import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    CLEAR_DEPTH, CLEAR_TRAVEL, LOCK_REACH, STREET, clearFrontDepth, linRGB, lockShellRadius, mulberry32, wrapZ,
} from '../../src/themes/neon-district/neon-district-core.js';
import {
    GLOW_TEXELS, GLYPH_COUNT, GLYPH_LATIN, MAX_SIGN_GLYPHS, NEON_PALETTE, SIGN_WORDS, buildLayout,
} from '../../src/themes/neon-district/neon-district-layout.js';
import {
    GLYPH_CELL, GLYPH_GRID, bakeGlyphAtlas, glyphSegments,
} from '../../src/themes/neon-district/neon-district-glyphs.js';
import {
    BILLBOARD_ATLAS, BILLBOARD_CELLS, SHOPFRONT_ATLAS, SHOPFRONT_CELLS,
} from '../../src/themes/neon-district/neon-district-atlas.js';
import { KIT_KINDS } from '../../src/themes/neon-district/neon-district-kit.js';
import {
    BRANDS, BRAND_WORDS, CAMPAIGNS, HALE, SHOP_ARCHETYPES, TRADE_SHOPS,
} from '../../src/themes/neon-district/neon-district-campaigns.js';
import { LOGOS, logoIndex } from '../../src/themes/neon-district/neon-district-logos.js';
import { PAINTED_OPENINGS } from '../../src/themes/neon-district/neon-district-openings.js';
import { GLYPH_BLANK, glyphFor } from '../../src/themes/neon-district/neon-district-glyphs.js';
import { encodeLine } from '../../src/themes/neon-district/neon-district-text.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/neon-district/neon-district-quality.js';
import { POST_LOOK } from '../../src/themes/neon-district/neon-district-post.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const L = STREET.period;

describe('neon district core maths', () => {
    it('wraps a scrolled depth into one period that ends behind the camera', () => {
        for (const z of [-1000.5, -L, -1, 0, 23.999, 24, 25, 700]) {
            const w = wrapZ(z);
            expect(w).toBeGreaterThanOrEqual(STREET.wrapMax - L);
            expect(w).toBeLessThan(STREET.wrapMax);
            // Wrapping moves a point by a whole number of periods.
            expect(Math.abs(((z - w) / L) - Math.round((z - w) / L))).toBeLessThan(1e-9);
        }
        expect(wrapZ(-10)).toBe(-10);
        expect(wrapZ(STREET.wrapMax)).toBe(STREET.wrapMax - L);
    });

    it('a clear front starts in the haze and reaches the camera after the travel time', () => {
        expect(clearFrontDepth(0)).toBe(CLEAR_DEPTH);
        expect(clearFrontDepth(CLEAR_TRAVEL)).toBe(0);
        expect(clearFrontDepth(CLEAR_TRAVEL * 3)).toBe(0);
        // It decelerates: the last tenth of the way takes far more than a tenth of the time.
        let previous = CLEAR_DEPTH;
        for (let i = 1; i <= 20; i++) {
            const depth = clearFrontDepth((CLEAR_TRAVEL * i) / 20);
            expect(depth).toBeLessThanOrEqual(previous);
            previous = depth;
        }
        expect(clearFrontDepth(CLEAR_TRAVEL * 0.5)).toBeLessThan(CLEAR_DEPTH * 0.25);
    });

    it('a lock shell grows fast, then settles inside its reach', () => {
        expect(lockShellRadius(-1)).toBe(0);
        expect(lockShellRadius(0)).toBe(0);
        expect(lockShellRadius(0.2)).toBeGreaterThan(LOCK_REACH * 0.3);
        expect(lockShellRadius(60)).toBeLessThanOrEqual(LOCK_REACH);
        expect(lockShellRadius(0.4)).toBeGreaterThan(lockShellRadius(0.2));
    });

    it('converts sRGB hex to scene-linear and seeds a repeatable generator', () => {
        expect(linRGB(0x000000)).toEqual([0, 0, 0]);
        expect(linRGB(0xffffff).every((c) => Math.abs(c - 1) < 1e-9)).toBe(true);
        expect(linRGB(0x808080)[0]).toBeCloseTo(0.2158, 3);
        const a = mulberry32(7);
        const b = mulberry32(7);
        for (let i = 0; i < 50; i++) expect(a()).toBe(b());
    });
});

describe('neon district city plan', () => {
    const plan = buildLayout();

    it('is deterministic for a seed and different for another', () => {
        const again = buildLayout();
        expect(JSON.stringify(again.boxes)).toBe(JSON.stringify(plan.boxes));
        expect(JSON.stringify(again.signs)).toBe(JSON.stringify(plan.signs));
        expect(Array.from(again.glow)).toEqual(Array.from(plan.glow));
        const other = buildLayout(1234);
        expect(JSON.stringify(other.boxes)).not.toBe(JSON.stringify(plan.boxes));
    });

    it('fills one period on each side with blocks that never overlap', () => {
        for (const side of [-1, 1]) {
            const blocks = plan.blocks.filter((b) => b.side === side).sort((a, b) => a.z - b.z);
            expect(blocks.length).toBeGreaterThanOrEqual(10);
            let covered = 0;
            for (let i = 0; i < blocks.length; i++) {
                const b = blocks[i];
                covered += b.len;
                expect(b.z - b.len / 2).toBeGreaterThanOrEqual(-L - 1e-6);
                expect(b.z + b.len / 2).toBeLessThanOrEqual(6 + 1e-6);
                if (i > 0) {
                    const prev = blocks[i - 1];
                    expect(b.z - b.len / 2).toBeGreaterThanOrEqual(prev.z + prev.len / 2 + 2.9);
                }
            }
            // Blocks plus alleys (and the right side's one side street) make exactly one period.
            const gaps = (blocks.length - 1) * 3 + 3 + (side > 0 ? 12 : 0);
            expect(covered + gaps).toBeCloseTo(L, 3);
        }
    });

    it('keeps the street clear: walls behind the kerb line, signs over the pavement', () => {
        for (const box of plan.boxes) {
            expect(Math.abs(box.x) - box.w / 2).toBeGreaterThanOrEqual(STREET.halfStreet - 1e-6);
            expect(box.h).toBeGreaterThan(3);
            expect(Number.isInteger(box.seed)).toBe(true);
        }
        for (const sign of plan.signs) {
            expect(Math.abs(sign.x) + sign.w / 2).toBeLessThanOrEqual(STREET.halfStreet + 5);
            expect(Math.abs(sign.x) - sign.w / 2).toBeGreaterThan(STREET.halfRoad - 2.2);
            expect(sign.y - sign.h / 2).toBeGreaterThan(STREET.plinth);
        }
        for (const mark of plan.marks) {
            expect(Math.abs(mark.x) + mark.w / 2).toBeLessThanOrEqual(STREET.halfStreet);
            expect(mark.y - mark.h / 2).toBeGreaterThan(STREET.plinth);
        }
    });

    it('lines every block with shops that never overlap, each a painting or a whole generated shop', () => {
        expect(plan.shops.length).toBeGreaterThan(40);
        for (const side of [-1, 1]) {
            const shops = plan.shops.filter((s) => s.side === side).sort((a, b) => a.z - b.z);
            for (let i = 1; i < shops.length; i++) {
                expect(shops[i].z - shops[i].w / 2).toBeGreaterThanOrEqual(shops[i - 1].z + shops[i - 1].w / 2 - 1e-6);
            }
        }
        for (const shop of plan.shops) {
            expect(shop.h).toBeLessThanOrEqual(STREET.plinth);
            expect(Number.isInteger(shop.seed)).toBe(true);
            const [u0, v0, u1, v1] = shop.open;
            expect(u0).toBeGreaterThanOrEqual(0);
            expect(v0).toBeGreaterThanOrEqual(0);
            expect(u1).toBeLessThanOrEqual(1);
            expect(v1).toBeLessThanOrEqual(1);
            expect(u1 - u0).toBeGreaterThan(0.2);
            expect(v1 - v0).toBeGreaterThan(0.25);
            expect(shop.recess).toBeGreaterThan(0.2);
            if (shop.kind === 0) {
                expect(SHOPFRONT_CELLS[shop.cell]).toBeTruthy();
                expect(shop.w / shop.h).toBeCloseTo(SHOPFRONT_CELLS[shop.cell].aspect, 6);
            } else {
                expect(shop.kind).toBe(1);
                expect(shop.archetype).toBeGreaterThanOrEqual(0);
                expect(shop.archetype).toBeLessThan(SHOP_ARCHETYPES.length);
                expect(plan.texts[shop.nameRow]).toBe(shop.name);
                // The fascia sits above the opening.
                expect(1 - shop.fascia).toBeGreaterThanOrEqual(v1);
                expect(shop.shutter).toBeGreaterThanOrEqual(0);
                expect(shop.shutter).toBeLessThanOrEqual(1);
                if (shop.brand) expect(shop.shutter).toBe(0);
                if (shop.logo >= 0) expect(LOGOS[shop.logo]).toBeTruthy();
            }
        }
        // Every painting is dealt once a period.
        const painted = plan.shops.filter((s) => s.kind === 0).map((s) => s.cell).sort((a, b) => a - b);
        expect(painted).toEqual(SHOPFRONT_CELLS.map((_, i) => i));
    });

    it('knows where every painted shopfront\'s windows are', () => {
        for (const cell of SHOPFRONT_CELLS) {
            const open = PAINTED_OPENINGS[cell.src];
            expect(open, cell.src).toBeTruthy();
            expect(open[2]).toBeGreaterThan(open[0]);
            expect(open[3]).toBeGreaterThan(open[1]);
        }
    });

    it('gives every brand with a shop a branch on the street, and every brand its campaign', () => {
        const shopsByBrand = new Set(plan.shops.filter((s) => s.brand).map((s) => s.brand));
        for (const brand of [...BRANDS, HALE]) {
            if (brand.shop) expect(shopsByBrand.has(brand.id), brand.id).toBe(true);
            // Its adverts are on the screens or pasted on the walls.
            const shown = plan.screens.some((s) => s.playlist.some((c) => BILLBOARD_CELLS[c].brand === brand.id))
                || plan.prints.some((p) => BILLBOARD_CELLS[p.cell].brand === brand.id);
            expect(shown, brand.id).toBe(true);
        }
        // Travel posters for the other worlds come round too.
        expect(plan.screens.some((s) => s.playlist.some((c) => BILLBOARD_CELLS[c].family === 'transit'))).toBe(true);
        for (const trade of TRADE_SHOPS) expect(plan.shops.some((s) => s.name === trade.name), trade.name).toBe(true);
    });

    it('hangs tube logos the atlas has, under names the text texture holds', () => {
        expect(plan.marks.length).toBeGreaterThan(10);
        for (const mark of plan.marks) {
            expect(LOGOS[mark.logo]).toBeTruthy();
            expect(plan.texts[mark.nameRow].length).toBe(mark.nameLength);
        }
        for (const c of [...BRANDS, HALE, CAMPAIGNS.transit]) expect(logoIndex(c.logo), c.id).toBeGreaterThanOrEqual(0);
    });

    it('spells every line of text with glyphs the atlas has', () => {
        for (const line of plan.texts) {
            expect(line.length).toBeLessThanOrEqual(32);
            const ids = encodeLine(line, 32);
            for (let i = 0; i < line.length; i++) {
                if (line[i] === ' ') expect(ids[i]).toBe(GLYPH_BLANK);
                else expect(ids[i], `${line}[${i}]`).toBeLessThan(GLYPH_COUNT);
            }
        }
        expect(glyphFor('&')).toBeLessThan(GLYPH_COUNT);
        expect(glyphFor('~')).toBe(GLYPH_BLANK);
    });

    it('writes every sign with glyphs the atlas has, and only trade words', () => {
        expect(plan.signs.length).toBeGreaterThan(40);
        let words = 0;
        for (const sign of plan.signs) {
            expect(sign.glyphs.length).toBeGreaterThanOrEqual(1);
            expect(sign.glyphs.length).toBeLessThanOrEqual(MAX_SIGN_GLYPHS);
            for (const g of sign.glyphs) {
                expect(Number.isInteger(g)).toBe(true);
                expect(g).toBeGreaterThanOrEqual(0);
                expect(g).toBeLessThan(GLYPH_COUNT);
            }
            if (sign.glyphs.every((g) => g < GLYPH_LATIN)) {
                const text = sign.glyphs.map((g) => '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'[g]).join('');
                expect([...SIGN_WORDS, ...BRAND_WORDS.map((b) => b.word)]).toContain(text);
                words += 1;
            }
            expect(sign.palette).toBeLessThan(NEON_PALETTE.length);
        }
        expect(words).toBeGreaterThan(8);
    });

    it('gives every screen three different adverts of its own shape, Hale\'s at most once', () => {
        expect(plan.screens.length).toBeGreaterThanOrEqual(6);
        for (const screen of plan.screens) {
            expect(screen.playlist).toHaveLength(3);
            expect(new Set(screen.playlist).size).toBe(3);
            for (const cell of screen.playlist) {
                expect(BILLBOARD_CELLS[cell]).toBeTruthy();
                expect(BILLBOARD_CELLS[cell].shape).toBe(screen.shape);
            }
            expect(screen.playlist.filter((c) => BILLBOARD_CELLS[c].family === 'hale').length).toBeLessThanOrEqual(1);
            expect(screen.w / screen.h).toBeCloseTo({ wide: 16 / 9, portrait: 2 / 3, square: 1 }[screen.shape], 6);
            expect(screen.period).toBeGreaterThan(5);
        }
    });

    it('prints campaigns without a screen\'s breathing ring, and hangs roof boards on scaffolds', () => {
        expect(plan.prints.length).toBeGreaterThan(10);
        for (const print of plan.prints) {
            expect(BILLBOARD_CELLS[print.cell].ring).toBeNull();
            expect(print.tear).toBeGreaterThanOrEqual(0);
            expect(print.tear).toBeLessThan(1);
        }
        const frames = plan.kit.filter((k) => k.kind === 'frame');
        const boards = plan.prints.filter((p) => p.flood);
        expect(boards.length).toBe(frames.length);
        for (const board of boards) {
            expect(frames.some((f) => Math.abs(f.z - board.z) < 1e-9 && Math.sign(f.x) === board.side)).toBe(true);
        }
    });

    it('only places hardware the kit can build, with finite transforms', () => {
        expect(plan.kit.length).toBeGreaterThan(80);
        const used = new Set();
        for (const item of plan.kit) {
            expect(KIT_KINDS).toContain(item.kind);
            used.add(item.kind);
            for (const key of ['x', 'y', 'z', 'yaw', 'sx', 'sy', 'sz']) expect(Number.isFinite(item[key]), `${item.kind}.${key}`).toBe(true);
            expect(item.rgb).toHaveLength(3);
        }
        expect(used.size).toBe(KIT_KINDS.length);
        // Gantries stand at the zebra crossings' stop lines (every 80 m).
        const gantries = plan.kit.filter((item) => item.kind === 'gantry').map((item) => item.z).sort((a, b) => b - a);
        expect(gantries).toHaveLength(4);
        for (let i = 1; i < gantries.length; i++) expect(gantries[i - 1] - gantries[i]).toBeCloseTo(80, 6);
    });

    it('bakes a finite, bounded glow map with light on both walls', () => {
        expect(plan.glow).toHaveLength(GLOW_TEXELS * 2 * 4);
        let leftPeak = 0;
        let rightPeak = 0;
        for (let i = 0; i < GLOW_TEXELS * 2; i++) {
            for (let c = 0; c < 3; c++) {
                const v = plan.glow[i * 4 + c];
                expect(Number.isFinite(v)).toBe(true);
                expect(v).toBeGreaterThanOrEqual(0.02 - 1e-9);
                expect(v).toBeLessThan(3);
                if (i < GLOW_TEXELS) leftPeak = Math.max(leftPeak, v);
                else rightPeak = Math.max(rightPeak, v);
            }
        }
        expect(leftPeak).toBeGreaterThan(0.5);
        expect(rightPeak).toBeGreaterThan(0.5);
    });

    it('stands the megatowers still, far beyond the scrolling street', () => {
        expect(plan.megaBoxes.length).toBeGreaterThanOrEqual(15);
        for (const box of plan.megaBoxes) expect(box.z).toBeLessThan(-L);
        expect(plan.beacons.some((b) => b.scroll === 0)).toBe(true);
    });
});

describe('neon district glyph atlas', () => {
    it('has a stroke list for every cell and draws something in each', () => {
        const glyphs = glyphSegments();
        expect(glyphs).toHaveLength(GLYPH_COUNT);
        expect(GLYPH_GRID * GLYPH_GRID).toBe(GLYPH_COUNT);
        for (const segments of glyphs) {
            expect(segments.length).toBeGreaterThanOrEqual(1);
            for (const [ax, ay, bx, by] of segments) {
                for (const v of [ax, bx]) {
                    expect(v).toBeGreaterThanOrEqual(0);
                    expect(v).toBeLessThanOrEqual(4);
                }
                for (const v of [ay, by]) {
                    expect(v).toBeGreaterThanOrEqual(0);
                    expect(v).toBeLessThanOrEqual(6);
                }
            }
        }
        const { data, size } = bakeGlyphAtlas();
        expect(size).toBe(GLYPH_GRID * GLYPH_CELL);
        expect(data).toHaveLength(size * size);
        for (let g = 0; g < GLYPH_COUNT; g++) {
            const col = g % GLYPH_GRID;
            const row = Math.floor(g / GLYPH_GRID);
            let peak = 0;
            let edge = 0;
            for (let y = 0; y < GLYPH_CELL; y++) {
                for (let x = 0; x < GLYPH_CELL; x++) {
                    const v = data[(row * GLYPH_CELL + y) * size + col * GLYPH_CELL + x];
                    peak = Math.max(peak, v);
                    if (x === 0 || y === 0 || x === GLYPH_CELL - 1 || y === GLYPH_CELL - 1) edge = Math.max(edge, v);
                }
            }
            expect(peak, `glyph ${g} has a stroke`).toBeGreaterThan(240);
            // Strokes stay clear of the cell border, so neighbours never bleed into each other.
            expect(edge, `glyph ${g} stays inside its cell`).toBeLessThan(160);
        }
    });

    it('spells only capitals and digits the atlas holds', () => {
        for (const word of SIGN_WORDS) {
            expect(word).toMatch(/^[0-9A-Z]+$/);
            expect(word.length).toBeLessThanOrEqual(MAX_SIGN_GLYPHS);
        }
    });
});

describe('neon district atlases', () => {
    it('ships the baked atlases the cell table points at', () => {
        for (const atlas of [SHOPFRONT_ATLAS, BILLBOARD_ATLAS]) {
            for (const url of [atlas.url, atlas.halfUrl]) {
                expect(url.startsWith('./textures/neon-district/')).toBe(true); // relative: file:// in Electron
                expect(existsSync(path.join(repoRoot, 'public', url)), url).toBe(true);
            }
        }
    });

    it('files every advert under a campaign and a shape, Hale\'s with room for its ring', () => {
        const families = new Set(BILLBOARD_CELLS.map((c) => c.family));
        expect([...families].sort()).toEqual(['brand', 'hale', 'transit', 'user']);
        for (const cell of BILLBOARD_CELLS) {
            expect(['wide', 'portrait', 'square']).toContain(cell.shape);
            if (cell.family === 'brand') expect(BRANDS.map((b) => b.id)).toContain(cell.brand);
            if (cell.ring) {
                expect(cell.family).toBe('hale');
                expect(cell.motion).toBe('breathe');
            }
        }
        for (const brand of BRANDS) {
            expect(BILLBOARD_CELLS.some((c) => c.brand === brand.id && c.shape === 'wide'), brand.id).toBe(true);
            expect(BILLBOARD_CELLS.some((c) => c.brand === brand.id && c.shape === 'portrait'), brand.id).toBe(true);
        }
        expect(BILLBOARD_CELLS.some((c) => c.family === 'hale' && c.ring)).toBe(true);
    });

    it('keeps every cell inside its atlas with a usable glow colour', () => {
        for (const cells of [SHOPFRONT_CELLS, BILLBOARD_CELLS]) {
            expect(cells.length).toBeGreaterThan(8);
            for (const cell of cells) {
                const [u0, v0, u1, v1] = cell.rect;
                expect(u0).toBeGreaterThanOrEqual(0);
                expect(v0).toBeGreaterThanOrEqual(0);
                expect(u1).toBeLessThanOrEqual(1);
                expect(v1).toBeLessThanOrEqual(1);
                expect(u1).toBeGreaterThan(u0);
                expect(v1).toBeGreaterThan(v0);
                expect(Math.max(...cell.glow)).toBeCloseTo(1, 2);
                expect(cell.aspect).toBeGreaterThan(0.5);
            }
        }
    });
});

describe('neon district tiers', () => {
    it('defines every quality tier for the world and the post', () => {
        expect(QUALITY_NAMES).toEqual(['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']);
        for (const name of QUALITY_NAMES) {
            expect(QUALITY[name]).toBeTruthy();
            expect(POST_LOOK[name]).toBeTruthy();
        }
    });

    it('scales every budget monotonically with the tier', () => {
        for (let i = 1; i < QUALITY_NAMES.length; i++) {
            const a = QUALITY[QUALITY_NAMES[i - 1]];
            const b = QUALITY[QUALITY_NAMES[i]];
            for (const key of ['reflection', 'reflectionTaps', 'rain', 'traffic', 'sparks', 'drones']) {
                expect(b[key], `${QUALITY_NAMES[i]}.${key}`).toBeGreaterThanOrEqual(a[key]);
            }
        }
        // The low tiers pay for no second scene render, no rooms and no bloom.
        for (const name of ['Minimal', 'Low']) {
            expect(QUALITY[name].reflection).toBe(0);
            expect(QUALITY[name].rooms).toBe(false);
            expect(POST_LOOK[name].bloom).toBe(false);
            expect(POST_LOOK[name].msaa).toBe(0);
        }
        expect(QUALITY.Minimal.drones).toBe(0);
        expect(POST_LOOK.High.bloom).toBe(true);
    });
});
