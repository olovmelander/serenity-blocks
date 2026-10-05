/**
 * Neon District — the city plan (CPU only, three-free, deterministic).
 *
 * One PERIOD of street, seen from its centre line looking down −Z: a low street wall on each side
 * (shopfronts at the foot, signs above), setback towers rising out of it, a second row of
 * mid-rises behind, and megatowers standing still in the smog far beyond. Everything that scrolls
 * carries a layout depth z in [−period, 0); the materials wrap it (see neon-district-tsl.js).
 *
 * Sides: −1 = left of the camera (x < 0), +1 = right. The left wall is dense with signs; the
 * right wall opens once, onto the plaza of the district's megatower.
 */

import { STREET, mulberry32, linRGB } from './neon-district-core.js';
import { BILLBOARD_CELLS, SHOPFRONT_CELLS } from './neon-district-atlas.js';

/** Sign colours (sRGB hex) and how often each is drawn. */
export const NEON_PALETTE = Object.freeze([
    { name: 'cyan', hex: 0x22e4ff, weight: 0.25 },
    { name: 'rose', hex: 0xff2d86, weight: 0.24 },
    { name: 'amber', hex: 0xffa53a, weight: 0.13 },
    { name: 'violet', hex: 0x9b5cff, weight: 0.12 },
    { name: 'mint', hex: 0x4dffb0, weight: 0.08 },
    { name: 'red', hex: 0xff3a30, weight: 0.07 },
    { name: 'cobalt', hex: 0x3b7bff, weight: 0.07 },
    { name: 'ice', hex: 0xd6f3ff, weight: 0.04 },
]);

/** Words the Latin tube signs spell (generic trade words only). */
export const SIGN_WORDS = Object.freeze([
    'HOTEL', 'BAR', 'RAMEN', 'NOODLE', 'SAUNA', 'ARCADE', 'OPEN', '24H', 'TAXI', 'CLUB', 'DATA',
    'SUSHI', 'CAFE', 'SYNTH', 'NEON', 'MOTEL', 'LIVE', 'JAZZ', 'TEA', 'PAWN', 'CAPSULE', 'CYBER',
    'VR', 'DISCO', 'KARAOKE', 'TATTOO', 'PARTS', 'CHIPS', 'DINER', 'BATHS',
]);

/** Glyph atlas: cells 0..35 are 0-9 A-Z, the rest are the district's own script. */
export const GLYPH_LATIN = 36;
export const GLYPH_COUNT = 64;
export const MAX_SIGN_GLYPHS = 8;

export const GLOW_TEXELS = 160;

const FLOOR_HEIGHT = 3.4;

/** Lamp colours of the vending machines' faces (scene-linear). */
const VENDING_TINTS = Object.freeze([[0.55, 0.92, 1.0], [1.0, 0.2, 0.16], [1.0, 0.6, 0.2], [0.35, 1.0, 0.65], [0.9, 0.95, 1.0]]);
const WALL_DEPTH = 14;
const ALLEY = 3;
const SIDE_STREET = 15;

function pickWeighted(rand, items) {
    let total = 0;
    for (let i = 0; i < items.length; i++) total += items[i].weight;
    let r = rand() * total;
    for (let i = 0; i < items.length; i++) {
        r -= items[i].weight;
        if (r <= 0) return i;
    }
    return items.length - 1;
}

function shuffled(rand, n) {
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}

function glyphIndex(ch) {
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) return code - 48;
    if (code >= 65 && code <= 90) return 10 + code - 65;
    return 0;
}

/**
 * @param {number} [seed]
 * @returns the plan: plain arrays of plain objects, ready for the mesh builders.
 */
export function buildLayout(seed = 0x0d15721c) {
    const rand = mulberry32(seed);
    const L = STREET.period;
    const range = (a, b) => a + (b - a) * rand();
    const int = (a, b) => Math.floor(range(a, b + 1));
    const chance = (p) => rand() < p;
    /** Instance seeds are integers: the shaders round them, so interpolation noise never reaches a hash. */
    const seedInt = () => Math.floor(rand() * 4096);

    const plan = {
        seed,
        blocks: [],
        boxes: [],
        megaBoxes: [],
        shopfronts: [],
        signs: [],
        screens: [],
        lamps: [],
        cables: [],
        lanterns: [],
        vents: [],
        beacons: [],
        kit: [],
        glow: new Float32Array(GLOW_TEXELS * 2 * 4),
    };

    const glowSamples = [];
    const addGlow = (side, z, rgb, energy, spread = 7) => {
        glowSamples.push({
            side, z, rgb, energy, spread,
        });
    };

    const shopOrder = [shuffled(rand, SHOPFRONT_CELLS.length), shuffled(rand, SHOPFRONT_CELLS.length)];
    const shopCursor = [0, 3];
    let screenCursor = 0;
    const squareAds = BILLBOARD_CELLS.map((c, i) => (c.aspect < 1.4 ? i : -1)).filter((i) => i >= 0);
    const wideAds = BILLBOARD_CELLS.map((c, i) => (c.aspect >= 1.4 ? i : -1)).filter((i) => i >= 0);

    const addBox = (box) => {
        plan.boxes.push({
            x: 0,
            y: 0,
            z: 0,
            w: 10,
            h: 10,
            d: 10,
            bay: 3,
            floor: FLOOR_HEIGHT,
            winX: 0.66,
            winY: 0.58,
            lit: 0.35,
            warm: 0.5,
            tone: 1,
            trim: 0,
            plinth: 0,
            accent: 0,
            seed: seedInt(),
            ...box,
        });
    };

    /** A wall-mounted kit piece: +x of the piece points out from the wall, into the street. */
    const addKit = (kind, side, item) => {
        plan.kit.push({
            kind,
            x: side * (STREET.halfStreet - 0.02),
            y: 0,
            yaw: 0,
            sx: 1,
            sy: 1,
            sz: 1,
            mirror: side > 0,
            rgb: [0.7, 0.9, 1.0],
            seed: seedInt(),
            ...item,
        });
    };

    const addSign = (sign) => {
        const colour = NEON_PALETTE[sign.palette].hex;
        const rgb = linRGB(colour);
        plan.signs.push({
            glyphs: [], vertical: true, flicker: rand(), style: 0, seed: seedInt(), ...sign, rgb,
        });
        addGlow(sign.side, sign.z, rgb, 0.16 * sign.w * sign.h, 6);
    };

    /** A sign's glyphs: a trade word in Latin tubes, or a run of the district's own script. */
    const signGlyphs = (count, latin) => {
        if (latin) {
            const fits = SIGN_WORDS.filter((word) => word.length <= count && word.length >= Math.min(3, count));
            if (fits.length) {
                const word = fits[Math.floor(rand() * fits.length)];
                return Array.from(word, glyphIndex);
            }
        }
        return Array.from({ length: count }, () => GLYPH_LATIN + int(0, GLYPH_COUNT - GLYPH_LATIN - 1));
    };

    for (let s = 0; s < 2; s++) {
        const side = s === 0 ? -1 : 1;
        // ── Divide the period into blocks, alleys and (right side) one side street ──
        const count = 14;
        const lengths = [];
        const gaps = [];
        const plazaAt = side > 0 ? 9 : -1;
        let total = 0;
        for (let i = 0; i < count; i++) {
            lengths.push(range(15, 24));
            gaps.push(i === plazaAt ? SIDE_STREET : ALLEY);
            total += gaps[i];
        }
        const sumLengths = lengths.reduce((a, b) => a + b, 0);
        const scale = (L - total) / sumLengths;
        let cursor = -L + (side > 0 ? 6 : 0);
        for (let i = 0; i < count; i++) {
            const len = lengths[i] * scale;
            const z = cursor + len / 2;
            cursor += len + gaps[i];
            const floors = int(2, 5);
            const wallH = STREET.plinth + floors * FLOOR_HEIGHT + 0.9;
            const accent = pickWeighted(rand, NEON_PALETTE);
            const style = {
                bay: [2.6, 3.0, 3.4, 4.2][int(0, 3)],
                floor: FLOOR_HEIGHT,
                winX: range(0.52, 0.8),
                winY: range(0.46, 0.7),
                lit: range(0.2, 0.58),
                warm: range(0, 1),
                tone: range(0.7, 1.3),
            };
            const block = {
                index: plan.blocks.length, side, z, len, wallH, accent, hasTower: false, towerH: 0,
            };
            // The street wall: flush with the kerb line, shopfront at its foot.
            addBox({
                x: side * (STREET.halfStreet + WALL_DEPTH / 2),
                z,
                w: WALL_DEPTH,
                h: wallH,
                d: len,
                ...style,
                trim: chance(0.55) ? 1 : 0,
                plinth: 1,
                accent,
            });
            // A setback tower rising out of it.
            if (chance(0.46)) {
                const towerH = range(30, 88);
                const towerLen = len - range(2.5, 7);
                block.hasTower = true;
                block.towerH = towerH;
                addBox({
                    x: side * (STREET.halfStreet + 4.5 + 5.5),
                    y: wallH,
                    z: z + range(-1, 1),
                    w: 11,
                    h: towerH - wallH,
                    d: towerLen,
                    bay: [3.0, 3.4, 4.2][int(0, 2)],
                    floor: [3.4, 3.8][int(0, 1)],
                    winX: range(0.6, 0.86),
                    winY: range(0.5, 0.76),
                    lit: range(0.18, 0.5),
                    warm: range(0, 0.8),
                    tone: range(0.6, 1.15),
                    trim: chance(0.7) ? 1 : 0,
                    accent: pickWeighted(rand, NEON_PALETTE),
                });
                if (towerH > 60) {
                    plan.beacons.push({
                        x: side * (STREET.halfStreet + 10), y: towerH + 1.2, z, phase: rand(), scroll: 1,
                    });
                }
            }
            plan.blocks.push(block);

            // ── Shopfronts: two where the block is long enough, a pier between them ──
            const shopH = STREET.plinth - 0.35;
            const nextCell = () => {
                const cellIndex = shopOrder[s][shopCursor[s] % SHOPFRONT_CELLS.length];
                shopCursor[s] += 1;
                return cellIndex;
            };
            const first = nextCell();
            const widths = [Math.min(len - 1.4, shopH * SHOPFRONT_CELLS[first].aspect)];
            const cells = [first];
            const second = shopOrder[s][shopCursor[s] % SHOPFRONT_CELLS.length];
            const secondW = shopH * SHOPFRONT_CELLS[second].aspect;
            if (widths[0] + secondW + 2.4 <= len) {
                cells.push(nextCell());
                widths.push(secondW);
            }
            const run = widths.reduce((a, b2) => a + b2, 0) + (cells.length - 1) * 0.9;
            let shopZ = z - run / 2 + range(-0.5, 0.5) * Math.max(0, len - run - 1.4);
            for (let k = 0; k < cells.length; k++) {
                const cell = SHOPFRONT_CELLS[cells[k]];
                const w = widths[k];
                const centre = shopZ + w / 2;
                const h = w / cell.aspect;
                plan.shopfronts.push({
                    side, z: centre, w, h, cell: cells[k], seed: seedInt(),
                });
                addGlow(side, centre, cell.glow, 1.3 + cell.luma * 14, 6.5);
                // A canopy over most of them, lit from its lip in the shop's own colour.
                if (chance(0.7)) {
                    addKit('awning', side, {
                        y: 0.12 + h + 0.12, z: centre, sz: w + 0.5, rgb: cell.glow,
                    });
                }
                shopZ += w + 0.9;
            }
            // Vending machines in the gap a short run of shops leaves.
            const gap = len - run - 1.4;
            if (gap > 2.4 && chance(0.75)) {
                const machines = Math.min(3, Math.floor(gap / 1.15));
                const startZ = z + (chance(0.5) ? -1 : 1) * (len / 2 - 0.9);
                const step = startZ > z ? -1.12 : 1.12;
                for (let m = 0; m < machines; m++) {
                    addKit('vending', side, { z: startZ + m * step, rgb: VENDING_TINTS[int(0, VENDING_TINTS.length - 1)] });
                }
                addGlow(side, startZ, [0.7, 0.9, 1.0], 0.35 * machines, 3.5);
            }
            // A fire escape up some facades, a pipe run up others.
            if (floors >= 2 && chance(0.42)) {
                const ez = z + range(-0.3, 0.3) * len;
                for (let level = 1; level <= floors; level++) {
                    addKit('escape', side, { y: STREET.plinth + level * FLOOR_HEIGHT, z: ez });
                }
            }
            if (chance(0.5)) {
                addKit('pipes', side, {
                    y: STREET.plinth, z: z + (chance(0.5) ? -1 : 1) * (len / 2 - range(0.5, 1.4)), sy: (wallH - STREET.plinth) / FLOOR_HEIGHT,
                });
            }

            // ── Signs: blades over the pavement, the odd banner flat on the wall ──
            const blades = int(1, side < 0 ? 4 : 3);
            for (let b = 0; b < blades; b++) {
                const vertical = chance(0.8);
                const w = vertical ? range(0.95, 1.7) : range(3.2, 5.2);
                const h = vertical ? range(3.2, Math.min(7.4, wallH - STREET.plinth + 2.5)) : range(0.95, 1.4);
                const fit = vertical ? h / (w * 1.02) : w / (h * 0.92);
                const glyphCount = Math.max(1, Math.min(MAX_SIGN_GLYPHS, Math.round(fit)));
                const yLo = STREET.plinth + 0.6 + h / 2;
                const yHi = Math.max(yLo + 0.1, wallH + 1.5 - h / 2);
                addSign({
                    side,
                    kind: 'blade',
                    x: side * (STREET.halfStreet - 0.3 - w / 2),
                    y: range(yLo, yHi),
                    z: z + range(-0.46, 0.46) * len,
                    w,
                    h,
                    vertical,
                    glyphs: signGlyphs(glyphCount, chance(0.42)),
                    palette: chance(0.45) ? accent : pickWeighted(rand, NEON_PALETTE),
                    style: h < 6 && chance(0.2) ? 1 : 0,
                });
            }
            if (block.hasTower && chance(0.5)) {
                // A tall blade climbing the tower's corner.
                const w = range(1.6, 2.4);
                const h = range(9, 16);
                addSign({
                    side,
                    kind: 'blade',
                    x: side * (STREET.halfStreet + 4.5 - 0.3 - w / 2),
                    y: wallH + 1.5 + h / 2 + range(0, 8),
                    z: z + (chance(0.5) ? -1 : 1) * (len / 2 - 2.6),
                    w,
                    h,
                    vertical: true,
                    glyphs: signGlyphs(Math.min(MAX_SIGN_GLYPHS, Math.round(h / (w * 1.02))), chance(0.3)),
                    palette: pickWeighted(rand, NEON_PALETTE),
                    style: 0,
                });
            }
            // ── A billboard screen on roughly every third block, facing down the street ──
            if ((i + s) % 3 === 0) {
                const wide = chance(0.45);
                const pool = wide ? wideAds : squareAds;
                const ad = pool[screenCursor % pool.length];
                screenCursor += 1;
                const cellAd = BILLBOARD_CELLS[ad];
                const h = wide ? range(3.6, 4.6) : range(4.8, 6.6);
                const w = h * cellAd.aspect;
                const y = Math.min(wallH + 2 + h / 2, STREET.plinth + 4 + h / 2 + range(0, 6));
                const sz = z + (chance(0.5) ? -1 : 1) * (len / 2 - 1.2);
                plan.screens.push({
                    side,
                    x: side * (STREET.halfStreet - 0.4 - w / 2),
                    y,
                    z: sz,
                    w,
                    h,
                    cell: ad,
                    next: pool[(screenCursor + 1) % pool.length],
                    seed: seedInt(),
                });
                addGlow(side, sz, cellAd.glow, 0.05 * w * h + 0.4, 9);
            }
            // ── Roof clutter ──
            const roofProps = int(1, 3);
            for (let r = 0; r < roofProps; r++) {
                const kind = ['tank', 'aircon', 'mast', 'frame'][int(0, 3)];
                const edge = kind === 'frame';
                plan.kit.push({
                    kind,
                    x: side * (STREET.halfStreet + (edge ? 0.5 : range(1.5, block.hasTower ? 3.4 : 9))),
                    y: wallH,
                    z: z + range(-0.4, 0.4) * len,
                    // Scaffolds face the street; everything else sits as it fell.
                    yaw: edge ? 0 : range(0, Math.PI * 2),
                    sx: 1,
                    sy: 1,
                    sz: 1,
                    mirror: edge ? side < 0 : false,
                    rgb: [0.85, 0.92, 1.0],
                    seed: seedInt(),
                });
            }
        }
        // ── Second row: mid-rises behind the street wall ──
        for (let i = 0; i < 9; i++) {
            const w = range(18, 30);
            const d = range(20, 34);
            const h = range(58, 175);
            const z = -L + (i + rand() * 0.8) * (L / 9);
            const x = side * range(36, 74);
            addBox({
                x,
                z,
                w,
                h,
                d,
                bay: [3.4, 4.2, 5.0][int(0, 2)],
                floor: 3.8,
                winX: range(0.62, 0.9),
                winY: range(0.5, 0.8),
                lit: range(0.16, 0.42),
                warm: range(0, 0.7),
                tone: range(0.55, 1.0),
                trim: chance(0.8) ? 1 : 0,
                accent: pickWeighted(rand, NEON_PALETTE),
            });
            plan.beacons.push({
                x, y: h + 1.5, z, phase: rand(), scroll: 1,
            });
        }
        // ── Street lamps: twelve a side, staggered across the road ──
        for (let i = 0; i < 12; i++) {
            plan.lamps.push({
                side,
                x: side * (STREET.halfRoad + 0.7),
                z: -L + (i + (side > 0 ? 0.5 : 0)) * (L / 12) + 2,
                h: 7.2,
                warm: (i + s) % 3 === 0 ? 0 : 1,
            });
        }
    }

    // ── Cables across the street; three of them carry lanterns ──
    const cableCount = 16;
    for (let i = 0; i < cableCount; i++) {
        const z = -L + (i + range(0.1, 0.9)) * (L / cableCount);
        const y0 = range(8.5, 15);
        const y1 = y0 + range(-2.2, 2.2);
        const cable = {
            z0: z,
            z1: z + range(-5, 5),
            y0,
            y1,
            sag: range(0.7, 1.9),
            lanterns: i % 5 === 2 ? int(6, 8) : 0,
        };
        plan.cables.push(cable);
        for (let k = 0; k < cable.lanterns; k++) {
            const t = (k + 1) / (cable.lanterns + 1);
            const x = -STREET.halfStreet + t * 2 * STREET.halfStreet;
            const y = cable.y0 + (cable.y1 - cable.y0) * t - cable.sag * 4 * t * (1 - t) - 0.42;
            const lz = cable.z0 + (cable.z1 - cable.z0) * t;
            plan.lanterns.push({
                x, y, z: lz, seed: seedInt(), warm: k % 3 === 0 ? 0 : 1,
            });
        }
        if (cable.lanterns) {
            addGlow(-1, z, linRGB(0xff7a2a), 0.9, 9);
            addGlow(1, z, linRGB(0xff7a2a), 0.9, 9);
        }
    }

    // ── Across the street: two skybridges and a signal gantry at every crossing ──
    [[-L * 0.31, 15.5], [-L * 0.77, 19]].forEach(([z, y], i) => {
        plan.kit.push({
            kind: 'bridge',
            x: 0,
            y,
            z,
            yaw: 0,
            sx: STREET.halfStreet * 2 + 1,
            sy: 1,
            sz: 1,
            mirror: false,
            rgb: i ? [0.45, 0.9, 1.0] : [1.0, 0.72, 0.42],
            seed: seedInt(),
        });
        addGlow(-1, z, i ? [0.45, 0.9, 1.0] : [1.0, 0.72, 0.42], 0.5, 8);
        addGlow(1, z, i ? [0.45, 0.9, 1.0] : [1.0, 0.72, 0.42], 0.5, 8);
    });
    for (let i = 0; i < 4; i++) {
        // The road's zebra crossings repeat every 80 m; the gantry stands at the stop line.
        plan.kit.push({
            kind: 'gantry',
            x: 0,
            y: 0,
            z: -19.4 - i * 80,
            yaw: 0,
            sx: 1,
            sy: 1,
            sz: 1,
            mirror: false,
            rgb: i % 2 ? [0.2, 1.0, 0.5] : [1.0, 0.12, 0.08],
            seed: seedInt(),
        });
    }

    // ── Steam vents in the pavement ──
    for (let i = 0; i < 8; i++) {
        const side = i % 2 ? 1 : -1;
        plan.vents.push({
            x: side * range(STREET.halfRoad + 0.4, STREET.halfStreet - 0.8),
            z: -L + (i + range(0.2, 0.8)) * (L / 8),
            seed: seedInt(),
        });
    }

    // ── Megatowers: stand still in the smog (they never scroll) ──
    const mega = (x, z, w, d, h, opts = {}) => {
        plan.megaBoxes.push({
            x,
            y: opts.y || 0,
            z,
            w,
            h,
            d,
            bay: opts.bay || 7,
            floor: opts.floor || 5.2,
            winX: opts.winX ?? range(0.7, 0.92),
            winY: opts.winY ?? range(0.42, 0.7),
            lit: opts.lit ?? range(0.2, 0.42),
            warm: opts.warm ?? range(0, 0.6),
            tone: opts.tone ?? range(0.5, 0.9),
            trim: 1,
            plinth: 0,
            accent: opts.accent ?? pickWeighted(rand, NEON_PALETTE),
            seed: seedInt(),
        });
        plan.beacons.push({
            x, y: (opts.y || 0) + h + 3, z, phase: rand(), scroll: 0,
        });
    };
    // The district's own tower: three tiers, seen over the left wall's roofs (azimuth −22°).
    const HERO = { x: -190, z: -470 };
    mega(HERO.x, HERO.z, 92, 92, 170, { accent: 0, lit: 0.34 });
    mega(HERO.x, HERO.z, 64, 64, 120, { y: 170, accent: 1, lit: 0.4 });
    mega(HERO.x, HERO.z, 34, 34, 70, { y: 290, accent: 0, lit: 0.46 });
    const megaSpots = [
        [150, -420, 70, 250], [310, -640, 110, 330], [70, -760, 84, 380], [-380, -820, 120, 300],
        [330, -470, 90, 230], [-520, -700, 140, 280], [-40, -1040, 100, 360], [520, -900, 150, 250],
        [-90, -620, 60, 210], [210, -1080, 120, 310],
    ];
    megaSpots.forEach(([x, z, w, h]) => {
        mega(x, z, w, w * range(0.7, 1.1), h * 0.62);
        mega(x + range(-8, 8), z, w * 0.62, w * 0.6, h * 0.38, { y: h * 0.62 });
    });

    // ── Bake the glow map: what each stretch of each wall throws on the street ──
    const N = GLOW_TEXELS;
    for (let k = 0; k < glowSamples.length; k++) {
        const g = glowSamples[k];
        const row = g.side < 0 ? 0 : 1;
        const centre = ((g.z + L) / L) * N;
        const sigma = (g.spread / L) * N;
        const reach = Math.ceil(sigma * 3);
        for (let o = -reach; o <= reach; o++) {
            const texel = Math.floor(centre) + o;
            const dist = (texel + 0.5 - centre) / sigma;
            const wgt = Math.exp(-0.5 * dist * dist) * g.energy;
            const idx = (row * N + (((texel % N) + N) % N)) * 4;
            plan.glow[idx] += g.rgb[0] * wgt;
            plan.glow[idx + 1] += g.rgb[1] * wgt;
            plan.glow[idx + 2] += g.rgb[2] * wgt;
        }
    }
    // Normalise so a typical bright stretch sits near 1, and keep a floor of ambient city light.
    let peak = 0;
    for (let i = 0; i < N * 2; i++) {
        peak = Math.max(peak, plan.glow[i * 4], plan.glow[i * 4 + 1], plan.glow[i * 4 + 2]);
    }
    const gain = peak > 0 ? 1.35 / peak : 1;
    for (let i = 0; i < N * 2; i++) {
        for (let c = 0; c < 3; c++) {
            const v = plan.glow[i * 4 + c] * gain;
            // A soft shoulder keeps one loud shopfront from burning its stretch white.
            plan.glow[i * 4 + c] = 0.02 + v / (1 + v * 0.35);
        }
        plan.glow[i * 4 + 3] = 1;
    }
    return plan;
}
