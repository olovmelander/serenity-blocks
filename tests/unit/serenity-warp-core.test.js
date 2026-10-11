/**
 * Serenity Warp — the three-free core: palettes and their drift, the run every piece of glass
 * makes to the gate, the shapes and how they are packed for the shader, the CPU twin of the
 * glass's trace, waves and the jump. Relations, not tuning numbers: constants are imported.
 */
import { describe, expect, it } from 'vitest';
import {
    CELL,
    DIVE_DRIFT,
    DIVE_LOCK,
    GATE,
    JUMP_EXIT,
    JUMP_OPEN,
    JUMP_TUNNEL,
    PALETTE_HOME,
    PALETTE_KEYS,
    PALETTE_REST,
    PALETTE_STEP,
    SHAPES,
    SHAPE_KEYS,
    SKY_PALETTES,
    WARP_CHAIN,
    WAVE_LIFE,
    cellsFromMatrix,
    currentFor,
    gateAnchors,
    jumpPhase,
    jumpRadius,
    packCell,
    packCells,
    paletteAt,
    paletteName,
    palettePhase,
    palettePlace,
    pathAt,
    pieceColor,
    placeToWorld,
    quatAxis,
    quatMul,
    quatRotate,
    unionExit,
    unpackCell,
    warpForCombo,
    waveAngle,
    waveLight,
    worldToPlace,
} from '../../src/themes/serenity-warp/serenity-warp-core.js';
import { envDir, envUv } from '../../src/themes/serenity-warp/serenity-warp-tsl.js';
import { SERENITY_WARP_TETROMINOS } from '../../src/themes/serenity-warp/serenity-warp-tetrominos.js';

const DEG = Math.PI / 180;

/** Hue (degrees) and saturation of a linear colour. */
function hueSat([r, g, b]) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d < 1e-6) return { hue: 0, sat: 0 };
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { hue: (h * 60 + 360) % 360, sat: d / max };
}
const hueGap = (a, b) => {
    const d = Math.abs(a - b) % 360;
    return Math.min(d, 360 - d);
};

describe('Serenity Warp palettes', () => {
    it('has six palettes with every key, in scene-linear colour', () => {
        expect(SKY_PALETTES).toHaveLength(6);
        for (const palette of SKY_PALETTES) {
            for (const key of PALETTE_KEYS) {
                expect(palette[key], `${palette.name}.${key}`).toHaveLength(3);
                for (const c of palette[key]) {
                    expect(c).toBeGreaterThanOrEqual(0);
                    expect(c).toBeLessThanOrEqual(1);
                }
            }
        }
        expect(new Set(SKY_PALETTES.map((p) => p.name)).size).toBe(6);
    });

    it('starts level one on the serenity palette, blue and violet as the old theme was', () => {
        expect(SKY_PALETTES[PALETTE_HOME].name).toBe('serenity');
        expect(paletteName(palettePlace(0, 0))).toBe('serenity');
        const { hue } = hueSat(SKY_PALETTES[PALETTE_HOME].glow);
        expect(hue).toBeGreaterThan(200);
        expect(hue).toBeLessThan(250);
    });

    it('orders the palettes by the hue of their glow, so a drift never crosses grey', () => {
        const hues = SKY_PALETTES.map((p) => hueSat(p.glow).hue);
        for (let i = 1; i < hues.length; i++) {
            expect(hueGap(hues[i - 1], hues[i]), `${SKY_PALETTES[i - 1].name}→${SKY_PALETTES[i].name}`).toBeLessThan(80);
        }
    });

    it('keeps the two glows of every palette in different colour families', () => {
        for (const p of SKY_PALETTES) {
            expect(hueGap(hueSat(p.glow).hue, hueSat(p.accent).hue), p.name).toBeGreaterThan(60);
        }
    });

    it('never mixes two neighbours into grey: half-way, glow and accent are still two saturated hues', () => {
        for (let i = 0; i < SKY_PALETTES.length - 1; i++) {
            const out = {};
            const place = i + 0.5 - PALETTE_HOME;
            paletteAt(place, out);
            const glow = hueSat(out.glow);
            const accent = hueSat(out.accent);
            expect(glow.sat, `glow ${i}`).toBeGreaterThan(0.5);
            expect(accent.sat, `accent ${i}`).toBeGreaterThan(0.45);
            expect(hueGap(glow.hue, accent.hue), `pair ${i}`).toBeGreaterThan(45);
        }
    });

    it('walks the line there and back, resting at each end of a step', () => {
        const at = (p) => palettePhase(p);
        expect(at(0)).toMatchObject({ index: PALETTE_HOME, mix: 0 });
        // Inside the rest, nothing moves; past it, it does.
        expect(at(PALETTE_REST * 0.9).mix).toBe(0);
        expect(at(0.5).mix).toBeCloseTo(0.5, 5);
        expect(at(1 - PALETTE_REST * 0.9).mix).toBe(1);
        // The far end turns back: one step past the last palette is the one before it.
        const last = SKY_PALETTES.length - 1;
        const toEnd = last - PALETTE_HOME;
        expect(paletteName(toEnd)).toBe(SKY_PALETTES[last].name);
        expect(paletteName(toEnd + 1)).toBe(SKY_PALETTES[last - 1].name);
        // And the near end too.
        expect(paletteName(-PALETTE_HOME)).toBe(SKY_PALETTES[0].name);
        expect(paletteName(-PALETTE_HOME - 1)).toBe(SKY_PALETTES[1].name);
    });

    it('drifts with the clock alone, whatever the level, and a level adds a whole step', () => {
        // Within the first minute of a level the sky has moved.
        const start = {};
        const minute = {};
        paletteAt(palettePlace(0, 0), start);
        paletteAt(palettePlace(0, PALETTE_STEP * 0.66), minute);
        expect(minute.glow).not.toEqual(start.glow);
        // One step later it stands on the next palette.
        expect(paletteName(palettePlace(0, PALETTE_STEP))).toBe(SKY_PALETTES[PALETTE_HOME + 1].name);
        // A level is a step on top of the clock: level 2 at t is level 1 at t + one step.
        expect(palettePlace(1, 30)).toBeCloseTo(palettePlace(0, 30 + PALETTE_STEP), 9);
        // It is on its way most of the time: the rests are short.
        let moving = 0;
        for (let t = 0; t < PALETTE_STEP; t += 1) {
            const m = palettePhase(palettePlace(0, t)).mix;
            if (m > 0 && m < 1) moving += 1;
        }
        expect(moving / PALETTE_STEP).toBeGreaterThan(0.65);
    });
});

describe('Serenity Warp glass pieces', () => {
    it('turns each of the seven shapes into four cells on the half grid, centred on their box', () => {
        expect(SHAPE_KEYS).toEqual(['I', 'O', 'T', 'S', 'Z', 'J', 'L']);
        for (const key of SHAPE_KEYS) {
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
        }
    });

    it('keeps a locked piece the way up it locked: matrix rows run down, the cells y up', () => {
        // J in spawn orientation: the lone cell is top-left.
        const j = cellsFromMatrix(SHAPES.J);
        const pairs = [];
        for (let i = 0; i < 8; i += 2) pairs.push([j[i], j[i + 1]]);
        const top = pairs.filter(([, y]) => y > 0);
        expect(top).toEqual([[-1, 0.5]]);
        // A padded matrix (as the game sends rotated pieces) gives the same cells.
        const padded = cellsFromMatrix([[0, 0, 0], [1, 1, 1], [0, 0, 1]]);
        const plain = cellsFromMatrix([[1, 1, 1], [0, 0, 1]]);
        expect(padded).toEqual(plain);
        expect(cellsFromMatrix([[0, 0], [0, 0]])).toBeNull();
        expect(cellsFromMatrix(null)).toBeNull();
    });

    it('packs every cell as an exact integer the shader decodes back', () => {
        for (let x = -3.5; x <= 3.5; x += 0.5) {
            for (let y = -3.5; y <= 3.5; y += 0.5) {
                const code = packCell(x, y);
                expect(Number.isInteger(code)).toBe(true);
                // An interpolated attribute comes back with last-bit noise: it must still decode.
                expect(unpackCell(code + 0.0004)).toEqual([x, y]);
                expect(unpackCell(code - 0.0004)).toEqual([x, y]);
            }
        }
        expect(packCells(cellsFromMatrix(SHAPES.T))).toHaveLength(4);
    });

    it('traces the glass like the shader: through one cell, along a bar, and out the face it meets', () => {
        const one = [0, 0, 0, 0, 0, 0, 0, 0];
        const straight = unionExit(one, [0, 0, 0.49], [0, 0, -1]);
        expect(straight.t).toBeCloseTo(0.99, 6);
        expect(straight.normal).toEqual([0, 0, -1]);
        const bar = cellsFromMatrix(SHAPES.I);
        // Along the bar from its left end: all four cells.
        const along = unionExit(bar, [-1.99, 0, 0], [1, 0, 0]);
        expect(along.t).toBeCloseTo(3.99, 6);
        expect(along.normal).toEqual([1, 0, 0]);
        // Across it: one cell's depth.
        const across = unionExit(bar, [0.5, 0, 0.49], [0, 0, -1]);
        expect(across.t).toBeCloseTo(0.99, 6);
        // From the foot of the T's bar up into its bump: it leaves through the bump's top.
        const t = cellsFromMatrix(SHAPES.T);
        const up = unionExit(t, [0, -0.99, 0], [0, 1, 0]);
        expect(up.t).toBeCloseTo(1.99, 6);
        expect(up.normal).toEqual([0, 1, 0]);
        // A ray that leaves one cell into empty space stops at that cell's face.
        const out = unionExit(t, [1, -0.5, 0], [0, -1, 0]);
        expect(out.t).toBeCloseTo(0.5, 6);
        expect(out.normal).toEqual([0, -1, 0]);
    });

    it('runs every piece in toward the throat: the angle closes, the depth grows, the turn quickens', () => {
        const start = {
            theta0: 20 * DEG, phi0: 0.4, depth0: 8, spin: 1,
        };
        let last = pathAt(start, 0, {});
        expect(last.theta).toBeCloseTo(start.theta0, 9);
        expect(last.depth).toBeCloseTo(start.depth0, 9);
        expect(last.phi).toBeCloseTo(start.phi0, 9);
        let lastTurn = 0;
        for (let s = 0.05; s <= 1.0001; s += 0.05) {
            const p = pathAt(start, s, {});
            expect(p.theta).toBeLessThan(last.theta);
            expect(p.depth).toBeGreaterThan(last.depth);
            const turn = p.phi - last.phi;
            expect(turn).toBeGreaterThan(0);
            if (s > 0.3) expect(turn).toBeGreaterThanOrEqual(lastTurn - 1e-9);
            lastTurn = turn;
            last = p;
        }
        expect(last.theta).toBeCloseTo(0, 6);
        expect(last.depth).toBeCloseTo(GATE.depth, 6);
        // The other spin turns the other way.
        expect(pathAt({ ...start, spin: -1 }, 0.5, {}).phi).toBeLessThan(start.phi0);
        // It lingers near where it was born: a fifth of the way in, still nearer the camera than the gate.
        expect(pathAt(start, 0.2, {}).depth).toBeLessThan(start.depth0 * 1.5);
    });

    it('lets a lock piece dive at once while a drifting one lingers near the lens', () => {
        const start = {
            theta0: 14 * DEG, phi0: 0, depth0: 8.5, spin: 1,
        };
        expect(DIVE_LOCK).toBeLessThan(DIVE_DRIFT);
        const drift = pathAt(start, 0.25, {});
        const lock = pathAt({ ...start, dive: DIVE_LOCK }, 0.25, {});
        expect(lock.depth).toBeGreaterThan(drift.depth * 1.4);
        // Same angle and turn: only how soon it goes deep differs, and both end at the throat.
        expect(lock.theta).toBeCloseTo(drift.theta, 9);
        expect(pathAt({ ...start, dive: DIVE_LOCK }, 1, {}).depth).toBeCloseTo(GATE.depth, 6);
    });

    it('maps places in the gate frame to the world and back', () => {
        const p = placeToWorld(12 * DEG, 2.1, 30, []);
        expect(p[2]).toBeCloseTo(-30, 9);
        const back = worldToPlace(p[0], p[1], p[2], {});
        expect(back.theta).toBeCloseTo(12 * DEG, 9);
        expect(back.phi).toBeCloseTo(2.1, 9);
        expect(back.depth).toBeCloseTo(30, 9);
    });

    it('gives a piece its own colour, peak-normalised, with a floor in every channel', () => {
        for (const key of SHAPE_KEYS) {
            const rgb = pieceColor(SERENITY_WARP_TETROMINOS.colors[key]);
            expect(Math.max(...rgb), key).toBeCloseTo(1, 6);
            expect(Math.min(...rgb), key).toBeGreaterThanOrEqual(0.05 - 1e-9);
        }
        expect(pieceColor('not a colour')).toEqual(pieceColor(0x35e6ef));
    });

    it('turns pieces with unit quaternions', () => {
        const q = quatAxis(0, 0, 1, Math.PI / 2, []);
        const v = quatRotate(q, [1, 0, 0], []);
        expect(v[0]).toBeCloseTo(0, 9);
        expect(v[1]).toBeCloseTo(1, 9);
        const twice = quatMul(q, q, []);
        const w = quatRotate(twice, [1, 0, 0], []);
        expect(w[0]).toBeCloseTo(-1, 9);
        expect(Math.hypot(...twice)).toBeCloseTo(1, 9);
        expect(CELL).toBeGreaterThan(0);
    });
});

describe('Serenity Warp warp, waves and the jump', () => {
    it('winds the warp up with the chain, never past its limit, and runs the current faster', () => {
        expect(warpForCombo(0)).toBe(0);
        let last = 0;
        for (let n = 1; n <= 30; n++) {
            const w = warpForCombo(n);
            expect(w).toBeGreaterThan(last);
            expect(w).toBeLessThan(WARP_CHAIN);
            last = w;
        }
        expect(currentFor(0)).toBe(1);
        expect(currentFor(WARP_CHAIN)).toBeGreaterThan(currentFor(WARP_CHAIN / 2));
    });

    it('sends a wave out from the rim, fading over its life', () => {
        const alpha = GATE.radius * DEG;
        expect(waveAngle(0, alpha)).toBe(alpha);
        let last = alpha;
        for (let t = 0.1; t < WAVE_LIFE; t += 0.1) {
            const a = waveAngle(t, alpha);
            expect(a).toBeGreaterThan(last);
            last = a;
        }
        expect(waveLight(-0.1)).toBe(0);
        expect(waveLight(WAVE_LIFE + 0.01)).toBe(0);
        expect(waveLight(0.2)).toBeGreaterThan(waveLight(1.2));
    });

    it('opens the throat round us, holds us inside, then lets us out', () => {
        expect(jumpPhase(0)).toBe(0);
        expect(jumpPhase(JUMP_OPEN + 0.01)).toBe(1);
        expect(jumpPhase(JUMP_TUNNEL - 0.01)).toBe(1);
        expect(jumpPhase(JUMP_TUNNEL + JUMP_EXIT * 0.5)).toBeGreaterThan(0);
        expect(jumpPhase(JUMP_TUNNEL + JUMP_EXIT + 0.01)).toBe(0);
        const rest = GATE.radius * DEG;
        expect(jumpRadius(0, rest)).toBe(rest);
        expect(jumpRadius(JUMP_OPEN, rest)).toBeCloseTo(GATE.jumpRadius * DEG, 6);
        // Wider than any frame: we are inside it.
        expect(GATE.jumpRadius).toBeGreaterThan(90);
        expect(jumpRadius(JUMP_TUNNEL + 0.01, rest)).toBe(rest);
    });

    it('hangs the gate beside the board in landscape and above it on an upright phone', () => {
        const wide = gateAnchors(16 / 9);
        expect(wide.x).toBeLessThan(0.3);
        expect(wide.y).toBeGreaterThan(0.3);
        expect(wide.y).toBeLessThan(0.6);
        const phone = gateAnchors(9 / 19.5);
        expect(phone.y).toBeLessThan(0.25);
        expect(Math.abs(phone.x - 0.5)).toBeLessThan(0.05);
        expect(phone.radius).toBeLessThan(wide.radius);
    });

    it('maps the environment target both ways (u round the world, v down from the zenith)', () => {
        for (const d of [[0, 0, -1], [1, 0, 0], [0, 1, 0], [0.3, -0.4, 0.866]]) {
            const n = Math.hypot(...d);
            const unit = d.map((c) => c / n);
            const st = envUv(unit);
            expect(st[0]).toBeGreaterThanOrEqual(0);
            expect(st[0]).toBeLessThanOrEqual(1);
            const back = envDir(st);
            if (Math.abs(unit[1]) < 0.999) back.forEach((c, i) => expect(c).toBeCloseTo(unit[i], 6));
        }
        // Up is the top row: the target's v runs down, as the painting quad's uv does.
        expect(envUv([0, 1, 0])[1]).toBeCloseTo(0, 6);
        expect(envUv([0, -1, 0])[1]).toBeCloseTo(1, 6);
        // The gate (straight down −Z) is the middle of the target.
        expect(envUv([0, 0, -1])).toEqual([0.5, 0.5]);
    });
});
