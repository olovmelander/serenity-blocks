/**
 * @fileoverview Chapter 8's neon city plan — three-free, deterministic (2026-10-20 overhaul).
 *
 * Everything here is CORRIDOR space (the rotated stage frame urban-dreams.js builds the city in):
 * local -Z is the camera's travel toward the spire and the Retrosun, +Y the city's up, the street
 * datum is y = STREET_Y. The camera rides local y ~0..18 and only travels z ~ +90 -> -10, so the
 * neon is concentrated on what that eye sees: the boulevard's inner walls ahead of it and the
 * rooftops below it.
 *
 * The plan has three products:
 *   - the TOWERS (dealt exactly as the 2026-10 city always was: same seed, same RNG order, so
 *     every tower keeps its place, size and window seed on every tier);
 *   - the SIGNS: tube blades hung off the boulevard's walls, lit fascias at street level, light
 *     boxes on the low roofs the eye flies over (Neon District's sign kinds, re-scaled from a
 *     street you walk to a canyon you fly);
 *   - the GLOW MAP: what those signs throw on the walls, the street, the rain and the mist —
 *     Neon District's single most effective trick (neon-district-layout.js addGlow /
 *     neon-district-tsl.js ndGlow), laid along corridor z instead of a scrolling street.
 */

/** The street datum (corridor y) every tower, sign and lamp stands on. */
export const STREET_Y = -60;

/** The Retrosun's centre (corridor space): CH8_RETROSUN_STAGE.sun, read by the street's mirror. */
export const RETROSUN_CITY_POS = Object.freeze([0, 110, -700]);

// Corridor-space city plan (local -Z = the camera's travel; the camera eye rides at
// y ~ 0..18, i.e. ~60-80 u above the street, and only travels z ~ +90 -> -10).
export const CH8_CITY_LAYOUT = Object.freeze({
    ranks: 30,
    nearZ: 130,
    farZ: -640, // the skyline cards (z -650/-675) carry the city beyond this
    // THE CITY BEHIND (all-angles pass, 2026-10-18): ranks continuing past nearZ at the same
    // spacing, dealt AFTER the authored ranks so every authored tower keeps its seed. Looking
    // back down the lane, the canyon used to end a block behind the eye in a bare wall of
    // horizon glow; the back-skyline cards carry the city beyond these.
    backRanks: 9,
    streetGap: 3,
    laneHalfWidth: 24,
    // lateral: centre offset from the lane; jitter; zStag; height range [min,max] above the
    // street near -> far (lerped by rank); tallChance: odds of a tower breaking the skyline.
    banks: [
        {
            lateral: 36, latJit: 8, zStag: 0, zJit: 8, near: [55, 105], far: [40, 85], tallChance: 0.1,
        },
        {
            lateral: 62, latJit: 10, zStag: 13, zJit: 10, near: [40, 95], far: [30, 75], tallChance: 0.12,
        },
        {
            lateral: 96, latJit: 14, zStag: -7, zJit: 14, near: [30, 80], far: [25, 70], tallChance: 0.14,
        },
        {
            lateral: 140, latJit: 18, zStag: 6, zJit: 18, near: [26, 70], far: [22, 62], tallChance: 0.12,
        },
        {
            lateral: 200, latJit: 26, zStag: -12, zJit: 22, near: [22, 60], far: [20, 55], tallChance: 0.1,
        },
        {
            lateral: 275, latJit: 34, zStag: 4, zJit: 26, near: [20, 55], far: [18, 50], tallChance: 0.08,
        },
    ],
    tallRange: [120, 175],
    // Hero towers: fixed [rank, side, bank, hue] slots — tall, neon-trimmed (1 cyan, 2 magenta).
    heroes: [
        [3, 1, 1, 1], [6, -1, 0, 2], [10, 1, 0, 2], [13, -1, 1, 1],
        [17, 1, 2, 1], [21, -1, 2, 2], [25, 1, 1, 2], [27, -1, 3, 1],
    ],
    heroHeight: [150, 205],
    seed: 0x0c8d2e,
});

/** Deterministic PRNG so the city is the same skyline every session (and every capture). */
export function mulberry32(seedValue) {
    let a = seedValue >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Deal the tower city. Moved verbatim from createCityBlocksTSL (2026-10-20): the RNG is drawn
 * for EVERY bank even when a tier keeps fewer, so the kept towers are identical on all tiers.
 * @param {number} [bankCount] banks kept (the outermost are dropped first)
 * @returns {{x:number, y:number, z:number, width:number, height:number, depth:number,
 *   seed:number, occupancy:number, warmBias:number, hero:number, bank:number, side:number,
 *   rank:number}[]} y is the box CENTRE
 */
export function dealCityTowers(bankCount) {
    const L = CH8_CITY_LAYOUT;
    const rand = mulberry32(L.seed);
    // Disjoint parcels prevent neighbouring towers from cutting through each other's
    // windows. Keep the seeded heights/palette, and constrain only footprint and jitter.
    // Centres follow the authored placement's mean width (23 + bank * 2.5) and jitter.
    const bankCentres = L.banks.map((bank, b) => bank.lateral + bank.latJit * 0.5
        + (23 + b * 2.5) * 0.5 - 8);
    const rankSpacing = Math.abs(L.farZ - L.nearZ) / (L.ranks - 1);
    const parcelDepth = rankSpacing - L.streetGap;
    const heroSlots = new Map(L.heroes.map(([rank, side, bank, hue]) => [`${rank}:${side}:${bank}`, hue]));
    const banksKept = Math.max(1, Math.min(L.banks.length, bankCount ?? L.banks.length));
    const towers = [];
    for (let rank = 0; rank < L.ranks + L.backRanks; rank += 1) {
        // Back ranks step on from nearZ at the authored spacing, with the near heights.
        const back = rank >= L.ranks;
        const t = back ? 0 : rank / (L.ranks - 1);
        const z = back
            ? L.nearZ + rankSpacing * (rank - L.ranks + 1)
            : L.nearZ + (L.farZ - L.nearZ) * t;
        for (let s = 0; s < 2; s += 1) {
            const side = s === 0 ? -1 : 1;
            for (let b = 0; b < L.banks.length; b += 1) {
                const bank = L.banks[b];
                const heroHue = heroSlots.get(`${rank}:${side}:${b}`) ?? 0;
                const minH = lerp(bank.near[0], bank.far[0], t);
                const maxH = lerp(bank.near[1], bank.far[1], t);
                let height = minH + rand() * (maxH - minH);
                if (rand() < bank.tallChance) {
                    height = L.tallRange[0] + rand() * (L.tallRange[1] - L.tallRange[0]);
                }
                let width = 16 + rand() * 14 + b * 2.5;
                let depth = 14 + rand() * 14 + b * 2;
                if (heroHue > 0) {
                    height = L.heroHeight[0] + rand() * (L.heroHeight[1] - L.heroHeight[0]);
                    width = 24 + rand() * 8;
                }
                let lateral = bank.lateral + rand() * bank.latJit + width * 0.5 - 8;
                let zJitter = (rand() - 0.5) * bank.zJit;
                const warmy = rand() < 0.5;
                const facadeSeed = rand() * 100;
                const occupancyRoll = rand();
                const warmRoll = rand();
                if (b >= banksKept) continue;
                const innerEdge = b === 0 ? L.laneHalfWidth
                    : (bankCentres[b - 1] + bankCentres[b]) * 0.5 + L.streetGap * 0.5;
                const outerEdge = b === L.banks.length - 1 ? Infinity
                    : (bankCentres[b] + bankCentres[b + 1]) * 0.5 - L.streetGap * 0.5;
                width = Math.min(width, outerEdge - innerEdge);
                lateral = clamp(lateral, innerEdge + width * 0.5, outerEdge - width * 0.5);
                depth = Math.min(depth, parcelDepth);
                const jitterLimit = (parcelDepth - depth) * 0.5;
                zJitter = clamp(zJitter, -jitterLimit, jitterLimit);
                towers.push({
                    x: side * lateral,
                    y: STREET_Y + height * 0.5,
                    z: z + bank.zStag + zJitter,
                    width,
                    height,
                    depth,
                    seed: facadeSeed,
                    occupancy: 0.07 + occupancyRoll * 0.26 + (heroHue > 0 ? 0.08 : 0),
                    warmBias: warmy ? 0.72 + warmRoll * 0.2 : 0.08 + warmRoll * 0.2,
                    hero: heroHue,
                    bank: b,
                    side,
                    rank,
                });
            }
        }
    }
    return towers;
}

// ── The neon ─────────────────────────────────────────────────────────────────────

/**
 * The palette (sRGB hex), after Neon District's NEON_PALETTE (neon-district-layout.js): the city's
 * cyan and rose lead, amber and violet support, the rest are accents.
 */
export const NEON_CITY_PALETTE = Object.freeze([
    { name: 'cyan', hex: 0x22e4ff, weight: 0.24 },
    { name: 'rose', hex: 0xff2d86, weight: 0.26 },
    { name: 'amber', hex: 0xffa53a, weight: 0.14 },
    { name: 'violet', hex: 0x9b5cff, weight: 0.13 },
    { name: 'mint', hex: 0x4dffb0, weight: 0.07 },
    { name: 'red', hex: 0xff3a30, weight: 0.07 },
    { name: 'cobalt', hex: 0x3b7bff, weight: 0.05 },
    { name: 'ice', hex: 0xd6f3ff, weight: 0.04 },
]);

/** Trade words the tube signs spell (Neon District's SIGN_WORDS + its brand words). */
export const NEON_CITY_WORDS = Object.freeze([
    'HOTEL', 'BAR', 'RAMEN', 'NOODLE', 'SAUNA', 'ARCADE', 'OPEN', '24H', 'TAXI', 'CLUB', 'DATA',
    'SUSHI', 'CAFE', 'SYNTH', 'NEON', 'MOTEL', 'LIVE', 'JAZZ', 'TEA', 'CAPSULE', 'CYBER',
    'VR', 'DISCO', 'KARAOKE', 'DINER', 'BATHS', 'COMBO', 'STACK', 'DROP', 'LEVEL', 'NEXT',
    'CLEAR', 'SPIN', 'HALE', 'BREATHE', 'TRANSIT', 'CASCADE',
]);

/** sRGB hex -> linear [r, g, b]. */
export function linearRgb(hex) {
    const c = (v) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return [c((hex >> 16) & 255), c((hex >> 8) & 255), c(hex & 255)];
}

/** Sign kinds (the shader's `kind`): tube text on a dark panel, a glowing box, a lit fascia. */
export const SIGN_KIND = Object.freeze({
    tube: 0, box: 1, fascia: 2, screen: 3,
});

/**
 * The giant LED screens' adverts: what each shows (the shader's `ad`), its word and colour —
 * the district's campaigns (Neon District's Hale, Combo and Serenity Transit), drawn
 * procedurally: no atlas to load.
 */
export const NEON_SCREEN_ADS = Object.freeze([
    { words: ['HALE', 'BREATHE'], palette: 0 },
    { words: ['COMBO', 'STACK', 'DROP'], palette: 1 },
    { words: ['TRANSIT'], palette: 2 },
]);

/** The glow map's span along corridor z, and its resolution. */
export const NEON_GLOW = Object.freeze({
    z0: -800,
    z1: 440,
    texels: 512,
    /** Rows: 0/1 = sign light (left/right walls), 2/3 = street light (left/right kerbs). */
    rows: 4,
});

/** The span of the boulevard the signs line (corridor z): what the eye sees ahead of it. */
const SIGN_Z = Object.freeze({ near: 70, far: -520 });

/** The eye's height band (corridor y): signs are hung around and below it. */
const EYE_Y = 8;

/**
 * Plan the signs. Deterministic (its own seed), so every tier draws the same city; `stride`
 * thins the planned list on the low tiers without moving anything.
 * @param {ReturnType<typeof dealCityTowers>} towers
 * @param {{stride?: number}} [opts]
 * @returns {{signs: object[]}}
 */
export function planNeonSigns(towers, opts = {}) {
    const rand = mulberry32(0x5e9a11);
    const range = (a, b) => a + rand() * (b - a);
    const pickPalette = () => {
        let r = rand();
        for (let i = 0; i < NEON_CITY_PALETTE.length; i += 1) {
            r -= NEON_CITY_PALETTE[i].weight;
            if (r <= 0) return i;
        }
        return 0;
    };
    const word = (maxLen) => {
        const fits = NEON_CITY_WORDS.filter((w) => w.length <= maxLen && w.length >= Math.min(3, maxLen));
        return fits.length ? fits[Math.floor(rand() * fits.length)] : null;
    };
    const signs = [];
    const add = (sign) => {
        const palette = sign.palette ?? pickPalette();
        signs.push({
            flicker: rand(),
            seed: Math.floor(rand() * 4000),
            ...sign,
            palette,
            rgb: linearRgb(NEON_CITY_PALETTE[palette].hex),
        });
    };

    towers.forEach((tower) => {
        if (tower.z > SIGN_Z.near || tower.z < SIGN_Z.far) return;
        const top = tower.y + tower.height * 0.5;
        const innerX = Math.abs(tower.x) - tower.width * 0.5;
        if (tower.bank === 0) {
            // ── Tube blades hung off the boulevard wall, facing down it (toward the eye) ──
            const blades = rand() < 0.7 ? 2 : 1;
            for (let k = 0; k < blades; k += 1) {
                const n = 3 + Math.floor(rand() * 4);
                const latin = rand() < 0.55;
                const text = latin ? word(n) : null;
                const chars = text ? text.length : n;
                const w = range(3.4, 4.6);
                const h = chars * w * 1.18 + w * 0.3;
                // Mostly below the eye (seen from above, the canyon reads deep), a few at it.
                const yHi = Math.min(top - h * 0.5 - 2, EYE_Y + 14);
                const yLo = STREET_Y + 10 + h * 0.5;
                if (yHi <= yLo) continue;
                const y = range(yLo, yHi);
                const zz = tower.z + range(-0.38, 0.38) * tower.depth;
                add({
                    kind: SIGN_KIND.tube,
                    vertical: true,
                    text,
                    chars,
                    x: tower.side * (innerX - 0.9 - w * 0.5),
                    y,
                    z: zz,
                    w,
                    h,
                    side: tower.side,
                    facing: 0, // faces +z (down the boulevard, toward the eye)
                });
            }
            // ── A lit fascia over the shopfronts, flush on the wall, facing the lane ──
            const fw = Math.min(tower.depth * 0.82, 22);
            add({
                kind: SIGN_KIND.fascia,
                vertical: false,
                text: word(Math.max(3, Math.floor(fw / 3.2))),
                chars: 0,
                x: tower.side * (innerX - 0.55),
                y: STREET_Y + 6.5,
                z: tower.z + range(-0.08, 0.08) * tower.depth,
                w: fw,
                h: 3.2,
                side: tower.side,
                facing: 1, // faces the lane (-side x)
            });
            // ── Now and then a long horizontal tube sign up the wall, facing the lane ──
            if (rand() < 0.45) {
                const text = word(7);
                if (text) {
                    const h = range(3.2, 4.2);
                    const w = text.length * h * 0.86 + h * 0.4;
                    const y = range(STREET_Y + 18, Math.min(top - 4, EYE_Y + 4));
                    if (y > STREET_Y + 18 && w < tower.depth * 0.95) {
                        add({
                            kind: SIGN_KIND.tube,
                            vertical: false,
                            text,
                            chars: text.length,
                            x: tower.side * (innerX - 0.55),
                            y,
                            z: tower.z + range(-0.2, 0.2) * tower.depth,
                            w,
                            h,
                            side: tower.side,
                            facing: 1,
                        });
                    }
                }
            }
        } else if (tower.bank <= 3 && top < EYE_Y - 6 && rand() < 0.62) {
            // ── A roof box on the low towers the eye flies over, facing down the boulevard ──
            const text = word(7);
            const w = Math.min(tower.width * range(0.55, 0.85), 26);
            const h = range(6, 10);
            add({
                kind: rand() < 0.55 ? SIGN_KIND.box : SIGN_KIND.tube,
                vertical: false,
                text,
                chars: text ? text.length : 0,
                x: tower.x + range(-0.15, 0.15) * tower.width,
                y: top + h * 0.5 + 1.6,
                z: tower.z + range(-0.2, 0.3) * tower.depth,
                w,
                h,
                side: tower.side,
                facing: 0,
                roof: true,
            });
        }
    });
    // ── Giant LED screens high on the tall towers, over their neighbours' roofs, facing
    // down the boulevard (Blade Runner's adverts). Dealt after the signs with their own seed, so
    // adding them moved no sign. Never thinned by the tier: there are only a handful.
    const screens = [];
    const srand = mulberry32(0x5c4ee7);
    towers.forEach((tower) => {
        const top = tower.y + tower.height * 0.5;
        if (tower.bank > 2 || tower.z > SIGN_Z.near - 40 || tower.z < SIGN_Z.far) return;
        if (!(tower.hero > 0 || (top > EYE_Y + 70 && srand() < 0.4))) return;
        const w = Math.min(tower.width * 0.7, 21);
        const h = w * 1.55;
        const y = Math.min(top - h * 0.5 - 6, EYE_Y + 52);
        if (y - h * 0.5 < EYE_Y + 6) return;
        const ad = Math.floor(srand() * NEON_SCREEN_ADS.length);
        const { words } = NEON_SCREEN_ADS[ad];
        const text = words[Math.floor(srand() * words.length)];
        const { palette } = NEON_SCREEN_ADS[ad];
        screens.push({
            kind: SIGN_KIND.screen,
            vertical: false,
            text,
            chars: text.length,
            x: tower.x,
            y,
            z: tower.z + tower.depth * 0.5 + 0.5,
            w,
            h,
            side: tower.side,
            facing: 0,
            ad,
            flicker: srand(),
            seed: Math.floor(srand() * 4000),
            palette,
            rgb: linearRgb(NEON_CITY_PALETTE[palette].hex),
        });
    });
    const stride = Math.max(1, opts.stride ?? 1);
    const kept = stride > 1 ? signs.filter((_, i) => i % stride === 0) : signs;
    return { signs: [...kept, ...screens] };
}

/**
 * Bake the glow map: what the signs of each stretch of the boulevard throw, as light per metre
 * along corridor z. Four rows (NEON_GLOW.rows) of RGBA float texels (A unused, 1):
 * the wall signs' light left/right, and the street-level light (fascias, shopfronts) left/right.
 * @param {object[]} signs planNeonSigns().signs
 * @returns {Float32Array} texels * rows * 4
 */
export function bakeNeonGlow(signs) {
    const {
        z0, z1, texels, rows,
    } = NEON_GLOW;
    const out = new Float32Array(texels * rows * 4);
    const dz = (z1 - z0) / texels;
    const add = (row, z, rgb, amount, sigma) => {
        const lo = Math.max(0, Math.floor((z - 3 * sigma - z0) / dz));
        const hi = Math.min(texels - 1, Math.ceil((z + 3 * sigma - z0) / dz));
        for (let i = lo; i <= hi; i += 1) {
            const zc = z0 + (i + 0.5) * dz;
            const g = Math.exp(-((zc - z) ** 2) / (2 * sigma * sigma)) * amount;
            const o = (row * texels + i) * 4;
            out[o] += rgb[0] * g;
            out[o + 1] += rgb[1] * g;
            out[o + 2] += rgb[2] * g;
        }
    };
    const rand = mulberry32(0x91c0de);
    signs.forEach((sign) => {
        const right = sign.x > 0 ? 1 : 0;
        if (sign.kind === SIGN_KIND.fascia) {
            add(2 + right, sign.z, sign.rgb, 0.035 * sign.w, 9 + sign.w * 0.4);
        } else if (sign.kind === SIGN_KIND.screen) {
            add(right, sign.z, sign.rgb, 0.004 * sign.w * sign.h, 16);
        } else if (!sign.roof) {
            add(right, sign.z, sign.rgb, 0.013 * sign.w * sign.h, 8 + sign.w);
        }
    });
    // Shopfronts between the fascias: a low, continuous run of warm and neon light down both
    // kerbs, so the canyon floor is never a dead gap.
    for (let z = z0; z < z1; z += 7) {
        for (let right = 0; right < 2; right += 1) {
            const palette = rand() < 0.4 ? 2 : Math.floor(rand() * NEON_CITY_PALETTE.length);
            add(2 + right, z + rand() * 7, linearRgb(NEON_CITY_PALETTE[palette].hex), 0.06 + rand() * 0.16, 5);
        }
    }
    for (let i = 0; i < texels * rows; i += 1) out[i * 4 + 3] = 1;
    return out;
}
