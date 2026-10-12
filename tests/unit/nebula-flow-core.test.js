/**
 * Nebula Flow — the three-free core: the baked noise and relief, the stage (pillars, the ridge, the
 * cluster) and the CPU twins of the dust's shape, the palettes and their drift, the pieces, and
 * the closed-form lives of births, jets, fronts and the chain's vortex.
 *
 * Relations, not tuning numbers: constants are imported, and the assertions are relations
 * (counted, ordered, bounded, monotonic), so the look can be tuned without touching this file.
 */
import { describe, expect, it } from 'vitest';
import {
    BIRTH_FADE,
    BIRTH_LIFE,
    BIRTH_ROWS,
    BIRTH_SLOTS,
    CONSTELLATION_HOLD,
    CONSTELLATION_MERGE,
    CONSTELLATION_TIGHT,
    FLIGHT,
    FLIGHT_DROP,
    FRONT_LIFE,
    FRONT_SPEED,
    GREAT_FRONT_SPEED,
    HOLE_OPEN,
    IGNITE_FLASH,
    JET_LIFE,
    JET_RUN,
    KIND_AMBIENT,
    KIND_DROP,
    KIND_GREAT,
    KIND_LOCK,
    NEBULA_PALETTES,
    NOISE_SIZE,
    PALETTE_HOME,
    PALETTE_KEYS,
    PALETTE_REST,
    PALETTE_STEP,
    PILLAR_FOOT,
    PILLAR_PLAN,
    PILLAR_ROWS,
    PILLAR_SLOTS,
    RELEASE_FADE,
    SHAPES,
    SHAPE_KEYS,
    bakeNoise,
    bakeRelief,
    birthDone,
    birthLight,
    buildMips,
    cellsFromMatrix,
    clusterFor,
    crestAt,
    dustDistance,
    flightAt,
    flowForCombo,
    frontLight,
    frontRadius,
    holeRadius,
    jetLight,
    jetReach,
    mulberry32,
    nurseryToScreen,
    packPillars,
    paletteAt,
    paletteName,
    palettePhase,
    palettePlace,
    pieceColor,
    pillarAxisAt,
    pillarDistance,
    pillarLayout,
    pillarWidthAt,
    screenToNursery,
    vortexForCombo,
} from '../../src/themes/nebula-flow/nebula-flow-core.js';
import { fallbackLayout } from '../../src/themes/nebula-flow/nebula-flow-composition.js';
import { NEBULA_FLOW_TETROMINOS } from '../../src/themes/nebula-flow/nebula-flow-tetrominos.js';

/** HSV saturation of a linear colour (0 = grey). */
function saturation([r, g, b]) {
    const max = Math.max(r, g, b);
    return max <= 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

/** Pearson correlation and least-squares slope of b on a. */
function fit(a, b) {
    const n = a.length;
    let ma = 0;
    let mb = 0;
    for (let i = 0; i < n; i += 1) {
        ma += a[i];
        mb += b[i];
    }
    ma /= n;
    mb /= n;
    let sab = 0;
    let saa = 0;
    let sbb = 0;
    for (let i = 0; i < n; i += 1) {
        const da = a[i] - ma;
        const db = b[i] - mb;
        sab += da * db;
        saa += da * da;
        sbb += db * db;
    }
    return { r: sab / Math.sqrt(saa * sbb), slope: sab / saa };
}

/** Lowest and highest value of one channel of an RGBA field. */
function channelRange(field, c) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = c; i < field.length; i += 4) {
        lo = Math.min(lo, field[i]);
        hi = Math.max(hi, field[i]);
    }
    return { lo, hi };
}

/**
 * The stage a screen gives the pillars, as the world reads it from the composition: the card's
 * half-width and top, and the stats bar's outer edge (nursery units).
 */
function stageFor(width, height) {
    const aspect = width / height;
    const fb = fallbackLayout(aspect * 1000, 1000);
    const card = fb.cards[0];
    return {
        aspect,
        cardHalf: (card.x1 - card.x0) * aspect,
        cardTop: 1 - card.y0 * 2,
        hudRight: fb.hud ? (fb.hud.x1 * 2 - 1) * aspect : null,
    };
}

/**
 * A phone's own card (the stylesheet's mobile sizing: board = min(clamp(280, 80vw, 350),
 * (100vh − 250) / 2), card ≈ 1.19·board wide and 2·board + 158 tall, centred): it fills the width.
 */
function phoneStage(width = 390, height = 844) {
    const aspect = width / height;
    const board = Math.min(Math.max(280, Math.min(0.8 * width, 350)), (height - 250) / 2);
    const cardW = (1.19 * board) / width;
    const cardY0 = (height / 2 - (2 * board + 158) / 2) / height;
    return {
        aspect, cardHalf: cardW * aspect, cardTop: 1 - cardY0 * 2, hudRight: null,
    };
}

const WIDE = {
    '16:9': stageFor(1600, 900),
    '21:9': stageFor(2100, 900),
    '4:3': stageFor(1200, 900),
    '1:1': stageFor(1000, 1000),
    phone: stageFor(390, 844),
};
const layoutOf = (s) => pillarLayout(s.aspect, s.cardHalf, s.cardTop, s.hudRight);
const byName = (pillars) => Object.fromEntries(pillars.map((p) => [p.name, p]));
const tallestOn = (pillars, side) => pillars.filter((p) => p.side === side).reduce((a, b) => (b.top > a.top ? b : a));

describe('Nebula Flow core: the baked noise', () => {
    it('draws the same numbers from the same seed, in [0, 1)', () => {
        const a = mulberry32(42);
        const b = mulberry32(42);
        const c = mulberry32(43);
        const seqA = Array.from({ length: 200 }, a);
        const seqB = Array.from({ length: 200 }, b);
        const seqC = Array.from({ length: 200 }, c);
        expect(seqA).toEqual(seqB);
        expect(seqC).not.toEqual(seqA);
        seqA.forEach((v) => {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        });
        // A seed is a 32-bit integer.
        expect(mulberry32(42 + 2 ** 32)()).toBe(mulberry32(42)());
    });

    it('bakes four channels the same way twice, each stretched to fill [0, 1]', () => {
        const a = bakeNoise(7, 64);
        expect(a).toHaveLength(64 * 64 * 4);
        expect(bakeNoise(7, 64)).toEqual(a);
        expect(bakeNoise(8, 64)).not.toEqual(a);
        for (let c = 0; c < 4; c += 1) {
            const { lo, hi } = channelRange(a, c);
            expect(lo, `channel ${c}`).toBeCloseTo(0, 6);
            expect(hi, `channel ${c}`).toBeCloseTo(1, 6);
        }
        // The four channels are four different fields.
        const r = [];
        const g = [];
        const b = [];
        const w = [];
        for (let i = 0; i < a.length; i += 4) {
            r.push(a[i]);
            g.push(a[i + 1]);
            b.push(a[i + 2]);
            w.push(a[i + 3]);
        }
        expect(Math.abs(fit(r, b).r)).toBeLessThan(0.9);
        expect(Math.abs(fit(r, w).r)).toBeLessThan(0.9);
        expect(Math.abs(fit(g, w).r)).toBeLessThan(0.9);
    });

    it('bakes the full-size field by default, and it tiles: the seam is no step at all', () => {
        const n = NOISE_SIZE;
        const field = bakeNoise();
        expect(field).toHaveLength(n * n * 4);
        for (let c = 0; c < 4; c += 1) {
            let inner = 0;
            let seam = 0;
            for (let y = 0; y < n; y += 1) {
                for (let x = 0; x < n - 1; x += 1) {
                    inner = Math.max(inner, Math.abs(field[(y * n + x + 1) * 4 + c] - field[(y * n + x) * 4 + c]));
                }
                seam = Math.max(seam, Math.abs(field[(y * n) * 4 + c] - field[(y * n + n - 1) * 4 + c]));
            }
            expect(seam, `channel ${c}`).toBeLessThanOrEqual(inner);
        }
    });

    it('bakes the relief\'s height in [0, 1] with its exact gradient in G and B', () => {
        const n = NOISE_SIZE;
        const relief = bakeRelief();
        expect(relief).toHaveLength(n * n * 4);
        expect(bakeRelief(9127, 64)).toEqual(bakeRelief(9127, 64));
        expect(bakeRelief(1, 64)).not.toEqual(bakeRelief(9127, 64));
        [0, 3].forEach((c) => {
            const { lo, hi } = channelRange(relief, c);
            expect(lo, `channel ${c}`).toBeCloseTo(0, 6);
            expect(hi, `channel ${c}`).toBeCloseTo(1, 6);
        });
        // The gradient is per unit of texture coordinate (one tile = 1): a five-point finite
        // difference of the (periodic) height agrees with it everywhere.
        const R = (x, y) => relief[((((y % n) + n) % n) * n + (((x % n) + n) % n)) * 4];
        const h = 1 / n;
        const dx = [];
        const dy = [];
        const gx = [];
        const gy = [];
        for (let y = 0; y < n; y += 1) {
            for (let x = 0; x < n; x += 1) {
                const i = (y * n + x) * 4;
                gx.push(relief[i + 1]);
                gy.push(relief[i + 2]);
                dx.push((-R(x + 2, y) + 8 * R(x + 1, y) - 8 * R(x - 1, y) + R(x - 2, y)) / (12 * h));
                dy.push((-R(x, y + 2) + 8 * R(x, y + 1) - 8 * R(x, y - 1) + R(x, y - 2)) / (12 * h));
            }
        }
        const fx = fit(dx, gx);
        const fy = fit(dy, gy);
        expect(fx.r).toBeGreaterThan(0.99);
        expect(fy.r).toBeGreaterThan(0.99);
        expect(fx.slope).toBeCloseTo(1, 1);
        expect(fy.slope).toBeCloseTo(1, 1);
        // The second height (A) is its own field, not the first again.
        const first = [];
        const second = [];
        for (let i = 0; i < relief.length; i += 4) {
            first.push(relief[i]);
            second.push(relief[i + 3]);
        }
        expect(Math.abs(fit(first, second).r)).toBeLessThan(0.9);
    });

    it('box-filters a mip chain down to one texel, keeping the mean', () => {
        const size = 64;
        const field = bakeNoise(11, size);
        const levels = buildMips(field, size);
        expect(levels).toHaveLength(Math.log2(size) + 1);
        expect(levels[0].data).toBe(field);
        levels.forEach((level, i) => {
            const w = size >> i;
            expect(level.width).toBe(w);
            expect(level.height).toBe(w);
            expect(level.data).toHaveLength(w * w * 4);
        });
        const last = levels[levels.length - 1].data;
        for (let c = 0; c < 4; c += 1) {
            let mean = 0;
            for (let i = c; i < field.length; i += 4) mean += field[i];
            mean /= size * size;
            expect(last[c]).toBeCloseTo(mean, 5);
        }
    });
});

describe('Nebula Flow core: the stage', () => {
    it('stands two pillars on each side of the card, feet on their own side, below the frame in the ridge', () => {
        expect(PILLAR_SLOTS).toBe(PILLAR_PLAN.length);
        expect(PILLAR_FOOT).toBeLessThan(-1);
        [...Object.entries(WIDE), ['phone card', phoneStage()]].forEach(([name, stage]) => {
            const pillars = layoutOf(stage);
            expect(pillars, name).toHaveLength(PILLAR_SLOTS);
            expect(pillars.map((p) => p.name), name).toEqual(PILLAR_PLAN.map((p) => p.name));
            expect(pillars.filter((p) => p.side < 0), name).toHaveLength(2);
            expect(pillars.filter((p) => p.side > 0), name).toHaveLength(2);
            pillars.forEach((p) => {
                expect(Math.sign(p.x0), `${name} ${p.name}`).toBe(p.side);
                expect(Math.abs(p.x0), `${name} ${p.name}`).toBeGreaterThan(stage.cardHalf);
                expect(p.y0, `${name} ${p.name}`).toBe(PILLAR_FOOT);
                expect(p.y0, `${name} ${p.name}`).toBeLessThan(crestAt(p.x0));
                // the head never leans away from the card, and is narrower than the foot
                expect(-p.side * p.lean, `${name} ${p.name}`).toBeGreaterThanOrEqual(0);
                expect(p.w1, `${name} ${p.name}`).toBeLessThan(p.w0);
                expect(p.w1, `${name} ${p.name}`).toBeGreaterThan(0);
                expect(p.top, `${name} ${p.name}`).toBeGreaterThan(crestAt(p.x0 + p.lean));
            });
        });
    });

    it('keeps every pillar in the frame: whole on a screen with room, its head showing always', () => {
        Object.entries(WIDE).forEach(([name, stage]) => {
            layoutOf(stage).forEach((p) => {
                expect(Math.abs(p.x0), `${name} ${p.name}`).toBeLessThan(stage.aspect);
                expect(Math.abs(pillarAxisAt(p, 1)[0]), `${name} ${p.name}`).toBeLessThan(stage.aspect);
            });
            // on a wide screen every head leans in toward the card
            if (stage.aspect > 1.2) layoutOf(stage).forEach((p) => expect(p.lean * p.side, p.name).toBeLessThan(0));
        });
        [...Object.entries(WIDE), ['phone card', phoneStage()]].forEach(([name, stage]) => {
            layoutOf(stage).forEach((p) => {
                // the inner flank of the head is on screen, below the frame's top
                const [hx] = pillarAxisAt(p, 1);
                expect(Math.abs(hx) - p.w1, `${name} ${p.name}`).toBeLessThan(stage.aspect);
                expect(p.top, `${name} ${p.name}`).toBeLessThan(1);
            });
        });
    });

    it('stands the right pillars clear of the stats bar when there is room, and ignores a bar with none', () => {
        ['16:9', '21:9', '4:3'].forEach((name) => {
            const stage = WIDE[name];
            expect(stage.hudRight, name).toBeGreaterThan(stage.cardHalf);
            layoutOf(stage).filter((p) => p.side > 0).forEach((p) => {
                expect(p.x0, `${name} ${p.name}`).toBeGreaterThan(stage.hudRight);
            });
            // the bar moves only the right side
            const bare = pillarLayout(stage.aspect, stage.cardHalf, stage.cardTop, null);
            const withBar = layoutOf(stage);
            withBar.filter((p) => p.side < 0).forEach((p, i) => {
                expect(p).toEqual(bare.filter((q) => q.side < 0)[i]);
            });
            withBar.filter((p) => p.side > 0).forEach((p, i) => {
                expect(p.x0, `${name} ${p.name}`).toBeGreaterThan(bare.filter((q) => q.side > 0)[i].x0);
            });
        });
        // A bar against the frame's edge leaves no room beyond it: the pillars stand by the card.
        const s = WIDE['16:9'];
        const squeezed = pillarLayout(s.aspect, s.cardHalf, s.cardTop, s.aspect - 0.05);
        expect(squeezed).toEqual(pillarLayout(s.aspect, s.cardHalf, s.cardTop, null));
    });

    it('lifts the heads above the top of a phone\'s card that fills the width', () => {
        const stage = phoneStage();
        expect(stage.cardHalf).toBeGreaterThan(stage.aspect * 0.85);
        const phone = layoutOf(stage);
        [-1, 1].forEach((side) => {
            const tall = tallestOn(phone, side);
            expect(tall.top, `side ${side}`).toBeGreaterThan(stage.cardTop);
            expect(tall.top, `side ${side}`).toBeLessThan(1);
        });
        // Every head stands higher than it does beside a card on a wide screen.
        const wide = byName(layoutOf(WIDE['16:9']));
        phone.forEach((p) => expect(p.top, p.name).toBeGreaterThan(wide[p.name].top));
    });

    it('thins the pillars as their side narrows', () => {
        const order = ['phone', '4:3', '16:9', '21:9'].map((name) => byName(layoutOf(WIDE[name])));
        PILLAR_PLAN.forEach(({ name }) => {
            for (let i = 1; i < order.length; i += 1) {
                expect(order[i][name].w0, name).toBeGreaterThanOrEqual(order[i - 1][name].w0);
                expect(order[i][name].w1, name).toBeGreaterThanOrEqual(order[i - 1][name].w1);
            }
            expect(order[0][name].w0, name).toBeLessThan(order[2][name].w0);
            expect(order[0][name].w0, name).toBeGreaterThan(0);
        });
    });

    it('lays out a 16:9 stage when the aspect or the card is junk', () => {
        [pillarLayout(Number.NaN, Number.NaN), pillarLayout(undefined, 'wide', undefined, Number.NaN)].forEach((pillars) => {
            expect(pillars).toHaveLength(PILLAR_SLOTS);
            pillars.forEach((p) => {
                ['x0', 'y0', 'top', 'lean', 'w0', 'w1', 'depth', 'seed'].forEach((key) => {
                    expect(Number.isFinite(p[key]), `${p.name}.${key}`).toBe(true);
                });
                expect(Math.abs(p.x0), p.name).toBeLessThan(16 / 9);
            });
        });
    });

    it('packs the pillars into rows for the shader, their capsules laid out once, empty slots dormant', () => {
        const pillars = layoutOf(WIDE['16:9']);
        const rows = Array.from({ length: PILLAR_SLOTS * PILLAR_ROWS }, () => ({
            x: 9, y: 9, z: 9, w: 9,
        }));
        expect(packPillars(pillars, rows)).toBe(rows);
        pillars.forEach((p, i) => {
            expect(rows[i * PILLAR_ROWS]).toEqual({
                x: p.x0, y: p.y0, z: p.top, w: p.lean,
            });
            expect(rows[i * PILLAR_ROWS + 1]).toEqual({
                x: p.w0, y: p.w1, z: p.depth, w: p.seed,
            });
        });
        // the capsules the shader reads give pillarDistance's distance (twin check of the packed rows)
        const taper = (x, y, r1, r2, h, ca, cb) => {
            const px = Math.abs(x);
            const k = -cb * px + ca * y;
            if (k < 0) return Math.hypot(px, y) - r1;
            if (k > ca * h) return Math.hypot(px, y - h) - r2;
            return px * ca + y * cb - r1;
        };
        const smin = (da, db, k) => {
            const hh = Math.max(k - Math.abs(da - db), 0) / k;
            return Math.min(da, db) - hh * hh * k * 0.25;
        };
        const fromRows = (i, x, y) => {
            const [one, two] = [2, 4].map((row) => {
                const at = rows[i * PILLAR_ROWS + row];
                const k = rows[i * PILLAR_ROWS + row + 1];
                const rx = x - at.x;
                const ry = y - at.y;
                return taper(rx * at.w - ry * at.z, rx * at.z + ry * at.w, k.x, k.x - k.z * k.y, k.y, k.w, k.z);
            });
            return smin(one, two, 0.05);
        };
        pillars.forEach((p, i) => {
            for (let s = 0; s < 40; s += 1) {
                const x = p.x0 + Math.sin(s * 2.1) * 0.5;
                const y = -1 + (s / 40) * 2.2;
                expect(fromRows(i, x, y), `${p.name} at ${x.toFixed(2)}, ${y.toFixed(2)}`).toBeCloseTo(pillarDistance(p, x, y), 9);
            }
        });
        // Fewer pillars than slots: the rest stand far below the frame with no width.
        packPillars(pillars.slice(0, 1), rows);
        for (let i = 1; i < PILLAR_SLOTS; i += 1) {
            expect(rows[i * PILLAR_ROWS].z).toBeLessThan(PILLAR_FOOT);
            expect(rows[i * PILLAR_ROWS + 1].x).toBe(0);
        }
    });

    it('measures the dust: inside along every pillar\'s axis and under the ridge, outside in the cavity', () => {
        Object.entries(WIDE).forEach(([name, stage]) => {
            const pillars = layoutOf(stage);
            pillars.forEach((p) => {
                for (let h = 0.05; h <= 0.95; h += 0.1) {
                    const [x, y] = pillarAxisAt(p, h);
                    expect(pillarDistance(p, x, y), `${name} ${p.name} ${h}`).toBeLessThan(0);
                    expect(dustDistance(pillars, x, y), `${name} ${p.name} ${h}`).toBeLessThan(0);
                    // a little inside its half-width it is still dust
                    const w = pillarWidthAt(p, h) * 0.5;
                    expect(pillarDistance(p, x + w, y), `${name} ${p.name} ${h}`).toBeLessThan(0);
                    expect(pillarDistance(p, x - w, y), `${name} ${p.name} ${h}`).toBeLessThan(0);
                }
                // above the crown is open gas
                const [hx] = pillarAxisAt(p, 1);
                expect(pillarDistance(p, hx, p.top + 0.05), `${name} ${p.name}`).toBeGreaterThan(0);
                // the distance grows away from the pillar
                expect(pillarDistance(p, hx, p.top + 0.3)).toBeGreaterThan(pillarDistance(p, hx, p.top + 0.05));
            });
            // the cavity round the board and up to the cluster is open
            const cluster = clusterFor(stage.aspect);
            expect(dustDistance(pillars, 0, 0), name).toBeGreaterThan(0);
            expect(dustDistance(pillars, 0, 0.6), name).toBeGreaterThan(0);
            expect(dustDistance(pillars, cluster.x, cluster.y), name).toBeGreaterThan(0);
            // the ridge closes the foot of the frame
            for (let x = -stage.aspect; x <= stage.aspect; x += 0.2) {
                expect(dustDistance(pillars, x, crestAt(x) - 0.08), `${name} ${x}`).toBeLessThan(0);
            }
        });
    });

    it('runs the ridge\'s crest along the foot of the frame, unbroken and uneven', () => {
        const xs = Array.from({ length: 601 }, (_, i) => -3 + i * 0.01);
        const crest = xs.map(crestAt);
        expect(Math.min(...crest)).toBeGreaterThan(-1);
        expect(Math.max(...crest)).toBeLessThan(-0.5);
        expect(Math.max(...crest) - Math.min(...crest)).toBeGreaterThan(0.05);
        for (let i = 1; i < crest.length; i += 1) expect(Math.abs(crest[i] - crest[i - 1])).toBeLessThan(0.01);
    });

    it('hangs the cluster above the frame, over the board, higher on a wide screen', () => {
        [0.3, 0.46, 1, 4 / 3, 16 / 9, 21 / 9, 3].forEach((aspect) => {
            const c = clusterFor(aspect);
            expect(c.y, `${aspect}`).toBeGreaterThan(1);
            expect(Math.abs(c.x), `${aspect}`).toBeLessThan(aspect * 0.1);
        });
        expect(clusterFor(21 / 9).y).toBeGreaterThanOrEqual(clusterFor(0.46).y);
        expect(clusterFor(Number.NaN)).toEqual(clusterFor(16 / 9));
    });

    it('maps screen fractions to nursery space and back', () => {
        [0.46, 1, 16 / 9, 21 / 9].forEach((aspect) => {
            expect(screenToNursery(0, 0, aspect)).toEqual([-aspect, 1]);
            expect(screenToNursery(1, 1, aspect)).toEqual([aspect, -1]);
            expect(screenToNursery(0.5, 0.5, aspect)).toEqual([0, 0]);
            [[0.1, 0.2], [0.73, 0.91], [0.5, 0.05]].forEach(([sx, sy]) => {
                const [x, y] = screenToNursery(sx, sy, aspect);
                const back = nurseryToScreen(x, y, aspect);
                expect(back.x).toBeCloseTo(sx, 12);
                expect(back.y).toBeCloseTo(sy, 12);
            });
        });
        // Reusable outputs.
        const out = [0, 0];
        expect(screenToNursery(0.25, 0.75, 2, out)).toBe(out);
        const pt = { x: 0, y: 0 };
        expect(nurseryToScreen(1, 1, 2, pt)).toBe(pt);
    });
});

describe('Nebula Flow core: the palettes', () => {
    it('has six named filter sets with every key, in scene-linear colour', () => {
        expect(NEBULA_PALETTES).toHaveLength(6);
        expect(new Set(NEBULA_PALETTES.map((p) => p.name)).size).toBe(6);
        NEBULA_PALETTES.forEach((palette) => {
            PALETTE_KEYS.forEach((key) => {
                expect(palette[key], `${palette.name}.${key}`).toHaveLength(3);
                palette[key].forEach((c) => {
                    expect(c, `${palette.name}.${key}`).toBeGreaterThanOrEqual(0);
                    expect(c, `${palette.name}.${key}`).toBeLessThanOrEqual(1);
                });
            });
            expect(palette.prism).toBeGreaterThanOrEqual(0);
            expect(palette.prism).toBeLessThanOrEqual(1);
            // the deep is darker than the cavity's glow, and the dust's shadow darker than its lit rim
            expect(Math.max(...palette.deepHigh), palette.name).toBeLessThan(Math.max(...palette.cavityNear));
            expect(Math.max(...palette.dustDark), palette.name).toBeLessThan(Math.max(...palette.dustLit));
        });
    });

    it('opens level one on the Webb palette', () => {
        expect(NEBULA_PALETTES[PALETTE_HOME].name).toBe('webb');
        expect(paletteName(palettePlace(0, 0))).toBe('webb');
        expect(palettePhase(0)).toMatchObject({ index: PALETTE_HOME, mix: 0 });
        const out = paletteAt(0);
        PALETTE_KEYS.forEach((key) => expect(out[key], key).toEqual([...NEBULA_PALETTES[PALETTE_HOME][key]]));
        expect(out.prism).toBe(NEBULA_PALETTES[PALETTE_HOME].prism);
    });

    it('walks the line there and back between neighbours, never wrapping round', () => {
        const last = NEBULA_PALETTES.length - 1;
        const indexOf = (place) => NEBULA_PALETTES.findIndex((p) => p.name === paletteName(place));
        const seen = new Set();
        for (let place = -30; place < 30; place += 1) {
            const step = Math.abs(indexOf(place + 1) - indexOf(place));
            expect(step, `${place}→${place + 1}`).toBe(1);
            seen.add(indexOf(place));
        }
        expect(seen.size).toBe(NEBULA_PALETTES.length);
        // The far end turns back, and so does the near end.
        const toEnd = last - PALETTE_HOME;
        expect(paletteName(toEnd)).toBe(NEBULA_PALETTES[last].name);
        expect(paletteName(toEnd + 1)).toBe(NEBULA_PALETTES[last - 1].name);
        expect(paletteName(-PALETTE_HOME)).toBe(NEBULA_PALETTES[0].name);
        expect(paletteName(-PALETTE_HOME - 1)).toBe(NEBULA_PALETTES[1].name);
    });

    it('rests on each palette for a moment, at home and at both ends of the line', () => {
        expect(PALETTE_REST).toBeGreaterThan(0);
        expect(PALETTE_REST).toBeLessThan(0.5);
        expect(palettePhase(PALETTE_REST * 0.9).mix).toBe(0);
        expect(palettePhase(0.5).mix).toBeCloseTo(0.5, 6);
        expect(palettePhase(1 - PALETTE_REST * 0.9).mix).toBe(1);
        const last = NEBULA_PALETTES.length - 1;
        [[last - PALETTE_HOME, last], [-PALETTE_HOME, 0], [0, PALETTE_HOME]].forEach(([place, index]) => {
            [-PALETTE_REST * 0.9, 0, PALETTE_REST * 0.9].forEach((d) => {
                const out = paletteAt(place + d);
                PALETTE_KEYS.forEach((key) => {
                    for (let c = 0; c < 3; c += 1) {
                        expect(out[key][c], `${place + d} ${key}`).toBeCloseTo(NEBULA_PALETTES[index][key][c], 12);
                    }
                });
            });
        });
    });

    it('never mixes two neighbours into grey: half-way, the cavity and the lit dust keep their colour', () => {
        for (let i = 0; i < NEBULA_PALETTES.length - 1; i += 1) {
            const from = NEBULA_PALETTES[i];
            const to = NEBULA_PALETTES[i + 1];
            const place = i + 0.5 - PALETTE_HOME;
            expect(palettePhase(place)).toMatchObject({ index: i, next: i + 1 });
            expect(palettePhase(place).mix).toBeCloseTo(0.5, 6);
            const out = paletteAt(place);
            ['cavityNear', 'dustLit'].forEach((key) => {
                const floor = Math.min(saturation(from[key]), saturation(to[key])) * 0.75;
                expect(saturation(out[key]), `${from.name}→${to.name} ${key}`).toBeGreaterThan(Math.max(0.25, floor));
            });
            // every key is the plain average half-way
            PALETTE_KEYS.forEach((key) => {
                for (let c = 0; c < 3; c += 1) {
                    expect(out[key][c]).toBeCloseTo((from[key][c] + to[key][c]) / 2, 9);
                }
            });
            expect(out.prism).toBeCloseTo((from.prism + to.prism) / 2, 9);
        }
    });

    it('fills and reuses the object it is given', () => {
        const out = {};
        expect(paletteAt(0.3, out)).toBe(out);
        const cavity = out.cavityNear;
        paletteAt(1.7, out);
        expect(out.cavityNear).toBe(cavity);
    });

    it('adds the clock to the level: the sky drifts on its own, and a level is one whole step', () => {
        expect(palettePlace(0, 0)).toBe(0);
        expect(palettePlace(3, 0)).toBe(3);
        expect(palettePlace(0, PALETTE_STEP)).toBeCloseTo(1, 12);
        expect(palettePlace(1, 30)).toBeCloseTo(palettePlace(0, 30 + PALETTE_STEP), 12);
        // a clock before the start does not run backwards
        expect(palettePlace(2, -50)).toBe(2);
        // within the first minute of a level the sky has moved, and a step later it stands on the next palette
        const start = paletteAt(palettePlace(0, 0), {});
        const minute = paletteAt(palettePlace(0, PALETTE_STEP * 0.66), {});
        expect(minute.cavityNear).not.toEqual(start.cavityNear);
        expect(paletteName(palettePlace(0, PALETTE_STEP))).toBe(NEBULA_PALETTES[PALETTE_HOME + 1].name);
        // it is on its way most of the time: the rests are short
        let moving = 0;
        for (let t = 0; t < PALETTE_STEP; t += 1) {
            const { mix } = palettePhase(palettePlace(0, t));
            if (mix > 0 && mix < 1) moving += 1;
        }
        expect(moving / PALETTE_STEP).toBeGreaterThan(0.6);
    });
});

describe('Nebula Flow core: the pieces', () => {
    it('gives each piece its own colour as light: peak 1, never black, hue kept', () => {
        Object.entries(NEBULA_FLOW_TETROMINOS.colors).forEach(([key, hex]) => {
            const rgb = pieceColor(hex);
            expect(rgb, key).toHaveLength(3);
            expect(Math.max(...rgb), key).toBeCloseTo(1, 6);
            expect(Math.min(...rgb), key).toBeGreaterThan(0);
            // the channels keep the order the piece's own colour has
            const n = Number.parseInt(hex.slice(1), 16);
            const src = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
            for (let a = 0; a < 3; a += 1) {
                for (let b = 0; b < 3; b += 1) {
                    if (src[a] > src[b]) expect(rgb[a], `${key} ${a}>${b}`).toBeGreaterThan(rgb[b]);
                }
            }
        });
        // even black is light
        pieceColor(0x000000).forEach((c) => expect(c).toBeGreaterThan(0));
    });

    it('reads a colour as a hex string or a number, and falls back on anything else', () => {
        const hex = NEBULA_FLOW_TETROMINOS.colors.T;
        const n = Number.parseInt(hex.slice(1), 16);
        expect(pieceColor(hex)).toEqual(pieceColor(n));
        expect(pieceColor(hex.slice(1))).toEqual(pieceColor(n));
        expect(pieceColor(` ${hex.toUpperCase()} `)).toEqual(pieceColor(n));
        const fallback = pieceColor(undefined);
        expect(pieceColor('not a colour')).toEqual(fallback);
        expect(pieceColor('#12345')).toEqual(fallback);
        expect(pieceColor(Number.NaN)).toEqual(fallback);
        expect(pieceColor(null)).toEqual(fallback);
        expect(pieceColor({})).toEqual(fallback);
        expect(pieceColor('junk', 0x2be0a0)).toEqual(pieceColor(0x2be0a0));
    });

    it('turns each of the seven shapes into four cells on the half grid, centred on their box', () => {
        expect([...SHAPE_KEYS].sort()).toEqual(['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
        SHAPE_KEYS.forEach((key) => {
            const cells = cellsFromMatrix(SHAPES[key]);
            expect(cells, key).toHaveLength(8);
            const seen = new Set();
            let minX = Infinity;
            let maxX = -Infinity;
            let minY = Infinity;
            let maxY = -Infinity;
            for (let i = 0; i < 8; i += 2) {
                expect(Number.isInteger(cells[i] * 2) && Number.isInteger(cells[i + 1] * 2), key).toBe(true);
                seen.add(`${cells[i]},${cells[i + 1]}`);
                minX = Math.min(minX, cells[i]);
                maxX = Math.max(maxX, cells[i]);
                minY = Math.min(minY, cells[i + 1]);
                maxY = Math.max(maxY, cells[i + 1]);
            }
            expect(seen.size, key).toBe(4);
            expect(minX + maxX, key).toBe(0);
            expect(minY + maxY, key).toBe(0);
        });
    });

    it('keeps a piece the way up it locked (matrix rows run down, cells y up) and refuses junk', () => {
        const j = cellsFromMatrix(SHAPES.J);
        const pairs = [];
        for (let i = 0; i < 8; i += 2) pairs.push([j[i], j[i + 1]]);
        expect(pairs.filter(([, y]) => y > 0)).toEqual([[-1, 0.5]]);
        // a padded matrix (as the game sends rotated pieces) gives the same cells
        expect(cellsFromMatrix([[0, 0, 0], [1, 1, 1], [0, 0, 1]])).toEqual(cellsFromMatrix([[1, 1, 1], [0, 0, 1]]));
        // fewer than four cells still fill all eight numbers (the rest repeat the first)
        const two = cellsFromMatrix([[1, 1]]);
        expect(two).toHaveLength(8);
        expect(two.slice(4)).toEqual(two.slice(0, 2).concat(two.slice(0, 2)));
        [null, undefined, 'T', 7, [], [[0, 0], [0, 0]], [null, 'x']].forEach((junk) => {
            expect(cellsFromMatrix(junk), JSON.stringify(junk)).toBeNull();
        });
    });
});

describe('Nebula Flow core: births, jets and fronts', () => {
    it('keeps its kinds and tables distinct and its timings in order', () => {
        expect(new Set([KIND_LOCK, KIND_DROP, KIND_GREAT, KIND_AMBIENT]).size).toBe(4);
        expect(BIRTH_SLOTS).toBeGreaterThanOrEqual(8);
        expect(BIRTH_ROWS).toBeGreaterThanOrEqual(6);
        expect(FLIGHT_DROP).toBeLessThan(FLIGHT);
        expect(CONSTELLATION_HOLD).toBeLessThan(CONSTELLATION_MERGE);
        expect(CONSTELLATION_TIGHT).toBeGreaterThan(0);
        expect(CONSTELLATION_TIGHT).toBeLessThan(1);
        expect(GREAT_FRONT_SPEED).toBeGreaterThan(FRONT_SPEED);
        expect(BIRTH_FADE).toBeLessThan(BIRTH_LIFE);
    });

    it('flies a spark from the card to its site, never turning back, arriving on time', () => {
        expect(flightAt(0)).toBe(0);
        expect(flightAt(-1)).toBe(0);
        expect(flightAt(FLIGHT)).toBeCloseTo(1, 12);
        expect(flightAt(FLIGHT * 3)).toBeCloseTo(1, 12);
        let last = 0;
        for (let t = FLIGHT / 50; t <= FLIGHT; t += FLIGHT / 50) {
            const s = flightAt(t);
            expect(s).toBeGreaterThan(last);
            last = s;
        }
        // a hard drop's spark arrives sooner, and is ahead all the way
        expect(flightAt(FLIGHT_DROP, FLIGHT_DROP)).toBeCloseTo(1, 12);
        for (let t = 0.05; t < FLIGHT_DROP; t += 0.05) {
            expect(flightAt(t, FLIGHT_DROP)).toBeGreaterThan(flightAt(t));
        }
    });

    it('runs the jets out and lets them burn down', () => {
        expect(jetReach(0)).toBe(0);
        expect(jetReach(-1)).toBe(0);
        let last = 0;
        for (let t = 0.05; t < JET_LIFE; t += 0.05) {
            const r = jetReach(t);
            expect(r).toBeGreaterThan(last);
            expect(r).toBeLessThan(1);
            last = r;
        }
        // most of its length within its run
        expect(jetReach(JET_RUN)).toBeGreaterThan(0.8);
        expect(jetLight(0)).toBe(0);
        expect(jetLight(-0.5)).toBe(0);
        expect(jetLight(JET_LIFE + 0.01)).toBe(0);
        let peak = 0;
        let peakAt = 0;
        for (let t = 0.01; t < JET_LIFE * 0.99; t += 0.01) {
            const l = jetLight(t);
            expect(l).toBeGreaterThan(0);
            expect(l).toBeLessThanOrEqual(1);
            if (l > peak) {
                peak = l;
                peakAt = t;
            }
        }
        expect(peakAt).toBeLessThan(JET_LIFE * 0.4);
        expect(jetLight(JET_LIFE * 0.95)).toBeLessThan(jetLight(JET_LIFE * 0.3));
    });

    it('lights a birth with a flash, then holds it at one until it burns out', () => {
        expect(birthLight(-0.01)).toBe(0);
        expect(birthLight(-5, 1)).toBe(0);
        // the flash is the brightest moment, and it fades
        const flash = birthLight(0);
        expect(flash).toBeGreaterThan(2);
        let last = flash;
        for (let t = IGNITE_FLASH / 4; t < IGNITE_FLASH * 4; t += IGNITE_FLASH / 4) {
            const l = birthLight(t);
            expect(l).toBeLessThan(last);
            last = l;
        }
        // then it is held at one
        expect(birthLight(IGNITE_FLASH * 30)).toBeCloseTo(1, 6);
        expect(birthLight(BIRTH_LIFE * 0.5)).toBeCloseTo(1, 6);
        expect(birthLight(BIRTH_LIFE)).toBeCloseTo(1, 6);
        // a star nobody frees burns out
        expect(birthLight(BIRTH_LIFE + BIRTH_FADE * 0.5)).toBeLessThan(1);
        expect(birthLight(BIRTH_LIFE + BIRTH_FADE + 0.01)).toBeCloseTo(0, 9);
    });

    it('brightens a star a clear frees, then lets it fade below a held star', () => {
        const at = 5;
        // until it is freed, nothing changes
        expect(birthLight(at - 0.1, at)).toBe(birthLight(at - 0.1));
        // freed, it flares
        expect(birthLight(at + 0.05, at)).toBeGreaterThan(birthLight(at + 0.05) * 1.5);
        let last = birthLight(at + 0.05, at);
        for (let since = 0.5; since <= RELEASE_FADE; since += 0.5) {
            const l = birthLight(at + since, at);
            expect(l, `${since}`).toBeLessThanOrEqual(last + 1e-12);
            last = l;
        }
        expect(birthLight(at + RELEASE_FADE, at)).toBeLessThan(birthLight(at + RELEASE_FADE));
        expect(birthLight(at + RELEASE_FADE, at)).toBeGreaterThanOrEqual(0);
    });

    it('boils the dust back round a freed star, then holds the hole', () => {
        expect(holeRadius(0)).toBe(0);
        expect(holeRadius(-1)).toBe(0);
        let last = 0;
        for (let t = HOLE_OPEN / 20; t <= HOLE_OPEN; t += HOLE_OPEN / 20) {
            const r = holeRadius(t);
            expect(r).toBeGreaterThan(last);
            last = r;
        }
        expect(holeRadius(HOLE_OPEN * 3)).toBeCloseTo(holeRadius(HOLE_OPEN), 12);
        expect(holeRadius(HOLE_OPEN, 2)).toBeCloseTo(holeRadius(HOLE_OPEN) * 2, 12);
    });

    it('frees a slot when it is empty or its star is spent, never while it burns', () => {
        expect(birthDone({ power: 0, born: 3, released: -1 }, 3)).toBe(true);
        const held = { power: 1, born: 10, released: -1 };
        expect(birthDone(held, 10 - FLIGHT)).toBe(false); // the spark is still on its way
        expect(birthDone(held, 10 + BIRTH_LIFE)).toBe(false);
        expect(birthDone(held, 10 + BIRTH_LIFE + BIRTH_FADE + 0.01)).toBe(true);
        const freed = { power: 1, born: 10, released: 3 };
        expect(birthDone(freed, 10 + 3 + RELEASE_FADE - 0.01)).toBe(false);
        expect(birthDone(freed, 10 + 3 + RELEASE_FADE + 0.01)).toBe(true);
    });

    it('spreads a front at its speed and fades it as it goes, within its life', () => {
        expect(frontRadius(0)).toBe(0);
        expect(frontRadius(-1)).toBe(0);
        expect(frontRadius(2)).toBeCloseTo(2 * FRONT_SPEED, 12);
        expect(frontRadius(2, GREAT_FRONT_SPEED)).toBeGreaterThan(frontRadius(2));
        expect(frontLight(-0.01)).toBe(0);
        expect(frontLight(FRONT_LIFE + 0.01)).toBe(0);
        for (let t = 0.02; t < FRONT_LIFE; t += 0.02) {
            expect(frontLight(t)).toBeGreaterThan(0);
            expect(frontLight(t)).toBeLessThanOrEqual(1);
        }
        expect(frontLight(FRONT_LIFE * 0.95)).toBeLessThan(frontLight(FRONT_LIFE * 0.3));
        // a longer life is honoured
        expect(frontLight(FRONT_LIFE * 1.2, FRONT_LIFE * 1.3)).toBeGreaterThan(0);
        // a clear's front from the cluster crosses a 16:9 frame to its farthest corner while it still shines
        const aspect = 16 / 9;
        const c = clusterFor(aspect);
        const far = Math.max(Math.hypot(-aspect - c.x, -1 - c.y), Math.hypot(aspect - c.x, -1 - c.y));
        let reach = 0;
        for (let t = 0; t < FRONT_LIFE; t += 0.01) {
            if (frontLight(t) > 0.05) reach = frontRadius(t);
        }
        expect(reach).toBeGreaterThan(far);
    });
});

describe('Nebula Flow core: the chain', () => {
    it('winds the vortex up with the chain from two on, never past its limit', () => {
        [0, 1, -3, Number.NaN, undefined].forEach((n) => expect(vortexForCombo(n), `${n}`).toBe(0));
        expect(vortexForCombo(2)).toBeGreaterThan(0);
        expect(vortexForCombo(2.9)).toBe(vortexForCombo(2));
        let last = 0;
        let rising = 0;
        for (let n = 2; n <= 60; n += 1) {
            const v = vortexForCombo(n);
            expect(v).toBeGreaterThanOrEqual(last);
            if (v > last) rising += 1;
            last = v;
        }
        expect(rising).toBeGreaterThan(4);
        expect(vortexForCombo(1000)).toBe(vortexForCombo(60));
    });

    it('runs the gas faster with the chain, never slower than at rest', () => {
        expect(flowForCombo(0)).toBe(1);
        expect(flowForCombo(1)).toBe(1);
        let last = 1;
        for (let n = 0; n <= 60; n += 1) {
            const f = flowForCombo(n);
            expect(f).toBeGreaterThanOrEqual(1);
            expect(f).toBeGreaterThanOrEqual(last);
            last = f;
        }
        expect(flowForCombo(6)).toBeGreaterThan(flowForCombo(2));
        expect(flowForCombo(1000)).toBe(flowForCombo(60));
    });
});
