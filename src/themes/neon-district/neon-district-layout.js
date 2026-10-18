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
import {
    GLYPH_COUNT, GLYPH_LATIN, GLYPH_SCRIPT, glyphFor,
} from './neon-district-glyphs.js';
import {
    ARCHETYPE_LIGHT, BRANDS, BRAND_WORDS, CAMPAIGNS, HALE, TRADE_SHOPS, WINDOW_SIGNS, archetypeIndex, logoIndex,
} from './neon-district-campaigns.js';
import { PAINTED_OPENINGS } from './neon-district-openings.js';

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

/** Glyph atlas: cells 0..35 are 0-9 A-Z, then the district's own script, then punctuation. */
export { GLYPH_COUNT, GLYPH_LATIN };
export const MAX_SIGN_GLYPHS = 8;

/** Characters a line of text (a fascia, a window sign) can hold: the text texture's width. */
export const TEXT_WIDTH = 32;

/** The shopfront band: a shop is this tall, from the pavement to just under the first floor. */
export const SHOP_HEIGHT = STREET.plinth - 0.35;

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

/** The shop identities a period deals out: every brand shop, every trade, a few twice. */
function shopDeck() {
    const deck = [];
    const brandShop = (c) => ({
        name: c.name, mark: c.short, shop: c.shop, a: c.a, b: c.b, logo: c.logo, brand: c.id,
    });
    BRANDS.filter((c) => c.shop).forEach((c) => deck.push(brandShop(c)));
    deck.push(brandShop(HALE));
    // The noodle chain and the laundromat have a branch on each side of the street.
    deck.push(brandShop(CAMPAIGNS.combo), brandShop(CAMPAIGNS.spin), brandShop(HALE));
    TRADE_SHOPS.forEach((t) => deck.push({
        name: t.name, mark: t.name, shop: t.shop, a: t.a, b: 0xffffff, logo: t.logo ?? null, brand: null,
    }));
    return deck;
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
        shops: [],
        texts: [],
        signs: [],
        marks: [],
        screens: [],
        prints: [],
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

    /** A line of text for the text texture; returns its row (identical lines share one). */
    const textRows = new Map();
    const addText = (text) => {
        const line = text.toUpperCase().slice(0, TEXT_WIDTH);
        if (!textRows.has(line)) {
            textRows.set(line, plan.texts.length);
            plan.texts.push(line);
        }
        return textRows.get(line);
    };

    // The painted shopfronts are dealt once per period across both sides; the generated shops'
    // identities come from a shuffled deck, reshuffled when it runs out.
    const paintedOrder = shuffled(rand, SHOPFRONT_CELLS.length);
    let paintedCursor = 0;
    const deck = shopDeck();
    let deckOrder = shuffled(rand, deck.length);
    let deckCursor = 0;
    const nextIdentity = () => {
        if (deckCursor >= deckOrder.length) {
            deckOrder = shuffled(rand, deck.length);
            deckCursor = 0;
        }
        return deck[deckOrder[deckCursor++]];
    };
    // Adverts are dealt from one shuffled deck per shape, so every campaign comes round.
    const adDecks = {};
    const dealAd = (shape, avoid = []) => {
        if (!adDecks[shape] || adDecks[shape].cursor >= adDecks[shape].order.length) {
            const cells = BILLBOARD_CELLS.map((c, i) => (c.shape === shape ? i : -1)).filter((i) => i >= 0);
            adDecks[shape] = { order: shuffled(rand, cells.length).map((k) => cells[k]), cursor: 0 };
        }
        const deckNow = adDecks[shape];
        for (let tries = 0; tries < deckNow.order.length; tries++) {
            const cell = deckNow.order[deckNow.cursor % deckNow.order.length];
            deckNow.cursor += 1;
            if (!avoid.includes(cell)) return cell;
        }
        return deckNow.order[0];
    };
    /** Three adverts of one shape for a screen to cycle, Hale's at most once. */
    const playlist = (shape) => {
        const list = [];
        while (list.length < 3) {
            const cell = dealAd(shape, list);
            const hale = BILLBOARD_CELLS[cell].family === 'hale';
            if (!hale || !list.some((c) => BILLBOARD_CELLS[c].family === 'hale')) list.push(cell);
        }
        return list;
    };
    const meanGlow = (cells) => [0, 1, 2].map((c) => cells.reduce((a, k) => a + BILLBOARD_CELLS[k].glow[c], 0) / cells.length);
    const SHAPE_ASPECT = { wide: 16 / 9, portrait: 2 / 3, square: 1 };
    const addScreen = (screen) => {
        const cells = playlist(screen.shape);
        const glow = meanGlow(cells);
        plan.screens.push({
            pitch: 0.055, ...screen, playlist: cells, glow, period: range(9, 14), transition: int(0, 2), seed: seedInt(),
        });
        addGlow(screen.side, screen.z, glow, 0.05 * screen.w * screen.h + 0.4, 9);
    };
    /** An advert for print: never one that leaves room for a screen's breathing ring. */
    const dealPrint = (shape, avoid = []) => {
        let cell = dealAd(shape, avoid);
        for (let tries = 0; tries < 4 && BILLBOARD_CELLS[cell].ring; tries++) cell = dealAd(shape, [...avoid, cell]);
        return cell;
    };
    /** A printed poster: paper or vinyl, lit by the street (a roof board also by its floodlights). */
    const addPrint = (print) => {
        plan.prints.push({
            flood: 0, tear: 0, ...print, seed: seedInt(),
        });
    };

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
        const colour = sign.hex ?? NEON_PALETTE[sign.palette].hex;
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
                return Array.from(word, glyphFor);
            }
        }
        return Array.from({ length: count }, () => GLYPH_LATIN + int(0, GLYPH_SCRIPT - 1));
    };
    /** A campaign's word that fits `count` characters, and its colour; or null. */
    const brandWord = (count) => {
        const fits = BRAND_WORDS.filter(({ word }) => word.length <= count && word.length >= Math.min(3, count));
        if (!fits.length) return null;
        const pick = fits[Math.floor(rand() * fits.length)];
        return { glyphs: Array.from(pick.word, glyphFor), hex: CAMPAIGNS[pick.id].a };
    };

    /** A tube logo hung off the wall: the mark over its name, facing down the street. */
    const addMark = ({
        side, z, y, size, logo, name, rgb, rgb2,
    }) => {
        const w = size * 1.12;
        const h = size * 1.5;
        plan.marks.push({
            side,
            x: side * (STREET.halfStreet - 0.3 - w / 2),
            y,
            z,
            w,
            h,
            logo,
            nameRow: addText(name),
            nameLength: Math.min(TEXT_WIDTH, name.length),
            rgb,
            rgb2,
            seed: seedInt(),
        });
        addGlow(side, z, rgb, 0.12 * w * h, 6);
    };

    /**
     * A stretch of wall pasted with posters, the way a campaign is fly-posted: two to five of one
     * poster side by side, then the next. Some are torn.
     */
    const pasteWall = (side, z0, width, yLo, yHi) => {
        const ph = 1.55;
        const pw = ph * (2 / 3);
        const rows = Math.max(1, Math.floor((yHi - yLo) / (ph + 0.06)));
        const cols = Math.max(1, Math.floor(width / (pw + 0.04)));
        let cell = dealPrint('portrait');
        let run = int(2, 5);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (run <= 0) {
                    cell = dealPrint('portrait', [cell]);
                    run = int(2, 5);
                }
                run -= 1;
                addPrint({
                    side,
                    x: side * (STREET.halfStreet - 0.06),
                    y: yLo + r * (ph + 0.06) + ph / 2 + range(-0.04, 0.04),
                    z: z0 + c * (pw + 0.04) + pw / 2,
                    w: pw,
                    h: ph,
                    cell,
                    tear: chance(0.35) ? range(0.15, 0.6) : 0,
                });
            }
        }
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

            // ── Shops: the block's whole frontage, painted shopfronts and generated shops ──
            // A run of vending machines takes one end of some blocks.
            let machineEnd = 0;
            if (chance(0.4)) machineEnd = chance(0.5) ? -1 : 1;
            const machines = machineEnd ? int(2, 3) : 0;
            const machineRun = machines ? machines * 1.12 + 0.5 : 0;
            let shopZ = z - len / 2 + 0.6 + (machineEnd < 0 ? machineRun : 0);
            const shopEnd = z + len / 2 - 0.6 - (machineEnd > 0 ? machineRun : 0);
            if (machines) {
                const startZ = machineEnd < 0 ? z - len / 2 + 1.1 : z + len / 2 - 1.1;
                const dir = machineEnd < 0 ? 1.12 : -1.12;
                for (let m = 0; m < machines; m++) {
                    // Most of the district's machines sell its cola.
                    const rgb = chance(0.55) ? linRGB(CAMPAIGNS.cascade.a) : VENDING_TINTS[int(0, VENDING_TINTS.length - 1)];
                    addKit('vending', side, { z: startZ + m * dir, rgb });
                }
                addGlow(side, startZ, [0.9, 0.5, 0.5], 0.35 * machines, 3.5);
            }
            // About one block in two shows one of the painted shopfronts, until the period's set
            // is dealt.
            let wantPainted = paintedCursor < paintedOrder.length && chance(0.62);
            const firstShop = plan.shops.length;
            while (shopEnd - shopZ > 3.6) {
                const room = shopEnd - shopZ;
                let shop = null;
                if (!wantPainted && room >= 4.4 && chance(0.09)) {
                    // A shop between tenants: a hoarding, fly-posted with one campaign after another.
                    const w = Math.min(room, range(4.4, 8));
                    pasteWall(side, shopZ, w, 0.4, 3.8);
                    shopZ += w + range(0.6, 0.9);
                    continue; // eslint-disable-line no-continue
                }
                if (wantPainted) {
                    wantPainted = false;
                    const cellIndex = paintedOrder[paintedCursor];
                    const cell = SHOPFRONT_CELLS[cellIndex];
                    const w = SHOP_HEIGHT * cell.aspect;
                    if (w <= room) {
                        paintedCursor += 1;
                        const [u0, v0, u1, v1] = PAINTED_OPENINGS[cell.src] ?? [0.1, 0.45, 0.9, 0.98];
                        shop = {
                            kind: 0,
                            side,
                            z: shopZ + w / 2,
                            w,
                            h: SHOP_HEIGHT,
                            cell: cellIndex,
                            // The painting's windows and door, set back into the wall (v up).
                            open: [u0, 1 - v1, u1, 1 - v0],
                            recess: range(0.3, 0.46),
                            rgb: cell.glow,
                            seed: seedInt(),
                        };
                        addGlow(side, shop.z, cell.glow, 1.3 + cell.luma * 14, 6.5);
                    }
                }
                if (!shop) {
                    const id = nextIdentity();
                    let w = Math.min(room, range(4.4, 7.4));
                    // Never leave a sliver too narrow for another shop: this one takes it.
                    if (room - w - 0.75 < 4.4) w = Math.min(room, 9.5);
                    const fascia = range(0.95, 1.2);
                    const pier = range(0.22, 0.42);
                    // Some trade shops have closed for the night, or are closing.
                    let shutter = 0;
                    if (!id.brand && chance(0.22)) shutter = chance(0.45) ? 1 : range(0.35, 0.7);
                    const sign = shutter < 1 && chance(0.55) ? WINDOW_SIGNS[int(0, WINDOW_SIGNS.length - 1)] : '';
                    const light = ARCHETYPE_LIGHT[id.shop];
                    shop = {
                        kind: 1,
                        side,
                        z: shopZ + w / 2,
                        w,
                        h: SHOP_HEIGHT,
                        archetype: archetypeIndex(id.shop),
                        brand: id.brand,
                        name: id.name,
                        nameRow: addText(id.name),
                        sign,
                        signRow: sign ? addText(sign) : -1,
                        // 0 tubes on a dark board, 1 a lit box with dark letters, 2 lit channel letters.
                        style: int(0, 2),
                        logo: logoIndex(id.logo),
                        rgb: linRGB(id.a),
                        rgb2: linRGB(id.b),
                        light,
                        open: [pier / w, 0.02, 1 - pier / w, 1 - (fascia + 0.14) / SHOP_HEIGHT],
                        fascia: fascia / SHOP_HEIGHT,
                        recess: range(0.32, 0.55),
                        shutter,
                        door: chance(0.5) ? range(0.1, 0.28) : range(0.72, 0.9),
                        seed: seedInt(),
                    };
                    shop.mark = id.mark;
                    const lit = 1 - Math.min(1, shutter) * 0.75;
                    addGlow(side, shop.z, light, (1.0 + 0.12 * w) * lit, 6);
                    addGlow(side, shop.z, shop.rgb, 0.5, 5);
                    // Posters pasted on a shutter that is down for the night.
                    if (shutter >= 1) {
                        const span = w - 2 * pier - 0.3;
                        const n = Math.min(int(2, 4), Math.floor(span / 1.07));
                        if (n > 0) {
                            pasteWall(side, shopZ + pier + 0.15 + range(0, Math.max(0, span - n * 1.07)), n * 1.07, 0.6, 2.25);
                        }
                    }
                }
                plan.shops.push(shop);
                // A canopy over some of them, lit from its lip in the shop's own colour.
                if (chance(0.5)) {
                    addKit('awning', side, {
                        y: 0.12 + shop.h + 0.12, z: shop.z, sz: shop.w + 0.5, rgb: shop.rgb,
                    });
                }
                shopZ += shop.w + range(0.6, 0.9);
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

            // ── Tube logos: over most shops that have a mark; a brand with no shop on some walls ──
            const firstMark = plan.marks.length;
            for (let k = firstShop; k < plan.shops.length; k++) {
                const shop = plan.shops[k];
                if (shop.kind === 1 && shop.logo >= 0 && shop.shutter < 1 && chance(0.8)) {
                    addMark({
                        side,
                        z: shop.z + range(-0.25, 0.25) * shop.w,
                        y: STREET.plinth + 0.9 + 1.0,
                        size: 1.5,
                        logo: shop.logo,
                        name: shop.mark,
                        rgb: shop.rgb,
                        rgb2: shop.rgb2,
                    });
                }
            }
            if (!plan.shops.slice(firstShop).some((shop) => shop.brand) && chance(0.35)) {
                const c = [CAMPAIGNS.cascade, CAMPAIGNS.next, CAMPAIGNS.transit][int(0, 2)];
                const size = range(1.9, 2.5);
                const room = Math.max(0, wallH - STREET.plinth - 2.4 - size * 1.5);
                addMark({
                    side,
                    z: z + range(-0.3, 0.3) * len,
                    y: STREET.plinth + 1.2 + size * 0.75 + range(0, room),
                    size,
                    logo: logoIndex(c.logo),
                    name: c.short,
                    rgb: linRGB(c.a),
                    rgb2: linRGB(c.b),
                });
            }
            const marksHere = plan.marks.slice(firstMark);

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
                let bz = z + range(-0.46, 0.46) * len;
                // Never in the same plane as a logo sign.
                marksHere.forEach((m) => {
                    if (Math.abs(bz - m.z) < 0.7) bz += bz > m.z ? 1.4 : -1.4;
                });
                const latin = chance(0.42);
                const brand = latin && chance(0.4) ? brandWord(glyphCount) : null;
                addSign({
                    side,
                    kind: 'blade',
                    x: side * (STREET.halfStreet - 0.3 - w / 2),
                    y: range(yLo, yHi),
                    z: bz,
                    w,
                    h,
                    vertical,
                    glyphs: brand ? brand.glyphs : signGlyphs(glyphCount, latin),
                    palette: chance(0.45) ? accent : pickWeighted(rand, NEON_PALETTE),
                    hex: brand ? brand.hex : undefined,
                    style: h < 6 && chance(0.2) ? 1 : 0,
                });
            }
            // The street screen and the tower's tall blade share one end of the block, the tower's
            // screen takes the other.
            const screenEnd = chance(0.5) ? -1 : 1;
            if (block.hasTower && chance(0.5)) {
                // A tall blade climbing the tower's corner.
                const w = range(1.6, 2.4);
                const h = range(9, 16);
                addSign({
                    side,
                    kind: 'blade',
                    x: side * (STREET.halfStreet + 4.5 - 0.3 - w / 2),
                    y: wallH + 1.5 + h / 2 + range(0, 8),
                    z: z + screenEnd * (len / 2 - 2.6),
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
                const roll = rand();
                let shape = 'square';
                if (roll < 0.45) shape = 'wide';
                else if (roll < 0.85) shape = 'portrait';
                const heights = { wide: [3.6, 4.6], portrait: [5.6, 7.2], square: [4.4, 5.6] }[shape];
                const h = range(heights[0], heights[1]);
                const w = h * SHAPE_ASPECT[shape];
                addScreen({
                    side,
                    shape,
                    x: side * (STREET.halfStreet - 0.4 - w / 2),
                    y: Math.min(wallH + 2 + h / 2, STREET.plinth + 4 + h / 2 + range(0, 6)),
                    z: z + screenEnd * (len / 2 - 1.2),
                    w,
                    h,
                });
            }
            // A tall screen hung off the corner of some towers, high over the street.
            if (block.hasTower && block.towerH > 40 && chance(0.4)) {
                const h = range(9, 13);
                const w = h * SHAPE_ASPECT.portrait;
                addScreen({
                    side,
                    shape: 'portrait',
                    x: side * (STREET.halfStreet + 4.5 - 0.4 - w / 2),
                    y: Math.min(block.towerH - h / 2 - 2, wallH + 3 + h / 2 + range(0, 8)),
                    z: z - screenEnd * (len / 2 - 3.2),
                    w,
                    h,
                    pitch: 0.09,
                });
            }
            // ── Roof clutter ──
            const roofProps = int(1, 3);
            for (let r = 0; r < roofProps; r++) {
                const kind = ['tank', 'aircon', 'mast', 'frame'][int(0, 3)];
                const edge = kind === 'frame';
                const kz = z + range(-0.4, 0.4) * len;
                plan.kit.push({
                    kind,
                    x: side * (STREET.halfStreet + (edge ? 0.5 : range(1.5, block.hasTower ? 3.4 : 9))),
                    y: wallH,
                    z: kz,
                    // Scaffolds face the street (+x of a piece points out from its wall); everything
                    // else sits as it fell.
                    yaw: edge ? 0 : range(0, Math.PI * 2),
                    sx: 1,
                    sy: 1,
                    sz: 1,
                    mirror: edge ? side > 0 : false,
                    rgb: [0.85, 0.92, 1.0],
                    seed: seedInt(),
                });
                // A scaffold carries a printed campaign under its floodlights (the board's face is
                // 0.1 m in front of the scaffold's line, 1.2 to 4.3 m up).
                if (edge) {
                    addPrint({
                        side,
                        x: side * (STREET.halfStreet + 0.5 - 0.12),
                        y: wallH + 2.75,
                        z: kz,
                        w: 5.4,
                        h: 5.4 / (16 / 9),
                        cell: dealPrint('wide'),
                        flood: 1,
                    });
                }
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
